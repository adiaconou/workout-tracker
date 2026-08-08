import type {
  Exercise,
  ExerciseProgress,
  RoutineAggregate,
  RoutineExercise,
  RoutineExerciseInput,
  RoutineSet,
  RoutineSetInput,
  RoutineVersion,
  RoutineVersionInput,
  Workout,
  WorkoutHistoryPage,
} from "../../domain/entities";
import type { RecommendationResult } from "../../lib/recommendations";
import type { MeasurementSystem, UserProfile, UserProfilePatch } from "../../domain/profile";
import type {
  EquipmentId,
  TrainingProfile,
  TrainingProfileInput,
  WorkoutDurationMinutes,
} from "../../domain/training-profile";
import type {
  PreviousExercisePerformance,
  Routine,
  RoutineSummary,
  WorkoutView,
} from "../../lib/store";

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

export type BootstrapPayload = {
  user: SessionUser;
  routines: RoutineSummary[];
  recommendations: RecommendationResult;
  activeWorkout: WorkoutView | null;
};

export type {
  Exercise,
  ExerciseProgress,
  PreviousExercisePerformance,
  Routine,
  RoutineAggregate,
  RoutineExercise,
  RoutineExerciseInput,
  RoutineSet,
  RoutineSetInput,
  RoutineSummary,
  RoutineVersion,
  RoutineVersionInput,
  Workout,
  WorkoutHistoryPage,
  WorkoutView,
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
