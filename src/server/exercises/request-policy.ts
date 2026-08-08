export type ExerciseRequestOperation =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "progress"; exerciseId: string }
  | { kind: "favorite"; exerciseId: string; favorite: boolean }
  | { kind: "get"; exerciseId: string }
  | { kind: "update"; exerciseId: string }
  | { kind: "archive"; exerciseId: string }
  | { kind: "method_not_allowed" };

export function exerciseRequestOperation(
  method: string,
  segments: readonly string[],
): ExerciseRequestOperation {
  const exerciseId = segments[1];
  const action = segments[2];
  if (!exerciseId) {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "create" };
    return { kind: "method_not_allowed" };
  }
  if (action === "progress") {
    return method === "GET"
      ? { kind: "progress", exerciseId }
      : { kind: "method_not_allowed" };
  }
  if (action === "favorite") {
    if (method === "PUT" || method === "DELETE") {
      return { kind: "favorite", exerciseId, favorite: method === "PUT" };
    }
    return { kind: "method_not_allowed" };
  }
  if (method === "GET") return { kind: "get", exerciseId };
  if (method === "PATCH") return { kind: "update", exerciseId };
  if (method === "DELETE") return { kind: "archive", exerciseId };
  return { kind: "method_not_allowed" };
}

export function exerciseListQuery(url: URL) {
  return {
    includeArchived: url.searchParams.get("includeArchived") === "true",
    search: url.searchParams.get("search") ?? undefined,
    availableOnly: url.searchParams.get("scope") !== "all",
  };
}

export function exerciseProgressQuery(url: URL): {
  from?: string;
  limit: number;
  unit?: "lb" | "kg";
} {
  const unit = url.searchParams.get("unit");
  if (unit !== null && unit !== "lb" && unit !== "kg") {
    throw new Error("Progress weight unit must be lb or kg.");
  }
  return {
    from: url.searchParams.get("from") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 16),
    unit: unit ?? undefined,
  };
}
