import assert from "node:assert/strict";
import test from "node:test";
import { exerciseProgressRangeStart } from "../src/client/exercises/exercise-progress-range";

test("clamps progress ranges at short month boundaries", () => {
  const start = exerciseProgressRangeStart("3m", new Date(2026, 4, 31, 12, 30));
  const date = new Date(start!);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 1);
  assert.equal(date.getDate(), 28);
  assert.equal(date.getHours(), 12);
  assert.equal(date.getMinutes(), 30);
});

test("clamps a one-year range from leap day and leaves all time open", () => {
  const start = exerciseProgressRangeStart("1y", new Date(2024, 1, 29, 8, 15));
  const date = new Date(start!);
  assert.equal(date.getFullYear(), 2023);
  assert.equal(date.getMonth(), 1);
  assert.equal(date.getDate(), 28);
  assert.equal(exerciseProgressRangeStart("all"), null);
});
