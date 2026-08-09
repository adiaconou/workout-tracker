import type {
  EntityRepository,
  ExerciseProgressQuery,
  ExerciseQuery,
} from "../../domain/repositories/entity-repository";
import type { ExerciseInput } from "../../domain/entities";
import { validateExerciseInput } from "../../domain/exercises/validation";

export class ExerciseService {
  constructor(private readonly repository: EntityRepository) {}

  list(ownerEmail: string, query?: ExerciseQuery) {
    return this.repository.listExercises(ownerEmail, query);
  }

  get(ownerEmail: string, id: string) {
    return this.repository.getExercise(ownerEmail, id);
  }

  progress(ownerEmail: string, id: string, query?: ExerciseProgressQuery) {
    if (query?.from && !Number.isFinite(Date.parse(query.from))) {
      throw new Error("Progress start date is invalid.");
    }
    if (query?.unit !== undefined && query.unit !== "lb" && query.unit !== "kg") {
      throw new Error("Progress weight unit must be lb or kg.");
    }
    return this.repository.getExerciseProgress(ownerEmail, id, {
      ...query,
      from: query?.from ? new Date(query.from).toISOString() : undefined,
    });
  }

  create(ownerEmail: string, input: ExerciseInput) {
    const validated = validateExerciseInput(input);
    if (!validated.muscles?.some((muscle) => muscle.role === "primary")) {
      throw new Error("At least one primary muscle is required for a new exercise.");
    }
    return this.repository.createExercise(ownerEmail, validated);
  }

  async update(ownerEmail: string, id: string, input: Partial<ExerciseInput>) {
    const existing = await this.repository.getExercise(ownerEmail, id);
    if (!existing) return null;
    return this.repository.updateExercise(ownerEmail, id, validateExerciseInput({
      name: input.name ?? existing.name,
      equipment: input.equipment ?? existing.equipment,
      movementPattern: input.movementPattern ?? existing.movementPattern,
      trackingType: input.trackingType ?? existing.trackingType,
      defaultLoadType: input.defaultLoadType ?? existing.defaultLoadType,
      sideMode: input.sideMode ?? existing.sideMode,
      instructions: input.instructions ?? existing.instructions,
      muscles: input.muscles ?? existing.muscles,
    }));
  }

  updateIfUnchanged(
    ownerEmail: string,
    id: string,
    expectedUpdatedAt: string,
    mutationId: string,
    input: ExerciseInput,
  ) {
    return this.repository.updateExerciseIfUnchanged(
      ownerEmail,
      id,
      expectedUpdatedAt,
      mutationId,
      validateExerciseInput(input),
    );
  }

  setFavorite(ownerEmail: string, id: string, isFavorite: boolean) {
    return this.repository.setExerciseFavorite(ownerEmail, id, isFavorite);
  }

  archive(ownerEmail: string, id: string) {
    return this.repository.archiveExercise(ownerEmail, id);
  }

  archiveIfUnchanged(
    ownerEmail: string,
    id: string,
    expectedUpdatedAt: string,
  ) {
    return this.repository.archiveExerciseIfUnchanged(
      ownerEmail,
      id,
      expectedUpdatedAt,
    );
  }
}
