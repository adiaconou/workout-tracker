import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { D1EntityRepository } from "../infrastructure/d1/entity-repository";
import { ensureEntityData, ensureEntitySchema } from "../infrastructure/d1/entity-schema";

type SqliteValue = null | number | bigint | string | Uint8Array;

function sqliteValue(value: unknown): SqliteValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string" || value instanceof Uint8Array) return value;
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
  async batch(statements: SqliteStatement[]) { return Promise.all(statements.map((statement) => statement.run())); }
}

test("available-only exercise discovery respects equipment without changing full or exact reads", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const d1 = new SqliteD1(sqlite) as unknown as D1Database;
  const ownerEmail = "equipment@example.com";
  const now = new Date().toISOString();

  try {
    await ensureEntitySchema(d1);
    await d1.prepare(`INSERT INTO app_users (
      id, owner_email, display_name, equipment_preferences_json,
      preferred_workout_duration_min, onboarding_version, onboarding_completed_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 45, 1, ?, ?, ?)`)
      .bind("equipment-user", ownerEmail, "Equipment User", JSON.stringify(["bodyweight", "dumbbells"]), now, now, now)
      .run();
    await ensureEntityData(d1, ownerEmail);

    const repository = new D1EntityRepository(d1);
    const fullLibrary = await repository.listExercises(ownerEmail);
    const available = await repository.listExercises(ownerEmail, { availableOnly: true });
    const fullByName = new Map(fullLibrary.map((exercise) => [exercise.name, exercise]));
    const availableNames = new Set(available.map((exercise) => exercise.name));

    assert.ok(availableNames.has("Push-up"));
    assert.ok(availableNames.has("Bent-over dumbbell reverse fly"));
    assert.ok(availableNames.has("Goblet squat"), "Either dumbbells or kettlebells should satisfy this exercise");
    assert.ok(!availableNames.has("Flat dumbbell bench press"), "A bench is also required");
    assert.ok(!availableNames.has("Straight-arm cable pulldown"));
    assert.ok(fullByName.has("Flat dumbbell bench press"), "The default full-library read must remain unchanged");

    const unavailableId = fullByName.get("Flat dumbbell bench press")!.id;
    assert.equal((await repository.getExercise(ownerEmail, unavailableId))?.id, unavailableId);

    await d1.prepare("UPDATE app_users SET equipment_preferences_json = ? WHERE owner_email = ?")
      .bind("[]", ownerEmail)
      .run();
    assert.deepEqual(await repository.listExercises(ownerEmail, { availableOnly: true }), []);
    assert.equal((await repository.getExercise(ownerEmail, unavailableId))?.id, unavailableId);
  } finally {
    sqlite.close();
  }
});
