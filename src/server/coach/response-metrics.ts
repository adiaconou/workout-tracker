export const COACH_PROMPT_VERSION = "2026-09-context-v1";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function label(value: unknown) {
  return typeof value === "string" ? value : null;
}

/** A response ID is the deduplication key; repeated GETs may observe the same final usage. */
export function coachResponseMetrics(value: unknown, requestId: string | null, latencyMs: number) {
  const response = record(value);
  if (response.status === "queued" || response.status === "in_progress") return null;
  const metadata = record(response.metadata);
  const usage = record(response.usage);
  return { event: "coach_response", responseId: label(response.id), requestId,
    runId: label(metadata.coach_message_run_id), round: label(metadata.coach_message_round),
    model: label(response.model), reasoningEffort: label(record(response.reasoning).effort),
    promptVersion: COACH_PROMPT_VERSION, status: label(response.status), latencyMs: count(latencyMs),
    inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens),
    cachedTokens: count(record(usage.input_tokens_details).cached_tokens),
    reasoningTokens: count(record(usage.output_tokens_details).reasoning_tokens),
    failureCategory: label(record(response.error).code) ?? label(record(response.incomplete_details).reason) };
}
