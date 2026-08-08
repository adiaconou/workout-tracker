import assert from "node:assert/strict";
import test from "node:test";
import type {
  WorkoutHistorySummary,
  WorkoutSet,
} from "../src/domain/entities";
import type { WorkoutHistoryPage } from "../src/contracts/api";
import {
  buildHistoryRequestPath,
  countActiveHistoryFilters,
  EMPTY_HISTORY_FILTERS,
  groupHistoryWorkouts,
  mergeHistoryPage,
  nonNegativeNumberOrNull,
  normalizeHistoryFilters,
  setCorrectionPayload,
  setEditDraftFromSet,
  setEditValuesFromDraft,
  type SetEditValues,
} from "../src/client/history/history-model";

function summary(
  id: string,
  startedAt: string,
  overrides: Partial<WorkoutHistorySummary> = {},
): WorkoutHistorySummary {
  return {
    id,
    routineCode: "A",
    routineTitle: "Routine A",
    status: "Completed",
    startedAt,
    completedAt: startedAt,
    durationSeconds: 1_800,
    completedSets: 3,
    skippedSets: 0,
    totalSets: 3,
    exerciseCount: 1,
    exerciseNames: ["Push-up"],
    muscleGroups: ["chest"],
    ...overrides,
  };
}

function page(
  workouts: WorkoutHistorySummary[],
  overrides: Partial<WorkoutHistoryPage> = {},
): WorkoutHistoryPage {
  return {
    workouts,
    stats: {
      workoutCount: workouts.length,
      completedSets: workouts.reduce((total, workout) => total + workout.completedSets, 0),
      durationSeconds: workouts.reduce((total, workout) => total + workout.durationSeconds, 0),
    },
    hasMore: false,
    offset: 0,
    ...overrides,
  };
}

function workoutSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: "set-one",
    ownerEmail: "owner@example.com",
    workoutId: "workout-one",
    workoutExerciseId: "workout-exercise-one",
    sourceRoutineSetId: null,
    prescribedSetId: "prescribed-one",
    position: 1,
    setType: "regular",
    plannedTargetType: "reps",
    plannedTargetMin: 8,
    plannedTargetMax: 10,
    plannedTargetDisplay: "8-10 reps",
    plannedRirMin: 1,
    plannedRirMax: 2,
    plannedRestSec: 90,
    plannedRestRule: "standard",
    actualReps: 9,
    actualRepsLeft: null,
    actualRepsRight: null,
    actualDurationSec: null,
    actualWeight: 100,
    weightUnit: "lb",
    actualRir: 2,
    actualRestSec: 85,
    restStartedAt: null,
    restEndedAt: null,
    restSkipped: false,
    status: "completed",
    startedAt: "2026-08-08T10:00:00.000Z",
    elapsedSeconds: 30,
    completedAt: "2026-08-08T10:00:30.000Z",
    notes: "Controlled",
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T10:00:30.000Z",
    ...overrides,
  };
}

test("history filters normalize display text, count active values, and build exact queries", () => {
  assert.deepEqual(normalizeHistoryFilters({
    routineCode: "A",
    status: "Completed",
    exercise: "  bench press  ",
  }), {
    routineCode: "A",
    status: "Completed",
    exercise: "bench press",
  });
  assert.equal(countActiveHistoryFilters(EMPTY_HISTORY_FILTERS), 0);
  assert.equal(countActiveHistoryFilters({
    routineCode: "",
    status: "",
    exercise: "   ",
  }), 0);
  assert.equal(countActiveHistoryFilters({
    routineCode: "B",
    status: "Partial",
    exercise: " squat ",
  }), 3);

  assert.equal(
    buildHistoryRequestPath("all", EMPTY_HISTORY_FILTERS, 0),
    "/api/v1/workouts?view=history&limit=20&offset=0",
  );
  const path = buildHistoryRequestPath(
    "30",
    { routineCode: "B", status: "Partial", exercise: " incline press " },
    20,
    new Date("2026-08-08T12:00:00.000Z"),
  );
  const url = new URL(path, "https://tracker.example");
  assert.equal(url.pathname, "/api/v1/workouts");
  assert.equal(url.searchParams.get("view"), "history");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("offset"), "20");
  assert.equal(url.searchParams.get("from"), "2026-07-09T12:00:00.000Z");
  assert.equal(url.searchParams.get("routineCode"), "B");
  assert.equal(url.searchParams.get("status"), "Partial");
  assert.equal(url.searchParams.get("exercise"), "incline press");
});

test("history pagination replaces refreshes and appends later pages with incoming metadata", () => {
  const firstWorkout = summary("first", "2026-08-08T10:00:00.000Z");
  const secondWorkout = summary("second", "2026-08-07T10:00:00.000Z");
  const current = page([firstWorkout], { hasMore: true, offset: 0 });
  const incoming = page([secondWorkout], {
    hasMore: false,
    offset: 20,
    stats: { workoutCount: 2, completedSets: 6, durationSeconds: 3_600 },
  });

  assert.equal(mergeHistoryPage(current, incoming, 0), incoming);
  assert.equal(mergeHistoryPage(null, incoming, 20), incoming);
  assert.deepEqual(mergeHistoryPage(current, incoming, 20), {
    ...incoming,
    workouts: [firstWorkout, secondWorkout],
  });
});

test("history grouping retains order and combines workouts on the same local day", () => {
  const now = new Date(2026, 7, 8, 12, 0, 0);
  const todayMorning = new Date(2026, 7, 8, 8, 0, 0).toISOString();
  const todayEvening = new Date(2026, 7, 8, 18, 0, 0).toISOString();
  const yesterday = new Date(2026, 7, 7, 12, 0, 0).toISOString();
  const history = page([
    summary("morning", todayMorning),
    summary("evening", todayEvening),
    summary("prior", yesterday),
  ]);

  assert.deepEqual(groupHistoryWorkouts(null, now), []);
  const groups = groupHistoryWorkouts(history, now);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]![1].label, "Today");
  assert.deepEqual(groups[0]![1].workouts.map((workout) => workout.id), ["morning", "evening"]);
  assert.equal(groups[1]![1].label, "Yesterday");
  assert.deepEqual(groups[1]![1].workouts.map((workout) => workout.id), ["prior"]);
  assert.equal(groupHistoryWorkouts(history).length, 2);
});

test("set edit number parsing accepts finite non-negative values only", () => {
  assert.equal(nonNegativeNumberOrNull(""), null);
  assert.equal(nonNegativeNumberOrNull("   "), null);
  assert.equal(nonNegativeNumberOrNull("0"), 0);
  assert.equal(nonNegativeNumberOrNull(" 12.5 "), 12.5);
  assert.equal(nonNegativeNumberOrNull("-1"), null);
  assert.equal(nonNegativeNumberOrNull("Infinity"), null);
  assert.equal(nonNegativeNumberOrNull("not-a-number"), null);
});

test("set edit drafts reflect reps, duration, completed, skipped, and blank source state", () => {
  assert.deepEqual(setEditDraftFromSet(workoutSet()), {
    status: "completed",
    weight: "100",
    result: "9",
    rir: "2",
    rest: "85",
    notes: "Controlled",
  });
  assert.deepEqual(setEditDraftFromSet(workoutSet({
    status: "skipped",
    plannedTargetType: "duration",
    actualWeight: null,
    actualDurationSec: null,
    actualRir: null,
    actualRestSec: null,
    notes: "Skipped for pain",
  })), {
    status: "skipped",
    weight: "",
    result: "",
    rir: "",
    rest: "",
    notes: "Skipped for pain",
  });
  assert.equal(setEditDraftFromSet(workoutSet({ actualReps: null })).result, "");
  assert.equal(setEditDraftFromSet(workoutSet({
    plannedTargetType: "duration",
    actualDurationSec: 45,
  })).result, "45");
});

test("set edit drafts become target-specific numeric values", () => {
  const repValues = setEditValuesFromDraft(workoutSet(), {
    status: "completed",
    weight: "125.5",
    result: "10",
    rir: "-1",
    rest: " ",
    notes: "Rep edit",
  });
  assert.deepEqual(repValues, {
    status: "completed",
    weight: 125.5,
    reps: 10,
    duration: null,
    rir: null,
    rest: null,
    notes: "Rep edit",
  });

  const durationValues = setEditValuesFromDraft(workoutSet({ plannedTargetType: "duration" }), {
    status: "skipped",
    weight: "invalid",
    result: "60",
    rir: "3",
    rest: "90",
    notes: "Duration edit",
  });
  assert.deepEqual(durationValues, {
    status: "skipped",
    weight: null,
    reps: null,
    duration: 60,
    rir: 3,
    rest: 90,
    notes: "Duration edit",
  });
});

test("set correction payload keeps completed measurements and clears skipped ones", () => {
  const completed: SetEditValues = {
    status: "completed",
    weight: 100,
    reps: 8,
    duration: null,
    rir: 2,
    rest: 90,
    notes: "Good set",
  };
  assert.deepEqual(setCorrectionPayload(completed), {
    status: "completed",
    actualWeight: 100,
    actualReps: 8,
    actualDurationSec: null,
    actualRir: 2,
    actualRestSec: 90,
    notes: "Good set",
  });
  assert.deepEqual(setCorrectionPayload({
    ...completed,
    status: "skipped",
    notes: "Shoulder pain",
  }), {
    status: "skipped",
    actualWeight: null,
    actualReps: null,
    actualDurationSec: null,
    actualRir: null,
    actualRestSec: null,
    notes: "Shoulder pain",
  });
});
