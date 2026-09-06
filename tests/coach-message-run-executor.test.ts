import assert from "node:assert/strict";
import test from "node:test";
import { advanceCoachMessageRun, parseStoredRunActivities, type CoachRunDependencies } from "../src/server/coach/message-run-executor";
import type { StoredAssistantMessageRun, StoredMessageRunCall } from "../src/server/db/message-run-repository";
import type { CoachResponse } from "../src/server/coach/response-types";
const now = Date.parse("2026-09-06T20:00:00.000Z"), date = new Date(now).toISOString();
const response = (output: CoachResponse["output"] = [{ type: "message", content: [{ type: "output_text", text: "Ready" }] }], id = "response-1"): CoachResponse => ({ id, status: "completed", output });
const tool = (name = "get_routine", callId = "call-1", argumentsText = "{}") => ({ type: "function_call", name, call_id: callId, arguments: argumentsText });
const activity = (name = "get_routine") => ({ id: "step-1", name, label: "Checked", purpose: null, status: "succeeded" as const });
function fixture(overrides: Partial<StoredAssistantMessageRun> = {}) {
  let current: StoredAssistantMessageRun | null = {
    id: "run-1", ownerEmail: "owner@example.com", threadId: "thread-1", idempotencyKey: "request-1", requestFingerprint: "fingerprint",
    userMessageId: "message-1", assistantMessageId: null, status: "in_progress", phase: "checking", model: "gpt-5.6-terra", reasoningEffort: "low",
    openAIResponseId: "response-1", previousResponseId: null, responseIdsJson: '["response-1"]', pendingInputJson: "[]", contextStateJson: "{}",
    activitiesJson: "[]", callSignaturesJson: "{}", roundCount: 1, toolCallCount: 0, forceFinal: false, proposalStaged: false,
    errorCode: null, errorMessage: null, errorRetryable: false, leaseToken: null, leaseExpiresAt: null,
    createdAt: date, updatedAt: date, expiresAt: new Date(now + 600_000).toISOString(), ...overrides,
  };
  const calls = new Map<string, StoredMessageRunCall>(), events: Array<{ type: string; value?: unknown }> = [];
  let generated = 0;
  const deps: CoachRunDependencies = {
    available: true, now: () => now, createId: () => "lease-" + ++generated,
    store: {
      get: async () => current ? structuredClone(current) : null,
      claimProcessing: async (_owner, _id, input) => {
        if (!current || current.openAIResponseId !== input.expectedResponseId || current.status === "processing" || current.status === "succeeded") return false;
        current = { ...current, status: "processing", leaseToken: input.leaseToken, leaseExpiresAt: input.leaseExpiresAt }; return true;
      },
      setPending: async (_owner, _id, expected, status, phase) => {
        if (current?.openAIResponseId !== expected) return false;
        current = { ...current, status, phase }; return true;
      },
      releaseProcessing: async (_owner, _id, _lease, status, phase) => { current = { ...current!, status, phase, leaseToken: null }; return true; },
      getCall: async (_owner, _id, callId) => calls.get(callId) ?? null,
      findReusableReadCall: async (_owner, _id, signature) => [...calls.values()].find((call) => call.callSignature === signature && call.status === "succeeded") ?? null,
      beginCall: async (_owner, _id, lease, input) => {
        const prior = calls.get(input.callId);
        if (prior) return { kind: prior.status === "processing" ? "reclaimed" : "replayed", call: prior };
        const call: StoredMessageRunCall = { ...input, ownerEmail: current!.ownerEmail, runId: current!.id,
          outputJson: null, activityJson: null, status: "processing", errorMessage: null, leaseToken: lease, updatedAt: input.createdAt };
        calls.set(input.callId, call); return { kind: "created", call };
      },
      finishCall: async (_owner, _id, callId, _lease, input) => {
        calls.set(callId, { ...calls.get(callId)!, ...input });
        current = { ...current!, activitiesJson: input.activitiesJson, callSignaturesJson: input.callSignaturesJson,
          toolCallCount: input.toolCallCount, proposalStaged: input.proposalStaged, phase: input.phase }; return true;
      },
      updateProcessing: async (_owner, _id, _lease, input) => { current = { ...current!, ...input }; return true; },
      attachResponse: async (_owner, _id, input) => {
        current = { ...current!, ...input, contextStateJson: input.contextStateJson ?? current!.contextStateJson,
          pendingInputJson: input.pendingInputJson ?? "[]", leaseToken: null }; return true;
      },
    },
    retrieveResponse: async () => response(),
    createContinuation: async (run, outputs) => { events.push({ type: "continue", value: { run, outputs } }); return { id: "response-2", status: "queued" }; },
    executeTool: async (_run, call, identity) => { events.push({ type: "execute", value: { call, identity } }); return { value: 1 }; },
    recordToolCall: async (_run, _call, output, status) => { events.push({ type: "audit", value: { output, status } }); },
    reportAuditError: (error) => { events.push({ type: "audit-error", value: error }); },
    classifyRequestError: (error) => error && typeof error === "object" && "requestError" in error
      ? (error as { requestError: ReturnType<CoachRunDependencies["classifyRequestError"]> }).requestError : null,
    publicError: () => ({ code: "run_failed", message: "Saved request failed", retryable: true }),
    formatToolError: (error) => error instanceof Error ? error.message : "Tool failed",
    expireRun: async (run) => { current = { ...run, status: "expired" }; return current; },
    failUnattachedRun: async (run) => { current = { ...run, status: "failed", errorCode: "start_lost" }; return current; },
    succeedRun: async (run, _lease, text) => { events.push({ type: "success", value: text }); current = { ...run, status: "succeeded" }; return current; },
    failRun: async (run, _lease, error) => { events.push({ type: "failure", value: error }); current = { ...run, status: "failed", errorCode: error.code }; return current; },
    deleteResponse: async (id) => { events.push({ type: "delete", value: id }); },
    processSummaryResponse: async (run, _lease, remote) => { events.push({ type: "summary", value: remote }); current = { ...run, phase: "planning", status: "in_progress" }; return current; },
  };
  return { deps, calls, events, current: () => current, set: (value: StoredAssistantMessageRun | null) => { current = value; },
    advance: () => advanceCoachMessageRun({ ownerEmail: "owner@example.com", runId: "run-1" }, deps) };
}
const requestFailure = (status = 429, upstreamStatus: number | null = null) => ({ requestError: {
  status, upstreamStatus, code: "provider_unavailable", message: "Try later", retryable: status >= 500 || status === 429,
} });
function ledger(name: string, status: StoredMessageRunCall["status"], outputJson: string | null, callId = "call-1"): StoredMessageRunCall {
  return { id: "ledger-" + callId, ownerEmail: "owner@example.com", runId: "run-1", callId,
    callSignature: name + ":{}", toolName: name, argumentsJson: "{}", outputJson,
    activityJson: status === "processing" ? null : JSON.stringify(activity(name)), status,
    errorMessage: null, leaseToken: "old-lease", createdAt: date, updatedAt: date };
}
test("durable executor handles missing, terminal, expired, unavailable, and unattached runs", async () => {
  const missing = fixture(); missing.set(null); assert.equal((await missing.advance()).kind, "not_found");
  for (const status of ["succeeded", "failed", "expired", "cancelled"] as const) {
    const f = fixture({ status }); assert.equal((await f.advance()).kind, "state"); assert.equal(f.events.length, 0);
  }
  const expired = fixture({ expiresAt: date }); await expired.advance(); assert.equal(expired.current()?.status, "expired");
  const unavailable = fixture(); unavailable.deps.available = false; assert.equal((await unavailable.advance()).kind, "unavailable");
  const starting = fixture({ status: "starting", openAIResponseId: null }); await starting.advance(); assert.equal(starting.current()?.status, "starting");
  for (const status of ["starting", "in_progress"] as const) {
    const f = fixture({ status, openAIResponseId: null, updatedAt: new Date(now - 30_000).toISOString() });
    await f.advance(); assert.equal(f.current()?.errorCode, "start_lost");
  }
});
test("executor handles pending and terminal provider results and summary fallback", async () => {
  for (const status of ["queued", "in_progress"] as const) {
    const f = fixture(); f.deps.retrieveResponse = async () => ({ id: "response-1", status });
    await f.advance(); assert.equal(f.current()?.status, status);
  }
  const text = fixture(); await text.advance(); assert.equal(text.events.at(-1)?.value, "Ready");
  for (const status of ["failed", "incomplete", "cancelled"]) {
    const f = fixture(); f.deps.retrieveResponse = async () => ({ id: "response-1", status });
    await f.advance(); assert.equal(f.current()?.status, "failed");
    const summary = fixture({ phase: "summarizing" }); summary.deps.retrieveResponse = f.deps.retrieveResponse;
    await summary.advance(); assert.equal(summary.events.at(-1)?.type, "summary"); assert.equal(summary.current()?.phase, "planning");
  }
  const summary = fixture({ phase: "summarizing" }); await summary.advance(); assert.equal(summary.events.at(-1)?.type, "summary");
  for (const bad of [response([], "different-response"), { id: "response-1", status: "invalid" }, response([])]) {
    const f = fixture(); f.deps.retrieveResponse = async () => bad;
    await f.advance(); assert.equal(f.current()?.status, "failed");
  }
});
test("late responses and retrieval failures cannot claim a newer model round", async () => {
  for (const mode of ["ready", "malformed", "missing"]) {
    const f = fixture();
    f.deps.retrieveResponse = async () => {
      f.set({ ...f.current()!, openAIResponseId: "response-2", roundCount: 2 });
      if (mode === "missing") throw requestFailure(400, 404);
      return mode === "malformed" ? { id: "wrong", status: "completed" } : response([tool()]);
    };
    await f.advance(); assert.equal(f.current()?.openAIResponseId, "response-2"); assert.equal(f.events.length, 0);
  }
  const held = fixture({ status: "processing" }); await held.advance(); assert.equal(held.events.length, 0);
  const vanished = fixture(); vanished.deps.retrieveResponse = async () => { vanished.set(null); return { id: "response-1", status: "queued" }; };
  assert.equal((await vanished.advance()).kind, "state");
});
test("request failures preserve pending progress and release only the acquired lease", async () => {
  for (const status of [400, 429, 502]) {
    const f = fixture(); f.deps.retrieveResponse = async () => { throw requestFailure(status); };
    assert.equal((await f.advance()).kind, "unavailable"); assert.equal(f.current()?.status, "in_progress");
  }
  const lost = fixture(); lost.deps.retrieveResponse = async () => { throw requestFailure(400, 404); };
  await lost.advance(); assert.equal(lost.current()?.errorCode, "coach_response_lost");
  const broken = fixture(); broken.deps.retrieveResponse = async () => { throw new Error("bad JSON"); };
  await broken.advance(); assert.equal(broken.current()?.status, "failed");
  for (const status of [400, 429]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool()]);
    f.deps.createContinuation = async () => { throw requestFailure(status); };
    const result = await f.advance(); assert.equal(result.kind, status === 429 ? "unavailable" : "state");
    assert.equal(f.current()?.status, status === 429 ? "in_progress" : "failed");
    if (status === 429) assert.match(f.current()!.pendingInputJson, /function_call_output/);
  }
  const release = fixture({ phase: "summarizing" }); release.deps.processSummaryResponse = async () => { throw requestFailure(502); };
  release.deps.store.releaseProcessing = async () => { throw new Error("database busy"); };
  assert.equal((await release.advance()).kind, "unavailable"); assert.equal(release.events.at(-1)?.type, "audit-error");
});
test("tools receive trusted identity and persist output before continuation", async () => {
  const f = fixture(); f.deps.retrieveResponse = async () => response([tool("get_routine", "call-1", '{"routineId":"A"}')]);
  await f.advance(); assert.equal(f.events.filter((event) => event.type === "execute").length, 1);
  assert.deepEqual((f.events.find((event) => event.type === "execute")!.value as { identity: unknown }).identity,
    { ownerEmail: "owner@example.com", runId: "run-1", callId: "call-1", leaseToken: "lease-1" });
  assert.equal(f.calls.get("call-1")?.status, "succeeded"); assert.equal(f.current()?.openAIResponseId, "response-2"); assert.equal(f.current()?.pendingInputJson, "[]");
  const pending = fixture({ pendingInputJson: '[{"type":"function_call_output","call_id":"saved","output":"{}"}]' });
  await pending.advance(); assert.equal(pending.events.filter((event) => event.type === "execute").length, 0); assert.equal(pending.events[0]?.type, "continue");
});
test("reclaimed proposals recover the committed reservation without repeating writes", async () => {
  const f = fixture(); f.deps.retrieveResponse = async () => response([tool("propose_routine_change")]);
  f.calls.set("call-1", ledger("propose_routine_change", "processing", '{"planId":"plan-1","status":"ready_for_review"}'));
  f.deps.executeTool = async () => { throw new Error("must not stage again"); };
  await f.advance(); assert.equal(f.current()?.status, "succeeded"); assert.equal(f.calls.get("call-1")?.status, "succeeded"); assert.match(String(f.events.at(-1)?.value), /review/i);
  const corrupt = fixture(); corrupt.deps.retrieveResponse = f.deps.retrieveResponse;
  corrupt.calls.set("call-1", ledger("propose_routine_change", "processing", "{"));
  await corrupt.advance(); assert.equal(corrupt.current()?.status, "failed");
});
test("completed results and cached reads avoid repeat execution while active workouts stay fresh", async () => {
  for (const outputJson of ['{"value":2}', null, "{"]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool()]); f.calls.set("call-1", ledger("get_routine", "succeeded", outputJson));
    await f.advance(); assert.equal(f.events.filter((event) => event.type === "execute").length, 0); assert.equal(f.events.at(-1)?.type, "continue");
  }
  const cache = fixture(); cache.deps.retrieveResponse = async () => response([tool("get_routine", "new-call")]);
  cache.calls.set("old-call", ledger("get_routine", "succeeded", '{"value":42}', "old-call"));
  await cache.advance(); assert.equal(cache.events.filter((event) => event.type === "execute").length, 0); assert.equal(cache.calls.get("new-call")?.outputJson, '{"value":42}');
  const fresh = fixture(); fresh.deps.retrieveResponse = async () => response([tool("get_active_workout", "new-call")]);
  fresh.calls.set("old-call", ledger("get_active_workout", "succeeded", '{"stale":true}', "old-call"));
  await fresh.advance(); assert.equal(fresh.events.filter((event) => event.type === "execute").length, 1);
  const invalidActivity = fixture(); invalidActivity.deps.retrieveResponse = async () => response([tool()]);
  invalidActivity.calls.set("call-1", { ...ledger("get_routine", "succeeded", "{}"), activityJson: "{}" });
  await invalidActivity.advance(); assert.equal(invalidActivity.current()?.status, "failed");
  const noActivity = fixture(); noActivity.deps.retrieveResponse = async () => response([tool()]);
  noActivity.calls.set("call-1", { ...ledger("get_routine", "failed", "{}"), activityJson: null });
  await noActivity.advance(); assert.equal(noActivity.events.at(-1)?.type, "continue");
});
test("proposal completion recovers saved activity and emits batch counts", async () => {
  for (const state of ["new", "replayed", "staged", "staged-no-call"] as const) {
    const f = fixture({ proposalStaged: state.startsWith("staged"), activitiesJson: state.startsWith("staged") ? JSON.stringify([activity("propose_routine_change")]) : "[]" });
    f.deps.retrieveResponse = async () => response(state === "staged-no-call" ? [] : [tool("propose_routine_change")]);
    f.deps.executeTool = async () => ({ planId: "plan-1", status: "ready_for_review" });
    if (state === "replayed" || state === "staged") f.calls.set("call-1", ledger("propose_routine_change", "succeeded", '{"planId":"plan-1"}'));
    await f.advance(); assert.equal(f.current()?.status, "succeeded"); assert.equal(f.events.filter((event) => event.type === "continue").length, 0);
  }
  const missingActivity = fixture({ proposalStaged: true, activitiesJson: JSON.stringify([activity(), { ...activity("propose_routine_change"), status: "failed" }]) });
  await missingActivity.advance(); assert.equal(missingActivity.events.at(-1)?.value, "Ready");
  const extra = fixture(); extra.deps.retrieveResponse = async () => response([tool("propose_routine_change"), tool("get_active_workout", "extra")]);
  extra.deps.executeTool = async () => ({ planId: "plan-1" });
  await extra.advance(); assert.equal(extra.calls.get("extra")?.status, "failed"); assert.equal(extra.current()?.status, "succeeded");
  const batch = fixture(); batch.deps.retrieveResponse = async () => response([tool("propose_routine_changes")]);
  batch.deps.executeTool = async () => ({ plans: [{ planId: "one" }, { planId: "two" }] });
  await batch.advance(); assert.match(String(batch.events.at(-1)?.value), /2/);
});
test("invalid calls, failed checks, and execution budgets leave bounded usable progress", async () => {
  for (const badArguments of ["[]", "null", "{"]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool("get_routine", "call-1", badArguments)]);
    await f.advance(); assert.equal(f.calls.get("call-1")?.status, "failed"); assert.equal(f.events.filter((event) => event.type === "execute").length, 0);
  }
  const badCall = fixture(); badCall.deps.retrieveResponse = async () => response([{ type: "function_call", name: "get_routine" }]);
  await badCall.advance(); assert.equal(badCall.current()?.status, "failed");
  for (const overrides of [{ callSignaturesJson: '{"get_routine:{}":2}' }, { toolCallCount: 12 }, { forceFinal: true }]) {
    const f = fixture(overrides); f.deps.retrieveResponse = async () => response([tool()]);
    await f.advance(); assert.equal(f.events.filter((event) => event.type === "execute").length, 0); assert.equal(f.current()?.forceFinal, true);
  }
  const repeatedProposal = fixture({ callSignaturesJson: '{"propose_routine_change:{}":1}' });
  repeatedProposal.deps.retrieveResponse = async () => response([tool("propose_routine_change")]);
  await repeatedProposal.advance(); assert.equal(repeatedProposal.current()?.forceFinal, true);
  const eighth = fixture({ roundCount: 8 }); eighth.deps.retrieveResponse = async () => response([tool()]);
  await eighth.advance(); assert.equal(eighth.current()?.forceFinal, true); assert.equal(eighth.current()?.phase, "synthesizing");
  for (const error of [new Error("lookup unavailable"), "plain failure"]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool()]); f.deps.executeTool = async () => { throw error; };
    await f.advance(); assert.equal(f.calls.get("call-1")?.status, "failed");
  }
});
test("recovery preserves final synthesis after the ledger saved a budget or repeat stop", async () => {
  for (const overrides of [{ roundCount: 8 }, { toolCallCount: 12 }, { callSignaturesJson: '{"get_routine:{}":3}' }]) {
    const f = fixture(overrides); f.deps.retrieveResponse = async () => response([tool()]);
    f.calls.set("call-1", ledger("get_routine", "failed", '{"error":"finish"}'));
    await f.advance(); assert.equal(f.current()?.forceFinal, true); assert.equal(f.events.filter((event) => event.type === "execute").length, 0);
  }
});
test("lost processing rights stop work and orphan continuations are cleaned up", async () => {
  const rejected = fixture(); rejected.deps.retrieveResponse = async () => response([tool()]); rejected.deps.store.beginCall = async () => ({ kind: "rejected", call: null });
  await rejected.advance(); assert.equal(rejected.events.length, 0);
  const conflict = fixture(); conflict.deps.retrieveResponse = rejected.deps.retrieveResponse;
  conflict.deps.store.beginCall = async () => ({ kind: "conflict", call: ledger("get_routine", "processing", null) });
  await conflict.advance(); assert.equal(conflict.current()?.status, "failed");
  for (const stage of ["finish", "update"] as const) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool()]);
    if (stage === "finish") f.deps.store.finishCall = async () => false; else f.deps.store.updateProcessing = async () => false;
    await f.advance(); assert.equal(f.events.filter((event) => event.type === "continue").length, 0);
  }
  for (const outcome of ["deleted", "delete-failed", "already-attached"]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool()]);
    f.deps.store.attachResponse = async () => { if (outcome === "already-attached") f.set({ ...f.current()!, openAIResponseId: "response-2" }); return false; };
    if (outcome === "delete-failed") f.deps.deleteResponse = async () => { throw new Error("cleanup unavailable"); };
    await f.advance(); assert.equal(f.events.filter((event) => event.type === "delete").length, outcome === "deleted" ? 1 : 0);
    if (outcome === "delete-failed") assert.equal(f.events.at(-1)?.type, "audit-error");
  }
  const audit = fixture(); audit.deps.retrieveResponse = async () => response([tool()]); audit.deps.recordToolCall = async () => { throw new Error("audit unavailable"); };
  await audit.advance(); assert.equal(audit.current()?.openAIResponseId, "response-2"); assert.equal(audit.events.some((event) => event.type === "audit-error"), true);
  for (const next of [{ id: "", status: "queued" }, { id: "response-2", status: "invalid" }, response([], "response-2")]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool()]); f.deps.createContinuation = async () => next;
    await f.advance(); assert.equal(f.current()?.status, next.status === "completed" ? "in_progress" : "failed");
  }
});
test("oversized reads fail visibly while committed proposal identities survive projection", async () => {
  for (const value of [{ large: "x".repeat(30_001) }, undefined]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool()]); f.deps.executeTool = async () => value;
    await f.advance(); assert.equal(f.calls.get("call-1")?.status, "failed"); assert.match(f.calls.get("call-1")!.outputJson!, /result_too_large/);
    assert.equal(JSON.parse(f.current()!.activitiesJson)[0].status, "failed");
  }
  for (const value of [null, 1, "text", [], {}, { error: 7 }, { error: "returned error" }]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool()]); f.deps.executeTool = async () => value;
    await f.advance(); assert.equal(f.calls.get("call-1")?.status, value && typeof value === "object" && "error" in value && typeof value.error === "string" ? "failed" : "succeeded");
  }
  for (const value of [
    { planId: "single", summary: "Keep this", diff: "x".repeat(40_000) },
    { plans: [{ planId: "one" }, { planId: "two", summary: "Other" }], diff: "x".repeat(40_000) },
    { plans: [null, 7, [], {}, { planId: "kept", summary: null }], diff: "x".repeat(40_000) },
  ]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool("propose_routine_changes")]); f.deps.executeTool = async () => value;
    await f.advance(); assert.equal(f.current()?.status, "succeeded"); assert.equal(f.calls.get("call-1")?.status, "succeeded");
    assert.ok(f.calls.get("call-1")!.outputJson!.length < 30_000); assert.match(f.calls.get("call-1")!.outputJson!, /planId/);
  }
  for (const value of [{ diff: "x".repeat(40_000) }, "x".repeat(40_000), ["x".repeat(40_000)]]) {
    const f = fixture(); f.deps.retrieveResponse = async () => response([tool("propose_routine_change")]); f.deps.executeTool = async () => value;
    await f.advance(); assert.equal(f.calls.get("call-1")?.status, "failed");
  }
});
test("persisted state parsing tolerates invalid historical data without inventing activities", async () => {
  for (const value of ["{", "{}", "null", "7"]) assert.deepEqual(parseStoredRunActivities(value), []);
  const valid = activity();
  const malformed = [null, [], 1, {}, { ...valid, id: 1 }, { ...valid, name: 1 }, { ...valid, label: 1 }, { ...valid, purpose: 7 }, { ...valid, status: "running" }];
  assert.deepEqual(parseStoredRunActivities(JSON.stringify([...malformed, valid, { ...valid, purpose: "Useful", status: "failed" }])), [valid, { ...valid, purpose: "Useful", status: "failed" }]);
  for (const value of ["{", "null", "7", "[]", '{"bad":-1,"notInteger":1.5,"valid":0}']) {
    const f = fixture({ callSignaturesJson: value, pendingInputJson: value, responseIdsJson: value }); f.deps.retrieveResponse = async () => response([tool()]);
    await f.advance(); assert.equal(f.current()?.openAIResponseId, "response-2");
  }
  const ids = fixture({ responseIdsJson: '["response-1",7,"response-2"]' }); ids.deps.retrieveResponse = async () => response([tool()]);
  await ids.advance(); assert.equal(ids.current()?.responseIdsJson, '["response-1","response-2"]');
});

test("continuation retains summary and every prior response for terminal cleanup", async () => {
  const ids = ["summary", ...Array.from({ length: 8 }, (_, i) => "prior-" + i)];
  const f = fixture({ responseIdsJson: JSON.stringify(ids) });
  f.deps.retrieveResponse = async () => response([tool()]);
  await f.advance();
  assert.deepEqual(JSON.parse(f.current()!.responseIdsJson), [...ids, "response-2"]);
});
