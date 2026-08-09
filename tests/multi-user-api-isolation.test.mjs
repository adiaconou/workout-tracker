import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const firstEmail = "primary@example.com";
const secondEmail = "partner@example.com";
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

const singleSetRoutine = (exerciseId, focus) => ({
  focus,
  summary: `${focus} account-isolation routine.`,
  durationMin: 30,
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

test("allowed ChatGPT users start empty and have isolated resources, workouts, and coach state", async (context) => {
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
  assert.equal(firstSession.user.trainingProfile.onboardingCompleted, false);
  assert.equal(secondSession.user.trainingProfile.onboardingCompleted, false);
  assert.equal(
    await database.prepare("SELECT id FROM app_users WHERE owner_email = ?")
      .bind(unapprovedEmail)
      .first(),
    null,
    "a disallowed ChatGPT identity must not create an application user",
  );

  const gatedBootstrap = expectStatus(await request(firstEmail, "/api/v1/bootstrap"), 409);
  assert.equal(gatedBootstrap.error.code, "onboarding_required");
  const firstSetup = expectStatus(await request(firstEmail, "/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: allEquipment, sessionDurationMin: 60 },
  }), 200);
  const secondSetup = expectStatus(await request(secondEmail, "/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: allEquipment, sessionDurationMin: 45 },
  }), 200);
  assert.equal(firstSetup.firstCompletion, true);
  assert.equal(secondSetup.firstCompletion, true);
  assert.equal(firstSetup.user.trainingProfile.onboardingCompleted, true);
  assert.equal(secondSetup.user.trainingProfile.sessionDurationMin, 45);
  assert.equal(expectStatus(await request(firstEmail, "/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: allEquipment, sessionDurationMin: 60 },
  }), 200).firstCompletion, false);

  expectStatus(await request(firstEmail, "/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: ["bodyweight"], sessionDurationMin: 30 },
  }), 200);
  const bodyweightLibrary = expectStatus(await request(firstEmail, "/api/v1/exercises"), 200).exercises;
  const fullLibrary = expectStatus(await request(firstEmail, "/api/v1/exercises?scope=all"), 200).exercises;
  const hiddenExercise = fullLibrary.find((exercise) => exercise.equipment === "dumbbell");
  assert.ok(hiddenExercise, "the complete library should include a dumbbell exercise");
  assert.equal(
    bodyweightLibrary.some((exercise) => exercise.id === hiddenExercise.id),
    false,
    "the default library should hide exercises that need unselected equipment",
  );
  assert.equal(
    expectStatus(await request(firstEmail, `/api/v1/exercises/${encodeURIComponent(hiddenExercise.id)}`), 200).exercise.id,
    hiddenExercise.id,
    "exact reads remain available for routine and history references",
  );
  const restoredFirstSetup = expectStatus(await request(firstEmail, "/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: allEquipment, sessionDurationMin: 60 },
  }), 200);

  const firstBootstrap = expectStatus(await request(firstEmail, "/api/v1/bootstrap"), 200);
  const secondBootstrap = expectStatus(await request(secondEmail, "/api/v1/bootstrap"), 200);
  assert.deepEqual(firstBootstrap.user, restoredFirstSetup.user);
  assert.deepEqual(secondBootstrap.user, secondSetup.user);
  assert.deepEqual(firstBootstrap.routines, [], "a new account must not inherit starter routines");
  assert.deepEqual(secondBootstrap.routines, [], "each new account must start with no routines");
  assert.deepEqual(
    expectStatus(await request(firstEmail, "/api/v1/routines"), 200).routines,
    [],
  );
  assert.deepEqual(
    expectStatus(await request(secondEmail, "/api/v1/routines"), 200).routines,
    [],
  );
  assert.deepEqual(
    expectStatus(await request(firstEmail, "/api/v1/routines"), 200).routines,
    [],
    "repeated routine reads must not provision routines as a side effect",
  );
  for (const email of [firstEmail, secondEmail]) {
    const row = await database.prepare("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ?")
      .bind(email)
      .first();
    assert.equal(Number(row.count), 0, "routine reads must leave storage empty for a new account");
  }

  const firstDefaultExercises = expectStatus(
    await request(firstEmail, "/api/v1/exercises?scope=all"),
    200,
  ).exercises;
  const secondDefaultExercises = expectStatus(
    await request(secondEmail, "/api/v1/exercises?scope=all"),
    200,
  ).exercises;
  const firstDefaultIds = new Set(firstDefaultExercises.map((exercise) => exercise.id));
  assert.ok(firstDefaultExercises.length > 0);
  assert.ok(firstDefaultExercises.every((exercise) => exercise.ownerEmail === firstEmail));
  assert.ok(secondDefaultExercises.every((exercise) => exercise.ownerEmail === secondEmail));
  assert.deepEqual(
    firstDefaultExercises.map((exercise) => exercise.name).sort(),
    secondDefaultExercises.map((exercise) => exercise.name).sort(),
    "accounts receive the same curated default exercise templates",
  );
  assert.ok(
    secondDefaultExercises.every((exercise) => !firstDefaultIds.has(exercise.id)),
    "default exercise libraries must be independently owned records",
  );
  const defaultCatalogRows = (await database.prepare(`SELECT id, owner_email AS ownerEmail,
    origin, template_key AS templateKey FROM exercise_catalog
    WHERE owner_email IN (?, ?) ORDER BY owner_email, template_key`)
    .bind(firstEmail, secondEmail)
    .all()).results;
  const firstDefaultCatalog = defaultCatalogRows.filter((row) => row.ownerEmail === firstEmail);
  const secondDefaultCatalog = defaultCatalogRows.filter((row) => row.ownerEmail === secondEmail);
  assert.ok(defaultCatalogRows.every((row) => row.origin === "default"));
  assert.ok(defaultCatalogRows.every((row) => row.templateKey?.startsWith("home-gym:")));
  assert.deepEqual(
    firstDefaultCatalog.map((row) => row.templateKey),
    secondDefaultCatalog.map((row) => row.templateKey),
    "default provenance keys identify the same templates across owner-local copies",
  );
  assert.ok(secondDefaultCatalog.every((row) => !firstDefaultIds.has(row.id)));
  const reloadedFirstDefaults = expectStatus(
    await request(firstEmail, "/api/v1/exercises?scope=all"),
    200,
  ).exercises;
  assert.deepEqual(
    reloadedFirstDefaults.map((exercise) => exercise.id).sort(),
    firstDefaultExercises.map((exercise) => exercise.id).sort(),
    "repeated library reads must not duplicate or replace default exercises",
  );
  assert.equal(
    Number((await database.prepare("SELECT COUNT(*) AS count FROM exercise_catalog WHERE owner_email = ?")
      .bind(firstEmail)
      .first()).count),
    firstDefaultExercises.length,
  );

  const customizedDefault = firstDefaultExercises.find(
    (exercise) => exercise.id !== hiddenExercise.id,
  );
  assert.ok(customizedDefault);
  const customizedDefaultName = `${customizedDefault.name} (customized)`;
  expectStatus(await request(firstEmail, `/api/v1/exercises/${encodeURIComponent(customizedDefault.id)}`, {
    method: "PATCH",
    body: { name: customizedDefaultName },
  }), 200);
  expectStatus(await request(firstEmail, `/api/v1/exercises/${encodeURIComponent(customizedDefault.id)}`, {
    method: "DELETE",
  }), 200);
  expectStatus(await request(firstEmail, "/api/v1/bootstrap"), 200);
  const preservedDefault = expectStatus(
    await request(firstEmail, `/api/v1/exercises/${encodeURIComponent(customizedDefault.id)}`),
    200,
  ).exercise;
  assert.equal(preservedDefault.name, customizedDefaultName);
  assert.equal(preservedDefault.isActive, false, "provisioning must not restore an archived default");
  assert.equal(
    Number((await database.prepare("SELECT COUNT(*) AS count FROM exercise_catalog WHERE owner_email = ?")
      .bind(firstEmail)
      .first()).count),
    firstDefaultExercises.length,
    "provisioning must not recreate a renamed or archived default",
  );

  const firstExercise = expectStatus(await request(firstEmail, "/api/v1/exercises", {
    method: "POST",
    body: { ...exerciseInput("Primary private carry", "core"), equipment: "bodyweight" },
  }), 201).exercise;
  const secondExercise = expectStatus(await request(secondEmail, "/api/v1/exercises", {
    method: "POST",
    body: { ...exerciseInput("Second private row", "back"), equipment: "bodyweight" },
  }), 201).exercise;
  assert.equal(firstExercise.ownerEmail, firstEmail);
  assert.equal(secondExercise.ownerEmail, secondEmail);
  assert.notEqual(firstExercise.id, secondExercise.id);
  assert.deepEqual(
    await database.prepare(`SELECT origin, template_key AS templateKey
      FROM exercise_catalog WHERE id = ? AND owner_email = ?`)
      .bind(firstExercise.id, firstEmail)
      .first(),
    { origin: "custom", templateKey: null },
    "user-created exercises must remain distinguishable from curated defaults",
  );

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
  assert.equal(
    expectStatus(await request(secondEmail, "/api/v1/exercises?scope=all"), 200).exercises
      .some((exercise) => exercise.id === firstExercise.id),
    false,
    "custom exercises must stay out of every other account's library",
  );

  const createdFirstRoutine = expectStatus(await request(firstEmail, "/api/v1/routines", {
    method: "POST",
    body: { code: "PRIVATE", version: singleSetRoutine(firstExercise.id, "Primary private") },
  }), 201).routine;
  const createdSecondRoutine = expectStatus(await request(secondEmail, "/api/v1/routines", {
    method: "POST",
    body: { code: "PRIVATE", version: singleSetRoutine(secondExercise.id, "Second private") },
  }), 201).routine;
  const equipmentRoutine = expectStatus(await request(firstEmail, "/api/v1/routines", {
    method: "POST",
    body: { code: "EQUIPMENT", version: singleSetRoutine(hiddenExercise.id, "Dumbbell only") },
  }), 201).routine;
  const crossAccountRoutine = await request(secondEmail, "/api/v1/routines", {
    method: "POST",
    body: { code: "STOLEN", version: singleSetRoutine(firstExercise.id, "Stolen exercise") },
  });
  expectStatus(crossAccountRoutine, 400);
  assert.equal(crossAccountRoutine.body.error.code, "routine_invalid");

  const firstOwnedRoutines = expectStatus(await request(firstEmail, "/api/v1/routines"), 200).routines;
  const secondOwnedRoutines = expectStatus(await request(secondEmail, "/api/v1/routines"), 200).routines;
  const firstRoutineIds = new Set(firstOwnedRoutines.map((routine) => routine.id));
  assert.deepEqual(new Set(firstOwnedRoutines.map((routine) => routine.id)), new Set([
    createdFirstRoutine.id,
    equipmentRoutine.id,
  ]));
  assert.deepEqual(secondOwnedRoutines.map((routine) => routine.id), [createdSecondRoutine.id]);
  assert.ok(firstOwnedRoutines.every((routine) => routine.ownerEmail === firstEmail));
  assert.ok(secondOwnedRoutines.every((routine) => routine.ownerEmail === secondEmail));
  assert.ok(secondOwnedRoutines.every((routine) => !firstRoutineIds.has(routine.id)));
  const firstRoutine = firstOwnedRoutines.find((routine) => routine.id === createdFirstRoutine.id);
  const secondRoutine = secondOwnedRoutines.find((routine) => routine.id === createdSecondRoutine.id);
  assert.ok(firstRoutine);
  assert.ok(secondRoutine);
  const encodedFirstRoutineId = encodeURIComponent(firstRoutine.id);
  const encodedSecondRoutineId = encodeURIComponent(secondRoutine.id);
  expectStatus(await request(secondEmail, `/api/v1/routines/${encodedFirstRoutineId}`), 404);
  expectStatus(await request(secondEmail, `/api/v1/routines/${encodedFirstRoutineId}/editor`), 404);
  const crossAccountVersions = await request(
    secondEmail,
    `/api/v1/routines/${encodedFirstRoutineId}/versions`,
  );
  expectStatus(crossAccountVersions, 404);
  assert.equal(crossAccountVersions.body.error.code, "routine_not_found");
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

  const routineCode = firstRoutine.code;
  assert.equal(secondRoutine.code, routineCode);
  const firstWorkout = expectStatus(await request(firstEmail, "/api/v1/workouts", {
    method: "POST",
    body: { routineId: routineCode },
  }), 201).session;
  const secondWorkout = expectStatus(await request(secondEmail, "/api/v1/workouts", {
    method: "POST",
    body: { routineId: routineCode },
  }), 201).session;
  assert.notEqual(firstWorkout.id, secondWorkout.id);

  expectStatus(await request(firstEmail, "/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: ["bodyweight"], sessionDurationMin: 60 },
  }), 200);
  const constrainedBootstrap = expectStatus(
    await request(firstEmail, "/api/v1/bootstrap"),
    200,
  );
  const equipmentRecommendation = constrainedBootstrap.recommendations.routines.find(
    (routine) => routine.code === equipmentRoutine.code,
  );
  assert.ok(equipmentRecommendation);
  assert.ok(
    ["recommended", "available"].includes(equipmentRecommendation.availability),
    "routine readiness must not be reduced because its exercise needs unselected equipment",
  );
  assert.doesNotMatch(equipmentRecommendation.availabilityReason, /equipment|training setup/i);
  const activeRoutine = firstOwnedRoutines.find((routine) => routine.code === routineCode);
  assert.ok(activeRoutine);
  assert.equal(
    (await database.prepare("SELECT routine_id AS routineId FROM workout_sessions WHERE id = ?")
      .bind(firstWorkout.id)
      .first()).routineId,
    activeRoutine.id,
    "new workouts must persist immutable routine identity",
  );
  await database.prepare("UPDATE workout_sessions SET routine_code = ? WHERE id = ?")
    .bind("STALE-SNAPSHOT-CODE", firstWorkout.id)
    .run();
  const resumedWorkout = expectStatus(await request(firstEmail, "/api/v1/workouts", {
    method: "POST",
    body: { routineId: routineCode, expectedRoutineVersionId: "stale-version" },
  }), 200);
  assert.equal(resumedWorkout.created, false);
  assert.equal(resumedWorkout.session.id, firstWorkout.id);
  await database.prepare("UPDATE workout_sessions SET routine_code = ? WHERE id = ?")
    .bind(routineCode, firstWorkout.id)
    .run();
  const equipmentStart = expectStatus(await request(firstEmail, "/api/v1/workouts", {
    method: "POST",
    body: { routineId: equipmentRoutine.code, abandonActive: true },
  }), 201);
  assert.equal(equipmentStart.created, true);
  assert.equal(equipmentStart.session.routineCode, equipmentRoutine.code);
  assert.equal(
    (await database.prepare("SELECT status FROM workout_sessions WHERE id = ?")
      .bind(firstWorkout.id)
      .first()).status,
    "Abandoned",
    "starting a routine with unselected equipment should replace the active workout when confirmed",
  );
  expectStatus(await request(firstEmail, "/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: allEquipment, sessionDurationMin: 60 },
  }), 200);

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
