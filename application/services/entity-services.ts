import type {
  EntityRepository,
  ExerciseQuery,
  WorkoutHistoryQuery,
  WorkoutQuery,
} from "../../domain/repositories/entity-repository";
import {
  muscleGroups,
  type ExerciseMuscle,
  type ExerciseInput,
  type RoutineVersionInput,
  type WorkoutSetCorrection,
} from "../../domain/entities";

function cleanRequired(value: unknown, label: string, max = 200) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim().slice(0, max);
}

function cleanOptional(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function assertNonNegative(value: unknown, label: string, nullable = true) {
  if (value === undefined || value === null) {
    if (nullable) return;
    throw new Error(`${label} is required.`);
  }
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${label} must be a non-negative number.`);
}

export function validateExerciseInput(input: ExerciseInput): ExerciseInput {
  const name = cleanRequired(input.name, "Exercise name");
  if (input.trackingType && !["reps", "duration", "rounds"].includes(input.trackingType)) throw new Error("Tracking type is invalid.");
  if (input.defaultLoadType && !["external", "bodyweight", "added", "assistance"].includes(input.defaultLoadType)) throw new Error("Load type is invalid.");
  if (input.sideMode && !["bilateral", "per_side", "per_leg", "left_right"].includes(input.sideMode)) throw new Error("Side mode is invalid.");
  const muscles = (input.muscles ?? []).map((muscle: ExerciseMuscle) => {
    if (!muscleGroups.includes(muscle.muscleGroup)) throw new Error("Muscle group is invalid.");
    if (!["primary", "secondary"].includes(muscle.role)) throw new Error("Muscle role is invalid.");
    if (!Number.isFinite(muscle.weight) || muscle.weight <= 0 || muscle.weight > 1) {
      throw new Error("Muscle weights must be greater than 0 and at most 1.");
    }
    return muscle;
  });
  if (new Set(muscles.map((muscle) => muscle.muscleGroup)).size !== muscles.length) {
    throw new Error("Each muscle group can appear only once per exercise.");
  }
  return {
    ...input,
    name,
    equipment: cleanOptional(input.equipment, 80) || "other",
    movementPattern: cleanOptional(input.movementPattern, 80) || "other",
    instructions: cleanOptional(input.instructions, 1000),
    muscles,
  };
}

export function validateRoutineVersionInput(input: RoutineVersionInput): RoutineVersionInput {
  const focus = cleanRequired(input.focus, "Routine name");
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) throw new Error("A routine needs at least one exercise.");
  const positions = input.exercises.map((exercise) => Number(exercise.position));
  if (new Set(positions).size !== positions.length || positions.some((position) => !Number.isInteger(position) || position < 1)) {
    throw new Error("Routine exercise positions must be unique positive integers.");
  }
  for (const exercise of input.exercises) {
    cleanRequired(exercise.exerciseId, "Exercise");
    if (!Array.isArray(exercise.sets) || exercise.sets.length === 0) throw new Error("Every routine exercise needs at least one set.");
    const setPositions = exercise.sets.map((set) => Number(set.position));
    if (new Set(setPositions).size !== setPositions.length || setPositions.some((position) => !Number.isInteger(position) || position < 1)) {
      throw new Error("Set positions must be unique positive integers within an exercise.");
    }
    exercise.sets.forEach((set) => {
      if (!["warmup", "regular", "failure", "drop", "emom", "test"].includes(set.setType)) throw new Error("Set type is invalid.");
      if (!["reps", "duration", "rounds"].includes(set.targetType)) throw new Error("Target type is invalid.");
      if (!["standard", "after_both_sides", "no_rest_before_drop", "emom", "after_superset"].includes(set.restRule)) throw new Error("Rest rule is invalid.");
      if (!["bilateral", "per_side", "per_leg", "left_right"].includes(set.sideMode)) throw new Error("Set side mode is invalid.");
      cleanRequired(set.targetDisplay, "Set target");
      assertNonNegative(set.targetMin, "Target minimum");
      assertNonNegative(set.targetMax, "Target maximum");
      assertNonNegative(set.targetRirMin, "RIR minimum");
      assertNonNegative(set.targetRirMax, "RIR maximum");
      assertNonNegative(set.restAfterSec, "Rest", false);
      if (set.targetMin !== null && set.targetMax !== null && set.targetMin > set.targetMax) throw new Error("Target minimum cannot exceed target maximum.");
    });
  }
  const durationMin = Math.round(Number(input.durationMin));
  if (!Number.isFinite(durationMin) || durationMin < 5 || durationMin > 300) throw new Error("Duration must be between 5 and 300 minutes.");
  return { ...input, focus, summary: cleanOptional(input.summary, 500), durationMin };
}

export class ExerciseService {
  constructor(private readonly repository: EntityRepository) {}
  list(ownerEmail: string, query?: ExerciseQuery) { return this.repository.listExercises(ownerEmail, query); }
  get(ownerEmail: string, id: string) { return this.repository.getExercise(ownerEmail, id); }
  create(ownerEmail: string, input: ExerciseInput) { return this.repository.createExercise(ownerEmail, validateExerciseInput(input)); }
  async update(ownerEmail: string, id: string, input: Partial<ExerciseInput>) {
    const existing = await this.repository.getExercise(ownerEmail, id);
    if (!existing) return null;
    return this.repository.updateExercise(ownerEmail, id, validateExerciseInput({
      name: input.name ?? existing.name,
      equipment: input.equipment ?? existing.equipment,
      movementPattern: input.movementPattern ?? existing.movementPattern,
      trackingType: input.trackingType ?? existing.trackingType,
      defaultLoadType: input.defaultLoadType ?? existing.defaultLoadType,
      sideMode: input.sideMode ?? existing.sideMode,
      instructions: input.instructions ?? existing.instructions,
      muscles: input.muscles ?? existing.muscles,
    }));
  }
  updateIfUnchanged(
    ownerEmail: string,
    id: string,
    expectedUpdatedAt: string,
    mutationId: string,
    input: ExerciseInput,
  ) {
    return this.repository.updateExerciseIfUnchanged(
      ownerEmail,
      id,
      expectedUpdatedAt,
      mutationId,
      validateExerciseInput(input),
    );
  }
  setFavorite(ownerEmail: string, id: string, isFavorite: boolean) {
    return this.repository.setExerciseFavorite(ownerEmail, id, isFavorite);
  }
  archive(ownerEmail: string, id: string) { return this.repository.archiveExercise(ownerEmail, id); }
  archiveIfUnchanged(ownerEmail: string, id: string, expectedUpdatedAt: string) {
    return this.repository.archiveExerciseIfUnchanged(ownerEmail, id, expectedUpdatedAt);
  }
}

export class RoutineService {
  constructor(private readonly repository: EntityRepository) {}
  list(ownerEmail: string, includeArchived = false) { return this.repository.listRoutineAggregates(ownerEmail, includeArchived); }
  get(ownerEmail: string, idOrCode: string) { return this.repository.getRoutineAggregate(ownerEmail, idOrCode); }
  create(ownerEmail: string, code: string, input: RoutineVersionInput) {
    return this.repository.createRoutine(ownerEmail, cleanRequired(code, "Routine code", 20).toUpperCase(), validateRoutineVersionInput(input));
  }
  updateIdentity(ownerEmail: string, idOrCode: string, input: { code?: string; isActive?: boolean }) {
    if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
      throw new Error("Routine active state must be a boolean.");
    }
    return this.repository.updateRoutineIdentity(ownerEmail, idOrCode, {
      code: input.code === undefined ? undefined : cleanRequired(input.code, "Routine code", 20),
      isActive: input.isActive,
    });
  }
  archive(ownerEmail: string, idOrCode: string) { return this.repository.updateRoutineIdentity(ownerEmail, idOrCode, { isActive: false }); }
  listVersions(ownerEmail: string, idOrCode: string) { return this.repository.listRoutineVersions(ownerEmail, idOrCode); }
  getVersion(ownerEmail: string, idOrCode: string, versionId: string) { return this.repository.getRoutineVersion(ownerEmail, idOrCode, versionId); }
  createVersion(ownerEmail: string, idOrCode: string, input: RoutineVersionInput) {
    return this.repository.createRoutineVersion(ownerEmail, idOrCode, validateRoutineVersionInput(input));
  }
  updateVersion(ownerEmail: string, idOrCode: string, versionId: string, input: RoutineVersionInput) {
    return this.repository.updateRoutineVersion(ownerEmail, idOrCode, versionId, validateRoutineVersionInput(input));
  }
  deleteVersion(ownerEmail: string, idOrCode: string, versionId: string) { return this.repository.deleteRoutineVersion(ownerEmail, idOrCode, versionId); }
  publish(ownerEmail: string, idOrCode: string, versionId: string) { return this.repository.publishRoutineVersion(ownerEmail, idOrCode, versionId); }
}


export class WorkoutService {
  constructor(private readonly repository: EntityRepository) {}
  list(ownerEmail: string, query?: WorkoutQuery) { return this.repository.listWorkouts(ownerEmail, query); }
  history(ownerEmail: string, query?: WorkoutHistoryQuery) {
    if (
      query?.status &&
      !["Completed", "Partial", "Abandoned"].includes(query.status)
    ) {
      throw new Error("Workout history status is invalid.");
    }
    return this.repository.listWorkoutHistory(ownerEmail, query);
  }
  get(ownerEmail: string, id: string) { return this.repository.getWorkout(ownerEmail, id); }
  update(ownerEmail: string, id: string, input: { bodyWeight?: number | null; notes?: string; status?: string }) {
    assertNonNegative(input.bodyWeight, "Body weight");
    if (input.status !== undefined && !["In Progress", "Completed", "Partial", "Abandoned"].includes(input.status)) {
      throw new Error("Workout status is invalid.");
    }
    return this.repository.updateWorkout(ownerEmail, id, { ...input, notes: input.notes === undefined ? undefined : cleanOptional(input.notes, 2000) });
  }
  archive(ownerEmail: string, id: string) { return this.repository.archiveWorkout(ownerEmail, id); }
  discard(ownerEmail: string, id: string) { return this.repository.discardWorkout(ownerEmail, id); }
  correctSet(ownerEmail: string, workoutId: string, setId: string, input: WorkoutSetCorrection) {
    assertNonNegative(input.actualReps, "Reps");
    assertNonNegative(input.actualRepsLeft, "Left reps");
    assertNonNegative(input.actualRepsRight, "Right reps");
    assertNonNegative(input.actualDurationSec, "Duration");
    assertNonNegative(input.actualWeight, "Weight");
    assertNonNegative(input.actualRir, "RIR");
    assertNonNegative(input.actualRestSec, "Rest");
    if (input.status !== undefined && !["planned", "started", "completed", "skipped"].includes(input.status)) {
      throw new Error("Workout set status is invalid.");
    }
    return this.repository.correctWorkoutSet(ownerEmail, workoutId, setId, input);
  }
}
