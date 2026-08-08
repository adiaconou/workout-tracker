import {
  createNativeSession,
  linkGoogleIdentity,
  revokeNativeSession,
  rotateNativeSession,
} from "./auth";
import { verifyGoogleIdToken } from "./google";
import { apiError, apiResponse, errorMessage, readJson } from "../http";
import {
  getUserProfile,
  sessionUser,
  updateUserProfile,
} from "../profile/public";
import type { RouteContext } from "../route-context";
import type { WorkerEnv } from "../types";
import {
  authRequestOperation,
  googleExchangeInput,
  refreshTokenInput,
} from "./request-policy";

export async function handleGoogleExchange(request: Request, env: WorkerEnv) {
  if (request.method !== "POST") {
    return apiError(request, 405, "method_not_allowed", "Use POST for Google sign-in.");
  }
  try {
    const payload = await readJson<{ idToken?: string; deviceName?: string }>(request);
    const input = googleExchangeInput(payload);
    if (!input) {
      return apiError(request, 400, "id_token_required", "A Google ID token is required.");
    }
    if (!env.GOOGLE_WEB_CLIENT_ID) {
      return apiError(request, 503, "google_auth_unavailable", "Google sign-in is not configured.");
    }
    const claims = await verifyGoogleIdToken(input.idToken, env.GOOGLE_WEB_CLIENT_ID);
    const user = await linkGoogleIdentity(env, claims);
    const session = await createNativeSession(env, user, input.deviceName);
    return apiResponse(request, session, { status: 201 });
  } catch (error) {
    return apiError(request, 401, "google_sign_in_failed", errorMessage(error, "Google sign-in failed."));
  }
}

export async function handleRefresh(request: Request, env: WorkerEnv) {
  if (request.method !== "POST") {
    return apiError(request, 405, "method_not_allowed", "Use POST to refresh a session.");
  }
  try {
    const payload = await readJson<{ refreshToken?: string }>(request);
    const refreshToken = refreshTokenInput(payload);
    if (!refreshToken) {
      return apiError(request, 400, "refresh_token_required", "A refresh token is required.");
    }
    const session = await rotateNativeSession(env, refreshToken);
    return session
      ? apiResponse(request, session)
      : apiError(request, 401, "refresh_session_invalid", "The device session has expired or was revoked.");
  } catch (error) {
    return apiError(request, 400, "refresh_failed", errorMessage(error, "The session could not be refreshed."));
  }
}

export async function handleAuthenticatedAuth({ request, env, user, segments }: RouteContext) {
  const operation = authRequestOperation(request.method, segments);
  if (operation === "profile_get") {
    const profile = await getUserProfile(env, user);
    return profile
      ? apiResponse(request, { profile })
      : apiError(request, 404, "profile_not_found", "Profile not found.");
  }
  if (operation === "profile_update") {
    try {
      const profile = await updateUserProfile(env, user, await readJson<unknown>(request));
      return profile
        ? apiResponse(request, { profile })
        : apiError(request, 404, "profile_not_found", "Profile not found.");
    } catch (error) {
      return apiError(
        request,
        400,
        "profile_invalid",
        errorMessage(error, "The profile could not be saved."),
      );
    }
  }
  if (operation === "profile_method_not_allowed") {
    return apiError(request, 405, "method_not_allowed", "Use GET or PATCH for the profile.");
  }
  if (operation === "session_get") {
    return apiResponse(request, {
      user: sessionUser(user),
      provider: user.provider,
    });
  }
  if (operation === "logout") {
    if (user.sessionId) await revokeNativeSession(env, user.sessionId);
    return apiResponse(request, { signedOut: true });
  }
  return apiError(request, 404, "auth_route_not_found", "Authentication route not found.");
}
