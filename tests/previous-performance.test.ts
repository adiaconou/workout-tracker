import assert from "node:assert/strict";
import test from "node:test";
import { formatPreviousSetPerformance } from "../src/client/workouts/previous-performance";

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

test("uses target semantics when legacy rows contain both result fields", () => {
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    targetType: "reps",
    actualWeight: 150,
    actualReps: 6,
    actualDurationSec: 0,
    weightUnit: "lb",
    status: "completed",
  }), "150 lb × 6 reps");
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    targetType: "duration",
    actualWeight: 20,
    actualReps: 0,
    actualDurationSec: 30,
    weightUnit: "kg",
    status: "completed",
  }), "20 kg × 30 sec");
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    targetType: "reps",
    actualWeight: 20,
    actualReps: null,
    actualDurationSec: 0,
    weightUnit: "kg",
    status: "completed",
  }), "20 kg × —");
  assert.equal(formatPreviousSetPerformance({
    setNumber: 1,
    setType: "regular",
    targetType: "duration",
    actualWeight: 20,
    actualReps: 0,
    actualDurationSec: null,
    weightUnit: "kg",
    status: "completed",
  }), "20 kg × —");
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
