import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  D1MessageRunRepository,
  type AttachMessageRunResponseInput,
  type CreateStartingMessageRunInput,
  type MessageRunError,
  type UpdateProcessingMessageRunInput,
} from "../src/server/db/message-run-repository";

type SqliteValue = null | number | bigint | string | Uint8Array;

function sqliteValue(value: unknown): SqliteValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (
    typeof value === "number"
    || typeof value === "bigint"
    || typeof value === "string"
    || value instanceof Uint8Array
  ) return value;
  return String(value);
}

class SqliteStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values.map(sqliteValue));
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async all<T>() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.values.map(sqliteValue)) as T[],
    };
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values.map(sqliteValue)) as T | undefined) ?? null;
  }
}

class SqliteD1 {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql, []);
  }

  async batch(statements: SqliteStatement[]) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const owner = "owner@example.com";
const otherOwner = "other@example.com";
const threadId = "thread-1";
const createdAt = "2026-08-29T20:00:00.000Z";
const later = "2026-08-29T20:01:00.000Z";
const expiresAt = "2026-08-29T20:10:00.000Z";
const terminalExpiresAt = "2026-08-30T20:00:00.000Z";
const runError: MessageRunError = {
  code: "coach_response_failed",
  message: "Coach could not finish. Your request is saved.",
  retryable: true,
};

function startingInput(
  id: string,
  idempotencyKey = `request-${id}`,
  requestFingerprint = `fingerprint-${id}`,
  targetThreadId = threadId,
): CreateStartingMessageRunInput {
  return {
    id,
    threadId: targetThreadId,
    idempotencyKey,
    requestFingerprint,
    userMessageId: `user-${id}`,
    userContent: `Please update routine ${id}`,
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    createdAt,
    expiresAt,
  };
}

async function repositoryFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const d1 = new SqliteD1(sqlite);
  const repository = new D1MessageRunRepository(d1 as unknown as D1Database);
  await repository.ready();
  for (const [id, email] of [
    [threadId, owner],
    ["other-thread", otherOwner],
    ["second-thread", owner],
  ]) {
    sqlite.prepare(`INSERT INTO assistant_threads (
      id, owner_email, title, created_at, updated_at
    ) VALUES (?, ?, 'New coaching conversation', ?, ?)`).run(id, email, createdAt, createdAt);
  }
  return { sqlite, repository };
}

test("message runs create atomically with one user message and owner-scoped idempotency", async () => {
  let readinessAttempts = 0;
  const unavailable = new D1MessageRunRepository({
    prepare: () => ({}),
    batch: async () => {
      readinessAttempts += 1;
      throw new Error("Schema unavailable.");
    },
  } as unknown as D1Database);
  await assert.rejects(() => unavailable.ready(), /schema unavailable/i);
  await assert.rejects(() => unavailable.ready(), /schema unavailable/i);
  assert.equal(readinessAttempts, 2);

  const { sqlite, repository } = await repositoryFixture();
  try {
    await repository.ready();
    const created = await repository.createStarting(owner, startingInput("run-1", "shared-key"));
    assert.equal(created.kind, "created");
    assert.deepEqual(created.run, {
      id: "run-1",
      ownerEmail: owner,
      threadId,
      idempotencyKey: "shared-key",
      requestFingerprint: "fingerprint-run-1",
      userMessageId: "user-run-1",
      assistantMessageId: null,
      status: "starting",
      phase: "planning",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      openAIResponseId: null,
      previousResponseId: null,
      responseIdsJson: "[]",
      pendingInputJson: "[]",
      activitiesJson: "[]",
      callSignaturesJson: "{}",
      roundCount: 0,
      toolCallCount: 0,
      forceFinal: false,
      proposalStaged: false,
      errorCode: null,
      errorMessage: null,
      errorRetryable: false,
      leaseToken: null,
      leaseExpiresAt: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    });
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_messages WHERE thread_id = ?").get(threadId)?.count,
      1,
    );
    assert.equal(
      sqlite.prepare("SELECT title FROM assistant_threads WHERE id = ?").get(threadId)?.title,
      "Please update routine run-1",
    );

    const replay = await repository.createStarting(
      owner,
      startingInput("run-replay", "shared-key", "fingerprint-run-1"),
    );
    assert.equal(replay.kind, "replayed");
    assert.equal(replay.run.userMessageId, "user-run-1");
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_messages WHERE thread_id = ?").get(threadId)?.count,
      1,
    );
    const conflict = await repository.createStarting(
      owner,
      startingInput("run-conflict", "shared-key", "different"),
    );
    assert.equal(conflict.kind, "conflict");
    assert.equal(conflict.run.id, "run-1");
    const active = await repository.createStarting(owner, startingInput("run-active"));
    assert.equal(active.kind, "active");
    assert.equal(active.run.id, "run-1");

    assert.equal((await repository.get(owner, "run-1"))?.id, "run-1");
    assert.equal(await repository.get(otherOwner, "run-1"), null);
    assert.equal(await repository.getByIdempotency(otherOwner, "shared-key"), null);
    assert.equal((await repository.getActiveForThread(owner, threadId))?.id, "run-1");
    assert.equal(await repository.getActiveForThread(otherOwner, threadId), null);
    assert.equal((await repository.getLatestForThread(owner, threadId))?.id, "run-1");
    assert.equal(await repository.getLatestForThread(otherOwner, threadId), null);

    sqlite.prepare(`UPDATE assistant_message_runs SET
      force_final = 1, proposal_staged = 1, error_retryable = 1 WHERE id = 'run-1'`).run();
    const booleans = await repository.get(owner, "run-1");
    assert.equal(booleans?.forceFinal, true);
    assert.equal(booleans?.proposalStaged, true);
    assert.equal(booleans?.errorRetryable, true);

    const other = await repository.createStarting(
      otherOwner,
      startingInput("other-run", "shared-key", "other-fingerprint", "other-thread"),
    );
    assert.equal(other.kind, "created");
    assert.equal(other.run.ownerEmail, otherOwner);
    await assert.rejects(
      () => repository.createStarting(owner, startingInput("missing-thread", "missing-key", "missing", "no-thread")),
      /could not be created/i,
    );
  } finally {
    sqlite.close();
  }
});

test("processing leases and call ledger fence stale workers while preserving progress", async () => {
  const { sqlite, repository } = await repositoryFixture();
  try {
    await repository.createStarting(owner, startingInput("run-progress"));
    const initialResponse: AttachMessageRunResponseInput = {
      openAIResponseId: "resp-1",
      previousResponseId: null,
      responseIdsJson: '["resp-1"]',
      pendingInputJson: '[{"type":"input_text"}]',
      status: "queued",
      phase: "thinking",
      roundCount: 1,
      updatedAt: createdAt,
    };
    assert.equal(await repository.attachResponse(otherOwner, "run-progress", initialResponse), false);
    assert.equal(await repository.attachResponse(owner, "run-progress", initialResponse), true);
    assert.equal(await repository.attachResponse(owner, "run-progress", initialResponse), false);
    assert.equal(
      await repository.setPending(owner, "run-progress", "resp-1", "queued", "thinking", later),
      false,
    );
    assert.equal(
      await repository.setPending(owner, "run-progress", "wrong", "in_progress", "thinking", later),
      false,
    );
    assert.equal(
      await repository.setPending(owner, "run-progress", "resp-1", "in_progress", "checking", later),
      true,
    );

    assert.equal(
      await repository.claimProcessing(otherOwner, "run-progress", "lease-1", later, expiresAt, createdAt),
      false,
    );
    assert.equal(
      await repository.claimProcessing(owner, "run-progress", "lease-1", later, expiresAt, createdAt),
      true,
    );
    assert.equal(
      await repository.claimProcessing(owner, "run-progress", "lease-too-early", later, terminalExpiresAt, createdAt),
      false,
    );
    const processingUpdate: UpdateProcessingMessageRunInput = {
      phase: "checking",
      openAIResponseId: "resp-1",
      previousResponseId: null,
      responseIdsJson: '["resp-1"]',
      pendingInputJson: '[{"type":"function_call_output"}]',
      activitiesJson: '[{"id":"step-1","status":"running"}]',
      callSignaturesJson: '{"get_routine:{}":1}',
      roundCount: 1,
      toolCallCount: 0,
      forceFinal: false,
      proposalStaged: false,
      updatedAt: later,
    };
    assert.equal(await repository.updateProcessing(owner, "run-progress", "wrong", processingUpdate), false);
    assert.equal(await repository.updateProcessing(owner, "run-progress", "lease-1", processingUpdate), true);

    const callInput = {
      id: "ledger-1",
      callId: "call-1",
      callSignature: "get_routine:{}",
      toolName: "get_routine",
      argumentsJson: "{}",
      createdAt: later,
    };
    assert.deepEqual(
      await repository.beginCall(otherOwner, "run-progress", "lease-1", callInput),
      { kind: "rejected", call: null },
    );
    assert.equal((await repository.beginCall(owner, "run-progress", "lease-1", callInput)).kind, "created");
    const conflictingCall = await repository.beginCall(owner, "run-progress", "lease-1", {
      ...callInput,
      callSignature: "get_routine:conflict",
    });
    assert.equal(conflictingCall.kind, "conflict");
    assert.equal(await repository.getCall(otherOwner, "run-progress", "call-1"), null);
    assert.equal(
      await repository.claimProcessing(owner, "run-progress", "lease-2", later, terminalExpiresAt, expiresAt),
      true,
    );
    assert.equal((await repository.beginCall(owner, "run-progress", "lease-2", callInput)).kind, "reclaimed");
    const finishInput = {
      status: "succeeded" as const,
      outputJson: '{"routine":"C"}',
      activityJson: '{"name":"get_routine","status":"succeeded"}',
      errorMessage: null,
      activitiesJson: '[{"id":"step-1","status":"succeeded"}]',
      callSignaturesJson: '{"get_routine:{}":1}',
      toolCallCount: 1,
      proposalStaged: false,
      phase: "checking",
      updatedAt: terminalExpiresAt,
    };
    assert.equal(
      await repository.finishCall(owner, "run-progress", "call-1", "lease-1", finishInput),
      false,
    );
    assert.equal(
      await repository.finishCall(owner, "run-progress", "call-1", "lease-2", finishInput),
      true,
    );
    assert.equal((await repository.beginCall(owner, "run-progress", "lease-2", callInput)).kind, "replayed");
    assert.equal((await repository.getCall(owner, "run-progress", "call-1"))?.outputJson, finishInput.outputJson);

    const failedCall = {
      ...callInput,
      id: "ledger-2",
      callId: "call-2",
      callSignature: "search_exercises:{}",
      toolName: "search_exercises",
    };
    assert.equal((await repository.beginCall(owner, "run-progress", "lease-2", failedCall)).kind, "created");
    assert.equal(await repository.finishCall(owner, "run-progress", "call-2", "lease-2", {
      ...finishInput,
      status: "failed",
      outputJson: '{"error":"unavailable"}',
      activityJson: null,
      errorMessage: "Exercise search unavailable.",
      toolCallCount: 2,
    }), true);

    const abandonedCall = {
      ...callInput,
      id: "ledger-3",
      callId: "call-3",
      callSignature: "get_exercise:{}",
      toolName: "get_exercise",
    };
    assert.equal((await repository.beginCall(owner, "run-progress", "lease-2", abandonedCall)).kind, "created");

    assert.equal(
      await repository.releaseProcessing(owner, "run-progress", "wrong", "in_progress", "recovering", later),
      false,
    );
    assert.equal(
      await repository.releaseProcessing(owner, "run-progress", "lease-2", "in_progress", "recovering", later),
      true,
    );
    assert.deepEqual(
      await repository.beginCall(owner, "run-progress", "lease-2", abandonedCall),
      { kind: "rejected", call: null },
    );
    assert.equal(
      await repository.claimProcessing(owner, "run-progress", "lease-3", later, terminalExpiresAt, later),
      true,
    );
    assert.equal(await repository.attachResponse(owner, "run-progress", {
      openAIResponseId: "resp-2",
      previousResponseId: "resp-1",
      responseIdsJson: '["resp-1","resp-2"]',
      status: "in_progress",
      phase: "thinking",
      roundCount: 2,
      updatedAt: later,
      leaseToken: "wrong",
    }), false);
    assert.equal(await repository.attachResponse(owner, "run-progress", {
      openAIResponseId: "resp-2",
      previousResponseId: "resp-1",
      responseIdsJson: '["resp-1","resp-2"]',
      status: "in_progress",
      phase: "thinking",
      roundCount: 2,
      updatedAt: later,
      leaseToken: "lease-3",
    }), true);
    assert.equal((await repository.get(owner, "run-progress"))?.pendingInputJson, "[]");

    assert.equal(
      await repository.claimProcessing(owner, "run-progress", "lease-final", later, terminalExpiresAt, later),
      true,
    );
    assert.equal(await repository.updateProcessing(owner, "run-progress", "lease-final", {
      ...processingUpdate,
      openAIResponseId: "resp-2",
      previousResponseId: "resp-1",
      responseIdsJson: '["resp-1","resp-2"]',
      toolCallCount: 2,
      proposalStaged: true,
    }), true);
    const success = {
      assistantMessageId: "assistant-1",
      content: "I prepared the routine change for review.",
      responseId: "resp-2",
      runActivitiesJson: '[{"id":"step-2","status":"succeeded"}]',
      messageActivitiesJson: '[{"name":"propose_routine_change","status":"succeeded"}]',
      createdAt: terminalExpiresAt,
      expiresAt: "2026-08-31T20:00:00.000Z",
    };
    assert.equal(await repository.succeed(otherOwner, "run-progress", "lease-final", success), false);
    assert.equal(await repository.succeed(owner, "run-progress", "wrong", success), false);
    assert.equal(await repository.succeed(owner, "run-progress", "lease-final", success), true);
    assert.equal(await repository.succeed(owner, "run-progress", "lease-final", success), false);
    const succeeded = await repository.get(owner, "run-progress");
    assert.equal(succeeded?.status, "succeeded");
    assert.equal(succeeded?.phase, "review_ready");
    assert.equal(succeeded?.pendingInputJson, "[]");
    assert.equal(succeeded?.callSignaturesJson, "{}");
    assert.equal(succeeded?.responseIdsJson, '["resp-1","resp-2"]');
    const assistant = sqlite.prepare(`SELECT activities_json AS activitiesJson
      FROM assistant_messages WHERE id = 'assistant-1'`).get();
    assert.equal(assistant?.activitiesJson, success.messageActivitiesJson);
    assert.equal(await repository.clearResponseIds(otherOwner, "run-progress"), false);
    assert.equal(await repository.clearResponseIds(owner, "run-progress"), true);
    assert.equal((await repository.get(owner, "run-progress"))?.responseIdsJson, "[]");

    await repository.createStarting(owner, startingInput("run-no-proposal", "no-proposal-key"));
    await repository.claimProcessing(owner, "run-no-proposal", "lease-no-proposal", later, terminalExpiresAt, later);
    assert.equal(await repository.succeed(owner, "run-no-proposal", "lease-no-proposal", {
      ...success,
      assistantMessageId: "assistant-2",
      responseId: null,
      runActivitiesJson: "[]",
      messageActivitiesJson: "[]",
    }), true);
    assert.equal((await repository.get(owner, "run-no-proposal"))?.phase, "synthesizing");
  } finally {
    sqlite.close();
  }
});

test("terminal failures, expiry, retries, and pruning release the active slot safely", async () => {
  const { sqlite, repository } = await repositoryFixture();
  try {
    await repository.createStarting(owner, startingInput("failed-source", "source-key"));
    assert.equal(await repository.fail(otherOwner, "failed-source", runError, later, terminalExpiresAt), false);
    assert.equal(await repository.fail(owner, "failed-source", runError, later, terminalExpiresAt), true);
    const failed = await repository.get(owner, "failed-source");
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.phase, "recovering");
    assert.equal(failed?.errorCode, runError.code);
    assert.equal(failed?.errorRetryable, true);

    const retryInput = {
      id: "retry-1",
      sourceRunId: "failed-source",
      threadId,
      idempotencyKey: "retry-key-1",
      requestFingerprint: "retry-fingerprint",
      userMessageId: "user-failed-source",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      createdAt: later,
      expiresAt,
    };
    const retry = await repository.createRetryStarting(owner, retryInput);
    assert.equal(retry.kind, "created");
    assert.equal(retry.run.userMessageId, failed?.userMessageId);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_messages WHERE thread_id = ?").get(threadId)?.count,
      1,
    );
    assert.equal((await repository.createRetryStarting(owner, {
      ...retryInput,
      id: "retry-replay",
    })).kind, "replayed");
    assert.equal((await repository.createRetryStarting(owner, {
      ...retryInput,
      id: "retry-conflict",
      requestFingerprint: "other-fingerprint",
    })).kind, "conflict");
    assert.equal((await repository.createRetryStarting(owner, {
      ...retryInput,
      id: "retry-active",
      idempotencyKey: "retry-active-key",
    })).kind, "active");

    assert.equal(
      await repository.expireIfPast(owner, "retry-1", runError, createdAt, terminalExpiresAt),
      false,
    );
    assert.equal(
      await repository.claimProcessing(owner, "retry-1", "retry-lease", later, terminalExpiresAt, later),
      true,
    );
    assert.equal(await repository.fail(owner, "retry-1", runError, later, terminalExpiresAt), false);
    assert.equal(await repository.fail(owner, "retry-1", runError, later, terminalExpiresAt, "wrong"), false);
    assert.equal(await repository.fail(owner, "retry-1", runError, later, terminalExpiresAt, "retry-lease"), true);

    await assert.rejects(() => repository.createRetryStarting(otherOwner, {
      ...retryInput,
      id: "wrong-owner-retry",
      idempotencyKey: "wrong-owner-key",
    }), /could not be created/i);
    await assert.rejects(() => repository.createRetryStarting(owner, {
      ...retryInput,
      id: "wrong-message-retry",
      idempotencyKey: "wrong-message-key",
      userMessageId: "wrong-message",
    }), /could not be created/i);

    await repository.createStarting(owner, startingInput("expired-start", "expired-start-key"));
    assert.equal(await repository.expire(owner, "expired-start", runError, later, terminalExpiresAt), true);
    assert.equal((await repository.get(owner, "expired-start"))?.status, "expired");

    await repository.createStarting(owner, startingInput("absolute-expiry", "absolute-key"));
    sqlite.prepare("UPDATE assistant_message_runs SET expires_at = ? WHERE id = ?")
      .run(createdAt, "absolute-expiry");
    await repository.claimProcessing(owner, "absolute-expiry", "absolute-lease", later, terminalExpiresAt, later);
    assert.equal(
      await repository.expireIfPast(otherOwner, "absolute-expiry", runError, later, terminalExpiresAt),
      false,
    );
    assert.equal(
      await repository.expireIfPast(owner, "absolute-expiry", runError, later, terminalExpiresAt),
      true,
    );
    assert.equal((await repository.get(owner, "absolute-expiry"))?.leaseToken, null);

    await repository.createStarting(owner, startingInput("leased-expiry", "leased-expiry-key"));
    await repository.claimProcessing(owner, "leased-expiry", "expiry-lease", later, terminalExpiresAt, later);
    assert.equal(
      await repository.expire(owner, "leased-expiry", runError, later, terminalExpiresAt, "expiry-lease"),
      true,
    );

    sqlite.prepare("UPDATE assistant_message_runs SET expires_at = ? WHERE id = ?")
      .run(createdAt, "failed-source");
    sqlite.prepare(`UPDATE assistant_message_runs SET status = 'cancelled', expires_at = ?
      WHERE id = ?`).run(createdAt, "retry-1");
    assert.equal(await repository.pruneExpired(later), 2);
    assert.equal(await repository.get(owner, "failed-source"), null);
    assert.equal((await repository.getLatestForThread(owner, threadId))?.id, "leased-expiry");
  } finally {
    sqlite.close();
  }
});
