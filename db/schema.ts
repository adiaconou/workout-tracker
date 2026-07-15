import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const routines = sqliteTable(
  "routines",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    code: text("code").notNull(),
    version: integer("version").notNull().default(1),
    focus: text("focus").notNull(),
    summary: text("summary").notNull(),
    durationMin: integer("duration_min").notNull().default(60),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("routines_owner_code_idx").on(table.ownerEmail, table.code),
  ],
);

export const exercises = sqliteTable(
  "exercises",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    routineCode: text("routine_code").notNull(),
    exerciseOrder: integer("exercise_order").notNull(),
    name: text("name").notNull(),
    warmup: text("warmup").notNull(),
    warmupSets: integer("warmup_sets").notNull().default(0),
    regularSets: integer("regular_sets").notNull().default(0),
    failureSets: integer("failure_sets").notNull().default(0),
    dropSets: integer("drop_sets").notNull().default(0),
    target: text("target").notNull(),
    rest: text("rest").notNull(),
    effort: text("effort").notNull(),
    purpose: text("purpose").notNull(),
    loadType: text("load_type").notNull().default("external"),
    weightUnit: text("weight_unit").notNull().default("lb"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("exercises_owner_routine_order_idx").on(
      table.ownerEmail,
      table.routineCode,
      table.exerciseOrder,
    ),
  ],
);

export const workoutSessions = sqliteTable(
  "workout_sessions",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    routineCode: text("routine_code").notNull(),
    routineVersion: integer("routine_version").notNull(),
    status: text("status").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    currentExercise: integer("current_exercise").notNull().default(1),
    currentSet: integer("current_set").notNull().default(1),
    completedSets: integer("completed_sets").notNull().default(0),
    skippedSets: integer("skipped_sets").notNull().default(0),
    totalSets: integer("total_sets").notNull(),
    restEndsAt: text("rest_ends_at"),
    lastPerformanceId: text("last_performance_id"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
);

export const setPerformances = sqliteTable(
  "set_performances",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    sessionId: text("session_id").notNull(),
    prescribedSetId: text("prescribed_set_id").notNull(),
    exerciseId: text("exercise_id").notNull(),
    exerciseOrder: integer("exercise_order").notNull(),
    exerciseName: text("exercise_name").notNull(),
    setOrder: integer("set_order").notNull(),
    setType: text("set_type").notNull(),
    targetDisplay: text("target_display").notNull(),
    targetRestSec: integer("target_rest_sec").notNull(),
    restRule: text("rest_rule").notNull(),
    actualReps: integer("actual_reps"),
    actualDurationSec: integer("actual_duration_sec"),
    actualWeight: real("actual_weight"),
    weightUnit: text("weight_unit").notNull().default("lb"),
    status: text("status").notNull(),
    performedAt: text("performed_at").notNull(),
    restSkipped: integer("rest_skipped").notNull().default(0),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("set_performances_session_set_idx").on(
      table.sessionId,
      table.prescribedSetId,
    ),
  ],
);
