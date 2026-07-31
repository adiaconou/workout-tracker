import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantModelOption,
  fallbackAssistantModels,
  isCompatibleAssistantModel,
  reasoningEffortsForModel,
} from "../server/assistant-models";

test("offers model-specific reasoning effort choices", () => {
  assert.deepEqual(reasoningEffortsForModel("gpt-5.6-terra"), ["auto", "none", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(reasoningEffortsForModel("gpt-5.4"), ["auto", "none", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(reasoningEffortsForModel("gpt-5"), ["auto", "minimal", "low", "medium", "high"]);
  assert.deepEqual(reasoningEffortsForModel("o4-mini"), ["auto", "low", "medium", "high"]);
  assert.deepEqual(reasoningEffortsForModel("gpt-4.1"), ["auto"]);
});

test("auto-discovers text reasoning models while excluding incompatible modalities", () => {
  assert.equal(isCompatibleAssistantModel("gpt-5.7-terra"), true);
  assert.equal(isCompatibleAssistantModel("o5"), true);
  assert.equal(isCompatibleAssistantModel("gpt-5.6-realtime"), false);
  assert.equal(isCompatibleAssistantModel("text-embedding-4"), false);
  assert.deepEqual(assistantModelOption("gpt-5.7-terra", 42), {
    id: "gpt-5.7-terra",
    label: "GPT 5.7 Terra",
    created: 42,
    reasoningEfforts: ["auto", "none", "low", "medium", "high", "xhigh", "max"],
  });
  assert.deepEqual(fallbackAssistantModels().map((model) => model.id), ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"]);
});
