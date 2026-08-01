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

test("Coach exercise-library plans require review and enforce owner, state, and revision boundaries", async (context) => {
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
    enqueueText(`Plan: ${summary}. I will wait for your approval.`);
    const presented = await sendMessage(thread.id, `Please ${summary.toLowerCase()}.`);
    assertStatus(presented, 201);
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_exercise_change_plans WHERE owner_email = ?", ownerEmail),
      plansBefore,
      "Presenting a plan must not stage or apply a write",
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
      rationale: `Approved integration-test ${action} plan.`,
    });
    enqueueText("The approved plan is staged for final review in the app.");
    const approved = await sendMessage(thread.id, "I approve that exact plan.");
    const payload = assertStatus(approved, 201);
    assert.equal(queuedResponses.length, 0, "Every queued model response should be consumed");
    const plan = payload.plans.find((candidate) => (
      candidate.kind === "exercise" && candidate.action === action && candidate.summary === summary
    ));
    assert.ok(plan, `A pending ${action} plan should be returned`);
    assert.equal(plan.status, "pending");
    return { thread, plan };
  }

  async function createExercise(name, overrides = {}) {
    const result = await request("/api/v1/exercises", {
      method: "POST",
      body: fullExercise(name, overrides),
    });
    return assertStatus(result, 201).exercise;
  }

  async function createOtherOwnerToken() {
    const otherEmail = "other@example.com";
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

    const otherToken = await createOtherOwnerToken();
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

  await context.test("Reject is terminal and never mutates the library", async () => {
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
});
