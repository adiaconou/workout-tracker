import assert from "node:assert/strict";
import test from "node:test";
import {
  equipmentIds,
  isExerciseEquipmentAvailable,
  missingExerciseEquipmentLabels,
  parseStoredEquipmentPreferences,
  trainingProfileFromStored,
  validateTrainingProfileInput,
} from "../domain/training-profile";

test("validates and normalizes onboarding training preferences", () => {
  assert.deepEqual(validateTrainingProfileInput({
    equipment: ["bench", "dumbbells", "bench"],
    sessionDurationMin: 45,
  }), {
    equipment: ["dumbbells", "bench"],
    sessionDurationMin: 45,
  });
  assert.throws(
    () => validateTrainingProfileInput({ equipment: [], sessionDurationMin: 45 }),
    /at least one equipment/i,
  );
  assert.throws(
    () => validateTrainingProfileInput({ equipment: ["teleporter"], sessionDurationMin: 45 }),
    /equipment selection is invalid/i,
  );
  assert.throws(
    () => validateTrainingProfileInput({ equipment: ["bodyweight"], sessionDurationMin: 50 }),
    /30, 45, 60, 75, or 90/i,
  );
});

test("preserves legacy users while keeping explicit empty new-user preferences incomplete", () => {
  assert.deepEqual(parseStoredEquipmentPreferences(null), [...equipmentIds]);
  assert.deepEqual(parseStoredEquipmentPreferences("all_equipment"), [...equipmentIds]);
  assert.deepEqual(parseStoredEquipmentPreferences("[]"), []);
  assert.deepEqual(trainingProfileFromStored({
    equipmentPreferencesJson: "[]",
    preferredWorkoutDurationMin: 45,
    onboardingVersion: 0,
    onboardingCompletedAt: null,
  }), {
    equipment: [],
    sessionDurationMin: 45,
    onboardingCompletedAt: null,
    onboardingCompleted: false,
  });
});

test("checks compound equipment requirements and leaves unknown custom equipment visible", () => {
  assert.equal(
    isExerciseEquipmentAvailable("dumbbell_and_bench", ["dumbbells", "bench"]),
    true,
  );
  assert.deepEqual(
    missingExerciseEquipmentLabels("dumbbell_and_bench", ["dumbbells"]),
    ["Bench"],
  );
  assert.equal(
    isExerciseEquipmentAvailable("dumbbell_or_kettlebell", ["kettlebells"]),
    true,
  );
  assert.deepEqual(
    missingExerciseEquipmentLabels("dumbbell_or_kettlebell", []),
    ["Dumbbells or Kettlebells"],
  );
  assert.equal(isExerciseEquipmentAvailable("custom_sled", []), true);
});
