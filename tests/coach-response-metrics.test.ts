import assert from "node:assert/strict";
import test from "node:test";
import { coachResponseMetrics, COACH_PROMPT_VERSION } from "../src/server/coach/response-metrics";

test("response metrics preserve measured usage without recording conversation content", () => {
  const metrics = coachResponseMetrics({ id: "r1", model: "selected", status: "completed",
    reasoning: { effort: "low" }, metadata: { coach_message_run_id: "run1", coach_message_round: "2" },
    usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 80 },
      output_tokens_details: { reasoning_tokens: 5 } }, input: "private", output: "private" }, "req1", 500)!;
  assert.equal(metrics.inputTokens, 100);
  assert.equal(metrics.cachedTokens, 80);
  assert.equal(metrics.reasoningTokens, 5);
  assert.equal(metrics.runId, "run1");
  assert.equal(metrics.round, "2");
  assert.equal(metrics.promptVersion, COACH_PROMPT_VERSION);
  assert.equal("input" in metrics, false);
  assert.equal("output" in metrics, false);
  assert.equal(metrics.failureCategory, null);
});

test("missing metrics stay unknown and terminal failures use categories", () => {
  assert.equal(coachResponseMetrics({ status: "queued" }, null, 0), null);
  assert.equal(coachResponseMetrics({ status: "in_progress" }, null, 0), null);
  for (const input of [null, undefined, [], "bad", { usage: { input_tokens: -1, output_tokens: Infinity } }]) {
    const metrics = coachResponseMetrics(input, null, NaN)!;
    assert.equal(metrics.inputTokens, null);
    assert.equal(metrics.outputTokens, null);
    assert.equal(metrics.latencyMs, null);
  }
  assert.equal(coachResponseMetrics({ error: { code: "rate_limit" } }, null, 1)!.failureCategory, "rate_limit");
  assert.equal(coachResponseMetrics({ incomplete_details: { reason: "max_output_tokens" } }, null, 1)!.failureCategory, "max_output_tokens");
});
