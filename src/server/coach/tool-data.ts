import type { CoachMessageContext } from "../../contracts/api";
import type { Exercise, RoutineAggregate, Workout } from "../../domain/entities";

export function coachPageNumber(value: unknown, fallback: number, maximum: number, minimum = 1) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Page value must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function coachPage<T>(items: readonly T[], limit: number, offset: number, budget = 24_000) {
  const selected: T[] = [];
  let size = 2;
  for (const item of items.slice(offset, offset + limit)) {
    const length = JSON.stringify(item).length + 1;
    if (size + length > budget) {
      if (!selected.length) throw new Error("This record is too large. Request its details with a narrower page.");
      break;
    }
    selected.push(item);
    size += length;
  }
  const nextOffset = offset + selected.length;
  return { items: selected, total: items.length, hasMore: nextOffset < items.length, nextOffset };
}

export function coachExerciseSummary(exercise: Exercise) {
  const { id, name, equipment, movementPattern, trackingType, defaultLoadType, sideMode,
    muscles, isActive, updatedAt } = exercise;
  return { id, name, equipment, movementPattern, trackingType, defaultLoadType, sideMode,
    muscles, isActive, updatedAt };
}

export function coachRoutineSummary(routine: RoutineAggregate) {
  return { id: routine.id, code: routine.code, currentVersionId: routine.currentVersionId,
    name: routine.currentVersion?.focus ?? routine.code,
    durationMin: routine.currentVersion?.durationMin ?? null,
    exerciseCount: routine.currentVersion?.exercises.length ?? 0 };
}

export function coachRoutineDetails(routine: RoutineAggregate, offset = 0, limit = 25) {
  const version = routine.currentVersion;
  if (!version) return { ...coachRoutineSummary(routine), currentVersion: null };
  const exercises = version.exercises.map((exercise) => ({
    id: exercise.id, exerciseId: exercise.exerciseId, exerciseName: exercise.exerciseName,
    position: exercise.position, supersetGroup: exercise.supersetGroup,
    instructions: exercise.instructions, notes: exercise.notes,
    sets: exercise.sets.map(({ ownerEmail: _owner, routineExerciseId: _placement,
      createdAt: _created, updatedAt: _updated, ...set }) => set),
  }));
  const page = coachPage(exercises, limit, offset);
  return { ...coachRoutineSummary(routine), currentVersion: {
    id: version.id, focus: version.focus, summary: version.summary,
    durationMin: version.durationMin, exercises: page.items,
  }, totalExercises: page.total, hasMore: page.hasMore, nextOffset: page.nextOffset };
}

export function coachWorkoutDetails(workout: Workout, offset = 0, limit = 25) {
  const exercises = workout.exercises.map(({ ownerEmail: _owner, workoutId: _workout,
    createdAt: _created, updatedAt: _updated, sets, ...exercise }) => ({ ...exercise,
    sets: sets.map(({ ownerEmail: _setOwner, createdAt: _setCreated, updatedAt: _setUpdated, ...set }) => set),
  }));
  const page = coachPage(exercises, limit, offset);
  return { id: workout.id, routineCode: workout.routineCode, status: workout.status,
    startedAt: workout.startedAt, completedAt: workout.completedAt, weightUnit: workout.weightUnit,
    bodyWeight: workout.bodyWeight, notes: workout.notes, exercises: page.items,
    totalExercises: page.total, hasMore: page.hasMore, nextOffset: page.nextOffset };
}

function contextId(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error("Coach context ID is invalid.");
  return value.trim();
}

export function normalizeCoachMessageContext(value: unknown): CoachMessageContext {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Coach context is invalid.");
  const raw = value as Record<string, unknown>;
  const result: CoachMessageContext = {};
  if (raw.revisePlanId !== undefined) result.revisePlanId = contextId(raw.revisePlanId);
  if (raw.target !== undefined) {
    if (!raw.target || typeof raw.target !== "object" || Array.isArray(raw.target)) throw new Error("Coach target is invalid.");
    const target = raw.target as Record<string, unknown>;
    if (target.kind === "routine") {
      result.target = { kind: "routine", routineId: contextId(target.routineId),
        ...(target.versionId === undefined ? {} : { versionId: contextId(target.versionId) }) };
    } else if (target.kind === "exercise") {
      result.target = { kind: "exercise", exerciseId: contextId(target.exerciseId) };
    } else if (target.kind === "workout") {
      result.target = { kind: "workout", workoutId: contextId(target.workoutId),
        ...(target.viewedSetId === undefined ? {} : { viewedSetId: contextId(target.viewedSetId) }) };
    } else throw new Error("Coach target kind is invalid.");
  }
  return result;
}
