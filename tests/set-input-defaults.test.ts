import assert from "node:assert/strict";
import test from "node:test";
import {
  getReadySetInputDefaults,
  getRecordedSetInputValues,
  getSetInputDefaults,
} from "../src/client/workouts/set-input-defaults";

test("leaves a nonnumeric AMRAP result empty for external-load exercises", () => {
  assert.deepEqual(
    getSetInputDefaults({ loadType: "external", targetUnit: "reps", target: "AMRAP" }),
    { weight: "", result: "" },
  );
});

test("starts bodyweight exercises at zero weight with a nonnumeric AMRAP result", () => {
  assert.deepEqual(
    getSetInputDefaults({ loadType: "bodyweight", targetUnit: "reps", target: "AMRAP" }),
    { weight: "0", result: "" },
  );
});

test("uses the upper structured target for a ready set", () => {
  assert.deepEqual(
    getSetInputDefaults({
      loadType: "external",
      targetUnit: "reps",
      targetMin: 8,
      targetMax: 10,
    }),
    { weight: "", result: "10" },
  );
  assert.deepEqual(
    getSetInputDefaults({
      loadType: "external",
      targetUnit: "reps",
      targetMin: 8,
      targetMax: null,
    }),
    { weight: "", result: "8" },
  );
  assert.deepEqual(
    getSetInputDefaults({
      loadType: "external",
      targetUnit: "reps",
      targetMin: 0,
      targetMax: Number.NaN,
    }),
    { weight: "", result: "0" },
  );
  assert.deepEqual(
    getSetInputDefaults({
      loadType: "external",
      targetUnit: "reps",
      targetMin: null,
      targetMax: -1,
    }),
    { weight: "", result: "" },
  );
  assert.deepEqual(
    getSetInputDefaults({
      loadType: "bodyweight",
      targetUnit: "reps",
      target: "1×6 scapular",
      targetMin: 1,
      targetMax: 1,
    }),
    { weight: "0", result: "6" },
  );
  assert.deepEqual(
    getSetInputDefaults({
      loadType: "external",
      targetUnit: "reps",
      target: "8-12 reps",
    }),
    { weight: "", result: "12" },
  );
});

test("copies the latest completed values for the same routine exercise", () => {
  const sets = [
    {
      id: "a-1",
      exerciseOrder: 1,
      loadType: "external",
      targetUnit: "reps" as const,
      targetMin: 8,
      targetMax: 10,
    },
    {
      id: "a-2",
      exerciseOrder: 1,
      loadType: "external",
      targetUnit: "reps" as const,
      targetMin: 8,
      targetMax: 10,
    },
    {
      id: "a-3",
      exerciseOrder: 1,
      loadType: "external",
      targetUnit: "reps" as const,
      targetMin: 8,
      targetMax: 10,
    },
  ];
  assert.deepEqual(getReadySetInputDefaults(sets, 2, {
    "a-1": {
      status: "Completed",
      actualWeight: 22.5,
      actualReps: 9,
      actualDurationSec: null,
    },
    "a-2": {
      status: "Completed",
      actualWeight: 25,
      actualReps: 8,
      actualDurationSec: null,
    },
  }), { weight: "25", result: "8" });
});

test("keeps interleaved exercise-placement defaults exercise-specific", () => {
  const sets = [
    {
      id: "a-1",
      exerciseOrder: 1,
      loadType: "external",
      targetUnit: "reps" as const,
      targetMin: 8,
      targetMax: 10,
    },
    {
      id: "b-1",
      exerciseOrder: 2,
      loadType: "external",
      targetUnit: "reps" as const,
      targetMin: 12,
      targetMax: 12,
    },
    {
      id: "a-2",
      exerciseOrder: 1,
      loadType: "external",
      targetUnit: "reps" as const,
      targetMin: 8,
      targetMax: 10,
    },
  ];
  const performance = {
    "a-1": {
      status: "Completed" as const,
      actualWeight: 80,
      actualReps: 9,
      actualDurationSec: null,
    },
    "b-1": {
      status: "Completed" as const,
      actualWeight: 20,
      actualReps: 12,
      actualDurationSec: null,
    },
  };

  assert.deepEqual(
    getReadySetInputDefaults(sets, 1, performance),
    { weight: "", result: "12" },
    "the first B set uses B's target rather than A's completed values",
  );
  assert.deepEqual(
    getReadySetInputDefaults(sets, 2, performance),
    { weight: "80", result: "9" },
    "the second A set uses A1 rather than the immediately preceding B1",
  );
});

test("supports duration, rounds, zero values, and unit changes", () => {
  const durationSets = [
    {
      id: "hold-1",
      exerciseOrder: 1,
      loadType: "bodyweight",
      targetUnit: "seconds" as const,
      targetMin: 30,
      targetMax: 45,
    },
    {
      id: "hold-2",
      exerciseOrder: 1,
      loadType: "bodyweight",
      targetUnit: "seconds" as const,
      targetMin: 30,
      targetMax: 45,
    },
  ];
  assert.deepEqual(getReadySetInputDefaults(durationSets, 0, {}), {
    weight: "0",
    result: "45",
  });
  assert.deepEqual(getReadySetInputDefaults(durationSets, 1, {
    "hold-1": {
      status: "Completed",
      actualWeight: 0,
      actualReps: null,
      actualDurationSec: 40,
    },
  }), { weight: "0", result: "40" });

  const roundSets = durationSets.map((set, index) => ({
    ...set,
    id: `round-${index + 1}`,
    targetUnit: "rounds" as const,
    targetMin: 3,
    targetMax: 4,
  }));
  assert.deepEqual(getReadySetInputDefaults(roundSets, 0, {}), {
    weight: "0",
    result: "4",
  });
  assert.deepEqual(getReadySetInputDefaults(roundSets, 1, {
    "round-1": {
      status: "Completed",
      actualWeight: 0,
      actualReps: 0,
      actualDurationSec: null,
    },
  }), { weight: "0", result: "0" });

  assert.deepEqual(getReadySetInputDefaults([
    {
      id: "mixed-1",
      exerciseOrder: 1,
      loadType: "external",
      targetUnit: "reps",
      targetMin: 8,
      targetMax: 10,
    },
    {
      id: "mixed-2",
      exerciseOrder: 1,
      loadType: "external",
      targetUnit: "seconds",
      targetMin: 30,
      targetMax: 45,
    },
  ], 1, {
    "mixed-1": {
      status: "Completed",
      actualWeight: 25,
      actualReps: 9,
      actualDurationSec: null,
    },
  }), { weight: "25", result: "45" });
});

test("ignores skipped sets and falls back when completed values are absent", () => {
  const sets = [
    {
      id: "a-1",
      exerciseOrder: 1,
      loadType: "bodyweight",
      targetUnit: "reps" as const,
      targetMin: 8,
      targetMax: 10,
    },
    {
      id: "a-2",
      exerciseOrder: 1,
      loadType: "bodyweight",
      targetUnit: "reps" as const,
      targetMin: 8,
      targetMax: 10,
    },
    {
      id: "a-3",
      exerciseOrder: 1,
      loadType: "bodyweight",
      targetUnit: "reps" as const,
      targetMin: 8,
      targetMax: 10,
    },
  ];
  assert.deepEqual(getReadySetInputDefaults(sets, 2, {
    "a-1": {
      status: "Completed",
      actualWeight: 0,
      actualReps: 9,
      actualDurationSec: null,
    },
    "a-2": {
      status: "Skipped",
      actualWeight: null,
      actualReps: null,
      actualDurationSec: null,
    },
  }), { weight: "0", result: "9" });
  assert.deepEqual(getReadySetInputDefaults(sets, 1, {
    "a-1": {
      status: "Completed",
      actualWeight: null,
      actualReps: null,
      actualDurationSec: null,
    },
  }), { weight: "0", result: "10" });
  assert.deepEqual(getReadySetInputDefaults(sets, 1, {}), {
    weight: "0",
    result: "10",
  });
  assert.deepEqual(getReadySetInputDefaults(sets, 99, {}), {
    weight: "",
    result: "",
  });
});

test("starts timed external-load sets empty", () => {
  assert.deepEqual(
    getSetInputDefaults({ loadType: "external", targetUnit: "seconds" }),
    { weight: "", result: "" },
  );
});

test("keeps only the intrinsic bodyweight load for a new round set", () => {
  assert.deepEqual(
    getSetInputDefaults({ loadType: "bodyweight", targetUnit: "rounds" }),
    { weight: "0", result: "" },
  );
});

test("prefills logged repetition and round results without losing zero values", () => {
  const performance = {
    status: "Completed" as const,
    actualWeight: 0,
    actualReps: 4,
    actualDurationSec: null,
  };
  assert.deepEqual(
    getRecordedSetInputValues({ targetUnit: "reps" }, performance),
    { weight: "0", result: "4" },
  );
  assert.deepEqual(
    getRecordedSetInputValues({ targetUnit: "rounds" }, performance),
    { weight: "0", result: "4" },
  );
});

test("prefills logged durations and leaves skipped results empty", () => {
  assert.deepEqual(
    getRecordedSetInputValues({ targetUnit: "seconds" }, {
      status: "Completed",
      actualWeight: 25,
      actualReps: null,
      actualDurationSec: 45,
    }),
    { weight: "25", result: "45" },
  );
  assert.deepEqual(
    getRecordedSetInputValues({ targetUnit: "seconds" }, {
      status: "Skipped",
      actualWeight: null,
      actualReps: null,
      actualDurationSec: null,
    }),
    { weight: "", result: "" },
  );
  assert.deepEqual(
    getRecordedSetInputValues({ targetUnit: "reps" }, {
      status: "Completed",
      actualWeight: null,
      actualReps: null,
      actualDurationSec: null,
    }),
    { weight: "", result: "" },
  );
});
