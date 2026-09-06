import type { CoachMessageContext, CoachTarget } from "../../contracts/api";
import { coachMessageAttemptKey, type CoachMessageAttempt } from "./coach-model";
export type CoachTargetSelection = { target: CoachTarget; label: string };
export type CoachDraft = { content: string; context: CoachMessageContext; targetLabel: string | null; revisionLabel: string | null };
export function emptyCoachDraft(): CoachDraft { return { content: "", context: {}, targetLabel: null, revisionLabel: null }; }
export function draftWithCoachTarget(draft: CoachDraft, selection: CoachTargetSelection | null): CoachDraft {
  const { target: _target, ...context } = draft.context;
  return { ...draft, context: selection ? { ...context, target: selection.target } : context, targetLabel: selection?.label ?? null };
}
export function draftWithCoachRevision(draft: CoachDraft, planId: string | null, label: string | null): CoachDraft {
  const { revisePlanId: _planId, ...context } = draft.context;
  return { ...draft, context: planId ? { ...context, revisePlanId: planId } : context, revisionLabel: label };
}
export function draftAfterCoachSend(draft: CoachDraft): CoachDraft { return { ...draftWithCoachRevision(draft, null, null), content: "" }; }
export function createCoachConversationState() {
  let revision = 0, threadId: string | null = null;
  const drafts = new Map<string, CoachDraft>(), messageAttempts = new Map<string, CoachMessageAttempt>(), retryAttempts = new Map<string, CoachMessageAttempt>();
  function beginView(nextThreadId: string | null) { revision += 1; threadId = nextThreadId; return revision; }
  function isCurrent(requestRevision: number) { return requestRevision === revision; }
  function acceptView(requestRevision: number, loadedThreadId: string) {
    if (!isCurrent(requestRevision) || (threadId !== null && threadId !== loadedThreadId)) return false;
    threadId = loadedThreadId; return true;
  }
  function capture() { return revision; }
  function currentThreadId() { return threadId; }
  function getDraft(id: string) { return drafts.get(id) ?? emptyCoachDraft(); }
  function saveDraft(id: string, draft: CoachDraft) { drafts.set(id, draft); }
  function attemptKey(attempts: Map<string, CoachMessageAttempt>, id: string, fingerprint: string, createKey: () => string) {
    const key = coachMessageAttemptKey(attempts.get(id) ?? null, fingerprint, false, createKey);
    attempts.set(id, { key, requestFingerprint: fingerprint }); return key;
  }
  function finishAttempt(attempts: Map<string, CoachMessageAttempt>, id: string, key: string) { if (attempts.get(id)?.key === key) attempts.delete(id); }
  return { beginView, isCurrent, acceptView, capture, currentThreadId, getDraft, saveDraft,
    messageKey: (id: string, fingerprint: string, createKey: () => string) => attemptKey(messageAttempts, id, fingerprint, createKey),
    finishMessage: (id: string, key: string) => finishAttempt(messageAttempts, id, key),
    retryKey: (id: string, runId: string, createKey: () => string) => attemptKey(retryAttempts, id, runId, createKey),
    finishRetry: (id: string, key: string) => finishAttempt(retryAttempts, id, key) };
}
export type CoachConversationState = ReturnType<typeof createCoachConversationState>;
export async function requestForCoachView<T>(state: CoachConversationState, revision: number, request: () => Promise<T>,
  handlers: { onSuccess: (value: T) => void | Promise<void>; onError: (error: unknown) => void | Promise<void>; onSettled: () => void }) {
  try { const response = await request(); if (state.isCurrent(revision)) await handlers.onSuccess(response); }
  catch (error) { if (state.isCurrent(revision)) await handlers.onError(error); }
  finally { if (state.isCurrent(revision)) handlers.onSettled(); }
}
