import type { LoadType, SideMode } from "./exercise";
import type { RestRule, RoutineSetType, TargetType } from "./routine";

export type WorkoutStatus = "In Progress" | "Completed" | "Partial" | "Abandoned";
export type WorkoutItemStatus = "planned" | "started" | "completed" | "skipped";

export type WorkoutSet = {
  id: string;
  ownerEmail: string;
  workoutId: string;
  workoutExerciseId: string;
  sourceRoutineSetId: string | null;
  prescribedSetId: string;
  position: number;
  setType: RoutineSetType;
  plannedTargetType: TargetType;
  plannedTargetMin: number | null;
  plannedTargetMax: number | null;
  plannedTargetDisplay: string;
  plannedRirMin: number | null;
  plannedRirMax: number | null;
  plannedRestSec: number;
  plannedRestRule: RestRule;
  actualReps: number | null;
  actualRepsLeft: number | null;
  actualRepsRight: number | null;
  actualDurationSec: number | null;
  actualWeight: number | null;
  weightUnit: string;
  actualRir: number | null;
  actualRestSec: number | null;
  restStartedAt: string | null;
  restEndedAt: string | null;
  restSkipped: boolean;
  status: WorkoutItemStatus;
  completedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkoutExercise = {
  id: string;
  ownerEmail: string;
  workoutId: string;
  exerciseId: string;
  sourceRoutineExerciseId: string | null;
  position: number;
  exerciseNameSnapshot: string;
  loadTypeSnapshot: LoadType;
  sideModeSnapshot: SideMode;
  status: WorkoutItemStatus;
  notes: string;
  sets: WorkoutSet[];
  createdAt: string;
  updatedAt: string;
};

export type Workout = {
  id: string;
  ownerEmail: string;
  routineId: string | null;
  routineVersionId: string | null;
  routineCode: string;
  status: WorkoutStatus;
  startedAt: string;
  completedAt: string | null;
  bodyWeight: number | null;
  weightUnit: string;
  notes: string;
  isArchived: boolean;
  exercises: WorkoutExercise[];
  updatedAt: string;
};

export type WorkoutSetCorrection = Partial<Pick<WorkoutSet,
  "actualReps" | "actualRepsLeft" | "actualRepsRight" | "actualDurationSec" |
  "actualWeight" | "actualRir" | "actualRestSec" | "restSkipped" | "notes" | "status"
>>;

