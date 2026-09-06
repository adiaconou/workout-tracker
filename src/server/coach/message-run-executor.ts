import type { CoachMessageRunActivity } from "../../contracts/api";
import type { D1MessageRunRepository, MessageRunError, StoredAssistantMessageRun } from "../db/message-run-repository";
import type { CoachResponse } from "./response-types";
import { appendCoachRunActivity, coachCallRepeatLimit, coachCallSignature,
  coachMessageRunAwaitsResponseAttachment, coachMessageRunIsExpired, coachMessageRunLeaseExpiresAt,
  coachProposalCompletionText, coachResponseText, coachResponseToolCalls, coachRunActivity,
  coachRunPhaseForActivities, coachRunShouldForceFinal, incrementCoachCallSignature,
  isCoachProposalTool, mapCoachMessageRunRemoteResponse,
  type CoachMessageRunRemoteResult, type ParsedCoachToolCall } from "./message-run";
type Run = StoredAssistantMessageRun;
type StoredActivity = CoachMessageRunActivity & { name: string };
export type CoachToolExecutionIdentity = { ownerEmail: string; runId: string; callId: string; leaseToken: string };
export type CoachRunRequestError = MessageRunError & { status: number; upstreamStatus?: number | null };
export type CoachRunStore = Pick<D1MessageRunRepository, "get" | "claimProcessing" | "setPending" | "releaseProcessing" | "beginCall" | "getCall" | "finishCall" | "updateProcessing" | "attachResponse" | "findReusableReadCall">;
export type CoachRunDependencies = {
  store: CoachRunStore; available: boolean; now: () => number; createId: () => string;
  retrieveResponse: (id: string) => Promise<CoachResponse>;
  createContinuation: (run: Run, outputs: unknown[], previousResponseId: string) => Promise<CoachResponse>;
  executeTool: (run: Run, call: ParsedCoachToolCall, identity: CoachToolExecutionIdentity) => Promise<unknown>;
  recordToolCall: (run: Run, call: ParsedCoachToolCall, output: unknown, status: "succeeded" | "failed", id: string) => Promise<void>;
  reportAuditError: (error: unknown) => void;
  classifyRequestError: (error: unknown) => CoachRunRequestError | null;
  publicError: (error: unknown) => MessageRunError;
  formatToolError: (error: unknown) => string;
  expireRun: (run: Run) => Promise<Run>;
  failUnattachedRun: (run: Run) => Promise<Run>;
  succeedRun: (run: Run, leaseToken: string, text: string, responseId: string) => Promise<Run>;
  failRun: (run: Run, leaseToken: string, error: MessageRunError) => Promise<Run>;
  deleteResponse: (id: string) => Promise<unknown>;
  processSummaryResponse: (run: Run, leaseToken: string, remote: CoachMessageRunRemoteResult) => Promise<Run>;
};
export type CoachRunAdvanceResult = { kind: "state"; run: Run } | { kind: "not_found" } | { kind: "unavailable"; error: CoachRunRequestError };
export async function advanceCoachMessageRun(input: { ownerEmail: string; runId: string }, deps: CoachRunDependencies): Promise<CoachRunAdvanceResult> {
  let run = await deps.store.get(input.ownerEmail, input.runId);
  if (!run) return { kind: "not_found" };
  const state = (value: Run): CoachRunAdvanceResult => ({ kind: "state", run: value });
  if (["succeeded", "failed", "expired", "cancelled"].includes(run.status)) return state(run);
  if (coachMessageRunIsExpired(run.expiresAt, deps.now())) return state(await deps.expireRun(run));
  if (!deps.available) return { kind: "unavailable", error: { status: 503, code: "openai_not_configured", message: "Coach cannot continue until the OpenAI API key is restored. Your request is saved.", retryable: true } };
  if (!run.openAIResponseId) return state(run.status === "starting" && coachMessageRunAwaitsResponseAttachment(run.updatedAt, deps.now()) ? run : await deps.failUnattachedRun(run));
  const expectedResponseId = run.openAIResponseId;
  let remote: CoachMessageRunRemoteResult;
  try {
    const response = await deps.retrieveResponse(expectedResponseId);
    if (response.id !== expectedResponseId) throw new Error("The model returned a different Coach response ID.");
    remote = mapCoachMessageRunRemoteResponse(response);
  } catch (error) {
    const requestError = deps.classifyRequestError(error);
    if (requestError && requestError.upstreamStatus !== 404) return { kind: "unavailable", error: requestError };
    remote = { kind: "failed", ...(requestError?.upstreamStatus === 404
      ? { code: "coach_response_lost", message: "Coach could not recover this response. Your message is saved; try again.", retryable: true }
      : deps.publicError(error)) };
  }
  if (remote.kind === "pending") {
    await deps.store.setPending(input.ownerEmail, run.id, expectedResponseId, remote.status, run.phase, iso(deps));
    return state(await reload(deps, run));
  }
  const leaseToken = deps.createId(), claimedAt = iso(deps);
  if (!await deps.store.claimProcessing(input.ownerEmail, run.id, { expectedResponseId, leaseToken, claimedAt, leaseExpiresAt: coachMessageRunLeaseExpiresAt(claimedAt) })) return state(await reload(deps, run));
  run = await reload(deps, run);
  try {
    if (run.phase === "summarizing") return state(await deps.processSummaryResponse(run, leaseToken, remote));
    if (remote.kind === "failed") return state(await deps.failRun(run, leaseToken, remote));
    return state(await processCompletedRun(deps, run, leaseToken, remote.response));
  } catch (error) {
    const requestError = deps.classifyRequestError(error);
    if (requestError?.retryable) {
      try { await deps.store.releaseProcessing(input.ownerEmail, run.id, leaseToken, "in_progress", run.phase === "summarizing" ? "summarizing" : "recovering", iso(deps)); }
      catch (releaseError) { deps.reportAuditError(releaseError); }
      return { kind: "unavailable", error: requestError };
    }
    return state(await deps.failRun(run, leaseToken, deps.publicError(error)));
  }
}
function iso(deps: CoachRunDependencies) { return new Date(deps.now()).toISOString(); }
async function reload(deps: CoachRunDependencies, run: Run) { return await deps.store.get(run.ownerEmail, run.id) ?? run; }
async function processCompletedRun(deps: CoachRunDependencies, run: Run, leaseToken: string, response: CoachResponse): Promise<Run> {
  const pending = parseArray(run.pendingInputJson), calls = coachResponseToolCalls(response);
  let activities = parseStoredRunActivities(run.activitiesJson);
  if (run.proposalStaged) {
    const name = activities.findLast((activity) => activity.status === "succeeded" && isCoachProposalTool(activity.name))?.name;
    if (name) {
      const call = calls.findLast((candidate) => candidate.name === name);
      const saved = call ? await deps.store.getCall(run.ownerEmail, run.id, call.callId) : null;
      return deps.succeedRun(run, leaseToken, coachProposalCompletionText(name, readOutput(saved?.outputJson ?? null))!, response.id);
    }
  }
  if (pending.length) return continueRun(deps, run, leaseToken, pending, response.id);
  if (!calls.length) {
    const text = coachResponseText(response);
    if (!text) throw new Error("The selected model returned no coaching response.");
    return deps.succeedRun(run, leaseToken, text, response.id);
  }
  if (run.forceFinal) throw new Error("The selected model tried to call a tool after Coach switched to final synthesis.");
  let signatures = parseSignatures(run.callSignaturesJson), toolCallCount = run.toolCallCount;
  let proposalStaged = run.proposalStaged;
  let forceFinal: boolean = run.forceFinal;
  let completion: string | null = null;
  const outputs: unknown[] = [];
  for (const call of calls) {
    const signature = coachCallSignature(call);
    const begun = await deps.store.beginCall(run.ownerEmail, run.id, leaseToken, { id: `${run.id}:${call.callId}`, callId: call.callId, callSignature: signature, toolName: call.name, argumentsJson: JSON.stringify(call.argumentsValue), createdAt: iso(deps) });
    if (begun.kind === "rejected") return reload(deps, run);
    if (begun.kind === "conflict") throw new Error("The selected model reused a tool-call ID with different instructions.");
    if (begun.kind === "replayed") {
      const output = readOutput(begun.call.outputJson);
      outputs.push(functionOutput(call.callId, boundedOutput(output, isCoachProposalTool(call.name)).json));
      if (begun.call.activityJson) {
        const activity = parseStoredRunActivities(`[${begun.call.activityJson}]`)[0];
        if (!activity) throw new Error("Stored Coach activity is invalid.");
        activities = appendCoachRunActivity(activities, activity) as StoredActivity[];
      }
      if (begun.call.status === "succeeded" && isCoachProposalTool(call.name)) { proposalStaged = true; completion = coachProposalCompletionText(call.name, output); }
      forceFinal = forceFinal || coachRunShouldForceFinal(run.roundCount, toolCallCount)
        || (signatures[signature] ?? 0) >= coachCallRepeatLimit(call.name);
      continue;
    }
    const incremented = incrementCoachCallSignature(signatures, signature);
    signatures = incremented.counts; toolCallCount += 1;
    let output: unknown, status: "succeeded" | "failed" = "succeeded", executed = false;
    const reservedProposal = isCoachProposalTool(call.name) && begun.call.outputJson !== null;
    if (reservedProposal) { output = JSON.parse(begun.call.outputJson!); executed = true; }
    else if (proposalStaged) { status = "failed"; output = { error: "A review card is already ready. Finish the response without another tool." }; }
    else if (incremented.count >= coachCallRepeatLimit(call.name) || coachRunShouldForceFinal(0, toolCallCount - 1)) { status = "failed"; forceFinal = true; output = { error: "The tool budget or repeat limit was reached. Use the prior results and finish." }; }
    else if (call.parseError) { status = "failed"; output = { error: call.parseError }; }
    else {
      executed = true;
      try {
        const cached = ["get_routine", "get_routines", "get_exercise", "search_exercises", "list_routine_versions"].includes(call.name) ? await deps.store.findReusableReadCall(run.ownerEmail, run.id, signature) : null;
        output = cached ? readOutput(cached.outputJson) : await deps.executeTool(run, call, { ownerEmail: run.ownerEmail, runId: run.id, callId: call.callId, leaseToken });
      } catch (error) { status = "failed"; output = { error: deps.formatToolError(error) }; }
    }
    const bounded = boundedOutput(output, isCoachProposalTool(call.name)); output = bounded.value;
    if (bounded.error) status = "failed";
    if (executed && status === "succeeded" && isCoachProposalTool(call.name)) { proposalStaged = true; completion = coachProposalCompletionText(call.name, output); }
    const activity = executed ? { ...coachRunActivity(activities.length + 1, call.name, status), name: call.name } : null;
    if (activity) activities = appendCoachRunActivity(activities, activity) as StoredActivity[];
    forceFinal = forceFinal || coachRunShouldForceFinal(run.roundCount, toolCallCount);
    if (!await deps.store.finishCall(run.ownerEmail, run.id, call.callId, leaseToken, {
      status, outputJson: bounded.json, activityJson: activity ? JSON.stringify(activity) : null,
      errorMessage: status === "failed" ? (output as { error: string }).error.slice(0, 500) : null,
      activitiesJson: JSON.stringify(activities), callSignaturesJson: JSON.stringify(signatures), toolCallCount, proposalStaged,
      phase: coachRunPhaseForActivities(activities, forceFinal, proposalStaged), updatedAt: iso(deps),
    })) return reload(deps, run);
    try { await deps.recordToolCall(run, call, output, status, begun.call.id); } catch (error) { deps.reportAuditError(error); }
    outputs.push(functionOutput(call.callId, bounded.json));
  }
  if (!await deps.store.updateProcessing(run.ownerEmail, run.id, leaseToken, {
    phase: coachRunPhaseForActivities(activities, forceFinal, proposalStaged), openAIResponseId: run.openAIResponseId,
    previousResponseId: response.id, responseIdsJson: run.responseIdsJson, pendingInputJson: JSON.stringify(outputs),
    activitiesJson: JSON.stringify(activities), callSignaturesJson: JSON.stringify(signatures), roundCount: run.roundCount,
    toolCallCount, forceFinal, proposalStaged, updatedAt: iso(deps),
  })) return reload(deps, run);
  run = await reload(deps, run);
  return completion ? deps.succeedRun(run, leaseToken, completion, response.id) : continueRun(deps, run, leaseToken, outputs, response.id);
}
async function continueRun(deps: CoachRunDependencies, run: Run, leaseToken: string, outputs: unknown[], previousResponseId: string) {
  const response = await deps.createContinuation(run, outputs, previousResponseId);
  if (!response.id) throw new Error("OpenAI did not return a Coach response ID.");
  const remote = mapCoachMessageRunRemoteResponse(response);
  const responseIds = [...parseArray(run.responseIdsJson).filter((id) => typeof id === "string" && id !== response.id), response.id];
  const attached = await deps.store.attachResponse(run.ownerEmail, run.id, { openAIResponseId: response.id, previousResponseId: null,
    responseIdsJson: JSON.stringify(responseIds), pendingInputJson: "[]", status: remote.kind === "pending" ? remote.status : "in_progress",
    phase: run.forceFinal ? "synthesizing" : run.phase, roundCount: run.roundCount + 1, updatedAt: iso(deps), leaseToken });
  const current = await reload(deps, run);
  if (!attached && current.openAIResponseId !== response.id) {
    try { await deps.deleteResponse(response.id); } catch (error) { deps.reportAuditError(error); }
  }
  return current;
}
function parseArray(value: string): unknown[] { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseSignatures(value: string): Record<string, number> {
  try { const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, count]) => Number.isInteger(count) && Number(count) >= 0));
  } catch { return {}; }
}
export function parseStoredRunActivities(value: string): StoredActivity[] {
  return parseArray(value).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const activity = entry as Record<string, unknown>;
    if (typeof activity.id !== "string" || typeof activity.name !== "string" || typeof activity.label !== "string"
      || (activity.purpose !== null && typeof activity.purpose !== "string") || (activity.status !== "succeeded" && activity.status !== "failed")) return [];
    return [{ id: activity.id, name: activity.name, label: activity.label, purpose: activity.purpose, status: activity.status } as StoredActivity];
  }).slice(-12);
}
function readOutput(value: string | null): unknown { if (!value) return { error: "A saved coaching step had no result." }; try { return JSON.parse(value); } catch { return { error: "A saved coaching step result was invalid." }; } }
function functionOutput(callId: string, output: string) { return { type: "function_call_output", call_id: callId, output }; }
function boundedOutput(value: unknown, proposal: boolean): { value: unknown; json: string; error: boolean } {
  let json = JSON.stringify(value);
  if (proposal && typeof json === "string" && json.length > 30_000 && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>, entries = Array.isArray(record.plans) ? record.plans : [record];
    const plans = entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const plan = entry as Record<string, unknown>;
      if (typeof plan.planId !== "string") return [];
      return [{ planId: plan.planId, status: "ready_for_review", summary: typeof plan.summary === "string" ? plan.summary.slice(0, 500) : "" }];
    });
    if (plans.length) { value = { status: "ready_for_review", plans, instruction: "The complete details are saved in the review cards." }; json = JSON.stringify(value); }
  }
  if (typeof json !== "string" || json.length > 30_000) { value = { code: "result_too_large", error: "This check returned too much data. Request fewer records, a smaller page, or one exact item." }; json = JSON.stringify(value); }
  const error = !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).error === "string";
  return { value, json, error: Boolean(error) };
}
