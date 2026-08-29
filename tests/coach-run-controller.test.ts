import assert from "node:assert/strict";
import test from "node:test";
import type { CoachMessageRun } from "../src/contracts/api";
import {
  createCoachRunController,
  type CoachRunRequest,
} from "../src/client/coach/coach-run-controller";
import type {
  CoachRunConnection,
  CoachRunResponse,
} from "../src/client/coach/coach-model";

function run(
  status: CoachMessageRun["status"],
  id = "run-1",
  pollAfterMs = 1_500,
): CoachMessageRun {
  return {
    id,
    threadId: "thread-1",
    userMessageId: "user-1",
    status,
    phase: "planning",
    activities: [],
    pollAfterMs,
    assistantMessageId: null,
    error: null,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-30T00:00:00.000Z",
  };
}

function response(status: CoachMessageRun["status"], id = "run-1", pollAfterMs = 1_500): CoachRunResponse {
  return { run: run(status, id, pollAfterMs), assistantMessage: null, plans: [] };
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
    assert.ok(entry, "expected a scheduled advance");
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

function harness(request: CoachRunRequest) {
  const scheduler = new FakeScheduler();
  const responses: CoachRunResponse[] = [];
  const connections: CoachRunConnection[] = [];
  const fatalErrors: string[] = [];
  const controller = createCoachRunController({
    request,
    schedule: (callback, delayMs) => scheduler.schedule(callback, delayMs),
    cancelScheduled: (handle) => scheduler.cancel(handle),
    isRetryableError: (error) => error instanceof Error && error.message.startsWith("retry"),
    errorMessage: (error) => error instanceof Error ? error.message : "unknown",
    onResponse: (payload) => responses.push(payload),
    onConnection: (connection) => connections.push(connection),
    onFatalError: (message) => fatalErrors.push(message),
  });
  return { controller, scheduler, responses, connections, fatalErrors };
}

test("advances a run without overlap and stops at a terminal response", async () => {
  const pending = deferred<CoachRunResponse>();
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let requestNumber = 0;
  const state = harness(<T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    requestNumber += 1;
    return (requestNumber === 1
      ? pending.promise
      : Promise.resolve(response("succeeded"))) as Promise<T>;
  });

  state.controller.monitor(run("queued", "run-1", 2_500));
  assert.deepEqual(state.scheduler.scheduledDelays, [2_500]);
  state.scheduler.runNext();
  state.controller.checkNow();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/api/v1/assistant/message-runs/run-1/advance");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.ok(calls[0]!.init?.signal instanceof AbortSignal);

  pending.resolve(response("in_progress", "run-1", 3_000));
  await settle();
  assert.equal(state.scheduler.scheduledDelays.at(-1), 3_000);
  state.scheduler.runNext();
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(state.scheduler.tasks.size, 0);
  assert.deepEqual(state.responses.map(({ run: value }) => value.status), ["in_progress", "succeeded"]);

  state.controller.checkNow();
  state.controller.pause();
  state.controller.resume();
  assert.equal(state.scheduler.tasks.size, 0);
});

test("backs off retryable failures and lets a fatal check be retried manually", async () => {
  const failures: unknown[] = [
    new Error("retry one"),
    new Error("retry two"),
    new Error("retry three"),
    new Error("retry four"),
    new Error("retry five"),
    new Error("fatal advance"),
    "fatal unknown",
  ];
  const state = harness(<T>() => Promise.reject(failures.shift()) as Promise<T>);
  state.controller.monitor(run("queued"));

  for (const expectedDelay of [2_000, 4_000, 8_000, 15_000, 15_000]) {
    state.scheduler.runNext();
    await settle();
    assert.equal(state.scheduler.scheduledDelays.at(-1), expectedDelay);
  }
  state.scheduler.runNext();
  await settle();
  assert.deepEqual(state.fatalErrors, ["fatal advance"]);
  assert.equal(state.connections.at(-1), "failed");
  assert.equal(state.scheduler.tasks.size, 0);

  state.controller.checkNow();
  await settle();
  assert.equal(state.fatalErrors.at(-1), "unknown");
});

test("pauses, resumes, and ignores redundant lifecycle calls", async () => {
  const state = harness(<T>() => Promise.resolve(response("succeeded")) as Promise<T>);
  state.controller.checkNow();
  state.controller.pause();
  state.controller.pause();
  state.controller.monitor(run("queued"));
  assert.equal(state.connections.at(-1), "paused");
  assert.equal(state.scheduler.tasks.size, 0);
  state.controller.checkNow();
  state.controller.resume();
  state.controller.resume();
  assert.equal(state.scheduler.scheduledDelays.at(-1), 0);
  state.scheduler.runNext();
  await settle();
  assert.equal(state.responses.at(-1)?.run.status, "succeeded");

  state.controller.monitor(run("succeeded"));
  assert.equal(state.scheduler.tasks.size, 0);
  state.controller.pause();
  state.controller.resume();
  state.controller.stop();
  state.controller.stop();
});

test("check now replaces a scheduled advance", async () => {
  let calls = 0;
  const state = harness(<T>() => {
    calls += 1;
    return Promise.resolve(response("succeeded")) as Promise<T>;
  });
  state.controller.monitor(run("queued"));
  const scheduledHandle = state.scheduler.tasks.keys().next().value as number;
  state.controller.checkNow();
  await settle();
  assert.equal(calls, 1);
  assert.ok(state.scheduler.cancelled.includes(scheduledHandle));
});

test("ignores stale, aborted, and wrong-run responses", async () => {
  const first = deferred<CoachRunResponse>();
  const calls: AbortSignal[] = [];
  const state = harness(<T>(_path: string, init?: RequestInit) => {
    calls.push(init?.signal as AbortSignal);
    return first.promise as Promise<T>;
  });
  state.controller.monitor(run("queued", "old"));
  state.scheduler.runNext();
  state.controller.monitor(run("queued", "new"));
  assert.equal(calls[0]?.aborted, true);
  first.resolve(response("succeeded", "old"));
  await settle();
  assert.deepEqual(state.responses, []);

  const mismatched = harness(<T>() => Promise.resolve(response("succeeded", "wrong")) as Promise<T>);
  mismatched.controller.monitor(run("queued", "expected"));
  mismatched.scheduler.runNext();
  await settle();
  assert.deepEqual(mismatched.responses, []);
  assert.equal(mismatched.scheduler.tasks.size, 0);

  const staleFailure = deferred<CoachRunResponse>();
  const stopped = harness(<T>() => staleFailure.promise as Promise<T>);
  stopped.controller.monitor(run("queued", "stopped"));
  stopped.scheduler.runNext();
  stopped.controller.stop();
  staleFailure.reject(new Error("retry stale"));
  await settle();
  assert.deepEqual(stopped.fatalErrors, []);
  assert.equal(stopped.scheduler.tasks.size, 0);
});

test("cancelled or duplicate scheduled callbacks cannot restart work", async () => {
  let calls = 0;
  const pending = deferred<CoachRunResponse>();
  const state = harness(<T>() => {
    calls += 1;
    return pending.promise as Promise<T>;
  });

  state.controller.monitor(run("queued", "stopped"));
  const afterStop = state.scheduler.takeNextCallback();
  state.controller.stop();
  afterStop();
  await settle();
  assert.equal(calls, 0);
  assert.equal(state.scheduler.cancelled.length, 1);

  state.controller.monitor(run("queued", "paused"));
  const whilePaused = state.scheduler.takeNextCallback();
  state.controller.pause();
  whilePaused();
  await settle();
  assert.equal(calls, 0);

  state.controller.resume();
  const twice = state.scheduler.takeNextCallback();
  twice();
  twice();
  assert.equal(calls, 1);

  state.controller.stop();
  pending.resolve(response("succeeded", "paused"));
  await settle();
});
