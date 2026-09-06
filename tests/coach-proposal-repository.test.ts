import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { D1MessageRunRepository, type PreparedCoachProposal } from "../src/server/db/message-run-repository";
const owner = "coach-owner@example.com", createdAt = "2026-09-06T20:00:00.000Z", updatedAt = "2026-09-06T20:01:00.000Z";
const leaseExpiresAt = "2026-09-06T20:02:00.000Z", expiresAt = "2026-09-06T20:10:00.000Z";
class Statement {
  constructor(readonly sqlite: DatabaseSync, readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.sqlite, this.sql, values); }
  args() { return this.values.map((value) => value === undefined ? null : typeof value === "boolean" ? Number(value) : value) as Array<null | string | number | bigint | Uint8Array>; }
  async run() { const result = this.sqlite.prepare(this.sql).run(...this.args()); return { success: true, meta: { changes: Number(result.changes) } }; }
  async first<T>() { return (this.sqlite.prepare(this.sql).get(...this.args()) as T | undefined) ?? null; }
  async all<T>() { return { success: true, results: this.sqlite.prepare(this.sql).all(...this.args()) as T[] }; }
}
async function databaseFixture() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys = ON");
  const d1 = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const repository = new D1MessageRunRepository(d1 as unknown as D1Database); await repository.ready();
  sqlite.prepare("INSERT INTO assistant_threads(id,owner_email,title,created_at,updated_at) VALUES(?,?,'Coach',?,?)").run("thread", owner, createdAt, createdAt);
  await repository.createStarting(owner, { id: "run", threadId: "thread", idempotencyKey: "request-key", requestFingerprint: "fingerprint",
    userMessageId: "message", userContent: "Update routines", model: "gpt-5.6-terra", reasoningEffort: "low", createdAt, expiresAt,
    userContextJson: '{"routineId":"A"}', timeZone: "America/Los_Angeles", contextStateJson: '{"state":"saved"}' });
  await repository.attachResponse(owner, "run", { openAIResponseId: "response-1", previousResponseId: null, responseIdsJson: '["response-1"]', status: "in_progress", phase: "checking", roundCount: 1, updatedAt: createdAt });
  assert.equal(await repository.claimProcessing(owner, "run", { expectedResponseId: "response-1", leaseToken: "lease", claimedAt: createdAt, leaseExpiresAt }), true);
  const begin = async (callId = "call", toolName = "propose_routine_change") => repository.beginCall(owner, "run", "lease", {
    id: "ledger-" + callId, callId, callSignature: toolName + ":{}", toolName, argumentsJson: "{}", createdAt: updatedAt,
  });
  const commit = async (plans: PreparedCoachProposal[], outputJson = '{"planId":"one"}', callId = "call", lease = "lease") =>
    repository.commitProposalResult(owner, "run", callId, lease, { plans, outputJson, updatedAt });
  const count = (table: string) => Number(sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get()!.count);
  return { sqlite, repository, begin, commit, count };
}
function routine(id = "one", overrides: Partial<PreparedCoachProposal> = {}): PreparedCoachProposal {
  return { kind: "routine", id, threadId: "thread", routineId: id, routineCode: "A", baseVersionId: null,
    proposedInputJson: "{}", summary: "Review this", rationale: "Reason", diffJson: "[]", createdAt: updatedAt,
    originRunId: "run", originUserMessageId: "message", supersedesPlanId: null, ...overrides } as PreparedCoachProposal;
}
function exercise(id = "exercise", overrides: Partial<PreparedCoachProposal> = {}): PreparedCoachProposal {
  return { kind: "exercise", id, threadId: "thread", action: "create", exerciseId: null, exerciseName: "Carry",
    baseUpdatedAt: null, baseInputJson: null, proposedInputJson: "{}", summary: "Review exercise", rationale: "Reason", diffJson: "[]", createdAt: updatedAt,
    originRunId: "run", originUserMessageId: "message", supersedesPlanId: null, ...overrides } as PreparedCoachProposal;
}
test("proposal commits reserve recoverable output atomically, replay once, and preserve context", async () => {
  const f = await databaseFixture();
  try {
    await f.begin(); assert.equal(await f.commit([routine(), exercise()]), true);
    assert.equal(f.count("assistant_change_plans"), 1); assert.equal(f.count("assistant_exercise_change_plans"), 1);
    const call = await f.repository.getCall(owner, "run", "call");
    assert.equal(call?.status, "processing"); assert.equal(call?.outputJson, '{"planId":"one"}');
    assert.equal(await f.commit([routine(), exercise()]), true); assert.equal(await f.commit([routine()], '{"different":true}'), false);
    assert.equal(f.count("assistant_change_plans"), 1);
    assert.equal((await f.repository.get(owner, "run"))?.contextStateJson, '{"state":"saved"}');
    assert.deepEqual({ ...f.sqlite.prepare("SELECT context_json,time_zone FROM assistant_messages WHERE id = ?").get("message") },
      { context_json: '{"routineId":"A"}', time_zone: "America/Los_Angeles" });
    await f.begin("reuse"); assert.equal(await f.commit([], '{"planId":"one"}', "reuse"), true);
    assert.equal(await f.commit([], "{}", "missing-call"), false);
  } finally { f.sqlite.close(); }
});
test("stale leases and incorrect provenance cannot stage or reserve a proposal", async () => {
  for (const scenario of ["lease", "expired-lease", "expired-run", "owner", "thread", "run", "message"]) {
    const f = await databaseFixture();
    try {
      await f.begin();
      if (scenario === "expired-lease") f.sqlite.prepare("UPDATE assistant_message_runs SET lease_expires_at = ?").run(updatedAt);
      if (scenario === "expired-run") f.sqlite.prepare("UPDATE assistant_message_runs SET expires_at = ?").run(updatedAt);
      const plan = routine("one", scenario === "thread" ? { threadId: "elsewhere" } : scenario === "run" ? { originRunId: "elsewhere" }
        : scenario === "message" ? { originUserMessageId: "other-message" } : {});
      const result = scenario === "owner"
        ? await f.repository.commitProposalResult("other@example.com", "run", "call", "lease", { plans: [plan], outputJson: "{}", updatedAt })
        : await f.commit([plan], "{}", "call", scenario === "lease" ? "old-lease" : "lease");
      assert.equal(result, false); assert.equal(f.count("assistant_change_plans"), 0);
      assert.equal((await f.repository.getCall(owner, "run", "call"))?.outputJson, null);
    } finally { f.sqlite.close(); }
  }
});
test("revision commits supersede the pending target and reject an entire stale batch", async () => {
  for (const kind of ["routine", "exercise"] as const) {
    const f = await databaseFixture();
    try {
      const original = kind === "routine" ? routine("original") : exercise("original");
      await f.begin(); assert.equal(await f.commit([original]), true); await f.begin("revision");
      const next = kind === "routine" ? routine("revision", { supersedesPlanId: "original" }) : exercise("revision", { supersedesPlanId: "original" });
      assert.equal(await f.commit([next], '{"planId":"revision"}', "revision"), true);
      const table = kind === "routine" ? "assistant_change_plans" : "assistant_exercise_change_plans";
      assert.equal(f.sqlite.prepare("SELECT status FROM " + table + " WHERE id = 'original'").get()!.status, "superseded");
      await f.begin("stale"); assert.equal(await f.commit([routine("unrelated"), { ...next, id: "stale" }], "{}", "stale"), false);
      assert.equal(f.sqlite.prepare("SELECT id FROM assistant_change_plans WHERE id = 'unrelated'").get(), undefined);
      assert.equal((await f.repository.getCall(owner, "run", "stale"))?.outputJson, null);
    } finally { f.sqlite.close(); }
  }
  for (const mismatch of ["routine-target", "exercise-target"]) {
    const f = await databaseFixture();
    try {
      await f.begin(); await f.commit([routine("routine-original"), exercise("exercise-original")]); await f.begin("wrong-target");
      const next = mismatch === "routine-target"
        ? routine("wrong", { routineCode: "B", routineId: "other", supersedesPlanId: "routine-original" })
        : exercise("wrong", { exerciseName: "Other exercise", supersedesPlanId: "exercise-original" });
      assert.equal(await f.commit([next], "{}", "wrong-target"), false);
    } finally { f.sqlite.close(); }
  }
});
test("database failure rolls back all proposals and the output reservation", async () => {
  const f = await databaseFixture();
  try {
    await f.begin();
    f.sqlite.exec("CREATE TRIGGER fail_proposal BEFORE INSERT ON assistant_change_plans WHEN NEW.routine_code = 'BROKEN' BEGIN SELECT RAISE(ABORT, 'database write failed'); END;");
    await assert.rejects(() => f.commit([exercise(), routine("broken", { routineCode: "BROKEN" })]), /database write failed/);
    assert.equal(f.count("assistant_change_plans"), 0); assert.equal(f.count("assistant_exercise_change_plans"), 0);
    assert.equal((await f.repository.getCall(owner, "run", "call"))?.outputJson, null);
  } finally { f.sqlite.close(); }
});
test("processing CAS rejects old response IDs and expired claims", async () => {
  const f = await databaseFixture();
  try {
    await f.repository.attachResponse(owner, "run", { openAIResponseId: "response-2", previousResponseId: "response-1",
      responseIdsJson: '["response-1","response-2"]', status: "in_progress", phase: "checking", roundCount: 2,
      updatedAt, leaseToken: "lease", contextStateJson: '{"state":"updated"}' });
    const claim = { expectedResponseId: "response-1", leaseToken: "second", claimedAt: updatedAt, leaseExpiresAt };
    assert.equal(await f.repository.claimProcessing(owner, "run", claim), false);
    assert.equal(await f.repository.claimProcessing("other@example.com", "run", { ...claim, expectedResponseId: "response-2" }), false);
    assert.equal(await f.repository.claimProcessing(owner, "run", { ...claim, expectedResponseId: "response-2" }), true);
    assert.equal((await f.repository.get(owner, "run"))?.contextStateJson, '{"state":"updated"}');
    assert.equal(await f.repository.claimProcessing(owner, "run", { ...claim, expectedResponseId: "response-2", leaseToken: "too-early" }), false);
    assert.equal(await f.repository.claimProcessing(owner, "run", { ...claim, expectedResponseId: "response-2", claimedAt: leaseExpiresAt, leaseExpiresAt: expiresAt }), true);
    assert.equal(await f.repository.claimProcessing(owner, "run", { ...claim, expectedResponseId: "response-2", claimedAt: expiresAt, leaseExpiresAt: "2026-09-06T20:20:00.000Z" }), false);
  } finally { f.sqlite.close(); }
});
test("read cache is owner scoped and invalidates after any proposal attempt", async () => {
  const f = await databaseFixture();
  try {
    await f.begin("read", "get_routine");
    await f.repository.finishCall(owner, "run", "read", "lease", {
      status: "succeeded", outputJson: '{"routine":"A"}', activityJson: null, errorMessage: null,
      activitiesJson: "[]", callSignaturesJson: '{"get_routine:{}":1}', toolCallCount: 1,
      proposalStaged: false, phase: "checking", updatedAt,
    });
    assert.equal((await f.repository.findReusableReadCall(owner, "run", "get_routine:{}"))?.callId, "read");
    assert.equal(await f.repository.findReusableReadCall("other@example.com", "run", "get_routine:{}"), null);
    assert.equal(await f.repository.findReusableReadCall(owner, "run", "other:{}"), null);
    await f.begin("proposal"); assert.equal(await f.repository.findReusableReadCall(owner, "run", "get_routine:{}"), null);
  } finally { f.sqlite.close(); }
});
test("expired leases and runs cannot execute, finish, attach, or publish a response", async () => {
  for (const expiryColumn of ["lease_expires_at", "expires_at"]) {
    const f = await databaseFixture();
    try {
      await f.begin();
      f.sqlite.prepare("UPDATE assistant_message_runs SET " + expiryColumn + " = ? WHERE id = 'run'").run(updatedAt);
      assert.equal((await f.begin("new-call", "get_routine")).kind, "rejected");
      assert.equal((await f.begin()).kind, "rejected");
      assert.equal(await f.repository.releaseProcessing(owner, "run", "lease", "in_progress", "recovering", updatedAt), false);
      const error = { code: "late_failure", message: "Late failure", retryable: true };
      assert.equal(await f.repository.fail(owner, "run", error, updatedAt, expiresAt, "lease"), false);
      assert.equal(await f.repository.expire(owner, "run", error, updatedAt, expiresAt, "lease"), false);
      assert.equal(await f.repository.finishCall(owner, "run", "call", "lease", {
        status: "succeeded", outputJson: "{}", activityJson: null, errorMessage: null,
        activitiesJson: "[]", callSignaturesJson: "{}", toolCallCount: 1, proposalStaged: false, phase: "checking", updatedAt,
      }), false);
      assert.equal(await f.repository.updateProcessing(owner, "run", "lease", {
        phase: "checking", openAIResponseId: "response-1", previousResponseId: null,
        responseIdsJson: '["response-1"]', pendingInputJson: "[]", activitiesJson: "[]", callSignaturesJson: "{}",
        roundCount: 1, toolCallCount: 0, forceFinal: false, proposalStaged: false, updatedAt,
      }), false);
      assert.equal(await f.repository.attachResponse(owner, "run", {
        openAIResponseId: "late-response", previousResponseId: "response-1", responseIdsJson: '["late-response"]',
        status: "in_progress", phase: "checking", roundCount: 2, updatedAt, leaseToken: "lease",
      }), false);
      assert.equal(await f.repository.succeed(owner, "run", "lease", {
        assistantMessageId: "late-message", content: "Too late", responseId: "response-1", runActivitiesJson: "[]",
        messageActivitiesJson: "[]", createdAt: updatedAt, expiresAt: "2026-09-07T20:00:00.000Z",
      }), false);
      assert.equal((await f.repository.getCall(owner, "run", "call"))?.outputJson, null);
      assert.equal((await f.repository.get(owner, "run"))?.openAIResponseId, "response-1"); assert.equal(f.count("assistant_messages"), 1);
    } finally { f.sqlite.close(); }
  }
});

test("new-exercise revisions fence the exact original name while preserving display changes", async () => {
  for (const correctPriorName of [true, false]) {
    const f = await databaseFixture();
    try {
      await f.begin(); assert.equal(await f.commit([exercise("original", { exerciseName: "Farmer Carry" })]), true);
      await f.begin("revision");
      const revised = exercise("revision", { exerciseName: "farmer  carry", supersedesPlanId: "original",
        supersedesExerciseName: correctPriorName ? "Farmer Carry" : "Other exercise" });
      assert.equal(await f.commit([revised], '{"planId":"revision"}', "revision"), correctPriorName);
      assert.equal(f.sqlite.prepare("SELECT status FROM assistant_exercise_change_plans WHERE id = 'original'").get()!.status, correctPriorName ? "superseded" : "pending");
      assert.equal(f.sqlite.prepare("SELECT exercise_name FROM assistant_exercise_change_plans WHERE id = 'revision'").get()?.exercise_name, correctPriorName ? "farmer  carry" : undefined);
    } finally { f.sqlite.close(); }
  }
});
