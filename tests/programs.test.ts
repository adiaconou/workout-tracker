import assert from "node:assert/strict";
import test from "node:test";
import type {
  RoutineProgram,
  RoutineProgramCreateInput,
  RoutineVersionInput,
} from "../src/domain/entities";
import {
  RoutineProgramInputError,
  routineProgramRequestFingerprint,
  validateRoutineProgramCreateInput,
} from "../src/domain/programs/validation";
import type {
  ProgramRepository,
  ProgramRepositoryCreateResult,
} from "../src/domain/repositories/program-repository";
import {
  ProgramIdempotencyConflictError,
  ProgramService,
} from "../src/server/programs/service";

const version: RoutineVersionInput = {
  focus: "Push",
  summary: "A compact push session",
  durationMin: 40,
  exercises: [{
    exerciseId: "exercise-1",
    position: 1,
    sets: [{
      position: 1,
      setType: "regular",
      targetType: "reps",
      targetMin: 8,
      targetMax: 10,
      targetDisplay: "8-10 reps",
      targetRirMin: 2,
      targetRirMax: 2,
      restAfterSec: 90,
      restRule: "standard",
      loadInstruction: "",
      sideMode: "bilateral",
      tempo: null,
      notes: "",
    }],
  }],
};

const createInput = (): RoutineProgramCreateInput => ({
  name: "  Strength plan  ",
  goal: "  Build strength  ",
  selectedMuscleGroups: ["triceps", "back", "back"],
  trainingDaysPerWeek: 3,
  targetDurationMin: 45,
  routines: [
    { routineId: "  existing-1  " },
    { code: " push ", version },
  ],
});

function invalid(overrides: Record<string, unknown>) {
  return { ...createInput(), ...overrides } as RoutineProgramCreateInput;
}

test("normalizes complete program input and produces a stable fingerprint", () => {
  const result = validateRoutineProgramCreateInput(createInput());
  assert.equal(result.name, "Strength plan");
  assert.equal(result.goal, "Build strength");
  assert.deepEqual(result.selectedMuscleGroups, ["back", "triceps"]);
  assert.equal(result.trainingDaysPerWeek, 3);
  assert.equal(result.targetDurationMin, 45);
  assert.equal(result.activate, true);
  assert.deepEqual(result.routines[0], { routineId: "existing-1" });
  assert.deepEqual(result.routines[1], { code: "PUSH", version });
  assert.equal(routineProgramRequestFingerprint(result), JSON.stringify(result));

  const inactive = validateRoutineProgramCreateInput({ ...createInput(), activate: false });
  assert.equal(inactive.activate, false);
});

test("rejects malformed program identity, schedule, and muscle input", () => {
  assert.throws(
    () => validateRoutineProgramCreateInput(null as never),
    /details are required/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({ activate: "yes" })),
    /active state/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({ selectedMuscleGroups: "back" })),
    /must be a list/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({ selectedMuscleGroups: ["wings"] })),
    /muscle group is invalid/i,
  );
  for (const trainingDaysPerWeek of [0, 8, 2.5, Number.NaN]) {
    assert.throws(
      () => validateRoutineProgramCreateInput(invalid({ trainingDaysPerWeek })),
      /training days/i,
    );
  }
  for (const targetDurationMin of [0, 4, 301, 1.5]) {
    assert.throws(
      () => validateRoutineProgramCreateInput(invalid({ targetDurationMin })),
      /target duration/i,
    );
  }
});

test("rejects missing, ambiguous, duplicate, and excessive routine entries", () => {
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({ routines: [] })),
    /at least one routine/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({ routines: "routine" })),
    /at least one routine/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({
      routines: Array.from({ length: 21 }, (_, index) => ({ routineId: `r-${index}` })),
    })),
    /more than 20/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({ routines: [null] })),
    /reference or define/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({ routines: [{}] })),
    /either a routine id or a complete routine draft/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({
      routines: [{ routineId: "r-1", code: "X", version }],
    })),
    /either a routine id or a complete routine draft/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({
      routines: [{ routineId: "r-1" }, { routineId: "r-1" }],
    })),
    /same routine twice/i,
  );
  assert.throws(
    () => validateRoutineProgramCreateInput(invalid({
      routines: [{ code: "x", version }, { code: "X", version }],
    })),
    /codes must be unique/i,
  );
});

class FakeProgramRepository implements ProgramRepository {
  result: ProgramRepositoryCreateResult;
  readonly program: RoutineProgram = {
    id: "program-1",
    ownerEmail: "owner@example.com",
    name: "Strength plan",
    goal: "Build strength",
    selectedMuscleGroups: ["back"],
    trainingDaysPerWeek: 3,
    targetDurationMin: 45,
    isActive: true,
    routines: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
  lastCreate: unknown[] | null = null;

  constructor(kind: ProgramRepositoryCreateResult["kind"] = "created") {
    this.result = kind === "conflict" ? { kind } : { kind, program: this.program };
  }

  async listPrograms() { return [this.program]; }
  async getProgram(_ownerEmail: string, programId: string) {
    return programId === this.program.id ? this.program : null;
  }
  async createProgram(...args: Parameters<ProgramRepository["createProgram"]>) {
    this.lastCreate = args;
    return this.result;
  }
  async activateProgram(_ownerEmail: string, programId: string) {
    return programId === this.program.id ? this.program : null;
  }
}

test("program service delegates reads, activation, creation, and replay semantics", async () => {
  const repository = new FakeProgramRepository();
  const service = new ProgramService(repository);
  assert.deepEqual(await service.list("owner@example.com"), [repository.program]);
  assert.equal(await service.get("owner@example.com", " program-1 "), repository.program);
  assert.equal(await service.get("owner@example.com", "missing"), null);
  assert.equal(await service.activate("owner@example.com", " program-1 "), repository.program);

  const created = await service.create("owner@example.com", " request-1 ", createInput());
  assert.equal(created.created, true);
  assert.equal(created.program, repository.program);
  assert.equal(repository.lastCreate?.[1], "request-1");

  repository.result = { kind: "replayed", program: repository.program };
  const replayed = await service.create("owner@example.com", "request-1", createInput());
  assert.equal(replayed.created, false);
  assert.equal(replayed.program, repository.program);
});

test("program service rejects weak keys and maps repository conflicts", async () => {
  const service = new ProgramService(new FakeProgramRepository("conflict"));
  await assert.rejects(
    () => service.create("owner@example.com", "short", createInput()),
    (error) => error instanceof RoutineProgramInputError && /at least 8 characters/i.test(error.message),
  );
  await assert.rejects(
    () => service.create("owner@example.com", "", createInput()),
    (error) => error instanceof RoutineProgramInputError && /is required/i.test(error.message),
  );
  await assert.rejects(
    () => service.create("owner@example.com", "x".repeat(129), createInput()),
    (error) => error instanceof RoutineProgramInputError && /cannot exceed 128/i.test(error.message),
  );
  await assert.rejects(
    () => service.create("owner@example.com", "conflict-key", createInput()),
    ProgramIdempotencyConflictError,
  );
  assert.throws(() => service.get("owner@example.com", ""), /program id is required/i);
  assert.throws(() => service.activate("owner@example.com", ""), /program id is required/i);

  const unreadable = new Proxy(createInput(), {
    get() {
      throw "unreadable input";
    },
  });
  await assert.rejects(
    () => service.create("owner@example.com", "unreadable-key", unreadable),
    (error) => error instanceof RoutineProgramInputError
      && error.message === "Program details are invalid.",
  );
});
