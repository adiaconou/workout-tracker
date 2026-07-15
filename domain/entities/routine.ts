import type { SideMode } from "./exercise";

export type Routine = {
  id: string;
  ownerEmail: string;
  code: string;
  currentVersionId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RoutineVersionStatus = "draft" | "published" | "superseded";
export type RoutineSetType = "warmup" | "regular" | "failure" | "drop" | "emom" | "test";
export type TargetType = "reps" | "duration" | "rounds";
export type RestRule = "standard" | "after_both_sides" | "no_rest_before_drop" | "emom" | "after_superset";

export type RoutineSet = {
  id: string;
  ownerEmail: string;
  routineExerciseId: string;
  position: number;
  setType: RoutineSetType;
  targetType: TargetType;
  targetMin: number | null;
  targetMax: number | null;
  targetDisplay: string;
  targetRirMin: number | null;
  targetRirMax: number | null;
  restAfterSec: number;
  restRule: RestRule;
  loadInstruction: string;
  sideMode: SideMode;
  tempo: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type RoutineExercise = {
  id: string;
  ownerEmail: string;
  routineVersionId: string;
  exerciseId: string;
  exerciseName: string;
  position: number;
  supersetGroup: string | null;
  instructions: string;
  notes: string;
  sets: RoutineSet[];
  createdAt: string;
  updatedAt: string;
};

export type RoutineVersion = {
  id: string;
  ownerEmail: string;
  routineId: string;
  versionNumber: number;
  status: RoutineVersionStatus;
  focus: string;
  summary: string;
  durationMin: number;
  exercises: RoutineExercise[];
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
};

export type RoutineAggregate = Routine & {
  currentVersion: RoutineVersion | null;
};

export type RoutineSetInput = Omit<RoutineSet, "id" | "ownerEmail" | "routineExerciseId" | "createdAt" | "updatedAt">;
export type RoutineExerciseInput = {
  exerciseId: string;
  position: number;
  supersetGroup?: string | null;
  instructions?: string;
  notes?: string;
  sets: RoutineSetInput[];
};
export type RoutineVersionInput = {
  focus: string;
  summary: string;
  durationMin: number;
  exercises: RoutineExerciseInput[];
};

