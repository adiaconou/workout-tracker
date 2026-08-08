import type {
  EntityRepository,
  WorkoutHistoryQuery,
  WorkoutQuery,
} from "../../domain/repositories/entity-repository";
import type { WorkoutSetCorrection } from "../../domain/entities";
import { assertNonNegative, cleanOptional } from "../../domain/validation";

export class WorkoutService {
  constructor(private readonly repository: EntityRepository) {}

  list(ownerEmail: string, query?: WorkoutQuery) {
    return this.repository.listWorkouts(ownerEmail, query);
  }

  history(ownerEmail: string, query?: WorkoutHistoryQuery) {
    if (
      query?.status
      && !["Completed", "Partial", "Abandoned"].includes(query.status)
    ) {
      throw new Error("Workout history status is invalid.");
    }
    return this.repository.listWorkoutHistory(ownerEmail, query);
  }

  get(ownerEmail: string, id: string) {
    return this.repository.getWorkout(ownerEmail, id);
  }

  update(
    ownerEmail: string,
    id: string,
    input: { bodyWeight?: number | null; notes?: string; status?: string },
  ) {
    assertNonNegative(input.bodyWeight, "Body weight");
    if (
      input.status !== undefined
      && !["In Progress", "Completed", "Partial", "Abandoned"].includes(input.status)
    ) {
      throw new Error("Workout status is invalid.");
    }
    return this.repository.updateWorkout(ownerEmail, id, {
      ...input,
      notes: input.notes === undefined
        ? undefined
        : cleanOptional(input.notes, 2000),
    });
  }

  archive(ownerEmail: string, id: string) {
    return this.repository.archiveWorkout(ownerEmail, id);
  }

  discard(ownerEmail: string, id: string) {
    return this.repository.discardWorkout(ownerEmail, id);
  }

  correctSet(
    ownerEmail: string,
    workoutId: string,
    setId: string,
    input: WorkoutSetCorrection,
  ) {
    assertNonNegative(input.actualReps, "Reps");
    assertNonNegative(input.actualRepsLeft, "Left reps");
    assertNonNegative(input.actualRepsRight, "Right reps");
    assertNonNegative(input.actualDurationSec, "Duration");
    assertNonNegative(input.actualWeight, "Weight");
    assertNonNegative(input.actualRir, "RIR");
    assertNonNegative(input.actualRestSec, "Rest");
    if (
      input.status !== undefined
      && !["completed", "skipped"].includes(input.status)
    ) {
      throw new Error("Workout set status is invalid.");
    }
    return this.repository.correctWorkoutSet(ownerEmail, workoutId, setId, input);
  }
}
