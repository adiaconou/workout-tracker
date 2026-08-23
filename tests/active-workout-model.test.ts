import assert from "node:assert/strict";
import test from "node:test";
import {
  createSetCorrectionBody,
  createSetRecordBody,
  discardWorkoutSuccessState,
  elapsedFromAnchor,
  finishEarlySuccessState,
  initialSetNavigation,
  moveViewedSet,
  pendingFinishError,
  prepareSetRecord,
  recordedSetPerformance,
  recordSetSuccessState,
  reconcileSetNavigation,
  resultUnitName,
  supersetContext,
  viewedSetPosition,
  viewSetAtIndex,
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
    workoutSetId: "workout-set-1",
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
    weight: "   ",
    result: "5",
  }), {
    ok: false,
    error: "Enter the weight used for this set.",
  });
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
    result: " ",
  }), {
    ok: false,
    error: "Enter the reps completed.",
  });
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
    weight: "0",
    result: "0",
  }), {
    ok: true,
    numericWeight: 0,
    numericResult: 0,
  });
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

test("set corrections replace the measurement appropriate to the target unit", () => {
  assert.deepEqual(createSetCorrectionBody({
    set: repsSet,
    status: "Completed",
    numericWeight: 100.5,
    numericResult: 8,
  }), {
    status: "completed",
    actualWeight: 100.5,
    actualReps: 8,
    actualDurationSec: null,
  });
  assert.deepEqual(createSetCorrectionBody({
    set: { ...repsSet, targetUnit: "rounds" },
    status: "Completed",
    numericWeight: 20,
    numericResult: 4,
  }), {
    status: "completed",
    actualWeight: 20,
    actualReps: 4,
    actualDurationSec: null,
  });
  assert.deepEqual(createSetCorrectionBody({
    set: { ...repsSet, targetUnit: "seconds" },
    status: "Completed",
    numericWeight: 0,
    numericResult: 45,
  }), {
    status: "completed",
    actualWeight: 0,
    actualReps: null,
    actualDurationSec: 45,
  });
});

test("skipped set corrections clear measurements", () => {
  assert.deepEqual(createSetCorrectionBody({
    set: repsSet,
    status: "Skipped",
    numericWeight: Number.NaN,
    numericResult: Number.NaN,
  }), {
    status: "skipped",
    actualWeight: null,
    actualReps: null,
    actualDurationSec: null,
  });
});

test("set navigation starts at the authoritative active set", () => {
  assert.deepEqual(initialSetNavigation(3, 6), {
    activeIndex: 3,
    viewedIndex: 3,
  });
  assert.deepEqual(initialSetNavigation(-2, 6), {
    activeIndex: 0,
    viewedIndex: 0,
  });
  assert.deepEqual(initialSetNavigation(20, 6), {
    activeIndex: 5,
    viewedIndex: 5,
  });
  assert.deepEqual(initialSetNavigation(Number.NaN, 0), {
    activeIndex: 0,
    viewedIndex: 0,
  });
});

test("browsing is limited to logged sets and the current active set", () => {
  const navigation = initialSetNavigation(3, 6);
  assert.deepEqual(viewSetAtIndex(navigation, 1.9, 6), {
    activeIndex: 3,
    viewedIndex: 1,
  });
  assert.deepEqual(viewSetAtIndex(navigation, -1, 6), {
    activeIndex: 3,
    viewedIndex: 0,
  });
  assert.deepEqual(viewSetAtIndex(navigation, 5, 6), {
    activeIndex: 3,
    viewedIndex: 3,
  });
  assert.deepEqual(viewSetAtIndex(navigation, Number.POSITIVE_INFINITY, 6), {
    activeIndex: 3,
    viewedIndex: 0,
  });
  assert.deepEqual(moveViewedSet(viewSetAtIndex(navigation, 2, 6), -1, 6), {
    activeIndex: 3,
    viewedIndex: 1,
  });
  assert.deepEqual(moveViewedSet(navigation, 1, 6), navigation);
});

test("navigation distinguishes past results from the actionable current set", () => {
  assert.equal(viewedSetPosition({ activeIndex: 3, viewedIndex: 2 }), "past");
  assert.equal(viewedSetPosition({ activeIndex: 3, viewedIndex: 3 }), "current");
});

test("refresh follows an advancing current set", () => {
  assert.deepEqual(reconcileSetNavigation({
    navigation: { activeIndex: 1, viewedIndex: 1 },
    previousSetIds: ["a", "b", "c"],
    nextSetIds: ["a", "b", "c"],
    nextActiveIndex: 2,
  }), {
    activeIndex: 2,
    viewedIndex: 2,
  });
});

test("refresh preserves a browsed past set by identity", () => {
  assert.deepEqual(reconcileSetNavigation({
    navigation: { activeIndex: 3, viewedIndex: 1 },
    previousSetIds: ["a", "b", "c", "d"],
    nextSetIds: ["a", "c", "b", "d", "e"],
    nextActiveIndex: 3,
  }), {
    activeIndex: 3,
    viewedIndex: 2,
  });
});

test("refresh clamps an unavailable or removed past selection", () => {
  assert.deepEqual(reconcileSetNavigation({
    navigation: { activeIndex: 4, viewedIndex: 3 },
    previousSetIds: ["a", "b", "c", "d", "e"],
    nextSetIds: ["a", "b"],
    nextActiveIndex: 1,
  }), {
    activeIndex: 1,
    viewedIndex: 1,
  });
  assert.deepEqual(reconcileSetNavigation({
    navigation: { activeIndex: 2, viewedIndex: 1 },
    previousSetIds: [],
    nextSetIds: ["a", "b", "c"],
    nextActiveIndex: 2,
  }), {
    activeIndex: 2,
    viewedIndex: 1,
  });
});

test("superset context is absent for missing, blank, or single-member groups", () => {
  assert.equal(supersetContext([], 0), null);
  assert.equal(supersetContext([{
    supersetGroup: "   ",
    exerciseOrder: 1,
    exerciseName: "Row",
    exerciseSetNumber: 1,
    exerciseSetTotal: 3,
  }], 0), null);
  assert.equal(supersetContext([{
    supersetGroup: "A",
    exerciseOrder: 1,
    exerciseName: "Row",
    exerciseSetNumber: 1,
    exerciseSetTotal: 3,
  }, {
    supersetGroup: " A ",
    exerciseOrder: 1,
    exerciseName: "Row",
    exerciseSetNumber: 2,
    exerciseSetTotal: 3,
  }], 0), null);
});

test("superset context describes members in routine order and the current round", () => {
  const sets = [{
    supersetGroup: " A ",
    exerciseOrder: 2,
    exerciseName: "Triceps pressdown",
    exerciseSetNumber: 2,
    exerciseSetTotal: 2,
  }, {
    supersetGroup: "B",
    exerciseOrder: 3,
    exerciseName: "Lateral raise",
    exerciseSetNumber: 1,
    exerciseSetTotal: 3,
  }, {
    supersetGroup: "A",
    exerciseOrder: 1,
    exerciseName: "Barbell curl",
    exerciseSetNumber: 1,
    exerciseSetTotal: 3,
  }, {
    supersetGroup: "A",
    exerciseOrder: 1,
    exerciseName: "Barbell curl",
    exerciseSetNumber: 2,
    exerciseSetTotal: 3,
  }, {
    supersetGroup: "A",
    exerciseOrder: 1,
    exerciseName: "Barbell curl",
    exerciseSetNumber: 3,
    exerciseSetTotal: 3,
  }];

  assert.deepEqual(supersetContext(sets, 0), {
    label: "Superset",
    memberNames: ["Barbell curl", "Triceps pressdown"],
    round: 2,
    totalRounds: 3,
  });
  assert.equal(supersetContext(sets, 1), null);
  assert.equal(supersetContext(sets, 4), null);
});

test("superset context supports display-only legacy grouping", () => {
  assert.deepEqual(supersetContext([{
    supersetDisplayGroup: "legacy-pair",
    exerciseOrder: 1,
    exerciseName: "Curl",
    exerciseSetNumber: 1,
    exerciseSetTotal: 2,
  }, {
    supersetDisplayGroup: "legacy-pair",
    exerciseOrder: 2,
    exerciseName: "Pressdown",
    exerciseSetNumber: 1,
    exerciseSetTotal: 2,
  }], 0), {
    label: "Superset",
    memberNames: ["Curl", "Pressdown"],
    round: 1,
    totalRounds: 2,
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
