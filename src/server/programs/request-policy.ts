export type ProgramRequestOperation =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "get"; programId: string }
  | { kind: "activate"; programId: string }
  | { kind: "method_not_allowed" };

export function programRequestOperation(
  method: string,
  segments: readonly string[],
): ProgramRequestOperation {
  const programId = segments[1];
  if (!programId) {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "create" };
    return { kind: "method_not_allowed" };
  }
  if (segments.length === 3 && segments[2] === "activate") {
    return method === "POST"
      ? { kind: "activate", programId }
      : { kind: "method_not_allowed" };
  }
  if (segments.length !== 2) return { kind: "method_not_allowed" };
  return method === "GET"
    ? { kind: "get", programId }
    : { kind: "method_not_allowed" };
}

export function programIdempotencyKey(request: Request) {
  return request.headers.get("x-idempotency-key")?.trim() ?? "";
}
