import type { UserProfile, UserProfilePatch } from "../../domain/profile";

export type ProfileControllerUser = { id: string } | null;

export type ProfileControllerDependencies = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  setProfile: (profile: UserProfile | null) => void;
  setLoading: (isLoading: boolean) => void;
  setSaving: (isSaving: boolean) => void;
  setError: (error: string) => void;
};

export function profileForUser(
  user: ProfileControllerUser,
  profile: UserProfile | null,
) {
  return user && profile?.id === user.id ? profile : null;
}

export function createProfileController(dependencies: ProfileControllerDependencies) {
  let requestGeneration = 0;

  async function reload(user: ProfileControllerUser) {
    const generation = ++requestGeneration;
    dependencies.setSaving(false);
    if (!user) {
      dependencies.setProfile(null);
      dependencies.setError("");
      dependencies.setLoading(false);
      return;
    }
    dependencies.setLoading(true);
    dependencies.setError("");
    try {
      const payload = await dependencies.request<{ profile: UserProfile }>(
        "/api/v1/auth/profile",
      );
      if (requestGeneration === generation) dependencies.setProfile(payload.profile);
    } catch (caught) {
      if (requestGeneration === generation) {
        dependencies.setError(
          caught instanceof Error ? caught.message : "Profile could not be loaded.",
        );
      }
    } finally {
      if (requestGeneration === generation) dependencies.setLoading(false);
    }
  }

  async function saveProfile(user: ProfileControllerUser, patch: UserProfilePatch) {
    if (!user) throw new Error("Sign in is required to save a profile.");
    const generation = ++requestGeneration;
    dependencies.setSaving(true);
    dependencies.setError("");
    try {
      const payload = await dependencies.request<{ profile: UserProfile }>(
        "/api/v1/auth/profile",
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
      );
      if (requestGeneration === generation) dependencies.setProfile(payload.profile);
      return payload.profile;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Profile could not be saved.";
      if (requestGeneration === generation) dependencies.setError(message);
      throw caught instanceof Error ? caught : new Error(message);
    } finally {
      if (requestGeneration === generation) dependencies.setSaving(false);
    }
  }

  function invalidate() {
    requestGeneration += 1;
  }

  return { reload, saveProfile, invalidate };
}

export type ProfileController = ReturnType<typeof createProfileController>;
