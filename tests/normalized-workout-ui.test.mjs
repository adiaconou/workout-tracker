import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("active workout renders normalized exercise and set guidance", () => {
  const source = readFileSync(
    new URL("../src/features/workouts/active-workout-screen.tsx", import.meta.url),
    "utf8",
  );

  for (const label of [
    "Purpose",
    "Exercise instructions",
    "Exercise notes",
    "Sides",
    "Tempo",
    "Load",
    "Set notes",
  ]) {
    assert.ok(source.includes(`label="${label}"`), `${label} must be visible during an active workout`);
  }
  assert.match(source, /resultUnitName\(currentSet\.targetUnit/);
  assert.match(source, /currentSet\.sourceRoutineExerciseId \?\? `position:/);
});
