import {
  currentOnboardingVersion,
  equipmentDescription,
  isTrainingProfileComplete,
  validateTrainingProfileInput,
  type TrainingProfile,
} from "../domain/training-profile";
import { apiError, apiResponse, errorMessage, readJson } from "./http";
import type { ApiUser, WorkerEnv } from "./types";

export async function handleOnboardingRequest(
  request: Request,
  env: WorkerEnv,
  user: ApiUser,
) {
  if (request.method === "GET") {
    return apiResponse(request, { trainingProfile: user.trainingProfile });
  }
  if (request.method !== "PUT") {
    return apiError(
      request,
      405,
      "method_not_allowed",
      "Use GET or PUT for onboarding preferences.",
    );
  }

  try {
    const input = validateTrainingProfileInput(await readJson<unknown>(request));
    const firstCompletion = !isTrainingProfileComplete(user.trainingProfile);
    const now = new Date().toISOString();
    const trainingProfile: TrainingProfile = {
      ...input,
      onboardingCompletedAt: firstCompletion
        ? now
        : user.trainingProfile.onboardingCompletedAt ?? now,
      onboardingCompleted: true,
    };
    const model = env.OPENAI_DEFAULT_MODEL?.trim() || "gpt-5.6-terra";
    const equipment = equipmentDescription(trainingProfile.equipment);
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE app_users SET equipment_preferences_json = ?,
        preferred_workout_duration_min = ?, onboarding_version = ?,
        onboarding_completed_at = COALESCE(onboarding_completed_at, ?), updated_at = ?
        WHERE id = ? AND owner_email = ?`).bind(
        JSON.stringify(trainingProfile.equipment),
        trainingProfile.sessionDurationMin,
        currentOnboardingVersion,
        trainingProfile.onboardingCompletedAt,
        now,
        user.id,
        user.email,
      ),
      env.DB.prepare(`INSERT OR IGNORE INTO coach_profiles (
        owner_email, primary_goal, training_days_per_week, session_duration_min,
        equipment, limitations, preferences, model, reasoning_effort,
        created_at, updated_at
      ) VALUES (?, 'general fitness', 4, ?, ?, '', '', ?, 'medium', ?, ?)`).bind(
        user.email,
        trainingProfile.sessionDurationMin,
        equipment,
        model,
        now,
        now,
      ),
      env.DB.prepare(`UPDATE coach_profiles SET session_duration_min = ?,
        equipment = ?, updated_at = ? WHERE owner_email = ?`).bind(
        trainingProfile.sessionDurationMin,
        equipment,
        now,
        user.email,
      ),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      return apiError(request, 404, "user_not_found", "User account not found.");
    }

    return apiResponse(request, {
      user: sessionUser({ ...user, trainingProfile }),
      firstCompletion,
    });
  } catch (error) {
    return apiError(
      request,
      400,
      "onboarding_invalid",
      errorMessage(error, "Training preferences could not be saved."),
    );
  }
}

export function sessionUser(user: ApiUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoUrl,
    trainingProfile: user.trainingProfile,
  };
}
