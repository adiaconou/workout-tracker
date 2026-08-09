import type {
  RoutineProgram,
  RoutineProgramCreateInput,
} from "../entities/program";

export type ProgramRepositoryCreateResult =
  | { kind: "created" | "replayed"; program: RoutineProgram }
  | { kind: "conflict" };

export interface ProgramRepository {
  listPrograms(ownerEmail: string): Promise<RoutineProgram[]>;
  getProgram(ownerEmail: string, programId: string): Promise<RoutineProgram | null>;
  createProgram(
    ownerEmail: string,
    idempotencyKey: string,
    requestFingerprint: string,
    input: RoutineProgramCreateInput & { activate: boolean },
  ): Promise<ProgramRepositoryCreateResult>;
  activateProgram(ownerEmail: string, programId: string): Promise<RoutineProgram | null>;
}
