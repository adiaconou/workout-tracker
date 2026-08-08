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

test("does not silently replace an ineligible external strength series with reps", () => {
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

  assert.equal(progress.metric, "epley_estimated_1rm");
  assert.deepEqual(progress.points, []);
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
