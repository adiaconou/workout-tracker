import assert from "node:assert/strict";
import test from "node:test";
import {
  alignPreviousExerciseSets,
  buildExerciseSetOverviewRows,
  comparisonLoadPhrase,
  comparisonLoadHeading,
  comparisonResultHeading,
  formatComparisonTableCells,
  formatComparisonTargetCells,
  formatSetComparisonPerformance,
  liveSetComparisonPerformance,
  type ComparisonPerformance,
  type ComparisonSet,
  type ExerciseSetOverviewSet,
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

function overviewSet(
  id: string,
  globalIndex: number,
  overrides: Partial<ExerciseSetOverviewSet> = {},
): ExerciseSetOverviewSet {
  return {
    id,
    globalIndex,
    sourceRoutineSetId: id,
    setType: "regular",
    targetType: "reps",
    loadType: "external",
    targetUnit: "reps",
    weightUnit: "lb",
    target: "8 reps",
    targetMin: 8,
    targetMax: 8,
    targetRirMin: null,
    targetRirMax: null,
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

test("formats consistent comparison-table headings and split values", () => {
  assert.equal(comparisonLoadHeading("assistance"), "Assistance");
  assert.equal(comparisonLoadHeading("added"), "Added weight");
  assert.equal(comparisonLoadHeading("external"), "Weight");
  assert.equal(comparisonLoadHeading("bodyweight"), "Load");
  assert.equal(comparisonResultHeading("reps"), "Reps");
  assert.equal(comparisonResultHeading("seconds"), "Seconds");
  assert.equal(comparisonResultHeading("rounds"), "Rounds");
  assert.equal(comparisonLoadPhrase("assistance", "0 lb"), "0 lb assistance");
  assert.equal(comparisonLoadPhrase("added", "25 lb"), "25 lb added weight");
  assert.equal(comparisonLoadPhrase("external", "135 lb"), "135 lb");
  assert.equal(comparisonLoadPhrase("bodyweight", "BW + 15 lb"), "BW + 15 lb");
  assert.equal(comparisonLoadPhrase("assistance", "—"), "—");

  assert.deepEqual(formatComparisonTableCells(repsSet, performance()), {
    load: "135 lb",
    result: "8",
    rir: "—",
  });
  assert.deepEqual(formatComparisonTableCells(
    { ...repsSet, loadType: "assistance" },
    performance({ actualWeight: 0, actualReps: 6 }),
  ), { load: "0 lb", result: "6", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    { ...repsSet, loadType: "added" },
    performance({ actualWeight: 25 }),
  ), { load: "25 lb", result: "8", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    { ...repsSet, loadType: "bodyweight" },
    performance({ actualWeight: 0 }),
  ), { load: "BW", result: "8", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    { ...repsSet, loadType: "bodyweight" },
    performance({ actualWeight: 15 }),
  ), { load: "BW + 15 lb", result: "8", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    { ...repsSet, targetUnit: "seconds" },
    performance({ actualReps: null, actualDurationSec: 30 }),
  ), { load: "135 lb", result: "30", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    { ...repsSet, targetUnit: "rounds" },
    performance({ actualReps: 4, targetType: "rounds" }),
  ), { load: "135 lb", result: "4", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    repsSet,
    performance({ actualWeight: 22.5, weightUnit: "" }),
  ), { load: "22.5 lb", result: "8", rir: "—" });
});

test("formats comparison-table missing, skipped, and historical semantics", () => {
  assert.deepEqual(formatComparisonTableCells(repsSet, undefined), {
    load: "—",
    result: "—",
    rir: "—",
  });
  assert.deepEqual(formatComparisonTableCells(
    repsSet,
    performance({ status: "Skipped", actualWeight: null, actualReps: null }),
  ), { load: "—", result: "Skipped", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    { ...repsSet, loadType: "bodyweight" },
    performance({ actualWeight: 90, loadType: "external" }),
  ), { load: "90 lb", result: "8", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    { ...repsSet, loadType: "bodyweight" },
    performance({ actualWeight: null }),
  ), { load: "BW", result: "8", rir: "—" });
  assert.deepEqual(formatComparisonTableCells(
    repsSet,
    performance({ actualWeight: null, actualReps: null }),
  ), { load: "—", result: "—", rir: "—" });
});

test("formats target ranges and RIR without repeating table units", () => {
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "6-8 reps",
    targetMin: 6,
    targetMax: 8,
    targetRirMin: 2,
    targetRirMax: 2,
  }), { load: "—", result: "6–8", rir: "2" });
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "10 reps",
    targetMin: 10,
    targetMax: null,
    targetRirMin: null,
    targetRirMax: 3,
  }), { load: "—", result: "10", rir: "3" });
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "30 seconds",
    targetMin: null,
    targetMax: 30,
    targetRirMin: 1,
    targetRirMax: null,
  }), { load: "—", result: "30", rir: "1" });
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "AMRAP reps",
    effort: "RIR: 1 - 2",
  }), { load: "—", result: "AMRAP", rir: "1–2" });
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "8 reps",
    effort: "2 RIR",
  }), { load: "—", result: "8", rir: "2" });
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "8 reps",
    effort: "RIR ≈2",
  }), { load: "—", result: "8", rir: "2" });
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "Hold",
    effort: "Controlled",
  }), { load: "—", result: "Hold", rir: "—" });
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "",
  }), { load: "—", result: "—", rir: "—" });
  assert.deepEqual(formatComparisonTargetCells({
    ...repsSet,
    target: "8 reps",
    targetMin: 8,
    targetMax: 10,
    targetRirMin: 1,
    targetRirMax: 3,
  }), { load: "—", result: "8–10", rir: "1–3" });
});

test("builds a full exercise overview with current, upcoming, and last-time values", () => {
  const sets = [
    overviewSet("done", 0),
    overviewSet("skipped", 1),
    overviewSet("not-logged", 2),
    overviewSet("current", 3),
    overviewSet("upcoming", 4, {
      target: "10 reps",
      targetMin: 10,
      targetMax: 10,
      targetRirMin: 2,
      targetRirMax: 2,
    }),
    overviewSet("blank-target", 5, {
      target: "",
      targetMin: null,
      targetMax: null,
    }),
    overviewSet("bad-recommendation", 6),
  ];
  const rows = buildExerciseSetOverviewRows({
    sets,
    previousSets: [
      previousSet({
        sourceRoutineSetId: "current",
        targetType: "duration",
        loadType: "bodyweight",
        actualWeight: 0,
        actualReps: 0,
        actualDurationSec: 30,
      }),
      previousSet({ sourceRoutineSetId: "done", actualWeight: 125, actualReps: 7 }),
      previousSet({
        sourceRoutineSetId: "skipped",
        status: "skipped",
        actualWeight: null,
        actualReps: null,
      }),
      previousSet({
        sourceRoutineSetId: "upcoming",
        actualWeight: 50,
        actualReps: 9,
        weightUnit: "",
      }),
    ],
    recordedPerformanceBySetId: {
      done: performance(),
      skipped: performance({
        status: "Skipped",
        actualWeight: null,
        actualReps: null,
      }),
    },
    recommendedPerformanceBySetId: {
      current: performance({ actualWeight: 140, actualReps: 9 }),
      "bad-recommendation": performance({
        status: "Skipped",
        actualWeight: null,
        actualReps: null,
      }),
    },
    selectedSetId: "done",
    activeSetIndex: 3,
  });

  assert.deepEqual(rows.map((row) => ({
    id: row.id,
    status: row.status,
    selected: row.selected,
    current: row.current,
    thisWorkout: row.thisWorkout,
    lastTime: row.lastTime,
  })), [
    {
      id: "done",
      status: "Completed",
      selected: true,
      current: false,
      thisWorkout: "135 lb × 8 reps",
      lastTime: "125 lb × 7 reps",
    },
    {
      id: "skipped",
      status: "Skipped",
      selected: false,
      current: false,
      thisWorkout: "Skipped",
      lastTime: "Skipped",
    },
    {
      id: "not-logged",
      status: "Not logged",
      selected: false,
      current: false,
      thisWorkout: "Not logged",
      lastTime: "—",
    },
    {
      id: "current",
      status: "Current",
      selected: false,
      current: true,
      thisWorkout: "Target 140 lb × 9 reps",
      lastTime: "BW × 30 sec",
    },
    {
      id: "upcoming",
      status: "Upcoming",
      selected: false,
      current: false,
      thisWorkout: "Target 10 reps · RIR 2",
      lastTime: "50 lb × 9 reps",
    },
    {
      id: "blank-target",
      status: "Upcoming",
      selected: false,
      current: false,
      thisWorkout: "Target —",
      lastTime: "—",
    },
    {
      id: "bad-recommendation",
      status: "Upcoming",
      selected: false,
      current: false,
      thisWorkout: "Target —",
      lastTime: "—",
    },
  ]);
  assert.equal(rows[0].number, 1);
  assert.equal(rows[0].setType, "regular");
});
