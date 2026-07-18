import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
    ];
    const sql = (await Promise.all(filenames.map((filename) => readFile(new URL(filename, root), "utf8"))))
      .join("\n").replaceAll("--> statement-breakpoint", "\n");
    const applied = spawnSync("/usr/bin/sqlite3", [database], { input: sql, encoding: "utf8" });
    assert.equal(applied.status, 0, applied.stderr);

    const query = `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
      PRAGMA table_info(routines);
      PRAGMA table_info(workout_sessions);
      PRAGMA table_info(auth_sessions);
      PRAGMA foreign_key_list(workout_sets);`;
    const inspected = spawnSync("/usr/bin/sqlite3", [database], { input: query, encoding: "utf8" });
    assert.equal(inspected.status, 0, inspected.stderr);
    for (const table of ["app_users", "auth_identities", "auth_sessions", "exercise_catalog", "exercise_muscles", "routine_versions", "routine_version_exercises", "routine_set_templates", "workout_exercises", "workout_sets"]) {
      assert.match(inspected.stdout, new RegExp(`(^|\\n)${table}(\\n|$)`));
    }
    assert.match(inspected.stdout, /current_version_id/);
    assert.match(inspected.stdout, /routine_version_id/);
    assert.match(inspected.stdout, /is_archived/);
    assert.match(inspected.stdout, /workout_exercises/);
    assert.match(inspected.stdout, /routine_set_templates/);
    assert.match(inspected.stdout, /refresh_token_hash/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
