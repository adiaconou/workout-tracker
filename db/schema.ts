import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("app_users_owner_email_idx").on(table.ownerEmail),
  ],
);

export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("auth_identities_provider_subject_idx").on(table.provider, table.providerSubject),
    index("auth_identities_user_idx").on(table.userId),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    deviceName: text("device_name").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
    rotatedAt: text("rotated_at").notNull(),
    lastUsedAt: text("last_used_at").notNull(),
  },
  (table) => [
    uniqueIndex("auth_sessions_refresh_hash_idx").on(table.refreshTokenHash),
    index("auth_sessions_user_idx").on(table.userId),
  ],
);

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
    currentVersionId: text("current_version_id"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at"),
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

export const exerciseCatalog = sqliteTable(
  "exercise_catalog",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    equipment: text("equipment").notNull().default("other"),
    movementPattern: text("movement_pattern").notNull().default("other"),
    trackingType: text("tracking_type").notNull().default("reps"),
    defaultLoadType: text("default_load_type").notNull().default("external"),
    sideMode: text("side_mode").notNull().default("bilateral"),
    instructions: text("instructions").notNull().default(""),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("exercise_catalog_owner_name_idx").on(table.ownerEmail, table.normalizedName),
    index("exercise_catalog_owner_active_idx").on(table.ownerEmail, table.isActive),
  ],
);

export const exerciseMuscles = sqliteTable(
  "exercise_muscles",
  {
    exerciseId: text("exercise_id").notNull().references(() => exerciseCatalog.id, { onDelete: "restrict" }),
    muscleGroup: text("muscle_group").notNull(),
    role: text("role").notNull().default("primary"),
    weight: real("weight").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.exerciseId, table.muscleGroup] }),
  ],
);

export const routineVersions = sqliteTable(
  "routine_versions",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    routineId: text("routine_id").notNull().references(() => routines.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    focus: text("focus").notNull(),
    summary: text("summary").notNull(),
    durationMin: integer("duration_min").notNull().default(60),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("routine_versions_number_idx").on(table.routineId, table.versionNumber),
    index("routine_versions_owner_routine_idx").on(table.ownerEmail, table.routineId),
  ],
);

export const routineVersionExercises = sqliteTable(
  "routine_version_exercises",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    routineVersionId: text("routine_version_id").notNull().references(() => routineVersions.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull().references(() => exerciseCatalog.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    supersetGroup: text("superset_group"),
    instructions: text("instructions").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("routine_version_exercises_position_idx").on(table.routineVersionId, table.position),
    index("routine_version_exercises_exercise_idx").on(table.exerciseId),
  ],
);

export const routineSetTemplates = sqliteTable(
  "routine_set_templates",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    routineExerciseId: text("routine_exercise_id").notNull().references(() => routineVersionExercises.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    setType: text("set_type").notNull(),
    targetType: text("target_type").notNull().default("reps"),
    targetMin: real("target_min"),
    targetMax: real("target_max"),
    targetDisplay: text("target_display").notNull(),
    targetRirMin: real("target_rir_min"),
    targetRirMax: real("target_rir_max"),
    restAfterSec: integer("rest_after_sec").notNull().default(0),
    restRule: text("rest_rule").notNull().default("standard"),
    loadInstruction: text("load_instruction").notNull().default(""),
    sideMode: text("side_mode").notNull().default("bilateral"),
    tempo: text("tempo"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("routine_set_templates_position_idx").on(table.routineExerciseId, table.position),
  ],
);

export const workoutSessions = sqliteTable(
  "workout_sessions",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    routineCode: text("routine_code").notNull(),
    routineVersion: integer("routine_version").notNull(),
    routineId: text("routine_id"),
    routineVersionId: text("routine_version_id"),
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
    bodyWeight: real("body_weight"),
    weightUnit: text("weight_unit").notNull().default("lb"),
    sessionNotes: text("session_notes").notNull().default(""),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
  },
);

export const workoutExercises = sqliteTable(
  "workout_exercises",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    workoutId: text("workout_id").notNull().references(() => workoutSessions.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull().references(() => exerciseCatalog.id, { onDelete: "restrict" }),
    sourceRoutineExerciseId: text("source_routine_exercise_id").references(() => routineVersionExercises.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    exerciseNameSnapshot: text("exercise_name_snapshot").notNull(),
    loadTypeSnapshot: text("load_type_snapshot").notNull(),
    sideModeSnapshot: text("side_mode_snapshot").notNull().default("bilateral"),
    status: text("status").notNull().default("planned"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("workout_exercises_position_idx").on(table.workoutId, table.position),
    index("workout_exercises_exercise_idx").on(table.exerciseId),
  ],
);

export const workoutSets = sqliteTable(
  "workout_sets",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    workoutId: text("workout_id").notNull().references(() => workoutSessions.id, { onDelete: "cascade" }),
    workoutExerciseId: text("workout_exercise_id").notNull().references(() => workoutExercises.id, { onDelete: "cascade" }),
    sourceRoutineSetId: text("source_routine_set_id").references(() => routineSetTemplates.id, { onDelete: "set null" }),
    prescribedSetId: text("prescribed_set_id").notNull(),
    position: integer("position").notNull(),
    setType: text("set_type").notNull(),
    plannedTargetType: text("planned_target_type").notNull().default("reps"),
    plannedTargetMin: real("planned_target_min"),
    plannedTargetMax: real("planned_target_max"),
    plannedTargetDisplay: text("planned_target_display").notNull(),
    plannedRirMin: real("planned_rir_min"),
    plannedRirMax: real("planned_rir_max"),
    plannedRestSec: integer("planned_rest_sec").notNull().default(0),
    plannedRestRule: text("planned_rest_rule").notNull().default("standard"),
    actualReps: integer("actual_reps"),
    actualRepsLeft: integer("actual_reps_left"),
    actualRepsRight: integer("actual_reps_right"),
    actualDurationSec: integer("actual_duration_sec"),
    actualWeight: real("actual_weight"),
    weightUnit: text("weight_unit").notNull().default("lb"),
    actualRir: real("actual_rir"),
    actualRestSec: integer("actual_rest_sec"),
    restStartedAt: text("rest_started_at"),
    restEndedAt: text("rest_ended_at"),
    restSkipped: integer("rest_skipped", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("planned"),
    completedAt: text("completed_at"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("workout_sets_prescribed_idx").on(table.workoutId, table.prescribedSetId),
    uniqueIndex("workout_sets_position_idx").on(table.workoutId, table.position),
    index("workout_sets_exercise_idx").on(table.workoutExerciseId),
  ],
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
