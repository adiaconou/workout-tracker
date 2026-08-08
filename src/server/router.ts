import { isTrainingProfileComplete } from "../domain/training-profile";
import { authenticateRequest } from "./auth/auth";
import {
  handleAuthenticatedAuth,
  handleGoogleExchange,
  handleRefresh,
} from "./auth/routes";
import { handleBootstrap } from "./bootstrap/routes";
import { handleAssistantRequest } from "./coach/assistant";
import { handleExercises } from "./exercises/routes";
import { apiError, errorMessage, preflightResponse } from "./http";
import { handleOnboardingRequest } from "./profile/onboarding";
import type { RouteContext } from "./route-context";
import { handleRoutines } from "./routines/routes";
import { apiPathSegments, apiRootRoute } from "./routing";
import type { WorkerEnv } from "./types";
import { handleWorkouts } from "./workouts/routes";

export async function handleApiRequest(request: Request, env: WorkerEnv) {
  if (request.method === "OPTIONS") return preflightResponse(request);
  const url = new URL(request.url);
  const segments = apiPathSegments(url.pathname);
  const rootRoute = apiRootRoute(segments);

  try {
    if (rootRoute === "google_exchange") return handleGoogleExchange(request, env);
    if (rootRoute === "refresh") return handleRefresh(request, env);

    const user = await authenticateRequest(request, env);
    if (!user) {
      return apiError(request, 401, "authentication_required", "Sign in is required.");
    }
    const context: RouteContext = { request, env, user, segments };

    if (rootRoute === "auth") return handleAuthenticatedAuth(context);
    if (rootRoute === "onboarding") {
      return handleOnboardingRequest(request, env, user);
    }
    if (!isTrainingProfileComplete(user.trainingProfile)) {
      return apiError(
        request,
        409,
        "onboarding_required",
        "Choose your available equipment and workout duration before continuing.",
      );
    }
    if (rootRoute === "bootstrap") return handleBootstrap(context);
    if (rootRoute === "exercises") return handleExercises(context);
    if (rootRoute === "routines") return handleRoutines(context);
    if (rootRoute === "workouts") return handleWorkouts(context);
    if (rootRoute === "assistant") return handleAssistantRequest(context);

    return apiError(request, 404, "route_not_found", "API route not found.");
  } catch (error) {
    return apiError(
      request,
      500,
      "internal_error",
      errorMessage(error, "The request could not be completed."),
      true,
    );
  }
}
