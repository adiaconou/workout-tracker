import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("exposes authenticated CRUD and versioned workflow APIs through the entity services", async () => {
  const files = await Promise.all([
    "app/api/exercises/route.ts",
    "app/api/exercises/[exerciseId]/route.ts",
    "app/api/routines/route.ts",
    "app/api/routines/[routineId]/route.ts",
    "app/api/routines/[routineId]/versions/route.ts",
    "app/api/routines/[routineId]/versions/[versionId]/route.ts",
    "app/api/routines/[routineId]/versions/[versionId]/publish/route.ts",
    "app/api/workouts/route.ts",
    "app/api/workouts/[sessionId]/route.ts",
    "app/api/workouts/[sessionId]/sets/[setId]/route.ts",
  ].map((filename) => readFile(new URL(filename, root), "utf8")));
  const source = files.join("\n");
  assert.ok(files.every((file) => /getWorkoutUser/.test(file)));
  assert.match(files[0], /export async function GET/);
  assert.match(files[0], /export async function POST/);
  assert.match(files[1], /export async function PATCH/);
  assert.match(files[1], /export async function DELETE/);
  assert.match(source, /getEntityServices/);
  assert.match(source, /createVersion/);
  assert.match(source, /publish/);
  assert.match(source, /correctSet/);
});

test("keeps published versions immutable and materializes normalized workout rows", async () => {
  const [repository, schema, store] = await Promise.all([
    readFile(new URL("infrastructure/d1/entity-repository.ts", root), "utf8"),
    readFile(new URL("infrastructure/d1/entity-schema.ts", root), "utf8"),
    readFile(new URL("lib/store.ts", root), "utf8"),
  ]);
  assert.match(repository, /Published routine versions are immutable/);
  assert.match(repository, /is_active = 0/);
  assert.match(schema, /materializeWorkoutFromSnapshot/);
  assert.match(schema, /exercise_muscles/);
  assert.match(store, /UPDATE workout_sets SET actual_reps/);
  assert.match(store, /createVersion/);
  assert.match(store, /publish/);
});

