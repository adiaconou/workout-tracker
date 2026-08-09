import type {
  RoutineProgramCreateInput,
} from "../../domain/entities";
import {
  RoutineProgramInputError,
  routineProgramRequestFingerprint,
  validateRoutineProgramCreateInput,
} from "../../domain/programs/validation";
import type { ProgramRepository } from "../../domain/repositories/program-repository";
import { cleanRequired } from "../../domain/validation";

export class ProgramIdempotencyConflictError extends Error {
  constructor() {
    super("That idempotency key was already used for different program details.");
  }
}

export class ProgramService {
  constructor(private readonly repository: ProgramRepository) {}

  list(ownerEmail: string) {
    return this.repository.listPrograms(ownerEmail);
  }

  get(ownerEmail: string, programId: string) {
    return this.repository.getProgram(
      ownerEmail,
      cleanRequired(programId, "Program id"),
    );
  }

  async create(
    ownerEmail: string,
    idempotencyKey: string,
    input: RoutineProgramCreateInput,
  ) {
    let key: string;
    let validated: ReturnType<typeof validateRoutineProgramCreateInput>;
    try {
      key = cleanRequired(idempotencyKey, "Idempotency key");
      if (key.length < 8) {
        throw new Error("Idempotency key must contain at least 8 characters.");
      }
      if (key.length > 128) {
        throw new Error("Idempotency key cannot exceed 128 characters.");
      }
      validated = validateRoutineProgramCreateInput(input);
    } catch (error) {
      throw new RoutineProgramInputError(
        error instanceof Error ? error.message : "Program details are invalid.",
      );
    }
    const result = await this.repository.createProgram(
      ownerEmail,
      key,
      routineProgramRequestFingerprint(validated),
      validated,
    );
    if (result.kind === "conflict") throw new ProgramIdempotencyConflictError();
    return {
      program: result.program,
      created: result.kind === "created",
    };
  }

  activate(ownerEmail: string, programId: string) {
    return this.repository.activateProgram(
      ownerEmail,
      cleanRequired(programId, "Program id"),
    );
  }
}
