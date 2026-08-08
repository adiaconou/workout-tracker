import type { RoutineVersionInput } from "../../domain/entities";

export type RoutineRequestOperation =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "editor_get"; routineId: string }
  | { kind: "editor_update"; routineId: string }
  | { kind: "prescription_get"; routineId: string }
  | { kind: "prescription_legacy_write"; routineId: string }
  | { kind: "versions_list"; routineId: string }
  | { kind: "version_create"; routineId: string }
  | { kind: "version_publish"; routineId: string; versionId: string }
  | { kind: "version_get"; routineId: string; versionId: string }
  | { kind: "version_update"; routineId: string; versionId: string }
  | { kind: "version_delete"; routineId: string; versionId: string }
  | { kind: "get"; routineId: string }
  | { kind: "update"; routineId: string }
  | { kind: "archive"; routineId: string }
  | { kind: "method_not_allowed" };

export function routineRequestOperation(
  method: string,
  segments: readonly string[],
): RoutineRequestOperation {
  const routineId = segments[1];
  const child = segments[2];
  const childId = segments[3];
  const action = segments[4];
  if (!routineId) {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "create" };
    return { kind: "method_not_allowed" };
  }
  if (child === "editor") {
    if (method === "GET") return { kind: "editor_get", routineId };
    if (method === "PATCH") return { kind: "editor_update", routineId };
    return { kind: "method_not_allowed" };
  }
  if (child === "prescription") {
    if (method === "GET") return { kind: "prescription_get", routineId };
    if (method === "PATCH") return { kind: "prescription_legacy_write", routineId };
    return { kind: "method_not_allowed" };
  }
  if (child === "versions") {
    if (!childId) {
      if (method === "GET") return { kind: "versions_list", routineId };
      if (method === "POST") return { kind: "version_create", routineId };
      return { kind: "method_not_allowed" };
    }
    if (action === "publish" && method === "POST") {
      return { kind: "version_publish", routineId, versionId: childId };
    }
    if (method === "GET") return { kind: "version_get", routineId, versionId: childId };
    if (method === "PATCH") return { kind: "version_update", routineId, versionId: childId };
    if (method === "DELETE") return { kind: "version_delete", routineId, versionId: childId };
    return { kind: "method_not_allowed" };
  }
  if (method === "GET") return { kind: "get", routineId };
  if (method === "PATCH") return { kind: "update", routineId };
  if (method === "DELETE") return { kind: "archive", routineId };
  return { kind: "method_not_allowed" };
}

export function routineListIncludesArchived(url: URL) {
  return url.searchParams.get("includeArchived") === "true";
}

export function routineCreationInput(payload: {
  code?: string;
  version?: RoutineVersionInput;
}) {
  return payload.code && payload.version
    ? { code: payload.code, version: payload.version }
    : null;
}

export function routineEditorInput(payload: {
  baseVersionId?: string;
  proposedRoutine?: RoutineVersionInput;
}) {
  const baseVersionId = typeof payload.baseVersionId === "string"
    ? payload.baseVersionId.trim()
    : "";
  return baseVersionId && payload.proposedRoutine
    ? { baseVersionId, proposedRoutine: payload.proposedRoutine }
    : null;
}
