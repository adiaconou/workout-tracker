import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const ownerEmail = "routine-editor@example.com";
const allEquipment = [
  "bodyweight", "dumbbells", "bench", "kettlebells", "pull_up_station",
  "dip_station", "cable_machine", "ez_bar", "resistance_bands", "barbell",
];

const advancedSet = (overrides = {}) => ({
  position: 1,
  setType: "test",
  targetType: "reps",
  targetMin: 4,
  targetMax: 6,
  targetDisplay: "4-6 controlled reps",
  targetRirMin: 0,
  targetRirMax: 1,
  restAfterSec: 180,
  restRule: "after_superset",
  loadInstruction: "Use the same fixed load for both sides",
  sideMode: "per_side",
  tempo: "3-1-1",
  notes: "Stop before technique changes",
  ...overrides,
});

const normalizedInput = (exerciseId) => ({
  focus: "Duplicate placement strength",
  summary: "Preserve every normalized prescription field.",
  durationMin: 52,
  exercises: [
    {
      exerciseId,
      position: 1,
      supersetGroup: "A1",
      instructions: "Pause at peak contraction.",
      notes: "Primary placement note",
      sets: [
        advancedSet(),
        advancedSet({
          position: 2,
          setType: "emom",
          targetType: "rounds",
          targetMin: 5,
          targetMax: 7,
          targetDisplay: "5-7 rounds",
          targetRirMin: null,
          targetRirMax: null,
          restAfterSec: 15,
          restRule: "emom",
          loadInstruction: "Keep the load constant",
          sideMode: "bilateral",
          tempo: null,
          notes: "Begin on the minute",
        }),
      ],
    },
    {
      exerciseId,
      position: 2,
      supersetGroup: "A1",
      instructions: "Use a different angle.",
      notes: "Second placement of the same library exercise",
      sets: [advancedSet({
        setType: "drop",
        targetType: "duration",
        targetMin: 35,
        targetMax: 45,
        targetDisplay: "35-45 sec",
        targetRirMin: null,
        targetRirMax: null,
        restAfterSec: 0,
        restRule: "no_rest_before_drop",
        loadInstruction: "Reduce load by 20%",
        sideMode: "left_right",
        tempo: "2-0-2",
        notes: "Change load immediately",
      })],
    },
  ],
});

function versionInput(version) {
  return {
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
  };
}

test("normalized routine editor preserves exact fields and rejects no-op and stale saves", async (context) => {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: [fileURLToPath(new URL("../worker/index.ts", import.meta.url))],
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
      OWNER_EMAIL: ownerEmail,
      AUTH_SESSION_SECRET: "routine-editor-integration-secret-2026",
    },
    d1Databases: { DB: "routine-editor-api-test" },
  });
  context.after(() => miniflare.dispose());
  const database = await miniflare.getD1Database("DB");
  const ownerHeaders = { "oai-authenticated-user-email": ownerEmail };

  async function request(path, { method = "GET", body } = {}) {
    const headers = new Headers(ownerHeaders);
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

  expectStatus(await request("/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: allEquipment, sessionDurationMin: 60 },
  }), 200);

  const createdExercise = expectStatus(await request("/api/v1/exercises", {
    method: "POST",
    body: {
      name: "Editor cable row",
      equipment: "cable",
      movementPattern: "horizontal pull",
      trackingType: "reps",
      defaultLoadType: "external",
      sideMode: "bilateral",
      instructions: "Library instructions must remain unchanged.",
      muscles: [{ muscleGroup: "back", role: "primary", weight: 1 }],
    },
  }), 201).exercise;
  const libraryBefore = structuredClone(createdExercise);
  const original = normalizedInput(createdExercise.id);
  const createdRoutine = expectStatus(await request("/api/v1/routines", {
    method: "POST",
    body: { code: "Q", version: original },
  }), 201).routine;
  assert.equal(createdRoutine.currentVersion.exercises.length, 2);
  assert.equal(createdRoutine.currentVersion.exercises[0].exerciseId, createdRoutine.currentVersion.exercises[1].exerciseId);

  const legacyWrite = await request("/api/v1/routines/Q/prescription", {
    method: "PATCH",
    body: { focus: "Lossy legacy overwrite", exercises: [] },
  });
  expectStatus(legacyWrite, 410);
  assert.equal(legacyWrite.body.error.code, "routine_editor_required");

  const loaded = expectStatus(await request("/api/v1/routines/Q/editor"), 200);
  assert.equal(loaded.routine.currentVersionId, createdRoutine.currentVersionId);
  assert.deepEqual(versionInput(loaded.routine.currentVersion), original);
  assert.equal(loaded.versions.length, 1);

  const firstBase = loaded.routine.currentVersionId;
  const edited = structuredClone(original);
  edited.summary = "Only the routine summary changed; every advanced field remains exact.";
  const saved = expectStatus(await request("/api/v1/routines/Q/editor", {
    method: "PATCH",
    body: { baseVersionId: firstBase, proposedRoutine: edited },
  }), 200);
  assert.equal(saved.routine.currentVersion.versionNumber, 2);
  assert.deepEqual(versionInput(saved.routine.currentVersion), edited);
  assert.equal(saved.routine.currentVersion.exercises.length, 2);

  const libraryAfter = expectStatus(await request(`/api/v1/exercises/${createdExercise.id}`), 200).exercise;
  assert.deepEqual(libraryAfter, libraryBefore, "saving a routine must not rename or otherwise mutate its library exercise");

  const versionCountAfterSave = saved.versions.length;
  const noOp = await request("/api/v1/routines/Q/editor", {
    method: "PATCH",
    body: {
      baseVersionId: saved.routine.currentVersionId,
      proposedRoutine: versionInput(saved.routine.currentVersion),
    },
  });
  expectStatus(noOp, 409);
  assert.equal(noOp.body.error.code, "routine_no_changes");
  const afterNoOp = expectStatus(await request("/api/v1/routines/Q/editor"), 200);
  assert.equal(afterNoOp.versions.length, versionCountAfterSave, "a no-op must not create a draft version");

  const staleBase = saved.routine.currentVersionId;
  const intervening = versionInput(saved.routine.currentVersion);
  intervening.focus = "Intervening publish";
  const interveningSave = expectStatus(await request("/api/v1/routines/Q/editor", {
    method: "PATCH",
    body: { baseVersionId: staleBase, proposedRoutine: intervening },
  }), 200);

  const staleProposal = versionInput(saved.routine.currentVersion);
  staleProposal.durationMin = 61;
  const stale = await request("/api/v1/routines/Q/editor", {
    method: "PATCH",
    body: { baseVersionId: staleBase, proposedRoutine: staleProposal },
  });
  expectStatus(stale, 409);
  assert.equal(stale.body.error.code, "routine_version_stale");
  const afterStale = expectStatus(await request("/api/v1/routines/Q/editor"), 200);
  assert.equal(afterStale.routine.currentVersionId, interveningSave.routine.currentVersionId);
  assert.equal(afterStale.versions.length, interveningSave.versions.length, "a stale save must not leave a draft behind");

  const activeVersion = interveningSave.routine.currentVersion;
  expectStatus(await request("/api/v1/auth/profile", {
    method: "PATCH",
    body: {
      bodyWeightKg: 82.5,
      measurementSystem: "imperial",
    },
  }), 200);
  const started = expectStatus(await request("/api/v1/workouts", {
    method: "POST",
    body: { routineId: "Q" },
  }), 201);
  assert.equal(started.session.totalSets, 3, "test and heterogeneous normalized sets must all be counted");
  const activeWorkout = expectStatus(await request(`/api/v1/workouts/${started.session.id}`), 200).workout;
  assert.equal(activeWorkout.routineVersion, activeVersion.versionNumber);
  assert.ok(Math.abs(activeWorkout.bodyWeight - (82.5 * 2.2046226218487757)) < 1e-9);
  assert.equal(activeWorkout.bodyWeightSource, "profile_snapshot");
  assert.equal(activeWorkout.weightUnit, "lb");
  assert.ok(activeWorkout.sets.every((set) => set.weightUnit === "lb"));
  assert.deepEqual(activeWorkout.sets.map((set) => set.exerciseOrder), [1, 2, 1], "every placement in the same superset group must interleave by round");
  assert.deepEqual(activeWorkout.sets.map((set) => set.setType), ["test", "drop", "emom"]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.targetUnit), ["reps", "seconds", "rounds"]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.targetType), ["reps", "duration", "rounds"]);
  assert.deepEqual(activeWorkout.sets.map((set) => [set.targetMin, set.targetMax]), [[4, 6], [35, 45], [5, 7]]);
  assert.deepEqual(activeWorkout.sets.map((set) => [set.targetRirMin, set.targetRirMax]), [[0, 1], [null, null], [null, null]]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.restSeconds), [180, 0, 15]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.restRule), ["after_superset", "no_rest_before_drop", "emom"]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.sideMode), ["per_side", "left_right", "bilateral"]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.tempo), ["3-1-1", "2-0-2", null]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.loadInstruction), [
    "Use the same fixed load for both sides",
    "Reduce load by 20%",
    "Keep the load constant",
  ]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.notes), [
    "Stop before technique changes",
    "Change load immediately",
    "Begin on the minute",
  ]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.exerciseInstructions), [
    "Pause at peak contraction.",
    "Use a different angle.",
    "Pause at peak contraction.",
  ]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.exerciseNotes), [
    "Primary placement note",
    "Second placement of the same library exercise",
    "Primary placement note",
  ]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.sourceRoutineExerciseId), [
    activeVersion.exercises[0].id,
    activeVersion.exercises[1].id,
    activeVersion.exercises[0].id,
  ]);
  assert.deepEqual(activeWorkout.sets.map((set) => set.sourceRoutineSetId), [
    activeVersion.exercises[0].sets[0].id,
    activeVersion.exercises[1].sets[0].id,
    activeVersion.exercises[0].sets[1].id,
  ]);

  expectStatus(await request("/api/v1/auth/profile", {
    method: "PATCH",
    body: {
      bodyWeightKg: 90,
      measurementSystem: "metric",
    },
  }), 200);
  const resumed = expectStatus(await request("/api/v1/workouts", {
    method: "POST",
    body: { routineId: "Q" },
  }), 200);
  assert.equal(resumed.created, false);
  assert.equal(resumed.session.id, started.session.id);
  const resumedWorkout = expectStatus(await request(`/api/v1/workouts/${started.session.id}`), 200).workout;
  assert.ok(Math.abs(resumedWorkout.bodyWeight - (82.5 * 2.2046226218487757)) < 1e-9);
  assert.equal(resumedWorkout.bodyWeightSource, "profile_snapshot");
  assert.equal(resumedWorkout.weightUnit, "lb");
  assert.ok(resumedWorkout.sets.every((set) => set.weightUnit === "lb"));

  const materializedSets = await database.prepare(`SELECT source_routine_set_id AS sourceRoutineSetId,
    set_type AS setType, planned_target_type AS targetType,
    planned_target_min AS targetMin, planned_target_max AS targetMax,
    planned_target_display AS targetDisplay, planned_rir_min AS rirMin,
    planned_rir_max AS rirMax, planned_rest_sec AS restSec,
    planned_rest_rule AS restRule, started_at AS startedAt,
    elapsed_seconds AS elapsedSeconds, notes
    FROM workout_sets WHERE workout_id = ? ORDER BY position`).bind(started.session.id).all();
  assert.deepEqual(materializedSets.results.map((set) => set.setType), ["test", "drop", "emom"]);
  assert.deepEqual(materializedSets.results.map((set) => set.targetType), ["reps", "duration", "rounds"]);
  assert.deepEqual(materializedSets.results.map((set) => [set.targetMin, set.targetMax]), [[4, 6], [35, 45], [5, 7]]);
  assert.deepEqual(materializedSets.results.map((set) => [set.rirMin, set.rirMax]), [[0, 1], [null, null], [null, null]]);
  assert.deepEqual(materializedSets.results.map((set) => [set.restSec, set.restRule]), [
    [180, "after_superset"],
    [0, "no_rest_before_drop"],
    [15, "emom"],
  ]);
  assert.deepEqual(materializedSets.results.map((set) => set.notes), [
    "Stop before technique changes",
    "Change load immediately",
    "Begin on the minute",
  ]);
  assert.ok(materializedSets.results[0].startedAt, "the first set timer starts with the workout");
  assert.equal(materializedSets.results[0].elapsedSeconds, null);
  assert.deepEqual(materializedSets.results.slice(1).map((set) => set.startedAt), [null, null]);

  const materializedExercises = await database.prepare(`SELECT source_routine_exercise_id AS sourceRoutineExerciseId,
    side_mode_snapshot AS sideMode, load_type_snapshot AS loadType, notes
    FROM workout_exercises WHERE workout_id = ? ORDER BY position`).bind(started.session.id).all();
  assert.deepEqual(materializedExercises.results.map((exercise) => exercise.sourceRoutineExerciseId), [
    activeVersion.exercises[0].id,
    activeVersion.exercises[1].id,
  ]);
  assert.deepEqual(materializedExercises.results.map((exercise) => exercise.sideMode), ["per_side", "left_right"]);
  assert.deepEqual(materializedExercises.results.map((exercise) => exercise.loadType), ["external", "external"]);
  assert.deepEqual(materializedExercises.results.map((exercise) => exercise.notes), [
    "Primary placement note",
    "Second placement of the same library exercise",
  ]);

  const firstMemberResult = expectStatus(await request(`/api/v1/workouts/${started.session.id}/sets`, {
    method: "POST",
    body: { prescribedSetId: activeWorkout.sets[0].id, status: "Completed", actualWeight: 80, actualReps: 5 },
  }), 200);
  assert.equal(firstMemberResult.restSeconds, 0, "rest must not interrupt members of the same superset round");
  assert.equal(firstMemberResult.restEndsAt, null);
  const recordedFirstMember = await database.prepare(`SELECT weight_unit AS weightUnit
    FROM set_performances WHERE session_id = ? AND prescribed_set_id = ?`)
    .bind(started.session.id, activeWorkout.sets[0].id).first();
  assert.equal(recordedFirstMember.weightUnit, "lb", "recorded load units must stay locked to the workout snapshot");
  const afterFirstMember = await database.prepare(`SELECT started_at AS startedAt,
    elapsed_seconds AS elapsedSeconds FROM workout_sets
    WHERE workout_id = ? ORDER BY position`).bind(started.session.id).all();
  assert.ok(afterFirstMember.results[0].elapsedSeconds !== null);
  assert.ok(afterFirstMember.results[1].startedAt, "a no-rest transition starts the next set immediately");
  const finalMemberResult = expectStatus(await request(`/api/v1/workouts/${started.session.id}/sets`, {
    method: "POST",
    body: {
      prescribedSetId: activeWorkout.sets[1].id,
      status: "Completed",
      actualWeight: 60,
      actualDurationSec: 40,
    },
  }), 200);
  assert.equal(finalMemberResult.restSeconds, 180, "the deferred superset rest must begin after the final member");
  assert.ok(finalMemberResult.restEndsAt);
  const restingSet = await database.prepare(`SELECT started_at AS startedAt FROM workout_sets
    WHERE workout_id = ? AND position = 3`).bind(started.session.id).first();
  assert.equal(restingSet.startedAt, null, "the next set does not start while prescribed rest is active");
  const missingRounds = await request(`/api/v1/workouts/${started.session.id}/sets`, {
    method: "POST",
    body: { prescribedSetId: activeWorkout.sets[2].id, status: "Completed", actualWeight: 80, actualReps: null },
  });
  expectStatus(missingRounds, 400);
  assert.match(missingRounds.body.error.message, /rounds/i, "the direct API must require an explicit round result");
  const roundsResult = expectStatus(await request(`/api/v1/workouts/${started.session.id}/sets`, {
    method: "POST",
    body: { prescribedSetId: activeWorkout.sets[2].id, status: "Completed", actualWeight: 80, actualReps: 6 },
  }), 200);
  assert.equal(roundsResult.nextSetIndex, 3, "round targets must advance through the explicit rounds path");
  assert.equal(roundsResult.workoutCompleted, true);
  const timedSets = await database.prepare(`SELECT started_at AS startedAt,
    elapsed_seconds AS elapsedSeconds FROM workout_sets
    WHERE workout_id = ? ORDER BY position`).bind(started.session.id).all();
  assert.ok(timedSets.results.every((set) => set.startedAt && set.elapsedSeconds !== null));

  const completedSession = await database.prepare(`SELECT completed_at AS completedAt,
    body_weight AS bodyWeight, body_weight_source AS bodyWeightSource, weight_unit AS weightUnit
    FROM workout_sessions WHERE id = ?`).bind(started.session.id).first();
  assert.ok(completedSession?.completedAt);
  assert.ok(Math.abs(completedSession.bodyWeight - (82.5 * 2.2046226218487757)) < 1e-9);
  assert.equal(completedSession.bodyWeightSource, "profile_snapshot");
  assert.equal(completedSession.weightUnit, "lb");
  const completedBootstrap = expectStatus(await request("/api/v1/bootstrap"), 200);
  const completedRoutineSummary = completedBootstrap.routines.find((routine) => routine.code === "Q");
  assert.equal(
    completedRoutineSummary?.lastWorkoutAt,
    completedSession.completedAt,
    "routine cards must receive the exact latest completed workout date",
  );
  assert.equal(completedRoutineSummary?.durationSampleCount, 1);
  assert.ok(Number.isFinite(completedRoutineSummary?.averageDurationSeconds));
  assert.ok(
    completedBootstrap.routines.some((routine) => routine.code !== "Q" && routine.lastWorkoutAt === null),
    "routines without history must return a null last workout date",
  );

  const partialAt = new Date(new Date(completedSession.completedAt).getTime() + 60_000).toISOString();
  await database.prepare(`UPDATE workout_sessions SET status = 'Partial', completed_at = ?, updated_at = ?
    WHERE id = ?`).bind(partialAt, partialAt, started.session.id).run();
  const partialBootstrap = expectStatus(await request("/api/v1/bootstrap"), 200);
  assert.equal(
    partialBootstrap.routines.find((routine) => routine.code === "Q")?.lastWorkoutAt,
    partialAt,
    "a deliberately finished partial workout still counts as the last time the routine was done",
  );

  const nextVersionInput = versionInput(activeVersion);
  nextVersionInput.summary = "A later version must still match prior duplicate placements by occurrence.";
  const nextVersion = expectStatus(await request("/api/v1/routines/Q/editor", {
    method: "PATCH",
    body: { baseVersionId: activeVersion.id, proposedRoutine: nextVersionInput },
  }), 200).routine.currentVersion;
  assert.notEqual(nextVersion.exercises[0].id, activeVersion.exercises[0].id);

  const staleStart = await request("/api/v1/workouts", {
    method: "POST",
    body: {
      routineId: "Q",
      expectedRoutineVersionId: activeVersion.id,
    },
  });
  expectStatus(staleStart, 409);
  assert.equal(staleStart.body.error.code, "routine_version_stale");

  const nextStarted = expectStatus(await request("/api/v1/workouts", {
    method: "POST",
    body: { routineId: "Q", expectedRoutineVersionId: nextVersion.id },
  }), 201);
  const nextWorkout = expectStatus(await request(`/api/v1/workouts/${nextStarted.session.id}`), 200).workout;
  assert.equal(nextWorkout.bodyWeight, 90);
  assert.equal(nextWorkout.bodyWeightSource, "profile_snapshot");
  assert.equal(nextWorkout.weightUnit, "kg");
  assert.ok(nextWorkout.sets.every((set) => set.weightUnit === "kg"));
  assert.deepEqual(
    nextWorkout.previousPerformanceByExercise[1].sets.map((set) => [set.actualReps, set.actualDurationSec, set.targetType]),
    [[5, null, "reps"], [6, null, "rounds"]],
    "the first occurrence must only receive the first placement's prior sets",
  );
  assert.deepEqual(
    nextWorkout.previousPerformanceByExercise[2].sets.map((set) => [set.actualReps, set.actualDurationSec, set.targetType]),
    [[null, 40, "duration"]],
    "the second occurrence must not cross-join prior sets from the first placement",
  );

  expectStatus(await request("/api/v1/auth/profile", {
    method: "PATCH",
    body: { bodyWeightKg: null },
  }), 200);
  const replacement = expectStatus(await request("/api/v1/workouts", {
    method: "POST",
    body: { routineId: "A", abandonActive: true },
  }), 201);
  const replacedSession = await database.prepare(`SELECT status, body_weight AS bodyWeight,
    body_weight_source AS bodyWeightSource, weight_unit AS weightUnit
    FROM workout_sessions WHERE id = ?`).bind(nextStarted.session.id).first();
  assert.equal(replacedSession.status, "Abandoned");
  assert.equal(replacedSession.bodyWeight, 90, "replacement must not rewrite an existing snapshot");
  assert.equal(replacedSession.bodyWeightSource, "profile_snapshot");
  assert.equal(replacedSession.weightUnit, "kg");

  const emptySnapshotWorkout = expectStatus(
    await request(`/api/v1/workouts/${replacement.session.id}`),
    200,
  ).workout;
  assert.equal(emptySnapshotWorkout.bodyWeight, null);
  assert.equal(emptySnapshotWorkout.bodyWeightSource, null);
  assert.equal(emptySnapshotWorkout.weightUnit, "kg");
  assert.ok(emptySnapshotWorkout.sets.every((set) => set.weightUnit === "kg"));

  expectStatus(await request("/api/v1/auth/profile", {
    method: "PATCH",
    body: { bodyWeightKg: 95 },
  }), 200);
  expectStatus(await request(`/api/v1/workouts/${replacement.session.id}/complete`, {
    method: "POST",
    body: {},
  }), 200);
  const backfilledSession = await database.prepare(`SELECT status, body_weight AS bodyWeight,
    body_weight_source AS bodyWeightSource, weight_unit AS weightUnit
    FROM workout_sessions WHERE id = ?`).bind(replacement.session.id).first();
  assert.equal(backfilledSession.status, "Partial");
  assert.equal(backfilledSession.bodyWeight, 95);
  assert.equal(backfilledSession.bodyWeightSource, "profile_backfill");
  assert.equal(backfilledSession.weightUnit, "kg");

  const laterStarted = expectStatus(await request("/api/v1/workouts", {
    method: "POST",
    body: { routineId: "B" },
  }), 201);
  const laterWorkout = expectStatus(await request(`/api/v1/workouts/${laterStarted.session.id}`), 200).workout;
  assert.equal(laterWorkout.bodyWeight, 95);
  assert.equal(laterWorkout.bodyWeightSource, "profile_snapshot");
  assert.equal(laterWorkout.weightUnit, "kg");
  assert.ok(laterWorkout.sets.every((set) => set.weightUnit === "kg"));
});
