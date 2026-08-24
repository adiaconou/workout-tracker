import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  currentOnboardingVersion,
  legacyAllEquipmentJson,
  legacyWorkoutDurationMinutes,
} from "../../domain/training-profile";

export const appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    displayName: text("display_name").notNull(),
    photoUrl: text("photo_url"),
    heightCm: real("height_cm"),
    bodyWeightKg: real("body_weight_kg"),
    measurementSystem: text("measurement_system").notNull().default("imperial"),
    equipmentPreferencesJson: text("equipment_preferences_json")
      .notNull()
      .default(legacyAllEquipmentJson),
    preferredWorkoutDurationMin: integer("preferred_workout_duration_min")
      .notNull()
      .default(legacyWorkoutDurationMinutes),
    progressiveTrainingEnabled: integer("progressive_training_enabled")
      .notNull()
      .default(0),
    onboardingVersion: integer("onboarding_version")
      .notNull()
      .default(currentOnboardingVersion),
    onboardingCompletedAt: text("onboarding_completed_at"),
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

export const routinePrograms = sqliteTable(
  "routine_programs",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    selectedMuscleGroupsJson: text("selected_muscle_groups_json").notNull().default("[]"),
    trainingDaysPerWeek: integer("training_days_per_week").notNull(),
    targetDurationMin: integer("target_duration_min").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    idempotencyKey: text("idempotency_key"),
    requestFingerprint: text("request_fingerprint").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("routine_programs_owner_idempotency_idx").on(
      table.ownerEmail,
      table.idempotencyKey,
    ),
    uniqueIndex("routine_programs_one_active_owner_idx")
      .on(table.ownerEmail)
      .where(sql`${table.isActive} = 1`),
    index("routine_programs_owner_updated_idx").on(table.ownerEmail, table.updatedAt),
  ],
);

export const routineProgramRoutines = sqliteTable(
  "routine_program_routines",
  {
    programId: text("program_id").notNull().references(() => routinePrograms.id, { onDelete: "cascade" }),
    routineId: text("routine_id").notNull().references(() => routines.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.programId, table.routineId] }),
    uniqueIndex("routine_program_routines_position_idx").on(table.programId, table.position),
    index("routine_program_routines_routine_idx").on(table.routineId),
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
    origin: text("origin").notNull().default("custom"),
    templateKey: text("template_key"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("exercise_catalog_owner_name_idx").on(table.ownerEmail, table.normalizedName),
    uniqueIndex("exercise_catalog_owner_template_idx").on(table.ownerEmail, table.templateKey),
    index("exercise_catalog_owner_active_idx").on(table.ownerEmail, table.isActive),
  ],
);

export const exerciseFavorites = sqliteTable(
  "exercise_favorites",
  {
    ownerEmail: text("owner_email").notNull(),
    exerciseId: text("exercise_id").notNull().references(() => exerciseCatalog.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerEmail, table.exerciseId] }),
    index("exercise_favorites_exercise_idx").on(table.exerciseId),
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
    bodyWeightSource: text("body_weight_source"),
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
    startedAt: text("started_at"),
    elapsedSeconds: integer("elapsed_seconds"),
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
    startedAt: text("started_at"),
    performedAt: text("performed_at").notNull(),
    elapsedSeconds: integer("elapsed_seconds"),
    workoutElapsedSeconds: integer("workout_elapsed_seconds"),
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

export const coachProfiles = sqliteTable(
  "coach_profiles",
  {
    ownerEmail: text("owner_email").primaryKey(),
    primaryGoal: text("primary_goal").notNull().default("general fitness"),
    trainingDaysPerWeek: integer("training_days_per_week").notNull().default(4),
    sessionDurationMin: integer("session_duration_min").notNull().default(60),
    equipment: text("equipment").notNull().default(""),
    limitations: text("limitations").notNull().default(""),
    preferences: text("preferences").notNull().default(""),
    model: text("model").notNull().default("gpt-5.6-terra"),
    reasoningEffort: text("reasoning_effort").notNull().default("medium"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const assistantProgramGenerationJobs = sqliteTable(
  "assistant_program_generation_jobs",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    openAIResponseId: text("openai_response_id"),
    status: text("status").notNull().default("starting"),
    requestJson: text("request_json").notNull(),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorRetryable: integer("error_retryable", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("assistant_program_generation_jobs_owner_idempotency_idx").on(
      table.ownerEmail,
      table.idempotencyKey,
    ),
    uniqueIndex("assistant_program_generation_jobs_openai_response_idx").on(table.openAIResponseId),
    index("assistant_program_generation_jobs_owner_updated_idx").on(table.ownerEmail, table.updatedAt),
    index("assistant_program_generation_jobs_expires_idx").on(table.expiresAt),
  ],
);

export const assistantThreads = sqliteTable(
  "assistant_threads",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    title: text("title").notNull().default("New coaching conversation"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assistant_threads_owner_updated_idx").on(table.ownerEmail, table.updatedAt),
  ],
);

export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    threadId: text("thread_id").notNull().references(() => assistantThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    reasoningEffort: text("reasoning_effort"),
    responseId: text("response_id"),
    activitiesJson: text("activities_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("assistant_messages_thread_created_idx").on(table.threadId, table.createdAt),
  ],
);

export const coachCheckIns = sqliteTable(
  "coach_check_ins",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    energy: integer("energy").notNull(),
    soreness: integer("soreness").notNull(),
    sleepQuality: integer("sleep_quality").notNull(),
    availableMinutes: integer("available_minutes"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("coach_check_ins_owner_created_idx").on(table.ownerEmail, table.createdAt),
  ],
);

export const assistantChangePlans = sqliteTable(
  "assistant_change_plans",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    threadId: text("thread_id").notNull().references(() => assistantThreads.id, { onDelete: "cascade" }),
    routineId: text("routine_id").notNull(),
    routineCode: text("routine_code").notNull(),
    baseVersionId: text("base_version_id"),
    proposedInputJson: text("proposed_input_json").notNull(),
    summary: text("summary").notNull(),
    rationale: text("rationale").notNull(),
    diffJson: text("diff_json").notNull(),
    status: text("status").notNull().default("pending"),
    appliedVersionId: text("applied_version_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assistant_change_plans_owner_status_idx").on(table.ownerEmail, table.status),
    index("assistant_change_plans_thread_created_idx").on(table.threadId, table.createdAt),
  ],
);

export const assistantExerciseChangePlans = sqliteTable(
  "assistant_exercise_change_plans",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    threadId: text("thread_id").notNull().references(() => assistantThreads.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    exerciseId: text("exercise_id"),
    exerciseName: text("exercise_name").notNull(),
    baseUpdatedAt: text("base_updated_at"),
    baseInputJson: text("base_input_json"),
    proposedInputJson: text("proposed_input_json").notNull(),
    summary: text("summary").notNull(),
    rationale: text("rationale").notNull(),
    diffJson: text("diff_json").notNull(),
    status: text("status").notNull().default("pending"),
    appliedExerciseId: text("applied_exercise_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assistant_exercise_change_plans_owner_status_idx").on(table.ownerEmail, table.status),
    index("assistant_exercise_change_plans_thread_created_idx").on(table.threadId, table.createdAt),
  ],
);

export const assistantToolCalls = sqliteTable(
  "assistant_tool_calls",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    threadId: text("thread_id").notNull().references(() => assistantThreads.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    argumentsJson: text("arguments_json").notNull(),
    outputJson: text("output_json").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("assistant_tool_calls_thread_created_idx").on(table.threadId, table.createdAt),
  ],
);
