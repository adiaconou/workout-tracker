import type { GuidedSet } from "../../../lib/workout";

export type ExerciseProgressStatus =
  | "completed"
  | "current"
  | "in_progress"
  | "upcoming";

export type ExerciseProgress = {
  exerciseOrder: number;
  exerciseName: string;
  completedSets: number;
  totalSets: number;
  remainingSets: number;
  restLabel: string;
  status: ExerciseProgressStatus;
};

function restLabel(sets: GuidedSet[]) {
  const display = sets[0]?.restDisplay.trim();
  if (!display || display.toLowerCase() === "none") return "No programmed rest";
  if (
    display.toLowerCase().startsWith("start every") ||
    display.toLowerCase() === "superset"
  ) {
    return display;
  }
  return `Rest ${display}`;
}

export function buildWorkoutExerciseProgress(
  sets: GuidedSet[],
  currentSetIndex: number,
) {
  const byExercise = new Map<number, GuidedSet[]>();
  for (const set of sets) {
    const exerciseSets = byExercise.get(set.exerciseOrder) ?? [];
    exerciseSets.push(set);
    byExercise.set(set.exerciseOrder, exerciseSets);
  }

  return [...byExercise.entries()]
    .sort(([left], [right]) => left - right)
    .map(([exerciseOrder, exerciseSets]): ExerciseProgress => {
      const completedSets = exerciseSets.filter(
        (set) => set.globalIndex < currentSetIndex,
      ).length;
      const totalSets = exerciseSets.length;
      const isCurrent = exerciseSets.some(
        (set) => set.globalIndex === currentSetIndex,
      );
      const status: ExerciseProgressStatus =
        completedSets === totalSets
          ? "completed"
          : isCurrent
            ? "current"
            : completedSets > 0
              ? "in_progress"
              : "upcoming";

      return {
        exerciseOrder,
        exerciseName: exerciseSets[0].exerciseName,
        completedSets,
        totalSets,
        remainingSets: totalSets - completedSets,
        restLabel: restLabel(exerciseSets),
        status,
      };
    });
}
