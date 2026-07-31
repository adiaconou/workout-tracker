import assert from "node:assert/strict";
import test from "node:test";
import type { Exercise, Routine } from "../src/api/types";
import {
  createRoutineExerciseFromLibrary,
  moveRoutineExercise,
  removeRoutineExercise,
} from "../src/features/routines/routine-exercise-editing";

function routineExercise(
  exerciseId: string,
  exerciseOrder: number,
): Routine["exercises"][number] {
  return {
    id: `routine-${exerciseId}`,
    exerciseId,
    exerciseOrder,
    name: exerciseId.toUpperCase(),
    warmup: "None",
    warmupSets: 0,
    regularSets: 3,
    failureSets: 0,
    dropSets: 0,
    target: "8-12 reps",
    rest: "90 sec",
    effort: "2 RIR",
    purpose: "",
    loadType: "external",
    weightUnit: "lb",
  };
}

function libraryExercise(
  overrides: Partial<Exercise> = {},
): Exercise {
  return {
    id: "library-exercise",
    ownerEmail: "owner@example.com",
    name: "Cable row",
    normalizedName: "cable row",
    equipment: "cable",
    movementPattern: "horizontal pull",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "Keep the torso still.",
    muscles: [],
    isFavorite: false,
    isActive: true,
    createdAt: "now",
    updatedAt: "now",
    ...overrides,
  };
}

test("moves routine exercises and keeps positions contiguous", () => {
  const original = [
    routineExercise("one", 1),
    routineExercise("two", 2),
    routineExercise("three", 3),
  ];

  const reordered = moveRoutineExercise(original, 1, -1);

  assert.deepEqual(
    reordered.map((exercise) => exercise.exerciseId),
    ["two", "one", "three"],
  );
  assert.deepEqual(
    reordered.map((exercise) => exercise.exerciseOrder),
    [1, 2, 3],
  );
  assert.deepEqual(
    original.map((exercise) => exercise.exerciseId),
    ["one", "two", "three"],
  );
});

test("removes a routine exercise but preserves the required final exercise", () => {
  const exercises = [
    routineExercise("one", 1),
    routineExercise("two", 2),
    routineExercise("three", 3),
  ];

  const remaining = removeRoutineExercise(exercises, 1);
  assert.deepEqual(
    remaining.map((exercise) => [
      exercise.exerciseId,
      exercise.exerciseOrder,
    ]),
    [["one", 1], ["three", 2]],
  );
  assert.equal(removeRoutineExercise([remaining[0]], 0).length, 1);
});

test("adds a library exercise with an editable starter prescription", () => {
  const exercise = createRoutineExerciseFromLibrary(
    libraryExercise(),
    4,
  );

  assert.equal(exercise.exerciseId, "library-exercise");
  assert.equal(exercise.exerciseOrder, 4);
  assert.equal(exercise.regularSets, 3);
  assert.equal(exercise.target, "8-12 reps");
  assert.equal(exercise.effort, "2 RIR");
});

test("uses duration defaults for timed library exercises", () => {
  const exercise = createRoutineExerciseFromLibrary(
    libraryExercise({
      id: "plank",
      name: "Plank",
      trackingType: "duration",
      defaultLoadType: "bodyweight",
      instructions: "",
    }),
    1,
  );

  assert.equal(exercise.target, "30 sec");
  assert.equal(exercise.effort, "Controlled");
  assert.equal(exercise.loadType, "bodyweight");
});
