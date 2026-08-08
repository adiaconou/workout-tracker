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
import {
  authenticateRequest,
  createNativeSession,
  ensureAppUser,
  isAllowedUserEmail,
  linkGoogleIdentity,
  rotateNativeSession,
} from "../server/auth";
import type { WorkerEnv } from "../server/types";

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
  private nextBatchHook: (() => void) | null = null;
  constructor(private database: DatabaseSync) {}
  prepare(sql: string) { return new SqliteStatement(this.database, sql); }
  beforeNextBatch(hook: () => void) { this.nextBatchHook = hook; }
  async batch(statements: SqliteStatement[]) {
    const hook = this.nextBatchHook;
    this.nextBatchHook = null;
    hook?.();
    return Promise.all(statements.map((statement) => statement.run()));
  }
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

test("authorizes a normalized multi-user allowlist across hosted and native sessions", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const firstEmail = "first@example.com";
  const secondEmail = "second@example.com";
  const env = {
    DB: d1,
    ALLOWED_USER_EMAILS: " FIRST@EXAMPLE.COM, second@example.com ",
    OWNER_EMAIL: "legacy-owner@example.com",
    AUTH_SESSION_SECRET: "test-session-secret-that-is-long-enough-for-signing",
  } as unknown as WorkerEnv;

  try {
    assert.equal(isAllowedUserEmail(env, " First@Example.com "), true);
    assert.equal(isAllowedUserEmail(env, secondEmail), true);
    assert.equal(isAllowedUserEmail(env, "third@example.com"), false);
    assert.equal(isAllowedUserEmail(env, "legacy-owner@example.com"), true);

    const firstHostedUser = await authenticateRequest(new Request("https://example.com/api/v1/auth/session", {
      headers: { "oai-authenticated-user-email": " First@Example.com " },
    }), env);
    const secondHostedUser = await authenticateRequest(new Request("https://example.com/api/v1/auth/session", {
      headers: { "oai-authenticated-user-email": secondEmail },
    }), env);
    const deniedHostedUser = await authenticateRequest(new Request("https://example.com/api/v1/auth/session", {
      headers: { "oai-authenticated-user-email": "third@example.com" },
    }), env);
    assert.equal(firstHostedUser?.email, firstEmail);
    assert.equal(secondHostedUser?.email, secondEmail);
    assert.notEqual(firstHostedUser?.id, secondHostedUser?.id);
    assert.equal(deniedHostedUser, null);

    const secondGoogleUser = await linkGoogleIdentity(env, {
      sub: "google-second",
      email: "SECOND@EXAMPLE.COM",
      email_verified: true,
      name: "Second User",
    });
    assert.equal(secondGoogleUser.ownerEmail, secondEmail);
    await assert.rejects(() => linkGoogleIdentity(env, {
      sub: "google-third",
      email: "third@example.com",
      email_verified: true,
      name: "Third User",
    }), /not authorized/);

    const firstUser = await ensureAppUser(env, firstEmail, "First User");
    const firstSession = await createNativeSession(env, firstUser, "First device");
    assert.equal((await authenticateRequest(new Request("https://example.com/api/v1/auth/session", {
      headers: { authorization: `Bearer ${firstSession.accessToken}` },
    }), env))?.email, firstEmail);

    const rotatedFirstSession = await rotateNativeSession(env, firstSession.refreshToken);
    assert.equal(rotatedFirstSession?.user.email, firstEmail);

    env.ALLOWED_USER_EMAILS = secondEmail;
    assert.equal(await authenticateRequest(new Request("https://example.com/api/v1/auth/session", {
      headers: { authorization: `Bearer ${rotatedFirstSession!.accessToken}` },
    }), env), null);
    assert.equal(await rotateNativeSession(env, rotatedFirstSession!.refreshToken), null);
    assert.ok((await d1.prepare("SELECT revoked_at AS revokedAt FROM auth_sessions WHERE user_id = ?")
      .bind(firstUser.id).first<{ revokedAt: string | null }>())?.revokedAt);
    await assert.rejects(
      () => createNativeSession(env, firstUser, "Unauthorized device"),
      /not authorized/,
    );

    const secondSession = await createNativeSession(env, secondGoogleUser, "Second device");
    assert.equal((await authenticateRequest(new Request("https://example.com/api/v1/auth/session", {
      headers: { authorization: `Bearer ${secondSession.accessToken}` },
    }), env))?.email, secondEmail);

    env.ALLOWED_USER_EMAILS = "";
    env.OWNER_EMAIL = " Legacy-Owner@Example.com ";
    assert.equal(isAllowedUserEmail(env, "legacy-owner@example.com"), true);
    assert.equal(isAllowedUserEmail(env, firstEmail), false);
  } finally {
    sqlite.close();
  }
});

test("persists a Google profile photo across hosted-web and refreshed native sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-profile-photo-"));
  const database = join(directory, "profile.sqlite");
  const sqlite = new DatabaseSync(database);
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const owner = "owner@example.com";
  const photoUrl = "https://lh3.googleusercontent.com/workout-owner";
  const env = {
    DB: d1,
    OWNER_EMAIL: owner,
    AUTH_SESSION_SECRET: "test-session-secret-that-is-long-enough-for-signing",
  } as unknown as WorkerEnv;

  try {
    const googleUser = await linkGoogleIdentity(env, {
      sub: "google-owner",
      email: owner,
      email_verified: true,
      name: "Workout Owner",
      picture: photoUrl,
    });
    assert.equal(googleUser.photoUrl, photoUrl);

    const hostedWebUser = await ensureAppUser(env, owner, "Workout Owner Updated");
    assert.equal(hostedWebUser.photoUrl, photoUrl);

    const nativeSession = await createNativeSession(env, hostedWebUser, "Test device");
    assert.equal(nativeSession.user.photoUrl, photoUrl);
    const rotatedSession = await rotateNativeSession(env, nativeSession.refreshToken);
    assert.equal(rotatedSession?.user.photoUrl, photoUrl);

    const invalidPhotoUpdate = await ensureAppUser(
      env,
      owner,
      "Workout Owner Updated",
      "javascript:alert(1)",
    );
    assert.equal(invalidPhotoUpdate.photoUrl, photoUrl);
    const stored = await d1.prepare(
      "SELECT photo_url AS photoUrl FROM app_users WHERE owner_email = ?",
    ).bind(owner).first<{ photoUrl: string | null }>();
    assert.equal(stored?.photoUrl, photoUrl);
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("workout history applies the rolling cutoff and returns finished sessions newest first", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-history-window-"));
  const database = join(directory, "history.sqlite");
  const sqlite = new DatabaseSync(database);
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const owner = "history-window@example.com";

  async function insertWorkout({
    id,
    routineCode,
    status,
    startedAt,
    completedAt,
    routineTitle,
    archived = false,
  }: {
    id: string;
    routineCode: string;
    status: "In Progress" | "Completed" | "Partial" | "Abandoned";
    startedAt: string;
    completedAt: string | null;
    routineTitle: string;
    archived?: boolean;
  }) {
    await d1.prepare(`INSERT INTO workout_sessions (
      id, owner_email, routine_code, routine_version, status, snapshot_json,
      current_exercise, current_set, completed_sets, skipped_sets, total_sets,
      started_at, completed_at, updated_at, is_archived
    ) VALUES (?, ?, ?, 1, ?, ?, 1, 1, 4, 0, 5, ?, ?, ?, ?)`)
      .bind(
        id,
        owner,
        routineCode,
        status,
        JSON.stringify({
          code: routineCode,
          version: 1,
          focus: routineTitle,
          summary: "History test",
          durationMin: 30,
          updatedAt: startedAt,
          exercises: [],
        }),
        startedAt,
        completedAt,
        completedAt ?? startedAt,
        archived ? 1 : 0,
      ).run();
  }

  try {
    await ensureEntitySchema(d1);
    await insertWorkout({
      id: "boundary-completed",
      routineCode: "A",
      status: "Completed",
      startedAt: "2026-07-31T12:00:00.000Z",
      completedAt: "2026-07-31T12:45:00.000Z",
      routineTitle: "Upper strength",
    });
    await insertWorkout({
      id: "recent-partial",
      routineCode: "B",
      status: "Partial",
      startedAt: "2026-08-06T10:00:00.000Z",
      completedAt: "2026-08-06T10:30:00.000Z",
      routineTitle: "Pull and shoulders",
    });
    await insertWorkout({
      id: "recent-abandoned",
      routineCode: "C",
      status: "Abandoned",
      startedAt: "2026-08-05T09:00:00.000Z",
      completedAt: "2026-08-05T09:10:00.000Z",
      routineTitle: "Legs and core",
    });
    await insertWorkout({
      id: "outside-window",
      routineCode: "D",
      status: "Completed",
      startedAt: "2026-07-31T11:59:59.999Z",
      completedAt: "2026-07-31T12:20:00.000Z",
      routineTitle: "Outside window",
    });
    await insertWorkout({
      id: "active-session",
      routineCode: "A",
      status: "In Progress",
      startedAt: "2026-08-07T10:00:00.000Z",
      completedAt: null,
      routineTitle: "Active workout",
    });
    await insertWorkout({
      id: "archived-session",
      routineCode: "A",
      status: "Completed",
      startedAt: "2026-08-07T11:00:00.000Z",
      completedAt: "2026-08-07T11:30:00.000Z",
      routineTitle: "Archived workout",
      archived: true,
    });

    const repository = new D1EntityRepository(d1);
    const page = await repository.listWorkoutHistory(owner, {
      from: "2026-07-31T12:00:00.000Z",
      limit: 50,
    });
    assert.deepEqual(
      page.workouts.map((workout) => ({
        id: workout.id,
        routineTitle: workout.routineTitle,
      })),
      [
        { id: "recent-partial", routineTitle: "Pull and shoulders" },
        { id: "recent-abandoned", routineTitle: "Legs and core" },
        { id: "boundary-completed", routineTitle: "Upper strength" },
      ],
    );
    assert.equal(page.stats.workoutCount, 3);
    assert.equal(page.hasMore, false);

    const completedOnly = await repository.listWorkoutHistory(owner, {
      from: "2026-07-31T12:00:00.000Z",
      status: "Completed",
      limit: 50,
    });
    assert.deepEqual(
      completedOnly.workouts.map((workout) => workout.id),
      ["boundary-completed"],
    );
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("exercise progress returns owner-scoped historical best working sets and reflects corrections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exercise-progress-"));
  const database = join(directory, "progress.sqlite");
  const sqlite = new DatabaseSync(database);
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const owner = "progress@example.com";
  const otherOwner = "someone-else@example.com";
  const exerciseId = "progress-bench";

  async function insertWorkout({
    id,
    workoutOwner = owner,
    status = "Completed",
    startedAt,
    archived = false,
    sets,
  }: {
    id: string;
    workoutOwner?: string;
    status?: "In Progress" | "Completed" | "Partial" | "Abandoned";
    startedAt: string;
    archived?: boolean;
    sets: Array<{ id: string; position: number; type?: string; weight: number; reps: number }>;
  }) {
    await d1.prepare(`INSERT INTO workout_sessions (
      id, owner_email, routine_code, routine_version, status, snapshot_json,
      current_exercise, current_set, completed_sets, skipped_sets, total_sets,
      started_at, completed_at, updated_at, is_archived
    ) VALUES (?, ?, 'A', 1, ?, ?, 1, 1, ?, 0, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        workoutOwner,
        status,
        JSON.stringify({ focus: `Historical ${id}` }),
        sets.length,
        sets.length,
        startedAt,
        status === "In Progress" ? null : startedAt,
        startedAt,
        archived ? 1 : 0,
      ).run();
    const workoutExerciseId = `${id}-exercise`;
    await d1.prepare(`INSERT INTO workout_exercises (
      id, owner_email, workout_id, exercise_id, position,
      exercise_name_snapshot, load_type_snapshot, side_mode_snapshot,
      status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, 'Bench press', 'external', 'bilateral',
      'completed', '', ?, ?)`)
      .bind(workoutExerciseId, workoutOwner, id, exerciseId, startedAt, startedAt).run();
    for (const set of sets) {
      await d1.prepare(`INSERT INTO workout_sets (
        id, owner_email, workout_id, workout_exercise_id, prescribed_set_id,
        position, set_type, planned_target_type, planned_target_display,
        planned_rest_sec, planned_rest_rule, actual_reps, actual_weight,
        weight_unit, status, completed_at, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reps', '5 reps', 120, 'standard',
        ?, ?, 'lb', 'completed', ?, '', ?, ?)`)
        .bind(
          set.id,
          workoutOwner,
          id,
          workoutExerciseId,
          `${id}-${set.position}`,
          set.position,
          set.type ?? "regular",
          set.reps,
          set.weight,
          startedAt,
          startedAt,
          startedAt,
        ).run();
    }
  }

  try {
    await ensureEntitySchema(d1);
    await d1.prepare(`INSERT INTO exercise_catalog (
      id, owner_email, name, normalized_name, equipment, movement_pattern,
      tracking_type, default_load_type, side_mode, instructions,
      is_active, created_at, updated_at
    ) VALUES (?, ?, 'Bench press', 'bench press', 'barbell', 'horizontal_push',
      'reps', 'external', 'bilateral', '', 1, ?, ?)`)
      .bind(exerciseId, owner, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z").run();
    await insertWorkout({
      id: "older",
      startedAt: "2026-07-01T18:00:00.000Z",
      sets: [
        { id: "older-best", position: 1, weight: 225, reps: 5 },
        { id: "older-heavy", position: 2, weight: 235, reps: 2 },
        { id: "older-warmup", position: 3, type: "warmup", weight: 300, reps: 5 },
      ],
    });
    await insertWorkout({
      id: "newer",
      status: "Partial",
      startedAt: "2026-08-01T18:00:00.000Z",
      sets: [
        { id: "newer-best", position: 1, weight: 230, reps: 5 },
        { id: "newer-heavy", position: 2, weight: 235, reps: 2 },
      ],
    });
    await insertWorkout({
      id: "active",
      status: "In Progress",
      startedAt: "2026-08-02T18:00:00.000Z",
      sets: [{ id: "active-set", position: 1, weight: 400, reps: 5 }],
    });
    await insertWorkout({
      id: "archived",
      archived: true,
      startedAt: "2026-08-03T18:00:00.000Z",
      sets: [{ id: "archived-set", position: 1, weight: 400, reps: 5 }],
    });
    await insertWorkout({
      id: "recent-ineligible",
      startedAt: "2026-08-05T18:00:00.000Z",
      sets: [{ id: "recent-ineligible-set", position: 1, weight: 100, reps: 20 }],
    });
    await insertWorkout({
      id: "other-owner",
      workoutOwner: otherOwner,
      startedAt: "2026-08-04T18:00:00.000Z",
      sets: [{ id: "other-owner-set", position: 1, weight: 500, reps: 5 }],
    });

    const repository = new D1EntityRepository(d1);
    const progress = await repository.getExerciseProgress(owner, exerciseId, {
      from: "2026-06-01T00:00:00.000Z",
      limit: 16,
    });
    assert.equal(progress?.metric, "epley_estimated_1rm");
    assert.equal(progress?.unit, "lb");
    assert.deepEqual(progress?.points.map((point) => ({
      workoutId: point.workoutId,
      setId: point.setId,
      routineTitle: point.routineTitle,
      status: point.workoutStatus,
    })), [
      { workoutId: "older", setId: "older-best", routineTitle: "Historical older", status: "Completed" },
      { workoutId: "newer", setId: "newer-best", routineTitle: "Historical newer", status: "Partial" },
    ]);
    const limited = await repository.getExerciseProgress(owner, exerciseId, {
      from: "2026-06-01T00:00:00.000Z",
      limit: 1,
    });
    assert.equal(limited?.points[0]?.workoutId, "newer");
    assert.equal(limited?.hasMore, true);
    assert.equal(await repository.getExerciseProgress(otherOwner, exerciseId), null);

    await d1.prepare("UPDATE workout_sets SET actual_weight = 200 WHERE id = ? AND owner_email = ?")
      .bind("newer-best", owner).run();
    const corrected = await repository.getExerciseProgress(owner, exerciseId, {
      from: "2026-06-01T00:00:00.000Z",
      limit: 16,
    });
    assert.equal(corrected?.points.at(-1)?.setId, "newer-heavy");
    assert.equal(corrected?.points.at(-1)?.performedAt, "2026-08-01T18:00:00.000Z");
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("D1 entity repository seeds, versions, publishes, materializes, discards, and archives normalized entities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-d1-repository-"));
  const database = join(directory, "repository.sqlite");
  const sqlite = new DatabaseSync(database);
  const sqliteD1 = new SqliteD1(sqlite);
  const d1 = sqliteD1 as unknown as D1Database;
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

    await assert.rejects(
      () => repository.createRoutine(
        owner,
        "BROKEN",
        singleSetRoutine("missing-exercise", "Must not persist"),
        "requested-broken-routine-id",
      ),
      /unavailable exercise/i,
    );
    assert.equal(await repository.getRoutineAggregate(owner, "BROKEN"), null);
    assert.equal(
      (await d1.prepare("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?")
        .bind("requested-broken-routine-id").first<{ count: number }>())?.count,
      0,
    );

    const cleanupRaceRoutine = await repository.createRoutine(
      owner,
      "CLEANUP-RACE",
      singleSetRoutine(seededExercises[0]!.id, "Cleanup race"),
      "cleanup-race-routine-id",
    );
    const cleanupRaceVersionId = cleanupRaceRoutine.currentVersionId!;
    await d1.prepare("UPDATE routines SET current_version_id = NULL WHERE id = ? AND owner_email = ?")
      .bind(cleanupRaceRoutine.id, owner).run();
    await d1.prepare("UPDATE routine_versions SET status = 'draft', published_at = NULL WHERE id = ? AND owner_email = ?")
      .bind(cleanupRaceVersionId, owner).run();
    sqliteD1.beforeNextBatch(() => {
      sqlite.prepare("UPDATE routines SET current_version_id = ? WHERE id = ? AND owner_email = ?")
        .run(cleanupRaceVersionId, cleanupRaceRoutine.id, owner);
      sqlite.prepare("UPDATE routine_versions SET status = 'published', published_at = ? WHERE id = ? AND owner_email = ?")
        .run(new Date().toISOString(), cleanupRaceVersionId, owner);
    });

    assert.equal(await repository.deleteUnpublishedRoutine(owner, cleanupRaceRoutine.id), false);
    assert.equal((await repository.getRoutineAggregate(owner, cleanupRaceRoutine.id))?.currentVersionId, cleanupRaceVersionId);
    assert.equal(
      (await d1.prepare("SELECT COUNT(*) AS count FROM routine_versions WHERE id = ?")
        .bind(cleanupRaceVersionId).first<{ count: number }>())?.count,
      1,
    );
    assert.equal(
      (await d1.prepare("SELECT COUNT(*) AS count FROM routine_version_exercises WHERE routine_version_id = ?")
        .bind(cleanupRaceVersionId).first<{ count: number }>())?.count,
      1,
    );
    assert.equal(
      (await d1.prepare(`SELECT COUNT(*) AS count FROM routine_set_templates WHERE routine_exercise_id IN (
        SELECT id FROM routine_version_exercises WHERE routine_version_id = ?
      )`).bind(cleanupRaceVersionId).first<{ count: number }>())?.count,
      1,
    );

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
