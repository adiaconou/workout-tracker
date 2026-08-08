import assert from "node:assert/strict";
import test from "node:test";
import type { WorkoutSet } from "../domain/entities";
import {
  formatHistoryDuration,
  formatSetResult,
  historyRangeStart,
  historyStatusLabel,
} from "../src/features/history/history-format";

test("formats history ranges, durations, and completion states", () => {
  assert.equal(
    historyRangeStart("30", new Date("2026-07-18T12:00:00.000Z")),
    "2026-06-18T12:00:00.000Z",
  );
  assert.equal(historyRangeStart("all"), null);
  assert.equal(formatHistoryDuration(9 * 3600 + 24 * 60), "9h 24m");
  assert.equal(historyStatusLabel("Partial"), "Finished early");
});

test("formats rep, bodyweight, timed, and skipped set results", () => {
  const base = {
    status: "completed",
    actualWeight: 135,
    actualReps: 10,
    actualDurationSec: null,
    weightUnit: "lb",
  } as WorkoutSet;
  assert.equal(formatSetResult(base, "external"), "135 lb × 10");
  assert.equal(
    formatSetResult({ ...base, actualWeight: 61.2, weightUnit: "kg" }, "external"),
    "61.2 kg × 10",
  );
  assert.equal(
    formatSetResult({ ...base, actualWeight: 0 }, "bodyweight"),
    "Bodyweight × 10",
  );
  assert.equal(
    formatSetResult({ ...base, actualReps: null, actualDurationSec: 47 }, "bodyweight"),
    "47 sec · 135 lb",
  );
  assert.equal(formatSetResult({ ...base, status: "skipped" }, "external"), "Skipped");
});
