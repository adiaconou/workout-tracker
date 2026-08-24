import {
  createContext,
  type PropsWithChildren,
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
import { configurePendingSetWriteOwner } from "../api/pending-writes";
import type { SessionUser, TrainingProfile } from "../../contracts/api";
import { createAuthController, type AuthController } from "./auth-controller";
import { signInWithGoogle, signOutFromGoogle } from "./google-signin";
import {
  deleteRefreshToken,
  getRefreshToken,
  setRefreshToken,
} from "./session-storage";

type AuthContextValue = {
  isLoading: boolean;
  user: SessionUser | null;
  error: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
  completeTrainingSetup: (
    input: Pick<
      TrainingProfile,
      "equipment" | "sessionDurationMin" | "progressiveTrainingEnabled"
    >,
  ) => Promise<{ firstCompletion: boolean }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState("");
  const controllerRef = useRef<AuthController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = createAuthController({
      platform: () => Platform.OS,
      configureSession: configureApiSession,
      configurePendingWriteOwner: configurePendingSetWriteOwner,
      getRefreshToken,
      setRefreshToken,
      deleteRefreshToken,
      refreshWithToken,
      rawRequest: rawApiRequest,
      request: apiRequest,
      signInWithGoogle,
      signOutFromGoogle,
      redirect: (location) => window.location.assign(location),
      locationSearch: () => typeof window === "undefined" ? null : window.location.search,
      isUnauthorizedError: (caught) => caught instanceof ApiError && caught.status === 401,
      setLoading: setIsLoading,
      setUser,
      setError,
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    void controller.restore();
  }, [controller]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      user,
      error,
      signIn: controller.signIn,
      signOut: controller.signOut,
      retry: controller.restore,
      completeTrainingSetup: controller.completeTrainingSetup,
    }),
    [controller, error, isLoading, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
