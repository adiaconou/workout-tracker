import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExerciseCreationInput,
  createExerciseCreationForm,
  exerciseEquipmentOptions,
  exerciseCreationMuscleError,
  exerciseCreationNameError,
  withPrimaryMuscle,
  withToggledSecondaryMuscle,
  type ExerciseCreationForm,
} from "../src/client/exercises/exercise-creation-model";

test("starts with practical tracking defaults and requires a name", () => {
  const form = createExerciseCreationForm();

  assert.deepEqual(form, {
    name: "",
    equipment: "other",
    movementPattern: "",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "",
    primaryMuscle: "",
    secondaryMuscles: [],
  });
  assert.equal(exerciseCreationNameError(form), "Exercise name is required.");
  assert.equal(exerciseCreationMuscleError(form), "Select a primary muscle.");
  assert.throws(
    () => buildExerciseCreationInput({ ...form, name: "   " }),
    /Exercise name is required/,
  );
  assert.equal(
    exerciseCreationNameError({ ...form, name: "Cable row" }),
    "",
  );
  assert.equal(
    exerciseCreationMuscleError({ ...form, primaryMuscle: "back" }),
    "",
  );
  assert.throws(
    () => buildExerciseCreationInput({ ...form, name: "Cable row" }),
    /Select a primary muscle/,
  );
});

test("keeps primary and secondary muscle selections mutually exclusive", () => {
  const form: ExerciseCreationForm = {
    ...createExerciseCreationForm(),
    name: "Row",
    secondaryMuscles: ["back", "biceps"],
  };
  const primary = withPrimaryMuscle(form, "back");
  assert.equal(primary.primaryMuscle, "back");
  assert.deepEqual(primary.secondaryMuscles, ["biceps"]);

  assert.equal(withToggledSecondaryMuscle(primary, "back"), primary);
  const added = withToggledSecondaryMuscle(primary, "grip");
  assert.deepEqual(added.secondaryMuscles, ["biceps", "grip"]);
  const removed = withToggledSecondaryMuscle(added, "biceps");
  assert.deepEqual(removed.secondaryMuscles, ["grip"]);

  const untagged = withPrimaryMuscle(removed, "");
  assert.equal(untagged.primaryMuscle, "");
  assert.equal(untagged.secondaryMuscles, removed.secondaryMuscles);
});

test("builds the owner-agnostic exercise POST payload and normalizes text", () => {
  const input = buildExerciseCreationInput({
    ...createExerciseCreationForm(),
    name: "  Single-arm cable row  ",
    equipment: "cable_machine",
    movementPattern: "  horizontal pull  ",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "per_side",
    instructions: "  Keep the ribs down.  ",
    primaryMuscle: "back",
    secondaryMuscles: ["biceps", "grip"],
  });

  assert.deepEqual(input, {
    name: "Single-arm cable row",
    equipment: "cable_machine",
    movementPattern: "horizontal pull",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "per_side",
    instructions: "Keep the ribs down.",
    muscles: [
      { muscleGroup: "back", role: "primary", weight: 1 },
      { muscleGroup: "biceps", role: "secondary", weight: 0.5 },
      { muscleGroup: "grip", role: "secondary", weight: 0.5 },
    ],
  });

  assert.deepEqual(
    buildExerciseCreationInput({
      ...createExerciseCreationForm(),
      name: "Untyped carry",
      primaryMuscle: "grip",
    }),
    {
      name: "Untyped carry",
      equipment: "other",
      movementPattern: "other",
      trackingType: "reps",
      defaultLoadType: "external",
      sideMode: "bilateral",
      instructions: "",
      muscles: [{ muscleGroup: "grip", role: "primary", weight: 1 }],
    },
  );
});

test("offers only equipment requirements understood by availability checks", () => {
  assert.deepEqual(
    exerciseEquipmentOptions.map(([value]) => value),
    [
      "other",
      "bodyweight",
      "bench",
      "bench_and_bodyweight",
      "dumbbells",
      "dumbbell_and_bench",
      "dumbbell_or_kettlebell",
      "kettlebells",
      "pull_up_station",
      "dip_station",
      "cable_machine",
      "ez_bar",
      "ez_bar_and_bench",
      "resistance_bands",
      "barbell",
    ],
  );
});
