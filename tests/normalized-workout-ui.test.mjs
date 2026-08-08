import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("active workout renders one compact set card without coaching detail", () => {
  const source = readFileSync(
    new URL("../src/features/workouts/active-workout-screen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<CompactSetOverview/);
  assert.match(source, /<ActiveExerciseProgressChart/);
  assert.match(source, /<ActiveSetComparison/);
  assert.match(source, /recordedPerformanceBySetId/);
  assert.match(source, /title="Skip Rest"/);
  assert.doesNotMatch(source, /buildCompactSetDetails/);
  assert.doesNotMatch(source, /workoutSet\.(?:purpose|exerciseInstructions|exerciseNotes|tempo|loadInstruction|notes)/);
  assert.doesNotMatch(source, /prescriptionGrid|<Prescription/);
  assert.match(source, /resultUnitName\(currentSet\.targetUnit/);
  assert.match(source, /currentSet\.sourceRoutineExerciseId \?\? `position:/);
});

test("active workout progress keeps the six-month empty state and estimated-point disclosure", () => {
  const source = readFileSync(
    new URL("../src/features/workouts/active-exercise-progress-chart.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /No completed sets in the last 6 months/);
  assert.match(source, /Hollow points use estimated body weight/);
  assert.match(source, /Date\.parse\(point\.performedAt\)/);
});
