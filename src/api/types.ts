import type {
  Exercise,
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
  RoutineSummary,
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
