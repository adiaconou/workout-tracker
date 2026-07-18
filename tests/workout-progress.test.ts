import assert from "node:assert/strict";
import test from "node:test";
import type { GuidedSet } from "../lib/workout";
import { buildWorkoutExerciseProgress } from "../src/features/workouts/workout-progress";

function set(
  globalIndex: number,
  exerciseOrder: number,
  exerciseName: string,
  restDisplay: string,
): GuidedSet {
  return {
    id: `${exerciseOrder}:${globalIndex}`,
    globalIndex,
    exerciseId: `exercise-${exerciseOrder}`,
    exerciseOrder,
    exerciseName,
    exerciseSetNumber: 1,
    exerciseSetTotal: 2,
    typeSetNumber: 1,
    typeSetTotal: 2,
    setType: "regular",
    target: "8 reps",
    targetUnit: "reps",
    effort: "2 RIR",
    purpose: "",
    restDisplay,
    restSeconds: 90,
    restRule: "standard",
    loadType: "external",
    weightUnit: "lb",
  };
}

const interleavedSets = [
  set(0, 1, "Barbell curl", "Superset"),
  set(1, 2, "Cable pressdown", "Superset"),
  set(2, 1, "Barbell curl", "Superset"),
  set(3, 2, "Cable pressdown", "Superset"),
  set(4, 3, "Goblet squat", "90 sec"),
  set(5, 3, "Goblet squat", "90 sec"),
];

test("summarizes completed, current, in-progress, and upcoming exercises", () => {
  const progress = buildWorkoutExerciseProgress(interleavedSets, 1);
  assert.deepEqual(progress.map((exercise) => exercise.status), [
    "in_progress",
    "current",
    "upcoming",
  ]);
  assert.equal(progress[0].completedSets, 1);
  assert.equal(progress[0].remainingSets, 1);
  assert.equal(progress[0].restLabel, "Superset");
  assert.equal(progress[2].restLabel, "Rest 90 sec");
});

test("marks an exercise complete once all of its sets are logged", () => {
  const progress = buildWorkoutExerciseProgress(interleavedSets, 4);
  assert.equal(progress[0].status, "completed");
  assert.equal(progress[1].status, "completed");
  assert.equal(progress[2].status, "current");
});
