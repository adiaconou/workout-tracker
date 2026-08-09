export type ApiRootRoute =
  | "google_exchange"
  | "refresh"
  | "auth"
  | "onboarding"
  | "bootstrap"
  | "exercises"
  | "programs"
  | "routines"
  | "workouts"
  | "assistant"
  | "not_found";

export function apiPathSegments(pathname: string) {
  return pathname
    .replace(/^\/api\/v1\/?/u, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}

export function apiRootRoute(segments: readonly string[]): ApiRootRoute {
  if (
    segments[0] === "auth"
    && segments[1] === "google"
    && segments[2] === "exchange"
  ) return "google_exchange";
  if (segments[0] === "auth" && segments[1] === "refresh") return "refresh";
  if (segments[0] === "auth") return "auth";
  if (segments[0] === "onboarding") return "onboarding";
  if (segments[0] === "bootstrap") return "bootstrap";
  if (segments[0] === "exercises") return "exercises";
  if (segments[0] === "programs") return "programs";
  if (segments[0] === "routines") return "routines";
  if (segments[0] === "workouts") return "workouts";
  if (segments[0] === "assistant") return "assistant";
  return "not_found";
}
