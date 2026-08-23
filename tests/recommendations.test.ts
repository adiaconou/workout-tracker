import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoutineRecommendations,
  EXERCISE_MUSCLES,
  type RecommendationResult,
  type RecentCompletedSession,
  type RecentCompletedSet,
  type RoutineCode,
} from "../src/domain/recommendations";
import { canonicalRoutines, legacyRoutineExerciseMuscleTemplates } from "../src/domain/routines";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function completedSession(routineCode: string, hoursAgo: number): RecentCompletedSession {
  return {
    routineCode,
    completedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
  };
}

function recommendationRow(result: RecommendationResult, code: string) {
  const routine = result.routines.find((candidate) => candidate.code === code);
  assert.ok(routine, `Missing recommendation for Routine ${code}`);
  return routine;
}

function completedMuscleSet(
  routineCode: string,
  hoursAgo: number,
  muscles: NonNullable<RecentCompletedSet["muscles"]>,
  options: {
    actualRir?: number | null;
    includeActualRir?: boolean;
    setType?: string;
  } = {},
): RecentCompletedSet {
  return {
    routineCode,
    exerciseOrder: 1,
    setType: options.setType ?? "regular",
    performedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    muscles,
    ...(options.includeActualRir ? { actualRir: options.actualRir } : {}),
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

test("canonical fallback muscle metadata contains the audited corrections", () => {
  assert.deepEqual(EXERCISE_MUSCLES.A[3], { back: 1, biceps: 0.5, grip: 0.25 });
  assert.deepEqual(EXERCISE_MUSCLES.B[4], { back: 1, biceps: 0.5, grip: 0.25 });
  assert.deepEqual(EXERCISE_MUSCLES.C[1], { glutes: 1, hamstrings: 0.7, core: 0.3, grip: 0.3 });
  assert.deepEqual(EXERCISE_MUSCLES.C[3], { hamstrings: 1, glutes: 0.8, grip: 0.35 });
  assert.deepEqual(EXERCISE_MUSCLES.C[6], { core: 1, shoulders: 0.25 });
  assert.deepEqual(EXERCISE_MUSCLES.D[3], { back: 1, biceps: 0.4, grip: 0.2 });
  assert.deepEqual(EXERCISE_MUSCLES.D[4], { back: 1, biceps: 0.4, grip: 0.2 });
});

test("legacy templates and canonical fallback weights stay aligned", () => {
  for (const routine of canonicalRoutines) {
    routine.exercises.forEach((exercise, index) => {
      const template = legacyRoutineExerciseMuscleTemplates.find((candidate) =>
        candidate.name === exercise.name);
      assert.ok(template, `Missing legacy muscle template for ${exercise.name}`);
      assert.deepEqual(
        Object.fromEntries(template.muscles.map((muscle) => [muscle.muscleGroup, muscle.weight])),
        EXERCISE_MUSCLES[routine.code][index + 1],
      );
    });
  }
});

test("assesses Routine C with its corrected grip and shoulder coverage", () => {
  const result = buildRoutineRecommendations(
    [],
    [completedMuscleSet("Carry and brace", 1, { core: 4.5, grip: 6, shoulders: 6 })],
    NOW,
  );

  assert.equal(recommendationRow(result, "C").availability, "caution");
  assert.match(recommendationRow(result, "C").availabilityReason, /core, grip, and shoulders/i);
});

test("canonical recovery profiles account for corrected grip set volume", () => {
  const cases: Array<{
    code: RoutineCode;
    muscles: NonNullable<RecentCompletedSet["muscles"]>;
  }> = [
    { code: "A", muscles: { core: 6, shoulders: 3, grip: 6 } },
    { code: "B", muscles: { chest: 6, core: 3, grip: 6 } },
    { code: "D", muscles: { core: 6, shoulders: 2.4, grip: 6 } },
  ];

  for (const { code, muscles } of cases) {
    const result = buildRoutineRecommendations(
      [],
      [completedMuscleSet("Recent work", 1, muscles)],
      NOW,
      undefined,
      [code],
    );
    assert.equal(recommendationRow(result, code).availability, "caution");
  }
});

test("starts canonical history with exactly one recommended routine", () => {
  const result = buildRoutineRecommendations([], [], NOW);

  assert.equal(result.recommendedRoutineCode, "A");
  assert.equal(result.recommendationKind, "routine");
  assert.equal(result.nextInSequence, "A");
  assert.deepEqual(
    Object.fromEntries(result.routines.map((routine) => [routine.code, routine.availability])),
    { A: "recommended", B: "available", C: "available", D: "available" },
  );
});

test("assesses active custom routines without displacing the canonical rolling plan", () => {
  const result = buildRoutineRecommendations(
    [],
    [],
    NOW,
    { Custom: { back: 1 } },
    ["A", "B", "C", "D", "Custom"],
  );

  assert.deepEqual(result.routines.map(({ code }) => code), ["A", "B", "C", "D", "Custom"]);
  assert.equal(result.nextInSequence, "A");
  assert.equal(result.recommendedRoutineCode, "A");
  assert.equal(recommendationRow(result, "A").availability, "recommended");
  assert.equal(recommendationRow(result, "Custom").availability, "available");
  assert.equal(recommendationRow(result, "Custom").isNextInSequence, false);
});

test("uses active custom routines as a fallback rotation when no canonical routine is active", () => {
  const result = buildRoutineRecommendations(
    [],
    [],
    NOW,
    { Custom: { back: 1 }, Mobility: { core: 1 } },
    [" Custom ", "Mobility", "Custom", ""],
  );

  assert.deepEqual(result.routines.map(({ code }) => code), ["Custom", "Mobility"]);
  assert.equal(result.nextInSequence, "Custom");
  assert.equal(result.recommendedRoutineCode, "Custom");
  assert.equal(recommendationRow(result, "Custom").availability, "recommended");
  assert.equal(recommendationRow(result, "Mobility").availability, "available");
});

test("returns neutral guidance when there are no active routines", () => {
  const result = buildRoutineRecommendations([], [], NOW, undefined, []);

  assert.equal(result.recommendedRoutineCode, null);
  assert.equal(result.nextInSequence, null);
  assert.equal(result.recommendationKind, "no_plan");
  assert.deepEqual(result.routines, []);
  assert.match(result.summary, /no active routines/i);
});

test("ignores a legacy canonical set whose exercise position no longer maps", () => {
  const result = buildRoutineRecommendations(
    [],
    [{
      routineCode: "A",
      exerciseOrder: 999,
      setType: "regular",
      performedAt: NOW.toISOString(),
    }],
    NOW,
    { A: { back: 1 } },
    ["A"],
  );

  assert.equal(result.recommendedRoutineCode, "A");
  assert.equal(recommendationRow(result, "A").availability, "recommended");
});

test("excludes completed sets at the exact 48-hour lookback boundary", () => {
  const profiles = { A: { back: 1 } };
  const justInside = completedMuscleSet("Source", 48 - 1 / 3_600_000, { back: 6 });
  const exactlyAtBoundary = completedMuscleSet("Source", 48, { back: 6 });
  const insideResult = buildRoutineRecommendations(
    [],
    [justInside],
    NOW,
    profiles,
    ["A"],
  );
  const boundaryResult = buildRoutineRecommendations(
    [],
    [exactlyAtBoundary],
    NOW,
    profiles,
    ["A"],
  );

  assert.equal(recommendationRow(insideResult, "A").availability, "caution");
  assert.equal(insideResult.recommendedRoutineCode, null);
  assert.match(recommendationRow(insideResult, "A").availabilityReason, /Routine Source/);
  assert.equal(recommendationRow(boundaryResult, "A").availability, "recommended");
  assert.equal(boundaryResult.recommendedRoutineCode, "A");
});

test("does not carry overlap guidance from a six-day-old completion", () => {
  const result = buildRoutineRecommendations(
    [completedSession("A", 6 * 24)],
    completedRoutineSets("A", 6 * 24),
    NOW,
  );

  assert.deepEqual(
    Object.fromEntries(result.routines.map((routine) => [routine.code, routine.availability])),
    { A: "available", B: "recommended", C: "available", D: "available" },
  );
  assert.equal(result.recommendedRoutineCode, "B");
  assert.match(recommendationRow(result, "A").availabilityReason, /past 48 hours/i);
});

test("maps high and moderate muscle overlap to caution and names the source routine", () => {
  const profiles = { A: { back: 1 }, B: { chest: 1 } };
  const high = buildRoutineRecommendations(
    [],
    [completedMuscleSet("Upper Strength", 1, { back: 6 })],
    NOW,
    profiles,
    ["A", "B"],
  );
  const moderate = buildRoutineRecommendations(
    [],
    [completedMuscleSet("Upper Volume", 1, { back: 1.5 })],
    NOW,
    profiles,
    ["A", "B"],
  );

  assert.equal(recommendationRow(high, "A").availability, "caution");
  assert.match(
    recommendationRow(high, "A").availabilityReason,
    /Routine Upper Strength trained upper back and lats.*High overlap/i,
  );
  assert.equal(recommendationRow(moderate, "A").availability, "caution");
  assert.match(
    recommendationRow(moderate, "A").availabilityReason,
    /Routine Upper Volume trained upper back and lats.*Moderate overlap/i,
  );
  assert.equal(recommendationRow(high, "B").availability, "recommended");
});

test("uses optional actual RIR to adjust completed-set effort", () => {
  const assess = (
    muscleWeight: number,
    actualRir?: number | null,
    includeActualRir = true,
  ) => buildRoutineRecommendations(
    [],
    [completedMuscleSet(
      "Source",
      1,
      { back: muscleWeight },
      { actualRir, includeActualRir },
    )],
    NOW,
    { A: { back: 1 } },
    ["A"],
  );

  assert.equal(recommendationRow(assess(1, undefined, false), "A").availability, "recommended");
  assert.equal(recommendationRow(assess(1, null), "A").availability, "recommended");
  assert.equal(recommendationRow(assess(1, Number.NaN), "A").availability, "recommended");
  assert.equal(recommendationRow(assess(1, 0), "A").availability, "caution");
  assert.equal(recommendationRow(assess(1.05, 1), "A").availability, "caution");
  assert.equal(recommendationRow(assess(1.05, 2), "A").availability, "recommended");
  assert.equal(recommendationRow(assess(1.5, 2), "A").availability, "caution");
  assert.equal(recommendationRow(assess(1.5, 4), "A").availability, "recommended");
});

test("routes around recent upper-body overlap to Routine C", () => {
  const result = buildRoutineRecommendations(
    [completedSession("A", 18)],
    completedRoutineSets("A", 18),
    NOW,
  );

  assert.equal(result.nextInSequence, "B");
  assert.equal(result.recommendedRoutineCode, "C");
  assert.equal(recommendationRow(result, "A").availability, "caution");
  assert.equal(recommendationRow(result, "B").availability, "caution");
  assert.equal(recommendationRow(result, "C").availability, "recommended");
  assert.match(recommendationRow(result, "A").availabilityReason, /Routine A/);
});

test("returns to the most-due upper routine after an isolated leg workout", () => {
  const result = buildRoutineRecommendations(
    [completedSession("C", 18)],
    completedRoutineSets("C", 18),
    NOW,
  );

  assert.equal(result.nextInSequence, "A");
  assert.equal(result.recommendedRoutineCode, "A");
  assert.equal(recommendationRow(result, "C").availability, "caution");
  assert.equal(recommendationRow(result, "A").availability, "recommended");
});

test("does not recommend a rolling-plan routine while every option needs caution", () => {
  const result = buildRoutineRecommendations(
    [completedSession("C", 18), completedSession("A", 47)],
    [...completedRoutineSets("C", 18), ...completedRoutineSets("A", 47)],
    NOW,
  );

  assert.equal(result.nextInSequence, "B");
  assert.equal(result.recommendedRoutineCode, null);
  assert.equal(result.recommendationKind, "recovery");
  assert.ok(result.routines.every((routine) => routine.availability === "caution"));
  assert.match(result.summary, /not a medical readiness assessment/i);
  assert.match(result.summary, /review each routine's availability details/i);
  assert.doesNotMatch(result.summary, /missing muscle tags/i);
});

test("does not block the planned routine after one recently completed pull-up set", () => {
  const result = buildRoutineRecommendations(
    [completedSession("A", 18)],
    [{
      routineCode: "A",
      exerciseOrder: 1,
      setType: "regular",
      performedAt: completedSession("A", 18).completedAt,
    }],
    NOW,
  );

  assert.equal(result.recommendedRoutineCode, "B");
  assert.equal(recommendationRow(result, "B").availability, "recommended");
});

test("keeps every overlap-only limitation at caution", () => {
  const sessions = [completedSession("C", 12), completedSession("A", 18)];
  const sets = [...completedRoutineSets("C", 12), ...completedRoutineSets("A", 18)];
  const result = buildRoutineRecommendations(sessions, sets, NOW);

  assert.equal(result.recommendedRoutineCode, null);
  assert.equal(result.recommendationKind, "recovery");
  assert.ok(result.routines.every((routine) => routine.availability === "caution"));
  assert.match(result.summary, /not a medical readiness assessment/i);
});

test("treats missing muscle metadata as caution", () => {
  const result = buildRoutineRecommendations(
    [],
    [],
    NOW,
    undefined,
    ["A", "Custom"],
  );

  assert.equal(recommendationRow(result, "A").availability, "recommended");
  assert.equal(recommendationRow(result, "Custom").availability, "caution");
  assert.match(recommendationRow(result, "Custom").availabilityReason, /metadata is missing/i);
});

test("keeps a mixed active program in its configured order", () => {
  const result = buildRoutineRecommendations(
    [],
    [],
    NOW,
    {
      Custom: { core: 2 },
      A: { chest: 2 },
    },
    ["Custom", "A"],
  );

  assert.equal(result.nextInSequence, "Custom");
  assert.equal(result.recommendedRoutineCode, "Custom");
  assert.deepEqual(result.routines.map((routine) => routine.code), ["Custom", "A"]);
});

test("does not treat missing set logs as proof of readiness", () => {
  const result = buildRoutineRecommendations([completedSession("A", 18)], [], NOW);

  assert.equal(result.recommendedRoutineCode, "B");
  assert.equal(recommendationRow(result, "B").availability, "recommended");
  assert.match(result.summary, /not evidence of recovery/i);
});

test("uses exercise muscle metadata in preference to canonical position mappings", () => {
  const performedAt = completedSession("A", 12).completedAt;
  const result = buildRoutineRecommendations(
    [completedSession("A", 12)],
    Array.from({ length: 8 }, () => ({
      routineCode: "A",
      exerciseOrder: 1,
      setType: "regular",
      performedAt,
      muscles: { quads: 1, glutes: 0.8 },
    })),
    NOW,
  );

  assert.equal(recommendationRow(result, "C").availability, "caution");
  assert.equal(recommendationRow(result, "A").availability, "available");
  assert.equal(recommendationRow(result, "B").availability, "recommended");
});
