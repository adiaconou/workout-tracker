import type { EntityRepository } from "../../domain/repositories/entity-repository";
import type { RoutineVersionInput } from "../../domain/entities";
import { validateRoutineVersionInput } from "../../domain/routines/validation";
import { cleanRequired } from "../../domain/validation";

export class RoutineService {
  constructor(private readonly repository: EntityRepository) {}

  list(ownerEmail: string, includeArchived = false) {
    return this.repository.listRoutineAggregates(ownerEmail, includeArchived);
  }

  get(ownerEmail: string, idOrCode: string) {
    return this.repository.getRoutineAggregate(ownerEmail, idOrCode);
  }

  create(
    ownerEmail: string,
    code: string,
    input: RoutineVersionInput,
    requestedId?: string,
  ) {
    return this.repository.createRoutine(
      ownerEmail,
      cleanRequired(code, "Routine code", 20).toUpperCase(),
      validateRoutineVersionInput(input),
      requestedId,
    );
  }

  deleteUnpublished(ownerEmail: string, idOrCode: string) {
    return this.repository.deleteUnpublishedRoutine(ownerEmail, idOrCode);
  }

  updateIdentity(
    ownerEmail: string,
    idOrCode: string,
    input: { code?: string; isActive?: boolean },
  ) {
    if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
      throw new Error("Routine active state must be a boolean.");
    }
    return this.repository.updateRoutineIdentity(ownerEmail, idOrCode, {
      code: input.code === undefined
        ? undefined
        : cleanRequired(input.code, "Routine code", 20),
      isActive: input.isActive,
    });
  }

  archive(ownerEmail: string, idOrCode: string) {
    return this.repository.updateRoutineIdentity(
      ownerEmail,
      idOrCode,
      { isActive: false },
    );
  }

  listVersions(ownerEmail: string, idOrCode: string) {
    return this.repository.listRoutineVersions(ownerEmail, idOrCode);
  }

  getVersion(ownerEmail: string, idOrCode: string, versionId: string) {
    return this.repository.getRoutineVersion(ownerEmail, idOrCode, versionId);
  }

  createVersion(
    ownerEmail: string,
    idOrCode: string,
    input: RoutineVersionInput,
  ) {
    return this.repository.createRoutineVersion(
      ownerEmail,
      idOrCode,
      validateRoutineVersionInput(input),
    );
  }

  updateVersion(
    ownerEmail: string,
    idOrCode: string,
    versionId: string,
    input: RoutineVersionInput,
  ) {
    return this.repository.updateRoutineVersion(
      ownerEmail,
      idOrCode,
      versionId,
      validateRoutineVersionInput(input),
    );
  }

  deleteVersion(ownerEmail: string, idOrCode: string, versionId: string) {
    return this.repository.deleteRoutineVersion(ownerEmail, idOrCode, versionId);
  }

  publish(
    ownerEmail: string,
    idOrCode: string,
    versionId: string,
    expectedCurrentVersionId?: string,
  ) {
    return this.repository.publishRoutineVersion(
      ownerEmail,
      idOrCode,
      versionId,
      expectedCurrentVersionId,
    );
  }
}
