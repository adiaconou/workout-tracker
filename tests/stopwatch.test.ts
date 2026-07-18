import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStopwatch,
  getStopwatchElapsedMs,
  getStopwatchSeconds,
} from "../src/features/workouts/stopwatch";

test("keeps paused stopwatch time and advances a running stopwatch from its anchor", () => {
  assert.equal(getStopwatchElapsedMs(null, 12_345, 99_999), 12_345);
  assert.equal(getStopwatchElapsedMs(10_000, 0, 22_345), 12_345);
});

test("formats stopwatch time with tenths and rounds logged seconds", () => {
  assert.equal(formatStopwatch(0), "00:00.0");
  assert.equal(formatStopwatch(65_432), "01:05.4");
  assert.equal(getStopwatchSeconds(29_600), 30);
  assert.equal(getStopwatchSeconds(250), 1);
});
