import assert from "node:assert/strict";
import test from "node:test";
import { createCoachConversationState, draftAfterCoachSend, draftWithCoachRevision, draftWithCoachTarget, emptyCoachDraft, requestForCoachView } from "../src/client/coach/coach-conversation-state";
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("drafts keep targets and revisions separate between conversations", () => {
  const state = createCoachConversationState(), empty = emptyCoachDraft();
  assert.deepEqual(state.getDraft("a"), empty);
  const target = draftWithCoachTarget({ ...empty, content: "Make this easier" }, { target: { kind: "workout", workoutId: "workout", viewedSetId: "past-set" }, label: "Squat set 1" });
  const revision = draftWithCoachRevision(target, "plan", "Routine A");
  state.saveDraft("a", revision);
  assert.deepEqual(state.getDraft("a"), revision);
  assert.deepEqual(state.getDraft("b"), empty);
  assert.deepEqual(draftAfterCoachSend(revision), { ...target, content: "" });
  assert.deepEqual(draftWithCoachTarget(revision, null), { ...revision, context: { revisePlanId: "plan" }, targetLabel: null });
});
test("view generations reject stale loads even after returning to the same chat", () => {
  const state = createCoachConversationState();
  assert.equal(state.currentThreadId(), null); assert.equal(state.capture(), 0);
  const first = state.beginView(null);
  assert.equal(state.acceptView(first, "a"), true); assert.equal(state.currentThreadId(), "a");
  const second = state.beginView("b");
  assert.equal(state.acceptView(second, "wrong"), false); assert.equal(state.acceptView(first, "a"), false);
  assert.equal(state.acceptView(second, "b"), true);
  const returned = state.beginView("a");
  assert.equal(state.isCurrent(first), false); assert.equal(state.acceptView(returned, "a"), true); assert.equal(state.isCurrent(returned), true);
});
test("message and retry keys retain uncertain requests only in their originating thread", () => {
  const state = createCoachConversationState(); let sequence = 0; const next = () => "key-" + ++sequence;
  assert.equal(state.messageKey("a", "same", next), "key-1"); assert.equal(state.messageKey("a", "same", next), "key-1");
  assert.equal(state.messageKey("b", "same", next), "key-2"); assert.equal(state.messageKey("a", "changed-target", next), "key-3");
  state.finishMessage("a", "key-1"); assert.equal(state.messageKey("a", "changed-target", next), "key-3");
  state.finishMessage("a", "key-3"); assert.equal(state.messageKey("a", "changed-target", next), "key-4"); state.finishMessage("missing", "old");
  assert.equal(state.retryKey("a", "run-a", next), "key-5"); assert.equal(state.retryKey("a", "run-a", next), "key-5");
  assert.equal(state.retryKey("b", "run-a", next), "key-6"); assert.equal(state.retryKey("a", "run-b", next), "key-7");
  state.finishRetry("a", "key-5"); assert.equal(state.retryKey("a", "run-b", next), "key-7");
  state.finishRetry("a", "key-7"); assert.equal(state.retryKey("a", "run-b", next), "key-8");
});
test("late responses and failures cannot replace another chat's polling or busy state", async () => {
  const state = createCoachConversationState(), effects: string[] = [];
  const handlers = { onSuccess: (v: string) => { effects.push("monitor:" + v); }, onError: (e: unknown) => { effects.push("error:" + String(e)); }, onSettled: () => { effects.push("idle"); } };
  const first = state.beginView("a"), response = deferred<string>();
  const sending = requestForCoachView(state, first, () => response.promise, handlers);
  const second = state.beginView("b"); response.resolve("a"); await sending; assert.deepEqual(effects, []);
  const failure = deferred<string>(), retrying = requestForCoachView(state, second, () => failure.promise, handlers);
  state.beginView("a"); failure.reject("old"); await retrying; assert.deepEqual(effects, []);
  await requestForCoachView(state, state.capture(), () => Promise.resolve("current"), handlers);
  await requestForCoachView(state, state.capture(), () => Promise.reject("current"), handlers);
  assert.deepEqual(effects, ["monitor:current", "idle", "error:current", "idle"]);
});
test("navigation during reconciliation cannot clear the new chat's busy state", async () => {
  const state = createCoachConversationState(), revision = state.beginView("a"), reconciliation = deferred<void>(), effects: string[] = [];
  const request = requestForCoachView(state, revision, () => Promise.reject("offline"), {
    onSuccess: () => { assert.fail("Unexpected success"); }, onError: async () => { await reconciliation.promise; }, onSettled: () => { effects.push("idle"); },
  });
  await Promise.resolve(); state.beginView("b"); reconciliation.resolve(); await request; assert.deepEqual(effects, []);
});
