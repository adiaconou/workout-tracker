import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProgramGenerationJob,
  ProgramGenerationStatus,
} from "../src/contracts/api";
import {
  createProgramGenerationController,
  type ProgramGenerationRequest,
} from "../src/client/routines/program-generation-controller";
import type { ProgramGenerationConnection } from "../src/client/routines/program-generation-model";

function job(status: ProgramGenerationStatus, id = "generation-1", pollAfterMs = 2_500): ProgramGenerationJob {
  return {
    id,
    status,
    pollAfterMs,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-10T00:00:00.000Z",
    program: null,
    error: null,
  };
}

class FakeScheduler {
  nextId = 1;
  readonly tasks = new Map<number, { callback: () => void; delayMs: number }>();
  readonly scheduledDelays: number[] = [];
  readonly cancelled: number[] = [];

  schedule(callback: () => void, delayMs: number) {
    const id = this.nextId++;
    this.tasks.set(id, { callback, delayMs });
    this.scheduledDelays.push(delayMs);
    return id;
  }

  cancel(handle: unknown) {
    const id = Number(handle);
    this.cancelled.push(id);
    this.tasks.delete(id);
  }

  runNext() {
    this.takeNextCallback()();
  }

  takeNextCallback() {
    const entry = this.tasks.entries().next().value as [number, { callback: () => void; delayMs: number }] | undefined;
    assert.ok(entry, "expected a scheduled poll");
    this.tasks.delete(entry[0]);
    return entry[1].callback;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function harness(request: ProgramGenerationRequest) {
  const scheduler = new FakeScheduler();
  const jobs: ProgramGenerationJob[] = [];
  const connections: ProgramGenerationConnection[] = [];
  const fatalErrors: string[] = [];
  const controller = createProgramGenerationController({
    request,
    schedule: (callback, delayMs) => scheduler.schedule(callback, delayMs),
    cancelScheduled: (handle) => scheduler.cancel(handle),
    isRetryableError: (error) => error instanceof Error && error.message.startsWith("retry"),
    errorMessage: (error) => error instanceof Error ? error.message : "unknown",
    onJob: (next) => jobs.push(next),
    onConnection: (connection) => connections.push(connection),
    onFatalError: (message) => fatalErrors.push(message),
  });
  return { controller, scheduler, jobs, connections, fatalErrors };
}

test("polls recursively without overlap and stops at a terminal job", async () => {
  const pending = deferred<{ generation: ProgramGenerationJob }>();
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let requestNumber = 0;
  const state = harness(<T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    requestNumber += 1;
    return (requestNumber === 1
      ? pending.promise
      : Promise.resolve({ generation: job("succeeded") })) as Promise<T>;
  });

  state.controller.monitor("generation-1", job("queued"));
  assert.deepEqual(state.scheduler.scheduledDelays, [2_500]);
  state.scheduler.runNext();
  state.controller.checkNow();
  assert.equal(calls.length, 1, "a second poll must not overlap the first");
  assert.equal(calls[0]!.path, "/api/v1/assistant/program-generations/generation-1");
  assert.ok(calls[0]!.init?.signal instanceof AbortSignal);

  pending.resolve({ generation: job("in_progress", "generation-1", 3_000) });
  await settle();
  assert.equal(state.scheduler.scheduledDelays.at(-1), 3_000);
  state.scheduler.runNext();
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(state.scheduler.tasks.size, 0);
  assert.deepEqual(state.jobs.map((value) => value.status), ["queued", "in_progress", "succeeded"]);

  state.controller.checkNow();
  state.controller.pause();
  state.controller.resume();
  assert.equal(state.scheduler.tasks.size, 0, "terminal jobs stay stopped after resume");
});

test("backs off retryable failures and exposes a fatal polling error", async () => {
  const failures: unknown[] = [
    new Error("retry one"),
    new Error("retry two"),
    new Error("retry three"),
    new Error("retry four"),
    new Error("retry five"),
    new Error("fatal status"),
    "fatal unknown",
  ];
  const state = harness(<T>() => Promise.reject(failures.shift()) as Promise<T>);
  state.controller.monitor("generation-1");

  for (const expectedDelay of [2_000, 4_000, 8_000, 15_000, 15_000]) {
    state.scheduler.runNext();
    await settle();
    assert.equal(state.scheduler.scheduledDelays.at(-1), expectedDelay);
  }
  state.scheduler.runNext();
  await settle();
  assert.deepEqual(state.fatalErrors, ["fatal status"]);
  assert.equal(state.connections.at(-1), "failed");
  assert.equal(state.scheduler.tasks.size, 0);

  state.controller.checkNow();
  await settle();
  assert.equal(state.fatalErrors.at(-1), "unknown");
});

test("pauses, resumes, cancels timers, and ignores repeated lifecycle calls", async () => {
  const state = harness(<T>() => Promise.resolve({ generation: job("cancelled") }) as Promise<T>);
  state.controller.checkNow();
  state.controller.pause();
  state.controller.pause();
  state.controller.monitor("generation-1", job("queued"));
  assert.equal(state.connections.at(-1), "paused");
  assert.equal(state.scheduler.tasks.size, 0);
  state.controller.checkNow();
  state.controller.resume();
  state.controller.resume();
  assert.equal(state.scheduler.scheduledDelays.at(-1), 0);
  state.scheduler.runNext();
  await settle();
  assert.equal(state.jobs.at(-1)?.status, "cancelled");

  state.controller.monitor("generation-1", job("succeeded"));
  assert.equal(state.scheduler.tasks.size, 0);
  state.controller.pause();
  state.controller.resume();
  state.controller.stop();
  state.controller.stop();
});

test("check now replaces a scheduled poll", async () => {
  let calls = 0;
  const state = harness(<T>() => {
    calls += 1;
    return Promise.resolve({ generation: job("cancelled") }) as Promise<T>;
  });
  state.controller.monitor("generation-1", job("queued"));
  const scheduledHandle = state.scheduler.tasks.keys().next().value as number;
  state.controller.checkNow();
  await settle();
  assert.equal(calls, 1);
  assert.ok(state.scheduler.cancelled.includes(scheduledHandle));
});

test("ignores stale responses after monitoring another generation", async () => {
  const first = deferred<{ generation: ProgramGenerationJob }>();
  const calls: AbortSignal[] = [];
  const state = harness(<T>(_path: string, init?: RequestInit) => {
    calls.push(init?.signal as AbortSignal);
    return first.promise as Promise<T>;
  });
  state.controller.monitor("old");
  state.scheduler.runNext();
  state.controller.monitor("new", job("queued", "new"));
  assert.equal(calls[0]?.aborted, true);
  first.resolve({ generation: job("succeeded", "old") });
  await settle();
  assert.deepEqual(state.jobs.map((value) => value.id), ["new"]);

  const staleFailure = deferred<{ generation: ProgramGenerationJob }>();
  const stateWithFailure = harness(<T>() => staleFailure.promise as Promise<T>);
  stateWithFailure.controller.monitor("old");
  stateWithFailure.scheduler.runNext();
  stateWithFailure.controller.stop();
  staleFailure.reject(new Error("retry stale"));
  await settle();
  assert.deepEqual(stateWithFailure.fatalErrors, []);
  assert.equal(stateWithFailure.scheduler.tasks.size, 0);
});

test("ignores cancelled or duplicate timer callbacks", async () => {
  let calls = 0;
  const pending = deferred<{ generation: ProgramGenerationJob }>();
  const state = harness(<T>() => {
    calls += 1;
    return pending.promise as Promise<T>;
  });

  state.controller.monitor("stopped", job("queued", "stopped"));
  const afterStop = state.scheduler.takeNextCallback();
  state.controller.stop();
  afterStop();
  await settle();
  assert.equal(calls, 0);
  assert.equal(state.scheduler.cancelled.length, 1);

  state.controller.monitor("paused", job("queued", "paused"));
  const whilePaused = state.scheduler.takeNextCallback();
  state.controller.pause();
  whilePaused();
  await settle();
  assert.equal(calls, 0);

  state.controller.resume();
  const twice = state.scheduler.takeNextCallback();
  twice();
  twice();
  assert.equal(calls, 1, "a duplicate timer callback must not overlap an active request");

  state.controller.stop();
  pending.resolve({ generation: job("succeeded", "paused") });
  await settle();
});
