import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProgramGenerationJob,
  ProgramGenerationStatus,
} from "../src/contracts/api";
import {
  programGenerationAttemptKey,
  programGenerationCanRetry,
  programGenerationIsActive,
  programGenerationPollDelay,
  programGenerationPresentation,
  programGenerationRetryDelay,
  type ProgramGenerationConnection,
} from "../src/client/routines/program-generation-model";

function job(
  status: ProgramGenerationStatus,
  patch: Partial<ProgramGenerationJob> = {},
): ProgramGenerationJob {
  return {
    id: "generation-1",
    status,
    pollAfterMs: 2_000,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-10T00:00:00.000Z",
    program: null,
    error: null,
    ...patch,
  };
}

test("classifies active generation statuses", () => {
  const active = new Set(["starting", "queued", "in_progress", "cancelling"]);
  const statuses: ProgramGenerationStatus[] = [
    "starting",
    "queued",
    "in_progress",
    "succeeded",
    "failed",
    "cancelling",
    "cancelled",
    "expired",
  ];
  for (const status of statuses) {
    assert.equal(programGenerationIsActive(status), active.has(status), status);
  }
});

test("uses bounded polling and retry delays", () => {
  assert.equal(programGenerationRetryDelay(0), 2_000);
  assert.equal(programGenerationRetryDelay(1), 2_000);
  assert.equal(programGenerationRetryDelay(2), 4_000);
  assert.equal(programGenerationRetryDelay(3.9), 8_000);
  assert.equal(programGenerationRetryDelay(4), 15_000);
  assert.equal(programGenerationRetryDelay(99), 15_000);

  assert.equal(programGenerationPollDelay(job("queued", { pollAfterMs: 2_500 })), 2_500);
  assert.equal(programGenerationPollDelay(job("queued", { pollAfterMs: 200 })), 1_000);
  assert.equal(programGenerationPollDelay(job("queued", { pollAfterMs: 20_000 })), 15_000);
  assert.equal(programGenerationPollDelay(job("queued", { pollAfterMs: 0 })), 2_000);
  assert.equal(programGenerationPollDelay(job("queued", { pollAfterMs: Number.NaN })), 2_000);
});

test("reuses only an unchanged uncertain start key and identifies retryable terminal jobs", () => {
  let created = 0;
  const createKey = () => `new-${++created}`;
  const existing = { key: "existing", requestFingerprint: "request-a" };
  assert.equal(
    programGenerationAttemptKey(existing, "request-a", false, createKey),
    "existing",
  );
  assert.equal(programGenerationAttemptKey(null, "request-a", false, createKey), "new-1");
  assert.equal(programGenerationAttemptKey(existing, "request-a", true, createKey), "new-2");
  assert.equal(programGenerationAttemptKey(existing, "request-b", false, createKey), "new-3");

  assert.equal(programGenerationCanRetry(job("expired")), true);
  assert.equal(programGenerationCanRetry(job("failed", {
    error: { code: "timeout", message: "Timed out", retryable: true },
  })), true);
  assert.equal(programGenerationCanRetry(job("failed", {
    error: { code: "invalid", message: "Invalid", retryable: false },
  })), false);
  assert.equal(programGenerationCanRetry(job("failed")), false);
  assert.equal(programGenerationCanRetry(job("queued")), false);
});

test("presents honest copy for every server and connection state", () => {
  const cases: Array<{
    status: ProgramGenerationStatus;
    connection?: ProgramGenerationConnection;
    routines?: number;
    title: RegExp;
    active: boolean;
  }> = [
    { status: "starting", title: /getting your program ready/i, active: true },
    { status: "queued", connection: "paused", title: /progress checks are paused/i, active: true },
    { status: "in_progress", routines: 1, title: /building 1 routine$/i, active: true },
    { status: "in_progress", routines: 3, title: /building 3 routines$/i, active: true },
    { status: "cancelling", title: /cancelling generation/i, active: true },
    { status: "cancelled", title: /generation cancelled/i, active: false },
    { status: "expired", title: /generation expired/i, active: false },
    { status: "failed", title: /could not finish/i, active: false },
    { status: "succeeded", title: /could not be loaded/i, active: false },
  ];
  for (const entry of cases) {
    const presentation = programGenerationPresentation(
      job(entry.status),
      entry.connection ?? "connected",
      entry.routines ?? 3,
    );
    assert.match(presentation.title, entry.title);
    assert.ok(presentation.detail.length > 0);
    assert.equal(presentation.active, entry.active);
  }

  const reconnecting = programGenerationPresentation(job("queued"), "reconnecting", 3);
  assert.match(reconnecting.title, /still working/i);
  assert.equal(reconnecting.active, true);

  const failedConnection = programGenerationPresentation(job("failed"), "failed", 3);
  assert.match(failedConnection.title, /could not check/i);
  assert.equal(failedConnection.active, false);

  const preparing = programGenerationPresentation(job("succeeded", {
    program: { name: "Plan", summary: "Summary", warnings: [], routines: [] },
  }), "connected", 3);
  assert.match(preparing.title, /preparing your program draft/i);
  assert.equal(preparing.active, true);
});
