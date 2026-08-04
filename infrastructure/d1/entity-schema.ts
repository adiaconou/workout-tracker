import type { Routine } from "../../lib/store";
import { buildGuidedSets, getNormalizedWorkoutPrescription } from "../../lib/workout";
import { EXERCISE_MUSCLES, type RoutineCode } from "../../lib/recommendations";
import { canonicalRoutines } from "../../lib/routines";
import { homeGymExercises } from "../../lib/home-gym-exercises";
import { normalizeExerciseName, type MuscleGroup } from "../../domain/entities/exercise";
import { expandLegacyPrescription } from "../../domain/prescription";

const createStatements = [
  `CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, display_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS app_users_owner_email_idx ON app_users(owner_email)",
  `CREATE TABLE IF NOT EXISTS auth_identities (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, provider_subject TEXT NOT NULL, email TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS auth_identities_provider_subject_idx ON auth_identities(provider, provider_subject)",
  "CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities(user_id)",
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL, device_name TEXT NOT NULL,
    expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL,
    rotated_at TEXT NOT NULL, last_used_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_refresh_hash_idx ON auth_sessions(refresh_token_hash)",
  "CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id)",
  `CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, code TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, focus TEXT NOT NULL, summary TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 60, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS routines_owner_code_idx ON routines(owner_email, code)",
  `CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, routine_code TEXT NOT NULL,
    exercise_order INTEGER NOT NULL, name TEXT NOT NULL, warmup TEXT NOT NULL,
    warmup_sets INTEGER NOT NULL DEFAULT 0, regular_sets INTEGER NOT NULL DEFAULT 0,
    failure_sets INTEGER NOT NULL DEFAULT 0, drop_sets INTEGER NOT NULL DEFAULT 0,
    target TEXT NOT NULL, rest TEXT NOT NULL, effort TEXT NOT NULL, purpose TEXT NOT NULL,
    load_type TEXT NOT NULL DEFAULT 'external', weight_unit TEXT NOT NULL DEFAULT 'lb',
    updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS exercises_owner_routine_order_idx ON exercises(owner_email, routine_code, exercise_order)",
  `CREATE TABLE IF NOT EXISTS workout_sessions (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, routine_code TEXT NOT NULL,
    routine_version INTEGER NOT NULL, status TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    current_exercise INTEGER NOT NULL DEFAULT 1, current_set INTEGER NOT NULL DEFAULT 1,
    completed_sets INTEGER NOT NULL DEFAULT 0, skipped_sets INTEGER NOT NULL DEFAULT 0,
    total_sets INTEGER NOT NULL, rest_ends_at TEXT, last_performance_id TEXT,
    started_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_owner ON workout_sessions(owner_email) WHERE status = 'In Progress'",
  `CREATE TABLE IF NOT EXISTS set_performances (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, session_id TEXT NOT NULL,
    prescribed_set_id TEXT NOT NULL, exercise_id TEXT NOT NULL, exercise_order INTEGER NOT NULL,
    exercise_name TEXT NOT NULL, set_order INTEGER NOT NULL, set_type TEXT NOT NULL,
    target_display TEXT NOT NULL, target_rest_sec INTEGER NOT NULL, rest_rule TEXT NOT NULL,
    actual_reps INTEGER, actual_duration_sec INTEGER, actual_weight REAL,
    weight_unit TEXT NOT NULL DEFAULT 'lb', status TEXT NOT NULL, started_at TEXT,
    performed_at TEXT NOT NULL, elapsed_seconds INTEGER, workout_elapsed_seconds INTEGER,
    rest_skipped INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS set_performances_session_set_idx ON set_performances(session_id, prescribed_set_id)",
  `CREATE TABLE IF NOT EXISTS exercise_catalog (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, name TEXT NOT NULL,
    normalized_name TEXT NOT NULL, equipment TEXT NOT NULL DEFAULT 'other',
    movement_pattern TEXT NOT NULL DEFAULT 'other', tracking_type TEXT NOT NULL DEFAULT 'reps',
    default_load_type TEXT NOT NULL DEFAULT 'external', side_mode TEXT NOT NULL DEFAULT 'bilateral',
    instructions TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS exercise_catalog_owner_name_idx ON exercise_catalog(owner_email, normalized_name)",
  "CREATE INDEX IF NOT EXISTS exercise_catalog_owner_active_idx ON exercise_catalog(owner_email, is_active)",
  `CREATE TABLE IF NOT EXISTS exercise_favorites (
    owner_email TEXT NOT NULL,
    exercise_id TEXT NOT NULL REFERENCES exercise_catalog(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_email, exercise_id)
  )`,
  "CREATE INDEX IF NOT EXISTS exercise_favorites_exercise_idx ON exercise_favorites(exercise_id)",
  `CREATE TABLE IF NOT EXISTS exercise_muscles (
    exercise_id TEXT NOT NULL REFERENCES exercise_catalog(id) ON DELETE RESTRICT,
    muscle_group TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'primary',
    weight REAL NOT NULL DEFAULT 1, PRIMARY KEY (exercise_id, muscle_group)
  )`,
  `CREATE TABLE IF NOT EXISTS routine_versions (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    focus TEXT NOT NULL, summary TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 60,
    created_at TEXT NOT NULL, published_at TEXT, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS routine_versions_number_idx ON routine_versions(routine_id, version_number)",
  "CREATE INDEX IF NOT EXISTS routine_versions_owner_routine_idx ON routine_versions(owner_email, routine_id)",
  `CREATE TABLE IF NOT EXISTS routine_version_exercises (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    routine_version_id TEXT NOT NULL REFERENCES routine_versions(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercise_catalog(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL, superset_group TEXT,
    instructions TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS routine_version_exercises_position_idx ON routine_version_exercises(routine_version_id, position)",
  "CREATE INDEX IF NOT EXISTS routine_version_exercises_exercise_idx ON routine_version_exercises(exercise_id)",
  `CREATE TABLE IF NOT EXISTS routine_set_templates (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    routine_exercise_id TEXT NOT NULL REFERENCES routine_version_exercises(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, set_type TEXT NOT NULL, target_type TEXT NOT NULL DEFAULT 'reps',
    target_min REAL, target_max REAL, target_display TEXT NOT NULL,
    target_rir_min REAL, target_rir_max REAL, rest_after_sec INTEGER NOT NULL DEFAULT 0,
    rest_rule TEXT NOT NULL DEFAULT 'standard', load_instruction TEXT NOT NULL DEFAULT '',
    side_mode TEXT NOT NULL DEFAULT 'bilateral', tempo TEXT, notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS routine_set_templates_position_idx ON routine_set_templates(routine_exercise_id, position)",
  `CREATE TABLE IF NOT EXISTS workout_exercises (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    workout_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercise_catalog(id) ON DELETE RESTRICT,
    source_routine_exercise_id TEXT REFERENCES routine_version_exercises(id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    exercise_name_snapshot TEXT NOT NULL, load_type_snapshot TEXT NOT NULL,
    side_mode_snapshot TEXT NOT NULL DEFAULT 'bilateral', status TEXT NOT NULL DEFAULT 'planned',
    notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS workout_exercises_position_idx ON workout_exercises(workout_id, position)",
  "CREATE INDEX IF NOT EXISTS workout_exercises_exercise_idx ON workout_exercises(exercise_id)",
  `CREATE TABLE IF NOT EXISTS workout_sets (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    workout_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
    source_routine_set_id TEXT REFERENCES routine_set_templates(id) ON DELETE SET NULL,
    prescribed_set_id TEXT NOT NULL,
    position INTEGER NOT NULL, set_type TEXT NOT NULL, planned_target_type TEXT NOT NULL DEFAULT 'reps',
    planned_target_min REAL, planned_target_max REAL, planned_target_display TEXT NOT NULL,
    planned_rir_min REAL, planned_rir_max REAL, planned_rest_sec INTEGER NOT NULL DEFAULT 0,
    planned_rest_rule TEXT NOT NULL DEFAULT 'standard', actual_reps INTEGER,
    actual_reps_left INTEGER, actual_reps_right INTEGER, actual_duration_sec INTEGER,
    actual_weight REAL, weight_unit TEXT NOT NULL DEFAULT 'lb', actual_rir REAL,
    actual_rest_sec INTEGER, rest_started_at TEXT, rest_ended_at TEXT,
    rest_skipped INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'planned',
    started_at TEXT, elapsed_seconds INTEGER, completed_at TEXT,
    notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS workout_sets_prescribed_idx ON workout_sets(workout_id, prescribed_set_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS workout_sets_position_idx ON workout_sets(workout_id, position)",
  "CREATE INDEX IF NOT EXISTS workout_sets_exercise_idx ON workout_sets(workout_exercise_id)",
  `CREATE TABLE IF NOT EXISTS coach_profiles (
    owner_email TEXT PRIMARY KEY, primary_goal TEXT NOT NULL DEFAULT 'general fitness',
    training_days_per_week INTEGER NOT NULL DEFAULT 4,
    session_duration_min INTEGER NOT NULL DEFAULT 60,
    equipment TEXT NOT NULL DEFAULT '', limitations TEXT NOT NULL DEFAULT '',
    preferences TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT 'gpt-5.6-terra',
    reasoning_effort TEXT NOT NULL DEFAULT 'medium',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_threads (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New coaching conversation',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS assistant_threads_owner_updated_idx ON assistant_threads(owner_email, updated_at)",
  `CREATE TABLE IF NOT EXISTS assistant_messages (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, reasoning_effort TEXT,
    response_id TEXT, created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS assistant_messages_thread_created_idx ON assistant_messages(thread_id, created_at)",
  `CREATE TABLE IF NOT EXISTS coach_check_ins (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, energy INTEGER NOT NULL,
    soreness INTEGER NOT NULL, sleep_quality INTEGER NOT NULL,
    available_minutes INTEGER, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS coach_check_ins_owner_created_idx ON coach_check_ins(owner_email, created_at)",
  `CREATE TABLE IF NOT EXISTS assistant_change_plans (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
    routine_id TEXT NOT NULL, routine_code TEXT NOT NULL, base_version_id TEXT,
    proposed_input_json TEXT NOT NULL, summary TEXT NOT NULL, rationale TEXT NOT NULL,
    diff_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', applied_version_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS assistant_change_plans_owner_status_idx ON assistant_change_plans(owner_email, status)",
  "CREATE INDEX IF NOT EXISTS assistant_change_plans_thread_created_idx ON assistant_change_plans(thread_id, created_at)",
  `CREATE TABLE IF NOT EXISTS assistant_exercise_change_plans (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
    action TEXT NOT NULL, exercise_id TEXT, exercise_name TEXT NOT NULL,
    base_updated_at TEXT, base_input_json TEXT, proposed_input_json TEXT NOT NULL,
    summary TEXT NOT NULL, rationale TEXT NOT NULL, diff_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', applied_exercise_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS assistant_exercise_change_plans_owner_status_idx ON assistant_exercise_change_plans(owner_email, status)",
  "CREATE INDEX IF NOT EXISTS assistant_exercise_change_plans_thread_created_idx ON assistant_exercise_change_plans(thread_id, created_at)",
  `CREATE TABLE IF NOT EXISTS assistant_tool_calls (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, output_json TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS assistant_tool_calls_thread_created_idx ON assistant_tool_calls(thread_id, created_at)",
];

const additiveColumns: Record<string, Record<string, string>> = {
  routines: {
    current_version_id: "TEXT",
    is_active: "INTEGER NOT NULL DEFAULT 1",
    created_at: "TEXT",
  },
  workout_sessions: {
    rest_ends_at: "TEXT",
    last_performance_id: "TEXT",
    completed_at: "TEXT",
    routine_id: "TEXT",
    routine_version_id: "TEXT",
    body_weight: "REAL",
    weight_unit: "TEXT NOT NULL DEFAULT 'lb'",
    session_notes: "TEXT NOT NULL DEFAULT ''",
    is_archived: "INTEGER NOT NULL DEFAULT 0",
  },
  workout_sets: {
    started_at: "TEXT",
    elapsed_seconds: "INTEGER",
  },
  set_performances: {
    started_at: "TEXT",
    elapsed_seconds: "INTEGER",
    workout_elapsed_seconds: "INTEGER",
  },
};

export async function ensureEntitySchema(d1: D1Database) {
  await d1.batch(createStatements.map((sql) => d1.prepare(sql)));
  for (const [table, columns] of Object.entries(additiveColumns)) {
    const info = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const existing = new Set(info.results.map((column) => column.name));
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.has(name)) await d1.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

async function ensureLegacySeed(d1: D1Database, ownerEmail: string) {
  const existing = await d1.prepare("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ?")
    .bind(ownerEmail).first<{ count: number }>();
  if (Number(existing?.count ?? 0) > 0) return;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const routine of canonicalRoutines) {
    const routineId = `${ownerEmail}::routine::${routine.code}`;
    statements.push(d1.prepare(`INSERT OR IGNORE INTO routines (
      id, owner_email, code, version, focus, summary, duration_min, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(routineId, ownerEmail, routine.code, routine.focus, routine.summary, routine.durationMin, now));
    routine.exercises.forEach((exercise, index) => {
      statements.push(d1.prepare(`INSERT OR IGNORE INTO exercises (
        id, owner_email, routine_code, exercise_order, name, warmup, warmup_sets,
        regular_sets, failure_sets, drop_sets, target, rest, effort, purpose,
        load_type, weight_unit, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lb', ?)`)
        .bind(`${ownerEmail}::exercise::${routine.code}::${index + 1}`, ownerEmail, routine.code,
          index + 1, exercise.name, exercise.warmup, exercise.warmupSets, exercise.regularSets,
          exercise.failureSets, exercise.dropSets, exercise.target, exercise.rest, exercise.effort,
          exercise.purpose, exercise.loadType, now));
    });
  }
  await d1.batch(statements);
}

function inferEquipment(name: string) {
  const value = name.toLowerCase();
  if (value.includes("barbell")) return "barbell";
  if (value.includes("dumbbell")) return "dumbbell";
  if (value.includes("kettlebell")) return "kettlebell";
  if (value.includes("cable") || value.includes("pulldown")) return "cable";
  if (value.includes("bodyweight") || value.includes("pull-up") || value.includes("plank") || value.includes("crunch") || value.includes("knee raise")) return "bodyweight";
  return "other";
}

function inferMovement(code: string, order: number) {
  const muscles = EXERCISE_MUSCLES[code as RoutineCode]?.[order] ?? {};
  if (muscles.quads || muscles.glutes || muscles.hamstrings) return "lower_body";
  if (muscles.back && !muscles.chest) return "pull";
  if (muscles.chest) return "push";
  if (muscles.core) return "core";
  return "accessory";
}

function inferSideMode(target: string) {
  if (/\/leg|per leg/i.test(target)) return "per_leg";
  if (/\/side|per side/i.test(target)) return "per_side";
  return "bilateral";
}

async function catalogExercise(
  d1: D1Database,
  ownerEmail: string,
  exercise: { name: string; loadType: string; target: string },
  code: string,
  order: number,
  now: string,
) {
  const normalizedName = normalizeExerciseName(exercise.name);
  let record = await d1.prepare("SELECT id FROM exercise_catalog WHERE owner_email = ? AND normalized_name = ?")
    .bind(ownerEmail, normalizedName).first<{ id: string }>();
  const statements: D1PreparedStatement[] = [];
  if (!record) {
    record = { id: `${ownerEmail}::catalog::${encodeURIComponent(normalizedName)}` };
    statements.push(d1.prepare(`INSERT OR IGNORE INTO exercise_catalog (
      id, owner_email, name, normalized_name, equipment, movement_pattern, tracking_type,
      default_load_type, side_mode, instructions, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?)`)
      .bind(record.id, ownerEmail, exercise.name, normalizedName, inferEquipment(exercise.name),
        inferMovement(code, order), /sec/i.test(exercise.target) ? "duration" : "reps",
        exercise.loadType, inferSideMode(exercise.target), now, now));
  }
  const muscles = EXERCISE_MUSCLES[code as RoutineCode]?.[order] ?? {};
  for (const [muscle, weight] of Object.entries(muscles) as Array<[MuscleGroup, number]>) {
    statements.push(d1.prepare("INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_group, role, weight) VALUES (?, ?, ?, ?)")
      .bind(record.id, muscle, weight >= 0.75 ? "primary" : "secondary", weight));
  }
  if (statements.length) await d1.batch(statements);
  return record.id;
}

async function ensureHomeGymExerciseCatalog(d1: D1Database, ownerEmail: string) {
  const now = new Date().toISOString();
  for (const exercise of homeGymExercises) {
    const normalizedName = normalizeExerciseName(exercise.name);
    const exerciseId = `${ownerEmail}::home-gym::${encodeURIComponent(normalizedName)}`;
    const existing = await d1.prepare("SELECT id FROM exercise_catalog WHERE owner_email = ? AND (id = ? OR normalized_name = ?)")
      .bind(ownerEmail, exerciseId, normalizedName).first<{ id: string }>();
    if (existing) continue;

    const statements: D1PreparedStatement[] = [
      d1.prepare(`INSERT OR IGNORE INTO exercise_catalog (
        id, owner_email, name, normalized_name, equipment, movement_pattern, tracking_type,
        default_load_type, side_mode, instructions, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(
        exerciseId,
        ownerEmail,
        exercise.name,
        normalizedName,
        exercise.equipment ?? "other",
        exercise.movementPattern ?? "other",
        exercise.trackingType ?? "reps",
        exercise.defaultLoadType ?? "external",
        exercise.sideMode ?? "bilateral",
        exercise.instructions ?? "",
        now,
        now,
      ),
    ];
    for (const muscle of exercise.muscles ?? []) {
      statements.push(d1.prepare("INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_group, role, weight) VALUES (?, ?, ?, ?)")
        .bind(exerciseId, muscle.muscleGroup, muscle.role, muscle.weight));
    }
    await d1.batch(statements);
  }
}

type LegacyExercise = {
  id: string; exerciseOrder: number; name: string; warmup: string; warmupSets: number;
  regularSets: number; failureSets: number; dropSets: number; target: string; rest: string;
  effort: string; purpose: string; loadType: string; weightUnit: string;
};

export async function syncLegacyRoutineVersion(d1: D1Database, ownerEmail: string, code: string) {
  const routine = await d1.prepare(`SELECT id, code, version, focus, summary, duration_min AS durationMin,
    current_version_id AS currentVersionId, updated_at AS updatedAt FROM routines WHERE owner_email = ? AND code = ?`)
    .bind(ownerEmail, code.toUpperCase()).first<{ id: string; code: string; version: number; focus: string; summary: string; durationMin: number; currentVersionId: string | null; updatedAt: string }>();
  if (!routine) return null;
  const now = routine.updatedAt || new Date().toISOString();
  const generatedVersionId = `${routine.id}::version::${routine.version}`;
  const exists = await d1.prepare("SELECT id FROM routine_versions WHERE routine_id = ? AND version_number = ?")
    .bind(routine.id, routine.version).first<{ id: string }>();
  if (exists) {
    await d1.prepare("UPDATE routines SET current_version_id = ?, created_at = COALESCE(created_at, ?) WHERE id = ?")
      .bind(exists.id, now, routine.id).run();
    return exists.id;
  }
  const versionId = generatedVersionId;
  const exercises = await d1.prepare(`SELECT id, exercise_order AS exerciseOrder, name, warmup,
    warmup_sets AS warmupSets, regular_sets AS regularSets, failure_sets AS failureSets,
    drop_sets AS dropSets, target, rest, effort, purpose, load_type AS loadType, weight_unit AS weightUnit
    FROM exercises WHERE owner_email = ? AND routine_code = ? ORDER BY exercise_order`)
    .bind(ownerEmail, routine.code).all<LegacyExercise>();

  await d1.prepare(`INSERT OR IGNORE INTO routine_versions (
    id, owner_email, routine_id, version_number, status, focus, summary, duration_min,
    created_at, published_at, updated_at
  ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?)`)
    .bind(versionId, ownerEmail, routine.id, routine.version, routine.focus, routine.summary,
      Number(routine.durationMin), now, now, now).run();

  for (const legacy of exercises.results) {
    const exerciseId = await catalogExercise(d1, ownerEmail, legacy, routine.code, Number(legacy.exerciseOrder), now);
    const placementId = `${versionId}::exercise::${legacy.exerciseOrder}`;
    const supersetGroup = routine.code === "D" && [6, 7].includes(Number(legacy.exerciseOrder)) ? "arms-1" : null;
    const statements: D1PreparedStatement[] = [d1.prepare(`INSERT OR IGNORE INTO routine_version_exercises (
      id, owner_email, routine_version_id, exercise_id, position, superset_group,
      instructions, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(placementId, ownerEmail, versionId, exerciseId, Number(legacy.exerciseOrder), supersetGroup, legacy.effort, legacy.purpose, now, now)];
    const sets = expandLegacyPrescription({
      warmup: legacy.warmup, warmupSets: Number(legacy.warmupSets), regularSets: Number(legacy.regularSets),
      failureSets: Number(legacy.failureSets), dropSets: Number(legacy.dropSets), target: legacy.target,
      rest: legacy.rest, effort: legacy.effort,
    });
    for (const set of sets) {
      statements.push(d1.prepare(`INSERT OR IGNORE INTO routine_set_templates (
        id, owner_email, routine_exercise_id, position, set_type, target_type, target_min,
        target_max, target_display, target_rir_min, target_rir_max, rest_after_sec, rest_rule,
        load_instruction, side_mode, tempo, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(`${placementId}::set::${set.position}`, ownerEmail, placementId, set.position, set.setType,
          set.targetType, set.targetMin, set.targetMax, set.targetDisplay, set.targetRirMin,
          set.targetRirMax, set.restAfterSec, set.restRule, set.loadInstruction, set.sideMode,
          set.tempo, set.notes, now, now));
    }
    await d1.batch(statements);
  }
  await d1.prepare("UPDATE routines SET current_version_id = ?, created_at = COALESCE(created_at, ?) WHERE id = ?")
    .bind(versionId, now, routine.id).run();
  return versionId;
}

export async function materializeWorkoutFromSnapshot(d1: D1Database, ownerEmail: string, sessionId: string) {
  const existing = await d1.prepare("SELECT id FROM workout_exercises WHERE workout_id = ? LIMIT 1").bind(sessionId).first<{ id: string }>();
  if (existing) return;
  const session = await d1.prepare(`SELECT routine_code AS routineCode, routine_version AS routineVersion,
    snapshot_json AS snapshotJson, started_at AS startedAt FROM workout_sessions
    WHERE id = ? AND owner_email = ?`)
    .bind(sessionId, ownerEmail).first<{ routineCode: string; routineVersion: number; snapshotJson: string; startedAt: string }>();
  if (!session) return;
  const routine = JSON.parse(session.snapshotJson) as Routine;
  const routineRow = await d1.prepare("SELECT id, current_version_id AS currentVersionId FROM routines WHERE owner_email = ? AND code = ?")
    .bind(ownerEmail, session.routineCode).first<{ id: string; currentVersionId: string | null }>();
  const versionExists = routineRow ? await d1.prepare("SELECT id FROM routine_versions WHERE routine_id = ? AND version_number = ?")
    .bind(routineRow.id, session.routineVersion).first<{ id: string }>() : null;
  await d1.prepare("UPDATE workout_sessions SET routine_id = ?, routine_version_id = ? WHERE id = ? AND owner_email = ?")
    .bind(routineRow?.id ?? null, versionExists?.id ?? null, sessionId, ownerEmail).run();

  const guidedSets = buildGuidedSets(routine);
  const normalizedPrescription = getNormalizedWorkoutPrescription(routine);
  const performances = await d1.prepare(`SELECT prescribed_set_id AS prescribedSetId, actual_reps AS actualReps,
    actual_duration_sec AS actualDurationSec, actual_weight AS actualWeight, weight_unit AS weightUnit,
    status, started_at AS startedAt, performed_at AS performedAt,
    elapsed_seconds AS elapsedSeconds, rest_skipped AS restSkipped, notes
    FROM set_performances WHERE session_id = ? AND owner_email = ?`).bind(sessionId, ownerEmail).all<{
      prescribedSetId: string; actualReps: number | null; actualDurationSec: number | null; actualWeight: number | null;
      weightUnit: string; status: string; startedAt: string | null; performedAt: string;
      elapsedSeconds: number | null; restSkipped: number; notes: string;
    }>();
  const performanceBySet = new Map(performances.results.map((item) => [item.prescribedSetId, item]));
  const sourceRows = versionExists ? await d1.prepare(`SELECT rve.id AS placementId, rve.position AS exercisePosition,
    rst.id AS setId, rst.position AS setPosition FROM routine_version_exercises rve
    LEFT JOIN routine_set_templates rst ON rst.routine_exercise_id = rve.id
    WHERE rve.routine_version_id = ?`).bind(versionExists.id).all<{
      placementId: string; exercisePosition: number; setId: string | null; setPosition: number | null;
    }>() : { results: [] };
  const placementByPosition = new Map<number, string>();
  const sourceSetByPosition = new Map<string, string>();
  for (const row of sourceRows.results) {
    placementByPosition.set(Number(row.exercisePosition), row.placementId);
    if (row.setId && row.setPosition !== null) sourceSetByPosition.set(`${row.exercisePosition}:${row.setPosition}`, row.setId);
  }
  const statements: D1PreparedStatement[] = [];

  const materializedExercises = normalizedPrescription
    ? [...normalizedPrescription.exercises]
      .sort((left, right) => left.position - right.position)
      .map((exercise) => ({
        exerciseOrder: exercise.position,
        name: exercise.exerciseName,
        loadType: exercise.loadType,
        weightUnit: exercise.weightUnit,
        sideMode: exercise.sets[0]?.sideMode ?? exercise.sideMode,
        notes: exercise.notes,
        exactExerciseId: exercise.exerciseId,
        exactPlacementId: exercise.sourceRoutineExerciseId,
        legacyExercise: null,
      }))
    : routine.exercises.map((exercise) => ({
      exerciseOrder: exercise.exerciseOrder,
      name: exercise.name,
      loadType: exercise.loadType,
      weightUnit: exercise.weightUnit,
      sideMode: inferSideMode(exercise.target),
      notes: "",
      exactExerciseId: null,
      exactPlacementId: null,
      legacyExercise: exercise,
    }));

  for (const exercise of materializedExercises) {
    const exerciseId = exercise.exactExerciseId ?? await catalogExercise(
      d1,
      ownerEmail,
      exercise.legacyExercise!,
      routine.code,
      exercise.exerciseOrder,
      session.startedAt,
    );
    const placementId = exercise.exactPlacementId ?? placementByPosition.get(exercise.exerciseOrder) ?? null;
    const workoutExerciseId = `${sessionId}::exercise::${exercise.exerciseOrder}`;
    statements.push(d1.prepare(`INSERT OR IGNORE INTO workout_exercises (
      id, owner_email, workout_id, exercise_id, source_routine_exercise_id, position,
      exercise_name_snapshot, load_type_snapshot, side_mode_snapshot, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`)
      .bind(workoutExerciseId, ownerEmail, sessionId, exerciseId, placementId,
        exercise.exerciseOrder, exercise.name, exercise.loadType,
        exercise.sideMode, exercise.notes, session.startedAt, session.startedAt));

    const exerciseSets = guidedSets.filter((set) => set.exerciseOrder === exercise.exerciseOrder);
    for (const set of exerciseSets) {
      const performance = performanceBySet.get(set.id);
      const range = set.target.match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)/);
      const single = set.target.match(/\d+(?:\.\d+)?/);
      const parsedTargetMin = range ? Number(range[1]) : single ? Number(single[0]) : null;
      const parsedTargetMax = range ? Number(range[2]) : parsedTargetMin;
      const targetMin = set.targetType === undefined ? parsedTargetMin : set.targetMin ?? null;
      const targetMax = set.targetType === undefined ? parsedTargetMax : set.targetMax ?? null;
      const sourceSetId = set.sourceRoutineSetId
        ?? sourceSetByPosition.get(`${exercise.exerciseOrder}:${set.exerciseSetNumber}`)
        ?? null;
      statements.push(d1.prepare(`INSERT OR IGNORE INTO workout_sets (
        id, owner_email, workout_id, workout_exercise_id, source_routine_set_id, prescribed_set_id,
        position, set_type, planned_target_type, planned_target_min, planned_target_max,
        planned_target_display, planned_rir_min, planned_rir_max, planned_rest_sec, planned_rest_rule,
        actual_reps, actual_duration_sec, actual_weight, weight_unit, rest_skipped, status,
        started_at, elapsed_seconds, completed_at, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(`${sessionId}::set::${set.globalIndex + 1}`, ownerEmail, sessionId, workoutExerciseId,
          sourceSetId, set.id, set.globalIndex + 1, set.setType,
          set.targetType ?? (set.targetUnit === "seconds" ? "duration" : set.targetUnit === "rounds" || set.setType === "emom" ? "rounds" : "reps"),
          targetMin, targetMax, set.target, set.targetRirMin ?? null, set.targetRirMax ?? null,
          set.restSeconds, set.restRule,
          performance?.actualReps ?? null, performance?.actualDurationSec ?? null,
          performance?.actualWeight ?? null, performance?.weightUnit ?? exercise.weightUnit,
          Number(performance?.restSkipped ?? 0), performance?.status?.toLowerCase() ?? "planned",
          performance?.startedAt ?? null, performance?.elapsedSeconds ?? null,
          performance?.performedAt ?? null, performance?.notes || set.notes || "", session.startedAt,
          performance?.performedAt ?? session.startedAt));
    }
  }
  if (statements.length) await d1.batch(statements);
}

export async function ensureEntityData(d1: D1Database, ownerEmail: string) {
  await ensureLegacySeed(d1, ownerEmail);
  const routines = await d1.prepare(`SELECT r.code FROM routines r
    LEFT JOIN routine_versions rv ON rv.routine_id = r.id AND rv.version_number = r.version
    WHERE r.owner_email = ? AND (r.current_version_id IS NULL OR rv.id IS NULL OR r.current_version_id <> rv.id)
    ORDER BY r.code`).bind(ownerEmail).all<{ code: string }>();
  for (const routine of routines.results) await syncLegacyRoutineVersion(d1, ownerEmail, routine.code);
  await ensureHomeGymExerciseCatalog(d1, ownerEmail);
  const sessions = await d1.prepare(`SELECT ws.id FROM workout_sessions ws
    LEFT JOIN workout_exercises we ON we.workout_id = ws.id
    WHERE ws.owner_email = ? GROUP BY ws.id HAVING COUNT(we.id) = 0`)
    .bind(ownerEmail).all<{ id: string }>();
  for (const session of sessions.results) await materializeWorkoutFromSnapshot(d1, ownerEmail, session.id);
}
