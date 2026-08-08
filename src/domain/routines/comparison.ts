import type { RoutineVersion, RoutineVersionInput } from "../entities";

export function isRoutineVersionSemanticallyEqual(
  current: RoutineVersion,
  proposed: RoutineVersionInput,
) {
  return JSON.stringify(routineVersionSnapshot(current)) === JSON.stringify(routineVersionSnapshot(proposed));
}

function routineVersionSnapshot(value: RoutineVersion | RoutineVersionInput) {
  return {
    focus: value.focus,
    summary: value.summary,
    durationMin: value.durationMin,
    exercises: sortedByPosition(value.exercises).map((exercise) => ({
      exerciseId: exercise.exerciseId,
      position: exercise.position,
      supersetGroup: exercise.supersetGroup ?? null,
      instructions: exercise.instructions ?? "",
      notes: exercise.notes ?? "",
      sets: sortedByPosition(exercise.sets).map((set) => ({
        position: set.position,
        setType: set.setType,
        targetType: set.targetType,
        targetMin: set.targetMin ?? null,
        targetMax: set.targetMax ?? null,
        targetDisplay: set.targetDisplay,
        targetRirMin: set.targetRirMin ?? null,
        targetRirMax: set.targetRirMax ?? null,
        restAfterSec: set.restAfterSec,
        restRule: set.restRule,
        loadInstruction: set.loadInstruction ?? "",
        sideMode: set.sideMode,
        tempo: set.tempo ?? null,
        notes: set.notes ?? "",
      })),
    })),
  };
}

function sortedByPosition<T extends { position: number }>(values: T[]) {
  return [...values].sort((left, right) => left.position - right.position);
}
