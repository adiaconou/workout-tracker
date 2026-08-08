import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { PendingSetWrite, PendingSetWriteStorage } from "../src/client/api/pending-writes";

const reactNativeStubUrl = moduleUrl(`
  export const Platform = { OS: "web" };
`);
const asyncStorageStubUrl = moduleUrl(`
  const values = new Map();
  const calls = [];
  const storage = {
    values,
    calls,
    reset() {
      values.clear();
      calls.length = 0;
    },
    async getItem(key) {
      calls.push({ method: "getItem", key });
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      calls.push({ method: "setItem", key, value });
      values.set(key, value);
    },
    async removeItem(key) {
      calls.push({ method: "removeItem", key });
      values.delete(key);
    },
  };
  export default storage;
`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react-native") {
      return { url: reactNativeStubUrl, shortCircuit: true };
    }
    if (specifier === "@react-native-async-storage/async-storage") {
      return { url: asyncStorageStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const clientModule = await import("../src/client/api/client");
const pendingModule = await import("../src/client/api/pending-writes");
const runtimeStorage = (await import("@react-native-async-storage/async-storage")).default as unknown as {
  values: Map<string, string>;
  calls: Array<{ method: string; key: string; value?: string }>;
  reset(): void;
};

function moduleUrl(source: string) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sequenceFetch(responses: Response[]) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch call");
    return response;
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}

function requestHeaders(call: { init?: RequestInit }) {
  return new Headers(call.init?.headers);
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  readonly calls: Array<{ method: string; key: string; value?: string }> = [];
  readonly removeFailures = new Set<string>();

  async getItem(key: string) {
    this.calls.push({ method: "getItem", key });
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.calls.push({ method: "setItem", key, value });
    this.values.set(key, value);
  }

  async removeItem(key: string) {
    this.calls.push({ method: "removeItem", key });
    if (this.removeFailures.has(key)) throw new Error("remove failed");
    this.values.delete(key);
  }
}

function setBody(
  prescribedSetId: string,
  workoutElapsedSeconds = 30,
  status: "Completed" | "Skipped" = "Completed",
): PendingSetWrite["body"] {
  return {
    prescribedSetId,
    status,
    actualWeight: status === "Completed" ? 100 : null,
    actualReps: status === "Completed" ? 8 : null,
    actualDurationSec: null,
    workoutElapsedSeconds,
  };
}

function noopRequest<T>(): Promise<T> {
  return Promise.resolve(undefined as T);
}

function createQueue(
  storage: MemoryStorage,
  request: typeof clientModule.apiRequest = noopRequest,
) {
  const nowValues = [1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000];
  const randomValues = [0.5, 0.25, 0.75, 0.125, 0.625, 0.375, 0.875, 0.0625];
  return pendingModule.createPendingSetWriteQueue({
    storage: storage as PendingSetWriteStorage,
    request,
    now: () => nowValues.shift() ?? 9_000,
    random: () => randomValues.shift() ?? 0.5,
  });
}

test("ApiError and URL construction retain the public contract", () => {
  const defaultError = new clientModule.ApiError("failed", 400);
  assert.equal(defaultError.message, "failed");
  assert.equal(defaultError.status, 400);
  assert.equal(defaultError.code, "request_failed");
  assert.equal(defaultError.retryable, false);

  const unusedFetch = sequenceFetch([]).fetch;
  const web = clientModule.createApiClient({
    platform: "web",
    configuredBaseUrl: undefined,
    fetch: unusedFetch,
  });
  assert.equal(web.apiUrl("/api/test"), "/api/test");

  const webWithConfiguredBase = clientModule.createApiClient({
    platform: "web",
    configuredBaseUrl: "https://ignored.example/",
    fetch: unusedFetch,
  });
  assert.equal(webWithConfiguredBase.apiUrl("/api/test"), "/api/test");

  const native = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: "https://api.example/",
    fetch: unusedFetch,
  });
  assert.equal(native.apiUrl("/api/test"), "https://api.example/api/test");

  const unconfigured = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: undefined,
    fetch: unusedFetch,
  });
  assert.throws(
    () => unconfigured.apiUrl("/api/test"),
    (error: unknown) => {
      assert.ok(error instanceof clientModule.ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "api_not_configured");
      return true;
    },
  );
});

test("API requests set headers, preserve caller headers, and tolerate non-JSON success", async () => {
  const fake = sequenceFetch([
    jsonResponse({ first: true }),
    jsonResponse({ second: true }),
    new Response("plain text", { status: 200 }),
  ]);
  const api = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: "https://api.example",
    fetch: fake.fetch,
  });

  assert.deepEqual(await api.rawRequest<{ first: boolean }>("/first"), { first: true });
  api.configureSession({ token: "token-one", refresh: null });
  assert.deepEqual(
    await api.rawRequest<{ second: boolean }>("/second", { method: "POST", body: "{}" }),
    { second: true },
  );
  assert.deepEqual(
    await api.rawRequest("/third", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "payload",
    }),
    {},
  );

  const firstHeaders = requestHeaders(fake.calls[0]!);
  assert.equal(firstHeaders.get("accept"), "application/json");
  assert.equal(firstHeaders.get("authorization"), null);
  assert.equal(firstHeaders.get("content-type"), null);

  const secondHeaders = requestHeaders(fake.calls[1]!);
  assert.equal(secondHeaders.get("authorization"), "Bearer token-one");
  assert.equal(secondHeaders.get("content-type"), "application/json");

  const thirdHeaders = requestHeaders(fake.calls[2]!);
  assert.equal(thirdHeaders.get("content-type"), "text/plain");
});

test("API errors preserve structured, string, and fallback payload semantics", async () => {
  const fake = sequenceFetch([
    jsonResponse({ error: { message: "Slow down", code: "rate_limited", retryable: true } }, 429),
    jsonResponse({ error: "Bad input" }, 400),
    jsonResponse({}, 500),
    jsonResponse({ error: {} }, 502),
  ]);
  const api = clientModule.createApiClient({
    platform: "web",
    configuredBaseUrl: undefined,
    fetch: fake.fetch,
  });

  await assert.rejects(api.request("/structured"), (error: unknown) => {
    assert.ok(error instanceof clientModule.ApiError);
    assert.equal(error.message, "Slow down");
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryable, true);
    return true;
  });
  await assert.rejects(api.request("/string"), (error: unknown) => {
    assert.ok(error instanceof clientModule.ApiError);
    assert.equal(error.message, "Bad input");
    assert.equal(error.code, "request_failed");
    return true;
  });
  await assert.rejects(api.request("/missing"), (error: unknown) => {
    assert.ok(error instanceof clientModule.ApiError);
    assert.equal(error.message, "The request could not be completed.");
    return true;
  });
  await assert.rejects(api.request("/empty-structured"), (error: unknown) => {
    assert.ok(error instanceof clientModule.ApiError);
    assert.equal(error.message, "The request could not be completed.");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("401 refresh is gated and a successful refresh retries with the current token", async () => {
  let refreshCalls = 0;
  const rawFetch = sequenceFetch([jsonResponse({ error: "unauthorized" }, 401)]);
  const rawClient = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: "https://api.example",
    fetch: rawFetch.fetch,
  });
  rawClient.configureSession({
    token: null,
    refresh: async () => {
      refreshCalls += 1;
      return true;
    },
  });
  await assert.rejects(rawClient.rawRequest("/raw"), clientModule.ApiError);
  assert.equal(refreshCalls, 0);

  const webFetch = sequenceFetch([jsonResponse({ error: "unauthorized" }, 401)]);
  const webClient = clientModule.createApiClient({
    platform: "web",
    configuredBaseUrl: undefined,
    fetch: webFetch.fetch,
  });
  webClient.configureSession({
    token: null,
    refresh: async () => {
      refreshCalls += 1;
      return true;
    },
  });
  await assert.rejects(webClient.request("/web"), clientModule.ApiError);
  assert.equal(refreshCalls, 0);

  const noRefreshFetch = sequenceFetch([jsonResponse({ error: "unauthorized" }, 401)]);
  const noRefreshClient = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: "https://api.example",
    fetch: noRefreshFetch.fetch,
  });
  await assert.rejects(noRefreshClient.request("/no-refresh"), clientModule.ApiError);

  const declinedFetch = sequenceFetch([jsonResponse({ error: "unauthorized" }, 401)]);
  const declinedClient = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: "https://api.example",
    fetch: declinedFetch.fetch,
  });
  declinedClient.configureSession({ token: null, refresh: async () => false });
  await assert.rejects(declinedClient.request("/declined"), clientModule.ApiError);

  const refreshedFetch = sequenceFetch([
    jsonResponse({ error: "expired" }, 401),
    jsonResponse({ ok: true }),
  ]);
  const refreshedClient = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: "https://api.example",
    fetch: refreshedFetch.fetch,
  });
  refreshedClient.configureSession({
    token: "old-token",
    refresh: async () => {
      refreshedClient.configureSession({ token: "new-token", refresh: null });
      return true;
    },
  });
  assert.deepEqual(await refreshedClient.request("/retry"), { ok: true });
  assert.equal(requestHeaders(refreshedFetch.calls[0]!).get("authorization"), "Bearer old-token");
  assert.equal(requestHeaders(refreshedFetch.calls[1]!).get("authorization"), "Bearer new-token");

  const anonymousRetryFetch = sequenceFetch([
    jsonResponse({ error: "expired" }, 401),
    jsonResponse({ ok: "anonymous" }),
  ]);
  const anonymousRetryClient = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: "https://api.example",
    fetch: anonymousRetryFetch.fetch,
  });
  anonymousRetryClient.configureSession({ token: null, refresh: async () => true });
  assert.deepEqual(await anonymousRetryClient.request("/retry-anonymous"), { ok: "anonymous" });
  assert.equal(requestHeaders(anonymousRetryFetch.calls[1]!).get("authorization"), null);
});

test("client refreshWithToken sends the refresh request through the raw path", async () => {
  const session = {
    accessToken: "access",
    refreshToken: "refresh-next",
    expiresIn: 900,
    user: {},
  };
  const fake = sequenceFetch([jsonResponse(session)]);
  const api = clientModule.createApiClient({
    platform: "android",
    configuredBaseUrl: "https://api.example/",
    fetch: fake.fetch,
  });

  assert.deepEqual(await api.refreshWithToken("refresh-current"), session);
  assert.equal(fake.calls[0]!.input, "https://api.example/api/v1/auth/refresh");
  assert.equal(fake.calls[0]!.init?.method, "POST");
  assert.equal(fake.calls[0]!.init?.body, JSON.stringify({ refreshToken: "refresh-current" }));
});

test("pending queue owner setup isolates users and safely rejects malformed storage", async () => {
  const storage = new MemoryStorage();
  const queue = createQueue(storage);
  const legacyKey = "workout-tracker.pending-set-writes.v1";
  const ownerKey = "workout-tracker.pending-set-writes.v2.user%2Fone";

  storage.removeFailures.add(legacyKey);
  await queue.configureOwner(" user/one ");
  storage.removeFailures.clear();
  assert.equal(await queue.count(), 0);

  storage.values.set(ownerKey, "not-json");
  assert.equal(await queue.count(), 0);
  storage.values.set(ownerKey, JSON.stringify({ pending: true }));
  assert.equal(await queue.count(), 0);
  storage.values.set(ownerKey, JSON.stringify([]));
  assert.equal(await queue.count(), 0);
  storage.values.delete(ownerKey);
  assert.equal(await queue.count(), 0);

  await queue.configureOwner(null);
  assert.equal(await queue.count(), 0);
  await queue.remove("missing");
  await queue.removeForWorkout("missing");
  await queue.configureOwner("   ");
  assert.equal(await queue.count(), 0);
  assert.ok(storage.calls.some((call) => call.method === "removeItem" && call.key === legacyKey));
});

test("pending queue coalesces set updates, preserves elapsed time, and supports removals", async () => {
  const storage = new MemoryStorage();
  const queue = createQueue(storage);
  const ownerKey = "workout-tracker.pending-set-writes.v2.user-a";

  await assert.rejects(
    queue.enqueue("workout-a", setBody("set-a")),
    /signed-in user is required/u,
  );
  await queue.configureOwner("user-a");

  const first = await queue.enqueue("workout-a", setBody("set-a", 30));
  assert.equal(first.operationId, "rs-i-9");
  assert.equal(first.createdAt, new Date(2_000).toISOString());
  const second = await queue.enqueue("workout-a", setBody("set-b", 40));
  const third = await queue.enqueue("workout-b", setBody("set-c", 50));
  assert.equal(await queue.count(), 3);
  assert.equal(await queue.count("workout-a"), 2);
  assert.equal(await queue.count("missing"), 0);

  const updated = await queue.enqueue("workout-a", setBody("set-a", 999, "Skipped"));
  assert.equal(updated.operationId, first.operationId);
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.body.status, "Skipped");
  assert.equal(updated.body.workoutElapsedSeconds, 30);
  const storedAfterUpdate = JSON.parse(storage.values.get(ownerKey)!) as PendingSetWrite[];
  assert.deepEqual(storedAfterUpdate.map((item) => item.operationId), [
    second.operationId,
    third.operationId,
    first.operationId,
  ]);

  await queue.configureOwner("user-b");
  assert.equal(await queue.count(), 0);
  await queue.configureOwner("user-a");
  assert.equal(await queue.count(), 3);

  await queue.remove("does-not-exist");
  await queue.remove(second.operationId);
  assert.equal(await queue.count(), 2);
  await queue.removeForWorkout("workout-b");
  assert.equal(await queue.count(), 1);
  await queue.removeForWorkout("workout-a");
  assert.equal(await queue.count(), 0);
  assert.equal(storage.values.has(ownerKey), false);
});

test("pending queue flushes in order, stops on failure, and resumes without data loss", async () => {
  const storage = new MemoryStorage();
  const requestCalls: Array<{ path: string; init?: RequestInit }> = [];
  let failSecond = true;
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    requestCalls.push({ path, init });
    if (failSecond && path.includes("workout%2Ftwo")) throw new Error("offline");
    return undefined as T;
  }
  const queue = createQueue(storage, request);
  await queue.configureOwner("flush-user");
  const first = await queue.enqueue("workout one", setBody("set-1"));
  const second = await queue.enqueue("workout/two", setBody("set-2"));
  const third = await queue.enqueue("workout-three", setBody("set-3"));

  await queue.flush();
  assert.deepEqual(requestCalls.map((call) => call.path), [
    "/api/v1/workouts/workout%20one/sets",
    "/api/v1/workouts/workout%2Ftwo/sets",
  ]);
  assert.equal(requestCalls[0]!.init?.method, "POST");
  assert.deepEqual(requestCalls[0]!.init?.headers, { "x-idempotency-key": first.operationId });
  assert.equal(requestCalls[0]!.init?.body, JSON.stringify(first.body));
  assert.equal(await queue.count(), 2);

  failSecond = false;
  await queue.flush();
  assert.deepEqual(requestCalls.slice(2).map((call) => call.path), [
    "/api/v1/workouts/workout%2Ftwo/sets",
    "/api/v1/workouts/workout-three/sets",
  ]);
  assert.equal(requestCalls[2]!.init?.body, JSON.stringify(second.body));
  assert.equal(requestCalls[3]!.init?.body, JSON.stringify(third.body));
  assert.equal(await queue.count(), 0);
  await queue.flush();
});

test("pending flush removes from the current queue so concurrent additions survive", async () => {
  const storage = new MemoryStorage();
  const ownerKey = "workout-tracker.pending-set-writes.v2.concurrent-user";
  const concurrent: PendingSetWrite = {
    operationId: "concurrent-operation",
    workoutId: "concurrent-workout",
    prescribedSetId: "concurrent-set",
    createdAt: new Date(10_000).toISOString(),
    body: setBody("concurrent-set"),
  };
  async function request<T>(): Promise<T> {
    const current = JSON.parse(storage.values.get(ownerKey)!) as PendingSetWrite[];
    storage.values.set(ownerKey, JSON.stringify([...current, concurrent]));
    return undefined as T;
  }
  const queue = createQueue(storage, request);
  await queue.configureOwner("concurrent-user");
  await queue.enqueue("original-workout", setBody("original-set"));

  await queue.flush();
  assert.equal(await queue.count(), 1);
  assert.deepEqual(JSON.parse(storage.values.get(ownerKey)!), [concurrent]);
});

test("public singleton APIs delegate to their configured runtime dependencies", async (t) => {
  runtimeStorage.reset();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const responses = [
    jsonResponse({ kind: "raw" }),
    jsonResponse({ kind: "authenticated" }),
    jsonResponse({ accessToken: "a", refreshToken: "r", expiresIn: 60, user: {} }),
    jsonResponse({ flushed: true }),
  ];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected default fetch");
    return response;
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  clientModule.configureApiSession({ token: "public-token", refresh: null });
  assert.equal(clientModule.apiUrl("/public"), "/public");
  assert.deepEqual(await clientModule.rawApiRequest("/raw-public"), { kind: "raw" });
  assert.deepEqual(await clientModule.apiRequest("/api-public"), { kind: "authenticated" });
  assert.equal((await clientModule.refreshWithToken("refresh-public")).accessToken, "a");
  assert.equal(requestHeaders(fetchCalls[0]!).get("authorization"), "Bearer public-token");

  await pendingModule.configurePendingSetWriteOwner("public/user");
  const first = await pendingModule.enqueueSetWrite("public-workout", setBody("public-set"));
  const second = await pendingModule.enqueueSetWrite("other-workout", setBody("other-set"));
  assert.equal(await pendingModule.countPendingSetWrites(), 2);
  assert.equal(await pendingModule.countPendingSetWrites("public-workout"), 1);
  await pendingModule.removePendingSetWrite(first.operationId);
  await pendingModule.removePendingSetWritesForWorkout("other-workout");
  assert.equal(await pendingModule.countPendingSetWrites(), 0);
  await pendingModule.enqueueSetWrite("flush/public", setBody("flush-set"));
  await pendingModule.flushPendingSetWrites();
  assert.equal(await pendingModule.countPendingSetWrites(), 0);
  assert.equal(second.workoutId, "other-workout");
  assert.equal(fetchCalls.at(-1)!.input, "/api/v1/workouts/flush%2Fpublic/sets");
});
