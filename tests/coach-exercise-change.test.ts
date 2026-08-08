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
  assert.match(diff.join("\n"), /Add "Farmer Carry"/);
  assert.match(diff.join("\n"), /Tracking: duration/);
  assert.match(diff.join("\n"), /Instructions: "Walk tall\."/);
  assert.match(diff.join("\n"), /grip \(primary, 1\)/);
});

test("treats reordered muscle metadata as unchanged", () => {
  const current = exercise();
  const proposed = {
    ...exerciseInputSnapshot(current),
    muscles: [...current.muscles].reverse(),
  };

  assert.deepEqual(buildExerciseChangeDiff("update", current, proposed), []);
});

test("describes exact exercise field and muscle updates", () => {
  const current = exercise();
  const proposed = {
    ...exerciseInputSnapshot(current),
    name: "Paused Barbell Bench Press",
    instructions: "Pause for two seconds.",
    muscles: [{ muscleGroup: "chest" as const, role: "primary" as const, weight: 0.9 }],
  };

  const diff = buildExerciseChangeDiff("update", current, proposed);
  assert.deepEqual(diff.slice(0, 2), [
    "Name: Barbell Bench Press -> Paused Barbell Bench Press",
    'Instructions: "Pause briefly on the chest." -> "Pause for two seconds."',
  ]);
  assert.match(diff[2] ?? "", /Muscles:/);
});

test("archive plans preserve routine versions and workout history", () => {
  assert.deepEqual(buildExerciseChangeDiff("archive", exercise(), null), [
    'Archive "Barbell Bench Press" from the exercise library.',
    "Existing routine versions and workout history remain unchanged.",
  ]);
});
