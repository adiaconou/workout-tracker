import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { RoutineProgramCreateInput, RoutineVersionInput } from "../src/domain/entities";
import { RoutineProgramInputError } from "../src/domain/programs/validation";
import { ensureEntitySchema } from "../src/server/db/entity-schema";
import { D1ProgramRepository } from "../src/server/db/program-repository";

type SqliteValue = null | number | bigint | string | Uint8Array;

function sqliteValue(value: unknown): SqliteValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string" || value instanceof Uint8Array) return value;
  return String(value);
}

class SqliteStatement {
  constructor(private database: DatabaseSync, private sql: string, private values: unknown[] = []) {}
  bind(...values: unknown[]) { return new SqliteStatement(this.database, this.sql, values); }
  private boundValues() { return this.values.map(sqliteValue); }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.boundValues());
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async all<T>() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.boundValues()) as T[] };
  }
  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.boundValues()) as T | undefined) ?? null;
  }
}

class SqliteD1 {
  private failAt: number | null = null;
  constructor(private database: DatabaseSync) {}
  prepare(sql: string) { return new SqliteStatement(this.database, sql); }
  failNextBatchAt(index: number) { this.failAt = index; }
  async batch(statements: SqliteStatement[]) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (let index = 0; index < statements.length; index += 1) {
        if (this.failAt === index) throw new Error("Injected batch failure");
        results.push(await statements[index]!.run());
      }
      this.database.exec("COMMIT");
      this.failAt = null;
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      this.failAt = null;
      throw error;
    }
  }
}

const routineVersion = (exerciseId: string, focus: string): RoutineVersionInput => ({
  focus,
  summary: `${focus} summary`,
  durationMin: 35,
  exercises: [{
    exerciseId,
    position: 1,
    sets: [{
      position: 1,
      setType: "regular",
      targetType: "reps",
      targetMin: 6,
      targetMax: 8,
      targetDisplay: "6-8 reps",
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
});

async function seedLegacyRoutines(d1: SqliteD1, ownerEmail: string) {
  await ensureEntitySchema(d1 as unknown as D1Database);
  const now = "2026-08-09T00:00:00.000Z";
  await d1.batch(["A", "B", "C", "D"].map((code) => d1.prepare(`INSERT INTO routines (
    id, owner_email, code, version, focus, summary, duration_min,
    current_version_id, is_active, created_at, updated_at
  ) VALUES (?, ?, ?, 1, ?, ?, 60, NULL, 1, ?, ?)`)
    .bind(`${ownerEmail}::routine::${code}`, ownerEmail, code, `Routine ${code}`, "Legacy routine", now, now)));
}

test("program repository materializes the legacy A-D plan and preserves owner scope", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const d1 = new SqliteD1(sqlite);
  const repository = new D1ProgramRepository(d1 as unknown as D1Database);
  try {
    await seedLegacyRoutines(d1, "owner@example.com");
    const programs = await repository.listPrograms("owner@example.com");
    assert.equal(programs.length, 1);
    assert.equal(programs[0]?.name, "Current plan");
    assert.equal(programs[0]?.isActive, true);
    assert.deepEqual(programs[0]?.routines.map((routine) => routine.routineCode), ["A", "B", "C", "D"]);
    assert.equal(
      await repository.getProgram("other@example.com", programs[0]!.id),
      null,
    );
    assert.equal((await repository.listPrograms("other@example.com")).length, 0);
  } finally {
    sqlite.close();
  }
});

test("program repository creates and activates ordered owner programs idempotently", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const d1 = new SqliteD1(sqlite);
  const repository = new D1ProgramRepository(d1 as unknown as D1Database);
  const owner = "owner@example.com";
  try {
    await seedLegacyRoutines(d1, owner);
    const defaultProgram = (await repository.listPrograms(owner))[0]!;
    const input: RoutineProgramCreateInput & { activate: boolean } = {
      name: "Upper rotation",
      goal: "Build pulling strength",
      selectedMuscleGroups: ["back", "biceps"],
      trainingDaysPerWeek: 2,
      targetDurationMin: 40,
      activate: false,
      routines: [
        { routineId: defaultProgram.routines[1]!.routineId },
        { routineId: defaultProgram.routines[3]!.routineId },
      ],
    };
    const fingerprint = JSON.stringify(input);
    const created = await repository.createProgram(owner, "upper-plan-1", fingerprint, input);
    if (created.kind === "conflict") throw new Error("Unexpected conflict");
    assert.equal(created.kind, "created");
    assert.equal(created.program.isActive, false);
    assert.deepEqual(created.program.routines.map((routine) => routine.routineCode), ["B", "D"]);
    assert.equal((await repository.listPrograms(owner)).filter((program) => program.isActive)[0]?.id, defaultProgram.id);

    const replayed = await repository.createProgram(owner, "upper-plan-1", fingerprint, input);
    assert.equal(replayed.kind, "replayed");
    assert.equal((await repository.createProgram(owner, "upper-plan-1", "different", input)).kind, "conflict");

    const activated = await repository.activateProgram(owner, created.program.id);
    assert.equal(activated?.isActive, true);
    assert.equal((await repository.listPrograms(owner)).filter((program) => program.isActive).length, 1);
    assert.equal((await repository.getProgram(owner, defaultProgram.id))?.isActive, false);
    assert.equal(await repository.activateProgram(owner, "missing"), null);
    await assert.rejects(
      () => repository.createProgram(owner, "missing-routine", "missing", {
        ...input,
        routines: [{ routineId: "missing" }],
      }),
      RoutineProgramInputError,
    );
  } finally {
    sqlite.close();
  }
});

test("program repository atomically creates complete routine drafts", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const d1 = new SqliteD1(sqlite);
  const repository = new D1ProgramRepository(d1 as unknown as D1Database);
  const owner = "owner@example.com";
  try {
    await repository.listPrograms(owner);
    const exercise = await d1.prepare("SELECT id FROM exercise_catalog WHERE owner_email = ? ORDER BY name LIMIT 1")
      .bind(owner)
      .first<{ id: string }>();
    assert.ok(exercise);
    const input: RoutineProgramCreateInput & { activate: boolean } = {
      name: "Generated program",
      goal: "Build a balanced base",
      selectedMuscleGroups: ["back", "quads"],
      trainingDaysPerWeek: 2,
      targetDurationMin: 35,
      activate: false,
      routines: [
        { code: "GEN-1", version: routineVersion(exercise.id, "Generated pull") },
        { code: "GEN-2", version: routineVersion(exercise.id, "Generated legs") },
      ],
    };
    const created = await repository.createProgram(owner, "generated-plan-1", JSON.stringify(input), input);
    if (created.kind === "conflict") throw new Error("Unexpected conflict");
    assert.equal(created.kind, "created");
    assert.deepEqual(created.program.routines.map((routine) => routine.routineCode), ["GEN-1", "GEN-2"]);
    assert.equal(created.program.isActive, true);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ? AND code LIKE 'GEN-%'")
      .bind(owner).first<{ count: number }>())?.count, 2);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS count FROM routine_versions WHERE owner_email = ? AND status = 'published' AND routine_id IN (SELECT id FROM routines WHERE code LIKE 'GEN-%')")
      .bind(owner).first<{ count: number }>())?.count, 2);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS count FROM routine_set_templates WHERE owner_email = ? AND routine_exercise_id IN (SELECT id FROM routine_version_exercises WHERE owner_email = ? AND routine_version_id IN (SELECT current_version_id FROM routines WHERE code LIKE 'GEN-%'))")
      .bind(owner, owner).first<{ count: number }>())?.count, 2);

    const failedInput: RoutineProgramCreateInput & { activate: boolean } = {
      ...input,
      name: "Failed program",
      routines: [{ code: "FAIL-1", version: routineVersion(exercise.id, "Failure") }],
    };
    d1.failNextBatchAt(2);
    await assert.rejects(
      () => repository.createProgram(owner, "failed-plan-1", JSON.stringify(failedInput), failedInput),
      /injected batch failure/i,
    );
    assert.equal(await d1.prepare("SELECT id FROM routines WHERE owner_email = ? AND code = 'FAIL-1'")
      .bind(owner).first(), null);
    assert.equal((await repository.getProgram(owner, created.program.id))?.isActive, true);
  } finally {
    sqlite.close();
  }
});
