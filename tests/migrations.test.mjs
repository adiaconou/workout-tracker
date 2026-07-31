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
    ];
    const sql = (await Promise.all(filenames.map((filename) => readFile(new URL(filename, root), "utf8"))))
      .join("\n").replaceAll("--> statement-breakpoint", "\n");
    const sqlite = new DatabaseSync(database);
    sqlite.exec(sql);
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const inspected = JSON.stringify({
      tables,
      routines: sqlite.prepare("PRAGMA table_info(routines)").all(),
      workoutSessions: sqlite.prepare("PRAGMA table_info(workout_sessions)").all(),
      authSessions: sqlite.prepare("PRAGMA table_info(auth_sessions)").all(),
      workoutSetForeignKeys: sqlite.prepare("PRAGMA foreign_key_list(workout_sets)").all(),
    });
    sqlite.close();
    for (const table of ["app_users", "auth_identities", "auth_sessions", "exercise_catalog", "exercise_favorites", "exercise_muscles", "routine_versions", "routine_version_exercises", "routine_set_templates", "workout_exercises", "workout_sets", "coach_profiles", "assistant_threads", "assistant_messages", "coach_check_ins", "assistant_change_plans", "assistant_tool_calls"]) {
      assert.match(inspected, new RegExp(`\\b${table}\\b`));
    }
    assert.match(inspected, /current_version_id/);
    assert.match(inspected, /routine_version_id/);
    assert.match(inspected, /is_archived/);
    assert.match(inspected, /workout_exercises/);
    assert.match(inspected, /routine_set_templates/);
    assert.match(inspected, /refresh_token_hash/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
