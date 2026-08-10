import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../", import.meta.url);
const entityMigrationFilenames = [
  "drizzle/0000_bent_starjammers.sql",
  "drizzle/0001_windy_timeslip.sql",
  "drizzle/0002_workable_whizzer.sql",
  "drizzle/0003_faulty_sandman.sql",
  "drizzle/0004_nebulous_lila_cheney.sql",
  "drizzle/0005_plain_rocket_raccoon.sql",
  "drizzle/0006_freezing_betty_ross.sql",
  "drizzle/0007_glorious_vermin.sql",
  "drizzle/0008_nervous_selene.sql",
  "drizzle/0009_profile_measurements.sql",
  "drizzle/0010_opposite_microbe.sql",
  "drizzle/0011_repair_workout_set_metrics.sql",
  "drizzle/0012_sturdy_harpoon.sql",
  "drizzle/0013_outstanding_jean_grey.sql",
  "drizzle/0014_program_generation_jobs.sql",
];

test("applies the complete migration chain and creates the normalized entity model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-entities-"));
  const database = join(directory, "entities.sqlite");
  try {
    const sql = (await Promise.all(entityMigrationFilenames.map((filename) => readFile(new URL(filename, root), "utf8"))))
      .join("\n").replaceAll("--> statement-breakpoint", "\n");
    const sqlite = new DatabaseSync(database);
    sqlite.exec(sql);
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const workoutSetColumns = sqlite.prepare("PRAGMA table_info(workout_sets)").all();
    const setPerformanceColumns = sqlite.prepare("PRAGMA table_info(set_performances)").all();
    const appUserColumns = sqlite.prepare("PRAGMA table_info(app_users)").all();
    const programIndexes = sqlite.prepare("PRAGMA index_list(routine_programs)").all();
    const exerciseCatalogColumns = sqlite.prepare("PRAGMA table_info(exercise_catalog)").all();
    const exerciseCatalogIndexes = sqlite.prepare("PRAGMA index_list(exercise_catalog)").all();
    const programGenerationJobColumns = sqlite.prepare("PRAGMA table_info(assistant_program_generation_jobs)").all();
    const programGenerationJobIndexes = sqlite.prepare("PRAGMA index_list(assistant_program_generation_jobs)").all();
    const inspected = JSON.stringify({
      tables,
      appUsers: appUserColumns,
      exerciseCatalog: sqlite.prepare("PRAGMA table_info(exercise_catalog)").all(),
      routines: sqlite.prepare("PRAGMA table_info(routines)").all(),
      workoutSessions: sqlite.prepare("PRAGMA table_info(workout_sessions)").all(),
      workoutSets: workoutSetColumns,
      setPerformances: setPerformanceColumns,
      authSessions: sqlite.prepare("PRAGMA table_info(auth_sessions)").all(),
      exercisePlans: sqlite.prepare("PRAGMA table_info(assistant_exercise_change_plans)").all(),
      exercisePlanIndexes: sqlite.prepare("PRAGMA index_list(assistant_exercise_change_plans)").all(),
      exercisePlanForeignKeys: sqlite.prepare("PRAGMA foreign_key_list(assistant_exercise_change_plans)").all(),
      programGenerationJobs: programGenerationJobColumns,
      programGenerationJobIndexes,
      workoutSetForeignKeys: sqlite.prepare("PRAGMA foreign_key_list(workout_sets)").all(),
    });
    sqlite.close();
    for (const table of ["app_users", "auth_identities", "auth_sessions", "exercise_catalog", "exercise_favorites", "exercise_muscles", "routine_programs", "routine_program_routines", "routine_versions", "routine_version_exercises", "routine_set_templates", "workout_exercises", "workout_sets", "coach_profiles", "assistant_program_generation_jobs", "assistant_threads", "assistant_messages", "coach_check_ins", "assistant_change_plans", "assistant_exercise_change_plans", "assistant_tool_calls"]) {
      assert.match(inspected, new RegExp(`\\b${table}\\b`));
    }
    assert.match(inspected, /current_version_id/);
    assert.match(inspected, /routine_version_id/);
    assert.match(inspected, /is_archived/);
    assert.match(inspected, /started_at/);
    assert.match(inspected, /elapsed_seconds/);
    assert.match(inspected, /workout_elapsed_seconds/);
    assert.match(inspected, /photo_url/);
    assert.match(inspected, /height_cm/);
    assert.match(inspected, /body_weight_kg/);
    assert.match(inspected, /measurement_system/);
    assert.match(inspected, /body_weight_source/);
    assert.match(inspected, /equipment_preferences_json/);
    assert.match(inspected, /preferred_workout_duration_min/);
    assert.match(inspected, /onboarding_version/);
    assert.match(inspected, /onboarding_completed_at/);
    assert.match(inspected, /origin/);
    assert.match(inspected, /template_key/);
    assert.match(inspected, /workout_exercises/);
    assert.match(inspected, /routine_set_templates/);
    assert.match(inspected, /refresh_token_hash/);
    assert.match(inspected, /base_updated_at/);
    assert.match(inspected, /base_input_json/);
    assert.match(inspected, /applied_exercise_id/);
    assert.match(inspected, /assistant_exercise_change_plans_owner_status_idx/);
    assert.match(inspected, /assistant_exercise_change_plans_thread_created_idx/);
    assert.ok(programIndexes.some((index) => index.name === "routine_programs_one_active_owner_idx" && index.unique === 1));
    assert.deepEqual(
      exerciseCatalogColumns
        .filter((column) => ["origin", "template_key"].includes(column.name))
        .map((column) => column.name),
      ["origin", "template_key"],
    );
    const originColumn = exerciseCatalogColumns.find((column) => column.name === "origin");
    assert.equal(originColumn.notnull, 1);
    assert.equal(originColumn.dflt_value, "'custom'");
    assert.ok(exerciseCatalogIndexes.some(
      (index) => index.name === "exercise_catalog_owner_template_idx" && index.unique === 1,
    ));
    assert.deepEqual(
      programGenerationJobColumns.map((column) => column.name),
      [
        "id", "owner_email", "idempotency_key", "request_fingerprint", "openai_response_id",
        "status", "request_json", "result_json", "error_code", "error_message",
        "error_retryable", "created_at", "updated_at", "expires_at",
      ],
    );
    assert.equal(programGenerationJobColumns.find((column) => column.name === "openai_response_id")?.notnull, 0);
    assert.equal(programGenerationJobColumns.find((column) => column.name === "error_retryable")?.dflt_value, "false");
    assert.ok(programGenerationJobIndexes.some(
      (index) => index.name === "assistant_program_generation_jobs_owner_idempotency_idx" && index.unique === 1,
    ));
    assert.ok(programGenerationJobIndexes.some(
      (index) => index.name === "assistant_program_generation_jobs_openai_response_idx" && index.unique === 1,
    ));
    assert.ok(programGenerationJobIndexes.some(
      (index) => index.name === "assistant_program_generation_jobs_owner_updated_idx" && index.unique === 0,
    ));
    assert.ok(programGenerationJobIndexes.some(
      (index) => index.name === "assistant_program_generation_jobs_expires_idx" && index.unique === 0,
    ));
    assert.deepEqual(
      workoutSetColumns.filter((column) => ["started_at", "elapsed_seconds"].includes(column.name)).map((column) => column.name),
      ["started_at", "elapsed_seconds"],
    );
    assert.deepEqual(
      setPerformanceColumns.filter((column) => ["started_at", "elapsed_seconds", "workout_elapsed_seconds"].includes(column.name)).map((column) => column.name),
      ["started_at", "elapsed_seconds", "workout_elapsed_seconds"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exercise provenance migration adopts generated defaults without changing owner customizations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-exercise-provenance-"));
  const database = join(directory, "exercise-provenance.sqlite");
  try {
    const sqlite = new DatabaseSync(database);
    const provenanceMigration = "drizzle/0013_outstanding_jean_grey.sql";
    const priorSql = (await Promise.all(entityMigrationFilenames
      .slice(0, entityMigrationFilenames.indexOf(provenanceMigration)).map(
      (filename) => readFile(new URL(filename, root), "utf8"),
    ))).join("\n").replaceAll("--> statement-breakpoint", "\n");
    sqlite.exec(priorSql);
    const owner = "legacy-defaults@example.com";
    const generatedId = `${owner}::home-gym::wide-grip%20pull-up`;
    const now = "2026-08-09T12:00:00.000Z";
    sqlite.prepare(`INSERT INTO exercise_catalog (
      id, owner_email, name, normalized_name, equipment, movement_pattern,
      tracking_type, default_load_type, side_mode, instructions, is_active,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pull_up_station', 'vertical_pull', 'reps',
      'bodyweight', 'bilateral', '', 0, ?, ?)`).run(
      generatedId,
      owner,
      "My renamed archived pull-up",
      "my renamed archived pull-up",
      now,
      now,
    );
    sqlite.prepare(`INSERT INTO exercise_catalog (
      id, owner_email, name, normalized_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(
      "custom-exercise-id",
      owner,
      "Private custom exercise",
      "private custom exercise",
      now,
      now,
    );

    sqlite.exec((await readFile(
      new URL(provenanceMigration, root),
      "utf8",
    )).replaceAll("--> statement-breakpoint", "\n"));

    assert.deepEqual({ ...sqlite.prepare(`SELECT name, is_active AS isActive,
      origin, template_key AS templateKey FROM exercise_catalog WHERE id = ?`).get(generatedId) }, {
      name: "My renamed archived pull-up",
      isActive: 0,
      origin: "default",
      templateKey: "home-gym:wide-grip%20pull-up",
    });
    assert.deepEqual({ ...sqlite.prepare(`SELECT origin, template_key AS templateKey
      FROM exercise_catalog WHERE id = ?`).get("custom-exercise-id") }, {
      origin: "custom",
      templateKey: null,
    });
    sqlite.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("onboarding migration preserves existing users as completed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-onboarding-migration-"));
  const database = join(directory, "onboarding.sqlite");
  try {
    const beforeOnboarding = Array.from(
      { length: 10 },
      (_, index) => `drizzle/${String(index).padStart(4, "0")}_${[
        "bent_starjammers",
        "windy_timeslip",
        "workable_whizzer",
        "faulty_sandman",
        "nebulous_lila_cheney",
        "plain_rocket_raccoon",
        "freezing_betty_ross",
        "glorious_vermin",
        "nervous_selene",
        "profile_measurements",
      ][index]}.sql`,
    );
    const sqlite = new DatabaseSync(database);
    const priorSql = (await Promise.all(beforeOnboarding.map((filename) =>
      readFile(new URL(filename, root), "utf8"))))
      .join("\n").replaceAll("--> statement-breakpoint", "\n");
    sqlite.exec(priorSql);
    const updatedAt = "2026-08-01T12:00:00.000Z";
    sqlite.prepare(`INSERT INTO app_users (
      id, owner_email, display_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)`).run(
      "legacy-user",
      "legacy@example.com",
      "Legacy User",
      updatedAt,
      updatedAt,
    );
    sqlite.exec((await readFile(new URL("drizzle/0010_opposite_microbe.sql", root), "utf8"))
      .replaceAll("--> statement-breakpoint", "\n"));
    const migrated = sqlite.prepare(`SELECT equipment_preferences_json AS equipment,
      preferred_workout_duration_min AS duration, onboarding_version AS version,
      onboarding_completed_at AS completedAt FROM app_users WHERE id = ?`)
      .get("legacy-user");
    assert.equal(migrated.duration, 60);
    assert.equal(migrated.version, 1);
    assert.equal(migrated.completedAt, updatedAt);
    assert.ok(JSON.parse(migrated.equipment).includes("barbell"));
    sqlite.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("metric repair clears only zeroes stored in the wrong result field", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-metric-repair-"));
  const database = join(directory, "metrics.sqlite");
  try {
    const sqlite = new DatabaseSync(database);
    sqlite.exec(`
      CREATE TABLE workout_sets (
        owner_email TEXT NOT NULL,
        workout_id TEXT NOT NULL,
        prescribed_set_id TEXT NOT NULL,
        planned_target_type TEXT NOT NULL,
        actual_reps INTEGER,
        actual_duration_sec INTEGER
      );
      CREATE TABLE set_performances (
        owner_email TEXT NOT NULL,
        session_id TEXT NOT NULL,
        prescribed_set_id TEXT NOT NULL,
        set_type TEXT NOT NULL,
        target_display TEXT NOT NULL,
        actual_reps INTEGER,
        actual_duration_sec INTEGER
      );
      INSERT INTO workout_sets VALUES
        ('owner', 'workout', 'reps', 'reps', 6, 0),
        ('owner', 'workout', 'rounds', 'rounds', 5, 0),
        ('owner', 'workout', 'duration', 'duration', 0, 30),
        ('owner', 'workout', 'zero-reps', 'reps', 0, 0),
        ('owner', 'workout', 'zero-duration', 'duration', 0, 0),
        ('owner', 'workout', 'positive-extra', 'reps', 6, 5);
      INSERT INTO set_performances VALUES
        ('owner', 'workout', 'reps', 'regular', '6 reps', 6, 0),
        ('owner', 'workout', 'rounds', 'regular', '30 sec', 5, 0),
        ('owner', 'workout', 'duration', 'regular', '6 reps', 0, 30),
        ('owner', 'missing', 'legacy-reps', 'regular', '8 reps', 8, 0),
        ('owner', 'missing', 'legacy-duration', 'regular', '30 sec', 0, 30),
        ('owner', 'missing', 'legacy-rounds', 'regular', '5 rounds', 5, 0),
        ('owner', 'missing', 'legacy-emom', 'emom', '5', 5, 0),
        ('owner', 'missing', 'positive-extra', 'regular', '6 reps', 6, 5);
    `);
    sqlite.exec((await readFile(
      new URL("drizzle/0011_repair_workout_set_metrics.sql", root),
      "utf8",
    )).replaceAll("--> statement-breakpoint", "\n"));

    const workoutSets = new Map(sqlite.prepare(`SELECT prescribed_set_id AS id,
      actual_reps AS reps, actual_duration_sec AS duration FROM workout_sets`)
      .all().map((row) => [row.id, row]));
    assert.deepEqual({ ...workoutSets.get("reps") }, { id: "reps", reps: 6, duration: null });
    assert.deepEqual({ ...workoutSets.get("rounds") }, { id: "rounds", reps: 5, duration: null });
    assert.deepEqual({ ...workoutSets.get("duration") }, { id: "duration", reps: null, duration: 30 });
    assert.deepEqual({ ...workoutSets.get("zero-reps") }, { id: "zero-reps", reps: 0, duration: null });
    assert.deepEqual({ ...workoutSets.get("zero-duration") }, { id: "zero-duration", reps: null, duration: 0 });
    assert.deepEqual({ ...workoutSets.get("positive-extra") }, { id: "positive-extra", reps: 6, duration: 5 });

    const performances = new Map(sqlite.prepare(`SELECT prescribed_set_id AS id,
      actual_reps AS reps, actual_duration_sec AS duration FROM set_performances`)
      .all().map((row) => [row.id, row]));
    for (const id of ["reps", "rounds", "legacy-reps", "legacy-rounds", "legacy-emom"]) {
      assert.equal(performances.get(id).duration, null);
    }
    for (const id of ["duration", "legacy-duration"]) {
      assert.equal(performances.get(id).reps, null);
    }
    assert.deepEqual({ ...performances.get("positive-extra") }, {
      id: "positive-extra",
      reps: 6,
      duration: 5,
    });
    sqlite.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
