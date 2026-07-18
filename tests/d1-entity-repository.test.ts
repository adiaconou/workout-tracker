import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { D1EntityRepository } from "../infrastructure/d1/entity-repository";
import { ensureEntityData, ensureEntitySchema, materializeWorkoutFromSnapshot } from "../infrastructure/d1/entity-schema";
import { getPreviousPerformanceByExercise } from "../infrastructure/d1/previous-performance";
import type { RoutineVersionInput } from "../domain/entities";

function literal(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql: string, values: unknown[]) {
  let index = 0;
  return sql.replaceAll("?", () => literal(values[index++]));
}

class SqliteStatement {
  constructor(private database: string, private sql: string, private values: unknown[] = []) {}
  bind(...values: unknown[]) { return new SqliteStatement(this.database, this.sql, values); }
  private execute(extra = "") {
    const command = `${bindSql(this.sql, this.values)};${extra}`;
    const result = spawnSync("/usr/bin/sqlite3", ["-json", this.database, command], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || `SQLite failed: ${command}`);
    return result.stdout.trim() ? JSON.parse(result.stdout) as Array<Record<string, unknown>> : [];
  }
  async run() {
    const rows = this.execute("SELECT changes() AS changes;");
    return { success: true, meta: { changes: Number(rows.at(-1)?.changes ?? 0) } };
  }
  async all<T>() { return { success: true, results: this.execute() as T[] }; }
  async first<T>() { return (this.execute()[0] as T | undefined) ?? null; }
}

class SqliteD1 {
  constructor(private database: string) {}
  prepare(sql: string) { return new SqliteStatement(this.database, sql); }
  async batch(statements: SqliteStatement[]) { return Promise.all(statements.map((statement) => statement.run())); }
}

const singleSetRoutine = (exerciseId: string, focus: string): RoutineVersionInput => ({
  focus,
  summary: "Repository integration test",
  durationMin: 30,
  exercises: [{
    exerciseId,
    position: 1,
    instructions: "2 RIR",
    notes: "Test movement",
    sets: [{
      position: 1,
      setType: "regular",
      targetType: "reps",
      targetMin: 8,
      targetMax: 10,
      targetDisplay: "8–10 reps",
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

test("D1 entity repository seeds, versions, publishes, materializes, and archives normalized entities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-d1-repository-"));
  const database = join(directory, "repository.sqlite");
  const d1 = new SqliteD1(database) as unknown as D1Database;
  const owner = "owner@example.com";
  try {
    await ensureEntitySchema(d1);
    await ensureEntityData(d1, owner);
    const repository = new D1EntityRepository(d1);

    const seededExercises = await repository.listExercises(owner);
    const seededRoutines = await repository.listRoutineAggregates(owner);
    assert.ok(seededExercises.length >= 70);
    assert.ok(seededExercises.some((exercise) => exercise.name === "Machine chest press"));
    assert.ok(seededExercises.some((exercise) => exercise.name === "Kettlebell Turkish get-up"));
    assert.ok(seededExercises.some((exercise) => exercise.name === "EZ-bar biceps curl"));
    assert.equal(seededRoutines.length, 4);
    assert.ok(seededRoutines.every((routine) => routine.currentVersion?.status === "published"));

    const machinePress = seededExercises.find((exercise) => exercise.name === "Machine chest press")!;
    await repository.updateExercise(owner, machinePress.id, { name: "My machine press" });
    await ensureEntityData(d1, owner);
    assert.equal((await repository.listExercises(owner)).length, seededExercises.length);
    assert.equal((await repository.getExercise(owner, machinePress.id))?.name, "My machine press");
    assert.equal((await repository.listExercises(owner)).some((exercise) => exercise.name === "Machine chest press"), false);

    const exercise = await repository.createExercise(owner, {
      name: "Test goblet squat",
      equipment: "kettlebell",
      movementPattern: "squat",
      muscles: [
        { muscleGroup: "quads", role: "primary", weight: 1 },
        { muscleGroup: "glutes", role: "secondary", weight: 0.7 },
      ],
    });
    const routine = await repository.createRoutine(owner, "E", singleSetRoutine(exercise.id, "Simple legs"));
    assert.equal(routine.currentVersion?.versionNumber, 1);
    assert.equal(routine.currentVersion?.exercises[0].sets[0].restAfterSec, 90);

    const draft = await repository.createRoutineVersion(owner, routine.id, singleSetRoutine(exercise.id, "Updated legs"));
    const updatedDraft = await repository.updateRoutineVersion(owner, routine.id, draft.id, singleSetRoutine(exercise.id, "Updated legs again"));
    assert.equal(updatedDraft?.id, draft.id);
    await repository.publishRoutineVersion(owner, routine.id, draft.id);
    const versions = await repository.listRoutineVersions(owner, routine.id);
    assert.equal(versions.find((version) => version.id === draft.id)?.status, "published");
    assert.equal(versions.find((version) => version.versionNumber === 1)?.status, "superseded");
    await assert.rejects(() => repository.updateRoutineVersion(owner, routine.id, draft.id, singleSetRoutine(exercise.id, "Illegal edit")), /immutable/);
    const reloadedRepository = new D1EntityRepository(d1);
    assert.equal((await reloadedRepository.getRoutineAggregate(owner, routine.id))?.currentVersion?.id, draft.id);

    const workoutId = "workout-integration";
    const startedAt = "2026-07-15T12:00:00.000Z";
    const snapshot = {
      code: "E", version: 2, focus: "Updated legs again", summary: "", durationMin: 30, updatedAt: startedAt,
      exercises: [{
        id: `${owner}::exercise::E::1`, exerciseOrder: 1, name: "Test goblet squat", warmup: "None",
        warmupSets: 0, regularSets: 1, failureSets: 0, dropSets: 0, target: "8–10 reps",
        rest: "90 sec", effort: "2 RIR", purpose: "Test", loadType: "external", weightUnit: "lb",
      }],
    };
    const previousWorkoutId = "workout-previous";
    const previousStartedAt = "2026-07-14T12:00:00.000Z";
    await d1.prepare(`INSERT INTO workout_sessions (
      id, owner_email, routine_code, routine_version, status, snapshot_json, current_exercise,
      current_set, completed_sets, skipped_sets, total_sets, started_at, completed_at, updated_at
    ) VALUES (?, ?, 'E', 2, 'Completed', ?, 1, 2, 1, 0, 1, ?, ?, ?)`)
      .bind(
        previousWorkoutId,
        owner,
        JSON.stringify(snapshot),
        previousStartedAt,
        previousStartedAt,
        previousStartedAt,
      ).run();
    await materializeWorkoutFromSnapshot(d1, owner, previousWorkoutId);
    await d1.prepare(`UPDATE workout_sets SET actual_weight = 70, actual_reps = 9,
      status = 'completed', completed_at = ?, updated_at = ? WHERE workout_id = ?`)
      .bind(previousStartedAt, previousStartedAt, previousWorkoutId).run();

    await d1.prepare(`INSERT INTO workout_sessions (
      id, owner_email, routine_code, routine_version, status, snapshot_json, current_exercise,
      current_set, completed_sets, skipped_sets, total_sets, started_at, updated_at
    ) VALUES (?, ?, 'E', 2, 'In Progress', ?, 1, 1, 0, 0, 1, ?, ?)`)
      .bind(workoutId, owner, JSON.stringify(snapshot), startedAt, startedAt).run();
    await materializeWorkoutFromSnapshot(d1, owner, workoutId);
    const previousPerformance = await getPreviousPerformanceByExercise(
      d1,
      owner,
      workoutId,
      startedAt,
    );
    assert.equal(previousPerformance[1].workoutId, previousWorkoutId);
    assert.equal(previousPerformance[1].sets[0].actualWeight, 70);
    assert.equal(previousPerformance[1].sets[0].actualReps, 9);
    const workout = await repository.getWorkout(owner, workoutId);
    assert.equal(workout?.routineVersionId, draft.id);
    assert.equal(workout?.exercises.length, 1);
    assert.equal(workout?.exercises[0].sets[0].plannedTargetMin, 8);

    const completedHistory = await repository.listWorkoutHistory(owner, {
      exerciseSearch: "goblet",
      limit: 10,
    });
    assert.equal(completedHistory.workouts.length, 1);
    assert.equal(completedHistory.workouts[0].id, previousWorkoutId);
    assert.equal(completedHistory.workouts[0].status, "Completed");
    assert.equal(completedHistory.workouts[0].completedSets, 1);
    assert.equal(completedHistory.workouts[0].exerciseNames[0], "Test goblet squat");
    assert.equal(completedHistory.stats.workoutCount, 1);
    assert.equal(completedHistory.stats.completedSets, 1);

    assert.equal(await repository.archiveWorkout(owner, workoutId), true);
    assert.equal((await repository.listWorkouts(owner)).some((item) => item.id === workoutId), false);
    assert.equal((await repository.listWorkouts(owner, { includeArchived: true })).some((item) => item.id === workoutId), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
