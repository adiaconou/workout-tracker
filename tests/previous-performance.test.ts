import assert from "node:assert/strict";
import test from "node:test";
import { formatPreviousSetPerformance } from "../src/features/workouts/previous-performance";

test("formats a previous weight and rep result", () => {
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    actualWeight: 135,
    actualReps: 8,
    actualDurationSec: null,
    weightUnit: "lb",
    status: "completed",
  }), "135 lb × 8 reps");
});

test("preserves fractional weights and supports duration exercises", () => {
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    actualWeight: 22.5,
    actualReps: null,
    actualDurationSec: 30,
    weightUnit: "lb",
    status: "completed",
  }), "22.5 lb × 30 sec");
});

test("labels round targets as rounds instead of reps", () => {
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "emom",
    targetType: "rounds",
    actualWeight: 22.5,
    actualReps: 6,
    actualDurationSec: null,
    weightUnit: "lb",
    status: "completed",
  }), "22.5 lb × 6 rounds");
});

test("uses empty placeholders when no completed history exists", () => {
  assert.equal(formatPreviousSetPerformance(undefined), "— × —");
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    actualWeight: null,
    actualReps: null,
    actualDurationSec: null,
    weightUnit: "lb",
    status: "skipped",
  }), "— × —");
});
