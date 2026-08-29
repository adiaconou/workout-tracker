import type {
  Exercise,
  ExerciseInput,
  ExerciseProgress,
  MuscleGroup,
  Routine,
  RoutineAggregate,
  RoutineVersion,
  RoutineVersionInput,
  Workout,
  WorkoutHistoryPage,
  WorkoutSetCorrection,
} from "../entities";

export type ExerciseQuery = {
  includeArchived?: boolean;
  search?: string;
  availableOnly?: boolean;
  muscleGroup?: MuscleGroup;
  movementPattern?: Exercise["movementPattern"];
};
export type ExerciseProgressQuery = {
  from?: string;
  limit?: number;
  unit?: "lb" | "kg";
};
export type WorkoutQuery = { includeArchived?: boolean; status?: string };
export type WorkoutDiscardResult = "discarded" | "not_found" | "not_in_progress";
export type WorkoutHistoryQuery = {
  from?: string;
  to?: string;
  routineCode?: string;
  status?: string;
  exerciseSearch?: string;
  limit?: number;
  offset?: number;
};

export interface ExerciseRepository {
  listExercises(ownerEmail: string, query?: ExerciseQuery): Promise<Exercise[]>;
  getExercise(ownerEmail: string, id: string): Promise<Exercise | null>;
  getExerciseProgress(ownerEmail: string, id: string, query?: ExerciseProgressQuery): Promise<ExerciseProgress | null>;
  createExercise(ownerEmail: string, input: ExerciseInput): Promise<Exercise>;
  updateExercise(ownerEmail: string, id: string, input: Partial<ExerciseInput>): Promise<Exercise | null>;
  updateExerciseIfUnchanged(
    ownerEmail: string,
    id: string,
    expectedUpdatedAt: string,
    mutationId: string,
    input: ExerciseInput,
  ): Promise<Exercise | null>;
  setExerciseFavorite(ownerEmail: string, id: string, isFavorite: boolean): Promise<Exercise | null>;
  archiveExercise(ownerEmail: string, id: string): Promise<boolean>;
  archiveExerciseIfUnchanged(ownerEmail: string, id: string, expectedUpdatedAt: string): Promise<boolean>;
}

export interface RoutineRepository {
  listRoutineAggregates(ownerEmail: string, includeArchived?: boolean): Promise<RoutineAggregate[]>;
  getRoutineAggregate(ownerEmail: string, idOrCode: string): Promise<RoutineAggregate | null>;
  createRoutine(ownerEmail: string, code: string, input: RoutineVersionInput, requestedId?: string): Promise<RoutineAggregate>;
  deleteUnpublishedRoutine(ownerEmail: string, idOrCode: string): Promise<boolean>;
  updateRoutineIdentity(ownerEmail: string, idOrCode: string, input: { code?: string; isActive?: boolean }): Promise<Routine | null>;
  listRoutineVersions(ownerEmail: string, idOrCode: string): Promise<RoutineVersion[]>;
  getRoutineVersion(ownerEmail: string, idOrCode: string, versionId: string): Promise<RoutineVersion | null>;
  createRoutineVersion(ownerEmail: string, idOrCode: string, input: RoutineVersionInput): Promise<RoutineVersion>;
  updateRoutineVersion(ownerEmail: string, idOrCode: string, versionId: string, input: RoutineVersionInput): Promise<RoutineVersion | null>;
  deleteRoutineVersion(ownerEmail: string, idOrCode: string, versionId: string): Promise<boolean>;
  publishRoutineVersion(
    ownerEmail: string,
    idOrCode: string,
    versionId: string,
    expectedCurrentVersionId?: string,
  ): Promise<RoutineAggregate | null>;
}

export interface WorkoutRepository {
  listWorkouts(ownerEmail: string, query?: WorkoutQuery): Promise<Workout[]>;
  listWorkoutHistory(ownerEmail: string, query?: WorkoutHistoryQuery): Promise<WorkoutHistoryPage>;
  getWorkout(ownerEmail: string, id: string): Promise<Workout | null>;
  updateWorkout(ownerEmail: string, id: string, input: { bodyWeight?: number | null; notes?: string; status?: string }): Promise<Workout | null>;
  archiveWorkout(ownerEmail: string, id: string): Promise<boolean>;
  discardWorkout(ownerEmail: string, id: string): Promise<WorkoutDiscardResult>;
  correctWorkoutSet(ownerEmail: string, workoutId: string, setId: string, input: WorkoutSetCorrection): Promise<Workout | null>;
}

export type EntityRepository = ExerciseRepository & RoutineRepository & WorkoutRepository;
