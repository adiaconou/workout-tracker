import type {
  Exercise,
  ExerciseProgress,
  RoutineProgram,
  RoutineProgramCreateInput,
  RoutineProgramMembership,
  RoutineAggregate,
  RoutineExercise,
  RoutineExerciseInput,
  RoutineSet,
  RoutineSetInput,
  RoutineVersion,
  RoutineVersionInput,
  Workout,
  WorkoutHistoryPage,
} from "../domain/entities";
import type { RecommendationResult } from "../domain/recommendations";
import type { MeasurementSystem, UserProfile, UserProfilePatch } from "../domain/profile";
import type {
  EquipmentId,
  TrainingProfile,
  TrainingProfileInput,
  WorkoutDurationMinutes,
} from "../domain/training-profile";
import type {
  GuidedSet,
  WorkoutPrescription,
  WorkoutPrescriptionExercise,
} from "../domain/workout";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  trainingProfile: TrainingProfile;
};

export type NativeSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
};

export type PreviousExerciseSet = {
  setNumber: number;
  sourceRoutineSetId?: string | null;
  setType: string;
  targetType?: string;
  loadType?: string;
  actualWeight: number | null;
  actualReps: number | null;
  actualDurationSec: number | null;
  weightUnit: string;
  status: string;
};

export type PreviousExercisePerformance = {
  workoutId: string;
  performedAt: string;
  sets: PreviousExerciseSet[];
};

export type RoutineSummary = Omit<WorkoutPrescription, "exercises"> & {
  exerciseCount: number;
  setCount: number;
  lastWorkoutAt: string | null;
  averageDurationSeconds: number | null;
  durationSampleCount: number;
};

export type RecordedSetPerformance = {
  status: "Completed" | "Skipped";
  actualWeight: number | null;
  actualReps: number | null;
  actualDurationSec: number | null;
  weightUnit: string;
};

export type WorkoutView = {
  id: string;
  routineCode: string;
  routineVersion: number;
  status: string;
  currentExercise: number;
  currentSet: number;
  completedSets: number;
  skippedSets: number;
  totalSets: number;
  restEndsAt: string | null;
  lastPerformanceId: string | null;
  startedAt: string;
  completedAt: string | null;
  bodyWeight: number | null;
  bodyWeightSource: string | null;
  weightUnit: string;
  routine: WorkoutPrescription;
  sets: GuidedSet[];
  currentSetIndex: number;
  currentRestSeconds: number;
  workoutElapsedSeconds: number;
  currentSetElapsedSeconds: number;
  previousPerformanceByExercise: Record<number, PreviousExercisePerformance>;
  recordedPerformanceBySetId: Record<string, RecordedSetPerformance>;
  lastCompletedSetByExercise: Record<number, {
    actualWeight: number;
    actualReps: number | null;
  }>;
};

export type BootstrapPayload = {
  user: SessionUser;
  routines: RoutineSummary[];
  recommendations: RecommendationResult;
  activeWorkout: WorkoutView | null;
};

export type {
  Exercise,
  ExerciseProgress,
  RoutineProgram,
  RoutineProgramCreateInput,
  RoutineProgramMembership,
  RoutineAggregate,
  RoutineExercise,
  RoutineExerciseInput,
  RoutineSet,
  RoutineSetInput,
  RoutineVersion,
  RoutineVersionInput,
  WorkoutPrescription,
  WorkoutPrescriptionExercise,
  Workout,
  WorkoutHistoryPage,
  MeasurementSystem,
  UserProfile,
  UserProfilePatch,
  EquipmentId,
  TrainingProfile,
  TrainingProfileInput,
  WorkoutDurationMinutes,
};

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  } | string;
};
