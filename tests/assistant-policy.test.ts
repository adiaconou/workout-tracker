import assert from "node:assert/strict";
import test from "node:test";
import { assistantModelOption } from "../src/server/coach/models";
import {
  boundedInteger,
  cleanCoachProfile,
  cleanModel,
  cleanReasoningEffort,
  cleanRequiredText,
  cleanText,
  coachInstructions,
  increasesUnavailableExerciseCount,
  nullableRequiredText,
  openAIBaseUrl,
  outputTokenBudget,
  pickDefaultModel,
  rating,
  resolveAssistantRequest,
} from "../src/server/coach/policy";

test("assistant request policy resolves every supported route and rejects incomplete variants", () => {
  const supported = [
    ["GET", ["assistant"], { kind: "bootstrap" }],
    ["GET", ["assistant", "models"], { kind: "models" }],
    ["GET", ["assistant", "profile"], { kind: "profile-read" }],
    ["PATCH", ["assistant", "profile"], { kind: "profile-update" }],
    ["POST", ["assistant", "threads"], { kind: "thread-create" }],
    ["POST", ["assistant", "messages"], { kind: "message-create" }],
    ["GET", ["assistant", "message-runs", "run-1"], {
      kind: "message-run-read",
      runId: "run-1",
    }],
    ["POST", ["assistant", "message-runs", "run-1", "advance"], {
      kind: "message-run-advance",
      runId: "run-1",
    }],
    ["POST", ["assistant", "message-runs", "run-2", "retry"], {
      kind: "message-run-retry",
      runId: "run-2",
    }],
    ["POST", ["assistant", "check-ins"], { kind: "check-in-create" }],
    ["POST", ["assistant", "programs", "generate"], { kind: "program-generate" }],
    ["GET", ["assistant", "program-generations", "job-1"], {
      kind: "program-generation-read",
      jobId: "job-1",
    }],
    ["POST", ["assistant", "program-generations", "job-2", "cancel"], {
      kind: "program-generation-cancel",
      jobId: "job-2",
    }],
    ["POST", ["assistant", "plans", "plan-1", "apply"], { kind: "plan-apply", planId: "plan-1" }],
    ["POST", ["assistant", "plans", "plan-2", "reject"], { kind: "plan-reject", planId: "plan-2" }],
  ] as const;
  for (const [method, segments, decision] of supported) {
    assert.deepEqual(resolveAssistantRequest(method, segments), decision);
  }

  const unsupported = [
    ["POST", ["assistant"]],
    ["POST", ["assistant", "models"]],
    ["PUT", ["assistant", "profile"]],
    ["GET", ["assistant", "threads"]],
    ["GET", ["assistant", "messages"]],
    ["GET", ["assistant", "message-runs"]],
    ["POST", ["assistant", "message-runs", "run-1"]],
    ["GET", ["assistant", "message-runs", "run-1", "advance"]],
    ["POST", ["assistant", "message-runs", "run-1", "advance", "unexpected"]],
    ["GET", ["assistant", "message-runs", "run-1", "retry"]],
    ["POST", ["assistant", "message-runs", "run-1", "retry", "unexpected"]],
    ["GET", ["assistant", "check-ins"]],
    ["GET", ["assistant", "programs", "generate"]],
    ["POST", ["assistant", "programs"]],
    ["POST", ["assistant", "programs", "unexpected"]],
    ["POST", ["assistant", "programs", "generate", "unexpected"]],
    ["GET", ["assistant", "program-generations"]],
    ["POST", ["assistant", "program-generations", "job-1"]],
    ["PATCH", ["assistant", "program-generations", "job-1"]],
    ["GET", ["assistant", "program-generations", "job-1", "cancel"]],
    ["POST", ["assistant", "program-generations", "job-1", "unexpected"]],
    ["POST", ["assistant", "program-generations", "job-1", "cancel", "unexpected"]],
    ["POST", ["assistant", "plans"]],
    ["POST", ["assistant", "plans", "plan-1"]],
    ["GET", ["assistant", "plans", "plan-1", "apply"]],
    ["POST", ["assistant", "plans", "plan-1", "unknown"]],
    ["GET", ["assistant", "plans", "plan-1", "reject"]],
    ["GET", ["assistant", "unknown"]],
  ] as const;
  for (const [method, segments] of unsupported) {
    assert.equal(resolveAssistantRequest(method, segments), null);
  }
});

test("assistant text, integer, model, and profile normalization is strict and bounded", () => {
  assert.equal(cleanText("  abcdef  ", 3), "abc");
  assert.equal(cleanText(42, 3), "");
  assert.equal(cleanRequiredText("  goal  ", "Goal", 20), "goal");
  assert.throws(() => cleanRequiredText("   ", "Goal", 20), /Goal is required/);
  assert.equal(nullableRequiredText(null, "Value", 10), null);
  assert.equal(nullableRequiredText(" value ", "Value", 10), "value");

  assert.equal(boundedInteger("3", 1, 5, "Count"), 3);
  assert.equal(rating(5, "Energy"), 5);
  assert.throws(() => boundedInteger(1.5, 1, 5, "Count"), /between 1 and 5/);
  assert.throws(() => boundedInteger(0, 1, 5, "Count"), /between 1 and 5/);
  assert.throws(() => boundedInteger(6, 1, 5, "Count"), /between 1 and 5/);

  assert.equal(cleanModel(" gpt-5.6:custom_v1 "), "gpt-5.6:custom_v1");
  assert.throws(() => cleanModel("model with spaces"), /Model ID is invalid/);
  assert.throws(() => cleanModel(null), /Model is required/);
  assert.equal(cleanReasoningEffort(undefined, ["auto", "low"]), "auto");
  assert.equal(cleanReasoningEffort(" low ", ["auto", "low"]), "low");
  assert.throws(
    () => cleanReasoningEffort("high", ["auto", "low"]),
    /Reasoning effort must be one of: auto, low/,
  );

  const normalized = cleanCoachProfile({
    ownerEmail: "coach@example.com",
    primaryGoal: `  ${"g".repeat(170)}  `,
    trainingDaysPerWeek: "4",
    sessionDurationMin: 60,
    equipment: "  Dumbbells  ",
    limitations: 12,
    preferences: "  Slow eccentrics  ",
    model: " gpt-5.6-terra ",
    reasoningEffort: " medium ",
    createdAt: "created",
    updatedAt: "updated",
  });
  assert.equal(normalized.ownerEmail, "coach@example.com");
  assert.equal(normalized.primaryGoal.length, 160);
  assert.equal(normalized.trainingDaysPerWeek, 4);
  assert.equal(normalized.sessionDurationMin, 60);
  assert.equal(normalized.equipment, "Dumbbells");
  assert.equal(normalized.limitations, "");
  assert.equal(normalized.preferences, "Slow eccentrics");
  assert.equal(normalized.model, "gpt-5.6-terra");
  assert.equal(normalized.reasoningEffort, "medium");

  const defaults = cleanCoachProfile({
    primaryGoal: "General fitness",
    trainingDaysPerWeek: 3,
    sessionDurationMin: 45,
  });
  assert.equal(defaults.model, "gpt-5.6-terra");
  assert.equal(defaults.reasoningEffort, "auto");
  assert.equal(defaults.equipment, "");
});

test("assistant model policy chooses budgets, defaults, and normalized API URLs", () => {
  assert.equal(outputTokenBudget("gpt-5"), 25_000);
  assert.equal(outputTokenBudget("gpt-5.6-terra"), 25_000);
  assert.equal(outputTokenBudget("o3-mini"), 25_000);
  assert.equal(outputTokenBudget("gpt-4.1"), 8_000);

  const terra = assistantModelOption("gpt-5.6-terra", 4);
  const standard = assistantModelOption("gpt-5.6", 3);
  const first = assistantModelOption("custom-model", 2);
  assert.equal(pickDefaultModel({ OPENAI_DEFAULT_MODEL: " custom-model " }, [terra, first]), "custom-model");
  assert.equal(pickDefaultModel({ OPENAI_DEFAULT_MODEL: "missing" }, [terra, first]), "gpt-5.6-terra");
  assert.equal(pickDefaultModel({}, [terra, first]), "gpt-5.6-terra");
  assert.equal(pickDefaultModel({ OPENAI_DEFAULT_MODEL: " " }, [standard, first]), "gpt-5.6");
  assert.equal(pickDefaultModel({}, [first]), "custom-model");
  assert.equal(pickDefaultModel({}, []), "gpt-5.6-terra");

  assert.equal(openAIBaseUrl({}), "https://api.openai.com/v1");
  assert.equal(openAIBaseUrl({ OPENAI_API_BASE_URL: "   " }), "https://api.openai.com/v1");
  assert.equal(openAIBaseUrl({ OPENAI_API_BASE_URL: " https://example.test/v1/ " }), "https://example.test/v1");
  assert.equal(openAIBaseUrl({ OPENAI_API_BASE_URL: "https://example.test/v1" }), "https://example.test/v1");
});

test("assistant exercise availability policy permits existing counts but rejects unavailable additions", () => {
  const available = new Set(["available"]);
  assert.equal(increasesUnavailableExerciseCount([], [], available), false);
  assert.equal(
    increasesUnavailableExerciseCount([], [{ exerciseId: "available" }], available),
    false,
  );
  assert.equal(
    increasesUnavailableExerciseCount(
      [{ exerciseId: "unavailable" }, { exerciseId: "unavailable" }],
      [{ exerciseId: "unavailable" }, { exerciseId: "unavailable" }],
      available,
    ),
    false,
  );
  assert.equal(
    increasesUnavailableExerciseCount(
      [{ exerciseId: "unavailable" }],
      [{ exerciseId: "unavailable" }, { exerciseId: "unavailable" }],
      available,
    ),
    true,
  );
  assert.equal(
    increasesUnavailableExerciseCount([], [{ exerciseId: "new-unavailable" }], available),
    true,
  );
});

test("coach instructions serialize current constraints and the latest check-in", () => {
  const profile = {
    primaryGoal: "Get stronger",
    trainingDaysPerWeek: 4,
    sessionDurationMin: 45,
    equipment: "Dumbbells, Bench",
    limitations: "None",
    preferences: "Short warm-ups",
  };
  const withoutCheckIn = coachInstructions(profile, []);
  assert.match(withoutCheckIn, /"latestCheckIn":null/);
  assert.match(withoutCheckIn, /Change review policy/);
  assert.match(withoutCheckIn, /nothing has changed yet/);

  const withCheckIn = coachInstructions(profile, [{ energy: 4, availableMinutes: 30 }]);
  assert.match(withCheckIn, /"latestCheckIn":\{"energy":4,"availableMinutes":30\}/);
  assert.match(withCheckIn, /Dumbbells, Bench/);
});
