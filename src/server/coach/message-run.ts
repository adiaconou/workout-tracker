import type {
  CoachMessageRunActivity,
  CoachMessageRunPhase,
} from "../../contracts/api";
import type { CoachResponse, CoachResponseItem } from "./tool-loop";

export const COACH_MESSAGE_RUN_POLL_AFTER_MS = 1_500;
export const COACH_MESSAGE_RUN_LIFETIME_MS = 10 * 60_000;
export const COACH_MESSAGE_RUN_TERMINAL_RETENTION_MS = 24 * 60 * 60_000;
export const COACH_MESSAGE_RUN_START_RECONCILIATION_MS = 20_000;
export const COACH_MESSAGE_RUN_PROCESSING_LEASE_MS = 45_000;
export const COACH_MESSAGE_RUN_MAX_MODEL_ROUNDS = 8;
export const COACH_MESSAGE_RUN_MAX_TOOL_CALLS = 12;
export const COACH_MESSAGE_RUN_MAX_ACTIVITIES = 12;

const remoteStatuses = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "incomplete",
  "cancelled",
] as const;

type RemoteStatus = typeof remoteStatuses[number];

export type CoachMessageRunRemoteResult =
  | { kind: "pending"; status: "queued" | "in_progress" }
  | { kind: "ready"; response: CoachResponse }
  | {
    kind: "failed";
    code: string;
    message: string;
    retryable: boolean;
  };

export type ParsedCoachToolCall = {
  callId: string;
  name: string;
  argumentsValue: Record<string, unknown>;
  parseError: string | null;
};

type ActivityCopy = {
  success: string;
  failure: string;
  purpose: string | null;
};

const activityCopy: Readonly<Record<string, ActivityCopy>> = {
  get_coaching_context: {
    success: "Reviewed your routines and training context",
    failure: "Couldn’t review your training context",
    purpose: "Keeps the response within your equipment, time, and recovery preferences.",
  },
  get_routine: {
    success: "Checked the current routine",
    failure: "Couldn’t check the current routine",
    purpose: "Preserves the parts you didn’t ask to change.",
  },
  list_routine_versions: {
    success: "Reviewed saved routine versions",
    failure: "Couldn’t review saved routine versions",
    purpose: null,
  },
  search_exercises: {
    success: "Searched available exercises",
    failure: "Couldn’t search available exercises",
    purpose: "Finds options supported by your selected equipment.",
  },
  get_exercise: {
    success: "Checked an exercise",
    failure: "Couldn’t check an exercise",
    purpose: null,
  },
  get_workout_history: {
    success: "Reviewed recent workouts",
    failure: "Couldn’t review recent workouts",
    purpose: null,
  },
  get_active_workout: {
    success: "Checked for an active workout",
    failure: "Couldn’t check for an active workout",
    purpose: null,
  },
  propose_new_routine: {
    success: "Prepared a new routine for review",
    failure: "Couldn’t prepare the new routine",
    purpose: "Turns the verified proposal into a review card without changing a routine.",
  },
  propose_routine_change: {
    success: "Prepared a routine change for review",
    failure: "Couldn’t prepare the routine change",
    purpose: "Turns the verified proposal into a review card without changing a routine.",
  },
  propose_exercise_change: {
    success: "Prepared an exercise-library change for review",
    failure: "Couldn’t prepare the exercise-library change",
    purpose: "Turns the verified proposal into a review card without changing the library.",
  },
};

export function normalizeCoachMessageIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Message idempotency key is required.");
  }
  const key = value.trim();
  if (key.length < 8) throw new Error("Message idempotency key must contain at least 8 characters.");
  if (key.length > 128) throw new Error("Message idempotency key cannot exceed 128 characters.");
  return key;
}

export async function fingerprintCoachMessageRequest(value: unknown) {
  const canonical = canonicalJson(value, new Set<object>());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `sha256:${Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function coachMessageRunExpiresAt(createdAt: string) {
  return new Date(timestamp(createdAt, "Coach run creation time") + COACH_MESSAGE_RUN_LIFETIME_MS)
    .toISOString();
}

export function coachMessageRunTerminalRetainedUntil(terminalAt: string) {
  return new Date(
    timestamp(terminalAt, "Coach run terminal time") + COACH_MESSAGE_RUN_TERMINAL_RETENTION_MS,
  ).toISOString();
}

export function coachMessageRunLeaseExpiresAt(claimedAt: string) {
  return new Date(
    timestamp(claimedAt, "Coach run claim time") + COACH_MESSAGE_RUN_PROCESSING_LEASE_MS,
  ).toISOString();
}

export function coachMessageRunIsExpired(expiresAt: string, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Current time is invalid.");
  return now >= timestamp(expiresAt, "Coach run expiry time");
}

export function coachMessageRunAwaitsResponseAttachment(updatedAt: string, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Current time is invalid.");
  return now < timestamp(updatedAt, "Coach run update time")
    + COACH_MESSAGE_RUN_START_RECONCILIATION_MS;
}

export function mapCoachMessageRunRemoteResponse(value: unknown): CoachMessageRunRemoteResult {
  const response = requiredResponse(value);
  const status = parseRemoteStatus(response.status);
  if (status === "queued" || status === "in_progress") return { kind: "pending", status };
  if (status === "completed") return { kind: "ready", response };
  if (status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    return {
      kind: "failed",
      code: "coach_response_incomplete",
      message: reason === "max_output_tokens"
        ? "Coach ran out of response capacity before finishing. Try again or choose a lower reasoning effort."
        : "Coach could not finish this response. Your request is saved and no routine changes were made.",
      retryable: true,
    };
  }
  return {
    kind: "failed",
    code: status === "cancelled" ? "coach_response_cancelled" : "coach_response_failed",
    message: status === "cancelled"
      ? "Coach’s response was cancelled before it finished. Your request is saved."
      : "Coach’s model request failed. Your request is saved and no routine changes were made.",
    retryable: true,
  };
}

export function coachResponseToolCalls(response: CoachResponse): ParsedCoachToolCall[] {
  return (response.output ?? [])
    .filter((item) => item.type === "function_call")
    .map(parseToolCall);
}

export function coachResponseText(response: CoachResponse) {
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();
}

export function coachCallSignature(call: ParsedCoachToolCall) {
  return call.parseError
    ? `${call.name}:invalid`
    : `${call.name}:${canonicalJson(call.argumentsValue, new Set<object>())}`;
}

export function incrementCoachCallSignature(
  counts: Readonly<Record<string, number>>,
  signature: string,
) {
  const count = Math.max(0, Math.floor(Number(counts[signature]) || 0)) + 1;
  return { counts: { ...counts, [signature]: count }, count };
}

export function coachCallRepeatLimit(name: string) {
  return isCoachProposalTool(name) ? 2 : 3;
}

export function isCoachProposalTool(name: string) {
  return [
    "propose_new_routine",
    "propose_routine_change",
    "propose_exercise_change",
  ].includes(name);
}

export function coachProposalCompletionText(name: string) {
  if (name === "propose_new_routine") {
    return "I prepared a new routine for review. Nothing has changed yet.";
  }
  if (name === "propose_routine_change") {
    return "I prepared a routine change for review. Nothing has changed yet.";
  }
  if (name === "propose_exercise_change") {
    return "I prepared an exercise-library change for review. Nothing has changed yet.";
  }
  return null;
}

export function coachRunShouldForceFinal(roundCount: number, toolCallCount: number) {
  return roundCount >= COACH_MESSAGE_RUN_MAX_MODEL_ROUNDS
    || toolCallCount >= COACH_MESSAGE_RUN_MAX_TOOL_CALLS;
}

export function coachRunActivity(
  ordinal: number,
  name: string,
  status: CoachMessageRunActivity["status"],
): CoachMessageRunActivity {
  const copy = activityCopy[name] ?? {
    success: "Completed a coaching step",
    failure: "A coaching step failed",
    purpose: null,
  };
  return {
    id: `step-${Math.max(1, Math.floor(ordinal))}`,
    label: status === "succeeded" ? copy.success : copy.failure,
    purpose: copy.purpose,
    status,
  };
}

export function appendCoachRunActivity(
  activities: readonly CoachMessageRunActivity[],
  activity: CoachMessageRunActivity,
) {
  return [...activities.filter((candidate) => candidate.id !== activity.id), activity]
    .slice(-COACH_MESSAGE_RUN_MAX_ACTIVITIES);
}

export function coachRunPhaseForActivities(
  activities: readonly CoachMessageRunActivity[],
  forceFinal: boolean,
  proposalStaged: boolean,
): CoachMessageRunPhase {
  if (proposalStaged) return "review_ready";
  if (forceFinal) return "synthesizing";
  return activities.at(-1)?.status === "failed" ? "recovering" : "checking";
}

function parseToolCall(item: CoachResponseItem): ParsedCoachToolCall {
  const callId = typeof item.call_id === "string" ? item.call_id.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!callId || !name) throw new Error("The selected model returned an invalid tool call.");
  try {
    const parsed = JSON.parse(item.arguments ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object.");
    }
    return { callId, name, argumentsValue: parsed as Record<string, unknown>, parseError: null };
  } catch (error) {
    return {
      callId,
      name,
      argumentsValue: {},
      parseError: error instanceof Error ? error.message : "Tool arguments were invalid.",
    };
  }
}

function parseRemoteStatus(value: unknown): RemoteStatus {
  if (typeof value !== "string" || !remoteStatuses.includes(value as RemoteStatus)) {
    throw new Error(`Unsupported Coach response status: ${String(value)}.`);
  }
  return value as RemoteStatus;
}

function requiredResponse(value: unknown): CoachResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Coach response must be an object.");
  }
  const response = value as CoachResponse;
  if (!response.id) throw new Error("The Coach response has no ID.");
  return response;
}

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Coach message data must contain only finite numbers.");
    return JSON.stringify(value);
  }
  if (!value || typeof value !== "object") {
    throw new Error("Coach message data must be JSON-serializable.");
  }
  if (ancestors.has(value)) throw new Error("Coach message data must not contain circular references.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (entry) => canonicalJson(entry, ancestors)).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("Coach message data must contain only plain JSON objects.");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`
    )).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function timestamp(value: string, label: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}
