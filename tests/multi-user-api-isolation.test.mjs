import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const firstEmail = "primary@example.com";
const secondEmail = "partner@example.com";

const exerciseInput = (name, muscleGroup) => ({
  name,
  equipment: "other",
  movementPattern: "accessory",
  trackingType: "reps",
  defaultLoadType: "external",
  sideMode: "bilateral",
  instructions: `Private instructions for ${name}.`,
  muscles: [{ muscleGroup, role: "primary", weight: 1 }],
});

const versionInput = (version) => ({
  focus: version.focus,
  summary: version.summary,
  durationMin: version.durationMin,
  exercises: [...version.exercises]
    .sort((left, right) => left.position - right.position)
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      position: exercise.position,
      supersetGroup: exercise.supersetGroup,
      instructions: exercise.instructions,
      notes: exercise.notes,
      sets: [...exercise.sets]
        .sort((left, right) => left.position - right.position)
        .map((set) => ({
          position: set.position,
          setType: set.setType,
          targetType: set.targetType,
          targetMin: set.targetMin,
          targetMax: set.targetMax,
          targetDisplay: set.targetDisplay,
          targetRirMin: set.targetRirMin,
          targetRirMax: set.targetRirMax,
          restAfterSec: set.restAfterSec,
          restRule: set.restRule,
          loadInstruction: set.loadInstruction,
          sideMode: set.sideMode,
          tempo: set.tempo,
          notes: set.notes,
        })),
    })),
});

test("allowed ChatGPT users have isolated seeded data, resources, workouts, and coach state", async (context) => {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["worker/index.ts"],
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
      AUTH_SESSION_SECRET: "multi-user-api-isolation-secret-2026",
    },
    d1Databases: { DB: "multi-user-api-isolation-test" },
  });
  context.after(() => miniflare.dispose());
  const database = await miniflare.getD1Database("DB");

  async function request(email, path, { method = "GET", body } = {}) {
    const headers = new Headers();
    if (email) headers.set("oai-authenticated-user-email", email);
    if (body !== undefined) headers.set("content-type", "application/json");
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

  const anonymousSession = await request(null, "/api/v1/auth/session");
  expectStatus(anonymousSession, 401);
  assert.equal(anonymousSession.body.error.code, "authentication_required");
  expectStatus(await request(null, "/api/v1/bootstrap"), 401);
  expectStatus(await request(null, "/api/v1/exercises", {
    method: "POST",
    body: exerciseInput("Anonymous write attempt", "core"),
  }), 401);
  const unapprovedEmail = "not-approved@example.com";
  expectStatus(await request(unapprovedEmail, "/api/v1/bootstrap"), 401);

  const firstSession = expectStatus(await request(firstEmail, "/api/v1/auth/session"), 200);
  const secondSession = expectStatus(await request(secondEmail, "/api/v1/auth/session"), 200);
  assert.equal(firstSession.provider, "chatgpt");
  assert.equal(secondSession.provider, "chatgpt");
  assert.equal(firstSession.user.email, firstEmail);
  assert.equal(secondSession.user.email, secondEmail);
  assert.notEqual(firstSession.user.id, secondSession.user.id);
  assert.equal(
    await database.prepare("SELECT id FROM app_users WHERE owner_email = ?")
      .bind(unapprovedEmail)
      .first(),
    null,
    "a disallowed ChatGPT identity must not create an application user",
  );

  const firstBootstrap = expectStatus(await request(firstEmail, "/api/v1/bootstrap"), 200);
  const secondBootstrap = expectStatus(await request(secondEmail, "/api/v1/bootstrap"), 200);
  assert.deepEqual(firstBootstrap.user, firstSession.user);
  assert.deepEqual(secondBootstrap.user, secondSession.user);
  assert.ok(firstBootstrap.routines.length > 0);
  assert.deepEqual(
    firstBootstrap.routines.map((routine) => routine.code),
    secondBootstrap.routines.map((routine) => routine.code),
    "each account receives the same starter routine templates",
  );

  const firstSeededRoutines = expectStatus(await request(firstEmail, "/api/v1/routines"), 200).routines;
  const secondSeededRoutines = expectStatus(await request(secondEmail, "/api/v1/routines"), 200).routines;
  const firstRoutineIds = new Set(firstSeededRoutines.map((routine) => routine.id));
  assert.ok(firstSeededRoutines.every((routine) => routine.ownerEmail === firstEmail));
  assert.ok(secondSeededRoutines.every((routine) => routine.ownerEmail === secondEmail));
  assert.ok(
    secondSeededRoutines.every((routine) => !firstRoutineIds.has(routine.id)),
    "starter routines must be independently owned records",
  );
  const firstRoutine = firstSeededRoutines[0];
  const secondRoutine = secondSeededRoutines[0];
  const encodedFirstRoutineId = encodeURIComponent(firstRoutine.id);
  const encodedSecondRoutineId = encodeURIComponent(secondRoutine.id);
  expectStatus(await request(secondEmail, `/api/v1/routines/${encodedFirstRoutineId}`), 404);
  expectStatus(await request(secondEmail, `/api/v1/routines/${encodedFirstRoutineId}/editor`), 404);
  assert.deepEqual(
    expectStatus(
      await request(secondEmail, `/api/v1/routines/${encodedFirstRoutineId}/versions`),
      200,
    ).versions,
    [],
    "a routine version listing for another owner must disclose no versions",
  );
  const encodedFirstVersionId = encodeURIComponent(firstRoutine.currentVersionId);
  expectStatus(
    await request(
      secondEmail,
      `/api/v1/routines/${encodedFirstRoutineId}/versions/${encodedFirstVersionId}`,
    ),
    404,
  );
  expectStatus(
    await request(
      secondEmail,
      `/api/v1/routines/${encodedFirstRoutineId}/versions/${encodedFirstVersionId}`,
      { method: "DELETE" },
    ),
    404,
  );
  const crossAccountPublish = await request(
    secondEmail,
    `/api/v1/routines/${encodedFirstRoutineId}/versions/${encodedFirstVersionId}/publish`,
    { method: "POST" },
  );
  expectStatus(crossAccountPublish, 404);
  assert.equal(crossAccountPublish.body.error.code, "routine_version_not_found");
  const ownerRoutine = expectStatus(
    await request(firstEmail, `/api/v1/routines/${encodedFirstRoutineId}`),
    200,
  ).routine;
  const draftInput = versionInput(ownerRoutine.currentVersion);
  draftInput.summary = `${draftInput.summary} Owner-only draft.`;
  const ownerDraft = expectStatus(
    await request(firstEmail, `/api/v1/routines/${encodedFirstRoutineId}/versions`, {
      method: "POST",
      body: draftInput,
    }),
    201,
  ).version;
  assert.equal(ownerDraft.status, "draft");
  const encodedOwnerDraftId = encodeURIComponent(ownerDraft.id);
  const crossDraftInput = structuredClone(draftInput);
  crossDraftInput.summary = "Cross-account overwrite attempt.";
  const crossAccountDraftUpdate = await request(
    secondEmail,
    `/api/v1/routines/${encodedFirstRoutineId}/versions/${encodedOwnerDraftId}`,
    { method: "PATCH", body: crossDraftInput },
  );
  expectStatus(crossAccountDraftUpdate, 404);
  assert.equal(crossAccountDraftUpdate.body.error.code, "routine_version_not_found");
  assert.equal(
    expectStatus(
      await request(
        firstEmail,
        `/api/v1/routines/${encodedFirstRoutineId}/versions/${encodedOwnerDraftId}`,
      ),
      200,
    ).version.summary,
    draftInput.summary,
    "a cross-account draft update must leave the owner's draft unchanged",
  );
  expectStatus(await request(secondEmail, `/api/v1/routines/${encodedFirstRoutineId}`, {
    method: "PATCH",
    body: { code: "CROSS-ACCOUNT" },
  }), 404);
  expectStatus(await request(secondEmail, `/api/v1/routines/${encodedFirstRoutineId}`, {
    method: "DELETE",
  }), 404);
  expectStatus(await request(firstEmail, `/api/v1/routines/${encodedSecondRoutineId}`), 404);
  assert.equal(
    expectStatus(
      await request(firstEmail, `/api/v1/routines/${encodedFirstRoutineId}`),
      200,
    ).routine.code,
    firstRoutine.code,
    "cross-account routine mutations must leave the owner's routine unchanged",
  );

  const firstSeededExercises = expectStatus(await request(firstEmail, "/api/v1/exercises"), 200).exercises;
  const secondSeededExercises = expectStatus(await request(secondEmail, "/api/v1/exercises"), 200).exercises;
  const firstExerciseIds = new Set(firstSeededExercises.map((exercise) => exercise.id));
  assert.ok(firstSeededExercises.length > 0);
  assert.ok(firstSeededExercises.every((exercise) => exercise.ownerEmail === firstEmail));
  assert.ok(secondSeededExercises.every((exercise) => exercise.ownerEmail === secondEmail));
  assert.ok(
    secondSeededExercises.every((exercise) => !firstExerciseIds.has(exercise.id)),
    "starter exercise libraries must be independently owned records",
  );

  const firstExercise = expectStatus(await request(firstEmail, "/api/v1/exercises", {
    method: "POST",
    body: exerciseInput("Primary private carry", "core"),
  }), 201).exercise;
  const secondExercise = expectStatus(await request(secondEmail, "/api/v1/exercises", {
    method: "POST",
    body: exerciseInput("Second private row", "back"),
  }), 201).exercise;
  assert.equal(firstExercise.ownerEmail, firstEmail);
  assert.equal(secondExercise.ownerEmail, secondEmail);
  assert.notEqual(firstExercise.id, secondExercise.id);

  const encodedFirstExerciseId = encodeURIComponent(firstExercise.id);
  const encodedSecondExerciseId = encodeURIComponent(secondExercise.id);
  const secondReadsFirstExercise = await request(secondEmail, `/api/v1/exercises/${encodedFirstExerciseId}`);
  expectStatus(secondReadsFirstExercise, 404);
  assert.equal(secondReadsFirstExercise.body.error.code, "exercise_not_found");
  expectStatus(await request(secondEmail, `/api/v1/exercises/${encodedFirstExerciseId}`, {
    method: "PATCH",
    body: { name: "Cross-account rename" },
  }), 404);
  expectStatus(await request(secondEmail, `/api/v1/exercises/${encodedFirstExerciseId}`, {
    method: "DELETE",
  }), 404);
  expectStatus(await request(firstEmail, `/api/v1/exercises/${encodedSecondExerciseId}`), 404);
  assert.equal(
    expectStatus(await request(firstEmail, `/api/v1/exercises/${encodedFirstExerciseId}`), 200).exercise.name,
    firstExercise.name,
    "cross-account mutation attempts must leave the exercise unchanged",
  );

  const routineCode = firstBootstrap.routines[0].code;
  assert.ok(secondBootstrap.routines.some((routine) => routine.code === routineCode));
  const firstWorkout = expectStatus(await request(firstEmail, "/api/v1/workouts", {
    method: "POST",
    body: { routineId: routineCode },
  }), 201).session;
  const secondWorkout = expectStatus(await request(secondEmail, "/api/v1/workouts", {
    method: "POST",
    body: { routineId: routineCode },
  }), 201).session;
  assert.notEqual(firstWorkout.id, secondWorkout.id);

  const encodedFirstWorkoutId = encodeURIComponent(firstWorkout.id);
  const encodedSecondWorkoutId = encodeURIComponent(secondWorkout.id);
  const secondReadsFirstWorkout = await request(secondEmail, `/api/v1/workouts/${encodedFirstWorkoutId}`);
  expectStatus(secondReadsFirstWorkout, 404);
  assert.equal(secondReadsFirstWorkout.body.error.code, "workout_not_found");
  expectStatus(await request(secondEmail, `/api/v1/workouts/${encodedFirstWorkoutId}`, {
    method: "DELETE",
  }), 404);
  expectStatus(await request(firstEmail, `/api/v1/workouts/${encodedSecondWorkoutId}`), 404);
  assert.equal(
    expectStatus(await request(firstEmail, `/api/v1/workouts/${encodedFirstWorkoutId}`), 200).workout.id,
    firstWorkout.id,
    "cross-account mutation attempts must leave the workout available to its owner",
  );

  const firstCoach = expectStatus(await request(firstEmail, "/api/v1/assistant"), 200);
  const secondCoach = expectStatus(await request(secondEmail, "/api/v1/assistant"), 200);
  assert.equal(firstCoach.profile.ownerEmail, firstEmail);
  assert.equal(secondCoach.profile.ownerEmail, secondEmail);
  assert.notEqual(firstCoach.thread.id, secondCoach.thread.id);
  assert.ok(firstCoach.threads.every((thread) => thread.ownerEmail === firstEmail));
  assert.ok(secondCoach.threads.every((thread) => thread.ownerEmail === secondEmail));
  expectStatus(
    await request(secondEmail, `/api/v1/assistant?threadId=${encodeURIComponent(firstCoach.thread.id)}`),
    404,
  );

  const now = new Date().toISOString();
  const firstPlanId = crypto.randomUUID();
  const secondPlanId = crypto.randomUUID();
  const insertPlan = (id, email, threadId, exerciseName) => database.prepare(`INSERT INTO assistant_exercise_change_plans (
    id, owner_email, thread_id, action, exercise_id, exercise_name,
    base_updated_at, base_input_json, proposed_input_json, summary, rationale,
    diff_json, status, applied_exercise_id, created_at, updated_at
  ) VALUES (?, ?, ?, 'create', NULL, ?, NULL, NULL, ?, ?, ?, ?, 'pending', NULL, ?, ?)`)
    .bind(
      id,
      email,
      threadId,
      exerciseName,
      JSON.stringify(exerciseInput(exerciseName, "core")),
      `Create ${exerciseName}`,
      "Account-local test proposal",
      JSON.stringify([`Create ${exerciseName}`]),
      now,
      now,
    ).run();
  await insertPlan(firstPlanId, firstEmail, firstCoach.thread.id, "Primary coach proposal");
  await insertPlan(secondPlanId, secondEmail, secondCoach.thread.id, "Second coach proposal");

  const firstCoachWithPlan = expectStatus(await request(
    firstEmail,
    `/api/v1/assistant?threadId=${encodeURIComponent(firstCoach.thread.id)}`,
  ), 200);
  const secondCoachWithPlan = expectStatus(await request(
    secondEmail,
    `/api/v1/assistant?threadId=${encodeURIComponent(secondCoach.thread.id)}`,
  ), 200);
  assert.deepEqual(firstCoachWithPlan.plans.map((plan) => plan.id), [firstPlanId]);
  assert.deepEqual(secondCoachWithPlan.plans.map((plan) => plan.id), [secondPlanId]);
});
