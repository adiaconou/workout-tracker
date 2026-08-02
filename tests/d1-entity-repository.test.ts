import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { D1EntityRepository } from "../infrastructure/d1/entity-repository";
import { ensureEntityData, ensureEntitySchema, materializeWorkoutFromSnapshot } from "../infrastructure/d1/entity-schema";
import { getPreviousPerformanceByExercise } from "../infrastructure/d1/previous-performance";
import type { RoutineVersionInput } from "../domain/entities";

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
  private boundValues() {
    return this.values.map(sqliteValue);
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.boundValues());
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async all<T>() { return { success: true, results: this.database.prepare(this.sql).all(...this.boundValues()) as T[] }; }
  async first<T>() { return (this.database.prepare(this.sql).get(...this.boundValues()) as T | undefined) ?? null; }
}

class SqliteD1 {
  constructor(private database: DatabaseSync) {}
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

test("D1 entity repository seeds, versions, publishes, materializes, discards, and archives normalized entities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-d1-repository-"));
  const database = join(directory, "repository.sqlite");
  const sqlite = new DatabaseSync(database);
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const owner = "owner@example.com";
  try {
    await ensureEntitySchema(d1);
    await ensureEntityData(d1, owner);
    const repository = new D1EntityRepository(d1);
    const exercisePlanColumns = await d1.prepare("PRAGMA table_info(assistant_exercise_change_plans)")
      .all<{ name: string }>();
    assert.ok(exercisePlanColumns.results.some((column) => column.name === "base_updated_at"));
    assert.ok(exercisePlanColumns.results.some((column) => column.name === "applied_exercise_id"));

    const seededExercises = await repository.listExercises(owner);
    const seededRoutines = await repository.listRoutineAggregates(owner);
    assert.ok(seededExercises.length >= 70);
    assert.ok(seededExercises.some((exercise) => exercise.name === "Machine chest press"));
    assert.ok(seededExercises.some((exercise) => exercise.name === "Kettlebell Turkish get-up"));
    assert.ok(seededExercises.some((exercise) => exercise.name === "EZ-bar biceps curl"));
    assert.ok(seededExercises.every((exercise) => !exercise.isFavorite));
    assert.equal(seededRoutines.length, 4);
    assert.ok(seededRoutines.every((routine) => routine.currentVersion?.status === "published"));

    const machinePress = seededExercises.find((exercise) => exercise.name === "Machine chest press")!;
    assert.equal((await repository.setExerciseFavorite(owner, machinePress.id, true))?.isFavorite, true);
    assert.equal((await repository.getExercise(owner, machinePress.id))?.isFavorite, true);
    assert.equal((await repository.setExerciseFavorite(owner, machinePress.id, true))?.isFavorite, true);
    assert.equal((await repository.setExerciseFavorite(owner, machinePress.id, false))?.isFavorite, false);
    assert.equal(await repository.setExerciseFavorite("other@example.com", machinePress.id, true), null);
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
    await repository.updateExercise(owner, exercise.id, {
      name: "Updated goblet squat",
      defaultLoadType: "bodyweight",
    });
    const projectedExercise = await d1.prepare(`SELECT name, load_type AS loadType FROM exercises
      WHERE owner_email = ? AND routine_code = 'E' AND exercise_order = 1`)
      .bind(owner).first<{ name: string; loadType: string }>();
    assert.equal(projectedExercise?.name, "Updated goblet squat");
    assert.equal(projectedExercise?.loadType, "bodyweight");
    assert.equal(
      (await repository.getRoutineAggregate(owner, routine.id))?.currentVersion?.exercises[0].exerciseName,
      "Updated goblet squat",
    );

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
    await d1.prepare(`INSERT INTO set_performances (
      id, owner_email, session_id, prescribed_set_id, exercise_id, exercise_order,
      exercise_name, set_order, set_type, target_display, target_rest_sec, rest_rule,
      weight_unit, status, performed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 1, 'regular', '8–10 reps', 90, 'standard',
      'lb', 'Completed', ?, ?, ?)`)
      .bind(
        "legacy-performance",
        owner,
        workoutId,
        `${owner}::set::E::1::regular::1`,
        exercise.id,
        exercise.name,
        startedAt,
        startedAt,
        startedAt,
      ).run();
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

    assert.equal(
      await repository.discardWorkout(owner, previousWorkoutId),
      "not_in_progress",
    );
    assert.equal(
      await repository.discardWorkout("other@example.com", workoutId),
      "not_found",
    );
    assert.equal(await repository.discardWorkout(owner, workoutId), "discarded");
    assert.equal(await repository.getWorkout(owner, workoutId), null);
    assert.equal(
      (await d1.prepare("SELECT COUNT(*) AS count FROM workout_sets WHERE workout_id = ?")
        .bind(workoutId).first<{ count: number }>())?.count,
      0,
    );
    assert.equal(
      (await d1.prepare("SELECT COUNT(*) AS count FROM workout_exercises WHERE workout_id = ?")
        .bind(workoutId).first<{ count: number }>())?.count,
      0,
    );
    assert.equal(
      (await d1.prepare("SELECT COUNT(*) AS count FROM set_performances WHERE session_id = ?")
        .bind(workoutId).first<{ count: number }>())?.count,
      0,
    );
    assert.equal(await repository.discardWorkout(owner, workoutId), "not_found");

    assert.equal(await repository.archiveWorkout(owner, previousWorkoutId), true);
    assert.equal(
      (await repository.listWorkouts(owner)).some(
        (item) => item.id === previousWorkoutId,
      ),
      false,
    );
    assert.equal(
      (await repository.listWorkouts(owner, { includeArchived: true })).some(
        (item) => item.id === previousWorkoutId,
      ),
      true,
    );
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("D1 entity repository refuses to publish a draft that references an archived exercise", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-d1-archived-draft-"));
  const database = join(directory, "repository.sqlite");
  const sqlite = new DatabaseSync(database);
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const owner = "owner@example.com";
  try {
    await ensureEntitySchema(d1);
    await ensureEntityData(d1, owner);
    const repository = new D1EntityRepository(d1);
    const exercise = await repository.createExercise(owner, { name: "Draft-only press" });
    const routine = await repository.createRoutine(owner, "ARCHIVE", singleSetRoutine(exercise.id, "Original"));
    const draft = await repository.createRoutineVersion(owner, routine.id, singleSetRoutine(exercise.id, "Draft"));

    await repository.updateRoutineIdentity(owner, routine.id, { isActive: false });
    assert.equal(await repository.archiveExercise(owner, exercise.id), true);
    await assert.rejects(
      () => repository.publishRoutineVersion(owner, routine.id, draft.id),
      /unavailable exercise/,
    );
    assert.equal((await repository.getRoutineAggregate(owner, routine.id))?.currentVersion?.versionNumber, 1);
    assert.equal((await repository.getRoutineVersion(owner, routine.id, draft.id))?.status, "draft");
    await assert.rejects(
      () => repository.updateRoutineIdentity(owner, routine.id, { isActive: 1 as unknown as boolean }),
      /must be a boolean/,
    );
    await assert.rejects(
      () => repository.updateRoutineIdentity(owner, routine.id, { isActive: true }),
      /unavailable exercise/,
    );
    assert.equal((await repository.getRoutineAggregate(owner, routine.id))?.isActive, false);
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("D1 entity repository applies Coach exercise updates and archives only at the expected revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-d1-exercise-cas-"));
  const database = join(directory, "repository.sqlite");
  const sqlite = new DatabaseSync(database);
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const owner = "owner@example.com";
  try {
    await ensureEntitySchema(d1);
    await ensureEntityData(d1, owner);
    const repository = new D1EntityRepository(d1);
    const created = await repository.createExercise(owner, {
      name: "CAS press",
      equipment: "machine",
      muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }],
    });
    const routine = await repository.createRoutine(owner, "CAS", singleSetRoutine(created.id, "CAS routine"));
    const intervening = await repository.updateExercise(owner, created.id, { instructions: "Intervening edit" });
    assert.ok(intervening);
    assert.notEqual(intervening.updatedAt, created.updatedAt);

    const staleUpdate = await repository.updateExerciseIfUnchanged(
      owner,
      created.id,
      created.updatedAt,
      "stale-plan",
      { ...intervening, name: "Stale overwrite", muscles: [] },
    );
    assert.equal(staleUpdate, null);
    assert.equal((await repository.getExercise(owner, created.id))?.instructions, "Intervening edit");

    const applied = await repository.updateExerciseIfUnchanged(
      owner,
      created.id,
      intervening.updatedAt,
      "fresh-plan",
      {
        name: "Updated CAS press",
        equipment: "machine",
        movementPattern: "push",
        trackingType: "reps",
        defaultLoadType: "bodyweight",
        sideMode: "bilateral",
        instructions: "Approved edit",
        muscles: [{ muscleGroup: "triceps", role: "primary", weight: 0.8 }],
      },
    );
    assert.equal(applied?.name, "Updated CAS press");
    assert.deepEqual(applied?.muscles, [{ muscleGroup: "triceps", role: "primary", weight: 0.8 }]);
    const projectedExercise = await d1.prepare(`SELECT name, load_type AS loadType FROM exercises
      WHERE owner_email = ? AND routine_code = 'CAS' AND exercise_order = 1`)
      .bind(owner).first<{ name: string; loadType: string }>();
    assert.equal(projectedExercise?.name, "Updated CAS press");
    assert.equal(projectedExercise?.loadType, "bodyweight");
    assert.equal(await repository.archiveExerciseIfUnchanged(owner, created.id, intervening.updatedAt), false);
    assert.equal(await repository.archiveExerciseIfUnchanged(owner, created.id, applied!.updatedAt), false);
    await repository.updateRoutineIdentity(owner, routine.id, { isActive: false });
    assert.equal(await repository.archiveExerciseIfUnchanged(owner, created.id, applied!.updatedAt), true);
    assert.equal((await repository.getExercise(owner, created.id))?.isActive, false);

    const currentExercise = await repository.createExercise(owner, { name: "Current routine movement" });
    const draftExercise = await repository.createExercise(owner, { name: "Draft-only movement" });
    const draftRoutine = await repository.createRoutine(owner, "DRAFT", singleSetRoutine(currentExercise.id, "Current"));
    const draftVersion = await repository.createRoutineVersion(
      owner,
      draftRoutine.id,
      singleSetRoutine(draftExercise.id, "Draft"),
    );
    assert.equal(
      await repository.archiveExerciseIfUnchanged(owner, draftExercise.id, draftExercise.updatedAt),
      false,
    );
    assert.equal(await repository.deleteRoutineVersion(owner, draftRoutine.id, draftVersion.id), true);
    assert.equal(
      await repository.archiveExerciseIfUnchanged(owner, draftExercise.id, draftExercise.updatedAt),
      true,
    );
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("routine publish compare-and-swap preserves the newer current version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-d1-routine-cas-"));
  const database = join(directory, "repository.sqlite");
  const sqlite = new DatabaseSync(database);
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const owner = "routine-cas@example.com";
  try {
    await ensureEntitySchema(d1);
    const repository = new D1EntityRepository(d1);
    const exercise = await repository.createExercise(owner, { name: "Routine CAS row" });
    const routine = await repository.createRoutine(owner, "RCAS", singleSetRoutine(exercise.id, "Base version"));
    const baseVersionId = routine.currentVersionId!;
    const firstDraft = await repository.createRoutineVersion(
      owner,
      routine.id,
      singleSetRoutine(exercise.id, "First accepted edit"),
    );
    const staleDraft = await repository.createRoutineVersion(
      owner,
      routine.id,
      singleSetRoutine(exercise.id, "Stale competing edit"),
    );

    const firstPublish = await repository.publishRoutineVersion(
      owner,
      routine.id,
      firstDraft.id,
      baseVersionId,
    );
    assert.equal(firstPublish?.currentVersionId, firstDraft.id);
    assert.equal(firstPublish?.currentVersion?.focus, "First accepted edit");

    const stalePublish = await repository.publishRoutineVersion(
      owner,
      routine.id,
      staleDraft.id,
      baseVersionId,
    );
    assert.equal(stalePublish, null);

    const reloaded = await repository.getRoutineAggregate(owner, routine.id);
    assert.equal(reloaded?.currentVersionId, firstDraft.id);
    assert.equal(reloaded?.currentVersion?.focus, "First accepted edit");
    const versions = await repository.listRoutineVersions(owner, routine.id);
    assert.equal(versions.find((version) => version.id === firstDraft.id)?.status, "published");
    assert.equal(versions.find((version) => version.id === staleDraft.id)?.status, "draft");
    assert.equal(versions.find((version) => version.id === baseVersionId)?.status, "superseded");
    const projected = await d1.prepare("SELECT focus, current_version_id AS currentVersionId FROM routines WHERE id = ?")
      .bind(routine.id).first<{ focus: string; currentVersionId: string }>();
    assert.equal(projected?.focus, "First accepted edit");
    assert.equal(projected?.currentVersionId, firstDraft.id);
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});
