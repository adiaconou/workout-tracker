import type { NativeSession, SessionUser, TrainingProfile } from "../../contracts/api";

type SessionConfiguration = {
  token: string | null;
  refresh: () => Promise<boolean>;
};

export type AuthControllerDependencies = {
  platform: () => string;
  configureSession: (configuration: SessionConfiguration) => void;
  configurePendingWriteOwner: (userId: string | null) => Promise<void>;
  getRefreshToken: () => Promise<string | null>;
  setRefreshToken: (refreshToken: string) => Promise<void>;
  deleteRefreshToken: () => Promise<void>;
  refreshWithToken: (refreshToken: string) => Promise<NativeSession>;
  rawRequest: <T>(path: string, init?: RequestInit) => Promise<T>;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  signInWithGoogle: () => Promise<string>;
  signOutFromGoogle: () => Promise<void>;
  redirect: (location: string) => void;
  locationSearch: () => string | null;
  isUnauthorizedError: (caught: unknown) => boolean;
  setLoading: (isLoading: boolean) => void;
  setUser: (user: SessionUser | null) => void;
  setError: (error: string) => void;
};

export function createAuthController(dependencies: AuthControllerDependencies) {
  let accessToken: string | null = null;
  let refreshing: Promise<boolean> | null = null;

  async function applySession(session: NativeSession) {
    accessToken = session.accessToken;
    await dependencies.setRefreshToken(session.refreshToken);
    await dependencies.configurePendingWriteOwner(session.user.id);
    dependencies.setUser(session.user);
    dependencies.configureSession({ token: session.accessToken, refresh });
  }

  async function refresh() {
    if (dependencies.platform() === "web") return false;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const refreshToken = await dependencies.getRefreshToken();
        if (!refreshToken) return false;
        const session = await dependencies.refreshWithToken(refreshToken);
        await applySession(session);
        return true;
      } catch {
        accessToken = null;
        await dependencies.deleteRefreshToken();
        await dependencies.configurePendingWriteOwner(null);
        dependencies.setUser(null);
        dependencies.configureSession({ token: null, refresh });
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function restore() {
    dependencies.setLoading(true);
    dependencies.setError("");
    dependencies.configureSession({ token: accessToken, refresh });
    try {
      if (dependencies.platform() === "web") {
        const session = await dependencies.rawRequest<{ user: SessionUser }>(
          "/api/v1/auth/session",
        );
        await dependencies.configurePendingWriteOwner(session.user.id);
        dependencies.setUser(session.user);
      } else {
        await refresh();
      }
    } catch (caught) {
      await dependencies.configurePendingWriteOwner(null);
      dependencies.setUser(null);
      if (
        dependencies.platform() === "web" &&
        dependencies.isUnauthorizedError(caught)
      ) {
        const search = dependencies.locationSearch();
        if (search !== null && new URLSearchParams(search).get("auth") === "returned") {
          dependencies.setError("This ChatGPT account is not authorized for this tracker.");
        }
      }
    } finally {
      dependencies.setLoading(false);
    }
  }

  async function signIn() {
    dependencies.setLoading(true);
    dependencies.setError("");
    try {
      if (dependencies.platform() === "web") {
        const returnTo = encodeURIComponent("/sign-in?auth=returned");
        dependencies.redirect(`/signin-with-chatgpt?return_to=${returnTo}`);
        return;
      }
      const idToken = await dependencies.signInWithGoogle();
      const session = await dependencies.rawRequest<NativeSession>(
        "/api/v1/auth/google/exchange",
        {
          method: "POST",
          body: JSON.stringify({ idToken, deviceName: "Android phone" }),
        },
      );
      await applySession(session);
    } catch (caught) {
      dependencies.setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      dependencies.setLoading(false);
    }
  }

  async function signOut() {
    dependencies.setLoading(true);
    try {
      if (accessToken) {
        await dependencies.request("/api/v1/auth/logout", { method: "POST" })
          .catch(() => undefined);
      }
      accessToken = null;
      dependencies.configureSession({ token: null, refresh });
      await dependencies.deleteRefreshToken();
      await dependencies.configurePendingWriteOwner(null);
      dependencies.setUser(null);
      if (dependencies.platform() === "web") {
        dependencies.redirect("/signout-with-chatgpt?return_to=/");
      } else {
        await dependencies.signOutFromGoogle().catch(() => undefined);
      }
    } finally {
      dependencies.setLoading(false);
    }
  }

  async function completeTrainingSetup(
    input: Pick<TrainingProfile, "equipment" | "sessionDurationMin">,
  ) {
    const payload = await dependencies.request<{
      user: SessionUser;
      firstCompletion: boolean;
    }>("/api/v1/onboarding", {
      method: "PUT",
      body: JSON.stringify(input),
    });
    dependencies.setUser(payload.user);
    return { firstCompletion: payload.firstCompletion };
  }

  return {
    refresh,
    restore,
    signIn,
    signOut,
    completeTrainingSetup,
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
