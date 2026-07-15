import { env } from "cloudflare:workers";
import { canonicalRoutines } from "./routines";
import { buildGuidedSets, type GuidedSet } from "./workout";
import {
  buildRoutineRecommendations,
  type RecentCompletedSession,
  type RecentCompletedSet,
  type RecommendationResult,
} from "./recommendations";

export type RoutineExercise = {
  id: string;
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
  const existing = await d1
    .prepare("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ?")
    .bind(ownerEmail)
    .first<{ count: number }>();

  if (Number(existing?.count ?? 0) > 0) return;

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

export async function getRoutineList(ownerEmail: string): Promise<RoutineSummary[]> {
  await ensureUserRoutines(ownerEmail);
  const result = await db()
    .prepare(`SELECT r.code, r.version, r.focus, r.summary, r.duration_min AS durationMin,
      r.updated_at AS updatedAt, COUNT(e.id) AS exerciseCount,
      COALESCE(SUM(e.warmup_sets + e.regular_sets + e.failure_sets + e.drop_sets), 0) AS setCount
      FROM routines r
      LEFT JOIN exercises e ON e.owner_email = r.owner_email AND e.routine_code = r.code
      WHERE r.owner_email = ?
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
  const [sessions, completedSets] = await Promise.all([
    d1
      .prepare(`SELECT routine_code AS routineCode, completed_at AS completedAt
        FROM workout_sessions
        WHERE owner_email = ? AND status = 'Completed' AND completed_at IS NOT NULL
        ORDER BY completed_at DESC LIMIT 12`)
      .bind(ownerEmail)
      .all<RecentCompletedSession>(),
    d1
      .prepare(`SELECT ws.routine_code AS routineCode, sp.exercise_order AS exerciseOrder,
        sp.set_type AS setType, sp.performed_at AS performedAt
        FROM set_performances sp
        INNER JOIN workout_sessions ws ON ws.id = sp.session_id AND ws.owner_email = sp.owner_email
        WHERE sp.owner_email = ? AND sp.status = 'Completed' AND sp.performed_at >= ?
        ORDER BY sp.performed_at DESC`)
      .bind(ownerEmail, cutoff)
      .all<RecentCompletedSet>(),
  ]);

  return buildRoutineRecommendations(
    sessions.results,
    completedSets.results.map((set) => ({ ...set, exerciseOrder: Number(set.exerciseOrder) })),
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

  return {
    ...routine,
    version: Number(routine.version),
    durationMin: Number(routine.durationMin),
    exercises: exercises.results.map((exercise) => ({
      ...exercise,
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
  if (!Array.isArray(input.exercises) || input.exercises.length !== current.exercises.length) {
    throw new Error("Every exercise must be included when saving a routine.");
  }

  const now = new Date().toISOString();
  const d1 = db();
  const statements: D1PreparedStatement[] = [
    d1
      .prepare("UPDATE routines SET focus = ?, summary = ?, duration_min = ?, version = version + 1, updated_at = ? WHERE owner_email = ? AND code = ?")
      .bind(
        cleanText(input.focus, current.focus),
        cleanText(input.summary, current.summary),
        Math.min(180, Math.max(15, cleanCount(input.durationMin, 180))),
        now,
        ownerEmail,
        code.toUpperCase(),
      ),
  ];

  input.exercises.forEach((exercise, index) => {
    const prior = current.exercises[index];
    statements.push(
      d1
        .prepare(`UPDATE exercises SET name = ?, warmup = ?, warmup_sets = ?, regular_sets = ?,
          failure_sets = ?, drop_sets = ?, target = ?, rest = ?, effort = ?, purpose = ?,
          load_type = ?, weight_unit = 'lb', updated_at = ?
          WHERE id = ? AND owner_email = ? AND routine_code = ?`)
        .bind(
          cleanText(exercise.name, prior.name), cleanText(exercise.warmup, "None"),
          cleanCount(exercise.warmupSets), cleanCount(exercise.regularSets),
          cleanCount(exercise.failureSets), cleanCount(exercise.dropSets),
          cleanText(exercise.target, prior.target), cleanText(exercise.rest, prior.rest),
          cleanText(exercise.effort, prior.effort), cleanText(exercise.purpose, prior.purpose),
          cleanText(exercise.loadType, prior.loadType), now, prior.id, ownerEmail, code.toUpperCase(),
        ),
    );
  });

  await d1.batch(statements);
  return getRoutine(ownerEmail, code);
}

export async function startWorkout(ownerEmail: string, code: string, abandonActive = false) {
  await ensureUserRoutines(ownerEmail);
  const d1 = db();
  const requestedCode = code.toUpperCase();
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

  const routine = await getRoutine(ownerEmail, requestedCode);
  if (!routine) return null;
  const now = new Date().toISOString();
  const totalSets = routine.exercises.reduce(
    (sum, exercise) => sum + exercise.warmupSets + exercise.regularSets + exercise.failureSets + exercise.dropSets,
    0,
  );
  const id = crypto.randomUUID();
  const createSession = d1.prepare(`INSERT INTO workout_sessions (
      id, owner_email, routine_code, routine_version, status, snapshot_json,
      current_exercise, current_set, completed_sets, skipped_sets, total_sets,
      started_at, updated_at
    ) VALUES (?, ?, ?, ?, 'In Progress', ?, 1, 1, 0, 0, ?, ?, ?)`)
    .bind(id, ownerEmail, routine.code, routine.version, JSON.stringify(routine), totalSets, now, now);

  if (active) {
    await d1.batch([
      d1
        .prepare(`UPDATE workout_sessions SET status = 'Abandoned', completed_at = ?,
          rest_ends_at = NULL, updated_at = ?
          WHERE id = ? AND owner_email = ? AND status = 'In Progress'`)
        .bind(now, now, active.id, ownerEmail),
      createSession,
    ]);
  } else {
    await createSession.run();
  }

  return {
    created: true,
    requiresConfirmation: false,
    session: { id, routineCode: routine.code, startedAt: now, totalSets },
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
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return allowDecimal ? Math.round(number * 100) / 100 : Math.round(number);
}

export async function recordWorkoutSet(ownerEmail: string, sessionId: string, input: RecordSetInput) {
  const session = await getRawWorkoutSession(ownerEmail, sessionId);
  if (!session) return null;
  if (session.status !== "In Progress") throw new Error("This workout is no longer in progress.");

  const routine = JSON.parse(session.snapshotJson) as Routine;
  const sets = buildGuidedSets(routine);
  const currentIndex = Math.max(0, Number(session.currentSet) - 1);
  const prescribedSet = sets[currentIndex];
  if (!prescribedSet) throw new Error("This workout has no remaining sets.");
  if (input.prescribedSetId !== prescribedSet.id) {
    throw new Error("The workout has already advanced. Refresh to continue from the current set.");
  }

  const status = input.status === "Skipped" ? "Skipped" : "Completed";
  const actualWeight = cleanNonNegativeNumber(input.actualWeight, true);
  const actualReps = cleanNonNegativeNumber(input.actualReps);
  const actualDurationSec = cleanNonNegativeNumber(input.actualDurationSec);
  if (status === "Completed" && actualWeight === null) throw new Error("Enter the weight used for this set.");
  if (status === "Completed" && prescribedSet.targetUnit === "reps" && actualReps === null) {
    throw new Error("Enter the reps completed for this set.");
  }
  if (status === "Completed" && prescribedSet.targetUnit === "seconds" && actualDurationSec === null) {
    throw new Error("Enter the seconds completed for this set.");
  }

  const now = new Date().toISOString();
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
      prescribedSet.setType, prescribedSet.target, prescribedSet.restSeconds,
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
  const restSeconds = workoutCompleted ? 0 : prescribedSet.restSeconds;
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
  }
  await d1.batch(statements);
  return { skipped: true };
}
