import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSetComparisonPerformance,
  liveSetComparisonPerformance,
  type ComparisonPerformance,
  type ComparisonSet,
} from "../src/features/workouts/set-comparison";

const repsSet: ComparisonSet = {
  loadType: "external",
  targetUnit: "reps",
  weightUnit: "lb",
};

function performance(
  overrides: Partial<ComparisonPerformance> = {},
): ComparisonPerformance {
  return {
    status: "Completed",
    actualWeight: 135,
    actualReps: 8,
    actualDurationSec: null,
    weightUnit: "lb",
    ...overrides,
  };
}

test("formats external, bodyweight, added, and assisted set cells", () => {
  assert.equal(formatSetComparisonPerformance(repsSet, performance()), "135 lb × 8 reps");
  assert.equal(formatSetComparisonPerformance(
    { ...repsSet, loadType: "bodyweight" },
    performance({ actualWeight: 0, actualReps: 10 }),
  ), "BW × 10 reps");
  assert.equal(formatSetComparisonPerformance(
    { ...repsSet, loadType: "bodyweight" },
    performance({ actualWeight: 15, actualReps: 10 }),
  ), "BW + 15 lb × 10 reps");
  assert.equal(formatSetComparisonPerformance(
    { ...repsSet, loadType: "added" },
    performance({ actualWeight: 25, actualReps: 6 }),
  ), "BW + 25 lb × 6 reps");
  assert.equal(formatSetComparisonPerformance(
    { ...repsSet, loadType: "assistance" },
    performance({ actualWeight: 40 }),
  ), "BW − 40 lb × 8 reps");
});

test("formats duration and rounds while preserving the recorded unit", () => {
  assert.equal(formatSetComparisonPerformance(
    { ...repsSet, targetUnit: "seconds", weightUnit: "kg" },
    performance({ actualWeight: 20, actualReps: null, actualDurationSec: 30, weightUnit: "kg" }),
  ), "20 kg × 30 sec");
  assert.equal(formatSetComparisonPerformance(
    { ...repsSet, targetUnit: "rounds" },
    performance({ actualWeight: 22.5, actualReps: 6 }),
  ), "22.5 lb × 6 rounds");
});

test("uses explicit skipped and missing states and formats live input", () => {
  assert.equal(formatSetComparisonPerformance(repsSet, undefined), "—");
  assert.equal(formatSetComparisonPerformance(
    repsSet,
    performance({ status: "Skipped", actualWeight: null, actualReps: null }),
  ), "Skipped");
  assert.equal(formatSetComparisonPerformance(
    repsSet,
    liveSetComparisonPerformance(repsSet, "145", "7"),
  ), "145 lb × 7 reps");
  assert.equal(formatSetComparisonPerformance(
    repsSet,
    liveSetComparisonPerformance(repsSet, "", ""),
  ), "— × —");
});
