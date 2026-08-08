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
import { apiRequest } from "../api/client";
import type { UserProfile, UserProfilePatch } from "../../domain/profile";
import { useAuth } from "../auth/auth-context";

type ProfileContextValue = {
  profile: UserProfile | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string;
  reload: () => Promise<void>;
  saveProfile: (patch: UserProfilePatch) => Promise<UserProfile>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setIsSaving(false);
    if (!user) {
      setProfile(null);
      setError("");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ profile: UserProfile }>("/api/v1/auth/profile");
      if (requestGeneration.current === generation) setProfile(payload.profile);
    } catch (caught) {
      if (requestGeneration.current === generation) {
        setError(caught instanceof Error ? caught.message : "Profile could not be loaded.");
      }
    } finally {
      if (requestGeneration.current === generation) setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
    return () => {
      requestGeneration.current += 1;
    };
  }, [reload]);

  const saveProfile = useCallback(async (patch: UserProfilePatch) => {
    if (!user) throw new Error("Sign in is required to save a profile.");
    const generation = ++requestGeneration.current;
    setIsSaving(true);
    setError("");
    try {
      const payload = await apiRequest<{ profile: UserProfile }>("/api/v1/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (requestGeneration.current === generation) setProfile(payload.profile);
      return payload.profile;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Profile could not be saved.";
      if (requestGeneration.current === generation) setError(message);
      throw caught instanceof Error ? caught : new Error(message);
    } finally {
      if (requestGeneration.current === generation) setIsSaving(false);
    }
  }, [user]);

  const visibleProfile = user && profile?.id === user.id ? profile : null;

  const value = useMemo<ProfileContextValue>(() => ({
    profile: visibleProfile,
    isLoading,
    isSaving,
    error,
    reload,
    saveProfile,
  }), [error, isLoading, isSaving, reload, saveProfile, visibleProfile]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside ProfileProvider.");
  return value;
}
