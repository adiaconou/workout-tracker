import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExerciseProgress,
  canonicalWeightUnit,
  convertWeight,
  epleyEstimatedOneRepMax,
  type ExerciseProgressCandidate,
} from "../domain/exercise-progress";

function candidate(
  overrides: Partial<ExerciseProgressCandidate> = {},
): ExerciseProgressCandidate {
  return {
    workoutId: "workout-1",
    routineCode: "A",
    routineTitle: "Upper strength",
    workoutStatus: "Completed",
    performedAt: "2026-08-01T18:00:00.000Z",
    setId: "set-1",
    loadType: "external",
    targetType: "reps",
    setType: "regular",
    setPosition: 1,
    actualWeight: 225,
    actualReps: 5,
    actualRepsLeft: null,
    actualRepsRight: null,
    actualDurationSec: null,
    weightUnit: "lb",
    bodyWeight: null,
    bodyWeightUnit: "lb",
    bodyWeightSource: null,
    ...overrides,
  };
}

test("calculates Epley strength without inflating one-rep sets", () => {
  assert.equal(epleyEstimatedOneRepMax(315, 1), 315);
  assert.equal(epleyEstimatedOneRepMax(225, 5), 262.5);
});

test("selects the strongest eligible completed working set in each workout", () => {
  const progress = buildExerciseProgress({
    exerciseId: "bench",
    trackingType: "reps",
    defaultLoadType: "external",
    limit: 16,
    candidates: [
      candidate({ setId: "225x5", actualWeight: 225, actualReps: 5 }),
      candidate({ setId: "235x2", setPosition: 2, actualWeight: 235, actualReps: 2 }),
      candidate({ setId: "high-reps", setPosition: 3, actualWeight: 200, actualReps: 20 }),
      candidate({ setId: "drop", setPosition: 4, setType: "drop", actualWeight: 250, actualReps: 5 }),
      candidate({ setId: "warmup", setPosition: 5, setType: "warmup", actualWeight: 300, actualReps: 5 }),
    ],
  });

  assert.equal(progress.metric, "epley_estimated_1rm");
  assert.equal(progress.points.length, 1);
  assert.equal(progress.points[0]?.setId, "225x5");
  assert.equal(progress.points[0]?.value, 262.5);
});

test("normalizes supported weight units before comparing progress", () => {
  assert.equal(canonicalWeightUnit("LBS."), "lb");
  assert.equal(canonicalWeightUnit("kilograms"), "kg");
  assert.ok(Math.abs(convertWeight(100, "kg", "lb") - 220.46226218) < 0.000001);

  const progress = buildExerciseProgress({
    exerciseId: "bench",
    trackingType: "reps",
    defaultLoadType: "external",
    limit: 16,
    candidates: [
      candidate({
        workoutId: "kg-workout",
        setId: "kg-set",
        performedAt: "2026-07-01T18:00:00.000Z",
        actualWeight: 100,
        actualReps: 5,
        weightUnit: "kg",
      }),
      candidate({
        workoutId: "lb-workout",
        setId: "lb-set",
        performedAt: "2026-08-01T18:00:00.000Z",
        actualWeight: 225,
        actualReps: 5,
        weightUnit: "lb",
      }),
    ],
  });

  assert.equal(progress.unit, "lb");
  assert.equal(progress.points.length, 2);
  assert.ok((progress.points[0]?.value ?? 0) > 257);
  assert.equal(progress.points[1]?.value, 262.5);
});

test("converts bodyweight, added load, and assistance into one total-load estimate", () => {
  const progress = buildExerciseProgress({
    exerciseId: "pull-up",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    limit: 16,
    unit: "kg",
    candidates: [
      candidate({
        workoutId: "bodyweight",
        setId: "bodyweight-set",
        performedAt: "2026-06-01T18:00:00.000Z",
        loadType: "bodyweight",
        actualWeight: 10,
        actualReps: 5,
        weightUnit: "kg",
        bodyWeight: 90,
        bodyWeightUnit: "kg",
        bodyWeightSource: "manual",
      }),
      candidate({
        workoutId: "added",
        setId: "added-set",
        performedAt: "2026-07-01T18:00:00.000Z",
        loadType: "added",
        actualWeight: 22.046226218,
        actualReps: 5,
        weightUnit: "lb",
        bodyWeight: 90,
        bodyWeightUnit: "kg",
        bodyWeightSource: "profile_backfill",
      }),
      candidate({
        workoutId: "assisted",
        setId: "assisted-set",
        performedAt: "2026-08-01T18:00:00.000Z",
        loadType: "assistance",
        actualWeight: 10,
        actualReps: 5,
        weightUnit: "kg",
        bodyWeight: 90,
        bodyWeightUnit: "kg",
        bodyWeightSource: "profile_snapshot",
      }),
    ],
  });

  assert.equal(progress.metric, "epley_estimated_total_load");
  assert.equal(progress.unit, "kg");
  assert.deepEqual(
    progress.points.map((point) => ({
      workoutId: point.workoutId,
      loadType: point.loadType,
      effectiveLoad: Math.round((point.effectiveLoad ?? 0) * 1000) / 1000,
      effectiveLoadUnit: point.effectiveLoadUnit,
      bodyWeight: point.bodyWeight,
      bodyWeightUnit: point.bodyWeightUnit,
      bodyWeightEstimated: point.bodyWeightEstimated,
    })),
    [
      {
        workoutId: "bodyweight",
        loadType: "bodyweight",
        effectiveLoad: 100,
        effectiveLoadUnit: "kg",
        bodyWeight: 90,
        bodyWeightUnit: "kg",
        bodyWeightEstimated: false,
      },
      {
        workoutId: "added",
        loadType: "added",
        effectiveLoad: 100,
        effectiveLoadUnit: "kg",
        bodyWeight: 90,
        bodyWeightUnit: "kg",
        bodyWeightEstimated: true,
      },
      {
        workoutId: "assisted",
        loadType: "assistance",
        effectiveLoad: 80,
        effectiveLoadUnit: "kg",
        bodyWeight: 90,
        bodyWeightUnit: "kg",
        bodyWeightEstimated: false,
      },
    ],
  );
  assert.ok(Math.abs((progress.points[1]?.value ?? 0) - 116.6666667) < 0.000001);
  assert.ok(Math.abs((progress.points[2]?.value ?? 0) - 93.3333333) < 0.000001);
});

test("keeps a weighted bodyweight-family series pure and falls back entirely to reps", () => {
  const weighted = buildExerciseProgress({
    exerciseId: "pull-up",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    limit: 16,
    candidates: [
      candidate({
        workoutId: "eligible",
        setId: "eligible-set",
        performedAt: "2026-07-01T18:00:00.000Z",
        loadType: "bodyweight",
        actualWeight: 0,
        actualReps: 5,
        bodyWeight: 180,
      }),
      candidate({
        workoutId: "high-reps",
        setId: "high-reps-set",
        performedAt: "2026-08-01T18:00:00.000Z",
        loadType: "bodyweight",
        actualWeight: 0,
        actualReps: 20,
        bodyWeight: 180,
      }),
    ],
  });
  assert.equal(weighted.metric, "epley_estimated_total_load");
  assert.deepEqual(weighted.points.map((point) => point.workoutId), ["eligible"]);

  const repsOnly = buildExerciseProgress({
    exerciseId: "pull-up",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    limit: 16,
    candidates: [
      candidate({
        workoutId: "missing-weight",
        setId: "missing-weight-set",
        loadType: "bodyweight",
        actualWeight: 0,
        actualReps: 12,
        bodyWeight: null,
      }),
    ],
  });
  assert.equal(repsOnly.metric, "reps");
  assert.equal(repsOnly.points[0]?.value, 12);
  assert.equal(repsOnly.points[0]?.effectiveLoad, null);
  assert.equal(repsOnly.points[0]?.effectiveLoadUnit, null);
});

test("uses completed reps for bodyweight and unilateral observations", () => {
  const progress = buildExerciseProgress({
    exerciseId: "pull-up",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    limit: 1,
    candidates: [
      candidate({
        workoutId: "older",
        setId: "older-set",
        performedAt: "2026-07-01T18:00:00.000Z",
        loadType: "bodyweight",
        actualWeight: 0,
        actualReps: 8,
      }),
      candidate({
        workoutId: "newer",
        setId: "newer-set",
        performedAt: "2026-08-01T18:00:00.000Z",
        loadType: "bodyweight",
        actualWeight: 0,
        actualReps: null,
        actualRepsLeft: 10,
        actualRepsRight: 9,
      }),
    ],
  });

  assert.equal(progress.metric, "reps");
  assert.equal(progress.unit, "reps");
  assert.equal(progress.hasMore, true);
  assert.deepEqual(progress.points.map((point) => point.actualReps), [9]);
});

test("falls back to reps when an external series has no valid weighted observations", () => {
  const progress = buildExerciseProgress({
    exerciseId: "bench",
    trackingType: "reps",
    defaultLoadType: "external",
    limit: 16,
    candidates: [
      candidate({ actualWeight: 100, actualReps: 20 }),
      candidate({
        workoutId: "unknown-unit",
        setId: "unknown-unit-set",
        performedAt: "2026-08-02T18:00:00.000Z",
        actualWeight: 100,
        actualReps: 5,
        weightUnit: "plates",
      }),
    ],
  });

  assert.equal(progress.metric, "reps");
  assert.deepEqual(progress.points.map((point) => point.value), [20, 5]);
  assert.ok(progress.points.every((point) => point.effectiveLoad === null));
});

test("keeps rep trends within the latest historical load mode", () => {
  const progress = buildExerciseProgress({
    exerciseId: "pull-up",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    limit: 16,
    candidates: [
      candidate({
        workoutId: "assisted",
        setId: "assisted-set",
        performedAt: "2026-07-01T18:00:00.000Z",
        loadType: "assistance",
        actualWeight: 50,
        actualReps: 12,
      }),
      candidate({
        workoutId: "bodyweight",
        setId: "bodyweight-set",
        performedAt: "2026-08-01T18:00:00.000Z",
        loadType: "bodyweight",
        actualWeight: 0,
        actualReps: 8,
      }),
    ],
  });

  assert.equal(progress.metric, "reps");
  assert.deepEqual(progress.points.map((point) => point.workoutId), ["bodyweight"]);
});

test("uses actual duration and rounds instead of elapsed set time", () => {
  const duration = buildExerciseProgress({
    exerciseId: "plank",
    trackingType: "duration",
    defaultLoadType: "bodyweight",
    limit: 16,
    candidates: [candidate({
      targetType: "duration",
      loadType: "bodyweight",
      actualWeight: null,
      actualReps: null,
      actualDurationSec: 75,
    })],
  });
  assert.equal(duration.metric, "duration");
  assert.equal(duration.points[0]?.value, 75);

  const rounds = buildExerciseProgress({
    exerciseId: "circuit",
    trackingType: "rounds",
    defaultLoadType: "bodyweight",
    limit: 16,
    candidates: [candidate({
      targetType: "rounds",
      loadType: "bodyweight",
      actualWeight: null,
      actualReps: 6,
    })],
  });
  assert.equal(rounds.metric, "rounds");
  assert.equal(rounds.points[0]?.value, 6);
});
