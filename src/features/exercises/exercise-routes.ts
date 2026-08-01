import type { Href } from "expo-router";

export function exerciseDetailHref(exerciseId: string): Href {
  return {
    pathname: "/exercises/[exerciseId]",
    params: { exerciseId },
  };
}

export function exerciseIdFromParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
