import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const firstEmail = "program-owner@example.com";
const secondEmail = "program-other@example.com";
const allEquipment = [
  "bodyweight",
  "dumbbells",
  "bench",
  "kettlebells",
  "pull_up_station",
  "dip_station",
  "cable_machine",
  "ez_bar",
  "resistance_bands",
  "barbell",
];

const routineVersion = (exerciseId) => ({
  focus: "Program API strength",
  summary: "A routine used to verify program API boundaries.",
  durationMin: 40,
  exercises: [{
    exerciseId,
    position: 1,
    supersetGroup: null,
    instructions: "Move with control.",
    notes: "",
    sets: [{
      position: 1,
      setType: "regular",
      targetType: "reps",
      targetMin: 8,
      targetMax: 10,
      targetDisplay: "8-10 reps",
      targetRirMin: 2,
      targetRirMax: 2,
      restAfterSec: 90,
      restRule: "standard",
      loadInstruction: "",
      sideMode: "bilateral",
      tempo: null,
      notes: "",
    }],
  }],
});

test("program API enforces idempotency, owner isolation, and explicit activation", async (context) => {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: [fileURLToPath(new URL("../src/worker.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers"],
    sourcemap: false,
    minify: false,
  });
  const miniflare = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-22",
    bindings: {
      ALLOWED_USER_EMAILS: `${firstEmail},${secondEmail}`,
      OWNER_EMAIL: firstEmail,
      AUTH_SESSION_SECRET: "program-api-integration-secret-2026",
    },
    d1Databases: { DB: "program-api-test" },
  });
  context.after(() => miniflare.dispose());
  const database = await miniflare.getD1Database("DB");

  async function request(email, path, { method = "GET", body, idempotencyKey } = {}) {
    const headers = new Headers();
    if (email) headers.set("oai-authenticated-user-email", email);
    if (body !== undefined) headers.set("content-type", "application/json");
    if (idempotencyKey !== undefined) headers.set("x-idempotency-key", idempotencyKey);
    const response = await miniflare.dispatchFetch(`https://workout.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  function expectStatus(result, expected) {
    assert.equal(result.status, expected, JSON.stringify(result.body));
    return result.body;
  }

  for (const email of [firstEmail, secondEmail]) {
    expectStatus(await request(email, "/api/v1/onboarding", {
      method: "PUT",
      body: { equipment: allEquipment, sessionDurationMin: 60 },
    }), 200);
  }

  const exercise = expectStatus(await request(firstEmail, "/api/v1/exercises", {
    method: "POST",
    body: {
      name: "Program API row",
      equipment: "bodyweight",
      movementPattern: "horizontal pull",
      trackingType: "reps",
      defaultLoadType: "external",
      sideMode: "bilateral",
      instructions: "Keep the torso steady.",
      muscles: [{ muscleGroup: "back", role: "primary", weight: 1 }],
    },
  }), 201).exercise;
  async function createRoutine(code) {
    return expectStatus(await request(firstEmail, "/api/v1/routines", {
      method: "POST",
      body: { code, version: routineVersion(exercise.id) },
    }), 201).routine;
  }

  const routine = await createRoutine("PROGRAM-API");
  const secondRoutine = await createRoutine("PROGRAM-SECOND");
  const fallbackRoutine = await createRoutine("FALLBACK");
  const fallbackWorkout = expectStatus(await request(firstEmail, "/api/v1/workouts", {
    method: "POST",
    body: { routineId: fallbackRoutine.id },
  }), 201).session;
  const completedAt = new Date().toISOString();
  await database.prepare(`UPDATE workout_sessions
    SET status = 'Completed', completed_at = ?, updated_at = ?
    WHERE id = ? AND owner_email = ?`)
    .bind(completedAt, completedAt, fallbackWorkout.id, firstEmail)
    .run();
  const programInput = {
    name: "Program API plan",
    goal: "Verify program lifecycle behavior",
    selectedMuscleGroups: ["back", "biceps"],
    trainingDaysPerWeek: 2,
    targetDurationMin: 40,
    activate: false,
    routines: [{ routineId: secondRoutine.id }, { routineId: routine.id }],
  };

  const missingKey = await request(firstEmail, "/api/v1/programs", {
    method: "POST",
    body: programInput,
  });
  expectStatus(missingKey, 400);
  assert.equal(missingKey.body.error.code, "program_invalid");
  assert.match(missingKey.body.error.message, /idempotency key is required/i);

  const invalidKey = await request(firstEmail, "/api/v1/programs", {
    method: "POST",
    body: programInput,
    idempotencyKey: "short",
  });
  expectStatus(invalidKey, 400);
  assert.equal(invalidKey.body.error.code, "program_invalid");
  assert.match(invalidKey.body.error.message, /at least 8 characters/i);

  const created = expectStatus(await request(firstEmail, "/api/v1/programs", {
    method: "POST",
    body: programInput,
    idempotencyKey: "program-create-1",
  }), 201).program;
  assert.equal(created.ownerEmail, firstEmail);
  assert.equal(created.name, programInput.name);
  assert.equal(created.isActive, false);
  assert.deepEqual(
    created.routines.map((membership) => membership.routineId),
    [secondRoutine.id, routine.id],
  );

  const replayed = expectStatus(await request(firstEmail, "/api/v1/programs", {
    method: "POST",
    body: programInput,
    idempotencyKey: "program-create-1",
  }), 200).program;
  assert.deepEqual(replayed, created);

  const conflict = await request(firstEmail, "/api/v1/programs", {
    method: "POST",
    body: { ...programInput, name: "Different plan" },
    idempotencyKey: "program-create-1",
  });
  expectStatus(conflict, 409);
  assert.equal(conflict.body.error.code, "program_idempotency_conflict");

  const encodedProgramId = encodeURIComponent(created.id);
  assert.deepEqual(
    expectStatus(await request(firstEmail, `/api/v1/programs/${encodedProgramId}`), 200).program,
    created,
  );
  const crossOwnerRead = await request(secondEmail, `/api/v1/programs/${encodedProgramId}`);
  expectStatus(crossOwnerRead, 404);
  assert.equal(crossOwnerRead.body.error.code, "program_not_found");
  assert.equal(
    expectStatus(await request(secondEmail, "/api/v1/programs"), 200).programs
      .some((program) => program.id === created.id),
    false,
  );

  const crossOwnerActivation = await request(
    secondEmail,
    `/api/v1/programs/${encodedProgramId}/activate`,
    { method: "POST" },
  );
  expectStatus(crossOwnerActivation, 404);
  assert.equal(crossOwnerActivation.body.error.code, "program_not_found");

  const activated = expectStatus(await request(
    firstEmail,
    `/api/v1/programs/${encodedProgramId}/activate`,
    { method: "POST" },
  ), 200).program;
  assert.equal(activated.isActive, true);
  const ownerPrograms = expectStatus(await request(firstEmail, "/api/v1/programs"), 200).programs;
  assert.equal(ownerPrograms.filter((program) => program.isActive).length, 1);
  assert.equal(ownerPrograms.find((program) => program.isActive)?.id, created.id);

  const initialRecommendation = expectStatus(
    await request(firstEmail, "/api/v1/bootstrap"),
    200,
  ).recommendations;
  assert.deepEqual(
    initialRecommendation.routines.map((item) => item.code),
    [secondRoutine.code, routine.code],
    "an active program keeps its configured order and excludes nonmembers",
  );
  assert.match(
    initialRecommendation.summary,
    /no recent completed sets are logged/i,
    "completed sessions from nonmembers must not affect a program with active members",
  );

  expectStatus(await request(
    firstEmail,
    `/api/v1/routines/${encodeURIComponent(secondRoutine.id)}`,
    { method: "DELETE" },
  ), 200);
  const afterFirstArchive = expectStatus(
    await request(firstEmail, "/api/v1/bootstrap"),
    200,
  ).recommendations;
  assert.deepEqual(
    afterFirstArchive.routines.map((item) => item.code),
    [routine.code],
    "an archived member is excluded without losing the surviving program order",
  );

  expectStatus(await request(
    firstEmail,
    `/api/v1/routines/${encodeURIComponent(routine.id)}`,
    { method: "DELETE" },
  ), 200);
  const afterLastMemberArchive = expectStatus(
    await request(firstEmail, "/api/v1/bootstrap"),
    200,
  ).recommendations;
  assert.deepEqual(
    afterLastMemberArchive.routines.map((item) => item.code),
    [fallbackRoutine.code],
    "active nonmembers become the fallback when an active program has no active members",
  );
  assert.match(
    afterLastMemberArchive.summary,
    /no completed sets are logged in the past 48 hours/i,
    "fallback recommendation history must include the fallback routine's completed session",
  );

  expectStatus(await request(
    firstEmail,
    `/api/v1/routines/${encodeURIComponent(fallbackRoutine.id)}`,
    { method: "DELETE" },
  ), 200);
  const afterEveryArchive = expectStatus(
    await request(firstEmail, "/api/v1/bootstrap"),
    200,
  ).recommendations;
  assert.equal(afterEveryArchive.recommendationKind, "no_plan");
  assert.deepEqual(afterEveryArchive.routines, []);
});
