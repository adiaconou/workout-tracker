import assert from "node:assert/strict";
import test from "node:test";
import type { EntityRepository } from "../src/domain/repositories/entity-repository";
import {
  muscleGroups,
  type Exercise,
  type ExerciseMuscle,
  type MuscleGroup,
  type RoutineVersionInput,
} from "../src/domain/entities";
import { expandLegacyPrescription, parseRestPrescription } from "../src/domain/prescription";
import { homeGymExercises } from "../src/domain/home-gym-exercises";
import { legacyRoutineExerciseMuscleTemplates } from "../src/domain/routines";
import {
  validateExerciseInput,
} from "../src/domain/exercises/validation";
import {
  validateRoutineVersionInput,
} from "../src/domain/routines/validation";
import { ExerciseService } from "../src/server/exercises/service";
import { RoutineService } from "../src/server/routines/service";
import { WorkoutService } from "../src/server/workouts/service";

type MuscleCatalogEntry = {
  name: string;
  muscles?: readonly ExerciseMuscle[];
};

const primary = (muscleGroup: MuscleGroup, weight = 1): ExerciseMuscle => ({
  muscleGroup,
  role: "primary",
  weight,
});

const secondary = (muscleGroup: MuscleGroup, weight: number): ExerciseMuscle => ({
  muscleGroup,
  role: "secondary",
  weight,
});

function assertMuscleCatalog(entries: readonly MuscleCatalogEntry[], expectedCount: number) {
  assert.equal(entries.length, expectedCount);
  const names = entries.map((exercise) => exercise.name.trim().toLowerCase());
  assert.equal(new Set(names).size, names.length);
  for (const exercise of entries) {
    const muscles = exercise.muscles ?? [];
    assert.ok(muscles.some((muscle) => muscle.role === "primary"), `${exercise.name} needs a primary muscle`);
    assert.equal(
      new Set(muscles.map((muscle) => muscle.muscleGroup)).size,
      muscles.length,
      `${exercise.name} has a duplicate muscle tag`,
    );
    for (const muscle of muscles) {
      assert.ok(muscleGroups.includes(muscle.muscleGroup), `${exercise.name} has an invalid muscle group`);
      assert.ok(["primary", "secondary"].includes(muscle.role), `${exercise.name} has an invalid muscle role`);
      assert.ok(muscle.weight > 0 && muscle.weight <= 1, `${exercise.name} has an invalid muscle weight`);
    }
  }
}

function musclesFor(entries: readonly MuscleCatalogEntry[], name: string) {
  const exercise = entries.find((candidate) => candidate.name === name);
  assert.ok(exercise, `Missing exercise ${name}`);
  return exercise.muscles ?? [];
}

test("exercise muscle catalogs are exhaustive, valid, and uniquely named", () => {
  assertMuscleCatalog(homeGymExercises, 56);
  assertMuscleCatalog(legacyRoutineExerciseMuscleTemplates, 28);
  for (const exercise of homeGymExercises) assert.doesNotThrow(() => validateExerciseInput(exercise));

  const allNames = [...homeGymExercises, ...legacyRoutineExerciseMuscleTemplates]
    .map((exercise) => exercise.name.trim().toLowerCase());
  assert.equal(new Set(allNames).size, allNames.length);
});

test("home-gym defaults contain the audited muscle corrections", () => {
  assert.deepEqual(musclesFor(homeGymExercises, "Single-arm cable row"), [
    primary("back"), secondary("biceps", 0.4), secondary("grip", 0.2),
  ]);
  assert.deepEqual(musclesFor(homeGymExercises, "Dumbbell pullover"), [
    primary("chest"), secondary("back", 0.4), secondary("triceps", 0.4),
  ]);
  assert.deepEqual(musclesFor(homeGymExercises, "Seated dumbbell overhead triceps extension"), [
    primary("triceps"),
  ]);
  assert.deepEqual(musclesFor(homeGymExercises, "Dumbbell farmer carry"), [
    primary("grip"), secondary("core", 0.7), secondary("back", 0.45),
  ]);
  assert.deepEqual(musclesFor(homeGymExercises, "Dumbbell suitcase carry"), [
    primary("core"), secondary("grip", 0.8), secondary("back", 0.3),
  ]);
  assert.deepEqual(musclesFor(homeGymExercises, "Kettlebell deadlift"), [
    primary("glutes"), secondary("hamstrings", 0.8), secondary("quads", 0.45),
    secondary("back", 0.25), secondary("grip", 0.3),
  ]);
  assert.deepEqual(musclesFor(homeGymExercises, "Single-arm kettlebell clean"), [
    primary("glutes"), secondary("hamstrings", 0.5), secondary("shoulders", 0.4),
    secondary("grip", 0.4), secondary("quads", 0.35), secondary("core", 0.3),
  ]);
  assert.deepEqual(musclesFor(homeGymExercises, "Kettlebell Turkish get-up"), [
    primary("core"), secondary("shoulders", 0.65), secondary("glutes", 0.4),
    secondary("quads", 0.35), secondary("grip", 0.25),
  ]);
  assert.deepEqual(musclesFor(homeGymExercises, "Kettlebell front-rack reverse lunge"), [
    primary("glutes"), secondary("quads", 0.8), secondary("core", 0.4),
    secondary("hamstrings", 0.3),
  ]);
});

test("legacy routine templates contain the audited muscle corrections", () => {
  const expected = new Map<string, ExerciseMuscle[]>([
    ["Chest-supported dumbbell row", [primary("back"), secondary("biceps", 0.5), secondary("grip", 0.25)]],
    ["Dumbbell Romanian deadlift", [primary("hamstrings"), primary("glutes", 0.8), secondary("grip", 0.35)]],
    ["Kettlebell swing", [primary("glutes"), secondary("hamstrings", 0.7), secondary("core", 0.3), secondary("grip", 0.3)]],
    ["Lat pulldown", [primary("back"), secondary("biceps", 0.4), secondary("grip", 0.2)]],
    ["One-arm dumbbell row", [primary("back"), secondary("biceps", 0.5), secondary("grip", 0.25)]],
    ["Seated cable row", [primary("back"), secondary("biceps", 0.4), secondary("grip", 0.2)]],
    ["Side plank", [primary("core"), secondary("shoulders", 0.25)]],
    ["Dumbbell curl", [primary("biceps")]],
    ["Seated cable crunch", [primary("core")]],
  ]);

  for (const [name, muscles] of expected) {
    assert.deepEqual(musclesFor(legacyRoutineExerciseMuscleTemplates, name), muscles);
  }
});

test("expands an exercise prescription into individually addressable sets", () => {
  const sets = expandLegacyPrescription({
    warmup: "Bar×10; 50%×5; 70%×3",
    warmupSets: 3,
    regularSets: 4,
    failureSets: 0,
    dropSets: 0,
    target: "5–7 reps",
    rest: "3 min",
    effort: "1–2 RIR",
  });

  assert.equal(sets.length, 7);
  assert.deepEqual(sets.map((set) => set.position), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(sets[0].setType, "warmup");
  assert.equal(sets[3].setType, "regular");
  assert.equal(sets[3].targetMin, 5);
  assert.equal(sets[3].targetMax, 7);
  assert.equal(sets[3].targetRirMin, 1);
  assert.equal(sets[3].targetRirMax, 2);
  assert.equal(sets[3].restAfterSec, 180);
});

test("models failure-to-drop and specialized rest rules without text-only behavior", () => {
  const sets = expandLegacyPrescription({
    warmup: "None",
    warmupSets: 0,
    regularSets: 2,
    failureSets: 1,
    dropSets: 1,
    target: "12–15 regular; 12–20 failure; 8–12 drop",
    rest: "1 min; no rest before drop",
    effort: "Final set to technical failure",
  });

  assert.equal(sets[2].setType, "failure");
  assert.equal(sets[2].restAfterSec, 0);
  assert.equal(sets[2].restRule, "no_rest_before_drop");
  assert.equal(sets[3].setType, "drop");
  assert.deepEqual(parseRestPrescription("90 sec after both"), { seconds: 90, rule: "after_both_sides" });
  assert.deepEqual(parseRestPrescription("Start every minute"), { seconds: 60, rule: "emom" });
});

test("validates exercise muscle metadata and routine ordering", () => {
  assert.throws(() => validateExerciseInput({
    name: "Bench press",
    muscles: [
      { muscleGroup: "chest", role: "primary", weight: 1 },
      { muscleGroup: "chest", role: "secondary", weight: 0.4 },
    ],
  }), /only once/);

  assert.throws(() => validateExerciseInput({
    name: "Invalid muscle",
    muscles: [{ muscleGroup: "neck" as "chest", role: "primary", weight: 1 }],
  }), /Muscle group is invalid/);

  assert.throws(() => validateExerciseInput({
    name: "Invalid role",
    muscles: [{ muscleGroup: "chest", role: "tertiary" as "primary", weight: 1 }],
  }), /Muscle role is invalid/);

  assert.throws(() => validateRoutineVersionInput({
    focus: "Duplicate order",
    summary: "",
    durationMin: 60,
    exercises: [
      { exerciseId: "one", position: 1, sets: [] },
      { exerciseId: "two", position: 1, sets: [] },
    ],
  }), /positions must be unique/);

  const validRoutine: RoutineVersionInput = {
    focus: "Validation",
    summary: "Set validation",
    durationMin: 45,
    exercises: [{
      exerciseId: "one",
      position: 1,
      sets: [{
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
      }],
    }],
  };
  assert.doesNotThrow(() => validateRoutineVersionInput(validRoutine));
  assert.throws(() => validateRoutineVersionInput({
    ...validRoutine,
    exercises: [{
      ...validRoutine.exercises[0],
      sets: [{ ...validRoutine.exercises[0]!.sets[0]!, targetRirMin: 3, targetRirMax: 2 }],
    }],
  }), /RIR minimum cannot exceed RIR maximum/);
  assert.throws(() => validateRoutineVersionInput({
    ...validRoutine,
    exercises: [{
      ...validRoutine.exercises[0],
      sets: [{ ...validRoutine.exercises[0]!.sets[0]!, restAfterSec: 30.5 }],
    }],
  }), /Rest must be a non-negative whole number/);
});

test("exercise service performs catalog CRUD through the repository boundary", async () => {
  let stored: Exercise | null = null;
  const repository = {
    async createExercise(ownerEmail: string, input: Parameters<EntityRepository["createExercise"]>[1]) {
      stored = {
        id: "exercise-1", ownerEmail, name: input.name, normalizedName: input.name.toLowerCase(),
        equipment: input.equipment ?? "other", movementPattern: input.movementPattern ?? "other",
        trackingType: input.trackingType ?? "reps", defaultLoadType: input.defaultLoadType ?? "external",
        sideMode: input.sideMode ?? "bilateral", instructions: input.instructions ?? "",
        muscles: input.muscles ?? [], isFavorite: false, isActive: true, createdAt: "now", updatedAt: "now",
      };
      return stored;
    },
    async setExerciseFavorite(_ownerEmail: string, id: string, isFavorite: boolean) {
      if (!stored || stored.id !== id) return null;
      stored = { ...stored, isFavorite };
      return stored;
    },
    async getExercise(_ownerEmail: string, id: string) { return stored?.id === id ? stored : null; },
    async updateExercise(_ownerEmail: string, id: string, input: Parameters<EntityRepository["updateExercise"]>[2]) {
      if (!stored || stored.id !== id) return null;
      stored = { ...stored, ...input, normalizedName: (input.name ?? stored.name).toLowerCase() } as Exercise;
      return stored;
    },
    async archiveExercise(_ownerEmail: string, id: string) { if (!stored || stored.id !== id) return false; stored = { ...stored, isActive: false }; return true; },
    async listExercises() { return stored ? [stored] : []; },
  } as unknown as EntityRepository;
  const service = new ExerciseService(repository);

  const created = await service.create("owner@example.com", {
    name: "  Barbell Bench Press  ",
    equipment: "barbell",
    muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }],
  });
  assert.equal(created.name, "Barbell Bench Press");
  assert.equal((await service.list("owner@example.com")).length, 1);
  assert.equal((await service.update("owner@example.com", created.id, { instructions: "Pause on the chest." }))?.instructions, "Pause on the chest.");
  assert.equal((await service.setFavorite("owner@example.com", created.id, true))?.isFavorite, true);
  assert.equal(await service.archive("owner@example.com", created.id), true);
  assert.equal((await service.get("owner@example.com", created.id))?.isActive, false);
});

test("exercise service requires a primary muscle only when creating a new exercise", async () => {
  let stored: Exercise | null = null;
  let createCalls = 0;
  const repository = {
    async createExercise(ownerEmail: string, input: Parameters<EntityRepository["createExercise"]>[1]) {
      createCalls += 1;
      stored = {
        id: "exercise-new", ownerEmail, name: input.name, normalizedName: input.name.toLowerCase(),
        equipment: input.equipment ?? "other", movementPattern: input.movementPattern ?? "other",
        trackingType: input.trackingType ?? "reps", defaultLoadType: input.defaultLoadType ?? "external",
        sideMode: input.sideMode ?? "bilateral", instructions: input.instructions ?? "",
        muscles: input.muscles ?? [], isFavorite: false, isActive: true, createdAt: "now", updatedAt: "now",
      };
      return stored;
    },
    async getExercise() { return stored; },
    async updateExercise(_ownerEmail: string, _id: string, input: Parameters<EntityRepository["updateExercise"]>[2]) {
      stored = { ...stored!, ...input, normalizedName: (input.name ?? stored!.name).toLowerCase() };
      return stored;
    },
  } as unknown as EntityRepository;
  const service = new ExerciseService(repository);

  assert.throws(
    () => service.create("owner@example.com", { name: "Untagged movement" }),
    /primary muscle is required/i,
  );
  assert.throws(
    () => service.create("owner@example.com", {
      name: "Secondary-only movement",
      muscles: [{ muscleGroup: "triceps", role: "secondary", weight: 0.5 }],
    }),
    /primary muscle is required/i,
  );
  assert.equal(createCalls, 0, "invalid new exercises must not reach persistence");

  const created = await service.create("owner@example.com", {
    name: "Tagged movement",
    muscles: [
      { muscleGroup: "chest", role: "primary", weight: 1 },
      { muscleGroup: "triceps", role: "secondary", weight: 0.5 },
    ],
  });
  assert.equal(createCalls, 1);
  assert.equal(created.muscles.length, 2, "secondary muscle tags remain optional additions");

  stored = { ...created, id: "exercise-legacy", muscles: [] };
  const updatedLegacy = await service.update("owner@example.com", stored.id, {
    instructions: "Keep the legacy row editable.",
  });
  assert.deepEqual(updatedLegacy?.muscles, []);
  assert.equal(updatedLegacy?.instructions, "Keep the legacy row editable.");
});

test("exercise progress validates units and normalizes the requested start date", async () => {
  let receivedQuery: Parameters<EntityRepository["getExerciseProgress"]>[2];
  const repository = {
    async getExerciseProgress(
      _ownerEmail: string,
      _id: string,
      query: Parameters<EntityRepository["getExerciseProgress"]>[2],
    ) {
      receivedQuery = query;
      return null;
    },
  } as unknown as EntityRepository;
  const service = new ExerciseService(repository);

  await service.progress("owner@example.com", "exercise-1", {
    from: "2026-08-01T12:30:00-07:00",
    unit: "kg",
  });
  assert.deepEqual(receivedQuery!, {
    from: "2026-08-01T19:30:00.000Z",
    unit: "kg",
  });
  assert.throws(
    () => service.progress("owner@example.com", "exercise-1", {
      unit: "stone" as "kg",
    }),
    /must be lb or kg/,
  );
});

test("workout corrections reject invalid performance values before persistence", async () => {
  const service = new WorkoutService({} as EntityRepository);
  assert.throws(() => service.correctSet("owner@example.com", "workout", "set", { actualWeight: -1 }), /non-negative/);
  assert.throws(() => service.update("owner@example.com", "workout", { bodyWeight: -180 }), /non-negative/);
});

test("routine service rejects non-boolean active-state payloads", () => {
  const service = new RoutineService({} as EntityRepository);
  assert.throws(
    () => service.updateIdentity("owner@example.com", "A", { isActive: 1 as unknown as boolean }),
    /must be a boolean/,
  );
  assert.throws(
    () => service.updateIdentity("owner@example.com", "A", { isActive: "1" as unknown as boolean }),
    /must be a boolean/,
  );
});
