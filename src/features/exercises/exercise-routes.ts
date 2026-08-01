import type { Href } from "expo-router";

const ROUTE_ID_PREFIX = "v1.";

export function exerciseDetailHref(exerciseId: string): Href {
  return {
    pathname: "/exercises/[exerciseId]",
    params: { exerciseId: encodeRouteId(exerciseId) },
  };
}

export function exerciseIdFromParam(value: string | string[] | undefined) {
  const routeId = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  if (!routeId.startsWith(ROUTE_ID_PREFIX)) return routeId;

  try {
    return decodeURIComponent(
      routeId.slice(ROUTE_ID_PREFIX.length).replace(/~/gu, "%"),
    );
  } catch {
    return "";
  }
}

function encodeRouteId(exerciseId: string) {
  const uriEncoded = encodeURIComponent(exerciseId).replace(/~/gu, "%7E");
  return `${ROUTE_ID_PREFIX}${uriEncoded.replace(/%/gu, "~")}`;
}
