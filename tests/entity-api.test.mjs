import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("exposes owner-scoped CRUD through the versioned Worker API", async () => {
  const [api, auth, google, tokens] = await Promise.all([
    readFile(new URL("server/api.ts", root), "utf8"),
    readFile(new URL("server/auth.ts", root), "utf8"),
    readFile(new URL("server/google.ts", root), "utf8"),
    readFile(new URL("server/session-tokens.ts", root), "utf8"),
  ]);

  assert.match(api, /replace\(\/\^\\\/api\\\/v1/);
  assert.match(api, /handleExercises/);
  assert.match(api, /action === "favorite"/);
  assert.match(api, /setFavorite/);
  assert.match(api, /handleRoutines/);
  assert.match(api, /handleWorkouts/);
  assert.match(api, /createVersion/);
  assert.match(api, /publish/);
  assert.match(api, /correctSet/);
  assert.match(api, /completeWorkoutEarly/);
  assert.match(api, /child === "complete"/);
  assert.match(api, /view.*history/is);
  assert.match(api, /previousPerformanceByExercise/);
  assert.match(api, /google.*exchange/is);
  assert.match(api, /refresh/);
  assert.match(auth, /oai-authenticated-user-email/);
  assert.match(auth, /Authorization|authorization/);
  assert.match(auth, /OWNER_EMAIL/);
  assert.match(auth, /refresh_token_hash/);
  assert.match(auth, /revoked_at/);
  assert.match(google, /createRemoteJWKSet/);
  assert.match(google, /email_verified/);
  assert.match(tokens, /HS256/);
  assert.match(tokens, /15 \* 60/);
});

test("keeps published versions immutable and materializes normalized workout rows", async () => {
  const [repository, schema, store] = await Promise.all([
    readFile(new URL("infrastructure/d1/entity-repository.ts", root), "utf8"),
    readFile(new URL("infrastructure/d1/entity-schema.ts", root), "utf8"),
    readFile(new URL("lib/store.ts", root), "utf8"),
  ]);
  assert.match(repository, /Published routine versions are immutable/);
  assert.match(repository, /is_active = 0/);
  assert.match(repository, /listWorkoutHistory/);
  assert.match(schema, /materializeWorkoutFromSnapshot/);
  assert.match(schema, /exercise_muscles/);
  assert.match(schema, /auth_sessions/);
  assert.match(store, /UPDATE workout_sets SET actual_reps/);
  assert.match(store, /createVersion/);
  assert.match(store, /publish/);
  assert.match(store, /prescribed_set_id = \?/);
  assert.match(store, /getPreviousPerformanceByExercise/);
  assert.match(store, /remainingSetsSkipped/);
  assert.match(store, /status = 'skipped'/);
  assert.match(store, /status = 'Partial'/);
});
