import { env } from "cloudflare:workers";
import { canonicalRoutines } from "./routines";

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
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_owner ON workout_sessions(owner_email) WHERE status = 'In Progress'"),
  ]);
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

export async function startWorkout(ownerEmail: string, code: string) {
  await ensureUserRoutines(ownerEmail);
  const d1 = db();
  const active = await d1
    .prepare("SELECT id, routine_code AS routineCode, started_at AS startedAt, total_sets AS totalSets FROM workout_sessions WHERE owner_email = ? AND status = 'In Progress' LIMIT 1")
    .bind(ownerEmail)
    .first<{ id: string; routineCode: string; startedAt: string; totalSets: number }>();
  if (active) return { created: false, session: active };

  const routine = await getRoutine(ownerEmail, code);
  if (!routine) return null;
  const now = new Date().toISOString();
  const totalSets = routine.exercises.reduce(
    (sum, exercise) => sum + exercise.warmupSets + exercise.regularSets + exercise.failureSets + exercise.dropSets,
    0,
  );
  const id = crypto.randomUUID();
  await d1
    .prepare(`INSERT INTO workout_sessions (
      id, owner_email, routine_code, routine_version, status, snapshot_json,
      current_exercise, current_set, completed_sets, skipped_sets, total_sets,
      started_at, updated_at
    ) VALUES (?, ?, ?, ?, 'In Progress', ?, 1, 1, 0, 0, ?, ?, ?)`)
    .bind(id, ownerEmail, routine.code, routine.version, JSON.stringify(routine), totalSets, now, now)
    .run();

  return { created: true, session: { id, routineCode: routine.code, startedAt: now, totalSets } };
}
