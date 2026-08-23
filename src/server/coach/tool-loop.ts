export type CoachToolChoice = "auto" | "none";

export type CoachResponseItem = {
  type?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
};

export type CoachResponse = {
  id: string;
  status?: string;
  output?: CoachResponseItem[];
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
};

export type CoachToolActivity = {
  name: string;
  status: "succeeded" | "failed";
};

type CoachToolCall = {
  name: string;
  argumentsValue: Record<string, unknown>;
};

type CoachToolCallRecord = CoachToolCall & {
  output: unknown;
  status: CoachToolActivity["status"];
};

export class CoachToolLoopError extends Error {}

const defaultCoachRunDurationMs = 4 * 60_000;

export async function runCoachToolLoop(input: {
  conversation: unknown[];
  createResponse: (conversation: unknown[], toolChoice: CoachToolChoice) => Promise<CoachResponse>;
  executeTool: (call: CoachToolCall) => Promise<unknown>;
  recordToolCall: (record: CoachToolCallRecord) => Promise<void>;
  formatError: (error: unknown, fallback: string) => string;
  isProposalTool?: (name: string) => boolean;
  maxRunDurationMs?: number;
  now?: () => number;
  reportAuditError?: (error: unknown) => void;
}) {
  const conversation = [...input.conversation];
  const now = input.now ?? Date.now;
  const startedAt = now();
  const maxRunDurationMs = input.maxRunDurationMs ?? defaultCoachRunDurationMs;
  let responseId = "";
  const callSignatureCounts = new Map<string, number>();
  const activities: CoachToolActivity[] = [];
  let forceFinalResponse = false;
  let proposalStaged = false;

  while (true) {
    if (!forceFinalResponse && now() - startedAt >= maxRunDurationMs) forceFinalResponse = true;
    const response = await input.createResponse(conversation, forceFinalResponse ? "none" : "auto");
    validateResponse(response);
    responseId = response.id;
    const output = response.output ?? [];
    conversation.push(...output);
    const calls = output.filter((item) => item.type === "function_call");
    if (!calls.length) {
      const text = outputText(output);
      if (!text) throw new CoachToolLoopError("The selected model returned no coaching response.");
      return { text, responseId, activities: withoutRepairedFailures(activities) };
    }
    if (forceFinalResponse) {
      throw new CoachToolLoopError("The selected model tried to call a tool after tools were disabled for final synthesis.");
    }

    for (const call of calls) {
      const callId = call.call_id;
      const name = call.name;
      if (!callId || !name) throw new CoachToolLoopError("The selected model returned an invalid tool call.");

      let argumentsValue: Record<string, unknown> = {};
      let toolOutput: unknown;
      let status: CoachToolActivity["status"] = "succeeded";
      let executed = false;
      let parseError: unknown;
      try {
        const parsed = JSON.parse(call.arguments ?? "{}") as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Tool arguments must be a JSON object.");
        }
        argumentsValue = parsed as Record<string, unknown>;
      } catch (error) {
        parseError = error;
      }

      const callSignature = parseError
        ? `${name}:invalid:${call.arguments!}`
        : `${name}:${canonicalJson(argumentsValue)}`;
      const repeatedCallCount = (callSignatureCounts.get(callSignature) ?? 0) + 1;
      callSignatureCounts.set(callSignature, repeatedCallCount);
      const repeatedCallLimit = input.isProposalTool?.(name) ? 2 : 3;

      if (proposalStaged) {
        status = "failed";
        toolOutput = {
          error: "A review card has already been staged. Stop using tools and tell the user to review it.",
        };
      } else if (repeatedCallCount >= repeatedCallLimit) {
        status = "failed";
        forceFinalResponse = true;
        toolOutput = {
          error: "This exact tool call has already been repeated without making progress. Use the prior results and finish the response.",
        };
      } else if (parseError) {
        status = "failed";
        toolOutput = { error: input.formatError(parseError, "The tool call arguments were invalid.") };
      } else {
        executed = true;
        try {
          toolOutput = await input.executeTool({ name, argumentsValue });
          if (input.isProposalTool?.(name)) {
            proposalStaged = true;
            forceFinalResponse = true;
          }
        } catch (error) {
          status = "failed";
          toolOutput = { error: input.formatError(error, "The tool call failed.") };
        }
      }

      if (executed) activities.push({ name, status });
      try {
        await input.recordToolCall({ name, argumentsValue, output: toolOutput, status });
      } catch (error) {
        input.reportAuditError?.(error);
      }
      conversation.push({ type: "function_call_output", call_id: callId, output: JSON.stringify(toolOutput) });
    }
  }
}

function withoutRepairedFailures(activities: CoachToolActivity[]) {
  const laterSuccesses = new Set<string>();
  const visible: CoachToolActivity[] = [];
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]!;
    if (activity.status === "failed" && laterSuccesses.has(activity.name)) continue;
    if (activity.status === "succeeded") laterSuccesses.add(activity.name);
    visible.push(activity);
  }
  return visible.reverse();
}

function validateResponse(response: CoachResponse) {
  if (!response.id) throw new CoachToolLoopError("The selected model returned an invalid response.");
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    if (reason === "max_output_tokens") {
      throw new CoachToolLoopError(
        "The coach ran out of response capacity before completing this step. Try again or select a lower reasoning effort.",
      );
    }
    throw new CoachToolLoopError("The selected model returned an incomplete coaching response.");
  }
  if (response.status !== "completed") {
    throw new CoachToolLoopError(response.error?.message ?? `The selected model response ended with status ${response.status}.`);
  }
  if (response.error?.message) throw new CoachToolLoopError(response.error.message);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value)!;
}

function outputText(output: CoachResponseItem[]) {
  return output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();
}
