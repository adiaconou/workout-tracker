export type WorkoutRequestOperation =
  | { kind: "list" }
  | { kind: "start" }
  | { kind: "history_get"; workoutId: string }
  | { kind: "set_record"; workoutId: string }
  | { kind: "set_correct"; workoutId: string; setId: string }
  | { kind: "rest_skip"; workoutId: string }
  | { kind: "complete"; workoutId: string }
  | { kind: "discard"; workoutId: string }
  | { kind: "get"; workoutId: string }
  | { kind: "update"; workoutId: string }
  | { kind: "archive"; workoutId: string }
  | { kind: "method_not_allowed" };

export function workoutRequestOperation(
  method: string,
  segments: readonly string[],
): WorkoutRequestOperation {
  const workoutId = segments[1];
  const child = segments[2];
  const childId = segments[3];
  if (!workoutId) {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "start" };
    return { kind: "method_not_allowed" };
  }
  if (child === "history" && !childId && method === "GET") {
    return { kind: "history_get", workoutId };
  }
  if (child === "sets" && !childId && method === "POST") {
    return { kind: "set_record", workoutId };
  }
  if (child === "sets" && childId && method === "PATCH") {
    return { kind: "set_correct", workoutId, setId: childId };
  }
  if (child === "rest" && childId === "skip" && method === "POST") {
    return { kind: "rest_skip", workoutId };
  }
  if (child === "complete" && !childId && method === "POST") {
    return { kind: "complete", workoutId };
  }
  if (child === "discard" && !childId && method === "DELETE") {
    return { kind: "discard", workoutId };
  }
  if (!child) {
    if (method === "GET") return { kind: "get", workoutId };
    if (method === "PATCH") return { kind: "update", workoutId };
    if (method === "DELETE") return { kind: "archive", workoutId };
  }
  return { kind: "method_not_allowed" };
}

export type WorkoutListRequest =
  | {
    kind: "history";
    query: {
      from?: string;
      to?: string;
      routineCode?: string;
      status?: string;
      exerciseSearch?: string;
      limit: number;
      offset: number;
    };
  }
  | {
    kind: "list";
    query: { includeArchived: boolean; status?: string };
  };

export function workoutListRequest(url: URL): WorkoutListRequest {
  if (url.searchParams.get("view") === "history") {
    return {
      kind: "history",
      query: {
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        routineCode: url.searchParams.get("routineCode") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        exerciseSearch: url.searchParams.get("exercise") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 20),
        offset: Number(url.searchParams.get("offset") ?? 0),
      },
    };
  }
  return {
    kind: "list",
    query: {
      includeArchived: url.searchParams.get("includeArchived") === "true",
      status: url.searchParams.get("status") ?? undefined,
    },
  };
}

export function workoutStartInput(payload: {
  routineId?: string;
  abandonActive?: boolean;
  expectedRoutineVersionId?: string;
}) {
  return payload.routineId
    ? {
      routineId: payload.routineId,
      abandonActive: Boolean(payload.abandonActive),
      expectedRoutineVersionId: payload.expectedRoutineVersionId,
    }
    : null;
}

export function requestHasJsonBody(contentType: string | null) {
  return contentType?.toLowerCase().includes("application/json") === true;
}
