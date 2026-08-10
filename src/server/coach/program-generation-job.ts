export const PROGRAM_GENERATION_POLL_AFTER_MS = 2_000;
export const PROGRAM_GENERATION_LIFETIME_MS = 10 * 60_000;
export const PROGRAM_GENERATION_TERMINAL_RETENTION_MS = 24 * 60 * 60_000;
// Longer than the 15-second start request timeout, so an in-flight request gets one bounded attach window.
export const PROGRAM_GENERATION_START_RECONCILIATION_MS = 20_000;
export const PROGRAM_GENERATION_VALIDATION_LEASE_MS = 60_000;

const programGenerationReasoningPreference = ["low", "none", "minimal", "auto"] as const;
const programGenerationRemoteStatuses = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "incomplete",
  "cancelled",
] as const;

export type ProgramGenerationRemoteStatus = typeof programGenerationRemoteStatuses[number];

export type ProgramGenerationRemoteResult =
  | { kind: "pending"; status: "queued" | "in_progress" }
  | { kind: "ready"; status: "completed" }
  | { kind: "failed"; status: "failed" | "incomplete"; error: string }
  | { kind: "cancelled"; status: "cancelled" };

export function normalizeProgramGenerationIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Program generation idempotency key is required.");
  }
  const key = value.trim();
  if (key.length < 8) {
    throw new Error("Program generation idempotency key must contain at least 8 characters.");
  }
  if (key.length > 128) {
    throw new Error("Program generation idempotency key cannot exceed 128 characters.");
  }
  return key;
}

export async function fingerprintProgramGenerationRequest(value: unknown) {
  const canonical = canonicalJson(value, new Set<object>());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function selectProgramGenerationReasoningEffort(availableEfforts: readonly string[]) {
  const effort = programGenerationReasoningPreference.find((candidate) => (
    availableEfforts.includes(candidate)
  ));
  if (!effort) {
    throw new Error("Program generation requires low, none, minimal, or auto reasoning support.");
  }
  return effort;
}

export function parseProgramGenerationRemoteStatus(value: unknown): ProgramGenerationRemoteStatus {
  if (
    typeof value !== "string"
    || !programGenerationRemoteStatuses.includes(value as ProgramGenerationRemoteStatus)
  ) {
    throw new Error(`Unsupported program generation response status: ${String(value)}.`);
  }
  return value as ProgramGenerationRemoteStatus;
}

export function extractProgramGenerationRemoteError(value: unknown) {
  const response = requiredRecord(value);
  const explicitError = optionalRecord(response.error)?.message;
  if (typeof explicitError === "string" && explicitError.trim()) return explicitError.trim();

  const status = parseProgramGenerationRemoteStatus(response.status);
  if (status === "incomplete") {
    const reason = optionalRecord(response.incomplete_details)?.reason;
    if (reason === "max_output_tokens") {
      return "The model ran out of response capacity before completing the routine program.";
    }
    if (typeof reason === "string" && reason.trim()) {
      return `The model returned an incomplete routine program (${reason.trim()}).`;
    }
    return "The model returned an incomplete routine program.";
  }
  if (status === "failed") return "The model failed to generate the routine program.";
  return null;
}

export function mapProgramGenerationRemoteResponse(value: unknown): ProgramGenerationRemoteResult {
  const response = requiredRecord(value);
  const status = parseProgramGenerationRemoteStatus(response.status);
  if (status === "queued" || status === "in_progress") return { kind: "pending", status };
  if (status === "completed") return { kind: "ready", status };
  if (status === "cancelled") return { kind: "cancelled", status };
  return {
    kind: "failed",
    status,
    error: extractProgramGenerationRemoteError(response)!,
  };
}

export function programGenerationExpiresAt(createdAt: string) {
  return new Date(timestamp(createdAt, "Program generation creation time") + PROGRAM_GENERATION_LIFETIME_MS)
    .toISOString();
}

export function programGenerationTerminalRetainedUntil(terminalAt: string) {
  return new Date(
    timestamp(terminalAt, "Program generation terminal time")
    + PROGRAM_GENERATION_TERMINAL_RETENTION_MS,
  ).toISOString();
}

export function programGenerationIsExpired(expiresAt: string, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Current time is invalid.");
  return now >= timestamp(expiresAt, "Program generation expiry time");
}

export function programGenerationAwaitsResponseAttachment(updatedAt: string, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Current time is invalid.");
  return now < timestamp(updatedAt, "Program generation update time")
    + PROGRAM_GENERATION_START_RECONCILIATION_MS;
}

export function programGenerationValidationLeaseStaleBefore(now: string) {
  return new Date(
    timestamp(now, "Program generation validation claim time")
    - PROGRAM_GENERATION_VALIDATION_LEASE_MS,
  ).toISOString();
}

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Program generation request must contain only finite numbers.");
    return JSON.stringify(value);
  }
  if (!value || typeof value !== "object") {
    throw new Error("Program generation request must be JSON-serializable.");
  }
  if (ancestors.has(value)) {
    throw new Error("Program generation request must not contain circular references.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (entry) => canonicalJson(entry, ancestors)).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("Program generation request must contain only plain JSON objects.");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`
    )).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function requiredRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The program generation response must be an object.");
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timestamp(value: string, label: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}
