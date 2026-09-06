import assert from "node:assert/strict";
import test from "node:test";
import {
  createExerciseWeightSettingsDraft,
  parseExerciseWeightSettingsDraft,
  preferredExerciseWeightUnit,
} from "../src/client/exercises/exercise-weight-settings";

test("chooses profile units and preserves the stored settings unit", () => {
  assert.equal(preferredExerciseWeightUnit("metric"), "kg");
  assert.equal(preferredExerciseWeightUnit("imperial"), "lb");
  assert.equal(preferredExerciseWeightUnit(null), "lb");
  assert.deepEqual(createExerciseWeightSettingsDraft(null, "kg"), {
    unit: "kg",
    minimumIncrement: "",
    maximumAvailable: "",
  });
  assert.deepEqual(createExerciseWeightSettingsDraft({
    unit: "lb",
    minimumIncrement: 2.5,
    maximumAvailable: null,
  }, "kg"), {
    unit: "lb",
    minimumIncrement: "2.5",
    maximumAvailable: "",
  });
  assert.deepEqual(createExerciseWeightSettingsDraft({
    unit: "kg",
    minimumIncrement: null,
    maximumAvailable: 40,
  }, "lb"), {
    unit: "kg",
    minimumIncrement: "",
    maximumAvailable: "40",
  });
});

test("parses blank, partial, and complete loading settings", () => {
  assert.deepEqual(parseExerciseWeightSettingsDraft({
    unit: "lb",
    minimumIncrement: " ",
    maximumAvailable: "",
  }), { value: null, errors: {} });
  assert.deepEqual(parseExerciseWeightSettingsDraft({
    unit: "kg",
    minimumIncrement: ".5",
    maximumAvailable: "",
  }), {
    value: { unit: "kg", minimumIncrement: 0.5, maximumAvailable: null },
    errors: {},
  });
  assert.deepEqual(parseExerciseWeightSettingsDraft({
    unit: "kg",
    minimumIncrement: "",
    maximumAvailable: "40",
  }), {
    value: { unit: "kg", minimumIncrement: null, maximumAvailable: 40 },
    errors: {},
  });
  assert.deepEqual(parseExerciseWeightSettingsDraft({
    unit: "lb",
    minimumIncrement: "2.5",
    maximumAvailable: "50",
  }), {
    value: { unit: "lb", minimumIncrement: 2.5, maximumAvailable: 50 },
    errors: {},
  });
});

test("reports invalid numbers, precision, and inconsistent maximums per field", () => {
  assert.deepEqual(parseExerciseWeightSettingsDraft({
    unit: "lb",
    minimumIncrement: "nope",
    maximumAvailable: "0",
  }), {
    value: null,
    errors: {
      minimumIncrement: "Enter a positive number or leave this blank.",
      maximumAvailable: "Enter a positive number or leave this blank.",
    },
  });
  assert.deepEqual(parseExerciseWeightSettingsDraft({
    unit: "lb",
    minimumIncrement: "1.125",
    maximumAvailable: "50",
  }).errors, { minimumIncrement: "Use at most two decimal places." });
  assert.deepEqual(parseExerciseWeightSettingsDraft({
    unit: "lb",
    minimumIncrement: "5",
    maximumAvailable: "2.5",
  }).errors, { maximumAvailable: "Maximum must be at least the minimum increment." });
  assert.deepEqual(parseExerciseWeightSettingsDraft({
    unit: "lb",
    minimumIncrement: "9".repeat(400),
    maximumAvailable: "",
  }).errors, { minimumIncrement: "Enter a positive number or leave this blank." });
});
