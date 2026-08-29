import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCoachRunActivity,
  coachCallRepeatLimit,
  coachCallSignature,
  coachMessageRunAwaitsResponseAttachment,
  coachMessageRunExpiresAt,
  coachMessageRunIsExpired,
  coachMessageRunLeaseExpiresAt,
  coachMessageRunTerminalRetainedUntil,
  coachProposalCompletionText,
  coachResponseText,
  coachResponseToolCalls,
  coachRunActivity,
  coachRunPhaseForActivities,
  coachRunShouldForceFinal,
  fingerprintCoachMessageRequest,
  incrementCoachCallSignature,
  isCoachProposalTool,
  mapCoachMessageRunRemoteResponse,
  normalizeCoachMessageIdempotencyKey,
  COACH_MESSAGE_RUN_LIFETIME_MS,
  COACH_MESSAGE_RUN_MAX_ACTIVITIES,
  COACH_MESSAGE_RUN_MAX_MODEL_ROUNDS,
  COACH_MESSAGE_RUN_MAX_TOOL_CALLS,
  COACH_MESSAGE_RUN_POLL_AFTER_MS,
  COACH_MESSAGE_RUN_PROCESSING_LEASE_MS,
  COACH_MESSAGE_RUN_START_RECONCILIATION_MS,
  COACH_MESSAGE_RUN_TERMINAL_RETENTION_MS,
} from "../src/server/coach/message-run";

test("Coach message run timing constants and boundaries are bounded", () => {
  assert.equal(COACH_MESSAGE_RUN_POLL_AFTER_MS, 1_500);
  assert.equal(COACH_MESSAGE_RUN_LIFETIME_MS, 10 * 60_000);
  assert.equal(COACH_MESSAGE_RUN_TERMINAL_RETENTION_MS, 24 * 60 * 60_000);
  assert.equal(COACH_MESSAGE_RUN_START_RECONCILIATION_MS, 20_000);
  assert.equal(COACH_MESSAGE_RUN_PROCESSING_LEASE_MS, 45_000);
  assert.equal(COACH_MESSAGE_RUN_MAX_MODEL_ROUNDS, 8);
  assert.equal(COACH_MESSAGE_RUN_MAX_TOOL_CALLS, 12);
  assert.equal(COACH_MESSAGE_RUN_MAX_ACTIVITIES, 12);

  const now = "2026-08-29T12:00:00.000Z";
  assert.equal(coachMessageRunExpiresAt(now), "2026-08-29T12:10:00.000Z");
  assert.equal(coachMessageRunTerminalRetainedUntil(now), "2026-08-30T12:00:00.000Z");
  assert.equal(coachMessageRunLeaseExpiresAt(now), "2026-08-29T12:00:45.000Z");
  const expiresAt = coachMessageRunExpiresAt(now);
  assert.equal(coachMessageRunIsExpired(expiresAt, Date.parse(expiresAt) - 1), false);
  assert.equal(coachMessageRunIsExpired(expiresAt, Date.parse(expiresAt)), true);
  assert.equal(
    coachMessageRunAwaitsResponseAttachment(now, Date.parse(now) + 19_999),
    true,
  );
  assert.equal(
    coachMessageRunAwaitsResponseAttachment(now, Date.parse(now) + 20_000),
    false,
  );

  assert.throws(() => coachMessageRunExpiresAt("invalid"), /creation time is invalid/i);
  assert.throws(() => coachMessageRunTerminalRetainedUntil("invalid"), /terminal time is invalid/i);
  assert.throws(() => coachMessageRunLeaseExpiresAt("invalid"), /claim time is invalid/i);
  assert.throws(() => coachMessageRunIsExpired("invalid", Date.parse(now)), /expiry time is invalid/i);
  assert.throws(() => coachMessageRunIsExpired(expiresAt, Number.NaN), /current time is invalid/i);
  assert.throws(() => coachMessageRunAwaitsResponseAttachment("invalid"), /update time is invalid/i);
  assert.throws(
    () => coachMessageRunAwaitsResponseAttachment(now, Number.NaN),
    /current time is invalid/i,
  );
});

test("Coach message idempotency keys and fingerprints are strict and canonical", async () => {
  assert.equal(normalizeCoachMessageIdempotencyKey("  coach-123  "), "coach-123");
  assert.equal(normalizeCoachMessageIdempotencyKey("x".repeat(128)), "x".repeat(128));
  assert.throws(() => normalizeCoachMessageIdempotencyKey(null), /required/i);
  assert.throws(() => normalizeCoachMessageIdempotencyKey("   "), /required/i);
  assert.throws(() => normalizeCoachMessageIdempotencyKey("short"), /at least 8/i);
  assert.throws(() => normalizeCoachMessageIdempotencyKey("x".repeat(129)), /cannot exceed/i);

  const shared = { okay: true };
  const first = { z: [null, "rear delt", false, 2], a: { b: shared, a: 1 }, shared };
  const second = {
    shared: { okay: true },
    a: { a: 1, b: { okay: true } },
    z: [null, "rear delt", false, 2],
  };
  const digest = await fingerprintCoachMessageRequest(first);
  assert.equal(digest, await fingerprintCoachMessageRequest(second));
  assert.match(digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(digest.includes("rear delt"), false);
  const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { b: 2, a: 1 });
  assert.equal(
    await fingerprintCoachMessageRequest(nullPrototype),
    await fingerprintCoachMessageRequest({ a: 1, b: 2 }),
  );
  assert.equal(new Set(await Promise.all([
    fingerprintCoachMessageRequest(true),
    fingerprintCoachMessageRequest("message"),
    fingerprintCoachMessageRequest(null),
  ])).size, 3);
  await assert.rejects(fingerprintCoachMessageRequest(Number.NaN), /finite numbers/i);
  await assert.rejects(fingerprintCoachMessageRequest(undefined), /JSON-serializable/i);
  await assert.rejects(fingerprintCoachMessageRequest(() => undefined), /JSON-serializable/i);
  await assert.rejects(fingerprintCoachMessageRequest(new Date()), /plain JSON objects/i);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(fingerprintCoachMessageRequest(circular), /circular references/i);
});

test("Coach remote responses distinguish pending, ready, and safe failures", () => {
  assert.deepEqual(
    mapCoachMessageRunRemoteResponse({ id: "r1", status: "queued" }),
    { kind: "pending", status: "queued" },
  );
  assert.deepEqual(
    mapCoachMessageRunRemoteResponse({ id: "r1", status: "in_progress" }),
    { kind: "pending", status: "in_progress" },
  );
  const completed = { id: "r1", status: "completed", output: [] };
  assert.deepEqual(mapCoachMessageRunRemoteResponse(completed), {
    kind: "ready",
    response: completed,
  });
  assert.deepEqual(
    mapCoachMessageRunRemoteResponse({
      id: "r1",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    }),
    {
      kind: "failed",
      code: "coach_response_incomplete",
      message: "Coach ran out of response capacity before finishing. Try again or choose a lower reasoning effort.",
      retryable: true,
    },
  );
  const incomplete = mapCoachMessageRunRemoteResponse({ id: "r1", status: "incomplete" });
  assert.equal(incomplete.kind, "failed");
  if (incomplete.kind === "failed") assert.match(incomplete.message, /could not finish/i);
  assert.deepEqual(mapCoachMessageRunRemoteResponse({ id: "r1", status: "failed" }), {
    kind: "failed",
    code: "coach_response_failed",
    message: "Coach’s model request failed. Your request is saved and no routine changes were made.",
    retryable: true,
  });
  assert.deepEqual(mapCoachMessageRunRemoteResponse({ id: "r1", status: "cancelled" }), {
    kind: "failed",
    code: "coach_response_cancelled",
    message: "Coach’s response was cancelled before it finished. Your request is saved.",
    retryable: true,
  });
  assert.throws(() => mapCoachMessageRunRemoteResponse(null), /must be an object/i);
  assert.throws(() => mapCoachMessageRunRemoteResponse([]), /must be an object/i);
  assert.throws(() => mapCoachMessageRunRemoteResponse({ status: "completed" }), /no ID/i);
  assert.throws(
    () => mapCoachMessageRunRemoteResponse({ id: "r1", status: "unknown" }),
    /unsupported.*unknown/i,
  );
});

test("Coach response parsing preserves safe tool inputs and visible text", () => {
  const response = {
    id: "r1",
    status: "completed",
    output: [
      { type: "message", content: [{ type: "output_text", text: "First" }, { type: "other", text: "hidden" }] },
      { type: "message", content: [{ type: "output_text", text: "Second" }] },
      { type: "function_call", call_id: "call-1", name: "get_routine", arguments: "{\"routineId\":\"C\"}" },
      { type: "function_call", call_id: "call-2", name: "search_exercises", arguments: "[1]" },
      { type: "function_call", call_id: "call-3", name: "search_exercises", arguments: "{" },
    ],
  };
  assert.equal(coachResponseText(response), "First\nSecond");
  assert.equal(coachResponseText({ id: "empty", output: [] }), "");
  assert.deepEqual(coachResponseToolCalls({ id: "missing-output" }), []);
  assert.equal(coachResponseText({ id: "missing-output" }), "");
  assert.equal(coachResponseText({
    id: "missing-content",
    output: [
      { type: "message" },
      { type: "message", content: [{ type: "output_text" }] },
    ],
  }), "");
  const calls = coachResponseToolCalls(response);
  assert.deepEqual(calls[0], {
    callId: "call-1",
    name: "get_routine",
    argumentsValue: { routineId: "C" },
    parseError: null,
  });
  assert.match(calls[1]!.parseError!, /JSON object/i);
  assert.match(calls[2]!.parseError!, /JSON/i);
  assert.equal(coachCallSignature(calls[0]!), 'get_routine:{"routineId":"C"}');
  assert.equal(coachCallSignature(calls[1]!), "search_exercises:invalid");
  assert.deepEqual(coachResponseToolCalls({
    id: "default-arguments",
    output: [{ type: "function_call", call_id: " call ", name: " tool " }],
  }), [{
    callId: "call",
    name: "tool",
    argumentsValue: {},
    parseError: null,
  }]);
  assert.throws(
    () => coachResponseToolCalls({
      id: "bad",
      output: [{ type: "function_call", call_id: "", name: "tool", arguments: "{}" }],
    }),
    /invalid tool call/i,
  );
  assert.throws(
    () => coachResponseToolCalls({
      id: "bad",
      output: [{ type: "function_call", call_id: "call", name: "", arguments: "{}" }],
    }),
    /invalid tool call/i,
  );
  assert.throws(
    () => coachResponseToolCalls({
      id: "bad",
      output: [{ type: "function_call", call_id: 1 as never, name: "tool", arguments: "{}" }],
    }),
    /invalid tool call/i,
  );
  assert.throws(
    () => coachResponseToolCalls({
      id: "bad",
      output: [{ type: "function_call", call_id: "call", name: 1 as never, arguments: "{}" }],
    }),
    /invalid tool call/i,
  );
  const argumentsFailure = {
    type: "function_call",
    call_id: "call",
    name: "tool",
  } as Record<string, unknown>;
  Object.defineProperty(argumentsFailure, "arguments", {
    get() {
      throw "unreadable arguments";
    },
  });
  assert.deepEqual(coachResponseToolCalls({
    id: "non-error-parse-failure",
    output: [argumentsFailure],
  }), [{
    callId: "call",
    name: "tool",
    argumentsValue: {},
    parseError: "Tool arguments were invalid.",
  }]);
});

test("Coach loop guards and proposal completion survive persisted rounds", () => {
  const first = incrementCoachCallSignature({}, "search:{}");
  assert.deepEqual(first, { counts: { "search:{}": 1 }, count: 1 });
  const second = incrementCoachCallSignature({ "search:{}": 1.9, bad: -4 }, "search:{}");
  assert.deepEqual(second, { counts: { "search:{}": 2, bad: -4 }, count: 2 });
  assert.equal(coachCallRepeatLimit("get_routine"), 3);
  assert.equal(coachCallRepeatLimit("propose_routine_change"), 2);
  for (const name of ["propose_new_routine", "propose_routine_change", "propose_exercise_change"]) {
    assert.equal(isCoachProposalTool(name), true);
    assert.match(coachProposalCompletionText(name)!, /review/i);
  }
  assert.equal(isCoachProposalTool("get_routine"), false);
  assert.equal(coachProposalCompletionText("get_routine"), null);
  assert.equal(coachRunShouldForceFinal(7, 11), false);
  assert.equal(coachRunShouldForceFinal(8, 0), true);
  assert.equal(coachRunShouldForceFinal(0, 12), true);
});

test("Coach activities are allowlisted, bounded, and drive truthful phases", () => {
  const names = [
    "get_coaching_context",
    "get_routine",
    "list_routine_versions",
    "search_exercises",
    "get_exercise",
    "get_workout_history",
    "get_active_workout",
    "propose_new_routine",
    "propose_routine_change",
    "propose_exercise_change",
    "unknown_tool",
  ];
  for (const [index, name] of names.entries()) {
    const success = coachRunActivity(index + 1, name, "succeeded");
    const failure = coachRunActivity(index + 1, name, "failed");
    assert.equal(success.id, `step-${index + 1}`);
    assert.equal(success.status, "succeeded");
    assert.equal(failure.status, "failed");
    assert.ok(success.label.length > 0);
    assert.ok(failure.label.length > 0);
  }
  assert.equal(coachRunActivity(-1, "unknown", "succeeded").id, "step-1");

  let activities = Array.from({ length: 12 }, (_, index) => (
    coachRunActivity(index + 1, "get_routine", "succeeded")
  ));
  activities = appendCoachRunActivity(
    activities,
    { ...coachRunActivity(12, "search_exercises", "failed"), label: "Replacement" },
  );
  assert.equal(activities.length, 12);
  assert.equal(activities.at(-1)?.label, "Replacement");
  activities = appendCoachRunActivity(activities, coachRunActivity(13, "get_active_workout", "succeeded"));
  assert.equal(activities.length, COACH_MESSAGE_RUN_MAX_ACTIVITIES);
  assert.equal(activities[0]?.id, "step-2");

  assert.equal(coachRunPhaseForActivities([], false, false), "checking");
  assert.equal(coachRunPhaseForActivities([], true, false), "synthesizing");
  assert.equal(coachRunPhaseForActivities([], true, true), "review_ready");
  assert.equal(
    coachRunPhaseForActivities([coachRunActivity(1, "get_routine", "failed")], false, false),
    "recovering",
  );
  assert.equal(
    coachRunPhaseForActivities([coachRunActivity(1, "get_routine", "succeeded")], false, false),
    "checking",
  );
});
