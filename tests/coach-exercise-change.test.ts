import assert from "node:assert/strict";
import test from "node:test";
import type { Exercise } from "../src/domain/entities";
import {
  buildExerciseChangeDiff,
  completeExerciseInput,
  exerciseInputSnapshot,
} from "../src/server/coach/exercise-change";

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "exercise-1",
    ownerEmail: "owner@example.com",
    name: "Barbell Bench Press",
    normalizedName: "barbell bench press",
    equipment: "barbell",
    movementPattern: "push",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "Pause briefly on the chest.",
    muscles: [
      { muscleGroup: "chest", role: "primary", weight: 1 },
      { muscleGroup: "triceps", role: "secondary", weight: 0.5 },
    ],
    isFavorite: false,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizes a complete Coach exercise proposal with safe defaults", () => {
  const proposed = completeExerciseInput({
    name: "  Farmer Carry  ",
    muscles: [{ muscleGroup: "grip", role: "primary", weight: 1 }],
  });

  assert.deepEqual(proposed, {
    name: "Farmer Carry",
    equipment: "other",
    movementPattern: "other",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "",
    muscles: [{ muscleGroup: "grip", role: "primary", weight: 1 }],
  });
});

test("builds a concrete create plan", () => {
  const proposed = completeExerciseInput({
    name: "Farmer Carry",
    equipment: "dumbbell",
    movementPattern: "carry",
    trackingType: "duration",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "Walk tall.",
    muscles: [{ muscleGroup: "grip", role: "primary", weight: 1 }],
  });

  const diff = buildExerciseChangeDiff("create", null, proposed);
  assert.deepEqual(diff, [
    "Add Farmer Carry to the exercise library.",
    "Equipment: Dumbbell; Movement: Carry.",
    "Tracking: Duration; Loading: External weight; Side mode: Bilateral.",
    "Instructions: Walk tall.",
    "Muscles: Grip (Primary, weight 1).",
  ]);
  assert.doesNotMatch(diff.join("\n"), /[{}]|\b\w+=|\b(?:left_right|per_side|per_leg)\b|->|"/i);
});

test("describes empty instructions and muscles without serialized values", () => {
  const proposed = completeExerciseInput({ name: "Plank" });
  const text = buildExerciseChangeDiff("create", null, proposed).join("\n");

  assert.match(text, /Equipment: Other; Movement: Other/i);
  assert.match(text, /Instructions: None/i);
  assert.match(text, /Muscles: None specified/i);
  assert.doesNotMatch(text, /""|null|undefined/i);
});

test("treats reordered muscle metadata as unchanged", () => {
  const current = exercise();
  const proposed = {
    ...exerciseInputSnapshot(current),
    muscles: [...current.muscles].reverse(),
  };

  assert.deepEqual(buildExerciseChangeDiff("update", current, proposed), []);
});

test("describes every exercise field update with readable before and after values", () => {
  const current = exercise();
  const proposed = {
    ...exerciseInputSnapshot(current),
    name: "Paused Barbell Bench Press",
    equipment: "bench_and_bodyweight",
    movementPattern: "hip_hinge",
    trackingType: "duration" as const,
    defaultLoadType: "bodyweight" as const,
    sideMode: "left_right" as const,
    instructions: "Pause for two seconds.",
    muscles: [{ muscleGroup: "glutes" as const, role: "primary" as const, weight: 0.9 }],
  };

  const diff = buildExerciseChangeDiff("update", current, proposed);
  assert.deepEqual(diff, [
    "Name: Barbell Bench Press → Paused Barbell Bench Press.",
    "Equipment: Barbell → Bench and bodyweight.",
    "Movement: Push → Hip hinge.",
    "Tracking: Reps → Duration.",
    "Loading: External weight → Bodyweight.",
    "Side mode: Bilateral → Left / right.",
    "Instructions: Pause briefly on the chest. → Pause for two seconds.",
    "Muscles: Chest (Primary, weight 1), Triceps (Secondary, weight 0.5) → Glutes (Primary, weight 0.9).",
  ]);
  assert.doesNotMatch(diff.join("\n"), /bench_and_bodyweight|hip_hinge|left_right|->|"/i);
});

test("archive plans preserve routine versions and workout history", () => {
  assert.deepEqual(buildExerciseChangeDiff("archive", exercise(), null), [
    "Archive Barbell Bench Press from the exercise library.",
    "Existing routine versions and workout history remain unchanged.",
  ]);
});

test("rejects incomplete exercise proposals and missing update targets", () => {
  for (const invalid of [null, [], "exercise"]) {
    assert.throws(() => completeExerciseInput(invalid), /complete proposed exercise/i);
  }
  assert.throws(() => buildExerciseChangeDiff("create", null, null), /complete definition/i);
  assert.throws(() => buildExerciseChangeDiff("update", null, null), /could not be found/i);
  assert.throws(() => buildExerciseChangeDiff("update", exercise(), null), /complete definition/i);
});
