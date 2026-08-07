import assert from "node:assert/strict";
import test from "node:test";
import {
  recentWorkoutRangeStart,
  routineDurationLabel,
  routineElapsedLabel,
  routineLastDoneLabel,
} from "../src/features/routines/routine-card-format";

const NOW = new Date("2026-08-02T12:00:00.000Z");

test("shows the calendar date plus whole elapsed days and hours", () => {
  assert.equal(
    routineLastDoneLabel("2026-07-30T08:00:00.000Z", {
      now: NOW,
      locale: "en-US",
      timeZone: "UTC",
    }),
    "Last done Jul 30, 2026 · 3 days 4 hours ago",
  );
});

test("formats elapsed boundaries without rounding or negative ages", () => {
  assert.equal(routineElapsedLabel(new Date(NOW.getTime() - 59 * 60_000 - 59_000), NOW), "Less than 1 hour ago");
  assert.equal(routineElapsedLabel(new Date(NOW.getTime() - 60 * 60_000), NOW), "1 hour ago");
  assert.equal(routineElapsedLabel(new Date(NOW.getTime() - 24 * 60 * 60_000), NOW), "1 day ago");
  assert.equal(routineElapsedLabel(new Date(NOW.getTime() - 49 * 60 * 60_000), NOW), "2 days 1 hour ago");
  assert.equal(routineElapsedLabel(NOW, NOW), "Just now");
  assert.equal(routineElapsedLabel(new Date(NOW.getTime() + 60_000), NOW), "Just now");
});

test("handles routines with no usable completion date", () => {
  assert.equal(routineLastDoneLabel(null, { now: NOW }), "Not done yet");
  assert.equal(routineLastDoneLabel("not-a-date", { now: NOW }), "Last workout date unavailable");
});

test("shows actual average duration with its sample count and falls back to the estimate", () => {
  assert.equal(routineDurationLabel(3_121, 1, 60), "Avg 52 min (1 workout)");
  assert.equal(routineDurationLabel(3_121, 6, 60), "Avg 52 min (6 workouts)");
  assert.equal(routineDurationLabel(null, 0, 60), "Est. 60 min");
});

test("uses an exact rolling seven-day cutoff for recent workouts", () => {
  assert.equal(
    recentWorkoutRangeStart(new Date("2026-08-07T12:00:00.000Z")),
    "2026-07-31T12:00:00.000Z",
  );
});
