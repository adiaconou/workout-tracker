import assert from "node:assert/strict";
import test from "node:test";
import type { Workout } from "../src/api/types";
import {
  formatElapsedDuration,
  summarizeWorkoutTiming,
} from "../src/features/workouts/workout-timing";

test("formats compact elapsed durations without hiding seconds", () => {
  assert.equal(formatElapsedDuration(0), "0s");
  assert.equal(formatElapsedDuration(47), "47s");
  assert.equal(formatElapsedDuration(72), "1m 12s");
  assert.equal(formatElapsedDuration(3723), "1h 2m 3s");
  assert.equal(formatElapsedDuration(3600), "1h");
});

test("summarizes workout, exercise, set, and rest timing", () => {
  const workout = {
    startedAt: "2026-08-03T10:00:00.000Z",
    completedAt: "2026-08-03T10:10:00.000Z",
    exercises: [
      {
        id: "exercise-1",
        position: 1,
        exerciseNameSnapshot: "Bench press",
        sets: [
          {
            id: "set-1",
            position: 1,
            status: "completed",
            startedAt: "2026-08-03T10:00:00.000Z",
            completedAt: "2026-08-03T10:01:00.000Z",
            elapsedSeconds: 60,
            actualRestSec: 90,
          },
          {
            id: "set-2",
            position: 2,
            status: "completed",
            startedAt: "2026-08-03T10:02:30.000Z",
            completedAt: "2026-08-03T10:03:00.000Z",
            elapsedSeconds: null,
            actualRestSec: 0,
          },
        ],
      },
      {
        id: "exercise-2",
        position: 2,
        exerciseNameSnapshot: "Row",
        sets: [
          {
            id: "set-3",
            position: 3,
            status: "skipped",
            startedAt: null,
            completedAt: "2026-08-03T10:10:00.000Z",
            elapsedSeconds: null,
            actualRestSec: null,
          },
        ],
      },
    ],
  } as unknown as Workout;

  const summary = summarizeWorkoutTiming(workout);
  assert.equal(summary.elapsedSeconds, 600);
  assert.equal(summary.completedSets, 2);
  assert.equal(summary.skippedSets, 1);
  assert.equal(summary.totalExercises, 2);
  assert.equal(summary.exercises[0]?.elapsedSeconds, 180);
  assert.deepEqual(
    summary.exercises[0]?.sets.map((set) => [set.elapsedSeconds, set.restSeconds]),
    [[60, 90], [30, 0]],
  );
  assert.equal(summary.exercises[1]?.elapsedSeconds, null);
});
