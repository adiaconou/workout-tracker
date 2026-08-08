import assert from "node:assert/strict";
import test from "node:test";
import {
  createSetRecordBody,
  discardWorkoutSuccessState,
  elapsedFromAnchor,
  finishEarlySuccessState,
  pendingFinishError,
  prepareSetRecord,
  recordedSetPerformance,
  recordSetSuccessState,
  resultUnitName,
  type ActiveWorkoutSet,
  type CompleteWorkoutResponse,
  type RecordSetResponse,
} from "../src/client/workouts/active-workout-model";

const repsSet: ActiveWorkoutSet = {
  id: "set-1",
  targetUnit: "reps",
  weightUnit: "lb",
};

function recordResponse(overrides: Partial<RecordSetResponse> = {}): RecordSetResponse {
  return {
    performanceId: "performance-1",
    completedSets: 2,
    skippedSets: 1,
    nextSetIndex: 3,
    restSeconds: 90,
    restEndsAt: null,
    workoutCompleted: false,
    workoutElapsedSeconds: 120,
    ...overrides,
  };
}

test("elapsed anchors clamp clock skew and elapsed time at zero", () => {
  assert.equal(elapsedFromAnchor({ seconds: 10, anchoredAt: 1_000 }, 3_999), 12);
  assert.equal(elapsedFromAnchor({ seconds: 10, anchoredAt: 5_000 }, 4_000), 10);
  assert.equal(elapsedFromAnchor({ seconds: -3, anchoredAt: 5_000 }, 4_000), 0);
});

test("result labels preserve every supported unit and capitalization", () => {
  assert.equal(resultUnitName("reps"), "reps");
  assert.equal(resultUnitName("seconds"), "seconds");
  assert.equal(resultUnitName("rounds"), "rounds");
  assert.equal(resultUnitName("rounds", true), "Rounds");
});

test("completed set validation rejects invalid weight before result", () => {
  assert.deepEqual(prepareSetRecord({
    set: repsSet,
    status: "Completed",
    weight: "not-a-number",
    result: "also-invalid",
  }), {
    ok: false,
    error: "Enter the weight used for this set.",
  });
  assert.deepEqual(prepareSetRecord({
    set: repsSet,
    status: "Completed",
    weight: "-1",
    result: "5",
  }), {
    ok: false,
    error: "Enter the weight used for this set.",
  });
});

test("completed set validation names invalid result units", () => {
  assert.deepEqual(prepareSetRecord({
    set: repsSet,
    status: "Completed",
    weight: "100",
    result: "Infinity",
  }), {
    ok: false,
    error: "Enter the reps completed.",
  });
  assert.deepEqual(prepareSetRecord({
    set: { ...repsSet, targetUnit: "seconds" },
    status: "Completed",
    weight: "100",
    result: "-1",
  }), {
    ok: false,
    error: "Enter the seconds completed.",
  });
});

test("completed repetition and duration sets produce exact queued payloads", () => {
  assert.deepEqual(prepareSetRecord({
    set: repsSet,
    status: "Completed",
    weight: "100.5",
    result: "8",
  }), {
    ok: true,
    numericWeight: 100.5,
    numericResult: 8,
  });
  assert.deepEqual(prepareSetRecord({
    set: { ...repsSet, id: "timed", targetUnit: "seconds" },
    status: "Completed",
    weight: "0",
    result: "30",
  }), {
    ok: true,
    numericWeight: 0,
    numericResult: 30,
  });
  assert.deepEqual(createSetRecordBody({
    set: repsSet,
    status: "Completed",
    numericWeight: 100.5,
    numericResult: 8,
    workoutElapsedSeconds: 42,
  }), {
    prescribedSetId: "set-1",
    status: "Completed",
    workoutElapsedSeconds: 42,
    actualWeight: 100.5,
    actualReps: 8,
    actualDurationSec: null,
  });
  assert.deepEqual(createSetRecordBody({
    set: { ...repsSet, id: "timed", targetUnit: "seconds" },
    status: "Completed",
    numericWeight: 0,
    numericResult: 30,
    workoutElapsedSeconds: 43,
  }), {
      prescribedSetId: "timed",
      status: "Completed",
      workoutElapsedSeconds: 43,
      actualWeight: 0,
      actualReps: null,
      actualDurationSec: 30,
  });
});

test("skipped sets bypass numeric validation and persist null measurements", () => {
  const prepared = prepareSetRecord({
    set: repsSet,
    status: "Skipped",
    weight: "invalid",
    result: "invalid",
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(Number.isNaN(prepared.numericWeight), true);
  assert.equal(Number.isNaN(prepared.numericResult), true);
  assert.deepEqual(createSetRecordBody({
    set: repsSet,
    status: "Skipped",
    numericWeight: prepared.numericWeight,
    numericResult: prepared.numericResult,
    workoutElapsedSeconds: 44,
  }), {
    prescribedSetId: "set-1",
    status: "Skipped",
    workoutElapsedSeconds: 44,
    actualWeight: null,
    actualReps: null,
    actualDurationSec: null,
  });
});

test("optimistic recorded performance matches queued set semantics", () => {
  assert.deepEqual(recordedSetPerformance(repsSet, "Completed", 100, 8), {
    status: "Completed",
    actualWeight: 100,
    actualReps: 8,
    actualDurationSec: null,
    weightUnit: "lb",
  });
  assert.deepEqual(recordedSetPerformance(
    { ...repsSet, targetUnit: "seconds", weightUnit: "kg" },
    "Completed",
    20,
    30,
  ), {
    status: "Completed",
    actualWeight: 20,
    actualReps: null,
    actualDurationSec: 30,
    weightUnit: "kg",
  });
  assert.deepEqual(recordedSetPerformance(repsSet, "Skipped", 100, 8), {
    status: "Skipped",
    actualWeight: null,
    actualReps: null,
    actualDurationSec: null,
    weightUnit: "lb",
  });
});

test("record success transitions completed workouts to a terminal state", () => {
  assert.deepEqual(recordSetSuccessState(recordResponse({ workoutCompleted: true }), 5_000), {
    completedSets: 2,
    skippedSets: 1,
    workoutCompleted: true,
    restEndsAt: null,
    nextSet: null,
  });
});

test("record success anchors the next set to valid rest end or response time", () => {
  const restEndsAt = "2026-08-08T12:00:00.000Z";
  assert.deepEqual(recordSetSuccessState(recordResponse({ restEndsAt }), 5_000), {
    completedSets: 2,
    skippedSets: 1,
    workoutCompleted: false,
    restEndsAt,
    nextSet: {
      index: 3,
      restSeconds: 90,
      elapsedAnchor: { seconds: 0, anchoredAt: Date.parse(restEndsAt) },
    },
  });
  assert.equal(
    recordSetSuccessState(recordResponse(), 5_000).nextSet?.elapsedAnchor.anchoredAt,
    5_000,
  );
  assert.equal(
    recordSetSuccessState(recordResponse({ restEndsAt: "invalid" }), 6_000)
      .nextSet?.elapsedAnchor.anchoredAt,
    6_000,
  );
});

test("pending writes block finish while synced workouts may finish", () => {
  assert.equal(pendingFinishError(0), null);
  assert.equal(
    pendingFinishError(2),
    "Sync the pending set before finishing this workout.",
  );
});

test("finish and discard transitions clear volatile workout UI state", () => {
  const response: CompleteWorkoutResponse = {
    completedSets: 4,
    skippedSets: 2,
    remainingSetsSkipped: 1,
    workoutCompleted: true,
    endedEarly: true,
  };
  assert.deepEqual(finishEarlySuccessState(response, 321, 9_000), {
    workoutElapsedAnchor: { seconds: 321, anchoredAt: 9_000 },
    timingNow: 9_000,
    completedSets: 4,
    skippedSets: 2,
    restEndsAt: null,
    secondsRemaining: 0,
    stopwatchStartedAt: null,
    showFinishEarly: false,
    showFullProgress: false,
    workoutCompleted: true,
  });
  assert.deepEqual(discardWorkoutSuccessState(), {
    restEndsAt: null,
    secondsRemaining: 0,
    stopwatchStartedAt: null,
    showDiscardWorkout: false,
    showFinishEarly: false,
    showFullProgress: false,
  });
});
