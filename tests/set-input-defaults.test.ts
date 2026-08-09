import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdvancedSetInputDefaults,
  getSetInputDefaults,
} from "../src/client/workouts/set-input-defaults";

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

test("does not copy a completed set into the next repetition set", () => {
  assert.deepEqual(
    getAdvancedSetInputDefaults(
      { loadType: "external", targetUnit: "reps" },
      { weight: "22.5", result: "10" },
    ),
    { weight: "", result: "" },
  );
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
