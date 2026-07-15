import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoutineRecommendations,
  type RecentCompletedSession,
  type RecentCompletedSet,
  type RoutineCode,
} from "../lib/recommendations";

const NOW = new Date("2026-07-15T12:00:00.000Z");

const workingSetCounts: Record<RoutineCode, number[]> = {
  A: [5, 4, 3, 3, 3, 2],
  B: [4, 4, 3, 3, 4, 3, 3],
  C: [4, 4, 3, 2, 3, 3],
  D: [10, 3, 3, 3, 3, 3, 3, 3],
};

function completedSession(routineCode: RoutineCode, hoursAgo: number): RecentCompletedSession {
  return {
    routineCode,
    completedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
  };
}

function completedRoutineSets(routineCode: RoutineCode, hoursAgo: number): RecentCompletedSet[] {
  const performedAt = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  return workingSetCounts[routineCode].flatMap((count, exerciseIndex) =>
    Array.from({ length: count }, () => ({
      routineCode,
      exerciseOrder: exerciseIndex + 1,
      setType: "regular",
      performedAt,
    })),
  );
}

test("starts a new training history with Routine A and leaves every routine available", () => {
  const result = buildRoutineRecommendations([], [], NOW);

  assert.equal(result.recommendedRoutineCode, "A");
  assert.equal(result.nextInSequence, "A");
  assert.ok(result.routines.every((routine) => routine.availability === "available"));
});

test("routes around recent upper-body strength fatigue to Routine C", () => {
  const result = buildRoutineRecommendations(
    [completedSession("A", 18)],
    completedRoutineSets("A", 18),
    NOW,
  );

  assert.equal(result.nextInSequence, "B");
  assert.equal(result.recommendedRoutineCode, "C");
  assert.equal(result.routines.find((routine) => routine.code === "A")?.availability, "recovering");
  assert.equal(result.routines.find((routine) => routine.code === "C")?.availability, "available");
});

test("continues to Routine D after a recent leg workout", () => {
  const result = buildRoutineRecommendations(
    [completedSession("C", 18)],
    completedRoutineSets("C", 18),
    NOW,
  );

  assert.equal(result.nextInSequence, "D");
  assert.equal(result.recommendedRoutineCode, "D");
  assert.equal(result.routines.find((routine) => routine.code === "C")?.availability, "recovering");
  assert.equal(result.routines.find((routine) => routine.code === "D")?.availability, "available");
});

test("does not block the planned routine after only one recently completed pull-up set", () => {
  const result = buildRoutineRecommendations(
    [completedSession("A", 18)],
    [{ routineCode: "A", exerciseOrder: 1, setType: "regular", performedAt: completedSession("A", 18).completedAt }],
    NOW,
  );

  assert.equal(result.recommendedRoutineCode, "B");
  assert.equal(result.routines.find((routine) => routine.code === "B")?.availability, "available");
});

test("recommends recovery when recent upper- and lower-body work blocks every routine", () => {
  const sessions = [completedSession("C", 12), completedSession("A", 18)];
  const sets = [...completedRoutineSets("C", 12), ...completedRoutineSets("A", 18)];
  const result = buildRoutineRecommendations(sessions, sets, NOW);

  assert.equal(result.recommendedRoutineCode, null);
  assert.ok(result.routines.every((routine) => routine.availability === "recovering"));
});
