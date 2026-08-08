import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoutineRecommendations,
  type RecentCompletedSession,
  type RecentCompletedSet,
  type RoutineCode,
} from "../src/domain/recommendations";
import { canonicalRoutines } from "../src/domain/routines";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function completedSession(routineCode: RoutineCode, hoursAgo: number): RecentCompletedSession {
  return {
    routineCode,
    completedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
  };
}

function completedRoutineSets(routineCode: RoutineCode, hoursAgo: number): RecentCompletedSet[] {
  const performedAt = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  const routine = canonicalRoutines.find((candidate) => candidate.code === routineCode);
  assert.ok(routine, `Missing canonical Routine ${routineCode}`);
  return routine.exercises.flatMap((exercise, exerciseIndex) => {
    const regularType = exercise.rest.toLowerCase().includes("start every minute")
      ? "emom"
      : "regular";
    const definitions = [
      { setType: "warmup", count: exercise.warmupSets },
      { setType: regularType, count: exercise.regularSets },
      { setType: "failure", count: exercise.failureSets },
      { setType: "drop", count: exercise.dropSets },
    ];
    return definitions.flatMap(({ setType, count }) =>
      Array.from({ length: count }, () => ({
        routineCode,
        exerciseOrder: exerciseIndex + 1,
        setType,
        performedAt,
      })),
    );
  });
}

test("recommendation fixtures follow the canonical set prescriptions", () => {
  const routineB = completedRoutineSets("B", 12);
  const routineD = completedRoutineSets("D", 12);

  assert.equal(routineB.length, 25);
  assert.equal(routineD.length, 32);
  assert.equal(routineD.filter((set) => set.setType === "emom").length, 10);
  assert.equal(routineB.filter((set) => set.setType === "failure").length, 1);
  assert.equal(routineB.filter((set) => set.setType === "drop").length, 1);
});

test("starts a new training history with Routine A and leaves every routine available", () => {
  const result = buildRoutineRecommendations([], [], NOW);

  assert.equal(result.recommendedRoutineCode, "A");
  assert.equal(result.recommendationKind, "routine");
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

test("returns to the most-due upper routine after an isolated leg workout", () => {
  const result = buildRoutineRecommendations(
    [completedSession("C", 18)],
    completedRoutineSets("C", 18),
    NOW,
  );

  assert.equal(result.nextInSequence, "A");
  assert.equal(result.recommendedRoutineCode, "A");
  assert.equal(result.routines.find((routine) => routine.code === "C")?.availability, "recovering");
  assert.equal(result.routines.find((routine) => routine.code === "A")?.availability, "available");
});

test("keeps a recovery detour from skipping the next upper-body routine", () => {
  const result = buildRoutineRecommendations(
    [completedSession("C", 18), completedSession("A", 48)],
    [...completedRoutineSets("C", 18), ...completedRoutineSets("A", 48)],
    NOW,
  );

  assert.equal(result.nextInSequence, "B");
  assert.equal(result.recommendedRoutineCode, "B");
  assert.equal(result.routines.find((routine) => routine.code === "B")?.availabilityLabel, "Moderate logged overlap");
  assert.match(result.summary, /warm-up performance/i);
});

test("can recommend the planned upper-body routine with an honest moderate-overlap warning", () => {
  const result = buildRoutineRecommendations(
    [completedSession("A", 36)],
    completedRoutineSets("A", 36),
    NOW,
  );

  assert.equal(result.nextInSequence, "B");
  assert.equal(result.recommendedRoutineCode, "B");
  assert.equal(result.routines.find((routine) => routine.code === "B")?.availability, "caution");
  assert.equal(result.routines.find((routine) => routine.code === "B")?.availabilityLabel, "Moderate logged overlap");
  assert.match(result.summary, /moderate overlap/i);
  assert.match(result.summary, /soreness, energy, and warm-up performance/i);
});

test("does not recommend moderate-overlap upper work inside the high-overlap window", () => {
  const result = buildRoutineRecommendations(
    [completedSession("A", 35)],
    completedRoutineSets("A", 35),
    NOW,
  );

  assert.equal(result.recommendedRoutineCode, "C");
  assert.equal(result.routines.find((routine) => routine.code === "B")?.availability, "recovering");
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
  assert.equal(result.recommendationKind, "recovery");
  assert.ok(result.routines.every((routine) => routine.availability === "recovering"));
  assert.match(result.summary, /not a medical readiness assessment/i);
  assert.doesNotMatch(result.summary, /best goal-aligned|sufficiently recovered/i);
});

test("never recommends a routine that needs equipment outside Training setup", () => {
  const result = buildRoutineRecommendations([], [], NOW, undefined, {
    A: { compatible: false, missingEquipment: ["Barbell & rack"] },
    B: { compatible: true, missingEquipment: [] },
    C: { compatible: true, missingEquipment: [] },
    D: { compatible: true, missingEquipment: [] },
  });

  assert.notEqual(result.recommendedRoutineCode, "A");
  assert.equal(
    result.routines.find((routine) => routine.code === result.recommendedRoutineCode)?.equipmentCompatible,
    true,
  );
  assert.equal(result.recommendationKind, "routine");
  assert.equal(result.routines.find((routine) => routine.code === "A")?.isRecommended, false);
  assert.deepEqual(
    result.routines.find((routine) => routine.code === "A")?.missingEquipment,
    ["Barbell & rack"],
  );
});

test("asks for routine adaptation instead of claiming recovery when no routine matches equipment", () => {
  const incompatible = {
    compatible: false,
    missingEquipment: ["Cable or multi-gym"],
  };
  const result = buildRoutineRecommendations([], [], NOW, undefined, {
    A: incompatible,
    B: incompatible,
    C: incompatible,
    D: incompatible,
  });

  assert.equal(result.recommendedRoutineCode, null);
  assert.equal(result.recommendationKind, "equipment_setup");
  assert.match(result.summary, /ask coach/i);
  assert.doesNotMatch(result.summary, /recovery/i);
});

test("does not treat missing set logs as proof of readiness", () => {
  const result = buildRoutineRecommendations([completedSession("A", 18)], [], NOW);

  assert.equal(result.recommendedRoutineCode, "B");
  assert.match(
    result.routines.find((routine) => routine.code === "B")?.availabilityReason ?? "",
    /not evidence of recovery/i,
  );
  assert.match(result.summary, /not evidence of recovery/i);
});

test("uses exercise muscle metadata in preference to legacy routine-position mappings", () => {
  const performedAt = completedSession("A", 12).completedAt;
  const result = buildRoutineRecommendations(
    [completedSession("A", 12)],
    Array.from({ length: 8 }, () => ({
      routineCode: "A" as const,
      exerciseOrder: 1,
      setType: "regular",
      performedAt,
      muscles: { quads: 1, glutes: 0.8 },
    })),
    NOW,
  );

  assert.equal(result.routines.find((routine) => routine.code === "C")?.availability, "recovering");
  assert.equal(result.routines.find((routine) => routine.code === "A")?.availability, "available");
});
