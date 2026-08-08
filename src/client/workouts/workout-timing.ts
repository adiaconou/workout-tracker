import type { WorkoutSet } from "../../domain/entities";
import type { Workout } from "../../contracts/api";

export type WorkoutSetTimingSummary = {
  id: string;
  position: number;
  status: WorkoutSet["status"];
  elapsedSeconds: number | null;
  restSeconds: number | null;
};

export type WorkoutExerciseTimingSummary = {
  id: string;
  name: string;
  position: number;
  elapsedSeconds: number | null;
  completedSets: number;
  skippedSets: number;
  totalSets: number;
  sets: WorkoutSetTimingSummary[];
};

export type WorkoutTimingSummary = {
  elapsedSeconds: number;
  completedSets: number;
  skippedSets: number;
  totalSets: number;
  completedExercises: number;
  totalExercises: number;
  exercises: WorkoutExerciseTimingSummary[];
};

function safeSeconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function secondsBetween(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return null;
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  return Math.max(0, Math.round((completed - started) / 1000));
}

export function formatElapsedDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remainder || parts.length === 0) parts.push(`${remainder}s`);
  return parts.join(" ");
}

function setElapsedSeconds(set: WorkoutSet) {
  return safeSeconds(set.elapsedSeconds) ?? secondsBetween(set.startedAt, set.completedAt);
}

export function summarizeWorkoutTiming(workout: Workout): WorkoutTimingSummary {
  const exercises = workout.exercises.map((exercise): WorkoutExerciseTimingSummary => {
    const sets = exercise.sets.map((set): WorkoutSetTimingSummary => ({
      id: set.id,
      position: set.position,
      status: set.status,
      elapsedSeconds: setElapsedSeconds(set),
      restSeconds: safeSeconds(set.actualRestSec),
    }));
    const timedIntervals = exercise.sets.flatMap((set) => {
      const started = set.startedAt ? Date.parse(set.startedAt) : Number.NaN;
      const completed = set.completedAt ? Date.parse(set.completedAt) : Number.NaN;
      return Number.isFinite(started) && Number.isFinite(completed)
        ? [{ started, completed }]
        : [];
    });
    const timestampElapsed = timedIntervals.length
      ? Math.max(0, Math.round((
        Math.max(...timedIntervals.map((interval) => interval.completed)) -
        Math.min(...timedIntervals.map((interval) => interval.started))
      ) / 1000))
      : null;
    const knownSetElapsed = sets
      .map((set) => set.elapsedSeconds)
      .filter((value): value is number => value !== null);
    const completedSets = sets.filter((set) => set.status === "completed").length;
    const skippedSets = sets.filter((set) => set.status === "skipped").length;

    return {
      id: exercise.id,
      name: exercise.exerciseNameSnapshot,
      position: exercise.position,
      elapsedSeconds: timestampElapsed ?? (
        knownSetElapsed.length ? knownSetElapsed.reduce((total, value) => total + value, 0) : null
      ),
      completedSets,
      skippedSets,
      totalSets: sets.length,
      sets,
    };
  });
  const completedSets = exercises.reduce((total, exercise) => total + exercise.completedSets, 0);
  const skippedSets = exercises.reduce((total, exercise) => total + exercise.skippedSets, 0);
  const sessionElapsed = secondsBetween(workout.startedAt, workout.completedAt);

  return {
    elapsedSeconds: sessionElapsed ?? 0,
    completedSets,
    skippedSets,
    totalSets: exercises.reduce((total, exercise) => total + exercise.totalSets, 0),
    completedExercises: exercises.filter(
      (exercise) => exercise.totalSets > 0 && exercise.completedSets + exercise.skippedSets === exercise.totalSets,
    ).length,
    totalExercises: exercises.length,
    exercises,
  };
}
