import assert from "node:assert/strict";
import test from "node:test";
import type { PreviousExerciseSet } from "../src/contracts/api";
import { recommendProgressiveTarget } from "../src/client/workouts/progressive-target";

const baseSet = {
  loadType: "external",
  setType: "regular" as const,
  targetMin: 8,
  targetMax: 10,
  targetType: "reps" as const,
  targetUnit: "reps" as const,
  weightUnit: "lb",
};

function previous(
  overrides: Partial<PreviousExerciseSet> = {},
): PreviousExerciseSet {
  return {
    setNumber: 1,
    setType: "regular",
    targetType: "reps",
    loadType: "external",
    actualWeight: 100,
    actualReps: 8,
    actualDurationSec: null,
    weightUnit: "lb",
    status: "Completed",
    ...overrides,
  };
}

test("progresses through a rep range, then makes a small load increase", () => {
  assert.deepEqual(recommendProgressiveTarget(baseSet, previous()), {
    status: "Completed",
    actualWeight: 100,
    actualReps: 9,
    actualDurationSec: null,
    weightUnit: "lb",
    targetType: "reps",
    loadType: "external",
  });
  assert.deepEqual(recommendProgressiveTarget(
    baseSet,
    previous({ actualReps: 9.5 }),
  )?.actualReps, 10);
  assert.deepEqual(recommendProgressiveTarget(
    baseSet,
    previous({ actualReps: 10 }),
  ), {
    status: "Completed",
    actualWeight: 102.5,
    actualReps: 8,
    actualDurationSec: null,
    weightUnit: "lb",
    targetType: "reps",
    loadType: "external",
  });
});

test("retries the range floor after a miss and holds special-purpose sets steady", () => {
  assert.equal(
    recommendProgressiveTarget(baseSet, previous({ actualReps: 7 }))?.actualReps,
    8,
  );
  for (const setType of ["warmup", "failure", "drop", "emom", "test"] as const) {
    assert.equal(
      recommendProgressiveTarget(
        { ...baseSet, setType },
        previous({ actualReps: 9 }),
      )?.actualReps,
      9,
    );
  }
});

test("progresses duration and round targets in their own units", () => {
  const duration = recommendProgressiveTarget({
    ...baseSet,
    loadType: "bodyweight",
    targetType: "duration" as const,
    targetUnit: "seconds" as const,
    targetMin: 30,
    targetMax: 45,
  }, previous({
    loadType: "bodyweight",
    targetType: "duration",
    actualWeight: null,
    actualReps: null,
    actualDurationSec: 35,
    weightUnit: "",
  }));
  assert.deepEqual(duration, {
    status: "Completed",
    actualWeight: 0,
    actualReps: null,
    actualDurationSec: 40,
    weightUnit: "lb",
    targetType: "duration",
    loadType: "bodyweight",
  });
  assert.equal(recommendProgressiveTarget({
    ...baseSet,
    loadType: "bodyweight",
    targetType: undefined,
    targetUnit: "seconds" as const,
    targetMin: null,
    targetMax: null,
  }, previous({
    loadType: "bodyweight",
    targetType: undefined,
    actualWeight: 0,
    actualReps: null,
    actualDurationSec: 20,
  }))?.targetType, "duration");

  const rounds = recommendProgressiveTarget({
    ...baseSet,
    loadType: "bodyweight",
    targetType: "rounds" as const,
    targetUnit: "rounds" as const,
    targetMin: null,
    targetMax: null,
  }, previous({
    loadType: "bodyweight",
    targetType: "rounds",
    actualWeight: 0,
    actualReps: 4,
  }));
  assert.equal(rounds?.actualReps, 5);
});

test("adjusts added, weighted-bodyweight, and assistance loads conservatively", () => {
  const atTop = previous({ actualReps: 10 });
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, loadType: "added", weightUnit: "kg" },
    { ...atTop, loadType: "added", actualWeight: 10, weightUnit: "kg" },
  )?.actualWeight, 11);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, loadType: "bodyweight" },
    { ...atTop, loadType: "bodyweight", actualWeight: 20 },
  )?.actualWeight, 22.5);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, loadType: "assistance" },
    { ...atTop, loadType: "assistance", actualWeight: 20 },
  )?.actualWeight, 17.5);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, loadType: "assistance" },
    { ...atTop, loadType: "assistance", actualWeight: 1 },
  )?.actualWeight, 0);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, loadType: "assistance" },
    { ...atTop, loadType: "assistance", actualWeight: 0 },
  )?.actualReps, 11);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, loadType: "bodyweight" },
    { ...atTop, loadType: "bodyweight", actualWeight: null },
  )?.actualReps, 11);
});

test("converts comparable load units and avoids inventing unsupported increments", () => {
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, weightUnit: "kg", targetMax: 20 },
    previous({ actualWeight: 22.046226218, actualReps: 8, weightUnit: "lb" }),
  )?.actualWeight, 10);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, weightUnit: "kg" },
    previous({ actualWeight: 100, actualReps: 10, weightUnit: "lb" }),
  )?.actualWeight, 46);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, weightUnit: "plates", targetMax: null },
    previous({ actualWeight: 4, weightUnit: " PLATES " }),
  )?.actualWeight, 4);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, weightUnit: "plates" },
    previous({ actualWeight: 4, actualReps: 10, weightUnit: "plates" }),
  )?.actualReps, 10);
});

test("returns no baseline for skipped, invalid, or incomparable history", () => {
  assert.equal(recommendProgressiveTarget(baseSet, undefined), undefined);
  assert.equal(recommendProgressiveTarget(baseSet, previous({ status: "Skipped" })), undefined);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, loadType: "unknown" },
    previous(),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ loadType: "bodyweight" }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ targetType: "duration" }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ targetType: "unknown" }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ actualReps: null }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ actualReps: Number.NaN }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ actualReps: 0 }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ actualWeight: null }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ actualWeight: Number.NaN }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    baseSet,
    previous({ actualWeight: -1 }),
  ), undefined);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, weightUnit: "kg" },
    previous({ weightUnit: "plates" }),
  ), undefined);
});

test("supports legacy comparable rows while respecting range edge cases", () => {
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, targetType: undefined, targetMin: Number.NaN, targetMax: Number.NaN },
    previous({ targetType: undefined, loadType: undefined, actualWeight: 0 }),
  )?.actualReps, 9);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, targetMin: null, targetMax: 8 },
    previous({ actualReps: 8 }),
  )?.actualReps, 8);
  assert.equal(recommendProgressiveTarget(
    { ...baseSet, targetMin: 8, targetMax: 8, weightUnit: "plates" },
    previous({ actualWeight: 4, actualReps: 8, weightUnit: "" }),
  )?.actualReps, 8);
});
