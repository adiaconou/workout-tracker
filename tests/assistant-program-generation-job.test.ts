import assert from "node:assert/strict";
import test from "node:test";
import {
  extractProgramGenerationRemoteError,
  fingerprintProgramGenerationRequest,
  mapProgramGenerationRemoteResponse,
  normalizeProgramGenerationIdempotencyKey,
  parseProgramGenerationRemoteStatus,
  PROGRAM_GENERATION_LIFETIME_MS,
  PROGRAM_GENERATION_POLL_AFTER_MS,
  PROGRAM_GENERATION_START_RECONCILIATION_MS,
  PROGRAM_GENERATION_TERMINAL_RETENTION_MS,
  PROGRAM_GENERATION_VALIDATION_LEASE_MS,
  programGenerationAwaitsResponseAttachment,
  programGenerationExpiresAt,
  programGenerationIsExpired,
  programGenerationTerminalRetainedUntil,
  programGenerationValidationLeaseStaleBefore,
  selectProgramGenerationReasoningEffort,
} from "../src/server/coach/program-generation-job";

test("program generation timing constants and expiry helpers have exact boundaries", () => {
  assert.equal(PROGRAM_GENERATION_POLL_AFTER_MS, 2_000);
  assert.equal(PROGRAM_GENERATION_LIFETIME_MS, 10 * 60_000);
  assert.equal(PROGRAM_GENERATION_TERMINAL_RETENTION_MS, 24 * 60 * 60_000);
  assert.equal(PROGRAM_GENERATION_START_RECONCILIATION_MS, 20_000);
  assert.equal(PROGRAM_GENERATION_VALIDATION_LEASE_MS, 60_000);

  const createdAt = "2026-08-09T10:00:00.000Z";
  const expiresAt = "2026-08-09T10:10:00.000Z";
  assert.equal(programGenerationExpiresAt(createdAt), expiresAt);
  assert.equal(
    programGenerationTerminalRetainedUntil(createdAt),
    "2026-08-10T10:00:00.000Z",
  );
  assert.equal(programGenerationIsExpired(expiresAt, Date.parse(expiresAt) - 1), false);
  assert.equal(programGenerationIsExpired(expiresAt, Date.parse(expiresAt)), true);
  assert.equal(programGenerationIsExpired(expiresAt, Date.parse(expiresAt) + 1), true);

  assert.throws(() => programGenerationExpiresAt("not-a-date"), /creation time is invalid/i);
  assert.throws(
    () => programGenerationTerminalRetainedUntil("not-a-date"),
    /terminal time is invalid/i,
  );
  assert.throws(
    () => programGenerationIsExpired("not-a-date", Date.parse(createdAt)),
    /expiry time is invalid/i,
  );
  assert.throws(() => programGenerationIsExpired(expiresAt, Number.NaN), /current time is invalid/i);

  const updatedAt = "2026-08-09T10:00:00.000Z";
  assert.equal(
    programGenerationAwaitsResponseAttachment(updatedAt, Date.parse(updatedAt) + 19_999),
    true,
  );
  assert.equal(
    programGenerationAwaitsResponseAttachment(updatedAt, Date.parse(updatedAt) + 20_000),
    false,
  );
  assert.equal(
    programGenerationValidationLeaseStaleBefore("2026-08-09T10:01:00.000Z"),
    updatedAt,
  );
  assert.throws(
    () => programGenerationAwaitsResponseAttachment("not-a-date"),
    /update time is invalid/i,
  );
  assert.throws(
    () => programGenerationAwaitsResponseAttachment(updatedAt, Number.NaN),
    /current time is invalid/i,
  );
  assert.throws(
    () => programGenerationValidationLeaseStaleBefore("not-a-date"),
    /validation claim time is invalid/i,
  );
});

test("program generation idempotency keys are trimmed but never truncated", () => {
  assert.equal(normalizeProgramGenerationIdempotencyKey("  generate-1  "), "generate-1");
  assert.equal(normalizeProgramGenerationIdempotencyKey("12345678"), "12345678");
  assert.equal(normalizeProgramGenerationIdempotencyKey("x".repeat(128)), "x".repeat(128));
  assert.throws(
    () => normalizeProgramGenerationIdempotencyKey(undefined),
    /idempotency key is required/i,
  );
  assert.throws(
    () => normalizeProgramGenerationIdempotencyKey("   "),
    /idempotency key is required/i,
  );
  assert.throws(
    () => normalizeProgramGenerationIdempotencyKey("1234567"),
    /at least 8 characters/i,
  );
  assert.throws(
    () => normalizeProgramGenerationIdempotencyKey("x".repeat(129)),
    /cannot exceed 128 characters/i,
  );
});

test("program generation fingerprints are canonical SHA-256 digests", async () => {
  const shared = { enabled: true };
  const first = {
    z: [null, "goal", false, 3],
    a: { second: shared, first: 1 },
    repeated: shared,
  };
  const second = {
    repeated: { enabled: true },
    a: { first: 1, second: { enabled: true } },
    z: [null, "goal", false, 3],
  };
  const fingerprint = await fingerprintProgramGenerationRequest(first);
  assert.equal(fingerprint, await fingerprintProgramGenerationRequest(second));
  assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(fingerprint.includes("goal"), false);

  const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { b: 2, a: 1 });
  assert.equal(
    await fingerprintProgramGenerationRequest(nullPrototype),
    await fingerprintProgramGenerationRequest({ a: 1, b: 2 }),
  );
  const primitiveFingerprints = await Promise.all([
    fingerprintProgramGenerationRequest(true),
    fingerprintProgramGenerationRequest("goal"),
    fingerprintProgramGenerationRequest(null),
  ]);
  assert.equal(new Set(primitiveFingerprints).size, 3);

  await assert.rejects(
    fingerprintProgramGenerationRequest(Number.POSITIVE_INFINITY),
    /finite numbers/i,
  );
  await assert.rejects(fingerprintProgramGenerationRequest(undefined), /JSON-serializable/i);
  await assert.rejects(fingerprintProgramGenerationRequest(() => undefined), /JSON-serializable/i);
  await assert.rejects(fingerprintProgramGenerationRequest(new Date()), /plain JSON objects/i);

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(fingerprintProgramGenerationRequest(circular), /circular references/i);
});

test("program generation chooses the lowest dedicated reasoning effort it supports", () => {
  assert.equal(selectProgramGenerationReasoningEffort(["auto", "none", "low"]), "low");
  assert.equal(selectProgramGenerationReasoningEffort(["auto", "minimal", "none"]), "none");
  assert.equal(selectProgramGenerationReasoningEffort(["auto", "minimal"]), "minimal");
  assert.equal(selectProgramGenerationReasoningEffort(["auto"]), "auto");
  assert.throws(
    () => selectProgramGenerationReasoningEffort(["medium", "high"]),
    /requires low, none, minimal, or auto/i,
  );
});

test("program generation remote statuses are parsed and mapped to orchestration results", () => {
  const expected = {
    queued: { kind: "pending", status: "queued" },
    in_progress: { kind: "pending", status: "in_progress" },
    completed: { kind: "ready", status: "completed" },
    failed: {
      kind: "failed",
      status: "failed",
      error: "The model failed to generate the routine program.",
    },
    incomplete: {
      kind: "failed",
      status: "incomplete",
      error: "The model returned an incomplete routine program.",
    },
    cancelled: { kind: "cancelled", status: "cancelled" },
  } as const;

  for (const [status, result] of Object.entries(expected)) {
    assert.equal(parseProgramGenerationRemoteStatus(status), status);
    assert.deepEqual(mapProgramGenerationRemoteResponse({ status }), result);
  }

  assert.throws(() => parseProgramGenerationRemoteStatus(null), /unsupported.*null/i);
  assert.throws(() => parseProgramGenerationRemoteStatus("unknown"), /unsupported.*unknown/i);
  assert.throws(() => mapProgramGenerationRemoteResponse(null), /must be an object/i);
  assert.throws(() => mapProgramGenerationRemoteResponse(3), /must be an object/i);
  assert.throws(() => mapProgramGenerationRemoteResponse([]), /must be an object/i);
});

test("program generation remote errors preserve explicit detail and explain incomplete output", () => {
  assert.equal(
    extractProgramGenerationRemoteError({
      status: "failed",
      error: { message: "  Upstream safety failure  " },
    }),
    "Upstream safety failure",
  );
  assert.equal(
    extractProgramGenerationRemoteError({
      status: "incomplete",
      error: { message: " " },
      incomplete_details: { reason: "max_output_tokens" },
    }),
    "The model ran out of response capacity before completing the routine program.",
  );
  assert.equal(
    extractProgramGenerationRemoteError({
      status: "incomplete",
      error: { message: 42 },
      incomplete_details: { reason: "  content_filter  " },
    }),
    "The model returned an incomplete routine program (content_filter).",
  );
  assert.equal(
    extractProgramGenerationRemoteError({
      status: "incomplete",
      error: "invalid",
      incomplete_details: { reason: " " },
    }),
    "The model returned an incomplete routine program.",
  );
  assert.equal(
    extractProgramGenerationRemoteError({
      status: "incomplete",
      error: [],
      incomplete_details: { reason: 2 },
    }),
    "The model returned an incomplete routine program.",
  );
  assert.equal(
    extractProgramGenerationRemoteError({
      status: "incomplete",
      error: null,
      incomplete_details: [],
    }),
    "The model returned an incomplete routine program.",
  );
  assert.equal(extractProgramGenerationRemoteError({ status: "completed" }), null);
  assert.throws(() => extractProgramGenerationRemoteError("invalid"), /must be an object/i);

  assert.deepEqual(
    mapProgramGenerationRemoteResponse({
      status: "failed",
      error: { message: "Provider failure" },
    }),
    { kind: "failed", status: "failed", error: "Provider failure" },
  );
  assert.deepEqual(
    mapProgramGenerationRemoteResponse({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    }),
    {
      kind: "failed",
      status: "incomplete",
      error: "The model ran out of response capacity before completing the routine program.",
    },
  );
});
