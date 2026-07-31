import type { Exercise } from "../../api/types";
import type { Routine } from "../../api/types";

type RoutineExercise = Routine["exercises"][number];

function withCurrentOrder(exercises: RoutineExercise[]) {
  return exercises.map((exercise, index) => ({
    ...exercise,
    exerciseOrder: index + 1,
  }));
}

export function moveRoutineExercise(
  exercises: RoutineExercise[],
  index: number,
  direction: -1 | 1,
) {
  const destination = index + direction;
  if (
    index < 0 ||
    index >= exercises.length ||
    destination < 0 ||
    destination >= exercises.length
  ) {
    return exercises;
  }
  const reordered = [...exercises];
  [reordered[index], reordered[destination]] = [
    reordered[destination],
    reordered[index],
  ];
  return withCurrentOrder(reordered);
}

export function removeRoutineExercise(
  exercises: RoutineExercise[],
  index: number,
) {
  if (exercises.length <= 1 || index < 0 || index >= exercises.length) {
    return exercises;
  }
  return withCurrentOrder(
    exercises.filter((_, exerciseIndex) => exerciseIndex !== index),
  );
}

export function createRoutineExerciseFromLibrary(
  exercise: Exercise,
  exerciseOrder: number,
): RoutineExercise {
  const target =
    exercise.trackingType === "duration"
      ? "30 sec"
      : exercise.trackingType === "rounds"
        ? "3 rounds"
        : "8-12 reps";

  return {
    id: `draft:${exercise.id}`,
    exerciseId: exercise.id,
    exerciseOrder,
    name: exercise.name,
    warmup: "None",
    warmupSets: 0,
    regularSets: 3,
    failureSets: 0,
    dropSets: 0,
    target,
    rest: "90 sec",
    effort: exercise.trackingType === "reps" ? "2 RIR" : "Controlled",
    purpose: exercise.instructions || "Added from your exercise library.",
    loadType: exercise.defaultLoadType,
    weightUnit: "lb",
  };
}
