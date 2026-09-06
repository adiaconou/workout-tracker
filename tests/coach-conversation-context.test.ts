import assert from "node:assert/strict";
import test from "node:test";
import { acceptConversationSummary, buildConversationContext, coachCheckInContext, estimateCoachContextTokens,
  restoreConversationSummary, normalizeCoachTimeZone, skipConversationSummaryRefresh, validateConversationSummary,
  type ContextMessage, type ConversationSummary, type ConversationSummaryState } from "../src/server/coach/conversation-context";
const message = (id: string, role: ContextMessage["role"], content = "Hello", minute = 0): ContextMessage =>
  ({ id, role, content, createdAt: new Date(Date.UTC(2026, 8, 6, 12, minute)).toISOString() });
const empty = (): ConversationSummary => ({ version: 1, goals: [], constraints: [], decisions: [], openQuestions: [] });
const saved = (): ConversationSummaryState => ({ summary: { ...empty(), goals: [{ text: "Build strength", sourceMessageIds: ["old-user"] }] }, through: message("old-assistant", "assistant", "", -1) });
const history = (count = 3, size = 9000) => [...Array.from({ length: count }, (_, i) => [
  message(`user-${i}`, "user", "u".repeat(size), i * 2), message(`reply-${i}`, "assistant", "a".repeat(size), i * 2 + 1),
]).flat(), message("current", "user", "What next?", count * 2)];
test("context estimates UTF-8 and keeps chronological messages through the current request", () => {
  for (const [text, count] of [["", 0], ["abc", 1], ["abcd", 2], ["😀", 2]] as const) assert.equal(estimateCoachContextTokens(text), count);
  const a = message("a", "user"), b = message("b", "assistant"), current = message("current", "user", "Next", 1), future = message("future", "user", "Later", 2);
  const input = [future, b, a, current];
  const result = buildConversationContext({ messages: input, currentUserMessageId: "current" });
  assert.deepEqual(result.messages, [a, b, current]);
  assert.deepEqual(input, [future, b, a, current]);
  assert.equal(result.estimatedTokens, 102);
  assert.equal(result.summary, null);
  assert.equal(result.summaryRequest, null);
  assert.equal(result.earlierContextIncomplete, false);
  assert.throws(() => buildConversationContext({ messages: [], currentUserMessageId: "missing" }), /missing/);
  assert.throws(() => buildConversationContext({ messages: [b], currentUserMessageId: b.id }), /missing/);
});
test("summary cursors exclude covered history and never leak future details into retries", () => {
  const previous = saved(), current = message("current", "user"), old = message("old-user", "user", "Strength", -2);
  const result = buildConversationContext({ messages: [old, previous.through as ContextMessage, current], currentUserMessageId: current.id, previousSummary: previous });
  assert.deepEqual(result.messages, [current]);
  assert.equal(result.summary, previous);
  assert.ok(result.estimatedTokens > 34);
  for (const through of [current, message("future", "assistant", "", 1)]) assert.equal(buildConversationContext({ messages: [old, current], currentUserMessageId: current.id, previousSummary: { ...previous, through } }).summary, null);
});
test("overflow preserves whole recent turns and sources summaries from a bounded older prefix", () => {
  const result = buildConversationContext({ messages: history(), currentUserMessageId: "current" });
  assert.deepEqual(result.messages.map(m => m.id), ["user-2", "reply-2", "current"]);
  assert.deepEqual(result.summaryRequest!.messages.map(m => m.id), ["user-0", "reply-0", "user-1", "reply-1"]);
  assert.equal(result.summaryRequest!.through.id, "reply-1");
  assert.ok(result.estimatedTokens <= 8000);
  const summary = { ...empty(), decisions: [{ text: "Keep sessions short", sourceMessageIds: ["user-1"] }] };
  const complete = acceptConversationSummary(result, summary);
  assert.equal(complete.summaryRequest, null);
  assert.equal(complete.earlierContextIncomplete, false);
  assert.deepEqual(complete.summary!.summary, summary);
  assert.equal(result.summary, null);
  assert.ok(complete.estimatedTokens > result.estimatedTokens);
  const large = buildConversationContext({ messages: history(6), currentUserMessageId: "current" });
  assert.equal(large.summaryRequest!.messages.length, 4);
  assert.equal(acceptConversationSummary(large, empty()).earlierContextIncomplete, true);
  for (const id of ["current", "user-2", "future"]) assert.throws(() => acceptConversationSummary(result, { ...empty(), goals: [{ text: "Unverified", sourceMessageIds: [id] }] }), /unknown source/);
});
test("failed summaries preserve prior facts and raw context; gaps never move the cursor", () => {
  const previous = saved();
  const result = buildConversationContext({ messages: history(), currentUserMessageId: "current", previousSummary: previous });
  assert.equal(result.summaryRequest!.previousSummary, previous);
  assert.deepEqual(acceptConversationSummary(result, previous.summary).summary!.summary.goals, previous.summary.goals);
  const failed = skipConversationSummaryRefresh(result);
  assert.equal(failed.summary, previous);
  assert.equal(failed.summaryRequest, null);
  assert.equal(failed.earlierContextIncomplete, true);
  assert.deepEqual(failed.messages, result.messages);
  assert.throws(() => acceptConversationSummary(failed, empty()), /No conversation summary/);
  assert.deepEqual(skipConversationSummaryRefresh(failed), failed);
  for (const messages of [history(), [message("current", "user")]]) {
    const gap = buildConversationContext({ messages, currentUserMessageId: "current", hasEarlierMessages: true });
    assert.equal(gap.summaryRequest, null);
    assert.equal(gap.earlierContextIncomplete, true);
  }
  const huge = buildConversationContext({ messages: history(1, 60000), currentUserMessageId: "current" });
  assert.deepEqual(huge.messages.map(m => m.id), ["current"]);
  assert.equal(huge.summaryRequest, null);
  const current = message("current", "user", "c".repeat(60000));
  const only = buildConversationContext({ messages: [current], currentUserMessageId: current.id });
  assert.deepEqual(only.messages, [current]);
  assert.equal(only.earlierContextIncomplete, false);
  const leading = buildConversationContext({ messages: [message("first", "assistant", "a".repeat(36000), -1), current], currentUserMessageId: current.id });
  assert.equal(leading.summaryRequest!.messages[0]!.role, "assistant");
});
test("summary validation enforces bounded facts and known source IDs", () => {
  const valid = { text: "  Strength  ", sourceMessageIds: ["user"] };
  assert.equal(validateConversationSummary({ ...empty(), goals: [valid] }, new Set(["user"])).goals[0]!.text, "Strength");
  assert.equal(valid.text, "  Strength  ");
  assert.deepEqual(validateConversationSummary(empty(), new Set()), empty());
  for (const value of [null, [], "summary"]) assert.throws(() => validateConversationSummary(value, new Set()), /JSON objects/);
  for (const value of [{ ...empty(), version: 2 }, { ...empty(), extra: true }, { version: 1 }]) assert.throws(() => validateConversationSummary(value, new Set()), /shape or version/);
  for (const goals of [null, Array(9).fill({})]) assert.throws(() => validateConversationSummary({ ...empty(), goals }, new Set()), /eight facts/);
  assert.throws(() => validateConversationSummary({ ...empty(), goals: [null] }, new Set()), /JSON objects/);
  for (const fact of [{ ...valid, extra: true }, { ...valid, text: 10 }, { ...valid, text: " " }, { ...valid, text: "x".repeat(401) }, { ...valid, sourceMessageIds: null }, { ...valid, sourceMessageIds: [] }, { ...valid, sourceMessageIds: Array(7).fill("user") }]) assert.throws(() => validateConversationSummary({ ...empty(), goals: [fact] }, new Set(["user"])), /bounded text/);
  for (const id of [2, "", "x".repeat(129), "unknown"]) assert.throws(() => validateConversationSummary({ ...empty(), goals: [{ ...valid, sourceMessageIds: [id] }] }, new Set(["user"])), /unknown source/);
  const oversized = Array.from({ length: 8 }, () => ({ text: "x".repeat(400), sourceMessageIds: ["user"] }));
  assert.throws(() => validateConversationSummary({ ...empty(), goals: oversized, constraints: oversized }, new Set(["user"])), /token budget/);
});
test("readiness uses the local calendar day and ignores stale or future time limits", () => {
  for (const invalid of [null, false, "", " ", "x".repeat(101), "not/a-time-zone"]) assert.equal(normalizeCoachTimeZone(invalid), "UTC");
  assert.equal(normalizeCoachTimeZone(" UTC "), "UTC");
  assert.equal(normalizeCoachTimeZone("America/Los_Angeles"), "America/Los_Angeles");
  const now = Date.parse("2026-09-06T07:30:00.000Z");
  const fresh = { createdAt: "2026-09-06T07:01:00.000Z", availableMinutes: 25 };
  const yesterday = { createdAt: "2026-09-06T06:59:00.000Z", availableMinutes: 10 };
  const invalid = { createdAt: "invalid", availableMinutes: 60 };
  const current = coachCheckInContext([yesterday, fresh, invalid], "America/Los_Angeles", now);
  assert.equal(current.latestCheckIn, fresh);
  assert.equal(current.localDate, "2026-09-06");
  assert.equal(current.timeZone, "America/Los_Angeles");
  assert.equal(current.isFresh, true);
  assert.equal(current.availableMinutes, 25);
  assert.equal(coachCheckInContext([yesterday], "America/Los_Angeles", now).availableMinutes, null);
  assert.equal(coachCheckInContext([yesterday], "UTC", now).isFresh, true);
  assert.equal(coachCheckInContext([{ createdAt: "2026-09-06T07:31:00.000Z", availableMinutes: 20 }], "UTC", now).isFresh, false);
  assert.equal(coachCheckInContext([{ createdAt: fresh.createdAt }], "UTC", now).availableMinutes, null);
  assert.equal(coachCheckInContext([{ ...fresh, availableMinutes: null }], "UTC", now).availableMinutes, null);
  assert.equal(coachCheckInContext([], "UTC", now).latestCheckIn, null);
  assert.equal(coachCheckInContext([invalid], "UTC", now).isFresh, false);
  assert.equal(coachCheckInContext([], undefined).isFresh, false);
  assert.throws(() => coachCheckInContext([], "UTC", NaN), /reference time/);
  const dst = coachCheckInContext([{ createdAt: "2026-11-01T08:30:00.000Z", availableMinutes: 40 }], "America/Los_Angeles", Date.parse("2026-11-01T09:30:00.000Z"));
  assert.equal(dst.localDate, "2026-11-01");
  assert.equal(dst.isFresh, true);
});

test("stored summaries validate shape and never import future context", () => {
  const current = message("current", "user", "", 2);
  const valid = { summary: { ...empty(), goals: [{ text: "Strength", sourceMessageIds: ["old"] }] }, through: { id: "old", createdAt: message("old", "user", "", 0).createdAt } };
  assert.deepEqual(restoreConversationSummary(valid, current), valid);
  assert.deepEqual(restoreConversationSummary(JSON.stringify(valid), current), valid);
  for (const value of [null, "not JSON", {}, { ...valid, through: null }, { ...valid, summary: null },
    { ...valid, through: { ...valid.through, id: 1 } }, { ...valid, through: { ...valid.through, id: " " } },
    { ...valid, through: { ...valid.through, id: "x".repeat(129) } },
    { ...valid, through: { ...valid.through, createdAt: 1 } }, { ...valid, through: { ...valid.through, createdAt: "bad" } },
    { ...valid, through: current }, { ...valid, through: message("future", "assistant", "", 3) },
    { ...valid, summary: { ...empty(), goals: null } }, { ...valid, summary: { ...empty(), goals: [null] } },
    { ...valid, summary: { ...empty(), goals: [{ text: "x", sourceMessageIds: null }] } },
    { ...valid, summary: { ...empty(), goals: [{ text: "x", sourceMessageIds: ["old", 1] }] } },
  ]) assert.equal(restoreConversationSummary(value, current), null);
});
