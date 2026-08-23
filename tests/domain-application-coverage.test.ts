import assert from "node:assert/strict";
import test from "node:test";
import {
  validateExerciseInput,
} from "../src/domain/exercises/validation";
import {
  validateRoutineVersionInput,
} from "../src/domain/routines/validation";
import { ExerciseService } from "../src/server/exercises/service";
import { RoutineService } from "../src/server/routines/service";
import { WorkoutService } from "../src/server/workouts/service";
import type {
  Exercise,
  ExerciseInput,
  RoutineVersionInput,
  WorkoutSetCorrection,
} from "../src/domain/entities";
import {
  buildExerciseProgress,
  canonicalWeightUnit,
  convertWeight,
  type ExerciseProgressCandidate,
} from "../src/domain/exercise-progress";
import {
  expandLegacyPrescription,
  parseRestPrescription,
  parseRir,
} from "../src/domain/prescription";
import {
  centimetersToFeetAndInches,
  centimetersToInches,
  feetAndInchesToCentimeters,
  inchesToCentimeters,
  kilogramsToPounds,
  poundsToKilograms,
} from "../src/domain/profile";
import type { EntityRepository } from "../src/domain/repositories/entity-repository";
import {
  equipmentDescription,
  equipmentIds,
  isExerciseEquipmentAvailable,
  isTrainingProfileComplete,
  missingExerciseEquipmentLabels,
  parseStoredEquipmentPreferences,
  trainingProfileFromStored,
  validateTrainingProfileInput,
  type EquipmentId,
} from "../src/domain/training-profile";
import {
  buildRoutineRecommendations,
  type MuscleWeights,
  type RecentCompletedSession,
  type RecentCompletedSet,
  type RoutineProfiles,
} from "../src/domain/recommendations";
import {
  buildGuidedSets,
  getNormalizedWorkoutPrescription,
  type NormalizedWorkoutExerciseSnapshot,
  type NormalizedWorkoutPrescription,
  type NormalizedWorkoutSetSnapshot,
  type WorkoutPrescription as Routine,
  type WorkoutPrescriptionExercise as RoutineExercise,
} from "../src/domain/workout";

const owner = "coverage@example.com";

function validSet(overrides: Partial<RoutineVersionInput["exercises"][number]["sets"][number]> = {}) {
  return {
    position: 1,
    setType: "regular" as const,
    targetType: "reps" as const,
    targetMin: 8,
    targetMax: 10,
    targetDisplay: "8-10 reps",
    targetRirMin: 1,
    targetRirMax: 2,
    restAfterSec: 90,
    restRule: "standard" as const,
    loadInstruction: "",
    sideMode: "bilateral" as const,
    tempo: null,
    notes: "",
    ...overrides,
  };
}

function validRoutineInput(overrides: Partial<RoutineVersionInput> = {}): RoutineVersionInput {
  return {
    focus: "Coverage routine",
    summary: "Covers validation and delegation.",
    durationMin: 45,
    exercises: [{ exerciseId: "exercise-1", position: 1, sets: [validSet()] }],
    ...overrides,
  };
}

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "exercise-1",
    ownerEmail: owner,
    name: "Bench press",
    normalizedName: "bench press",
    equipment: "barbell",
    movementPattern: "push",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "Pause briefly.",
    muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }],
    isFavorite: false,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("entity validators reject every malformed field and normalize valid input", () => {
  assert.throws(() => validateExerciseInput({ name: "" }), /required/);
  assert.throws(() => validateExerciseInput({ name: 1 as unknown as string }), /required/);
  assert.throws(() => validateExerciseInput({ name: "x", trackingType: "distance" as "reps" }), /Tracking type/);
  assert.throws(() => validateExerciseInput({ name: "x", defaultLoadType: "machine" as "external" }), /Load type/);
  assert.throws(() => validateExerciseInput({ name: "x", sideMode: "alternating" as "bilateral" }), /Side mode/);
  for (const weight of [Number.NaN, 0, -0.1, 1.1]) {
    assert.throws(
      () => validateExerciseInput({
        name: "x",
        muscles: [{ muscleGroup: "chest", role: "primary", weight }],
      }),
      /Muscle weights/,
    );
  }
  const normalized = validateExerciseInput({
    name: `  ${"n".repeat(220)}  `,
    equipment: 3 as unknown as string,
    movementPattern: " ",
    instructions: " i ",
  });
  assert.equal(normalized.name.length, 200);
  assert.equal(normalized.equipment, "other");
  assert.equal(normalized.movementPattern, "other");
  assert.equal(normalized.instructions, "i");

  assert.throws(() => validateRoutineVersionInput(validRoutineInput({ focus: "" })), /Routine name/);
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({ exercises: null as unknown as RoutineVersionInput["exercises"] })),
    /at least one exercise/,
  );
  assert.throws(() => validateRoutineVersionInput(validRoutineInput({ exercises: [] })), /at least one exercise/);
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({
      exercises: [{ exerciseId: "one", position: 1.5, sets: [validSet()] }],
    })),
    /positions must be unique positive integers/,
  );
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({
      exercises: [{ exerciseId: "one", position: 0, sets: [validSet()] }],
    })),
    /positions must be unique positive integers/,
  );
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({
      exercises: [{ exerciseId: " ", position: 1, sets: [validSet()] }],
    })),
    /Exercise is required/,
  );
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({
      exercises: [{ exerciseId: "one", position: 1, sets: null as unknown as ReturnType<typeof validSet>[] }],
    })),
    /at least one set/,
  );
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({
      exercises: [{ exerciseId: "one", position: 1, sets: [] }],
    })),
    /at least one set/,
  );
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({
      exercises: [{ exerciseId: "one", position: 1, sets: [validSet(), validSet()] }],
    })),
    /Set positions/,
  );
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({
      exercises: [{ exerciseId: "one", position: 1, sets: [validSet({ position: 1.5 })] }],
    })),
    /Set positions/,
  );
  assert.throws(
    () => validateRoutineVersionInput(validRoutineInput({
      exercises: [{ exerciseId: "one", position: 1, sets: [validSet({ position: 0 })] }],
    })),
    /Set positions/,
  );

  const invalidSetCases: Array<[Partial<ReturnType<typeof validSet>>, RegExp]> = [
    [{ setType: "cluster" as "regular" }, /Set type/],
    [{ targetType: "distance" as "reps" }, /Target type/],
    [{ restRule: "whenever" as "standard" }, /Rest rule/],
    [{ sideMode: "alternating" as "bilateral" }, /side mode/],
    [{ targetDisplay: "" }, /Set target/],
    [{ targetMin: -1 }, /Target minimum/],
    [{ targetMax: Number.NaN }, /Target maximum/],
    [{ targetRirMin: -1 }, /RIR minimum/],
    [{ targetRirMax: Number.POSITIVE_INFINITY }, /RIR maximum/],
    [{ restAfterSec: null as unknown as number }, /Rest is required/],
    [{ restAfterSec: -1 }, /Rest must be a non-negative number/],
    [{ targetMin: 11, targetMax: 10 }, /Target minimum cannot exceed/],
  ];
  for (const [setOverrides, pattern] of invalidSetCases) {
    assert.throws(
      () => validateRoutineVersionInput(validRoutineInput({
        exercises: [{ exerciseId: "one", position: 1, sets: [validSet(setOverrides)] }],
      })),
      pattern,
    );
  }
  for (const durationMin of [Number.NaN, 4, 301]) {
    assert.throws(
      () => validateRoutineVersionInput(validRoutineInput({ durationMin })),
      /between 5 and 300/,
    );
  }
  const cleaned = validateRoutineVersionInput(validRoutineInput({
    focus: "  Name  ",
    summary: 4 as unknown as string,
    durationMin: 44.6,
    exercises: [{ exerciseId: "one", position: 1, sets: [validSet({ targetMin: null, targetMax: null, targetRirMin: null, targetRirMax: null })] }],
  }));
  assert.deepEqual({ focus: cleaned.focus, summary: cleaned.summary, durationMin: cleaned.durationMin }, {
    focus: "Name",
    summary: "",
    durationMin: 45,
  });
});

test("entity services delegate every operation and preserve validation boundaries", async () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const current = exercise();
  const returnValues: Record<string, unknown> = {
    listExercises: [current],
    getExercise: current,
    getExerciseProgress: null,
    createExercise: current,
    updateExercise: current,
    updateExerciseIfUnchanged: current,
    setExerciseFavorite: current,
    archiveExercise: true,
    archiveExerciseIfUnchanged: true,
    listRoutineAggregates: [],
    getRoutineAggregate: null,
    createRoutine: { id: "routine" },
    deleteUnpublishedRoutine: true,
    updateRoutineIdentity: null,
    listRoutineVersions: [],
    getRoutineVersion: null,
    createRoutineVersion: { id: "version" },
    updateRoutineVersion: null,
    deleteRoutineVersion: true,
    publishRoutineVersion: null,
    listWorkouts: [],
    listWorkoutHistory: { workouts: [], hasMore: false, stats: {} },
    getWorkout: null,
    updateWorkout: null,
    archiveWorkout: true,
    discardWorkout: "discarded",
    correctWorkoutSet: null,
  };
  const repository = new Proxy({}, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const name = String(property);
        calls.push({ name, args });
        if (name === "getExercise" && args[1] === "missing") return null;
        return returnValues[name];
      };
    },
  }) as EntityRepository;

  const exercises = new ExerciseService(repository);
  assert.equal((await exercises.list(owner, { search: "bench" })).length, 1);
  assert.equal(await exercises.get(owner, "exercise-1"), current);
  await exercises.progress(owner, "exercise-1");
  await exercises.progress(owner, "exercise-1", { limit: 4, unit: "lb" });
  assert.throws(() => exercises.progress(owner, "exercise-1", { from: "not-a-date" }), /start date/);
  await exercises.create(owner, {
    name: "  Bench press  ",
    muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }],
  });
  assert.equal(await exercises.update(owner, "missing", { name: "x" }), null);
  await exercises.update(owner, "exercise-1", {
    name: "Incline press",
    equipment: "dumbbell",
    movementPattern: "incline push",
    trackingType: "duration",
    defaultLoadType: "bodyweight",
    sideMode: "per_side",
    instructions: "Slowly.",
    muscles: [{ muscleGroup: "shoulders", role: "primary", weight: 1 }],
  });
  await exercises.update(owner, "exercise-1", {});
  await exercises.updateIfUnchanged(owner, "exercise-1", "old", "mutation", { name: "Bench" });
  await exercises.setFavorite(owner, "exercise-1", true);
  await exercises.archive(owner, "exercise-1");
  await exercises.archiveIfUnchanged(owner, "exercise-1", "old");

  const routines = new RoutineService(repository);
  await routines.list(owner);
  await routines.list(owner, true);
  await routines.get(owner, "A");
  await routines.create(owner, " abcdefghijklmnopqrstuvwxyz ", validRoutineInput(), "requested");
  await routines.deleteUnpublished(owner, "A");
  await routines.updateIdentity(owner, "A", {});
  await routines.updateIdentity(owner, "A", { code: " new-code ", isActive: true });
  await routines.archive(owner, "A");
  await routines.listVersions(owner, "A");
  await routines.getVersion(owner, "A", "v1");
  await routines.createVersion(owner, "A", validRoutineInput());
  await routines.updateVersion(owner, "A", "v1", validRoutineInput());
  await routines.deleteVersion(owner, "A", "v1");
  await routines.publish(owner, "A", "v1");
  await routines.publish(owner, "A", "v2", "v1");

  const workouts = new WorkoutService(repository);
  await workouts.list(owner);
  await workouts.list(owner, { status: "Completed" });
  await workouts.history(owner);
  await workouts.history(owner, { status: "Partial", limit: 5 });
  assert.throws(() => workouts.history(owner, { status: "Paused" }), /history status/);
  await workouts.get(owner, "workout");
  await workouts.update(owner, "workout", {});
  await workouts.update(owner, "workout", { bodyWeight: null, notes: ` ${"x".repeat(2100)} `, status: "Completed" });
  assert.throws(() => workouts.update(owner, "workout", { status: "Paused" }), /Workout status/);
  assert.throws(() => workouts.update(owner, "workout", { bodyWeight: Number.NaN }), /Body weight/);
  await workouts.archive(owner, "workout");
  await workouts.discard(owner, "workout");
  const correction: WorkoutSetCorrection = {
    actualReps: 8,
    actualRepsLeft: 8,
    actualRepsRight: 7,
    actualDurationSec: 30,
    actualWeight: 100,
    actualRir: 2,
    actualRestSec: 90,
    status: "completed",
  };
  await workouts.correctSet(owner, "workout", "set", correction);
  await workouts.correctSet(owner, "workout", "set", {});
  assert.throws(() => workouts.correctSet(owner, "workout", "set", { status: "missing" as "completed" }), /set status/);
  for (const field of ["actualReps", "actualRepsLeft", "actualRepsRight", "actualDurationSec", "actualRir", "actualRestSec"] as const) {
    assert.throws(
      () => workouts.correctSet(owner, "workout", "set", { [field]: -1 }),
      /non-negative/,
    );
  }

  const names = new Set(calls.map((call) => call.name));
  for (const expected of Object.keys(returnValues)) assert.ok(names.has(expected), `missing ${expected}`);
  const routineCreate = calls.find((call) => call.name === "createRoutine");
  assert.equal(routineCreate?.args[1], "ABCDEFGHIJKLMNOPQRST");
  const workoutUpdate = calls.filter((call) => call.name === "updateWorkout").at(-1);
  assert.equal((workoutUpdate?.args[2] as { notes?: string }).notes?.length, 2000);
});

test("legacy prescription parsing covers numeric, named, side, target, and rest variants", () => {
  assert.deepEqual(parseRestPrescription("45.6 sec after both"), { seconds: 46, rule: "after_both_sides" });
  assert.deepEqual(parseRestPrescription("1.5 min"), { seconds: 90, rule: "standard" });
  assert.deepEqual(parseRestPrescription("Superset"), { seconds: 0, rule: "after_superset" });
  assert.deepEqual(parseRestPrescription("Start every minute after both"), { seconds: 60, rule: "emom" });
  assert.deepEqual(parseRestPrescription("When ready"), { seconds: 0, rule: "standard" });
  assert.deepEqual(parseRir("No prescribed effort"), { min: null, max: null });
  assert.deepEqual(parseRir("2 RIR"), { min: 2, max: 2 });
  assert.deepEqual(parseRir("1-2 RIR"), { min: 1, max: 2 });

  const sets = expandLegacyPrescription({
    warmup: "20 sec/leg",
    warmupSets: 2,
    regularSets: 1,
    failureSets: 1,
    dropSets: 1,
    target: "30 sec regular; 4 rounds failure; 8-10 per side drop",
    rest: "45 sec after both",
    effort: "2 RIR",
  });
  assert.equal(sets[0]?.targetType, "duration");
  assert.equal(sets[0]?.sideMode, "per_leg");
  assert.equal(sets[1]?.targetDisplay, "20 sec/leg");
  assert.equal(sets[2]?.targetDisplay, "30 sec");
  assert.equal(sets[3]?.targetType, "rounds");
  assert.equal(sets[3]?.restRule, "no_rest_before_drop");
  assert.equal(sets[4]?.sideMode, "per_side");

  const unnamedRegular = expandLegacyPrescription({
    warmup: "None",
    warmupSets: 0,
    regularSets: 1,
    failureSets: 0,
    dropSets: 0,
    target: "6-8; 10 failure",
    rest: "2 min",
    effort: "No RIR",
  });
  assert.equal(unnamedRegular[0]?.targetDisplay, "6-8");
  assert.equal(unnamedRegular[0]?.sideMode, "bilateral");

  const emom = expandLegacyPrescription({
    warmup: "None",
    warmupSets: 0,
    regularSets: 1,
    failureSets: 0,
    dropSets: 0,
    target: "5 rounds emom",
    rest: "Start every minute",
    effort: "1 RIR",
  });
  assert.equal(emom[0]?.setType, "emom");
  assert.equal(emom[0]?.targetDisplay, "5 rounds");

  const unparseable = expandLegacyPrescription({
    warmup: "None",
    warmupSets: 0,
    regularSets: 1,
    failureSets: 0,
    dropSets: 0,
    target: "AMRAP",
    rest: "Whenever ready",
    effort: "Controlled",
  });
  assert.equal(unparseable[0]?.targetMin, null);
  assert.equal(unparseable[0]?.targetMax, null);
});

test("profile and training-profile helpers cover stored, validation, and equipment branches", () => {
  assert.equal(centimetersToInches(2.54), 1);
  assert.equal(inchesToCentimeters(1), 2.54);
  assert.equal(kilogramsToPounds(1), 2.2046226218487757);
  assert.equal(poundsToKilograms(2.2046226218487757), 1);
  assert.deepEqual(centimetersToFeetAndInches(182.88), { feet: 6, inches: 0 });
  assert.equal(feetAndInchesToCentimeters(6, 0), 182.88);

  for (const legacy of [undefined, "", "all"]) {
    assert.deepEqual(parseStoredEquipmentPreferences(legacy), [...equipmentIds]);
  }
  assert.deepEqual(parseStoredEquipmentPreferences("not json"), [...equipmentIds]);
  assert.deepEqual(parseStoredEquipmentPreferences("{}"), [...equipmentIds]);
  assert.deepEqual(parseStoredEquipmentPreferences(["dumbbells", 2]), [...equipmentIds]);
  assert.deepEqual(parseStoredEquipmentPreferences(["bench", "dumbbells", "bench"]), ["dumbbells", "bench"]);

  assert.deepEqual(trainingProfileFromStored({
    equipmentPreferencesJson: "[\"bodyweight\"]",
    preferredWorkoutDurationMin: "30",
    onboardingVersion: 1,
    onboardingCompletedAt: "2026-08-01T00:00:00.000Z",
  }), {
    equipment: ["bodyweight"],
    sessionDurationMin: 30,
    onboardingCompletedAt: "2026-08-01T00:00:00.000Z",
    onboardingCompleted: true,
  });
  assert.deepEqual(trainingProfileFromStored({
    equipmentPreferencesJson: "[\"bodyweight\"]",
    preferredWorkoutDurationMin: "invalid",
    onboardingVersion: "legacy",
    onboardingCompletedAt: "",
  }), {
    equipment: ["bodyweight"],
    sessionDurationMin: 60,
    onboardingCompletedAt: null,
    onboardingCompleted: true,
  });
  assert.equal(trainingProfileFromStored({
    equipmentPreferencesJson: "[\"bodyweight\"]",
    preferredWorkoutDurationMin: 45,
    onboardingVersion: 0,
    onboardingCompletedAt: 123,
  }).onboardingCompleted, false);
  assert.equal(isTrainingProfileComplete({ equipment: ["bodyweight"], sessionDurationMin: 45, onboardingCompletedAt: null, onboardingCompleted: true }), true);
  assert.equal(isTrainingProfileComplete({ equipment: [], sessionDurationMin: 45, onboardingCompletedAt: null, onboardingCompleted: false }), false);

  for (const invalid of [null, "preferences", []]) {
    assert.throws(() => validateTrainingProfileInput(invalid), /JSON object/);
  }
  assert.throws(() => validateTrainingProfileInput({ equipment: ["bodyweight"], sessionDurationMin: 45, surprise: true }), /unsupported/);
  assert.throws(() => validateTrainingProfileInput({ equipment: "bodyweight", sessionDurationMin: 45 }), /at least one/);
  assert.throws(() => validateTrainingProfileInput({ equipment: [1], sessionDurationMin: 45 }), /selection is invalid/);
  assert.deepEqual(validateTrainingProfileInput({ equipment: ["bench", "bodyweight", "bench"], sessionDurationMin: "90" }), {
    equipment: ["bodyweight", "bench"],
    sessionDurationMin: 90,
  });

  assert.equal(equipmentDescription(["barbell", "bodyweight", "barbell"]), "Bodyweight, Barbell");
  assert.equal(equipmentDescription([]), "");
  assert.equal(isExerciseEquipmentAvailable(" BODYWEIGHT ", ["bodyweight"]), true);
  assert.equal(isExerciseEquipmentAvailable("barbell", []), false);
  assert.deepEqual(missingExerciseEquipmentLabels("ez_bar_and_bench", ["ez_bar"]), ["Bench"]);
  assert.deepEqual(missingExerciseEquipmentLabels("dumbbell_or_kettlebell", ["dumbbells"]), []);
  assert.deepEqual(missingExerciseEquipmentLabels("unknown custom", []), []);
  assert.deepEqual(
    missingExerciseEquipmentLabels("dumbbell_or_kettlebell", ["bodyweight"]),
    ["Dumbbells or Kettlebells"],
  );
});

function progressCandidate(overrides: Partial<ExerciseProgressCandidate> = {}): ExerciseProgressCandidate {
  return {
    workoutId: "workout-1",
    routineCode: "A",
    routineTitle: "Routine A",
    workoutStatus: "Completed",
    performedAt: "2026-08-01T00:00:00.000Z",
    setId: "set-1",
    loadType: "external",
    targetType: "reps",
    setType: "regular",
    setPosition: 1,
    actualWeight: 100,
    actualReps: 5,
    actualRepsLeft: null,
    actualRepsRight: null,
    actualDurationSec: null,
    weightUnit: "lb",
    bodyWeight: null,
    bodyWeightUnit: "lb",
    bodyWeightSource: null,
    ...overrides,
  };
}

test("exercise progress rejects ineligible observations and covers metric fallbacks", () => {
  assert.equal(canonicalWeightUnit(" stone "), null);
  assert.equal(canonicalWeightUnit("POUNDS."), "lb");
  assert.equal(convertWeight(10, "lb", "lb"), 10);
  assert.ok(Math.abs(convertWeight(22.046226218, "lb", "kg") - 10) < 1e-8);

  const emptyReps = buildExerciseProgress({ exerciseId: "empty", trackingType: "reps", defaultLoadType: "external", candidates: [], limit: 0 });
  assert.deepEqual(emptyReps.points, []);
  assert.equal(emptyReps.metric, "reps");
  assert.equal(emptyReps.hasMore, false);
  assert.equal(buildExerciseProgress({ exerciseId: "empty", trackingType: "duration", defaultLoadType: "bodyweight", candidates: [], limit: 1 }).metric, "duration");
  assert.equal(buildExerciseProgress({ exerciseId: "empty", trackingType: "rounds", defaultLoadType: "bodyweight", candidates: [], limit: 1 }).metric, "rounds");

  const externalCandidates = [
    progressCandidate({ setId: "wrong-target", setPosition: 1, targetType: "duration" }),
    progressCandidate({ setId: "wrong-load", setPosition: 2, loadType: "bodyweight" }),
    progressCandidate({ setId: "warmup", setPosition: 3, setType: "warmup" }),
    progressCandidate({ setId: "zero-weight", setPosition: 4, actualWeight: 0 }),
    progressCandidate({ setId: "bad-unit", setPosition: 5, weightUnit: "plates" }),
    progressCandidate({ setId: "fractional-reps", setPosition: 6, actualReps: 4.5 }),
    progressCandidate({ setId: "too-many-reps", setPosition: 7, actualReps: 11 }),
    progressCandidate({ setId: "valid", setPosition: 8, actualReps: 5 }),
  ];
  const external = buildExerciseProgress({
    exerciseId: "external",
    trackingType: "reps",
    defaultLoadType: "external",
    candidates: externalCandidates,
    limit: 10,
    unit: "kg",
  });
  assert.equal(external.metric, "epley_estimated_1rm");
  assert.equal(external.unit, "kg");
  assert.deepEqual(external.points.map((point) => point.setId), ["valid"]);

  const totalCandidates = [
    progressCandidate({ setId: "wrong-target", setPosition: 1, loadType: "bodyweight", targetType: "duration", bodyWeight: 180, actualWeight: 0 }),
    progressCandidate({ setId: "external", setPosition: 2, loadType: "external", bodyWeight: 180, actualWeight: 0 }),
    progressCandidate({ setId: "drop", setPosition: 3, loadType: "bodyweight", setType: "drop", bodyWeight: 180, actualWeight: 0 }),
    progressCandidate({ setId: "no-bodyweight", setPosition: 4, loadType: "bodyweight", bodyWeight: null, actualWeight: 0 }),
    progressCandidate({ setId: "bad-body-unit", setPosition: 5, loadType: "bodyweight", bodyWeight: 180, bodyWeightUnit: "stone", actualWeight: 0 }),
    progressCandidate({ setId: "bad-reps", setPosition: 6, loadType: "bodyweight", bodyWeight: 180, actualWeight: 0, actualReps: 20 }),
    progressCandidate({ setId: "missing-added", setPosition: 7, loadType: "bodyweight", bodyWeight: 180, actualWeight: null }),
    progressCandidate({ setId: "bad-added-unit", setPosition: 8, loadType: "bodyweight", bodyWeight: 180, actualWeight: 0, weightUnit: "plates" }),
    progressCandidate({ setId: "over-assisted", setPosition: 9, loadType: "assistance", bodyWeight: 100, actualWeight: 100 }),
    progressCandidate({ setId: "valid", setPosition: 10, loadType: "added", bodyWeight: 180, actualWeight: 10 }),
  ];
  const total = buildExerciseProgress({
    exerciseId: "total",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    candidates: totalCandidates,
    limit: 10,
  });
  assert.equal(total.metric, "epley_estimated_total_load");
  assert.equal(total.unit, "lb");
  assert.deepEqual(total.points.map((point) => point.setId), ["valid"]);

  const duration = buildExerciseProgress({
    exerciseId: "duration",
    trackingType: "duration",
    defaultLoadType: "bodyweight",
    candidates: [
      progressCandidate({ setId: "warmup", setPosition: 1, targetType: "duration", setType: "warmup", actualDurationSec: 30 }),
      progressCandidate({ setId: "drop", setPosition: 2, targetType: "duration", setType: "drop", actualDurationSec: 30 }),
      progressCandidate({ setId: "wrong-target", setPosition: 3, targetType: "reps", actualDurationSec: 30 }),
      progressCandidate({ setId: "zero", setPosition: 4, targetType: "duration", actualDurationSec: 0 }),
      progressCandidate({ setId: "valid", setPosition: 5, targetType: "duration", actualDurationSec: 30 }),
      progressCandidate({ setId: "bad-date", setPosition: 6, targetType: "duration", actualDurationSec: 100, performedAt: "invalid" }),
    ],
    limit: 10,
  });
  assert.deepEqual(duration.points.map((point) => point.setId), ["valid"]);

  const rounds = buildExerciseProgress({
    exerciseId: "rounds",
    trackingType: "rounds",
    defaultLoadType: "bodyweight",
    candidates: [
      progressCandidate({ setId: "unsupported", setPosition: 1, targetType: "rounds", setType: "drop", actualReps: 4 }),
      progressCandidate({ setId: "wrong-target", setPosition: 2, targetType: "reps", setType: "emom", actualReps: 4 }),
      progressCandidate({ setId: "missing", setPosition: 3, targetType: "rounds", setType: "emom", actualReps: null }),
      progressCandidate({ setId: "valid", setPosition: 4, targetType: "rounds", setType: "emom", actualReps: null, actualRepsLeft: 5, actualRepsRight: 4 }),
    ],
    limit: 10,
  });
  assert.deepEqual(rounds.points.map((point) => [point.setId, point.value]), [["valid", 4]]);
});

test("exercise progress deterministically resolves every best-set tie breaker", () => {
  const candidates: ExerciseProgressCandidate[] = [
    progressCandidate({ workoutId: "value", setId: "low", actualReps: 5, loadType: "bodyweight", actualWeight: 0, bodyWeight: null }),
    progressCandidate({ workoutId: "value", setId: "high", setPosition: 2, actualReps: 6, loadType: "bodyweight", actualWeight: 0, bodyWeight: null }),
    progressCandidate({ workoutId: "weight", setId: "light", actualReps: 5, loadType: "bodyweight", actualWeight: 10, bodyWeight: null }),
    progressCandidate({ workoutId: "weight", setId: "heavy", setPosition: 2, actualReps: 5, loadType: "bodyweight", actualWeight: 20, bodyWeight: null }),
    progressCandidate({ workoutId: "position", setId: "later-position", setPosition: 2, actualReps: 5, loadType: "bodyweight", actualWeight: 0, bodyWeight: null }),
    progressCandidate({ workoutId: "position", setId: "earlier-position", setPosition: 1, actualReps: 5, loadType: "bodyweight", actualWeight: 0, bodyWeight: null }),
    progressCandidate({ workoutId: "id", setId: "z", setPosition: 1, actualReps: 5, loadType: "bodyweight", actualWeight: 0, bodyWeight: null }),
    progressCandidate({ workoutId: "id", setId: "a", setPosition: 1, actualReps: 5, loadType: "bodyweight", actualWeight: 0, bodyWeight: null }),
  ];
  const reps = buildExerciseProgress({
    exerciseId: "ties",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    candidates,
    limit: 10,
  });
  assert.deepEqual(Object.fromEntries(reps.points.map((point) => [point.workoutId, point.setId])), {
    id: "a",
    position: "earlier-position",
    value: "high",
    weight: "heavy",
  });

  const effective = buildExerciseProgress({
    exerciseId: "effective",
    trackingType: "reps",
    defaultLoadType: "external",
    candidates: [
      progressCandidate({ workoutId: "same", setId: "100x6", actualWeight: 100, actualReps: 6 }),
      progressCandidate({ workoutId: "same", setId: "112.5x2", setPosition: 2, actualWeight: 112.5, actualReps: 2 }),
    ],
    limit: 10,
  });
  assert.equal(effective.points[0]?.setId, "112.5x2");

  const recordedReps = buildExerciseProgress({
    exerciseId: "recorded-reps",
    trackingType: "reps",
    defaultLoadType: "external",
    candidates: [
      progressCandidate({ workoutId: "same", setId: "five", actualWeight: Number.MIN_VALUE, actualReps: 5 }),
      progressCandidate({ workoutId: "same", setId: "six", actualWeight: Number.MIN_VALUE, actualReps: 6 }),
    ],
    limit: 10,
  });
  assert.equal(recordedReps.points[0]?.setId, "six");

  for (const [exerciseId, candidateOverrides] of [
    ["missing-weight", { actualWeight: null, weightUnit: "lb" }],
    ["unknown-unit", { actualWeight: 0, weightUnit: "unknown" }],
  ] as const) {
    const progress = buildExerciseProgress({
      exerciseId,
      trackingType: "reps",
      defaultLoadType: "bodyweight",
      candidates: [
        progressCandidate({ workoutId: "same", setId: "z", loadType: "bodyweight", bodyWeight: null, ...candidateOverrides }),
        progressCandidate({ workoutId: "same", setId: "a", loadType: "bodyweight", bodyWeight: null, ...candidateOverrides }),
      ],
      limit: 10,
    });
    assert.equal(progress.points[0]?.setId, "a");
  }

  const missingReps = buildExerciseProgress({
    exerciseId: "missing-reps",
    trackingType: "duration",
    defaultLoadType: "bodyweight",
    candidates: [
      progressCandidate({ workoutId: "same", setId: "z", targetType: "duration", actualDurationSec: 30, actualReps: null }),
      progressCandidate({ workoutId: "same", setId: "a", targetType: "duration", actualDurationSec: 30, actualReps: null }),
    ],
    limit: 10,
  });
  assert.equal(missingReps.points[0]?.setId, "a");
});

function legacyExercise(overrides: Partial<RoutineExercise> = {}): RoutineExercise {
  return {
    id: "legacy-1",
    exerciseId: "catalog-1",
    exerciseOrder: 1,
    name: "Row",
    warmup: "Bar x 10",
    warmupSets: 1,
    regularSets: 1,
    failureSets: 0,
    dropSets: 0,
    target: "8-10 reps",
    rest: "90 sec",
    effort: "2 RIR",
    purpose: "Back strength",
    loadType: "external",
    weightUnit: "lb",
    ...overrides,
  };
}

function routineWithExercises(exercises: RoutineExercise[]): Routine {
  return {
    code: "A",
    version: 1,
    focus: "Coverage",
    summary: "Coverage",
    durationMin: 45,
    updatedAt: "2026-08-01T00:00:00.000Z",
    exercises,
  };
}

function normalizedSet(
  sourceRoutineSetId: string,
  overrides: Partial<NormalizedWorkoutSetSnapshot> = {},
): NormalizedWorkoutSetSnapshot {
  return {
    sourceRoutineSetId,
    position: 1,
    setType: "regular",
    targetType: "reps",
    targetMin: 8,
    targetMax: 10,
    targetDisplay: "8-10 reps",
    targetRirMin: 1,
    targetRirMax: 2,
    restAfterSec: 90,
    restRule: "standard",
    loadInstruction: "",
    sideMode: "bilateral",
    tempo: null,
    notes: "",
    ...overrides,
  };
}

function normalizedExercise(
  sourceRoutineExerciseId: string,
  overrides: Partial<NormalizedWorkoutExerciseSnapshot> = {},
): NormalizedWorkoutExerciseSnapshot {
  return {
    sourceRoutineExerciseId,
    exerciseId: `catalog-${sourceRoutineExerciseId}`,
    exerciseName: sourceRoutineExerciseId,
    position: 1,
    supersetGroup: null,
    instructions: "Exercise instructions",
    notes: "Exercise notes",
    loadType: "external",
    sideMode: "bilateral",
    weightUnit: "lb",
    sets: [normalizedSet(`${sourceRoutineExerciseId}-set`)],
    ...overrides,
  };
}

test("guided workout construction covers all legacy parsing and interleaving paths", () => {
  const interleaved = buildGuidedSets(routineWithExercises([
    legacyExercise({
      id: "curl",
      exerciseId: "curl",
      exerciseOrder: 1,
      name: "Barbell Curl",
      warmup: "10 sec; 12 per side",
      warmupSets: 2,
      regularSets: 1,
      failureSets: 1,
      dropSets: 1,
      target: "8-10 regular; 12 failure; 15 drop",
      rest: "90 sec after both",
    }),
    legacyExercise({
      id: "pressdown",
      exerciseId: "pressdown",
      exerciseOrder: 2,
      name: "Cable Triceps Pressdown",
      warmupSets: 0,
      regularSets: 2,
      rest: "Superset",
    }),
    legacyExercise({
      id: "emom",
      exerciseId: "emom",
      exerciseOrder: 3,
      name: "EMOM swings",
      warmupSets: 0,
      regularSets: 1,
      target: "5 rounds emom",
      rest: "Start every minute",
    }),
    legacyExercise({
      id: "minutes",
      exerciseId: "minutes",
      exerciseOrder: 4,
      name: "Minute rest",
      warmupSets: 0,
      target: "6-8; 10 failure",
      rest: "1.5 min",
    }),
    legacyExercise({
      id: "none",
      exerciseId: "none",
      exerciseOrder: 5,
      name: "No parsed rest",
      warmupSets: 0,
      target: "AMRAP",
      rest: "Whenever ready",
    }),
  ]));
  assert.deepEqual(interleaved.slice(0, 4).map((set) => set.exerciseName), [
    "Barbell Curl",
    "Cable Triceps Pressdown",
    "Barbell Curl",
    "Cable Triceps Pressdown",
  ]);
  assert.deepEqual(
    new Set(interleaved.slice(0, 4).map((set) => set.supersetDisplayGroup)),
    new Set(["legacy-curl-pressdown"]),
  );
  assert.ok(interleaved.some((set) => set.restRule === "no_rest_before_drop"));
  assert.ok(interleaved.some((set) => set.restRule === "after_both_sides"));
  assert.ok(interleaved.some((set) => set.restRule === "after_superset"));
  assert.ok(interleaved.some((set) => set.restRule === "emom"));
  assert.ok(interleaved.some((set) => set.targetUnit === "seconds"));
  assert.deepEqual(interleaved.map((set) => set.globalIndex), interleaved.map((_set, index) => index));

  const notAdjacent = buildGuidedSets(routineWithExercises([
    legacyExercise({ name: "Barbell Curl", exerciseOrder: 1 }),
    legacyExercise({ name: "Row", exerciseOrder: 2 }),
    legacyExercise({ name: "Cable Triceps Pressdown", exerciseOrder: 3 }),
  ]));
  assert.deepEqual(notAdjacent.map((set) => set.exerciseName).slice(0, 3), ["Barbell Curl", "Barbell Curl", "Row"]);

  const repeatedWarmup = buildGuidedSets(routineWithExercises([
    legacyExercise({ warmup: "Bar x 10", warmupSets: 2, regularSets: 0 }),
  ]));
  assert.deepEqual(repeatedWarmup.map((set) => set.target), ["Bar x 10", "Bar x 10"]);
});

test("normalized workout construction covers sorting, supersets, targets, rest, and RIR", () => {
  const baseRoutine = routineWithExercises([]);
  assert.equal(getNormalizedWorkoutPrescription(baseRoutine), null);
  assert.equal(getNormalizedWorkoutPrescription({ ...baseRoutine, normalizedPrescription: { schemaVersion: 2, exercises: [] } } as unknown as Routine), null);
  assert.equal(getNormalizedWorkoutPrescription({ ...baseRoutine, normalizedPrescription: { schemaVersion: 1, exercises: null } } as unknown as Routine), null);

  const firstSets = [
    normalizedSet("range", { position: 3, targetRirMin: 1, targetRirMax: 3, restAfterSec: 90, restRule: "after_both_sides" }),
    normalizedSet("both-null", { position: 1, targetType: "duration", targetDisplay: "30 sec", targetRirMin: null, targetRirMax: null, restAfterSec: 60, restRule: "emom", notes: "Set note" }),
    normalizedSet("min-null", { position: 2, targetType: "rounds", targetDisplay: "5 rounds", targetRirMin: null, targetRirMax: 2, restAfterSec: 0, restRule: "after_superset" }),
  ];
  const secondSets = [
    normalizedSet("max-null", { position: 1, setType: "failure", targetRirMin: 1, targetRirMax: null, restAfterSec: 0, restRule: "no_rest_before_drop" }),
    normalizedSet("equal", { position: 2, setType: "failure", targetRirMin: 2, targetRirMax: 2, restAfterSec: 0, restRule: "standard" }),
  ];
  const prescription: NormalizedWorkoutPrescription = {
    schemaVersion: 1,
    routineId: "routine",
    routineVersionId: "version",
    routineVersionNumber: 1,
    exercises: [
      normalizedExercise("ungrouped", {
        position: 3,
        supersetGroup: "  ",
        instructions: "Fallback effort",
        notes: "Fallback purpose",
        sets: [
          normalizedSet("seconds", { restAfterSec: 45, restRule: "standard", targetRirMin: null, targetRirMax: null }),
          normalizedSet("minutes", { position: 2, restAfterSec: 120, restRule: "standard", targetRirMin: null, targetRirMax: null }),
        ],
      }),
      normalizedExercise("second", { position: 2, supersetGroup: "group", sets: secondSets }),
      normalizedExercise("first", { position: 1, supersetGroup: " group ", sets: firstSets }),
    ],
  };
  const routine = { ...baseRoutine, normalizedPrescription: prescription } as Routine & { normalizedPrescription: NormalizedWorkoutPrescription };
  assert.equal(getNormalizedWorkoutPrescription(routine), prescription);
  const sets = buildGuidedSets(routine);
  assert.deepEqual(sets.map((set) => set.id), ["both-null", "max-null", "min-null", "equal", "range", "seconds", "minutes"]);
  assert.deepEqual(sets.slice(0, 3).map((set) => set.targetUnit), ["seconds", "reps", "rounds"]);
  assert.equal(sets.find((set) => set.id === "both-null")?.effort, "Exercise instructions");
  assert.equal(sets.find((set) => set.id === "both-null")?.purpose, "Set note");
  assert.equal(sets.find((set) => set.id === "seconds")?.purpose, "Fallback purpose");
  assert.deepEqual(new Set(sets.map((set) => set.restDisplay)), new Set([
    "Start every minute",
    "No rest before drop",
    "Superset",
    "None",
    "90 sec after both",
    "45 sec",
    "2 min",
  ]));
});

const recommendationNow = new Date("2026-08-08T12:00:00.000Z");

function session(code: string, hoursAgo: number, completedAt?: string): RecentCompletedSession {
  return {
    routineCode: code,
    completedAt: completedAt ?? new Date(recommendationNow.getTime() - hoursAgo * 3_600_000).toISOString(),
  };
}

function loggedSet(
  code: string,
  hoursAgo: number,
  muscles: MuscleWeights,
  setType = "regular",
): RecentCompletedSet {
  return {
    routineCode: code,
    exerciseOrder: 999,
    setType,
    performedAt: new Date(recommendationNow.getTime() - hoursAgo * 3_600_000).toISOString(),
    muscles,
  };
}

test("recommendations cover time decay, muscle labels, invalid history, and remaining summaries", () => {
  const sessions: RecentCompletedSession[] = [
    session("A", 10),
    session("B", 20),
    session("C", 30),
    session("D", 40),
    session("A", 50),
    session("B", 80),
    session("C", 90),
    session("D", 100),
    session("A", 110),
    { routineCode: "Z", completedAt: "invalid" },
  ];
  const sets = [
    loggedSet("A", 0.5, { back: 1 }, "warmup"),
    loggedSet("A", 20, { chest: 1, shoulders: 1 }, "failure"),
    loggedSet("A", 30, { quads: 1, hamstrings: 1, glutes: 1 }, "drop"),
    loggedSet("A", 40, { biceps: 1 }, "regular"),
    loggedSet("A", 60, { triceps: 1 }, "regular"),
    { ...loggedSet("A", 10, { core: 1 }), performedAt: "invalid" },
  ];
  const result = buildRoutineRecommendations(sessions, sets, recommendationNow);
  assert.equal(result.routines.length, 4);
  assert.ok(result.routines.every((routine) => routine.availabilityReason.length > 0));

  const profiles: RoutineProfiles = {
    A: { back: 1 },
    B: { chest: 1, shoulders: 1 },
    C: { quads: 1, hamstrings: 1, glutes: 1 },
    D: { calves: 1 },
  };
  const recentOverlap = buildRoutineRecommendations(
    [],
    [loggedSet("A", 0.5, { back: 6 })],
    recommendationNow,
    profiles,
  );
  assert.match(
    recentOverlap.routines.find((routine) => routine.code === "A")!.availabilityReason,
    /less than an hour ago/,
  );
  const dayOldOverlap = buildRoutineRecommendations(
    [],
    [loggedSet("A", 24, { back: 6 })],
    recommendationNow,
    profiles,
  );
  assert.equal(dayOldOverlap.routines.find((routine) => routine.code === "A")!.availability, "caution");
  const sixDayOldCompletion = buildRoutineRecommendations(
    [session("A", 144)],
    [loggedSet("A", 144, { back: 6 })],
    recommendationNow,
    profiles,
  );
  assert.equal(sixDayOldCompletion.routines.find((routine) => routine.code === "A")!.availability, "available");
  assert.equal(sixDayOldCompletion.recommendationKind, "routine");
  assert.match(sixDayOldCompletion.summary, /past 48 hours/);
  const allMuscles: MuscleWeights = {
    back: 1.32,
    chest: 1.32,
    shoulders: 1.32,
    biceps: 1.32,
    triceps: 1.32,
    quads: 1.32,
    hamstrings: 1.32,
    glutes: 1.32,
    calves: 1.32,
    core: 1.32,
    grip: 1.32,
  };
  const spreadProfiles = Object.fromEntries(
    ["A", "B", "C", "D"].map((code) => [code, Object.fromEntries(
      Object.keys(allMuscles).map((muscle) => [muscle, 1]),
    )]),
  ) as RoutineProfiles;
  const spreadOverlap = buildRoutineRecommendations(
    [],
    [loggedSet("A", 2, allMuscles)],
    recommendationNow,
    spreadProfiles,
  );
  assert.ok(spreadOverlap.routines.some((routine) =>
    /Routine A trained/.test(routine.availabilityReason)));

  const fallbackMetadata = buildRoutineRecommendations(
    [],
    [{
      routineCode: "Z",
      exerciseOrder: 999,
      setType: "regular",
      performedAt: recommendationNow.toISOString(),
    }],
    recommendationNow,
    {
      ...profiles,
      A: { back: undefined, chest: 1 },
    } as unknown as RoutineProfiles,
  );
  assert.equal(fallbackMetadata.routines.length, 4);
  const upperDetour = buildRoutineRecommendations(
    [session("C", 12), session("D", 24)],
    [
      loggedSet("C", 12, { quads: 6, hamstrings: 6, glutes: 6 }),
      loggedSet("A", 2, { back: 6, chest: 6, shoulders: 6 }),
    ],
    recommendationNow,
    profiles,
  );
  assert.equal(upperDetour.recommendedRoutineCode, "D");
  assert.match(upperDetour.summary, /upper-body goal|highest-scoring fit/);

  const lowerBody = buildRoutineRecommendations(
    [session("A", 96)],
    [loggedSet("A", 10, { back: 6, chest: 6, shoulders: 6, calves: 6 })],
    recommendationNow,
    profiles,
  );
  assert.equal(lowerBody.recommendedRoutineCode, "C");
  assert.match(lowerBody.summary, /Lower-body work is due|highest-scoring fit/);

  const balancedFit = buildRoutineRecommendations(
    [session("C", 10)],
    [loggedSet("A", 10, { back: 6, chest: 6, shoulders: 6, calves: 6 })],
    recommendationNow,
    profiles,
  );
  assert.equal(balancedFit.recommendedRoutineCode, "C");
  assert.match(balancedFit.summary, /highest-scoring fit/);
});
