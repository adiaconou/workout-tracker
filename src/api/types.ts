import type {
  Exercise,
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
};

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  } | string;
};
