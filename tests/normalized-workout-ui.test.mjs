import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("active workout renders normalized exercise and set guidance", () => {
  const source = readFileSync(
    new URL("../src/features/workouts/active-workout-screen.tsx", import.meta.url),
    "utf8",
  );

  for (const field of [
    "workoutSet.purpose",
    "workoutSet.exerciseInstructions",
    "workoutSet.exerciseNotes",
    "workoutSet.sideMode",
    "workoutSet.tempo",
    "workoutSet.loadInstruction",
    "workoutSet.notes",
  ]) {
    assert.ok(source.includes(field), `${field} must be considered during an active workout`);
  }
  assert.match(source, /buildCompactSetDetails/);
  assert.match(source, /<CompactSetOverview/);
  assert.doesNotMatch(source, /prescriptionGrid|<Prescription/);
  assert.match(source, /resultUnitName\(currentSet\.targetUnit/);
  assert.match(source, /currentSet\.sourceRoutineExerciseId \?\? `position:/);
});
