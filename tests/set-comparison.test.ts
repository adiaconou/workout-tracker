import assert from "node:assert/strict";
import test from "node:test";
import {
  alignPreviousExerciseSets,
  formatSetComparisonPerformance,
  liveSetComparisonPerformance,
  type ComparisonPerformance,
  type ComparisonSet,
} from "../src/client/workouts/set-comparison";
import type { PreviousExerciseSet } from "../src/contracts/api";

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

function previousSet(
  overrides: Partial<PreviousExerciseSet> = {},
): PreviousExerciseSet {
  return {
    setNumber: 1,
    sourceRoutineSetId: null,
    setType: "regular",
    targetType: "reps",
    actualWeight: 135,
    actualReps: 8,
    actualDurationSec: null,
    weightUnit: "lb",
    status: "completed",
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

test("uses recorded target semantics when legacy rows contain both result fields", () => {
  assert.equal(formatSetComparisonPerformance(
    repsSet,
    performance({ actualReps: 6, actualDurationSec: 0, targetType: "reps" }),
  ), "135 lb × 6 reps");
  assert.equal(formatSetComparisonPerformance(
    repsSet,
    performance({ actualReps: 0, actualDurationSec: 30, targetType: "duration" }),
  ), "135 lb × 30 sec");
  assert.equal(formatSetComparisonPerformance(
    repsSet,
    performance({ actualReps: 4, actualDurationSec: 0, targetType: "rounds" }),
  ), "135 lb × 4 rounds");
  assert.equal(formatSetComparisonPerformance(
    { ...repsSet, targetUnit: "seconds" },
    performance({ actualReps: 8, actualDurationSec: 25, targetType: "unknown" }),
  ), "135 lb × 25 sec");
});

test("aligns previous sets by stable identity before semantic occurrence", () => {
  const oldSet = previousSet({ sourceRoutineSetId: "old", actualWeight: 100 });
  const stableSet = previousSet({ sourceRoutineSetId: "stable", actualWeight: 200 });
  const aligned = alignPreviousExerciseSets([
    { sourceRoutineSetId: "new", setType: "regular", targetType: "reps" },
    { sourceRoutineSetId: "stable", setType: "regular", targetType: "reps" },
  ], [stableSet, oldSet]);

  assert.deepEqual(aligned.map((set) => set?.sourceRoutineSetId), ["old", "stable"]);
});

test("aligns by set type and target without shifting or reusing prior sets", () => {
  const regular = previousSet({ sourceRoutineSetId: "regular" });
  const drop = previousSet({ sourceRoutineSetId: "drop", setType: "drop" });
  assert.deepEqual(alignPreviousExerciseSets([
    { setType: "warmup", targetType: "reps" },
    { setType: "REGULAR", targetType: "reps" },
    { setType: "drop", targetType: "reps" },
    { setType: "regular", targetType: "reps" },
  ], [regular, drop]).map((set) => set?.sourceRoutineSetId), [
    undefined,
    "regular",
    "drop",
    undefined,
  ]);

  assert.deepEqual(alignPreviousExerciseSets([
    { setType: "regular", targetType: "duration" },
    { setType: "regular", targetType: "reps" },
  ], [regular]).map((set) => set?.sourceRoutineSetId), [undefined, "regular"]);

  const legacy = previousSet({ sourceRoutineSetId: "legacy", targetType: undefined });
  assert.equal(alignPreviousExerciseSets([
    { setType: "regular", targetType: "reps" },
  ], [legacy])[0]?.sourceRoutineSetId, "legacy");
  assert.equal(alignPreviousExerciseSets([
    { setType: "regular", targetType: "unknown" },
  ], [regular])[0], undefined);
});

test("uses the historical load type when the routine load style changed", () => {
  assert.equal(formatSetComparisonPerformance(
    { ...repsSet, loadType: "bodyweight" },
    performance({ actualWeight: 125, loadType: "external" }),
  ), "125 lb × 8 reps");
  assert.equal(formatSetComparisonPerformance(
    repsSet,
    performance({ actualWeight: 0, loadType: "bodyweight" }),
  ), "BW × 8 reps");
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
