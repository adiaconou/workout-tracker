import { env } from "cloudflare:workers";
import { canonicalRoutines } from "./routines";
import {
  buildGuidedSets,
  type GuidedSet,
  type NormalizedWorkoutPrescription,
} from "./workout";
import {
  buildRoutineRecommendations,
  type RecentCompletedSession,
  type RecentCompletedSet,
  type RecommendationResult,
  type RoutineCode,
  type RoutineProfiles,
  type MuscleGroup,
} from "./recommendations";
import { getEntityServices } from "../application/services";
import { expandLegacyPrescription } from "../domain/prescription";
import { ensureEntityData, ensureEntitySchema, materializeWorkoutFromSnapshot } from "../infrastructure/d1/entity-schema";
import {
  getPreviousPerformanceByExercise,
  type PreviousExercisePerformance,
} from "../infrastructure/d1/previous-performance";

export type {
  PreviousExercisePerformance,
  PreviousExerciseSet,
} from "../infrastructure/d1/previous-performance";

export type RoutineExercise = {
  id: string;
  exerciseId: string;
  exerciseOrder: number;
  name: string;
  warmup: string;
  warmupSets: number;
  regularSets: number;
  failureSets: number;
  dropSets: number;
  target: string;
  rest: string;
  effort: string;
  purpose: string;
  loadType: string;
  weightUnit: string;
};

export type Routine = {
  code: string;
  version: number;
  focus: string;
  summary: string;
  durationMin: number;
  updatedAt: string;
  exercises: RoutineExercise[];
};

export type RoutineSummary = Omit<Routine, "exercises"> & {
  exerciseCount: number;
  setCount: number;
};

type EditableRoutine = Pick<Routine, "focus" | "summary" | "durationMin"> & {
  exercises: RoutineExercise[];
};

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
};

export type WorkoutView = Omit<RawWorkoutSession, "snapshotJson"> & {
  routine: Routine;
  sets: GuidedSet[];
  currentSetIndex: number;
  currentRestSeconds: number;
  previousPerformanceByExercise: Record<number, PreviousExercisePerformance>;
  lastCompletedSetByExercise: Record<number, {
    actualWeight: number;
    actualReps: number | null;
  }>;
};

function db(): D1Database {
  if (!env.DB) throw new Error("The workout database is unavailable.");
  return env.DB;
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
      performed_at TEXT NOT NULL,
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
}

function routineId(ownerEmail: string, code: string) {
  return `${ownerEmail}::routine::${code}`;
}

function exerciseId(ownerEmail: string, code: string, order: number) {
  return `${ownerEmail}::exercise::${code}::${order}`;
}

export async function ensureUserRoutines(ownerEmail: string) {
  await ensureWorkoutSchema();
  const d1 = db();
  await ensureEntitySchema(d1);
  const existing = await d1
    .prepare("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ?")
    .bind(ownerEmail)
    .first<{ count: number }>();

  if (Number(existing?.count ?? 0) === 0) {
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const routine of canonicalRoutines) {
      statements.push(
        d1
          .prepare("INSERT OR IGNORE INTO routines (id, owner_email, code, version, focus, summary, duration_min, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)")
          .bind(routineId(ownerEmail, routine.code), ownerEmail, routine.code, routine.focus, routine.summary, routine.durationMin, now),
      );
      routine.exercises.forEach((exercise, index) => {
        const order = index + 1;
        statements.push(
          d1
            .prepare(`INSERT OR IGNORE INTO exercises (
              id, owner_email, routine_code, exercise_order, name, warmup, warmup_sets,
              regular_sets, failure_sets, drop_sets, target, rest, effort, purpose,
              load_type, weight_unit, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lb', ?)`)
            .bind(
              exerciseId(ownerEmail, routine.code, order), ownerEmail, routine.code, order,
              exercise.name, exercise.warmup, exercise.warmupSets, exercise.regularSets,
              exercise.failureSets, exercise.dropSets, exercise.target, exercise.rest,
              exercise.effort, exercise.purpose, exercise.loadType, now,
            ),
        );
      });
    }
    await d1.batch(statements);
  }
  await ensureEntityData(d1, ownerEmail);
}

export async function getRoutineList(ownerEmail: string): Promise<RoutineSummary[]> {
  await ensureUserRoutines(ownerEmail);
  const result = await db()
    .prepare(`SELECT r.code, r.version, r.focus, r.summary, r.duration_min AS durationMin,
      r.updated_at AS updatedAt, COUNT(e.id) AS exerciseCount,
      COALESCE(SUM(e.warmup_sets + e.regular_sets + e.failure_sets + e.drop_sets), 0) AS setCount
      FROM routines r
      LEFT JOIN exercises e ON e.owner_email = r.owner_email AND e.routine_code = r.code
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
  }));
}

export async function getRoutineRecommendations(ownerEmail: string): Promise<RecommendationResult> {
  await ensureUserRoutines(ownerEmail);
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const d1 = db();
  const [sessions, completedMuscleRows, profileRows] = await Promise.all([
    d1
      .prepare(`SELECT routine_code AS routineCode, completed_at AS completedAt
        FROM workout_sessions
        WHERE owner_email = ? AND status = 'Completed' AND completed_at IS NOT NULL
        ORDER BY completed_at DESC LIMIT 12`)
      .bind(ownerEmail)
      .all<RecentCompletedSession>(),
    d1
      .prepare(`SELECT ws.routine_code AS routineCode, sp.prescribed_set_id AS prescribedSetId,
        sp.exercise_order AS exerciseOrder, sp.set_type AS setType, sp.performed_at AS performedAt,
        em.muscle_group AS muscleGroup, em.weight AS muscleWeight
        FROM set_performances sp
        INNER JOIN workout_sessions ws ON ws.id = sp.session_id AND ws.owner_email = sp.owner_email
        INNER JOIN workout_exercises we ON we.workout_id = sp.session_id AND we.position = sp.exercise_order
        INNER JOIN exercise_muscles em ON em.exercise_id = we.exercise_id
        WHERE sp.owner_email = ? AND sp.status = 'Completed' AND sp.performed_at >= ?
        ORDER BY sp.performed_at DESC`)
      .bind(ownerEmail, cutoff)
      .all<RecentCompletedSet & { prescribedSetId: string; muscleGroup: MuscleGroup; muscleWeight: number }>(),
    d1.prepare(`SELECT r.code AS routineCode, em.muscle_group AS muscleGroup,
        SUM(em.weight * CASE WHEN rst.set_type = 'warmup' THEN 0.25 WHEN rst.set_type IN ('failure', 'drop') THEN 1.25 ELSE 1 END) AS profileWeight
      FROM routines r
      INNER JOIN routine_version_exercises rve ON rve.routine_version_id = r.current_version_id
      INNER JOIN routine_set_templates rst ON rst.routine_exercise_id = rve.id
      INNER JOIN exercise_muscles em ON em.exercise_id = rve.exercise_id
      WHERE r.owner_email = ? AND r.is_active = 1
      GROUP BY r.code, em.muscle_group`)
      .bind(ownerEmail)
      .all<{ routineCode: RoutineCode; muscleGroup: MuscleGroup; profileWeight: number }>(),
  ]);

  const completedSetMap = new Map<string, RecentCompletedSet>();
  for (const row of completedMuscleRows.results) {
    const key = `${row.routineCode}:${row.prescribedSetId}:${row.performedAt}`;
    const set = completedSetMap.get(key) ?? {
      routineCode: row.routineCode,
      exerciseOrder: Number(row.exerciseOrder),
      setType: row.setType,
      performedAt: row.performedAt,
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
  );
}

export async function getRoutine(ownerEmail: string, code: string): Promise<Routine | null> {
  await ensureUserRoutines(ownerEmail);
  const routine = await db()
    .prepare("SELECT code, version, focus, summary, duration_min AS durationMin, updated_at AS updatedAt FROM routines WHERE owner_email = ? AND code = ?")
    .bind(ownerEmail, code.toUpperCase())
    .first<Omit<Routine, "exercises">>();
  if (!routine) return null;

  const exercises = await db()
    .prepare(`SELECT id, exercise_order AS exerciseOrder, name, warmup, warmup_sets AS warmupSets,
      regular_sets AS regularSets, failure_sets AS failureSets, drop_sets AS dropSets,
      target, rest, effort, purpose, load_type AS loadType, weight_unit AS weightUnit
      FROM exercises WHERE owner_email = ? AND routine_code = ? ORDER BY exercise_order`)
    .bind(ownerEmail, code.toUpperCase())
    .all<RoutineExercise>();
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

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function cleanCount(value: unknown, max = 20) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(0, Math.round(number)));
}

export async function updateRoutine(ownerEmail: string, code: string, input: EditableRoutine) {
  const current = await getRoutine(ownerEmail, code);
  if (!current) return null;
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    throw new Error("A routine needs at least one exercise.");
  }
  const exerciseIds = input.exercises.map((exercise) => cleanText(exercise.exerciseId));
  if (
    exerciseIds.some((exerciseId) => !exerciseId) ||
    new Set(exerciseIds).size !== exerciseIds.length
  ) {
    throw new Error("Each routine exercise must be a unique exercise from your library.");
  }

  const services = getEntityServices();
  const aggregate = await services.routines.get(ownerEmail, code);
  if (!aggregate?.currentVersion) {
    throw new Error("The routine entity version is unavailable.");
  }
  const priorPlacementByExerciseId = new Map(
    aggregate.currentVersion.exercises.map((exercise) => [
      exercise.exerciseId,
      exercise,
    ]),
  );
  const priorExerciseByExerciseId = new Map(
    current.exercises.map((exercise) => [exercise.exerciseId, exercise]),
  );
  for (const exercise of input.exercises) {
    const catalog = await services.exercises.get(ownerEmail, exercise.exerciseId);
    if (!catalog) {
      throw new Error("A routine references an unavailable exercise.");
    }
    if (
      cleanText(exercise.name, catalog.name) !== catalog.name ||
      exercise.loadType !== catalog.defaultLoadType
    ) {
      await services.exercises.update(ownerEmail, catalog.id, {
        name: cleanText(exercise.name, catalog.name),
        defaultLoadType: exercise.loadType as typeof catalog.defaultLoadType,
      });
    }
  }
  const version = await services.routines.createVersion(ownerEmail, aggregate.id, {
    focus: cleanText(input.focus, current.focus),
    summary: cleanText(input.summary, current.summary),
    durationMin: Math.min(180, Math.max(15, cleanCount(input.durationMin, 180))),
    exercises: input.exercises.map((exercise, index) => {
      const priorPlacement = priorPlacementByExerciseId.get(exercise.exerciseId);
      const priorExercise = priorExerciseByExerciseId.get(exercise.exerciseId);
      return {
        exerciseId: exercise.exerciseId,
        position: index + 1,
        supersetGroup: priorPlacement?.supersetGroup ?? null,
        instructions: cleanText(
          exercise.effort,
          priorExercise?.effort ?? "2 RIR",
        ),
        notes: cleanText(exercise.purpose, priorExercise?.purpose ?? ""),
        sets: expandLegacyPrescription({
          warmup: cleanText(exercise.warmup, priorExercise?.warmup ?? "None"),
          warmupSets: cleanCount(exercise.warmupSets),
          regularSets: cleanCount(exercise.regularSets),
          failureSets: cleanCount(exercise.failureSets),
          dropSets: cleanCount(exercise.dropSets),
          target: cleanText(
            exercise.target,
            priorExercise?.target ?? "8-12 reps",
          ),
          rest: cleanText(exercise.rest, priorExercise?.rest ?? "90 sec"),
          effort: cleanText(
            exercise.effort,
            priorExercise?.effort ?? "2 RIR",
          ),
        }),
      };
    }),
  });
  await services.routines.publish(ownerEmail, aggregate.id, version.id);
  return getRoutine(ownerEmail, code);
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
  await ensureUserRoutines(ownerEmail);
  const d1 = db();
  const requestedRoutine = await d1.prepare(`SELECT code, current_version_id AS currentVersionId
      FROM routines WHERE owner_email = ? AND is_active = 1 AND (id = ? OR code = ?)`)
    .bind(ownerEmail, code, code.toUpperCase()).first<{ code: string; currentVersionId: string | null }>();
  if (!requestedRoutine) return null;
  if (expectedRoutineVersionId && requestedRoutine.currentVersionId !== expectedRoutineVersionId) {
    throw new WorkoutRoutineVersionConflictError();
  }
  const requestedCode = requestedRoutine.code;
  const active = await d1
    .prepare("SELECT id, routine_code AS routineCode, started_at AS startedAt, total_sets AS totalSets FROM workout_sessions WHERE owner_email = ? AND status = 'In Progress' LIMIT 1")
    .bind(ownerEmail)
    .first<{ id: string; routineCode: string; startedAt: string; totalSets: number }>();
  if (active?.routineCode === requestedCode) {
    return { created: false, requiresConfirmation: false, session: active };
  }
  if (active && !abandonActive) {
    return { created: false, requiresConfirmation: true, session: active };
  }

  const services = getEntityServices();
  const [routine, aggregate, exactExpectedVersion, exerciseLibrary] = await Promise.all([
    getRoutine(ownerEmail, requestedCode),
    services.routines.get(ownerEmail, requestedCode),
    expectedRoutineVersionId
      ? services.routines.getVersion(ownerEmail, requestedCode, expectedRoutineVersionId)
      : Promise.resolve(null),
    services.exercises.list(ownerEmail, { includeArchived: true }),
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
              weightUnit: legacyExercise?.weightUnit ?? "lb",
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
  const snapshotRoutine = normalizedPrescription
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
  const now = new Date().toISOString();
  const totalSets = buildGuidedSets(snapshotRoutine).length;
  const id = crypto.randomUUID();
  const snapshotJson = JSON.stringify(snapshotRoutine);
  const createSession = expectedRoutineVersionId
    ? d1.prepare(`INSERT INTO workout_sessions (
        id, owner_email, routine_code, routine_version, status, snapshot_json,
        current_exercise, current_set, completed_sets, skipped_sets, total_sets,
        started_at, updated_at
      ) SELECT ?, ?, ?, ?, 'In Progress', ?, 1, 1, 0, 0, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM routines
        WHERE owner_email = ? AND code = ? AND current_version_id = ?
      )`)
      .bind(
        id, ownerEmail, snapshotRoutine.code, snapshotRoutine.version, snapshotJson,
        totalSets, now, now, ownerEmail, requestedCode, expectedRoutineVersionId,
      )
    : d1.prepare(`INSERT INTO workout_sessions (
        id, owner_email, routine_code, routine_version, status, snapshot_json,
        current_exercise, current_set, completed_sets, skipped_sets, total_sets,
        started_at, updated_at
      ) VALUES (?, ?, ?, ?, 'In Progress', ?, 1, 1, 0, 0, ?, ?, ?)`)
      .bind(id, ownerEmail, snapshotRoutine.code, snapshotRoutine.version, snapshotJson, totalSets, now, now);

  let createResult: D1Result<unknown>;
  if (active) {
    const abandonSession = expectedRoutineVersionId
      ? d1.prepare(`UPDATE workout_sessions SET status = 'Abandoned', completed_at = ?,
          rest_ends_at = NULL, updated_at = ?
          WHERE id = ? AND owner_email = ? AND status = 'In Progress'
          AND EXISTS (
            SELECT 1 FROM routines
            WHERE owner_email = ? AND code = ? AND current_version_id = ?
          )`)
        .bind(
          now, now, active.id, ownerEmail,
          ownerEmail, requestedCode, expectedRoutineVersionId,
        )
      : d1.prepare(`UPDATE workout_sessions SET status = 'Abandoned', completed_at = ?,
          rest_ends_at = NULL, updated_at = ?
          WHERE id = ? AND owner_email = ? AND status = 'In Progress'`)
        .bind(now, now, active.id, ownerEmail);
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

  return {
    created: true,
    requiresConfirmation: false,
    session: { id, routineCode: snapshotRoutine.code, startedAt: now, totalSets },
  };
}

async function getRawWorkoutSession(ownerEmail: string, sessionId: string) {
  await ensureWorkoutSchema();
  return db()
    .prepare(`SELECT id, routine_code AS routineCode, routine_version AS routineVersion,
      status, snapshot_json AS snapshotJson, current_exercise AS currentExercise,
      current_set AS currentSet, completed_sets AS completedSets, skipped_sets AS skippedSets,
      total_sets AS totalSets, rest_ends_at AS restEndsAt,
      last_performance_id AS lastPerformanceId, started_at AS startedAt,
      completed_at AS completedAt
      FROM workout_sessions WHERE id = ? AND owner_email = ?`)
    .bind(sessionId, ownerEmail)
    .first<RawWorkoutSession>();
}

export async function getWorkoutSession(ownerEmail: string, sessionId: string): Promise<WorkoutView | null> {
  const session = await getRawWorkoutSession(ownerEmail, sessionId);
  if (!session) return null;
  const routine = JSON.parse(session.snapshotJson) as Routine;
  const sets = buildGuidedSets(routine);
  let restEndsAt = session.restEndsAt;
  if (restEndsAt && new Date(restEndsAt).getTime() <= Date.now()) {
    restEndsAt = null;
    await db()
      .prepare("UPDATE workout_sessions SET rest_ends_at = NULL WHERE id = ? AND owner_email = ?")
      .bind(sessionId, ownerEmail)
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
  const completedSetRows = await db()
    .prepare(`SELECT exercise_order AS exerciseOrder,
      actual_weight AS actualWeight, actual_reps AS actualReps
      FROM set_performances
      WHERE session_id = ? AND owner_email = ? AND status = 'Completed'
      ORDER BY set_order`)
    .bind(sessionId, ownerEmail)
    .all<{
      exerciseOrder: number;
      actualWeight: number | null;
      actualReps: number | null;
    }>();
  const lastCompletedSetByExercise: WorkoutView["lastCompletedSetByExercise"] = {};
  for (const row of completedSetRows.results) {
    if (row.actualWeight === null) continue;
    lastCompletedSetByExercise[Number(row.exerciseOrder)] = {
      actualWeight: Number(row.actualWeight),
      actualReps: row.actualReps === null ? null : Number(row.actualReps),
    };
  }

  return {
    ...session,
    routineVersion: Number(session.routineVersion),
    currentExercise: Number(session.currentExercise),
    currentSet: Number(session.currentSet),
    completedSets: Number(session.completedSets),
    skippedSets: Number(session.skippedSets),
    totalSets: Number(session.totalSets),
    restEndsAt,
    routine,
    sets,
    currentSetIndex: Math.max(0, Math.min(sets.length, Number(session.currentSet) - 1)),
    currentRestSeconds,
    previousPerformanceByExercise,
    lastCompletedSetByExercise,
  };
}

type RecordSetInput = {
  prescribedSetId?: string;
  status?: "Completed" | "Skipped";
  actualReps?: number | null;
  actualDurationSec?: number | null;
  actualWeight?: number | null;
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
      ? await db().prepare(`SELECT id AS performanceId
          FROM set_performances WHERE session_id = ? AND owner_email = ?
          AND prescribed_set_id = ?`)
        .bind(sessionId, ownerEmail, input.prescribedSetId)
        .first<{ performanceId: string }>()
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
      };
    }
    throw new Error("This workout is no longer in progress.");
  }

  const routine = JSON.parse(session.snapshotJson) as Routine;
  const sets = buildGuidedSets(routine);
  const currentIndex = Math.max(0, Number(session.currentSet) - 1);
  const prescribedSet = sets[currentIndex];
  if (!prescribedSet) throw new Error("This workout has no remaining sets.");
  if (input.prescribedSetId !== prescribedSet.id) {
    const existing = input.prescribedSetId
      ? await db().prepare(`SELECT id AS performanceId, target_rest_sec AS restSeconds
          FROM set_performances WHERE session_id = ? AND owner_email = ?
          AND prescribed_set_id = ?`)
        .bind(sessionId, ownerEmail, input.prescribedSetId)
        .first<{ performanceId: string; restSeconds: number }>()
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

  const now = new Date().toISOString();
  const effectiveRestSeconds = effectiveRestSecondsForSet(sets, currentIndex);
  const performanceId = `${sessionId}::${prescribedSet.id}`;
  const d1 = db();
  await d1
    .prepare(`INSERT INTO set_performances (
      id, owner_email, session_id, prescribed_set_id, exercise_id, exercise_order,
      exercise_name, set_order, set_type, target_display, target_rest_sec, rest_rule,
      actual_reps, actual_duration_sec, actual_weight, weight_unit, status,
      performed_at, rest_skipped, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lb', ?, ?, 0, '', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      actual_reps = excluded.actual_reps,
      actual_duration_sec = excluded.actual_duration_sec,
      actual_weight = excluded.actual_weight,
      status = excluded.status,
      performed_at = excluded.performed_at,
      updated_at = excluded.updated_at`)
    .bind(
      performanceId, ownerEmail, sessionId, prescribedSet.id, prescribedSet.exerciseId,
      prescribedSet.exerciseOrder, prescribedSet.exerciseName, prescribedSet.globalIndex + 1,
      prescribedSet.setType, prescribedSet.target, effectiveRestSeconds,
      prescribedSet.restRule, status === "Completed" ? actualReps : null,
      status === "Completed" ? actualDurationSec : null,
      status === "Completed" ? actualWeight : null, status, now, now, now,
    )
    .run();

  const counts = await d1
    .prepare(`SELECT
      SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completedSets,
      SUM(CASE WHEN status = 'Skipped' THEN 1 ELSE 0 END) AS skippedSets
      FROM set_performances WHERE session_id = ? AND owner_email = ?`)
    .bind(sessionId, ownerEmail)
    .first<{ completedSets: number | null; skippedSets: number | null }>();
  const completedSets = Number(counts?.completedSets ?? 0);
  const skippedSets = Number(counts?.skippedSets ?? 0);
  const nextSetIndex = currentIndex + 1;
  const workoutCompleted = nextSetIndex >= sets.length;
  const restSeconds = workoutCompleted ? 0 : effectiveRestSeconds;
  const restEndsAt = restSeconds > 0 ? new Date(Date.now() + restSeconds * 1000).toISOString() : null;
  const nextSet = sets[nextSetIndex];

  if (workoutCompleted) {
    await d1
      .prepare(`UPDATE workout_sessions SET status = 'Completed', current_set = ?,
        completed_sets = ?, skipped_sets = ?, rest_ends_at = NULL,
        last_performance_id = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND owner_email = ?`)
      .bind(sets.length + 1, completedSets, skippedSets, performanceId, now, now, sessionId, ownerEmail)
      .run();
  } else {
    await d1
      .prepare(`UPDATE workout_sessions SET current_exercise = ?, current_set = ?,
        completed_sets = ?, skipped_sets = ?, rest_ends_at = ?,
        last_performance_id = ?, updated_at = ?
        WHERE id = ? AND owner_email = ?`)
      .bind(nextSet.exerciseOrder, nextSetIndex + 1, completedSets, skippedSets, restEndsAt, performanceId, now, sessionId, ownerEmail)
      .run();
  }

  await d1.prepare(`UPDATE workout_sets SET actual_reps = ?, actual_duration_sec = ?, actual_weight = ?,
    status = ?, completed_at = ?, rest_started_at = ?, rest_ended_at = ?, updated_at = ?
    WHERE workout_id = ? AND prescribed_set_id = ? AND owner_email = ?`)
    .bind(status === "Completed" ? actualReps : null, status === "Completed" ? actualDurationSec : null,
      status === "Completed" ? actualWeight : null, status.toLowerCase(), now,
      restEndsAt ? now : null, restEndsAt ?? now, now, sessionId, prescribedSet.id, ownerEmail).run();
  await d1.prepare(`UPDATE workout_sets SET actual_rest_sec = CASE WHEN ? IS NULL THEN 0 ELSE ? END
    WHERE workout_id = ? AND prescribed_set_id = ? AND owner_email = ?`)
    .bind(restEndsAt, effectiveRestSeconds, sessionId, prescribedSet.id, ownerEmail).run();
  await d1.prepare(`UPDATE workout_exercises SET status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM workout_sets ws WHERE ws.workout_exercise_id = workout_exercises.id AND ws.status = 'planned') THEN 'completed'
      ELSE 'started' END, updated_at = ?
    WHERE workout_id = ? AND position = ? AND owner_email = ?`)
    .bind(now, sessionId, prescribedSet.exerciseOrder, ownerEmail).run();

  return {
    performanceId,
    completedSets,
    skippedSets,
    nextSetIndex,
    restSeconds,
    restEndsAt,
    workoutCompleted,
  };
}

export async function skipWorkoutRest(ownerEmail: string, sessionId: string) {
  const session = await getRawWorkoutSession(ownerEmail, sessionId);
  if (!session) return null;
  if (session.status !== "In Progress") throw new Error("This workout is no longer in progress.");
  const now = new Date().toISOString();
  const d1 = db();
  const statements: D1PreparedStatement[] = [
    d1
      .prepare("UPDATE workout_sessions SET rest_ends_at = NULL, updated_at = ? WHERE id = ? AND owner_email = ?")
      .bind(now, sessionId, ownerEmail),
  ];
  if (session.lastPerformanceId) {
    statements.push(
      d1
        .prepare("UPDATE set_performances SET rest_skipped = 1, updated_at = ? WHERE id = ? AND owner_email = ?")
        .bind(now, session.lastPerformanceId, ownerEmail),
    );
    statements.push(
      d1.prepare(`UPDATE workout_sets SET rest_skipped = 1,
        actual_rest_sec = MAX(0, CAST((julianday(?) - julianday(completed_at)) * 86400 AS INTEGER)),
        rest_ended_at = ?, updated_at = ? WHERE workout_id = ? AND prescribed_set_id = (
          SELECT prescribed_set_id FROM set_performances WHERE id = ? AND owner_email = ?
        ) AND owner_email = ?`)
        .bind(now, now, now, sessionId, session.lastPerformanceId, ownerEmail, ownerEmail),
    );
  }
  await d1.batch(statements);
  return { skipped: true };
}

export async function completeWorkoutEarly(ownerEmail: string, sessionId: string) {
  const session = await getRawWorkoutSession(ownerEmail, sessionId);
  if (!session) return null;
  if (session.status === "Completed" || session.status === "Partial") {
    return {
      completedSets: Number(session.completedSets),
      skippedSets: Number(session.skippedSets),
      remainingSetsSkipped: 0,
      workoutCompleted: true,
      endedEarly: session.status === "Partial",
    };
  }
  if (session.status !== "In Progress") {
    throw new Error("This workout is no longer in progress.");
  }

  const routine = JSON.parse(session.snapshotJson) as Routine;
  const sets = buildGuidedSets(routine);
  const currentIndex = Math.max(
    0,
    Math.min(sets.length, Number(session.currentSet) - 1),
  );
  const remainingSets = sets.slice(currentIndex);
  const now = new Date().toISOString();
  const d1 = db();
  const statements: D1PreparedStatement[] = remainingSets.map((set) =>
    d1
      .prepare(`INSERT INTO set_performances (
        id, owner_email, session_id, prescribed_set_id, exercise_id, exercise_order,
        exercise_name, set_order, set_type, target_display, target_rest_sec, rest_rule,
        actual_reps, actual_duration_sec, actual_weight, weight_unit, status,
        performed_at, rest_skipped, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 'Skipped',
        ?, 0, '', ?, ?)
      ON CONFLICT(id) DO NOTHING`)
      .bind(
        `${sessionId}::${set.id}`,
        ownerEmail,
        sessionId,
        set.id,
        set.exerciseId,
        set.exerciseOrder,
        set.exerciseName,
        set.globalIndex + 1,
        set.setType,
        set.target,
        set.restSeconds,
        set.restRule,
        set.weightUnit,
        now,
        now,
        now,
      ),
  );

  statements.push(
    d1
      .prepare(`UPDATE workout_sets SET status = 'skipped', actual_reps = NULL,
        actual_duration_sec = NULL, actual_weight = NULL, completed_at = ?,
        rest_started_at = NULL, rest_ended_at = NULL, updated_at = ?
        WHERE workout_id = ? AND owner_email = ? AND status = 'planned'`)
      .bind(now, now, sessionId, ownerEmail),
  );
  if (session.lastPerformanceId && session.restEndsAt) {
    statements.push(
      d1
        .prepare(`UPDATE set_performances SET rest_skipped = 1, updated_at = ?
          WHERE id = ? AND owner_email = ?`)
        .bind(now, session.lastPerformanceId, ownerEmail),
    );
    statements.push(
      d1
        .prepare(`UPDATE workout_sets SET rest_skipped = 1,
          actual_rest_sec = MAX(0, CAST((julianday(?) - julianday(completed_at)) * 86400 AS INTEGER)),
          rest_ended_at = ?, updated_at = ? WHERE workout_id = ? AND prescribed_set_id = (
            SELECT prescribed_set_id FROM set_performances WHERE id = ? AND owner_email = ?
          ) AND owner_email = ?`)
        .bind(
          now,
          now,
          now,
          sessionId,
          session.lastPerformanceId,
          ownerEmail,
          ownerEmail,
        ),
    );
  }
  await d1.batch(statements);

  const counts = await d1
    .prepare(`SELECT
      SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completedSets,
      SUM(CASE WHEN status = 'Skipped' THEN 1 ELSE 0 END) AS skippedSets
      FROM set_performances WHERE session_id = ? AND owner_email = ?`)
    .bind(sessionId, ownerEmail)
    .first<{ completedSets: number | null; skippedSets: number | null }>();
  const completedSets = Number(counts?.completedSets ?? 0);
  const skippedSets = Number(counts?.skippedSets ?? 0);

  await d1.batch([
    d1
      .prepare(`UPDATE workout_sessions SET status = 'Partial',
        current_set = ?, completed_sets = ?, skipped_sets = ?,
        rest_ends_at = NULL, completed_at = ?, updated_at = ?
        WHERE id = ? AND owner_email = ?`)
      .bind(
        sets.length + 1,
        completedSets,
        skippedSets,
        now,
        now,
        sessionId,
        ownerEmail,
      ),
    d1
      .prepare(`UPDATE workout_exercises SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM workout_sets ws
          WHERE ws.workout_exercise_id = workout_exercises.id
            AND ws.status = 'completed'
        ) THEN 'completed'
        ELSE 'skipped'
        END, updated_at = ?
        WHERE workout_id = ? AND owner_email = ?`)
      .bind(now, sessionId, ownerEmail),
  ]);

  return {
    completedSets,
    skippedSets,
    remainingSetsSkipped: remainingSets.length,
    workoutCompleted: true,
    endedEarly: true,
  };
}
