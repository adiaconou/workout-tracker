import { env } from "cloudflare:workers";
import {
  buildGuidedSets,
  type GuidedSet,
  type NormalizedWorkoutPrescription,
  type WorkoutPrescription,
  type WorkoutPrescriptionExercise,
} from "../../domain/workout";
import type {
  RecordedSetPerformance,
  RoutineSummary,
  WorkoutView,
} from "../../contracts/api";
import {
  buildRoutineRecommendations,
  type RecentCompletedSession,
  type RecentCompletedSet,
  type RecommendationResult,
  type RoutineProfiles,
  type MuscleGroup,
} from "../../domain/recommendations";
import { getEntityServices } from "../services";
import { kilogramsToPounds } from "../../domain/profile";
import { ensureEntityData, ensureEntitySchema, materializeWorkoutFromSnapshot } from "./entity-schema";
import { getPreviousPerformanceByExercise } from "./previous-performance";

type RawWorkoutSession = {
  id: string;
  routineCode: string;
  routineVersion: number;
  status: string;
  snapshotJson: string;
  currentExercise: number;
  currentSet: number;
  completedSets: number;
  skippedSets: number;
  totalSets: number;
  restEndsAt: string | null;
  lastPerformanceId: string | null;
  startedAt: string;
  completedAt: string | null;
  bodyWeight: number | null;
  bodyWeightSource: string | null;
  weightUnit: string;
};

type WorkoutMeasurementSnapshot = {
  bodyWeight: number | null;
  bodyWeightSource: "profile_snapshot" | "profile_backfill" | null;
  weightUnit: "lb" | "kg";
};

function db(): D1Database {
  if (!env.DB) throw new Error("The workout database is unavailable.");
  return env.DB;
}

async function getWorkoutMeasurementSnapshot(
  d1: D1Database,
  ownerEmail: string,
  source: "profile_snapshot" | "profile_backfill",
): Promise<WorkoutMeasurementSnapshot> {
  const profile = await d1.prepare(`SELECT body_weight_kg AS bodyWeightKg,
      measurement_system AS measurementSystem
      FROM app_users WHERE owner_email = ?`)
    .bind(ownerEmail)
    .first<{ bodyWeightKg: number | null; measurementSystem: string }>();
  const weightUnit = profile?.measurementSystem === "metric" ? "kg" : "lb";
  const bodyWeightKg = profile?.bodyWeightKg === null || profile?.bodyWeightKg === undefined
    ? null
    : Number(profile.bodyWeightKg);
  const bodyWeight = bodyWeightKg === null
    ? null
    : weightUnit === "kg"
      ? bodyWeightKg
      : kilogramsToPounds(bodyWeightKg);
  return {
    bodyWeight,
    bodyWeightSource: bodyWeight === null ? null : source,
    weightUnit,
  };
}

export async function ensureWorkoutSchema() {
  const d1 = db();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      code TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      focus TEXT NOT NULL,
      summary TEXT NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 60,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS routines_owner_code_idx ON routines(owner_email, code)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      routine_code TEXT NOT NULL,
      exercise_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      warmup TEXT NOT NULL,
      warmup_sets INTEGER NOT NULL DEFAULT 0,
      regular_sets INTEGER NOT NULL DEFAULT 0,
      failure_sets INTEGER NOT NULL DEFAULT 0,
      drop_sets INTEGER NOT NULL DEFAULT 0,
      target TEXT NOT NULL,
      rest TEXT NOT NULL,
      effort TEXT NOT NULL,
      purpose TEXT NOT NULL,
      load_type TEXT NOT NULL DEFAULT 'external',
      weight_unit TEXT NOT NULL DEFAULT 'lb',
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS exercises_owner_routine_order_idx ON exercises(owner_email, routine_code, exercise_order)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS workout_sessions (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      routine_code TEXT NOT NULL,
      routine_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      current_exercise INTEGER NOT NULL DEFAULT 1,
      current_set INTEGER NOT NULL DEFAULT 1,
      completed_sets INTEGER NOT NULL DEFAULT 0,
      skipped_sets INTEGER NOT NULL DEFAULT 0,
      total_sets INTEGER NOT NULL,
      rest_ends_at TEXT,
      last_performance_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      body_weight REAL,
      body_weight_source TEXT,
      weight_unit TEXT NOT NULL DEFAULT 'lb',
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_owner ON workout_sessions(owner_email) WHERE status = 'In Progress'"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS set_performances (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      session_id TEXT NOT NULL,
      prescribed_set_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      exercise_order INTEGER NOT NULL,
      exercise_name TEXT NOT NULL,
      set_order INTEGER NOT NULL,
      set_type TEXT NOT NULL,
      target_display TEXT NOT NULL,
      target_rest_sec INTEGER NOT NULL,
      rest_rule TEXT NOT NULL,
      actual_reps INTEGER,
      actual_duration_sec INTEGER,
      actual_weight REAL,
      weight_unit TEXT NOT NULL DEFAULT 'lb',
      status TEXT NOT NULL,
      started_at TEXT,
      performed_at TEXT NOT NULL,
      elapsed_seconds INTEGER,
      workout_elapsed_seconds INTEGER,
      rest_skipped INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS set_performances_session_set_idx ON set_performances(session_id, prescribed_set_id)"),
  ]);

  const columns = await d1.prepare("PRAGMA table_info(workout_sessions)").all<{ name: string }>();
  const columnNames = new Set(columns.results.map((column) => column.name));
  if (!columnNames.has("rest_ends_at")) {
    await d1.prepare("ALTER TABLE workout_sessions ADD COLUMN rest_ends_at TEXT").run();
  }
  if (!columnNames.has("last_performance_id")) {
    await d1.prepare("ALTER TABLE workout_sessions ADD COLUMN last_performance_id TEXT").run();
  }
  if (!columnNames.has("completed_at")) {
    await d1.prepare("ALTER TABLE workout_sessions ADD COLUMN completed_at TEXT").run();
  }
  if (!columnNames.has("body_weight")) {
    await d1.prepare("ALTER TABLE workout_sessions ADD COLUMN body_weight REAL").run();
  }
  if (!columnNames.has("body_weight_source")) {
    await d1.prepare("ALTER TABLE workout_sessions ADD COLUMN body_weight_source TEXT").run();
  }
  if (!columnNames.has("weight_unit")) {
    await d1.prepare("ALTER TABLE workout_sessions ADD COLUMN weight_unit TEXT NOT NULL DEFAULT 'lb'").run();
  }
  for (const [table, additions] of Object.entries({
    set_performances: {
      started_at: "TEXT",
      elapsed_seconds: "INTEGER",
      workout_elapsed_seconds: "INTEGER",
    },
    workout_sets: {
      started_at: "TEXT",
      elapsed_seconds: "INTEGER",
    },
  })) {
    const info = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const existing = new Set(info.results.map((column) => column.name));
    for (const [name, definition] of Object.entries(additions)) {
      if (!existing.has(name) && info.results.length) {
        await d1.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
      }
    }
  }
}

export async function ensureUserTrainingData(ownerEmail: string) {
  await ensureWorkoutSchema();
  const d1 = db();
  await ensureEntitySchema(d1);
  await ensureEntityData(d1, ownerEmail);
}

export async function getRoutineList(ownerEmail: string): Promise<RoutineSummary[]> {
  await ensureUserTrainingData(ownerEmail);
  const result = await db()
    .prepare(`SELECT r.code, r.version, r.focus, r.summary, r.duration_min AS durationMin,
      r.updated_at AS updatedAt, COUNT(e.id) AS exerciseCount,
      COALESCE(SUM(e.warmup_sets + e.regular_sets + e.failure_sets + e.drop_sets), 0) AS setCount,
      workout_history.completed_at AS lastWorkoutAt,
      workout_history.average_duration_seconds AS averageDurationSeconds,
      workout_history.duration_sample_count AS durationSampleCount
      FROM routines r
      LEFT JOIN exercises e ON e.owner_email = r.owner_email AND e.routine_code = r.code
      LEFT JOIN (
        SELECT owner_email, routine_code,
          MAX(completed_at) AS completed_at,
          ROUND(AVG(CASE WHEN status = 'Completed' THEN
            MAX(0, (julianday(completed_at) - julianday(started_at)) * 86400)
          END)) AS average_duration_seconds,
          SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS duration_sample_count
        FROM workout_sessions
        WHERE status IN ('Completed', 'Partial') AND completed_at IS NOT NULL
        GROUP BY owner_email, routine_code
      ) workout_history ON workout_history.owner_email = r.owner_email AND workout_history.routine_code = r.code
      WHERE r.owner_email = ? AND r.is_active = 1
      GROUP BY r.id
      ORDER BY r.code`)
    .bind(ownerEmail)
    .all<RoutineSummary>();
  return result.results.map((row) => ({
    ...row,
    version: Number(row.version),
    durationMin: Number(row.durationMin),
    exerciseCount: Number(row.exerciseCount),
    setCount: Number(row.setCount),
    lastWorkoutAt: row.lastWorkoutAt ?? null,
    averageDurationSeconds:
      row.averageDurationSeconds === null || row.averageDurationSeconds === undefined
        ? null
        : Number(row.averageDurationSeconds),
    durationSampleCount: Number(row.durationSampleCount ?? 0),
  }));
}

export async function getRoutineRecommendations(ownerEmail: string): Promise<RecommendationResult> {
  await ensureUserTrainingData(ownerEmail);
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const d1 = db();
  const [sessions, completedMuscleRows, profileRows, activeRoutineRows] = await Promise.all([
    d1
      .prepare(`SELECT r.code AS routineCode, ws.completed_at AS completedAt
        FROM workout_sessions ws
        INNER JOIN routines r
          ON r.owner_email = ws.owner_email AND r.is_active = 1
          AND (
            (ws.routine_id IS NOT NULL AND r.id = ws.routine_id)
            OR (ws.routine_id IS NULL AND r.code = ws.routine_code)
          )
        WHERE ws.owner_email = ? AND ws.status = 'Completed' AND ws.completed_at IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM routine_programs rp
              INNER JOIN routine_program_routines rpr
                ON rpr.program_id = rp.id AND rpr.routine_id = r.id
              WHERE rp.owner_email = ws.owner_email AND rp.is_active = 1
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM routine_programs active_program
                INNER JOIN routine_program_routines active_membership
                  ON active_membership.program_id = active_program.id
                INNER JOIN routines active_member
                  ON active_member.id = active_membership.routine_id
                  AND active_member.owner_email = active_program.owner_email
                  AND active_member.is_active = 1
                WHERE active_program.owner_email = ws.owner_email
                  AND active_program.is_active = 1
              )
              AND (
                r.code IN ('A', 'B', 'C', 'D')
                OR NOT EXISTS (
                  SELECT 1 FROM routines canonical
                  WHERE canonical.owner_email = ws.owner_email AND canonical.is_active = 1
                    AND canonical.code IN ('A', 'B', 'C', 'D')
                )
              )
            )
          )
        ORDER BY ws.completed_at DESC LIMIT 12`)
      .bind(ownerEmail)
      .all<RecentCompletedSession>(),
    d1
      .prepare(`SELECT COALESCE(source_routine.code, ws.routine_code) AS routineCode,
        sp.prescribed_set_id AS prescribedSetId,
        sp.exercise_order AS exerciseOrder, sp.set_type AS setType, sp.performed_at AS performedAt,
        normalized_set.actual_rir AS actualRir,
        em.muscle_group AS muscleGroup, em.weight AS muscleWeight
        FROM set_performances sp
        INNER JOIN workout_sessions ws ON ws.id = sp.session_id AND ws.owner_email = sp.owner_email
        LEFT JOIN routines source_routine
          ON source_routine.owner_email = ws.owner_email
          AND (
            (ws.routine_id IS NOT NULL AND source_routine.id = ws.routine_id)
            OR (ws.routine_id IS NULL AND source_routine.code = ws.routine_code)
          )
        INNER JOIN workout_exercises we
          ON we.owner_email = sp.owner_email
          AND we.workout_id = sp.session_id AND we.position = sp.exercise_order
        LEFT JOIN workout_sets normalized_set
          ON normalized_set.owner_email = sp.owner_email
          AND normalized_set.workout_id = sp.session_id
          AND normalized_set.prescribed_set_id = sp.prescribed_set_id
        INNER JOIN exercise_muscles em ON em.exercise_id = we.exercise_id
        WHERE sp.owner_email = ? AND sp.status = 'Completed' AND sp.performed_at >= ?
        ORDER BY sp.performed_at DESC`)
      .bind(ownerEmail, cutoff)
      .all<RecentCompletedSet & { prescribedSetId: string; muscleGroup: MuscleGroup; muscleWeight: number }>(),
    d1.prepare(`SELECT r.code AS routineCode, em.muscle_group AS muscleGroup,
        SUM(em.weight * CASE WHEN rst.set_type = 'warmup' THEN 0.25 WHEN rst.set_type IN ('failure', 'drop') THEN 1.25 ELSE 1 END) AS profileWeight
      FROM routines r
      INNER JOIN routine_version_exercises rve
        ON rve.owner_email = r.owner_email AND rve.routine_version_id = r.current_version_id
      INNER JOIN routine_set_templates rst
        ON rst.owner_email = r.owner_email AND rst.routine_exercise_id = rve.id
      INNER JOIN exercise_muscles em ON em.exercise_id = rve.exercise_id
      WHERE r.owner_email = ? AND r.is_active = 1
      GROUP BY r.code, em.muscle_group`)
      .bind(ownerEmail)
      .all<{ routineCode: string; muscleGroup: MuscleGroup; profileWeight: number }>(),
    d1.prepare(`SELECT code FROM (
        SELECT r.code AS code, rpr.position AS position, 0 AS source
        FROM routine_programs rp
        INNER JOIN routine_program_routines rpr ON rpr.program_id = rp.id
        INNER JOIN routines r ON r.id = rpr.routine_id AND r.owner_email = rp.owner_email
        WHERE rp.owner_email = ? AND rp.is_active = 1 AND r.is_active = 1
        UNION ALL
        SELECT r.code AS code,
          CASE r.code WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 ELSE 5 END AS position,
          1 AS source
        FROM routines r
        WHERE r.owner_email = ? AND r.is_active = 1
          AND NOT EXISTS (
            SELECT 1 FROM routine_programs active_program
            INNER JOIN routine_program_routines active_membership
              ON active_membership.program_id = active_program.id
            INNER JOIN routines active_member
              ON active_member.id = active_membership.routine_id
              AND active_member.owner_email = active_program.owner_email
              AND active_member.is_active = 1
            WHERE active_program.owner_email = r.owner_email
              AND active_program.is_active = 1
          )
          AND (
            r.code IN ('A', 'B', 'C', 'D')
            OR NOT EXISTS (
              SELECT 1 FROM routines canonical
              WHERE canonical.owner_email = r.owner_email AND canonical.is_active = 1
                AND canonical.code IN ('A', 'B', 'C', 'D')
            )
          )
      ) ORDER BY source, position, code`)
      .bind(ownerEmail, ownerEmail)
      .all<{ code: string }>(),
  ]);

  const completedSetMap = new Map<string, RecentCompletedSet>();
  for (const row of completedMuscleRows.results) {
    const key = `${row.routineCode}:${row.prescribedSetId}:${row.performedAt}`;
    const set = completedSetMap.get(key) ?? {
      routineCode: row.routineCode,
      exerciseOrder: Number(row.exerciseOrder),
      setType: row.setType,
      performedAt: row.performedAt,
      actualRir:
        row.actualRir === null || row.actualRir === undefined
          ? null
          : Number(row.actualRir),
      muscles: {},
    };
    set.muscles![row.muscleGroup] = Number(row.muscleWeight);
    completedSetMap.set(key, set);
  }
  const profiles: RoutineProfiles = {};
  for (const row of profileRows.results) {
    profiles[row.routineCode] ??= {};
    profiles[row.routineCode]![row.muscleGroup] = Number(row.profileWeight);
  }
  return buildRoutineRecommendations(
    sessions.results,
    [...completedSetMap.values()],
    new Date(),
    profiles,
    activeRoutineRows.results.map((routine) => routine.code),
  );
}

export async function getRoutine(ownerEmail: string, code: string): Promise<WorkoutPrescription | null> {
  await ensureUserTrainingData(ownerEmail);
  const routine = await db()
    .prepare("SELECT code, version, focus, summary, duration_min AS durationMin, updated_at AS updatedAt FROM routines WHERE owner_email = ? AND code = ?")
    .bind(ownerEmail, code.toUpperCase())
    .first<Omit<WorkoutPrescription, "exercises">>();
  if (!routine) return null;

  const exercises = await db()
    .prepare(`SELECT id, exercise_order AS exerciseOrder, name, warmup, warmup_sets AS warmupSets,
      regular_sets AS regularSets, failure_sets AS failureSets, drop_sets AS dropSets,
      target, rest, effort, purpose, load_type AS loadType, weight_unit AS weightUnit
      FROM exercises WHERE owner_email = ? AND routine_code = ? ORDER BY exercise_order`)
    .bind(ownerEmail, code.toUpperCase())
    .all<WorkoutPrescriptionExercise>();
  const aggregate = await getEntityServices().routines.get(ownerEmail, code);
  const catalogExerciseIdByPosition = new Map(
    aggregate?.currentVersion?.exercises.map((exercise) => [
      exercise.position,
      exercise.exerciseId,
    ]) ?? [],
  );

  return {
    ...routine,
    version: Number(routine.version),
    durationMin: Number(routine.durationMin),
    exercises: exercises.results.map((exercise) => ({
      ...exercise,
      exerciseId:
        catalogExerciseIdByPosition.get(Number(exercise.exerciseOrder)) ??
        exercise.id,
      exerciseOrder: Number(exercise.exerciseOrder),
      warmupSets: Number(exercise.warmupSets),
      regularSets: Number(exercise.regularSets),
      failureSets: Number(exercise.failureSets),
      dropSets: Number(exercise.dropSets),
    })),
  };
}

export class WorkoutRoutineVersionConflictError extends Error {
  constructor() {
    super("This routine changed before the workout started. Reload it and try again.");
    this.name = "WorkoutRoutineVersionConflictError";
  }
}

export async function startWorkout(
  ownerEmail: string,
  code: string,
  abandonActive = false,
  expectedRoutineVersionId?: string,
) {
  await ensureUserTrainingData(ownerEmail);
  const d1 = db();
  const requestedRoutine = await d1.prepare(`SELECT id, code, current_version_id AS currentVersionId
      FROM routines WHERE owner_email = ? AND is_active = 1 AND (id = ? OR code = ?)`)
    .bind(ownerEmail, code, code.toUpperCase()).first<{
      id: string;
      code: string;
      currentVersionId: string | null;
    }>();
  if (!requestedRoutine) return null;
  const requestedCode = requestedRoutine.code;
  const active = await d1
    .prepare(`SELECT id, routine_id AS routineId, routine_code AS routineCode,
      started_at AS startedAt, total_sets AS totalSets
      FROM workout_sessions WHERE owner_email = ? AND status = 'In Progress' LIMIT 1`)
    .bind(ownerEmail)
    .first<{
      id: string;
      routineId: string | null;
      routineCode: string;
      startedAt: string;
      totalSets: number;
    }>();
  const activeMatchesRequestedRoutine = active && (
    active.routineId === requestedRoutine.id
    || (active.routineId === null && active.routineCode === requestedCode)
  );
  if (activeMatchesRequestedRoutine) {
    await materializeWorkoutFromSnapshot(d1, ownerEmail, active.id);
    await initializeFirstWorkoutSet(d1, ownerEmail, active.id, active.startedAt);
    return {
      created: false,
      requiresConfirmation: false,
      session: {
        id: active.id,
        routineCode: active.routineCode,
        startedAt: active.startedAt,
        totalSets: active.totalSets,
      },
    };
  }
  if (expectedRoutineVersionId && requestedRoutine.currentVersionId !== expectedRoutineVersionId) {
    throw new WorkoutRoutineVersionConflictError();
  }
  if (active && !abandonActive) {
    return {
      created: false,
      requiresConfirmation: true,
      session: {
        id: active.id,
        routineCode: active.routineCode,
        startedAt: active.startedAt,
        totalSets: active.totalSets,
      },
    };
  }

  const services = getEntityServices();
  const [routine, aggregate, exactExpectedVersion, exerciseLibrary, measurementSnapshot] = await Promise.all([
    getRoutine(ownerEmail, requestedCode),
    services.routines.get(ownerEmail, requestedCode),
    expectedRoutineVersionId
      ? services.routines.getVersion(ownerEmail, requestedCode, expectedRoutineVersionId)
      : Promise.resolve(null),
    services.exercises.list(ownerEmail, { includeArchived: true }),
    getWorkoutMeasurementSnapshot(d1, ownerEmail, "profile_snapshot"),
  ]);
  if (!routine || !aggregate) return null;
  const currentVersion = expectedRoutineVersionId
    ? exactExpectedVersion
    : aggregate?.currentVersion;
  if (expectedRoutineVersionId && currentVersion?.id !== expectedRoutineVersionId) {
    throw new WorkoutRoutineVersionConflictError();
  }
  const catalogById = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const legacyExerciseByPosition = new Map(
    routine.exercises.map((exercise) => [exercise.exerciseOrder, exercise]),
  );
  const normalizedPrescription: NormalizedWorkoutPrescription | undefined = currentVersion
    ? {
        schemaVersion: 1,
        routineId: aggregate.id,
        routineVersionId: currentVersion.id,
        routineVersionNumber: currentVersion.versionNumber,
        exercises: [...currentVersion.exercises]
          .sort((left, right) => left.position - right.position)
          .map((exercise) => {
            const catalog = catalogById.get(exercise.exerciseId);
            const legacyExercise = legacyExerciseByPosition.get(exercise.position);
            return {
              sourceRoutineExerciseId: exercise.id,
              exerciseId: exercise.exerciseId,
              exerciseName: exercise.exerciseName,
              position: exercise.position,
              supersetGroup: exercise.supersetGroup,
              instructions: exercise.instructions,
              notes: exercise.notes,
              loadType: catalog?.defaultLoadType ?? "external",
              sideMode: catalog?.sideMode ?? exercise.sets[0]?.sideMode ?? "bilateral",
              weightUnit: measurementSnapshot.weightUnit,
              sets: [...exercise.sets]
                .sort((left, right) => left.position - right.position)
                .map((set) => ({
                  sourceRoutineSetId: set.id,
                  position: set.position,
                  setType: set.setType,
                  targetType: set.targetType,
                  targetMin: set.targetMin,
                  targetMax: set.targetMax,
                  targetDisplay: set.targetDisplay,
                  targetRirMin: set.targetRirMin,
                  targetRirMax: set.targetRirMax,
                  restAfterSec: set.restAfterSec,
                  restRule: set.restRule,
                  loadInstruction: set.loadInstruction,
                  sideMode: set.sideMode,
                  tempo: set.tempo,
                  notes: set.notes,
                })),
            };
          }),
      }
    : undefined;
  const snapshotRoutineBase = normalizedPrescription
    ? {
        ...routine,
        version: normalizedPrescription.routineVersionNumber,
        focus: currentVersion!.focus,
        summary: currentVersion!.summary,
        durationMin: currentVersion!.durationMin,
        updatedAt: currentVersion!.updatedAt,
        normalizedPrescription,
      }
    : routine;
  const snapshotRoutine = {
    ...snapshotRoutineBase,
    exercises: snapshotRoutineBase.exercises.map((exercise) => ({
      ...exercise,
      weightUnit: measurementSnapshot.weightUnit,
    })),
  };
  const now = new Date().toISOString();
  const totalSets = buildGuidedSets(snapshotRoutine).length;
  const id = crypto.randomUUID();
  const snapshotJson = JSON.stringify(snapshotRoutine);
  const createSession = expectedRoutineVersionId
    ? d1.prepare(`INSERT INTO workout_sessions (
      id, owner_email, routine_id, routine_version_id, routine_code, routine_version,
      status, snapshot_json,
      current_exercise, current_set, completed_sets, skipped_sets, total_sets,
        body_weight, body_weight_source, weight_unit, started_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, 'In Progress', ?, 1, 1, 0, 0, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM routines
        WHERE owner_email = ? AND code = ? AND current_version_id = ?
      )`)
      .bind(
        id, ownerEmail, requestedRoutine.id, currentVersion!.id,
        snapshotRoutine.code, snapshotRoutine.version, snapshotJson,
        totalSets, measurementSnapshot.bodyWeight, measurementSnapshot.bodyWeightSource,
        measurementSnapshot.weightUnit, now, now,
        ownerEmail, requestedCode, expectedRoutineVersionId,
      )
    : d1.prepare(`INSERT INTO workout_sessions (
        id, owner_email, routine_id, routine_version_id, routine_code, routine_version,
        status, snapshot_json,
        current_exercise, current_set, completed_sets, skipped_sets, total_sets,
        body_weight, body_weight_source, weight_unit, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'In Progress', ?, 1, 1, 0, 0, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id, ownerEmail, requestedRoutine.id, currentVersion?.id ?? requestedRoutine.currentVersionId,
        snapshotRoutine.code, snapshotRoutine.version, snapshotJson,
        totalSets, measurementSnapshot.bodyWeight, measurementSnapshot.bodyWeightSource,
        measurementSnapshot.weightUnit, now, now,
      );

  let createResult: D1Result<unknown>;
  if (active) {
    const abandonSession = expectedRoutineVersionId
      ? d1.prepare(`UPDATE workout_sessions SET status = 'Abandoned', completed_at = ?,
          rest_ends_at = NULL, body_weight = COALESCE(body_weight, ?),
          weight_unit = CASE WHEN body_weight IS NULL AND ? IS NOT NULL THEN ? ELSE weight_unit END,
          body_weight_source = CASE WHEN body_weight IS NULL AND ? IS NOT NULL THEN 'profile_backfill' ELSE body_weight_source END,
          updated_at = ?
          WHERE id = ? AND owner_email = ? AND status = 'In Progress'
          AND EXISTS (
            SELECT 1 FROM routines
            WHERE owner_email = ? AND code = ? AND current_version_id = ?
          )`)
        .bind(
          now, measurementSnapshot.bodyWeight,
          measurementSnapshot.bodyWeight, measurementSnapshot.weightUnit,
          measurementSnapshot.bodyWeight, now, active.id, ownerEmail,
          ownerEmail, requestedCode, expectedRoutineVersionId,
        )
      : d1.prepare(`UPDATE workout_sessions SET status = 'Abandoned', completed_at = ?,
          rest_ends_at = NULL, body_weight = COALESCE(body_weight, ?),
          weight_unit = CASE WHEN body_weight IS NULL AND ? IS NOT NULL THEN ? ELSE weight_unit END,
          body_weight_source = CASE WHEN body_weight IS NULL AND ? IS NOT NULL THEN 'profile_backfill' ELSE body_weight_source END,
          updated_at = ?
          WHERE id = ? AND owner_email = ? AND status = 'In Progress'`)
        .bind(
          now, measurementSnapshot.bodyWeight,
          measurementSnapshot.bodyWeight, measurementSnapshot.weightUnit,
          measurementSnapshot.bodyWeight, now, active.id, ownerEmail,
        );
    const results = await d1.batch([
      abandonSession,
      createSession,
    ]);
    createResult = results[1];
  } else {
    createResult = await createSession.run();
  }
  if (expectedRoutineVersionId && Number(createResult.meta.changes ?? 0) !== 1) {
    throw new WorkoutRoutineVersionConflictError();
  }
  await materializeWorkoutFromSnapshot(d1, ownerEmail, id);
  await initializeFirstWorkoutSet(d1, ownerEmail, id, now);

  return {
    created: true,
    requiresConfirmation: false,
    session: { id, routineCode: snapshotRoutine.code, startedAt: now, totalSets },
  };
}

async function initializeFirstWorkoutSet(
  d1: D1Database,
  ownerEmail: string,
  sessionId: string,
  startedAt: string,
) {
  await d1.batch([
    d1.prepare(`UPDATE workout_sets SET started_at = COALESCE(started_at, ?),
      status = CASE WHEN status = 'planned' THEN 'started' ELSE status END,
      updated_at = ? WHERE workout_id = ? AND owner_email = ? AND position = 1`)
      .bind(startedAt, startedAt, sessionId, ownerEmail),
    d1.prepare(`UPDATE workout_exercises SET status = CASE
      WHEN status = 'planned' THEN 'started' ELSE status END, updated_at = ?
      WHERE workout_id = ? AND owner_email = ? AND position = 1`)
      .bind(startedAt, sessionId, ownerEmail),
  ]);
}

async function getRawWorkoutSession(ownerEmail: string, sessionId: string) {
  await ensureWorkoutSchema();
  return db()
    .prepare(`SELECT id, routine_code AS routineCode, routine_version AS routineVersion,
      status, snapshot_json AS snapshotJson, current_exercise AS currentExercise,
      current_set AS currentSet, completed_sets AS completedSets, skipped_sets AS skippedSets,
      total_sets AS totalSets, rest_ends_at AS restEndsAt,
      last_performance_id AS lastPerformanceId, started_at AS startedAt,
      completed_at AS completedAt, body_weight AS bodyWeight,
      body_weight_source AS bodyWeightSource, weight_unit AS weightUnit
      FROM workout_sessions WHERE id = ? AND owner_email = ?`)
    .bind(sessionId, ownerEmail)
    .first<RawWorkoutSession>();
}

export async function getWorkoutSession(ownerEmail: string, sessionId: string): Promise<WorkoutView | null> {
  const session = await getRawWorkoutSession(ownerEmail, sessionId);
  if (!session) return null;
  const routine = JSON.parse(session.snapshotJson) as WorkoutPrescription;
  const sets = buildGuidedSets(routine);
  let restEndsAt = session.restEndsAt;
  if (restEndsAt && new Date(restEndsAt).getTime() <= Date.now()) {
    const endedAt = restEndsAt;
    restEndsAt = null;
    const d1 = db();
    const statements: D1PreparedStatement[] = [
      d1.prepare("UPDATE workout_sessions SET rest_ends_at = NULL WHERE id = ? AND owner_email = ?")
        .bind(sessionId, ownerEmail),
      d1.prepare(`UPDATE workout_sets SET started_at = COALESCE(started_at, ?),
        status = CASE WHEN status = 'planned' THEN 'started' ELSE status END,
        updated_at = ? WHERE workout_id = ? AND owner_email = ? AND position = ?`)
        .bind(endedAt, endedAt, sessionId, ownerEmail, Number(session.currentSet)),
    ];
    if (session.lastPerformanceId) {
      statements.push(d1.prepare(`UPDATE workout_sets SET
        actual_rest_sec = MAX(0, ROUND((julianday(?) - julianday(completed_at)) * 86400)),
        rest_ended_at = ?, updated_at = ? WHERE workout_id = ? AND prescribed_set_id = (
          SELECT prescribed_set_id FROM set_performances WHERE id = ? AND owner_email = ?
        ) AND owner_email = ? AND rest_ended_at IS NULL`)
        .bind(endedAt, endedAt, endedAt, sessionId, session.lastPerformanceId, ownerEmail, ownerEmail));
    }
    await d1.batch(statements);
  }

  if (session.status === "In Progress" && !restEndsAt && Number(session.currentSet) <= sets.length) {
    const fallbackStart = Number(session.currentSet) === 1
      ? session.startedAt
      : new Date().toISOString();
    await db().prepare(`UPDATE workout_sets SET started_at = COALESCE(started_at, ?),
      status = CASE WHEN status = 'planned' THEN 'started' ELSE status END,
      updated_at = CASE WHEN started_at IS NULL THEN ? ELSE updated_at END
      WHERE workout_id = ? AND owner_email = ? AND position = ?`)
      .bind(fallbackStart, fallbackStart, sessionId, ownerEmail, Number(session.currentSet))
      .run();
  }

  let currentRestSeconds = 0;
  if (session.lastPerformanceId) {
    const performance = await db()
      .prepare("SELECT target_rest_sec AS targetRestSec FROM set_performances WHERE id = ? AND owner_email = ?")
      .bind(session.lastPerformanceId, ownerEmail)
      .first<{ targetRestSec: number }>();
    currentRestSeconds = Number(performance?.targetRestSec ?? 0);
  }
  const previousPerformanceByExercise = await getPreviousPerformanceByExercise(
    db(),
    ownerEmail,
    sessionId,
    session.startedAt,
  );
  const recordedSetRows = await db()
    .prepare(`SELECT prescribed_set_id AS prescribedSetId,
      exercise_order AS exerciseOrder, actual_weight AS actualWeight,
      actual_reps AS actualReps, actual_duration_sec AS actualDurationSec,
      weight_unit AS weightUnit, status
      FROM set_performances
      WHERE session_id = ? AND owner_email = ? AND status IN ('Completed', 'Skipped')
      ORDER BY set_order`)
    .bind(sessionId, ownerEmail)
    .all<{
      prescribedSetId: string;
      exerciseOrder: number;
      actualWeight: number | null;
      actualReps: number | null;
      actualDurationSec: number | null;
      weightUnit: string;
      status: string;
    }>();
  const recordedPerformanceBySetId: WorkoutView["recordedPerformanceBySetId"] = {};
  const lastCompletedSetByExercise: WorkoutView["lastCompletedSetByExercise"] = {};
  for (const row of recordedSetRows.results) {
    const status = row.status === "Skipped" ? "Skipped" : "Completed";
    recordedPerformanceBySetId[row.prescribedSetId] = {
      status,
      actualWeight: row.actualWeight === null ? null : Number(row.actualWeight),
      actualReps: row.actualReps === null ? null : Number(row.actualReps),
      actualDurationSec:
        row.actualDurationSec === null ? null : Number(row.actualDurationSec),
      weightUnit: row.weightUnit,
    };
    if (status !== "Completed" || row.actualWeight === null) continue;
    lastCompletedSetByExercise[Number(row.exerciseOrder)] = {
      actualWeight: Number(row.actualWeight),
      actualReps: row.actualReps === null ? null : Number(row.actualReps),
    };
  }

  const timingNow = Date.now();
  const workoutStart = new Date(session.startedAt).getTime();
  const workoutEnd = session.completedAt
    ? new Date(session.completedAt).getTime()
    : timingNow;
  const workoutElapsedSeconds = elapsedSecondsBetween(workoutStart, workoutEnd);
  const currentSetTiming = Number(session.currentSet) <= sets.length
    ? await db().prepare(`SELECT started_at AS startedAt FROM workout_sets
        WHERE workout_id = ? AND owner_email = ? AND position = ?`)
      .bind(sessionId, ownerEmail, Number(session.currentSet))
      .first<{ startedAt: string | null }>()
    : null;
  const currentSetElapsedSeconds = currentSetTiming?.startedAt && !restEndsAt
    ? elapsedSecondsBetween(new Date(currentSetTiming.startedAt).getTime(), timingNow)
    : 0;

  return {
    ...session,
    routineVersion: Number(session.routineVersion),
    currentExercise: Number(session.currentExercise),
    currentSet: Number(session.currentSet),
    completedSets: Number(session.completedSets),
    skippedSets: Number(session.skippedSets),
    totalSets: Number(session.totalSets),
    bodyWeight: session.bodyWeight === null ? null : Number(session.bodyWeight),
    restEndsAt,
    routine,
    sets,
    currentSetIndex: Math.max(0, Math.min(sets.length, Number(session.currentSet) - 1)),
    currentRestSeconds,
    workoutElapsedSeconds,
    currentSetElapsedSeconds,
    previousPerformanceByExercise,
    recordedPerformanceBySetId,
    lastCompletedSetByExercise,
  };
}

function elapsedSecondsBetween(startMs: number, endMs: number) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function wholeElapsedSecondsBetween(startMs: number, endMs: number) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

type RecordSetInput = {
  prescribedSetId?: string;
  status?: "Completed" | "Skipped";
  actualReps?: number | null;
  actualDurationSec?: number | null;
  actualWeight?: number | null;
  workoutElapsedSeconds?: number | null;
};

function cleanNonNegativeNumber(value: unknown, allowDecimal = false) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return allowDecimal ? Math.round(number * 100) / 100 : Math.round(number);
}

function effectiveRestSecondsForSet(sets: GuidedSet[], currentIndex: number) {
  const current = sets[currentIndex];
  if (!current) return 0;
  const group = current.supersetGroup?.trim() || null;
  if (!group) return current.restSeconds;

  const next = sets[currentIndex + 1];
  if (
    next &&
    (next.supersetGroup?.trim() || null) === group &&
    next.exerciseSetNumber === current.exerciseSetNumber
  ) {
    return 0;
  }

  const deferredRest = sets
    .filter(
      (set) =>
        (set.supersetGroup?.trim() || null) === group &&
        set.exerciseSetNumber === current.exerciseSetNumber &&
        set.restRule === "after_superset",
    )
    .map((set) => set.restSeconds);
  return deferredRest.length ? Math.max(...deferredRest) : current.restSeconds;
}

export async function recordWorkoutSet(ownerEmail: string, sessionId: string, input: RecordSetInput) {
  const session = await getRawWorkoutSession(ownerEmail, sessionId);
  if (!session) return null;
  if (session.status !== "In Progress") {
    const existing = input.prescribedSetId
      ? await db().prepare(`SELECT id AS performanceId,
          workout_elapsed_seconds AS workoutElapsedSeconds
          FROM set_performances WHERE session_id = ? AND owner_email = ?
          AND prescribed_set_id = ?`)
        .bind(sessionId, ownerEmail, input.prescribedSetId)
        .first<{ performanceId: string; workoutElapsedSeconds: number | null }>()
      : null;
    if (existing) {
      return {
        performanceId: existing.performanceId,
        completedSets: Number(session.completedSets),
        skippedSets: Number(session.skippedSets),
        nextSetIndex: Math.max(0, Number(session.currentSet) - 1),
        restSeconds: 0,
        restEndsAt: null,
        workoutCompleted:
          session.status === "Completed" || session.status === "Partial",
        workoutElapsedSeconds: Number(existing.workoutElapsedSeconds ??
          elapsedSecondsBetween(
            new Date(session.startedAt).getTime(),
            new Date(session.completedAt ?? session.startedAt).getTime(),
          )),
      };
    }
    throw new Error("This workout is no longer in progress.");
  }

  const routine = JSON.parse(session.snapshotJson) as WorkoutPrescription;
  const sets = buildGuidedSets(routine);
  const currentIndex = Math.max(0, Number(session.currentSet) - 1);
  const prescribedSet = sets[currentIndex];
  if (!prescribedSet) throw new Error("This workout has no remaining sets.");
  if (input.prescribedSetId !== prescribedSet.id) {
    const existing = input.prescribedSetId
      ? await db().prepare(`SELECT id AS performanceId, target_rest_sec AS restSeconds,
          workout_elapsed_seconds AS workoutElapsedSeconds
          FROM set_performances WHERE session_id = ? AND owner_email = ?
          AND prescribed_set_id = ?`)
        .bind(sessionId, ownerEmail, input.prescribedSetId)
        .first<{ performanceId: string; restSeconds: number; workoutElapsedSeconds: number | null }>()
      : null;
    if (existing) {
      return {
        performanceId: existing.performanceId,
        completedSets: Number(session.completedSets),
        skippedSets: Number(session.skippedSets),
        nextSetIndex: Math.max(0, Number(session.currentSet) - 1),
        restSeconds: session.restEndsAt ? Number(existing.restSeconds) : 0,
        restEndsAt: session.restEndsAt,
        workoutCompleted: false,
        workoutElapsedSeconds: elapsedSecondsBetween(
          new Date(session.startedAt).getTime(),
          session.completedAt ? new Date(session.completedAt).getTime() : Date.now(),
        ),
      };
    }
    throw new Error("The workout has already advanced. Refresh to continue from the current set.");
  }

  const status = input.status === "Skipped" ? "Skipped" : "Completed";
  const actualWeight = cleanNonNegativeNumber(input.actualWeight, true);
  const actualReps = cleanNonNegativeNumber(input.actualReps);
  const actualDurationSec = cleanNonNegativeNumber(input.actualDurationSec);
  if (status === "Completed" && actualWeight === null) throw new Error("Enter the weight used for this set.");
  if (status === "Completed" && prescribedSet.targetUnit !== "seconds" && actualReps === null) {
    throw new Error(`Enter the ${prescribedSet.targetUnit === "rounds" ? "rounds" : "reps"} completed for this set.`);
  }
  if (status === "Completed" && prescribedSet.targetUnit === "seconds" && actualDurationSec === null) {
    throw new Error("Enter the seconds completed for this set.");
  }
  const recordedActualReps = status === "Completed" && prescribedSet.targetUnit !== "seconds"
    ? actualReps
    : null;
  const recordedActualDurationSec = status === "Completed" && prescribedSet.targetUnit === "seconds"
    ? actualDurationSec
    : null;

  const receivedAtMs = Date.now();
  const receivedAt = new Date(receivedAtMs).toISOString();
  const sessionStartedAtMs = new Date(session.startedAt).getTime();
  const serverWorkoutElapsedSeconds = wholeElapsedSecondsBetween(sessionStartedAtMs, receivedAtMs);
  const suppliedWorkoutElapsedSeconds = cleanNonNegativeNumber(input.workoutElapsedSeconds);
  const priorRestEndsAtMs = session.restEndsAt ? new Date(session.restEndsAt).getTime() : Number.NaN;
  const priorRestWasSkipped = Number.isFinite(priorRestEndsAtMs) && priorRestEndsAtMs > receivedAtMs;
  const priorRestFinishedAt = Number.isFinite(priorRestEndsAtMs)
    ? priorRestWasSkipped ? receivedAt : session.restEndsAt
    : null;
  const currentTiming = await db().prepare(`SELECT started_at AS startedAt
      FROM workout_sets WHERE workout_id = ? AND owner_email = ? AND prescribed_set_id = ?`)
    .bind(sessionId, ownerEmail, prescribedSet.id)
    .first<{ startedAt: string | null }>();
  const setStartedAt = currentTiming?.startedAt
    ?? priorRestFinishedAt
    ?? (currentIndex === 0 ? session.startedAt : receivedAt);
  const setStartedOffsetSeconds = wholeElapsedSecondsBetween(
    sessionStartedAtMs,
    new Date(setStartedAt).getTime(),
  );
  const requestedWorkoutElapsedSeconds = Math.max(
    setStartedOffsetSeconds,
    Math.min(suppliedWorkoutElapsedSeconds ?? serverWorkoutElapsedSeconds, serverWorkoutElapsedSeconds),
  );
  const setStartedAtMs = new Date(setStartedAt).getTime();
  const occurredAtMs = Math.min(
    receivedAtMs,
    Math.max(setStartedAtMs, sessionStartedAtMs + requestedWorkoutElapsedSeconds * 1000),
  );
  const workoutElapsedSeconds = wholeElapsedSecondsBetween(sessionStartedAtMs, occurredAtMs);
  const occurredAt = new Date(occurredAtMs).toISOString();
  const setElapsedSeconds = elapsedSecondsBetween(setStartedAtMs, occurredAtMs);
  const effectiveRestSeconds = effectiveRestSecondsForSet(sets, currentIndex);
  const performanceId = `${sessionId}::${prescribedSet.id}`;
  const d1 = db();
  const nextSetIndex = currentIndex + 1;
  const workoutCompleted = nextSetIndex >= sets.length;
  const completionMeasurement = workoutCompleted && session.bodyWeight === null
    ? await getWorkoutMeasurementSnapshot(d1, ownerEmail, "profile_backfill")
    : null;
  const plannedRestEndsAtMs = occurredAtMs + effectiveRestSeconds * 1000;
  const restIsActive = !workoutCompleted && effectiveRestSeconds > 0 && plannedRestEndsAtMs > receivedAtMs;
  const restEndsAt = restIsActive ? new Date(plannedRestEndsAtMs).toISOString() : null;
  const restSeconds = restEndsAt
    ? Math.max(0, Math.ceil((plannedRestEndsAtMs - receivedAtMs) / 1000))
    : 0;
  const restEndedAt = effectiveRestSeconds > 0 && !workoutCompleted && !restIsActive
    ? receivedAt
    : null;
  const actualRestSeconds = effectiveRestSeconds === 0 || workoutCompleted
    ? 0
    : restEndedAt
      ? elapsedSecondsBetween(occurredAtMs, receivedAtMs)
      : null;
  const nextSet = sets[nextSetIndex];
  const completedSets = Number(session.completedSets) + (status === "Completed" ? 1 : 0);
  const skippedSets = Number(session.skippedSets) + (status === "Skipped" ? 1 : 0);
  const statements: D1PreparedStatement[] = [
    d1.prepare(`INSERT INTO set_performances (
      id, owner_email, session_id, prescribed_set_id, exercise_id, exercise_order,
      exercise_name, set_order, set_type, target_display, target_rest_sec, rest_rule,
      actual_reps, actual_duration_sec, actual_weight, weight_unit, status,
      performed_at, started_at, elapsed_seconds, workout_elapsed_seconds,
      rest_skipped, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?)
    ON CONFLICT(id) DO NOTHING`)
      .bind(
      performanceId, ownerEmail, sessionId, prescribedSet.id, prescribedSet.exerciseId,
      prescribedSet.exerciseOrder, prescribedSet.exerciseName, prescribedSet.globalIndex + 1,
      prescribedSet.setType, prescribedSet.target, effectiveRestSeconds,
      prescribedSet.restRule, recordedActualReps,
      recordedActualDurationSec,
      status === "Completed" ? actualWeight : null, prescribedSet.weightUnit,
      status, occurredAt, setStartedAt,
      setElapsedSeconds, workoutElapsedSeconds, receivedAt, receivedAt),
    d1.prepare(`UPDATE workout_sets SET actual_reps = ?, actual_duration_sec = ?, actual_weight = ?,
      started_at = COALESCE(started_at, ?), elapsed_seconds = COALESCE(elapsed_seconds, ?),
      status = ?, completed_at = COALESCE(completed_at, ?), rest_started_at = ?,
      rest_ended_at = ?, actual_rest_sec = ?, updated_at = ?
      WHERE workout_id = ? AND prescribed_set_id = ? AND owner_email = ?
        AND status IN ('planned', 'started')`)
      .bind(recordedActualReps, recordedActualDurationSec,
        status === "Completed" ? actualWeight : null, setStartedAt, setElapsedSeconds,
        status.toLowerCase(), occurredAt, effectiveRestSeconds > 0 && !workoutCompleted ? occurredAt : null,
        restEndedAt, actualRestSeconds, receivedAt, sessionId, prescribedSet.id, ownerEmail),
  ];
  if (priorRestFinishedAt && session.lastPerformanceId) {
    statements.unshift(d1.prepare(`UPDATE workout_sets SET
      actual_rest_sec = MAX(0, ROUND((julianday(?) - julianday(completed_at)) * 86400)),
      rest_ended_at = ?, rest_skipped = CASE WHEN ? THEN 1 ELSE rest_skipped END,
      updated_at = ? WHERE workout_id = ? AND prescribed_set_id = (
        SELECT prescribed_set_id FROM set_performances WHERE id = ? AND owner_email = ?
      ) AND owner_email = ? AND rest_ended_at IS NULL`)
      .bind(priorRestFinishedAt, priorRestFinishedAt, priorRestWasSkipped ? 1 : 0,
        receivedAt, sessionId,
        session.lastPerformanceId, ownerEmail, ownerEmail));
    if (priorRestWasSkipped) {
      statements.unshift(d1.prepare(`UPDATE set_performances SET rest_skipped = 1,
        updated_at = ? WHERE id = ? AND owner_email = ?`)
        .bind(receivedAt, session.lastPerformanceId, ownerEmail));
    }
  }

  if (workoutCompleted) {
    statements.push(d1.prepare(`UPDATE workout_sessions SET status = 'Completed', current_set = ?,
        completed_sets = ?, skipped_sets = ?, rest_ends_at = NULL,
        last_performance_id = ?, completed_at = ?,
        body_weight = COALESCE(body_weight, ?),
        weight_unit = CASE WHEN body_weight IS NULL AND ? IS NOT NULL THEN ? ELSE weight_unit END,
        body_weight_source = CASE WHEN body_weight IS NULL AND ? IS NOT NULL THEN ? ELSE body_weight_source END,
        updated_at = ?
        WHERE id = ? AND owner_email = ? AND status = 'In Progress' AND current_set = ?`)
      .bind(sets.length + 1, completedSets, skippedSets, performanceId, occurredAt,
        completionMeasurement?.bodyWeight ?? null,
        completionMeasurement?.bodyWeight ?? null, completionMeasurement?.weightUnit ?? "lb",
        completionMeasurement?.bodyWeight ?? null, completionMeasurement?.bodyWeightSource ?? null,
        receivedAt, sessionId, ownerEmail, currentIndex + 1));
  } else {
    statements.push(d1.prepare(`UPDATE workout_sessions SET current_exercise = ?, current_set = ?,
        completed_sets = ?, skipped_sets = ?, rest_ends_at = ?,
        last_performance_id = ?, updated_at = ?
        WHERE id = ? AND owner_email = ? AND status = 'In Progress' AND current_set = ?`)
      .bind(nextSet.exerciseOrder, nextSetIndex + 1, completedSets, skippedSets,
        restEndsAt, performanceId, receivedAt, sessionId, ownerEmail, currentIndex + 1));
    if (!restIsActive) {
      statements.push(d1.prepare(`UPDATE workout_sets SET started_at = COALESCE(started_at, ?),
        status = CASE WHEN status = 'planned' THEN 'started' ELSE status END, updated_at = ?
        WHERE workout_id = ? AND owner_email = ? AND position = ?`)
        .bind(receivedAt, receivedAt, sessionId, ownerEmail, nextSetIndex + 1));
      statements.push(d1.prepare(`UPDATE workout_exercises SET status = CASE
        WHEN status = 'planned' THEN 'started' ELSE status END, updated_at = ?
        WHERE workout_id = ? AND owner_email = ? AND position = ?`)
        .bind(receivedAt, sessionId, ownerEmail, nextSet.exerciseOrder));
    }
  }
  statements.push(d1.prepare(`UPDATE workout_exercises SET status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM workout_sets ws WHERE ws.workout_exercise_id = workout_exercises.id AND ws.status IN ('planned', 'started')) THEN 'completed'
      ELSE 'started' END, updated_at = ?
    WHERE workout_id = ? AND position = ? AND owner_email = ?`)
    .bind(receivedAt, sessionId, prescribedSet.exerciseOrder, ownerEmail));
  await d1.batch(statements);

  return {
    performanceId,
    completedSets,
    skippedSets,
    nextSetIndex,
    restSeconds,
    restEndsAt,
    workoutCompleted,
    workoutElapsedSeconds,
  };
}

export async function skipWorkoutRest(ownerEmail: string, sessionId: string) {
  const session = await getRawWorkoutSession(ownerEmail, sessionId);
  if (!session) return null;
  if (session.status !== "In Progress") throw new Error("This workout is no longer in progress.");
  if (!session.restEndsAt) return { skipped: false };
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const scheduledEndMs = new Date(session.restEndsAt).getTime();
  const restWasSkipped = !Number.isFinite(scheduledEndMs) || scheduledEndMs > nowMs;
  const restEndedAt = restWasSkipped ? now : session.restEndsAt;
  const d1 = db();
  const statements: D1PreparedStatement[] = [
    d1
      .prepare("UPDATE workout_sessions SET rest_ends_at = NULL, updated_at = ? WHERE id = ? AND owner_email = ?")
      .bind(now, sessionId, ownerEmail),
    d1.prepare(`UPDATE workout_sets SET started_at = COALESCE(started_at, ?),
      status = CASE WHEN status = 'planned' THEN 'started' ELSE status END,
      updated_at = CASE WHEN started_at IS NULL THEN ? ELSE updated_at END
      WHERE workout_id = ? AND owner_email = ? AND position = ?`)
      .bind(restEndedAt, now, sessionId, ownerEmail, Number(session.currentSet)),
    d1.prepare(`UPDATE workout_exercises SET status = CASE
      WHEN status = 'planned' THEN 'started' ELSE status END, updated_at = ?
      WHERE workout_id = ? AND owner_email = ? AND position = ?`)
      .bind(now, sessionId, ownerEmail, Number(session.currentExercise)),
  ];
  if (session.lastPerformanceId) {
    if (restWasSkipped) {
      statements.push(
        d1
          .prepare("UPDATE set_performances SET rest_skipped = 1, updated_at = ? WHERE id = ? AND owner_email = ?")
          .bind(now, session.lastPerformanceId, ownerEmail),
      );
    }
    statements.push(
      d1.prepare(`UPDATE workout_sets SET
        rest_skipped = CASE WHEN ? THEN 1 ELSE rest_skipped END,
        actual_rest_sec = MAX(0, ROUND((julianday(?) - julianday(completed_at)) * 86400)),
        rest_ended_at = ?, updated_at = ? WHERE workout_id = ? AND prescribed_set_id = (
          SELECT prescribed_set_id FROM set_performances WHERE id = ? AND owner_email = ?
        ) AND owner_email = ? AND rest_ended_at IS NULL`)
        .bind(restWasSkipped ? 1 : 0, restEndedAt, restEndedAt, now, sessionId,
          session.lastPerformanceId, ownerEmail, ownerEmail),
    );
  }
  await d1.batch(statements);
  return { skipped: restWasSkipped };
}

export async function completeWorkoutEarly(
  ownerEmail: string,
  sessionId: string,
  input: { workoutElapsedSeconds?: number | null } = {},
) {
  const session = await getRawWorkoutSession(ownerEmail, sessionId);
  if (!session) return null;
  if (session.status === "Completed" || session.status === "Partial") {
    return {
      completedSets: Number(session.completedSets),
      skippedSets: Number(session.skippedSets),
      remainingSetsSkipped: 0,
      workoutCompleted: true as const,
      endedEarly: session.status === "Partial",
      workoutElapsedSeconds: elapsedSecondsBetween(
        new Date(session.startedAt).getTime(),
        new Date(session.completedAt ?? session.startedAt).getTime(),
      ),
    };
  }
  if (session.status !== "In Progress") {
    throw new Error("This workout is no longer in progress.");
  }

  const routine = JSON.parse(session.snapshotJson) as WorkoutPrescription;
  const sets = buildGuidedSets(routine);
  const currentIndex = Math.max(0, Math.min(sets.length, Number(session.currentSet) - 1));
  const remainingSets = sets.slice(currentIndex);
  const receivedAtMs = Date.now();
  const receivedAt = new Date(receivedAtMs).toISOString();
  const sessionStartedAtMs = new Date(session.startedAt).getTime();
  const serverWorkoutElapsedSeconds = wholeElapsedSecondsBetween(sessionStartedAtMs, receivedAtMs);
  const requestedWorkoutElapsedSeconds = Math.min(
    cleanNonNegativeNumber(input.workoutElapsedSeconds) ?? serverWorkoutElapsedSeconds,
    serverWorkoutElapsedSeconds,
  );
  const d1 = db();
  const timingRows = await d1.prepare(`SELECT prescribed_set_id AS prescribedSetId,
      started_at AS startedAt FROM workout_sets WHERE workout_id = ? AND owner_email = ?`)
    .bind(sessionId, ownerEmail)
    .all<{ prescribedSetId: string; startedAt: string | null }>();
  const timingBySet = new Map(timingRows.results.map((row) => [row.prescribedSetId, row.startedAt]));
  const priorRestEndsAtMs = session.restEndsAt ? new Date(session.restEndsAt).getTime() : Number.NaN;
  const requestedOccurredAtMs = sessionStartedAtMs + requestedWorkoutElapsedSeconds * 1000;
  const naturallyStartedCurrentSetAt = Number.isFinite(priorRestEndsAtMs) &&
      priorRestEndsAtMs <= requestedOccurredAtMs
    ? session.restEndsAt
    : null;
  const currentStartedAt = remainingSets[0]
    ? timingBySet.get(remainingSets[0].id) ?? naturallyStartedCurrentSetAt
    : null;
  const currentStartedOffsetSeconds = currentStartedAt
    ? wholeElapsedSecondsBetween(sessionStartedAtMs, new Date(currentStartedAt).getTime())
    : 0;
  const resolvedWorkoutElapsedSeconds = Math.max(
    requestedWorkoutElapsedSeconds,
    currentStartedOffsetSeconds,
  );
  const currentStartedAtMs = currentStartedAt
    ? new Date(currentStartedAt).getTime()
    : sessionStartedAtMs;
  const occurredAtMs = Math.min(
    receivedAtMs,
    Math.max(currentStartedAtMs, sessionStartedAtMs + resolvedWorkoutElapsedSeconds * 1000),
  );
  const workoutElapsedSeconds = wholeElapsedSecondsBetween(sessionStartedAtMs, occurredAtMs);
  const occurredAt = new Date(occurredAtMs).toISOString();
  const priorRestWasSkipped = Number.isFinite(priorRestEndsAtMs) && priorRestEndsAtMs > occurredAtMs;
  const priorRestFinishedAt = Number.isFinite(priorRestEndsAtMs)
    ? priorRestWasSkipped ? occurredAt : session.restEndsAt
    : null;
  const completionMeasurement = session.bodyWeight === null
    ? await getWorkoutMeasurementSnapshot(d1, ownerEmail, "profile_backfill")
    : null;

  const statements: D1PreparedStatement[] = remainingSets.map((set) => {
    const startedAt = timingBySet.get(set.id)
      ?? (set.id === remainingSets[0]?.id ? naturallyStartedCurrentSetAt : null);
    const elapsedSeconds = startedAt
      ? elapsedSecondsBetween(new Date(startedAt).getTime(), occurredAtMs)
      : null;
    return d1.prepare(`INSERT INTO set_performances (
      id, owner_email, session_id, prescribed_set_id, exercise_id, exercise_order,
      exercise_name, set_order, set_type, target_display, target_rest_sec, rest_rule,
      actual_reps, actual_duration_sec, actual_weight, weight_unit, status,
      performed_at, started_at, elapsed_seconds, workout_elapsed_seconds,
      rest_skipped, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 'Skipped',
      ?, ?, ?, ?, 0, '', ?, ?)
    ON CONFLICT(id) DO NOTHING`)
      .bind(`${sessionId}::${set.id}`, ownerEmail, sessionId, set.id, set.exerciseId,
        set.exerciseOrder, set.exerciseName, set.globalIndex + 1, set.setType,
        set.target, set.restSeconds, set.restRule, set.weightUnit, occurredAt,
        startedAt, elapsedSeconds, workoutElapsedSeconds, receivedAt, receivedAt);
  });

  if (naturallyStartedCurrentSetAt && remainingSets[0]) {
    statements.unshift(d1.prepare(`UPDATE workout_sets SET started_at = COALESCE(started_at, ?),
      status = CASE WHEN status = 'planned' THEN 'started' ELSE status END, updated_at = ?
      WHERE workout_id = ? AND owner_email = ? AND prescribed_set_id = ?`)
      .bind(naturallyStartedCurrentSetAt, receivedAt, sessionId, ownerEmail, remainingSets[0].id));
  }

  statements.push(d1.prepare(`UPDATE workout_sets SET status = 'skipped',
      actual_reps = NULL, actual_duration_sec = NULL, actual_weight = NULL,
      elapsed_seconds = CASE WHEN started_at IS NULL THEN NULL
        ELSE COALESCE(elapsed_seconds,
          MAX(0, ROUND((julianday(?) - julianday(started_at)) * 86400))) END,
      completed_at = COALESCE(completed_at, ?), rest_started_at = NULL,
      rest_ended_at = NULL, updated_at = ?
      WHERE workout_id = ? AND owner_email = ? AND status IN ('planned', 'started')`)
    .bind(occurredAt, occurredAt, receivedAt, sessionId, ownerEmail));

  if (session.lastPerformanceId && priorRestFinishedAt) {
    if (priorRestWasSkipped) {
      statements.push(d1.prepare(`UPDATE set_performances SET rest_skipped = 1, updated_at = ?
        WHERE id = ? AND owner_email = ?`).bind(receivedAt, session.lastPerformanceId, ownerEmail));
    }
    statements.push(d1.prepare(`UPDATE workout_sets SET
      rest_skipped = CASE WHEN ? THEN 1 ELSE rest_skipped END,
      actual_rest_sec = MAX(0, ROUND((julianday(?) - julianday(completed_at)) * 86400)),
      rest_ended_at = ?, updated_at = ? WHERE workout_id = ? AND prescribed_set_id = (
        SELECT prescribed_set_id FROM set_performances WHERE id = ? AND owner_email = ?
      ) AND owner_email = ? AND rest_ended_at IS NULL`)
      .bind(priorRestWasSkipped ? 1 : 0, priorRestFinishedAt, priorRestFinishedAt,
        receivedAt, sessionId, session.lastPerformanceId,
        ownerEmail, ownerEmail));
  }

  const completedSets = Number(session.completedSets);
  const skippedSets = Number(session.skippedSets) + remainingSets.length;
  statements.push(d1.prepare(`UPDATE workout_sessions SET status = 'Partial',
      current_set = ?, completed_sets = ?, skipped_sets = ?, rest_ends_at = NULL,
      completed_at = ?, body_weight = COALESCE(body_weight, ?),
      weight_unit = CASE WHEN body_weight IS NULL AND ? IS NOT NULL THEN ? ELSE weight_unit END,
      body_weight_source = CASE WHEN body_weight IS NULL AND ? IS NOT NULL THEN ? ELSE body_weight_source END,
      updated_at = ?
      WHERE id = ? AND owner_email = ? AND status = 'In Progress'`)
    .bind(
      sets.length + 1, completedSets, skippedSets, occurredAt,
      completionMeasurement?.bodyWeight ?? null,
      completionMeasurement?.bodyWeight ?? null, completionMeasurement?.weightUnit ?? "lb",
      completionMeasurement?.bodyWeight ?? null, completionMeasurement?.bodyWeightSource ?? null,
      receivedAt, sessionId, ownerEmail,
    ));
  statements.push(d1.prepare(`UPDATE workout_exercises SET status = CASE
      WHEN EXISTS (SELECT 1 FROM workout_sets ws
        WHERE ws.workout_exercise_id = workout_exercises.id AND ws.status = 'completed')
      THEN 'completed' ELSE 'skipped' END, updated_at = ?
      WHERE workout_id = ? AND owner_email = ?`)
    .bind(receivedAt, sessionId, ownerEmail));
  await d1.batch(statements);

  return {
    completedSets,
    skippedSets,
    remainingSetsSkipped: remainingSets.length,
    workoutCompleted: true as const,
    endedEarly: true,
    workoutElapsedSeconds,
  };
}
