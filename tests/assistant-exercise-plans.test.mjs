import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { SignJWT } from "jose";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const ownerEmail = "owner@example.com";
const sessionSecret = "assistant-exercise-plan-integration-secret-2026";

const fullExercise = (name, overrides = {}) => ({
  name,
  equipment: "dumbbell",
  movementPattern: "carry",
  trackingType: "reps",
  defaultLoadType: "external",
  sideMode: "bilateral",
  instructions: "Move with control.",
  muscles: [{ muscleGroup: "grip", role: "primary", weight: 1 }],
  ...overrides,
});

const singleSetRoutine = (exerciseId, focus) => ({
  focus,
  summary: "Assistant exercise-plan integration test",
  durationMin: 30,
  exercises: [{
    exerciseId,
    position: 1,
    supersetGroup: null,
    instructions: "Leave two reps in reserve.",
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

const newRoutineProposal = (exerciseId, focus) => {
  const routine = singleSetRoutine(exerciseId, focus);
  return {
    ...routine,
    exercises: routine.exercises.map((exercise) => ({
      ...exercise,
      sourceRoutineExerciseId: null,
      sets: exercise.sets.map((set) => ({ ...set, sourceRoutineSetId: null })),
    })),
  };
};

function responseText(id, text) {
  return {
    id,
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  };
}

function responseTool(id, callId, name, argumentsValue) {
  return {
    id,
    status: "completed",
    output: [{
      type: "function_call",
      call_id: callId,
      name,
      arguments: JSON.stringify(argumentsValue),
    }],
  };
}

test("Coach review cards are single-approval and enforce owner, state, and revision boundaries", async (context) => {
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
  const queuedResponses = [];
  const responseRequests = [];
  let responseSequence = 0;
  const miniflare = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-22",
    bindings: {
      ALLOWED_USER_EMAILS: "routine-other@example.com,other@example.com",
      OWNER_EMAIL: ownerEmail,
      AUTH_SESSION_SECRET: sessionSecret,
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_DEFAULT_MODEL: "gpt-5.6-terra",
    },
    d1Databases: { DB: "assistant-exercise-plans-test" },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.6-terra", created: 1 }] });
      }
      if (url.pathname === "/v1/responses") {
        responseRequests.push(await request.json());
        const next = queuedResponses.shift();
        assert.ok(next, "A mocked Responses API result should be queued");
        return Response.json(next);
      }
      return Response.json({ error: { message: `Unexpected outbound request: ${url.pathname}` } }, { status: 404 });
    },
  });
  context.after(() => miniflare.dispose());

  const database = await miniflare.getD1Database("DB");
  const ownerHeaders = { "oai-authenticated-user-email": ownerEmail };

  async function request(path, { method = "GET", body, headers = ownerHeaders } = {}) {
    const requestHeaders = new Headers(headers);
    if (body !== undefined) requestHeaders.set("content-type", "application/json");
    const response = await miniflare.dispatchFetch(`https://workout.test${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
    };
  }

  function assertStatus(result, expected) {
    assert.equal(result.status, expected, JSON.stringify(result.body));
    return result.body;
  }

  async function first(sql, ...values) {
    return database.prepare(sql).bind(...values).first();
  }

  async function count(sql, ...values) {
    const row = await first(sql, ...values);
    return Number(row?.count ?? 0);
  }

  function enqueueText(text) {
    responseSequence += 1;
    queuedResponses.push(responseText(`response-${responseSequence}`, text));
  }

  function enqueueTool(name, argumentsValue) {
    responseSequence += 1;
    queuedResponses.push(responseTool(
      `response-${responseSequence}`,
      `call-${responseSequence}`,
      name,
      argumentsValue,
    ));
  }

  async function createThread() {
    const result = await request("/api/v1/assistant/threads", { method: "POST", body: {} });
    return assertStatus(result, 201).thread;
  }

  async function sendMessage(threadId, content) {
    return request("/api/v1/assistant/messages", {
      method: "POST",
      body: {
        threadId,
        content,
        model: "gpt-5.6-terra",
        reasoningEffort: "low",
      },
    });
  }

  async function stageExercisePlan({ action, exercise = null, proposedExercise = null, summary }) {
    const thread = await createThread();
    const plansBefore = await count(
      "SELECT COUNT(*) AS count FROM assistant_exercise_change_plans WHERE owner_email = ?",
      ownerEmail,
    );
    if (action === "create") {
      enqueueTool("search_exercises", { query: proposedExercise.name, includeArchived: true });
    } else {
      enqueueTool("get_exercise", { exerciseId: exercise.id });
    }
    enqueueTool("propose_exercise_change", {
      action,
      exerciseId: exercise?.id ?? null,
      baseUpdatedAt: exercise?.updatedAt ?? null,
      proposedExercise,
      summary,
      rationale: `Integration-test ${action} review plan.`,
    });
    enqueueText("The review card is ready. Nothing has changed yet.");
    const staged = await sendMessage(thread.id, `Please ${summary.toLowerCase()}.`);
    const payload = assertStatus(staged, 201);
    assert.equal(queuedResponses.length, 0, "Every queued model response should be consumed");
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_exercise_change_plans WHERE owner_email = ?", ownerEmail),
      plansBefore + 1,
      "One initial user request should stage one review card",
    );
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_messages WHERE owner_email = ? AND thread_id = ? AND role = 'user'", ownerEmail, thread.id),
      1,
      "Staging a review card must not require a second verbal approval message",
    );
    const plan = payload.plans.find((candidate) => (
      candidate.kind === "exercise" && candidate.action === action && candidate.summary === summary
    ));
    assert.ok(plan, `A pending ${action} plan should be returned`);
    assert.equal(plan.status, "pending");
    return { thread, plan };
  }

  async function stageRoutineCreation({ code, exercise, focus = "Coach-built strength" }) {
    const thread = await createThread();
    const plansBefore = await count(
      "SELECT COUNT(*) AS count FROM assistant_change_plans WHERE owner_email = ?",
      ownerEmail,
    );
    enqueueTool("get_coaching_context", {});
    enqueueTool("search_exercises", { query: exercise.name, includeArchived: false });
    enqueueTool("propose_new_routine", {
      routineCode: code,
      proposedRoutine: newRoutineProposal(exercise.id, focus),
      summary: `Create ${focus}`,
      rationale: "Create a complete routine from active exercises after the user reviews every field.",
    });
    enqueueText("The new-routine review card is ready. Nothing has changed yet.");
    const payload = assertStatus(await sendMessage(thread.id, `Create a new ${focus} routine.`), 201);
    assert.equal(queuedResponses.length, 0, "Every queued model response should be consumed");
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_change_plans WHERE owner_email = ?", ownerEmail),
      plansBefore + 1,
      "One request should stage one new-routine review card",
    );
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_messages WHERE owner_email = ? AND thread_id = ? AND role = 'user'", ownerEmail, thread.id),
      1,
      "Routine creation must not require a second verbal approval message",
    );
    const plan = payload.plans.find((candidate) => (
      candidate.kind === "routine" && candidate.action === "create" && candidate.routineCode === code.trim().toUpperCase()
    ));
    assert.ok(plan, "A pending routine-creation plan should be returned");
    assert.equal(plan.status, "pending");
    return { thread, plan, proposedRoutine: newRoutineProposal(exercise.id, focus) };
  }

  async function createExercise(name, overrides = {}) {
    const result = await request("/api/v1/exercises", {
      method: "POST",
      body: fullExercise(name, overrides),
    });
    return assertStatus(result, 201).exercise;
  }

  async function createOtherOwnerToken(otherEmail = "other@example.com") {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await database.prepare(`INSERT INTO app_users (
      id, owner_email, display_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)`).bind(userId, otherEmail, "Other Owner", now, now).run();
    await database.prepare(`INSERT INTO auth_sessions (
      id, user_id, refresh_token_hash, device_name, expires_at, revoked_at,
      created_at, rotated_at, last_used_at
    ) VALUES (?, ?, ?, 'integration test', ?, NULL, ?, ?, ?)`)
      .bind(sessionId, userId, randomUUID(), expiresAt, now, now, now).run();
    return new SignJWT({ email: otherEmail, sid: sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("workout-tracker-api")
      .setAudience("workout-tracker-app")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(sessionSecret));
  }

  assertStatus(await request("/api/v1/assistant"), 200);

  await context.test("proposal does not mutate, owner isolation holds, and concurrent Apply is single-use", async () => {
    const name = "Coach Concurrent Carry";
    const { thread, plan } = await stageExercisePlan({
      action: "create",
      proposedExercise: fullExercise(name),
      summary: "Create the concurrent carry",
    });
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM exercise_catalog WHERE owner_email = ? AND normalized_name = ?", ownerEmail, name.toLowerCase()),
      0,
      "Staging must not create the exercise",
    );

    const otherToken = await createOtherOwnerToken("routine-other@example.com");
    const otherHeaders = { authorization: `Bearer ${otherToken}` };
    assertStatus(await request(`/api/v1/assistant?threadId=${encodeURIComponent(thread.id)}`, { headers: otherHeaders }), 404);
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, {
      method: "POST",
      body: {},
      headers: otherHeaders,
    }), 404);
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/reject`, {
      method: "POST",
      body: {},
      headers: otherHeaders,
    }), 404);
    assert.equal((await first("SELECT status FROM assistant_exercise_change_plans WHERE id = ?", plan.id))?.status, "pending");

    const attempts = await Promise.all([
      request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }),
      request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }),
    ]);
    assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), [200, 409]);
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM exercise_catalog WHERE owner_email = ? AND normalized_name = ?", ownerEmail, name.toLowerCase()),
      1,
    );
    assert.equal((await first("SELECT status FROM assistant_exercise_change_plans WHERE id = ?", plan.id))?.status, "applied");
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }), 409);
  });

  await context.test("Dismiss is terminal and never mutates the library", async () => {
    const name = "Coach Rejected Carry";
    const { plan } = await stageExercisePlan({
      action: "create",
      proposedExercise: fullExercise(name),
      summary: "Create the rejected carry",
    });
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/reject`, { method: "POST", body: {} }), 200);
    assert.equal((await first("SELECT status FROM assistant_exercise_change_plans WHERE id = ?", plan.id))?.status, "rejected");
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }), 409);
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM exercise_catalog WHERE owner_email = ? AND normalized_name = ?", ownerEmail, name.toLowerCase()),
      0,
    );
  });

  await context.test("one request stages and one approval creates a complete published routine", async () => {
    const exercise = await createExercise("Coach New Routine Exercise");
    const code = "coach-new";
    const { thread, plan, proposedRoutine } = await stageRoutineCreation({
      code,
      exercise,
      focus: "Coach-created upper body",
    });

    assert.equal(plan.routineId, null);
    assert.match(plan.diff.join("\n"), /Create routine code "COACH-NEW"/i);
    assert.match(plan.diff.join("\n"), /Add "Coach New Routine Exercise"/i);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ? AND code = 'COACH-NEW'", ownerEmail), 0);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", plan.id), 0);

    const otherToken = await createOtherOwnerToken();
    const otherHeaders = { authorization: `Bearer ${otherToken}` };
    assertStatus(await request(`/api/v1/assistant?threadId=${encodeURIComponent(thread.id)}`, { headers: otherHeaders }), 404);
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, {
      method: "POST",
      body: {},
      headers: otherHeaders,
    }), 404);
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", plan.id))?.status, "pending");

    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, {
      method: "POST",
      body: { publish: false },
    }), 400);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ? AND code = 'COACH-NEW'", ownerEmail), 0);

    const attempts = await Promise.all([
      request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }),
      request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }),
    ]);
    assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), [200, 409]);

    const created = assertStatus(await request("/api/v1/routines/COACH-NEW/editor"), 200).routine;
    assert.equal(created.id, plan.id, "The staged plan ID should preallocate the new routine identity");
    assert.equal(created.code, "COACH-NEW");
    assert.equal(created.currentVersion?.status, "published");
    assert.equal(created.currentVersion?.versionNumber, 1);
    assert.equal(created.currentVersion?.focus, proposedRoutine.focus);
    assert.equal(created.currentVersion?.summary, proposedRoutine.summary);
    assert.equal(created.currentVersion?.durationMin, proposedRoutine.durationMin);
    assert.equal(created.currentVersion?.exercises[0]?.exerciseId, exercise.id);
    assert.equal(created.currentVersion?.exercises[0]?.sets[0]?.targetDisplay, "8-10 reps");
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", created.id), 1);
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", plan.id))?.status, "applied");
  });

  await context.test("dismissing a new-routine card is terminal and creates nothing", async () => {
    const exercise = await createExercise("Coach Dismissed Routine Exercise");
    const { plan } = await stageRoutineCreation({ code: "COACH-DISMISSED", exercise });

    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/reject`, { method: "POST", body: {} }), 200);
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", plan.id))?.status, "rejected");
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }), 409);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ? AND code = 'COACH-DISMISSED'", ownerEmail), 0);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", plan.id), 0);
  });

  await context.test("interrupted routine creation resumes before or after the domain write", async () => {
    const beforeExercise = await createExercise("Coach Resume Before Creation Exercise");
    const before = await stageRoutineCreation({ code: "COACH-RESUME-BEFORE", exercise: beforeExercise });
    const expiredAt = new Date(Date.now() - 2 * 60_000).toISOString();
    await database.prepare(`UPDATE assistant_change_plans
      SET status = 'applying', updated_at = ? WHERE id = ?`).bind(expiredAt, before.plan.id).run();

    const [reloaded, firstRetry] = await Promise.all([
      request(`/api/v1/assistant?threadId=${encodeURIComponent(before.thread.id)}`),
      request(`/api/v1/assistant/plans/${before.plan.id}/apply`, { method: "POST", body: {} }),
    ]);
    assertStatus(reloaded, 200);
    assert.ok([200, 409].includes(firstRetry.status), JSON.stringify(firstRetry.body));
    if (firstRetry.status === 409) {
      assertStatus(await request(`/api/v1/assistant/plans/${before.plan.id}/apply`, { method: "POST", body: {} }), 200);
    }
    assert.equal(await count("SELECT COUNT(*) AS count FROM routines WHERE id = ? AND owner_email = ?", before.plan.id, ownerEmail), 1);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", before.plan.id), 1);
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", before.plan.id))?.status, "applied");

    const afterExercise = await createExercise("Coach Resume After Creation Exercise");
    const after = await stageRoutineCreation({ code: "COACH-RESUME-AFTER", exercise: afterExercise });
    assertStatus(await request(`/api/v1/assistant/plans/${after.plan.id}/apply`, { method: "POST", body: {} }), 200);
    const versionCount = await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", after.plan.id);
    await database.prepare(`UPDATE assistant_change_plans
      SET status = 'applying', applied_version_id = NULL, updated_at = ? WHERE id = ?`)
      .bind(expiredAt, after.plan.id).run();

    assertStatus(await request(`/api/v1/assistant/plans/${after.plan.id}/apply`, { method: "POST", body: {} }), 200);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routines WHERE id = ? AND owner_email = ?", after.plan.id, ownerEmail), 1);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", after.plan.id), versionCount);
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", after.plan.id))?.status, "applied");
  });

  await context.test("a new-routine plan becomes stale when its code is claimed before Apply", async () => {
    const exercise = await createExercise("Coach Claimed Code Exercise");
    const { plan } = await stageRoutineCreation({ code: "COACH-CLAIMED", exercise });
    assertStatus(await request("/api/v1/routines", {
      method: "POST",
      body: { code: "COACH-CLAIMED", version: singleSetRoutine(exercise.id, "Claimed first") },
    }), 201);

    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }), 409);
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", plan.id))?.status, "stale");
    assert.equal(await count("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ? AND code = 'COACH-CLAIMED'", ownerEmail), 1);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", plan.id), 0);
  });

  await context.test("an unavailable exercise makes routine creation stale without leaving an orphan", async () => {
    const exercise = await createExercise("Coach Archived Routine Exercise");
    const { plan } = await stageRoutineCreation({ code: "COACH-ARCHIVED", exercise });
    assertStatus(await request(`/api/v1/exercises/${encodeURIComponent(exercise.id)}`, { method: "DELETE" }), 200);

    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }), 409);
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", plan.id))?.status, "stale");
    assert.equal(await count("SELECT COUNT(*) AS count FROM routines WHERE owner_email = ? AND code = 'COACH-ARCHIVED'", ownerEmail), 0);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", plan.id), 0);
  });

  await context.test("one routine request stages an exact review card without creating a version", async () => {
    const exercise = await createExercise("Coach Routine Review Exercise");
    const created = assertStatus(await request("/api/v1/routines", {
      method: "POST",
      body: { code: "COACH-REVIEW", version: singleSetRoutine(exercise.id, "Review baseline") },
    }), 201).routine;
    const current = created.currentVersion;
    assert.ok(current);
    const placement = current.exercises[0];
    const set = placement.sets[0];
    const proposedRoutine = {
      focus: current.focus,
      summary: "Exact review-card coverage",
      durationMin: current.durationMin,
      exercises: [{
        sourceRoutineExerciseId: placement.id,
        exerciseId: placement.exerciseId,
        position: placement.position,
        supersetGroup: "A",
        instructions: "Use a controlled three-second lowering phase.",
        notes: "Stop if technique changes.",
        sets: [{
          sourceRoutineSetId: set.id,
          position: set.position,
          setType: set.setType,
          targetType: set.targetType,
          targetMin: set.targetMin,
          targetMax: set.targetMax,
          targetDisplay: set.targetDisplay,
          targetRirMin: set.targetRirMin,
          targetRirMax: set.targetRirMax,
          restAfterSec: set.restAfterSec,
          restRule: "after_superset",
          loadInstruction: "Use the heaviest technically clean load.",
          sideMode: set.sideMode,
          tempo: "3-1-1",
          notes: "Keep the final rep smooth.",
        }],
      }],
    };
    const versionsBefore = await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", created.id);
    const thread = await createThread();
    enqueueTool("get_routine", { routineId: created.id });
    enqueueTool("propose_routine_change", {
      routineId: created.id,
      baseVersionId: created.currentVersionId,
      proposedRoutine,
      summary: "Update the detailed set prescription",
      rationale: "Make every requested field visible before the user chooses an action.",
    });
    enqueueText("The review card is ready. Nothing has changed yet.");
    const staged = assertStatus(await sendMessage(thread.id, "Update this routine exactly as requested."), 201);
    const plan = staged.plans.find((candidate) => candidate.kind === "routine" && candidate.routineCode === "COACH-REVIEW");
    assert.ok(plan);
    assert.equal(plan.status, "pending");
    assert.match(plan.diff.join("\n"), /Routine summary.*Assistant exercise-plan integration test.*Exact review-card coverage/i);
    assert.match(plan.diff.join("\n"), /exercise instructions.*controlled three-second/i);
    assert.match(plan.diff.join("\n"), /superset group.*"A"/i);
    assert.match(plan.diff.join("\n"), /rest rule.*after_superset/i);
    assert.match(plan.diff.join("\n"), /load instruction.*heaviest technically clean/i);
    assert.match(plan.diff.join("\n"), /tempo.*3-1-1/i);
    assert.match(plan.diff.join("\n"), /set 1.*notes.*final rep smooth/i);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", created.id), versionsBefore);
    assert.equal((await first("SELECT current_version_id AS currentVersionId FROM routines WHERE id = ?", created.id))?.currentVersionId, created.currentVersionId);
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_messages WHERE thread_id = ? AND role = 'user'", thread.id),
      1,
      "The review card should be staged from the initial request",
    );

    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, {
      method: "POST",
      body: { publish: false },
    }), 200);
    assert.equal(await count("SELECT COUNT(*) AS count FROM routine_versions WHERE routine_id = ?", created.id), versionsBefore + 1);
    assert.equal((await first("SELECT current_version_id AS currentVersionId FROM routines WHERE id = ?", created.id))?.currentVersionId, created.currentVersionId);
  });

  await context.test("stale update and archive plans cannot overwrite intervening changes", async () => {
    const updateTarget = await createExercise("Coach Stale Update Target");
    const proposedUpdate = fullExercise("Coach Approved Rename", {
      instructions: "Approved instructions.",
    });
    const updatePlan = await stageExercisePlan({
      action: "update",
      exercise: updateTarget,
      proposedExercise: proposedUpdate,
      summary: "Update the stale target",
    });
    assert.equal((await first("SELECT name FROM exercise_catalog WHERE id = ?", updateTarget.id))?.name, updateTarget.name);
    const interveningUpdate = assertStatus(await request(`/api/v1/exercises/${encodeURIComponent(updateTarget.id)}`, {
      method: "PATCH",
      body: { instructions: "Intervening owner edit." },
    }), 200).exercise;
    assert.notEqual(interveningUpdate.updatedAt, updateTarget.updatedAt);
    assertStatus(await request(`/api/v1/assistant/plans/${updatePlan.plan.id}/apply`, { method: "POST", body: {} }), 409);
    assert.equal((await first("SELECT status FROM assistant_exercise_change_plans WHERE id = ?", updatePlan.plan.id))?.status, "stale");
    const preservedUpdate = assertStatus(await request(`/api/v1/exercises/${encodeURIComponent(updateTarget.id)}`), 200).exercise;
    assert.equal(preservedUpdate.name, updateTarget.name);
    assert.equal(preservedUpdate.instructions, "Intervening owner edit.");

    const archiveTarget = await createExercise("Coach Stale Archive Target");
    const archivePlan = await stageExercisePlan({
      action: "archive",
      exercise: archiveTarget,
      proposedExercise: null,
      summary: "Archive the stale target",
    });
    const interveningArchiveEdit = assertStatus(await request(`/api/v1/exercises/${encodeURIComponent(archiveTarget.id)}`, {
      method: "PATCH",
      body: { instructions: "Keep this active after intervening edit." },
    }), 200).exercise;
    assert.notEqual(interveningArchiveEdit.updatedAt, archiveTarget.updatedAt);
    assertStatus(await request(`/api/v1/assistant/plans/${archivePlan.plan.id}/apply`, { method: "POST", body: {} }), 409);
    assert.equal((await first("SELECT status FROM assistant_exercise_change_plans WHERE id = ?", archivePlan.plan.id))?.status, "stale");
    assert.equal(assertStatus(await request(`/api/v1/exercises/${encodeURIComponent(archiveTarget.id)}`), 200).exercise.isActive, true);
  });

  await context.test("a create plan becomes stale when its name is claimed before Apply", async () => {
    const name = "Coach Name Conflict";
    const { plan } = await stageExercisePlan({
      action: "create",
      proposedExercise: fullExercise(name),
      summary: "Create the conflict exercise",
    });
    await createExercise(name);
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }), 409);
    assert.equal((await first("SELECT status FROM assistant_exercise_change_plans WHERE id = ?", plan.id))?.status, "stale");
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM exercise_catalog WHERE owner_email = ? AND normalized_name = ?", ownerEmail, name.toLowerCase()),
      1,
    );
  });

  await context.test("new active routine usage invalidates an already staged archive plan", async () => {
    const target = await createExercise("Coach Active Routine Archive Guard");
    const { plan } = await stageExercisePlan({
      action: "archive",
      exercise: target,
      proposedExercise: null,
      summary: "Archive the future routine exercise",
    });
    const routineResult = await request("/api/v1/routines", {
      method: "POST",
      body: { code: "COACH-GUARD", version: singleSetRoutine(target.id, "Archive guard") },
    });
    assertStatus(routineResult, 201);
    assertStatus(await request(`/api/v1/assistant/plans/${plan.id}/apply`, { method: "POST", body: {} }), 409);
    assert.equal((await first("SELECT status FROM assistant_exercise_change_plans WHERE id = ?", plan.id))?.status, "stale");
    assert.equal(assertStatus(await request(`/api/v1/exercises/${encodeURIComponent(target.id)}`), 200).exercise.isActive, true);
  });

  assert.equal(queuedResponses.length, 0);
  assert.ok(responseRequests.length >= 1);
  assert.ok(responseRequests.every((body) => body.parallel_tool_calls === false));
  assert.ok(responseRequests.some((body) => body.tool_choice === "none"), "A staged card should end tool use for that turn");
});
