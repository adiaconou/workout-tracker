import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("applies the complete migration chain and creates the normalized entity model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workout-entities-"));
  const database = join(directory, "entities.sqlite");
  try {
    const filenames = [
      "drizzle/0000_bent_starjammers.sql",
      "drizzle/0001_windy_timeslip.sql",
      "drizzle/0002_workable_whizzer.sql",
      "drizzle/0003_faulty_sandman.sql",
      "drizzle/0004_nebulous_lila_cheney.sql",
      "drizzle/0005_plain_rocket_raccoon.sql",
      "drizzle/0006_freezing_betty_ross.sql",
      "drizzle/0007_glorious_vermin.sql",
      "drizzle/0008_nervous_selene.sql",
    ];
    const sql = (await Promise.all(filenames.map((filename) => readFile(new URL(filename, root), "utf8"))))
      .join("\n").replaceAll("--> statement-breakpoint", "\n");
    const sqlite = new DatabaseSync(database);
    sqlite.exec(sql);
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const workoutSetColumns = sqlite.prepare("PRAGMA table_info(workout_sets)").all();
    const setPerformanceColumns = sqlite.prepare("PRAGMA table_info(set_performances)").all();
    const appUserColumns = sqlite.prepare("PRAGMA table_info(app_users)").all();
    const inspected = JSON.stringify({
      tables,
      appUsers: appUserColumns,
      routines: sqlite.prepare("PRAGMA table_info(routines)").all(),
      workoutSessions: sqlite.prepare("PRAGMA table_info(workout_sessions)").all(),
      workoutSets: workoutSetColumns,
      setPerformances: setPerformanceColumns,
      authSessions: sqlite.prepare("PRAGMA table_info(auth_sessions)").all(),
      exercisePlans: sqlite.prepare("PRAGMA table_info(assistant_exercise_change_plans)").all(),
      exercisePlanIndexes: sqlite.prepare("PRAGMA index_list(assistant_exercise_change_plans)").all(),
      exercisePlanForeignKeys: sqlite.prepare("PRAGMA foreign_key_list(assistant_exercise_change_plans)").all(),
      workoutSetForeignKeys: sqlite.prepare("PRAGMA foreign_key_list(workout_sets)").all(),
    });
    sqlite.close();
    for (const table of ["app_users", "auth_identities", "auth_sessions", "exercise_catalog", "exercise_favorites", "exercise_muscles", "routine_versions", "routine_version_exercises", "routine_set_templates", "workout_exercises", "workout_sets", "coach_profiles", "assistant_threads", "assistant_messages", "coach_check_ins", "assistant_change_plans", "assistant_exercise_change_plans", "assistant_tool_calls"]) {
      assert.match(inspected, new RegExp(`\\b${table}\\b`));
    }
    assert.match(inspected, /current_version_id/);
    assert.match(inspected, /routine_version_id/);
    assert.match(inspected, /is_archived/);
    assert.match(inspected, /started_at/);
    assert.match(inspected, /elapsed_seconds/);
    assert.match(inspected, /workout_elapsed_seconds/);
    assert.match(inspected, /photo_url/);
    assert.match(inspected, /workout_exercises/);
    assert.match(inspected, /routine_set_templates/);
    assert.match(inspected, /refresh_token_hash/);
    assert.match(inspected, /base_updated_at/);
    assert.match(inspected, /base_input_json/);
    assert.match(inspected, /applied_exercise_id/);
    assert.match(inspected, /assistant_exercise_change_plans_owner_status_idx/);
    assert.match(inspected, /assistant_exercise_change_plans_thread_created_idx/);
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
