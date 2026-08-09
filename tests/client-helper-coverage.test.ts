import assert from "node:assert/strict";
import test from "node:test";
import type { ExerciseProgressPoint, RoutineVersion, WorkoutSet } from "../src/domain/entities";
import type { Exercise, Workout } from "../src/contracts/api";
import {
  profileDisplayName,
  profileInitials,
  safeProfilePhotoUrl,
} from "../src/client/auth/profile-display";
import { stepNumericText } from "../src/client/ui/stepper-value";
import {
  isSafeCoachMarkdownLink,
  sanitizeCoachMarkdown,
} from "../src/client/coach/coach-markdown-policy";
import { exerciseProgressRangeStart } from "../src/client/exercises/exercise-progress-range";
import { exerciseDetailHref, exerciseIdFromParam } from "../src/client/exercises/exercise-routes";
import {
  formatHistoryDateTime,
  formatHistoryDay,
  formatHistoryDuration,
  formatMuscleGroup,
  formatSetResult,
  formatWorkoutDuration,
  historyRangeLabel,
  historyRangeStart,
  historyStatusLabel,
} from "../src/client/history/history-format";
import {
  routineDurationLabel,
  routineLastDoneLabel,
} from "../src/client/routines/routine-card-format";
import {
  createRoutineExerciseFromLibrary,
  duplicateRoutineSet,
  editableRoutineFromVersion,
  isRoutineDraftDirty,
  moveRoutineExercise,
  moveRoutineSet,
  removeRoutineExercise,
  removeRoutineSet,
  routineVersionInputFromEditable,
  type EditableRoutineExercise,
  type EditableRoutineSet,
} from "../src/client/routines/routine-exercise-editing";
import { buildLineChartGeometry } from "../src/client/workouts/active-exercise-progress";
import { formatPreviousSetPerformance } from "../src/client/workouts/previous-performance";
import {
  formatSetComparisonPerformance,
  liveSetComparisonPerformance,
  type ComparisonPerformance,
  type ComparisonSet,
} from "../src/client/workouts/set-comparison";
import { buildCompactSetDetails } from "../src/client/workouts/set-guidance";
import { getSetInputDefaults } from "../src/client/workouts/set-input-defaults";
import {
  formatStopwatch,
  getStopwatchElapsedMs,
  getStopwatchSeconds,
} from "../src/client/workouts/stopwatch";
import { buildWorkoutExerciseProgress } from "../src/client/workouts/workout-progress";
import {
  formatElapsedDuration,
  summarizeWorkoutTiming,
} from "../src/client/workouts/workout-timing";

test("covers profile display and numeric stepper boundary behavior", () => {
  assert.equal(profileDisplayName("  Alex  ", " alex@example.com "), "Alex");
  assert.equal(profileInitials("", ""), "?");
  assert.equal(profileInitials("", "@example.com"), "?");
  assert.equal(profileInitials("Ada Middle Lovelace", "ada@example.com"), "AL");
  assert.equal(safeProfilePhotoUrl("  HTTPS://example.com/photo.png  "), "HTTPS://example.com/photo.png");
  assert.equal(safeProfilePhotoUrl(undefined), null);
  assert.equal(safeProfilePhotoUrl("https://example.com/bad path"), null);

  assert.equal(stepNumericText("not-a-number", 2, 5), "7");
  assert.equal(stepNumericText("5", -3, 5), "5");
  assert.equal(stepNumericText("0.0004", 0.0004), "0.001");
});

test("covers remaining exercise range and route parameter branches", () => {
  const sixMonths = new Date(exerciseProgressRangeStart(
    "6m",
    new Date("2026-08-08T12:00:00.000Z"),
  )!);
  assert.deepEqual(
    [sixMonths.getFullYear(), sixMonths.getMonth(), sixMonths.getDate(), sixMonths.getHours()],
    [2026, 1, 8, 5],
  );

  assert.equal(exerciseIdFromParam([]), "");
  assert.equal(exerciseIdFromParam("v1."), "");
  assert.equal(exerciseIdFromParam("v1.a~2Fb"), "a/b");
  assert.deepEqual(exerciseDetailHref("plain-id"), {
    pathname: "/exercises/[exerciseId]",
    params: { exerciseId: "v1.plain-id" },
  });
});

function workoutSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    status: "completed",
    actualWeight: 135,
    actualReps: 8,
    actualDurationSec: null,
    weightUnit: "lb",
    ...overrides,
  } as WorkoutSet;
}

test("covers every history formatter state", () => {
  assert.equal(historyRangeStart("90", new Date("2026-08-08T00:00:00.000Z")), "2026-05-10T00:00:00.000Z");
  assert.equal(historyRangeStart("365", new Date("2026-08-08T00:00:00.000Z")), "2025-08-08T00:00:00.000Z");
  assert.deepEqual(
    (["30", "90", "365", "all"] as const).map(historyRangeLabel),
    ["Last 30 days", "Last 90 days", "Last year", "All time"],
  );
  assert.equal(formatHistoryDuration(-5), "0m");
  assert.equal(formatHistoryDuration(3600), "1h");
  assert.equal(formatHistoryDuration(60), "1m");
  assert.equal(formatWorkoutDuration(0), "1 min");
  assert.equal(formatWorkoutDuration(90), "2 min");
  assert.deepEqual(
    (["Completed", "Partial", "Abandoned", "In Progress"] as const).map(historyStatusLabel),
    ["Completed", "Finished early", "Abandoned", "In progress"],
  );

  const now = new Date(2026, 7, 8, 12);
  assert.equal(formatHistoryDay(new Date(2026, 7, 8, 8).toISOString(), now), "Today");
  assert.equal(formatHistoryDay(new Date(2026, 7, 7, 23).toISOString(), now), "Yesterday");
  assert.ok(formatHistoryDay(new Date(2026, 7, 1).toISOString(), now).length > 0);
  assert.ok(formatHistoryDateTime("2026-08-08T12:34:00.000Z").length > 0);
  assert.equal(formatMuscleGroup("upper__back"), "Upper  Back");

  assert.equal(
    formatSetResult(workoutSet({
      plannedTargetType: "duration",
      actualWeight: 0,
      actualReps: null,
      actualDurationSec: 30,
    }), "external"),
    "30 sec",
  );
  assert.equal(formatSetResult(workoutSet({
    plannedTargetType: "duration",
    actualReps: 0,
    actualDurationSec: null,
  }), "external"), "—");
  assert.equal(formatSetResult(workoutSet({ actualReps: null }), "external"), "—");
  assert.equal(formatSetResult(workoutSet({ actualWeight: null }), "external"), "8 reps");
  assert.equal(formatSetResult(workoutSet({ actualWeight: 0 }), "added"), "Bodyweight × 8");
  assert.equal(formatSetResult(workoutSet({ actualWeight: 5 }), "bodyweight"), "5 lb × 8");
});

test("covers routine card formatting defensive and fallback paths", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  assert.match(routineLastDoneLabel("2026-08-08T11:00:00.000Z", { now }), /^08\/08\/26 · 0 days ago$/);
  assert.match(routineLastDoneLabel(new Date().toISOString()), /^\d{2}\/\d{2}\/\d{2} · \d+ days? ago$/);
  assert.equal(routineDurationLabel(Number.NaN, 1, 0), "Est. 1 min");
  assert.equal(routineDurationLabel(-1, 1, -3), "Est. 1 min");
  assert.equal(routineDurationLabel(90, 0, 1), "Est. 1 min");
  assert.equal(routineDurationLabel(90, 1.6, 1), "Avg 2 min");
});

function routineVersionFixture(): RoutineVersion {
  return {
    id: "version",
    ownerEmail: "owner@example.com",
    routineId: "routine",
    versionNumber: 1,
    status: "published",
    focus: "Strength",
    summary: "Summary",
    durationMin: 45,
    exercises: [
      {
        id: "placement-2",
        ownerEmail: "owner@example.com",
        routineVersionId: "version",
        exerciseId: "exercise-2",
        exerciseName: "Row",
        position: 2,
        supersetGroup: null,
        instructions: "",
        notes: "",
        sets: [
          {
            id: "set-2b",
            ownerEmail: "owner@example.com",
            routineExerciseId: "placement-2",
            position: 2,
            setType: "regular",
            targetType: "reps",
            targetMin: 8,
            targetMax: 12,
            targetDisplay: "8-12 reps",
            targetRirMin: 2,
            targetRirMax: 2,
            restAfterSec: 90,
            restRule: "standard",
            loadInstruction: "",
            sideMode: "bilateral",
            tempo: undefined as unknown as null,
            notes: "",
            createdAt: "now",
            updatedAt: "now",
          },
          {
            id: "set-2a",
            ownerEmail: "owner@example.com",
            routineExerciseId: "placement-2",
            position: 1,
            setType: "warmup",
            targetType: "reps",
            targetMin: 5,
            targetMax: 5,
            targetDisplay: "5 reps",
            targetRirMin: null,
            targetRirMax: null,
            restAfterSec: 30,
            restRule: "standard",
            loadInstruction: "Light",
            sideMode: "bilateral",
            tempo: null,
            notes: "",
            createdAt: "now",
            updatedAt: "now",
          },
        ],
        createdAt: "now",
        updatedAt: "now",
      },
      {
        id: "placement-1",
        ownerEmail: "owner@example.com",
        routineVersionId: "version",
        exerciseId: "exercise-1",
        exerciseName: "Squat",
        position: 1,
        supersetGroup: null,
        instructions: "",
        notes: "",
        sets: [{
          id: "set-1",
          ownerEmail: "owner@example.com",
          routineExerciseId: "placement-1",
          position: 1,
          setType: "regular",
          targetType: "reps",
          targetMin: 5,
          targetMax: 5,
          targetDisplay: "5 reps",
          targetRirMin: 1,
          targetRirMax: 1,
          restAfterSec: 120,
          restRule: "standard",
          loadInstruction: "",
          sideMode: "bilateral",
          tempo: null,
          notes: "",
          createdAt: "now",
          updatedAt: "now",
        }],
        createdAt: "now",
        updatedAt: "now",
      },
    ],
    createdAt: "now",
    publishedAt: "now",
    updatedAt: "now",
  };
}

test("covers routine editing set operations and invalid indices", () => {
  const version = routineVersionFixture();
  const draft = editableRoutineFromVersion(version);
  assert.deepEqual(draft.exercises.map((exercise) => exercise.position), [1, 2]);
  assert.deepEqual(draft.exercises[1]!.sets.map((set) => set.position), [1, 2]);
  assert.equal(isRoutineDraftDirty(version, draft), false);
  assert.deepEqual(routineVersionInputFromEditable(draft).exercises.map((exercise) => exercise.position), [1, 2]);

  const exercises = draft.exercises;
  assert.equal(moveRoutineExercise(exercises, -1, 1), exercises);
  assert.equal(moveRoutineExercise(exercises, exercises.length, -1), exercises);
  assert.equal(moveRoutineExercise(exercises, 0, -1), exercises);
  assert.equal(moveRoutineExercise(exercises, exercises.length - 1, 1), exercises);
  assert.equal(removeRoutineExercise(exercises, -1), exercises);
  assert.equal(removeRoutineExercise(exercises, exercises.length), exercises);

  const sets = exercises[1]!.sets;
  assert.deepEqual(moveRoutineSet(sets, 1, -1).map((set) => set.draftId), ["set-2b", "set-2a"]);
  assert.equal(moveRoutineSet(sets, -1, 1), sets);
  assert.equal(moveRoutineSet(sets, sets.length, -1), sets);
  assert.equal(moveRoutineSet(sets, 0, -1), sets);
  assert.equal(moveRoutineSet(sets, sets.length - 1, 1), sets);
  assert.equal(removeRoutineSet(sets, -1), sets);
  assert.equal(removeRoutineSet(sets, sets.length), sets);
  assert.deepEqual(removeRoutineSet(sets, 0).map((set) => set.position), [1]);
  const onlySet = sets.slice(0, 1);
  assert.equal(removeRoutineSet(onlySet, 0), onlySet);

  assert.deepEqual(duplicateRoutineSet([]), []);
  const fallbackDuplicate = duplicateRoutineSet(sets, 99);
  assert.equal(fallbackDuplicate.length, 3);
  assert.equal(fallbackDuplicate.at(-1)?.sourceRoutineSetId, null);
  assert.equal(duplicateRoutineSet(sets).length, 3);
});

test("covers creation defaults for every exercise tracking type", () => {
  const exercise = {
    id: "exercise",
    name: "Carry",
    trackingType: "rounds",
    sideMode: "left_right",
    instructions: "Walk tall",
  } as Exercise;
  const placement = createRoutineExerciseFromLibrary(exercise, 4);
  assert.equal(placement.position, 4);
  assert.ok(placement.sets.every((set) => set.targetRirMin === null));
});

test("normalizes absent routine placement copy at both conversion boundaries", () => {
  const version = routineVersionFixture();
  version.exercises[0]!.instructions = undefined as unknown as string;
  version.exercises[0]!.notes = null as unknown as string;
  const draft = editableRoutineFromVersion(version);
  assert.equal(draft.exercises[1]!.instructions, "");
  assert.equal(draft.exercises[1]!.notes, "");

  draft.exercises[0]!.instructions = undefined as unknown as string;
  draft.exercises[0]!.notes = null as unknown as string;
  const input = routineVersionInputFromEditable(draft);
  assert.equal(input.exercises[0]!.instructions, "");
  assert.equal(input.exercises[0]!.notes, "");
});

test("covers invalid chart geometry and timestamp fallbacks", () => {
  assert.deepEqual(buildLineChartGeometry([], 100, 100), []);
  assert.deepEqual(buildLineChartGeometry([1], 0, 100), []);
  assert.deepEqual(buildLineChartGeometry([1], 100, 0), []);

  const expectedEven = buildLineChartGeometry([1, 2, 3], 100, 100);
  for (const timestamps of [
    [0, 1],
    [0, Number.NaN, 2],
    [0, 2, 1],
    [1, 1, 1],
  ]) {
    assert.deepEqual(buildLineChartGeometry([1, 2, 3], 100, 100, 8, 10, timestamps), expectedEven);
  }
  const collapsedPadding = buildLineChartGeometry([1, 2], 4, 4, 8, 10);
  assert.deepEqual(collapsedPadding.map((point) => point.x), [8, 8]);
});

test("covers previous-performance placeholders for completed partial data", () => {
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    actualWeight: null,
    actualReps: null,
    actualDurationSec: null,
    weightUnit: "kg",
    status: "completed",
  }), "— × —");
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    actualWeight: 12.345,
    actualReps: 3.333,
    actualDurationSec: null,
    weightUnit: "kg",
    status: "completed",
  }), "12.35 kg × 3.33 reps");
});

const comparisonSet: ComparisonSet = {
  loadType: "external",
  targetUnit: "reps",
  weightUnit: "lb",
};

function comparisonPerformance(
  overrides: Partial<ComparisonPerformance> = {},
): ComparisonPerformance {
  return {
    status: "Completed",
    actualWeight: 10,
    actualReps: 5,
    actualDurationSec: null,
    weightUnit: "",
    ...overrides,
  };
}

test("covers set comparison missing loads, units, targets, and invalid live input", () => {
  assert.equal(formatSetComparisonPerformance(
    { ...comparisonSet, loadType: "bodyweight" },
    comparisonPerformance({ actualWeight: null }),
  ), "BW × 5 reps");
  assert.equal(formatSetComparisonPerformance(
    { ...comparisonSet, loadType: "added" },
    comparisonPerformance({ actualWeight: null }),
  ), "BW + — × 5 reps");
  assert.equal(formatSetComparisonPerformance(
    { ...comparisonSet, loadType: "assistance" },
    comparisonPerformance({ actualWeight: null }),
  ), "BW − — × 5 reps");
  assert.equal(formatSetComparisonPerformance(
    comparisonSet,
    comparisonPerformance({ actualWeight: null, actualReps: null }),
  ), "— × —");
  assert.equal(formatSetComparisonPerformance(
    comparisonSet,
    comparisonPerformance({ targetType: "rounds" }),
  ), "10 lb × 5 rounds");

  assert.deepEqual(liveSetComparisonPerformance(
    { ...comparisonSet, targetUnit: "seconds" },
    "-1",
    "30.25",
  ), {
    status: "Completed",
    actualWeight: null,
    actualReps: null,
    actualDurationSec: 30.25,
    weightUnit: "lb",
    targetType: undefined,
  });
  assert.deepEqual(liveSetComparisonPerformance(
    { ...comparisonSet, targetUnit: "rounds" },
    "bad",
    "bad",
  ), {
    status: "Completed",
    actualWeight: null,
    actualReps: null,
    actualDurationSec: null,
    weightUnit: "lb",
    targetType: "rounds",
  });
});

test("covers optional and Unicode set guidance values", () => {
  assert.deepEqual(buildCompactSetDetails({
    primaryValues: [undefined, null, "ＦＡＳＴ！"],
    details: [
      { id: "missing", label: "Missing" },
      { id: "same", label: "Same", value: "fast" },
      { id: "unique", label: "Unique", value: "Smooth" },
    ],
  }), [{ id: "unique", label: "Unique", value: "Smooth" }]);
});

test("covers remaining set-input, stopwatch, and workout-progress boundaries", () => {
  assert.deepEqual(
    getSetInputDefaults({ loadType: "added", targetUnit: "reps" }),
    { weight: "0", result: "" },
  );
  assert.deepEqual(
    getSetInputDefaults({ loadType: "external", targetUnit: "reps" }),
    { weight: "", result: "" },
  );
  assert.deepEqual(
    getSetInputDefaults({ loadType: "external", targetUnit: "seconds" }),
    { weight: "", result: "" },
  );

  assert.equal(getStopwatchElapsedMs(null, -1), 0);
  assert.equal(getStopwatchElapsedMs(2_000, 0, 1_000), 0);
  assert.equal(getStopwatchSeconds(0), 0);
  assert.equal(getStopwatchSeconds(-1), 0);
  assert.equal(formatStopwatch(-100), "00:00.0");

  const guided = (restDisplay: string, globalIndex = 0) => ({
    globalIndex,
    exerciseOrder: 1,
    exerciseName: "Squat",
    restDisplay,
  }) as never;
  assert.deepEqual(buildWorkoutExerciseProgress([], 0), []);
  assert.equal(buildWorkoutExerciseProgress([guided("")], 0)[0]!.restLabel, "No programmed rest");
  assert.equal(buildWorkoutExerciseProgress([guided("None")], 0)[0]!.restLabel, "No programmed rest");
  assert.equal(buildWorkoutExerciseProgress([guided("Start every 2 min")], 0)[0]!.restLabel, "Start every 2 min");
});

function timingSet(overrides: Record<string, unknown>) {
  return {
    id: "set",
    position: 1,
    status: "completed",
    startedAt: null,
    completedAt: null,
    elapsedSeconds: null,
    actualRestSec: null,
    ...overrides,
  };
}

function timingWorkout(overrides: Record<string, unknown> = {}): Workout {
  return {
    startedAt: null,
    completedAt: null,
    exercises: [],
    ...overrides,
  } as unknown as Workout;
}

test("covers invalid, clamped, and fallback workout timing", () => {
  assert.equal(formatElapsedDuration(Number.NaN), "0s");
  assert.equal(formatElapsedDuration(-5), "0s");
  assert.equal(formatElapsedDuration(60), "1m");

  const summary = summarizeWorkoutTiming(timingWorkout({
    exercises: [
      {
        id: "valid-window",
        position: 1,
        exerciseNameSnapshot: "Valid",
        sets: [
          timingSet({
            id: "valid",
            startedAt: "2026-08-08T10:00:00.000Z",
            completedAt: "2026-08-08T10:00:05.000Z",
            elapsedSeconds: Number.NaN,
            actualRestSec: undefined,
          }),
          timingSet({
            id: "backwards",
            position: 2,
            status: "skipped",
            startedAt: "2026-08-08T10:00:10.000Z",
            completedAt: "2026-08-08T10:00:00.000Z",
            elapsedSeconds: -2,
            actualRestSec: -4,
          }),
        ],
      },
      {
        id: "elapsed-sum",
        position: 2,
        exerciseNameSnapshot: "Fallback",
        sets: [
          timingSet({ id: "known", elapsedSeconds: 12.4, startedAt: "invalid", completedAt: "invalid" }),
          timingSet({ id: "unknown", elapsedSeconds: null, startedAt: null, completedAt: null }),
        ],
      },
      {
        id: "empty",
        position: 3,
        exerciseNameSnapshot: "Empty",
        sets: [],
      },
    ],
  }));
  assert.equal(summary.elapsedSeconds, 0);
  assert.equal(summary.exercises[0]!.elapsedSeconds, 5);
  assert.equal(summary.exercises[1]!.elapsedSeconds, 12);
  assert.equal(summary.exercises[2]!.elapsedSeconds, null);
  assert.equal(summary.completedExercises, 2);

  assert.equal(summarizeWorkoutTiming(timingWorkout({
    startedAt: "invalid",
    completedAt: "2026-08-08T10:00:00.000Z",
  })).elapsedSeconds, 0);
  assert.equal(summarizeWorkoutTiming(timingWorkout({
    startedAt: "2026-08-08T10:01:00.000Z",
    completedAt: "2026-08-08T10:00:00.000Z",
  })).elapsedSeconds, 0);
});

test("covers markdown edge syntax without weakening unsafe-link handling", () => {
  assert.equal(isSafeCoachMarkdownLink(""), false);
  const sanitized = sanitizeCoachMarkdown([
    "[angle](<https://example.com/a>)",
    "[bad-angle](<javascript:alert(1))",
    "[empty](   )",
    "[title](https://example.com/path \"guide\")",
    "[odd escape](https://example.com/a\\q)",
    "[hex](javascript&#x3a;alert(1))",
    "[large entity](https://example.com/&#99999999;)",
    "[escaped](https://example.com/a\\(b\\))",
    "[nested](https://example.com/a_(b))",
    "[escaped bracket\\] still label](https://example.com/bracket)",
    "[broken label",
    "[broken](https://example.com",
    "\\![escaped image](https://example.com/image.png)",
    "\\[escaped label](javascript:alert(1))",
    "- [ ] open",
    "1. [x] done",
    "[x] not a task",
    "[x]not a task either",
    "<javascript&#58;alert(1)>",
    "<coach@example.com>",
    "<https://example.com>",
    "abcjavascript:alert(1)",
    "custom+scheme:value",
    "~~~md",
    "![inside](https://example.com/image.png)",
    "~~~~",
    "> ```md",
    "> code",
    "outside quote",
    "![outside](https://example.com/image.png)",
    "`` unmatched",
    "``different run```",
    "`short` and ``different``",
    "[ref]: https://example.com",
  ].join("\n"));

  assert.match(sanitized, /\[angle\]\(<https:\/\/example\.com\/a>\)/u);
  assert.doesNotMatch(sanitized, /javascript&#58;/u);
  assert.match(sanitized, /- \[ \] open/u);
  assert.match(sanitized, /1\. \[x\] done/u);
  assert.match(sanitized, /custom\+scheme\\:value/u);
  assert.match(sanitized, /Image: \[outside\]/u);
  assert.equal(sanitizeCoachMarkdown("```"), "```");
  assert.equal(sanitizeCoachMarkdown("``different run```"), "``different run```");
});
