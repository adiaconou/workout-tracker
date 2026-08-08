export const muscleGroups = [
  "back", "chest", "shoulders", "biceps", "triceps",
  "quads", "hamstrings", "glutes", "calves", "core", "grip",
] as const;

export type MuscleGroup = (typeof muscleGroups)[number];
export type MuscleRole = "primary" | "secondary";
export type TrackingType = "reps" | "duration" | "rounds";
export type LoadType = "external" | "bodyweight" | "added" | "assistance";
export type SideMode = "bilateral" | "per_side" | "per_leg" | "left_right";

export type ExerciseMuscle = {
  muscleGroup: MuscleGroup;
  role: MuscleRole;
  weight: number;
};

export type Exercise = {
  id: string;
  ownerEmail: string;
  name: string;
  normalizedName: string;
  equipment: string;
  movementPattern: string;
  trackingType: TrackingType;
  defaultLoadType: LoadType;
  sideMode: SideMode;
  instructions: string;
  muscles: ExerciseMuscle[];
  isFavorite: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExerciseInput = {
  name: string;
  equipment?: string;
  movementPattern?: string;
  trackingType?: TrackingType;
  defaultLoadType?: LoadType;
  sideMode?: SideMode;
  instructions?: string;
  muscles?: ExerciseMuscle[];
};

export type ExerciseProgressMetric =
  | "epley_estimated_1rm"
  | "reps"
  | "duration"
  | "rounds";

export type ExerciseProgressPoint = {
  workoutId: string;
  routineCode: string;
  routineTitle: string;
  workoutStatus: "Completed" | "Partial" | "Abandoned";
  performedAt: string;
  setId: string;
  value: number;
  actualWeight: number | null;
  actualReps: number | null;
  actualDurationSec: number | null;
  weightUnit: string;
};

export type ExerciseProgress = {
  exerciseId: string;
  metric: ExerciseProgressMetric;
  unit: "lb" | "kg" | "reps" | "seconds" | "rounds";
  points: ExerciseProgressPoint[];
  hasMore: boolean;
};

export function normalizeExerciseName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
