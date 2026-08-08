import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  centimetersToFeetAndInches,
  feetAndInchesToCentimeters,
  kilogramsToPounds,
  poundsToKilograms,
} from "../src/domain/profile";
import { ensureAppUser } from "../src/server/auth/auth";
import { getUserProfile, updateUserProfile } from "../src/server/profile/profile";
import type { WorkerEnv } from "../src/server/types";
import { ensureEntitySchema } from "../src/server/db/entity-schema";

type SqliteValue = null | number | bigint | string | Uint8Array;

function sqliteValue(value: unknown): SqliteValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (
    typeof value === "number"
    || typeof value === "bigint"
    || typeof value === "string"
    || value instanceof Uint8Array
  ) return value;
  return String(value);
}

class SqliteStatement {
  constructor(private database: DatabaseSync, private sql: string, private values: unknown[] = []) {}
  bind(...values: unknown[]) { return new SqliteStatement(this.database, this.sql, values); }
  private boundValues() { return this.values.map(sqliteValue); }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.boundValues());
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async all<T>() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.boundValues()) as T[] };
  }
  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.boundValues()) as T | undefined) ?? null;
  }
}

class SqliteD1 {
  constructor(private database: DatabaseSync) {}
  prepare(sql: string) { return new SqliteStatement(this.database, sql); }
  async batch(statements: SqliteStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

test("measurement conversions round-trip canonical profile values", () => {
  assert.ok(Math.abs(poundsToKilograms(kilogramsToPounds(82.5)) - 82.5) < 1e-10);
  const imperial = centimetersToFeetAndInches(177.8);
  assert.equal(imperial.feet, 5);
  assert.ok(Math.abs(imperial.inches - 10) < 1e-10);
  assert.ok(Math.abs(feetAndInchesToCentimeters(5, 10) - 177.8) < 1e-10);
});

test("runtime schema upgrade adds profile and workout weight-source columns", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  try {
    sqlite.exec(`CREATE TABLE app_users (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, display_name TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE workout_sessions (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, routine_code TEXT NOT NULL,
      routine_version INTEGER NOT NULL, status TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      current_exercise INTEGER NOT NULL DEFAULT 1, current_set INTEGER NOT NULL DEFAULT 1,
      completed_sets INTEGER NOT NULL DEFAULT 0, skipped_sets INTEGER NOT NULL DEFAULT 0,
      total_sets INTEGER NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
    await ensureEntitySchema(d1);
    const appUserColumns = (await d1.prepare("PRAGMA table_info(app_users)")
      .all<{ name: string }>()).results.map((column) => column.name);
    const workoutColumns = (await d1.prepare("PRAGMA table_info(workout_sessions)")
      .all<{ name: string }>()).results.map((column) => column.name);
    for (const column of ["height_cm", "body_weight_kg", "measurement_system"]) {
      assert.ok(appUserColumns.includes(column));
    }
    assert.ok(workoutColumns.includes("body_weight_source"));
  } finally {
    sqlite.close();
  }
});

test("profile API is owner-scoped, validates partial updates, and backfills only empty finalized workouts", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const owner = "profile-owner@example.com";
  const other = "profile-other@example.com";
  const env = {
    DB: d1,
    ALLOWED_USER_EMAILS: `${owner},${other}`,
    OWNER_EMAIL: owner,
    AUTH_SESSION_SECRET: "profile-test-secret-that-is-long-enough-for-signing",
  } as unknown as WorkerEnv;

  async function request(email: string, method = "GET", body?: unknown) {
    const appUser = await ensureAppUser(env, email, email);
    const user = { id: appUser.id, email: appUser.ownerEmail };
    try {
      const profile = method === "PATCH"
        ? await updateUserProfile(env, user, body)
        : await getUserProfile(env, user);
      return profile
        ? { status: 200, body: { profile } as Record<string, any> }
        : { status: 404, body: { error: { code: "profile_not_found" } } as Record<string, any> };
    } catch (error) {
      return {
        status: 400,
        body: {
          error: {
            code: "profile_invalid",
            message: error instanceof Error ? error.message : "Profile invalid.",
          },
        } as Record<string, any>,
      };
    }
  }

  try {
    const initial = await request(owner);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.profile.email, owner);
    assert.equal(initial.body.profile.heightCm, null);
    assert.equal(initial.body.profile.bodyWeightKg, null);
    assert.equal(initial.body.profile.measurementSystem, "imperial");
    assert.equal((await request(other)).status, 200);

    const now = new Date().toISOString();
    const insertWorkout = async (
      id: string,
      email: string,
      status: string,
      bodyWeight: number | null = null,
    ) => d1.prepare(`INSERT INTO workout_sessions (
      id, owner_email, routine_code, routine_version, status, snapshot_json,
      total_sets, started_at, completed_at, body_weight, updated_at
    ) VALUES (?, ?, 'A', 1, ?, '{}', 1, ?, ?, ?, ?)`)
      .bind(id, email, status, now, status === "In Progress" ? null : now, bodyWeight, now).run();

    await insertWorkout("completed-empty", owner, "Completed");
    await insertWorkout("partial-empty", owner, "Partial");
    await insertWorkout("abandoned-empty", owner, "Abandoned");
    await insertWorkout("active-empty", owner, "In Progress");
    await insertWorkout("completed-manual", owner, "Completed", 205);
    await insertWorkout("other-completed", other, "Completed");

    const saved = await request(owner, "PATCH", {
      heightCm: 177.8,
      bodyWeightKg: 82.5,
      measurementSystem: "imperial",
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.profile.heightCm, 177.8);
    assert.equal(saved.body.profile.bodyWeightKg, 82.5);

    const rows = await d1.prepare(`SELECT id, body_weight AS bodyWeight,
      body_weight_source AS bodyWeightSource, weight_unit AS weightUnit
      FROM workout_sessions ORDER BY id`).all<{
        id: string;
        bodyWeight: number | null;
        bodyWeightSource: string | null;
        weightUnit: string;
      }>();
    const byId = new Map(rows.results.map((row) => [row.id, row]));
    for (const id of ["completed-empty", "partial-empty", "abandoned-empty"]) {
      assert.ok(Math.abs(byId.get(id)!.bodyWeight! - kilogramsToPounds(82.5)) < 1e-10);
      assert.equal(byId.get(id)!.weightUnit, "lb");
      assert.equal(byId.get(id)!.bodyWeightSource, "profile_backfill");
    }
    assert.equal(byId.get("active-empty")!.bodyWeight, null);
    assert.equal(byId.get("completed-manual")!.bodyWeight, 205);
    assert.equal(byId.get("completed-manual")!.bodyWeightSource, null);
    assert.equal(byId.get("other-completed")!.bodyWeight, null);

    await insertWorkout("completed-metric", owner, "Completed");
    const metric = await request(owner, "PATCH", { measurementSystem: "metric" });
    assert.equal(metric.status, 200);
    assert.equal(metric.body.profile.bodyWeightKg, 82.5);
    const metricWorkout = await d1.prepare(`SELECT body_weight AS bodyWeight,
      body_weight_source AS bodyWeightSource, weight_unit AS weightUnit
      FROM workout_sessions WHERE id = ?`).bind("completed-metric").first<{
        bodyWeight: number;
        bodyWeightSource: string;
        weightUnit: string;
      }>();
    assert.equal(metricWorkout?.bodyWeight, 82.5);
    assert.equal(metricWorkout?.weightUnit, "kg");
    assert.equal(metricWorkout?.bodyWeightSource, "profile_backfill");

    await insertWorkout("completed-later", owner, "Completed");
    const revised = await request(owner, "PATCH", { bodyWeightKg: 90 });
    assert.equal(revised.status, 200);
    const frozenRows = await d1.prepare(`SELECT id, body_weight AS bodyWeight,
      body_weight_source AS bodyWeightSource, weight_unit AS weightUnit
      FROM workout_sessions
      WHERE id IN ('completed-empty', 'completed-metric', 'completed-later')
      ORDER BY id`).all<{
        id: string;
        bodyWeight: number;
        bodyWeightSource: string;
        weightUnit: string;
      }>();
    const frozenById = new Map(frozenRows.results.map((row) => [row.id, row]));
    assert.ok(Math.abs(
      frozenById.get("completed-empty")!.bodyWeight - kilogramsToPounds(82.5),
    ) < 1e-10);
    assert.equal(frozenById.get("completed-empty")!.weightUnit, "lb");
    assert.equal(frozenById.get("completed-metric")!.bodyWeight, 82.5);
    assert.equal(frozenById.get("completed-metric")!.weightUnit, "kg");
    assert.equal(frozenById.get("completed-later")!.bodyWeight, 90);
    assert.equal(frozenById.get("completed-later")!.weightUnit, "kg");
    assert.ok([...frozenById.values()].every((row) => (
      row.bodyWeightSource === "profile_backfill"
    )));

    const cleared = await request(owner, "PATCH", { heightCm: null, bodyWeightKg: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.profile.heightCm, null);
    assert.equal(cleared.body.profile.bodyWeightKg, null);
    assert.equal(cleared.body.profile.measurementSystem, "metric");
    assert.equal(
      (await d1.prepare("SELECT body_weight AS bodyWeight FROM workout_sessions WHERE id = ?")
        .bind("completed-empty").first<{ bodyWeight: number }>())?.bodyWeight,
      kilogramsToPounds(82.5),
      "clearing the profile must not overwrite a finalized workout",
    );

    for (const invalid of [
      { heightCm: 0 },
      { bodyWeightKg: -1 },
      { measurementSystem: "stone" },
      { email: "attacker@example.com" },
    ]) {
      const response = await request(owner, "PATCH", invalid);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "profile_invalid");
    }
    assert.equal((await request(owner)).body.profile.email, owner);
    assert.equal((await request(other)).body.profile.bodyWeightKg, null);
  } finally {
    sqlite.close();
  }
});
