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
import type { UserProfile, UserProfilePatch } from "../../domain/profile";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/public";
import {
  createProfileController,
  type ProfileController,
  profileForUser,
} from "./profile-controller";

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
  const controllerRef = useRef<ProfileController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = createProfileController({
      request: apiRequest,
      setProfile,
      setLoading: setIsLoading,
      setSaving: setIsSaving,
      setError,
    });
  }
  const controller = controllerRef.current;

  const reload = useCallback(() => controller.reload(user), [controller, user]);
  const saveProfile = useCallback(
    (patch: UserProfilePatch) => controller.saveProfile(user, patch),
    [controller, user],
  );

  useEffect(() => {
    void reload();
    return controller.invalidate;
  }, [controller, reload]);

  const visibleProfile = profileForUser(user, profile);

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
