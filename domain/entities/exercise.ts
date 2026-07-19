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

export function normalizeExerciseName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
