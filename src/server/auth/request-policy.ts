export type AuthRequestOperation =
  | "profile_get"
  | "profile_update"
  | "profile_method_not_allowed"
  | "session_get"
  | "logout"
  | "not_found";

export function authRequestOperation(
  method: string,
  segments: readonly string[],
): AuthRequestOperation {
  if (segments[1] === "profile" && !segments[2]) {
    if (method === "GET") return "profile_get";
    if (method === "PATCH") return "profile_update";
    return "profile_method_not_allowed";
  }
  if (segments[1] === "session" && method === "GET") return "session_get";
  if (segments[1] === "logout" && method === "POST") return "logout";
  return "not_found";
}

export function googleExchangeInput(payload: { idToken?: string; deviceName?: string }) {
  return payload.idToken
    ? { idToken: payload.idToken, deviceName: payload.deviceName ?? "Android device" }
    : null;
}

export function refreshTokenInput(payload: { refreshToken?: string }) {
  return payload.refreshToken || null;
}
