import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import {
  ApiError,
  apiRequest,
  configureApiSession,
  rawApiRequest,
  refreshWithToken,
} from "../api/client";
import type { NativeSession, SessionUser } from "../api/types";
import { signInWithGoogle, signOutFromGoogle } from "./google-signin";
import {
  deleteRefreshToken,
  getRefreshToken,
  setRefreshToken,
} from "./session-storage";
import { configurePendingSetWriteOwner } from "../api/pending-writes";

type AuthContextValue = {
  isLoading: boolean;
  user: SessionUser | null;
  error: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState("");
  const tokenRef = useRef<string | null>(null);
  const refreshingRef = useRef<Promise<boolean> | null>(null);

  const applySession = useCallback(async (session: NativeSession) => {
    tokenRef.current = session.accessToken;
    await setRefreshToken(session.refreshToken);
    await configurePendingSetWriteOwner(session.user.id);
    setUser(session.user);
    configureApiSession({
      token: session.accessToken,
      refresh: refresh,
    });
  // `refresh` is stable after initialization and reads refs only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    if (Platform.OS === "web") return false;
    if (refreshingRef.current) return refreshingRef.current;
    refreshingRef.current = (async () => {
      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) return false;
        const session = await refreshWithToken(refreshToken);
        tokenRef.current = session.accessToken;
        await setRefreshToken(session.refreshToken);
        await configurePendingSetWriteOwner(session.user.id);
        setUser(session.user);
        configureApiSession({ token: session.accessToken, refresh });
        return true;
      } catch {
        tokenRef.current = null;
        await deleteRefreshToken();
        await configurePendingSetWriteOwner(null);
        setUser(null);
        configureApiSession({ token: null, refresh });
        return false;
      } finally {
        refreshingRef.current = null;
      }
    })();
    return refreshingRef.current;
  }, []);

  const restore = useCallback(async () => {
    setIsLoading(true);
    setError("");
    configureApiSession({ token: tokenRef.current, refresh });
    try {
      if (Platform.OS === "web") {
        const session = await rawApiRequest<{ user: SessionUser }>("/api/v1/auth/session");
        await configurePendingSetWriteOwner(session.user.id);
        setUser(session.user);
      } else {
        await refresh();
      }
    } catch (caught) {
      await configurePendingSetWriteOwner(null);
      setUser(null);
      if (
        Platform.OS === "web" &&
        caught instanceof ApiError &&
        caught.status === 401 &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("auth") === "returned"
      ) {
        setError("This ChatGPT account is not authorized for this tracker.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const signIn = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      if (Platform.OS === "web") {
        const returnTo = encodeURIComponent("/sign-in?auth=returned");
        window.location.assign(`/signin-with-chatgpt?return_to=${returnTo}`);
        return;
      }
      const idToken = await signInWithGoogle();
      const session = await rawApiRequest<NativeSession>("/api/v1/auth/google/exchange", {
        method: "POST",
        body: JSON.stringify({ idToken, deviceName: "Android phone" }),
      });
      await applySession(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setIsLoading(false);
    }
  }, [applySession]);

  const signOut = useCallback(async () => {
    setIsLoading(true);
    try {
      if (tokenRef.current) {
        await apiRequest("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
      }
      tokenRef.current = null;
      configureApiSession({ token: null, refresh });
      await deleteRefreshToken();
      await configurePendingSetWriteOwner(null);
      setUser(null);
      if (Platform.OS === "web") {
        window.location.assign("/signout-with-chatgpt?return_to=/");
      } else {
        await signOutFromGoogle().catch(() => undefined);
      }
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ isLoading, user, error, signIn, signOut, retry: restore }),
    [error, isLoading, restore, signIn, signOut, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
