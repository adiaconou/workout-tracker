import assert from "node:assert/strict";
import test from "node:test";
import { getSetInputDefaults } from "../src/features/workouts/set-input-defaults";

test("starts new external-load exercises with empty inputs", () => {
  assert.deepEqual(
    getSetInputDefaults({ loadType: "external", targetUnit: "reps" }),
    { weight: "", result: "" },
  );
});

test("starts bodyweight exercises at zero weight", () => {
  assert.deepEqual(
    getSetInputDefaults({ loadType: "bodyweight", targetUnit: "reps" }),
    { weight: "0", result: "" },
  );
});

test("copies the previous completed weight and reps", () => {
  assert.deepEqual(
    getSetInputDefaults(
      { loadType: "external", targetUnit: "reps" },
      { actualWeight: 22.5, actualReps: 10 },
    ),
    { weight: "22.5", result: "10" },
  );
});

test("copies weight but leaves duration results empty", () => {
  assert.deepEqual(
    getSetInputDefaults(
      { loadType: "external", targetUnit: "seconds" },
      { actualWeight: 35, actualReps: null },
    ),
    { weight: "35", result: "" },
  );
});

test("copies the previous completed round count", () => {
  assert.deepEqual(
    getSetInputDefaults(
      { loadType: "bodyweight", targetUnit: "rounds" },
      { actualWeight: 0, actualReps: 7 },
    ),
    { weight: "0", result: "7" },
  );
});
