import assert from "node:assert/strict";
import test from "node:test";
import type { UserProfile } from "../src/domain/profile";
import {
  createAuthController,
  type AuthControllerDependencies,
} from "../src/client/auth/auth-controller";
import type { NativeSession, SessionUser, TrainingProfile } from "../src/contracts/api";
import {
  createProfileController,
  type ProfileControllerDependencies,
  profileForUser,
} from "../src/client/profile/profile-controller";

function user(id = "user-one"): SessionUser {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    photoUrl: null,
    trainingProfile: {
      equipment: ["bodyweight"],
      sessionDurationMin: 45,
      onboardingCompletedAt: null,
      onboardingCompleted: false,
    },
  };
}

function session(id = "user-one"): NativeSession {
  return {
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
    expiresIn: 900,
    user: user(id),
  };
}

type AuthHarness = ReturnType<typeof createAuthHarness>;

function createAuthHarness() {
  const unauthorized = { kind: "unauthorized" };
  const state = {
    platform: "android",
    platformValues: [] as string[],
    storedRefreshToken: "stored-refresh" as string | null,
    refreshedSession: session(),
    rawImpl: async (_path: string, _init?: RequestInit): Promise<unknown> => ({ user: user() }),
    requestImpl: async (_path: string, _init?: RequestInit): Promise<unknown> => ({}),
    getRefreshTokenImpl: null as null | (() => Promise<string | null>),
    googleToken: "google-id-token",
    googleSignOutError: null as unknown,
    locationSearch: "?auth=returned" as string | null,
  };
  const calls = {
    configurations: [] as Array<{ token: string | null; refresh: () => Promise<boolean> }>,
    owners: [] as Array<string | null>,
    savedRefreshTokens: [] as string[],
    deleteRefreshToken: 0,
    refreshTokens: [] as string[],
    raw: [] as Array<{ path: string; init?: RequestInit }>,
    requests: [] as Array<{ path: string; init?: RequestInit }>,
    googleSignIn: 0,
    googleSignOut: 0,
    redirects: [] as string[],
    locationSearch: 0,
    loading: [] as boolean[],
    users: [] as Array<SessionUser | null>,
    errors: [] as string[],
  };

  async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
    calls.raw.push({ path, init });
    return await state.rawImpl(path, init) as T;
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    calls.requests.push({ path, init });
    return await state.requestImpl(path, init) as T;
  }

  const dependencies: AuthControllerDependencies = {
    platform: () => state.platformValues.shift() ?? state.platform,
    configureSession: (configuration) => calls.configurations.push(configuration),
    configurePendingWriteOwner: async (userId) => {
      calls.owners.push(userId);
    },
    getRefreshToken: () => state.getRefreshTokenImpl?.() ?? Promise.resolve(state.storedRefreshToken),
    setRefreshToken: async (refreshToken) => {
      calls.savedRefreshTokens.push(refreshToken);
      state.storedRefreshToken = refreshToken;
    },
    deleteRefreshToken: async () => {
      calls.deleteRefreshToken += 1;
      state.storedRefreshToken = null;
    },
    refreshWithToken: async (refreshToken) => {
      calls.refreshTokens.push(refreshToken);
      return state.refreshedSession;
    },
    rawRequest,
    request,
    signInWithGoogle: async () => {
      calls.googleSignIn += 1;
      return state.googleToken;
    },
    signOutFromGoogle: async () => {
      calls.googleSignOut += 1;
      if (state.googleSignOutError !== null) throw state.googleSignOutError;
    },
    redirect: (location) => calls.redirects.push(location),
    locationSearch: () => {
      calls.locationSearch += 1;
      return state.locationSearch;
    },
    isUnauthorizedError: (caught) => caught === unauthorized,
    setLoading: (value) => calls.loading.push(value),
    setUser: (value) => calls.users.push(value),
    setError: (value) => calls.errors.push(value),
  };
  return {
    controller: createAuthController(dependencies),
    state,
    calls,
    unauthorized,
  };
}

function profile(id = "user-one"): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    photoUrl: null,
    heightCm: 180,
    bodyWeightKg: 80,
    measurementSystem: "metric",
  };
}

function createProfileHarness() {
  const state = {
    requestImpl: async (_path: string, _init?: RequestInit): Promise<unknown> => ({
      profile: profile(),
    }),
  };
  const calls = {
    requests: [] as Array<{ path: string; init?: RequestInit }>,
    profiles: [] as Array<UserProfile | null>,
    loading: [] as boolean[],
    saving: [] as boolean[],
    errors: [] as string[],
  };
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    calls.requests.push({ path, init });
    return await state.requestImpl(path, init) as T;
  }
  const dependencies: ProfileControllerDependencies = {
    request,
    setProfile: (value) => calls.profiles.push(value),
    setLoading: (value) => calls.loading.push(value),
    setSaving: (value) => calls.saving.push(value),
    setError: (value) => calls.errors.push(value),
  };
  return {
    controller: createProfileController(dependencies),
    state,
    calls,
  };
}

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

async function establishSession(harness: AuthHarness) {
  harness.state.rawImpl = async () => session("signed-in");
  await harness.controller.signIn();
}

test("auth refresh handles web, missing-token, concurrent, and successful sessions", async () => {
  const harness = createAuthHarness();
  harness.state.platform = "web";
  assert.equal(await harness.controller.refresh(), false);
  assert.equal(harness.calls.refreshTokens.length, 0);

  harness.state.platform = "android";
  harness.state.storedRefreshToken = null;
  assert.equal(await harness.controller.refresh(), false);

  const deferredToken = new Deferred<string | null>();
  harness.state.getRefreshTokenImpl = () => deferredToken.promise;
  harness.state.refreshedSession = session("refreshed");
  const firstRefresh = harness.controller.refresh();
  const secondRefresh = harness.controller.refresh();
  deferredToken.resolve("refresh-original");
  assert.deepEqual(await Promise.all([firstRefresh, secondRefresh]), [true, true]);
  assert.deepEqual(harness.calls.refreshTokens, ["refresh-original"]);
  assert.deepEqual(harness.calls.savedRefreshTokens, ["refresh-refreshed"]);
  assert.deepEqual(harness.calls.owners, ["refreshed"]);
  assert.equal(harness.calls.users.at(-1)?.id, "refreshed");
  assert.equal(harness.calls.configurations.at(-1)?.token, "access-refreshed");
});

test("auth refresh clears all local session state after a failure and can retry", async () => {
  const harness = createAuthHarness();
  harness.state.getRefreshTokenImpl = null;
  harness.state.storedRefreshToken = "bad-refresh";
  const originalRefresh = harness.state.refreshedSession;
  harness.state.refreshedSession = originalRefresh;
  const refreshFailure = new Error("expired");
  harness.state.getRefreshTokenImpl = async () => {
    throw refreshFailure;
  };

  assert.equal(await harness.controller.refresh(), false);
  assert.equal(harness.calls.deleteRefreshToken, 1);
  assert.deepEqual(harness.calls.owners, [null]);
  assert.equal(harness.calls.users.at(-1), null);
  assert.equal(harness.calls.configurations.at(-1)?.token, null);

  harness.state.getRefreshTokenImpl = async () => "valid-refresh";
  harness.state.refreshedSession = session("retry-user");
  assert.equal(await harness.controller.refresh(), true);
  assert.equal(harness.calls.users.at(-1)?.id, "retry-user");
});

test("auth restore covers browser sessions, native refresh, and authorization errors", async () => {
  const browser = createAuthHarness();
  browser.state.platform = "web";
  browser.state.rawImpl = async () => ({ user: user("browser-user") });
  await browser.controller.restore();
  assert.equal(browser.calls.raw[0]?.path, "/api/v1/auth/session");
  assert.deepEqual(browser.calls.owners, ["browser-user"]);
  assert.deepEqual(browser.calls.loading, [true, false]);
  assert.deepEqual(browser.calls.errors, [""]);

  const native = createAuthHarness();
  native.state.platform = "android";
  native.state.storedRefreshToken = null;
  await native.controller.restore();
  assert.equal(native.calls.raw.length, 0);
  assert.deepEqual(native.calls.loading, [true, false]);

  const returned = createAuthHarness();
  returned.state.platform = "web";
  returned.state.rawImpl = async () => {
    throw returned.unauthorized;
  };
  await returned.controller.restore();
  assert.deepEqual(returned.calls.owners, [null]);
  assert.equal(returned.calls.users.at(-1), null);
  assert.equal(
    returned.calls.errors.at(-1),
    "This ChatGPT account is not authorized for this tracker.",
  );

  const otherQuery = createAuthHarness();
  otherQuery.state.platform = "web";
  otherQuery.state.locationSearch = "?auth=other";
  otherQuery.state.rawImpl = async () => {
    throw otherQuery.unauthorized;
  };
  await otherQuery.controller.restore();
  assert.deepEqual(otherQuery.calls.errors, [""]);

  const noWindow = createAuthHarness();
  noWindow.state.platform = "web";
  noWindow.state.locationSearch = null;
  noWindow.state.rawImpl = async () => {
    throw noWindow.unauthorized;
  };
  await noWindow.controller.restore();
  assert.deepEqual(noWindow.calls.errors, [""]);

  const genericFailure = createAuthHarness();
  genericFailure.state.platform = "web";
  genericFailure.state.rawImpl = async () => {
    throw new Error("network");
  };
  await genericFailure.controller.restore();
  assert.equal(genericFailure.calls.locationSearch, 0);

  const changedPlatform = createAuthHarness();
  changedPlatform.state.platformValues.push("web", "android");
  changedPlatform.state.rawImpl = async () => {
    throw changedPlatform.unauthorized;
  };
  await changedPlatform.controller.restore();
  assert.equal(changedPlatform.calls.locationSearch, 0);
});

test("auth sign-in redirects on web, exchanges Google tokens, and normalizes failures", async () => {
  const browser = createAuthHarness();
  browser.state.platform = "web";
  await browser.controller.signIn();
  assert.deepEqual(browser.calls.redirects, [
    "/signin-with-chatgpt?return_to=%2Fsign-in%3Fauth%3Dreturned",
  ]);
  assert.deepEqual(browser.calls.loading, [true, false]);

  const native = createAuthHarness();
  native.state.rawImpl = async () => session("google-user");
  await native.controller.signIn();
  assert.equal(native.calls.googleSignIn, 1);
  assert.equal(native.calls.raw[0]?.path, "/api/v1/auth/google/exchange");
  assert.deepEqual(native.calls.raw[0]?.init, {
    method: "POST",
    body: JSON.stringify({ idToken: "google-id-token", deviceName: "Android phone" }),
  });
  assert.equal(native.calls.users.at(-1)?.id, "google-user");

  const errorFailure = createAuthHarness();
  errorFailure.state.rawImpl = async () => {
    throw new Error("Google exchange failed");
  };
  await errorFailure.controller.signIn();
  assert.equal(errorFailure.calls.errors.at(-1), "Google exchange failed");

  const unknownFailure = createAuthHarness();
  unknownFailure.state.rawImpl = async () => {
    throw "failure";
  };
  await unknownFailure.controller.signIn();
  assert.equal(unknownFailure.calls.errors.at(-1), "Sign-in failed.");
});

test("auth sign-out cleans up with and without tokens and ignores provider failures", async () => {
  const browser = createAuthHarness();
  browser.state.platform = "web";
  await browser.controller.signOut();
  assert.equal(browser.calls.requests.length, 0);
  assert.deepEqual(browser.calls.redirects, ["/signout-with-chatgpt?return_to=/"]);
  assert.equal(browser.calls.users.at(-1), null);

  const native = createAuthHarness();
  await establishSession(native);
  native.calls.loading.length = 0;
  native.state.requestImpl = async () => {
    throw new Error("logout unavailable");
  };
  native.state.googleSignOutError = new Error("provider unavailable");
  await native.controller.signOut();
  assert.equal(native.calls.requests.at(-1)?.path, "/api/v1/auth/logout");
  assert.equal(native.calls.googleSignOut, 1);
  assert.equal(native.calls.configurations.at(-1)?.token, null);
  assert.deepEqual(native.calls.loading, [true, false]);

  const successfulLogout = createAuthHarness();
  await establishSession(successfulLogout);
  successfulLogout.state.platform = "web";
  successfulLogout.state.requestImpl = async () => ({ ok: true });
  await successfulLogout.controller.signOut();
  assert.equal(successfulLogout.calls.requests.at(-1)?.init?.method, "POST");
  assert.equal(successfulLogout.calls.redirects.at(-1), "/signout-with-chatgpt?return_to=/");
});

test("auth training setup updates the user and returns first-completion state", async () => {
  const harness = createAuthHarness();
  harness.state.requestImpl = async () => ({
    user: user("onboarded"),
    firstCompletion: true,
  });
  const input: Pick<TrainingProfile, "equipment" | "sessionDurationMin"> = {
    equipment: ["bodyweight"],
    sessionDurationMin: 45,
  };
  assert.deepEqual(await harness.controller.completeTrainingSetup(input), { firstCompletion: true });
  assert.equal(harness.calls.requests[0]?.path, "/api/v1/onboarding");
  assert.deepEqual(harness.calls.requests[0]?.init, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  assert.equal(harness.calls.users.at(-1)?.id, "onboarded");
});

test("profileForUser exposes only the signed-in user's profile", () => {
  const first = profile("first");
  assert.equal(profileForUser(null, first), null);
  assert.equal(profileForUser({ id: "first" }, null), null);
  assert.equal(profileForUser({ id: "other" }, first), null);
  assert.equal(profileForUser({ id: "first" }, first), first);
});

test("profile reload clears signed-out state and handles success and both error forms", async () => {
  const signedOut = createProfileHarness();
  await signedOut.controller.reload(null);
  assert.deepEqual(signedOut.calls.saving, [false]);
  assert.deepEqual(signedOut.calls.profiles, [null]);
  assert.deepEqual(signedOut.calls.errors, [""]);
  assert.deepEqual(signedOut.calls.loading, [false]);

  const success = createProfileHarness();
  success.state.requestImpl = async () => ({ profile: profile("loaded") });
  await success.controller.reload({ id: "loaded" });
  assert.equal(success.calls.requests[0]?.path, "/api/v1/auth/profile");
  assert.equal(success.calls.profiles.at(-1)?.id, "loaded");
  assert.deepEqual(success.calls.loading, [true, false]);

  const errorFailure = createProfileHarness();
  errorFailure.state.requestImpl = async () => {
    throw new Error("Profile service unavailable");
  };
  await errorFailure.controller.reload({ id: "user-one" });
  assert.equal(errorFailure.calls.errors.at(-1), "Profile service unavailable");

  const unknownFailure = createProfileHarness();
  unknownFailure.state.requestImpl = async () => {
    throw "unavailable";
  };
  await unknownFailure.controller.reload({ id: "user-one" });
  assert.equal(unknownFailure.calls.errors.at(-1), "Profile could not be loaded.");
});

test("profile reload ignores stale successes and failures", async () => {
  const staleSuccess = createProfileHarness();
  const successResult = new Deferred<unknown>();
  staleSuccess.state.requestImpl = () => successResult.promise;
  const pendingSuccess = staleSuccess.controller.reload({ id: "user-one" });
  staleSuccess.controller.invalidate();
  successResult.resolve({ profile: profile("stale") });
  await pendingSuccess;
  assert.deepEqual(staleSuccess.calls.profiles, []);
  assert.deepEqual(staleSuccess.calls.loading, [true]);

  const staleFailure = createProfileHarness();
  const failureResult = new Deferred<unknown>();
  staleFailure.state.requestImpl = () => failureResult.promise;
  const pendingFailure = staleFailure.controller.reload({ id: "user-one" });
  staleFailure.controller.invalidate();
  failureResult.reject(new Error("stale failure"));
  await pendingFailure;
  assert.deepEqual(staleFailure.calls.errors, [""]);
  assert.deepEqual(staleFailure.calls.loading, [true]);
});

test("profile save validates auth, persists patches, and normalizes current errors", async () => {
  const signedOut = createProfileHarness();
  await assert.rejects(
    signedOut.controller.saveProfile(null, { heightCm: 170 }),
    /Sign in is required/u,
  );
  assert.equal(signedOut.calls.requests.length, 0);

  const success = createProfileHarness();
  success.state.requestImpl = async () => ({ profile: profile("saved") });
  const patch = { heightCm: 175, measurementSystem: "imperial" as const };
  assert.equal((await success.controller.saveProfile({ id: "saved" }, patch)).id, "saved");
  assert.deepEqual(success.calls.requests[0], {
    path: "/api/v1/auth/profile",
    init: { method: "PATCH", body: JSON.stringify(patch) },
  });
  assert.equal(success.calls.profiles.at(-1)?.id, "saved");
  assert.deepEqual(success.calls.saving, [true, false]);

  const errorFailure = createProfileHarness();
  const saveError = new Error("Save rejected");
  errorFailure.state.requestImpl = async () => {
    throw saveError;
  };
  await assert.rejects(
    errorFailure.controller.saveProfile({ id: "user-one" }, { bodyWeightKg: 75 }),
    (caught) => caught === saveError,
  );
  assert.equal(errorFailure.calls.errors.at(-1), "Save rejected");

  const unknownFailure = createProfileHarness();
  unknownFailure.state.requestImpl = async () => {
    throw { code: "unknown" };
  };
  await assert.rejects(
    unknownFailure.controller.saveProfile({ id: "user-one" }, { bodyWeightKg: 75 }),
    /Profile could not be saved/u,
  );
  assert.equal(unknownFailure.calls.errors.at(-1), "Profile could not be saved.");
});

test("profile save returns or throws stale results without overwriting newer state", async () => {
  const staleSuccess = createProfileHarness();
  const successResult = new Deferred<unknown>();
  staleSuccess.state.requestImpl = () => successResult.promise;
  const pendingSuccess = staleSuccess.controller.saveProfile(
    { id: "user-one" },
    { heightCm: 181 },
  );
  staleSuccess.controller.invalidate();
  successResult.resolve({ profile: profile("stale-saved") });
  assert.equal((await pendingSuccess).id, "stale-saved");
  assert.deepEqual(staleSuccess.calls.profiles, []);
  assert.deepEqual(staleSuccess.calls.saving, [true]);

  const staleFailure = createProfileHarness();
  const failureResult = new Deferred<unknown>();
  staleFailure.state.requestImpl = () => failureResult.promise;
  const staleError = new Error("stale error");
  const pendingFailure = staleFailure.controller.saveProfile(
    { id: "user-one" },
    { heightCm: 182 },
  );
  staleFailure.controller.invalidate();
  failureResult.reject(staleError);
  await assert.rejects(pendingFailure, (caught) => caught === staleError);
  assert.deepEqual(staleFailure.calls.errors, [""]);
  assert.deepEqual(staleFailure.calls.saving, [true]);
});
