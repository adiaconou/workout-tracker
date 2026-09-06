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
const allEquipment = [
  "bodyweight", "dumbbells", "bench", "kettlebells", "pull_up_station",
  "dip_station", "cable_machine", "ez_bar", "resistance_bands", "barbell",
];

const fullExercise = (name, overrides = {}) => ({
  name,
  equipment: "dumbbell",
  movementPattern: "carry",
  trackingType: "reps",
  defaultLoadType: "external",
  sideMode: "bilateral",
  weightSettings: null,
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

const routineProposalFromCurrent = (current, overrides = {}) => ({
  focus: current.focus,
  summary: current.summary,
  durationMin: current.durationMin,
  exercises: current.exercises.map((exercise) => ({
    sourceRoutineExerciseId: exercise.id,
    exerciseId: exercise.exerciseId,
    position: exercise.position,
    supersetGroup: exercise.supersetGroup,
    instructions: exercise.instructions,
    notes: exercise.notes,
    sets: exercise.sets.map((set) => ({
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
      restRule: set.restRule,
      loadInstruction: set.loadInstruction,
      sideMode: set.sideMode,
      tempo: set.tempo,
      notes: set.notes,
    })),
  })),
  ...overrides,
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

test("Coach review cards are single-approval and enforce owner, state, and revision boundaries", async (context) => {
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
  const queuedResponses = [];
  const storedResponses = new Map();
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
      if (url.pathname === "/v1/responses" && request.method === "POST") {
        responseRequests.push(await request.json());
        const next = queuedResponses.shift();
        assert.ok(next, "A mocked Responses API result should be queued");
        storedResponses.set(next.id, next);
        return Response.json(next);
      }
      if (url.pathname.startsWith("/v1/responses/") && request.method === "GET") {
        const responseId = decodeURIComponent(url.pathname.slice("/v1/responses/".length));
        const response = storedResponses.get(responseId);
        assert.ok(response, `A mocked Responses API result should exist for ${responseId}`);
        return Response.json(response);
      }
      if (url.pathname.startsWith("/v1/responses/") && request.method === "DELETE") {
        const responseId = decodeURIComponent(url.pathname.slice("/v1/responses/".length));
        storedResponses.delete(responseId);
        return Response.json({ id: responseId, deleted: true });
      }
      if (url.pathname.endsWith("/cancel") && request.method === "POST") {
        const responseId = decodeURIComponent(url.pathname
          .slice("/v1/responses/".length, -"/cancel".length));
        return Response.json({ id: responseId, status: "cancelled" });
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

  assertStatus(await request("/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: allEquipment, sessionDurationMin: 60 },
  }), 200);

  async function createThread() {
    const result = await request("/api/v1/assistant/threads", { method: "POST", body: {} });
    return assertStatus(result, 201).thread;
  }

  async function acceptMessage(threadId, content, idempotencyKey = `coach-message-${randomUUID()}`, messageDetails = {}) {
    return assertStatus(await request("/api/v1/assistant/messages", {
      method: "POST",
      headers: {
        ...ownerHeaders,
        "x-idempotency-key": idempotencyKey,
      },
      body: {
        threadId,
        content,
        model: "gpt-5.6-terra",
        reasoningEffort: "low",
        ...messageDetails,
      },
    }), 202);
  }

  async function driveMessageRun(accepted) {
    let latest = {
      run: accepted.run,
      assistantMessage: null,
      plans: accepted.plans,
    };
    for (let attempt = 0; attempt < 32 && !["succeeded", "failed", "expired"].includes(latest.run.status); attempt += 1) {
      latest = assertStatus(await request(
        `/api/v1/assistant/message-runs/${encodeURIComponent(latest.run.id)}/advance`,
        { method: "POST", body: {} },
      ), 200);
    }
    assert.equal(latest.run.status, "succeeded", JSON.stringify(latest));
    assert.ok(latest.assistantMessage, "A successful Coach run should persist an assistant message");
    return { ...accepted, ...latest };
  }

  async function sendMessage(threadId, content) {
    return driveMessageRun(await acceptMessage(threadId, content));
  }

  async function stageExercisePlan({ action, exercise = null, proposedExercise = null, summary }) {
    const thread = await createThread();
    const responseRequestsBefore = responseRequests.length;
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
    const payload = await sendMessage(thread.id, `Please ${summary.toLowerCase()}.`);
    assert.equal(
      responseRequests.length,
      responseRequestsBefore + 2,
      "A staged exercise card should finish without another model round",
    );
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
    const responseRequestsBefore = responseRequests.length;
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
    const payload = await sendMessage(thread.id, `Create a new ${focus} routine.`);
    assert.equal(
      responseRequests.length,
      responseRequestsBefore + 3,
      "A staged routine card should finish without another model round",
    );
    assert.equal(queuedResponses.length, 0, "Every queued model response should be consumed");
    assert.equal(
      payload.assistantMessage.content,
      "I prepared a new routine for review. Nothing has changed yet.",
    );
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

  async function setEquipment(equipment) {
    await database.prepare(`UPDATE app_users SET equipment_preferences_json = ?, updated_at = ?
      WHERE owner_email = ?`)
      .bind(JSON.stringify(equipment), new Date().toISOString(), ownerEmail)
      .run();
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

  await context.test("retrying an expired Coach run reuses its original user message", async () => {
    const thread = await createThread();
    enqueueText("This first response will expire before retrieval.");
    const accepted = await acceptMessage(thread.id, "Review this request after reconnecting.");
    const expiredAt = new Date(Date.now() - 1_000).toISOString();
    await database.prepare("UPDATE assistant_message_runs SET expires_at = ? WHERE id = ?")
      .bind(expiredAt, accepted.run.id)
      .run();

    enqueueText("The retried response completed.");
    const retried = assertStatus(await request(
      `/api/v1/assistant/message-runs/${encodeURIComponent(accepted.run.id)}/retry`,
      {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "x-idempotency-key": `coach-retry-${randomUUID()}`,
        },
        body: {},
      },
    ), 202);
    assert.equal(retried.run.userMessageId, accepted.run.userMessageId);
    const completed = await driveMessageRun(retried);
    assert.equal(completed.assistantMessage.content, "The retried response completed.");
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_messages WHERE thread_id = ? AND role = 'user'", thread.id),
      1,
    );
  });

  await context.test("equipment constraints filter Coach discovery and are rechecked at stage and Apply", async () => {
    assertStatus(await request("/api/v1/assistant/profile", {
      method: "PATCH",
      body: { sessionDurationMin: 90 },
    }), 400);
    assertStatus(await request("/api/v1/assistant/profile", {
      method: "PATCH",
      body: { equipment: "Cable machine" },
    }), 400);

    assertStatus(await request("/api/v1/exercises?scope=all"), 200);
    const unavailable = await first(`SELECT id, name FROM exercise_catalog
      WHERE owner_email = ? AND name = 'Flat dumbbell bench press'`, ownerEmail);
    assert.ok(unavailable);
    await setEquipment(["bodyweight"]);

    const searchThread = await createThread();
    enqueueTool("search_exercises", { query: "Flat dumbbell bench press", includeArchived: false });
    enqueueText("That exercise is unavailable with your selected equipment.");
    const searchReply = await sendMessage(
      searchThread.id,
      "Can I use a flat dumbbell bench press?",
    );
    assert.deepEqual(searchReply.assistantMessage.activities, [
      { name: "search_exercises", status: "succeeded" },
    ]);
    const reloadedSearchThread = assertStatus(
      await request(`/api/v1/assistant?threadId=${encodeURIComponent(searchThread.id)}`),
      200,
    );
    assert.deepEqual(
      reloadedSearchThread.messages.find((message) => message.id === searchReply.assistantMessage.id)?.activities,
      [{ name: "search_exercises", status: "succeeded" }],
      "Human-readable activity metadata should survive a thread reload",
    );
    const searchAudit = await first(`SELECT output_json AS outputJson FROM assistant_tool_calls
      WHERE thread_id = ? AND tool_name = 'search_exercises' ORDER BY created_at DESC LIMIT 1`, searchThread.id);
    assert.deepEqual(JSON.parse(searchAudit.outputJson).exercises, []);

    const routinePlansBefore = await count(
      "SELECT COUNT(*) AS count FROM assistant_change_plans WHERE owner_email = ?",
      ownerEmail,
    );
    const rejectedRoutineThread = await createThread();
    enqueueTool("search_exercises", { query: unavailable.name, includeArchived: false });
    enqueueTool("propose_new_routine", {
      routineCode: "NO-BENCH",
      proposedRoutine: newRoutineProposal(unavailable.id, "Unavailable bench routine"),
      summary: "Create an unavailable routine",
      rationale: "Exercise equipment-policy staging test.",
    });
    enqueueText("I cannot stage that routine with the selected equipment.");
    await sendMessage(rejectedRoutineThread.id, "Create that bench routine.");
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_change_plans WHERE owner_email = ?", ownerEmail),
      routinePlansBefore,
    );
    assert.equal((await first(`SELECT status FROM assistant_tool_calls WHERE thread_id = ?
      AND tool_name = 'propose_new_routine' ORDER BY created_at DESC LIMIT 1`, rejectedRoutineThread.id)).status, "failed");

    const exercisePlansBefore = await count(
      "SELECT COUNT(*) AS count FROM assistant_exercise_change_plans WHERE owner_email = ?",
      ownerEmail,
    );
    const rejectedExerciseThread = await createThread();
    const cableExercise = fullExercise("Unavailable Coach Cable Row", { equipment: "low_cable" });
    enqueueTool("search_exercises", { query: cableExercise.name, includeArchived: true });
    enqueueTool("propose_exercise_change", {
      action: "create",
      exerciseId: null,
      baseUpdatedAt: null,
      proposedExercise: cableExercise,
      summary: "Create an unavailable cable exercise",
      rationale: "Exercise equipment-policy staging test.",
    });
    enqueueText("I cannot stage that exercise with the selected equipment.");
    await sendMessage(rejectedExerciseThread.id, "Add that cable exercise.");
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_exercise_change_plans WHERE owner_email = ?", ownerEmail),
      exercisePlansBefore,
    );

    await setEquipment(allEquipment);
    const routineApplyPlan = await stageRoutineCreation({
      code: "EQUIPMENT-STALE",
      exercise: unavailable,
      focus: "Equipment recheck",
    });
    const exerciseApplyPlan = await stageExercisePlan({
      action: "create",
      proposedExercise: fullExercise("Coach Equipment Recheck Curl"),
      summary: "Create the equipment-recheck curl",
    });
    await setEquipment(["bodyweight"]);
    assertStatus(await request(`/api/v1/assistant/plans/${routineApplyPlan.plan.id}/apply`, {
      method: "POST",
      body: {},
    }), 409);
    assertStatus(await request(`/api/v1/assistant/plans/${exerciseApplyPlan.plan.id}/apply`, {
      method: "POST",
      body: {},
    }), 409);
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", routineApplyPlan.plan.id)).status, "stale");
    assert.equal((await first("SELECT status FROM assistant_exercise_change_plans WHERE id = ?", exerciseApplyPlan.plan.id)).status, "stale");

    await setEquipment(allEquipment);
    const legacyCable = await createExercise("Coach Existing Cable Exercise", { equipment: "low_cable" });
    const createdRoutine = assertStatus(await request("/api/v1/routines", {
      method: "POST",
      body: { code: "LEGACY-CABLE", version: singleSetRoutine(legacyCable.id, "Legacy cable") },
    }), 201).routine;
    await setEquipment(["bodyweight"]);
    const preservedProposal = routineProposalFromCurrent(createdRoutine.currentVersion, {
      summary: "Keep the existing unavailable placement unchanged.",
    });
    const preservedThread = await createThread();
    enqueueTool("get_routine", { routineId: createdRoutine.id });
    enqueueTool("propose_routine_change", {
      routineId: createdRoutine.id,
      baseVersionId: createdRoutine.currentVersionId,
      proposedRoutine: preservedProposal,
      summary: "Keep the legacy cable placement",
      rationale: "Preserve existing data while changing only the routine summary.",
    });
    const preserved = await sendMessage(preservedThread.id, "Update only the routine summary.");
    assert.equal(
      preserved.assistantMessage.content,
      "I prepared a routine change for review. Nothing has changed yet.",
    );
    const preservedPlan = preserved.plans.find((candidate) => candidate.kind === "routine" && candidate.routineCode === "LEGACY-CABLE");
    assert.ok(preservedPlan);
    assertStatus(await request(`/api/v1/assistant/plans/${preservedPlan.id}/apply`, { method: "POST", body: {} }), 200);

    const refreshed = assertStatus(await request("/api/v1/routines/LEGACY-CABLE/editor"), 200).routine;
    const duplicateProposal = routineProposalFromCurrent(refreshed.currentVersion);
    duplicateProposal.exercises.push({
      ...duplicateProposal.exercises[0],
      sourceRoutineExerciseId: null,
      position: 2,
      sets: duplicateProposal.exercises[0].sets.map((set) => ({ ...set, sourceRoutineSetId: null })),
    });
    const plansBeforeDuplicate = await count(
      "SELECT COUNT(*) AS count FROM assistant_change_plans WHERE owner_email = ?",
      ownerEmail,
    );
    const duplicateThread = await createThread();
    enqueueTool("get_routine", { routineId: refreshed.id });
    enqueueTool("propose_routine_change", {
      routineId: refreshed.id,
      baseVersionId: refreshed.currentVersionId,
      proposedRoutine: duplicateProposal,
      summary: "Duplicate the cable placement",
      rationale: "Routine equipment-policy staging test.",
    });
    enqueueText("I cannot add another unavailable cable placement.");
    await sendMessage(duplicateThread.id, "Add another cable placement.");
    assert.equal(
      await count("SELECT COUNT(*) AS count FROM assistant_change_plans WHERE owner_email = ?", ownerEmail),
      plansBeforeDuplicate,
    );

    await setEquipment(allEquipment);
  });

  await context.test("identical pending routine creation reuses the nullable-base proposal", async () => {
    const exercise = await createExercise("Coach Reusable New Routine Carry");
    const staged = await stageRoutineCreation({
      code: "COACH-REUSE-NEW",
      exercise,
      focus: "Reusable new routine",
    });

    enqueueTool("get_coaching_context", {});
    enqueueTool("search_exercises", { query: exercise.name, includeArchived: false });
    enqueueTool("propose_new_routine", {
      routineCode: "COACH-REUSE-NEW",
      proposedRoutine: staged.proposedRoutine,
      summary: "Phrase the same new routine differently",
      rationale: "The normalized routine itself is unchanged.",
    });
    const replay = await sendMessage(
      staged.thread.id,
      "Prepare that exact new routine again.",
    );
    const replayPlan = replay.plans.find((candidate) => (
      candidate.kind === "routine"
      && candidate.action === "create"
      && candidate.routineCode === "COACH-REUSE-NEW"
    ));

    assert.ok(replayPlan);
    assert.equal(replayPlan.id, staged.plan.id);
    assert.equal(
      await count(`SELECT COUNT(*) AS count FROM assistant_change_plans
        WHERE owner_email = ? AND thread_id = ? AND routine_code = ?
          AND base_version_id IS NULL AND status = 'pending'`,
      ownerEmail, staged.thread.id, "COACH-REUSE-NEW"),
      1,
    );
  });

  await context.test("routine update reuse requires exact proposed input and thread", async () => {
    const exercise = await createExercise("Coach Exact Proposal Carry");
    const created = assertStatus(await request("/api/v1/routines", {
      method: "POST",
      body: { code: "COACH-REUSE", version: singleSetRoutine(exercise.id, "Proposal reuse") },
    }), 201).routine;
    const thread = await createThread();
    const firstProposal = routineProposalFromCurrent(created.currentVersion, {
      summary: "First exact proposed routine summary.",
    });

    async function sendRoutineProposal(targetThread, proposedRoutine, summary) {
      enqueueTool("get_routine", { routineId: created.id });
      enqueueTool("propose_routine_change", {
        routineId: created.id,
        baseVersionId: created.currentVersionId,
        proposedRoutine,
        summary,
        rationale: "Exact pending routine-proposal reuse coverage.",
      });
      return sendMessage(targetThread.id, "Prepare this routine proposal for review.");
    }

    const firstPayload = await sendRoutineProposal(
      thread,
      firstProposal,
      "Prepare the first exact routine change",
    );
    const firstPlan = firstPayload.plans.find((candidate) => (
      candidate.kind === "routine" && candidate.routineCode === "COACH-REUSE"
    ));
    assert.ok(firstPlan);

    const replayPayload = await sendRoutineProposal(
      thread,
      firstProposal,
      "Describe the same exact routine change differently",
    );
    const replayPlan = replayPayload.plans.find((candidate) => (
      candidate.kind === "routine" && candidate.routineCode === "COACH-REUSE"
    ));
    assert.ok(replayPlan);
    assert.equal(replayPlan.id, firstPlan.id);
    assert.equal(
      await count(`SELECT COUNT(*) AS count FROM assistant_change_plans
        WHERE owner_email = ? AND thread_id = ? AND routine_code = ?
          AND status = 'pending'`,
      ownerEmail, thread.id, "COACH-REUSE"),
      1,
    );

    const distinctProposal = {
      ...firstProposal,
      summary: "A materially different proposed routine summary.",
    };
    const distinctPayload = await sendRoutineProposal(
      thread,
      distinctProposal,
      "Prepare a materially different routine change",
    );
    const distinctPlan = distinctPayload.plans.find((candidate) => (
      candidate.kind === "routine"
      && candidate.routineCode === "COACH-REUSE"
      && candidate.id !== firstPlan.id
    ));
    assert.ok(distinctPlan, "Different normalized routine input must create another plan");
    assert.equal(
      await count(`SELECT COUNT(*) AS count FROM assistant_change_plans
        WHERE owner_email = ? AND thread_id = ? AND routine_code = ?
          AND status = 'pending'`,
      ownerEmail, thread.id, "COACH-REUSE"),
      2,
    );

    const otherThread = await createThread();
    const otherThreadPayload = await sendRoutineProposal(
      otherThread,
      firstProposal,
      "Prepare the same routine change in another conversation",
    );
    const otherThreadPlan = otherThreadPayload.plans.find((candidate) => (
      candidate.kind === "routine" && candidate.routineCode === "COACH-REUSE"
    ));
    assert.ok(otherThreadPlan);
    assert.notEqual(otherThreadPlan.id, firstPlan.id);
  });

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
    assert.match(plan.diff.join("\n"), /Create routine with code COACH-NEW/i);
    assert.match(plan.diff.join("\n"), /Add exercise: Coach New Routine Exercise/i);
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
    const staged = await sendMessage(thread.id, "Update this routine exactly as requested.");
    assert.equal(
      staged.assistantMessage.content,
      "I prepared a routine change for review. Nothing has changed yet.",
    );
    const plan = staged.plans.find((candidate) => candidate.kind === "routine" && candidate.routineCode === "COACH-REVIEW");
    assert.ok(plan);
    assert.equal(plan.status, "pending");
    assert.match(plan.diff.join("\n"), /Routine summary.*Assistant exercise-plan integration test.*Exact review-card coverage/i);
    assert.match(plan.diff.join("\n"), /Instructions:.*controlled three-second/i);
    assert.match(plan.diff.join("\n"), /Superset group: Not set → A/i);
    assert.match(plan.diff.join("\n"), /Rest timing: Standard → After superset/i);
    assert.match(plan.diff.join("\n"), /Load guidance:.*heaviest technically clean/i);
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

  await context.test("screen targets and time zones are saved, owner checked, and bound to send keys", async () => {
    const exercise = await createExercise("Coach context target");
    const thread = await createThread();
    const key = `coach-context-${randomUUID()}`;
    const details = { context: { target: { kind: "exercise", exerciseId: exercise.id } }, timeZone: "America/Los_Angeles" };
    enqueueText("I can see the selected exercise.");
    const accepted = await acceptMessage(thread.id, "Explain this exercise", key, details);
    const saved = await first("SELECT context_json, time_zone FROM assistant_messages WHERE id = ?", accepted.run.userMessageId);
    assert.deepEqual(JSON.parse(saved.context_json), details.context);
    assert.equal(saved.time_zone, details.timeZone);
    assert.equal((await acceptMessage(thread.id, "Explain this exercise", key, details)).run.id, accepted.run.id);
    assertStatus(await request("/api/v1/assistant/messages", {
      method: "POST", headers: { ...ownerHeaders, "x-idempotency-key": key },
      body: { threadId: thread.id, content: "Explain this exercise", model: "gpt-5.6-terra", reasoningEffort: "low", context: {}, timeZone: details.timeZone },
    }), 409);
    await driveMessageRun(accepted);
    assertStatus(await request("/api/v1/assistant/messages", {
      method: "POST", headers: { ...ownerHeaders, "x-idempotency-key": `target-missing-${randomUUID()}` },
      body: { threadId: thread.id, content: "Explain this", context: { target: { kind: "exercise", exerciseId: "not-owned" } } },
    }), 400);
  });

  await context.test("precise edits preserve prescriptions and revisions supersede only after validation", async () => {
    const exercise = await createExercise("Coach precise edit");
    const routine = assertStatus(await request("/api/v1/routines", {
      method: "POST", body: { code: "PRECISE", version: singleSetRoutine(exercise.id, "Precise edit") },
    }), 201).routine;
    const thread = await createThread();
    const current = routine.currentVersion;
    const edit = (seconds) => ({ routineId: routine.id, baseVersionId: current.id,
      operations: [{ type: "set_rest", placementId: current.exercises[0].id,
        setIds: [current.exercises[0].sets[0].id], seconds }],
      summary: `Rest for ${seconds} seconds`, rationale: "Adjust only the requested rest." });
    enqueueTool("propose_routine_edit", edit(75));
    const firstRun = await sendMessage(thread.id, "Set the rest to 75 seconds");
    const firstPlan = firstRun.plans.find((plan) => plan.status === "pending");
    assert.ok(firstPlan);
    assert.equal(firstPlan.originRunId, firstRun.run.id);
    assert.equal(firstPlan.originUserMessageId, firstRun.run.userMessageId);
    const unchanged = assertStatus(await request("/api/v1/routines/PRECISE/editor"), 200).routine;
    assert.equal(unchanged.currentVersion.id, current.id);
    assert.equal(unchanged.currentVersion.exercises[0].sets[0].restAfterSec, 90);
    const details = { context: { revisePlanId: firstPlan.id } };
    enqueueTool("propose_routine_edit", { ...edit(60), baseVersionId: "stale-version" });
    enqueueText("The routine version changed; the earlier review remains available.");
    await driveMessageRun(await acceptMessage(thread.id, "Actually use 60 seconds", `revision-failed-${randomUUID()}`, details));
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", firstPlan.id)).status, "pending");
    enqueueTool("get_plan", { planId: firstPlan.id });
    enqueueTool("propose_routine_edit", edit(60));
    const revised = await driveMessageRun(await acceptMessage(thread.id, "Use 60 seconds", `revision-ok-${randomUUID()}`, details));
    const replacement = revised.plans.find((plan) => plan.supersedesPlanId === firstPlan.id);
    assert.ok(replacement);
    assert.equal(revised.plans.find((plan) => plan.id === firstPlan.id).status, "superseded");
    assertStatus(await request(`/api/v1/assistant/plans/${firstPlan.id}/apply`, { method: "POST", body: {} }), 409);
    assertStatus(await request(`/api/v1/assistant/plans/${replacement.id}/apply`, { method: "POST", body: { publish: false } }), 200);
    const bootstrap = assertStatus(await request(`/api/v1/assistant?threadId=${thread.id}`), 200);
    const receipt = bootstrap.plans.find((plan) => plan.id === replacement.id);
    assert.equal(receipt.status, "applied");
    assert.equal(receipt.appliedAs, "draft");
    assert.equal(assertStatus(await request("/api/v1/routines/PRECISE/editor"), 200).routine.currentVersion.id, current.id);
  });

  await context.test("a routine batch is all-or-nothing at staging and has independent approvals", async () => {
    const exercise = await createExercise("Coach batch exercise");
    const thread = await createThread();
    const proposal = (code) => ({ action: "create", routineId: null, baseVersionId: null, routineCode: code,
      proposedRoutine: newRoutineProposal(exercise.id, `Batch ${code}`), summary: `Create ${code}`, rationale: "Separate program days." });
    const before = await count("SELECT COUNT(*) AS count FROM assistant_change_plans WHERE thread_id = ?", thread.id);
    enqueueTool("propose_routine_changes", { proposals: [proposal("BATCH-A"), { ...proposal("BATCH-B"), proposedRoutine: { invalid: true } }] });
    enqueueText("One routine was invalid, so no cards were prepared.");
    await sendMessage(thread.id, "Create both routines");
    assert.equal(await count("SELECT COUNT(*) AS count FROM assistant_change_plans WHERE thread_id = ?", thread.id), before);
    enqueueTool("propose_routine_changes", { proposals: [proposal("BATCH-A"), proposal("BATCH-B")] });
    const staged = await sendMessage(thread.id, "Create the two complete routines");
    const plans = staged.plans.filter((plan) => plan.status === "pending");
    assert.equal(plans.length, 2);
    assert.match(staged.assistantMessage.content, /2 routine proposals/);
    assert.ok(plans.every((plan) => plan.originRunId === staged.run.id));
    assertStatus(await request(`/api/v1/assistant/plans/${plans[0].id}/apply`, { method: "POST", body: {} }), 200);
    assert.equal((await first("SELECT status, applied_as FROM assistant_change_plans WHERE id = ?", plans[0].id)).applied_as, "published");
    assert.equal((await first("SELECT status FROM assistant_change_plans WHERE id = ?", plans[1].id)).status, "pending");
  });

  for (const outcome of ["succeeded", "failed", "malformed", "save-failed"]) {
    await context.test("conversation summary " + outcome + " preserves archive and latest request", async (summaryTest) => {
      const thread = await createThread();
      if (outcome === "save-failed") {
        await database.prepare(`CREATE TRIGGER coach_summary_save_failure
          BEFORE UPDATE OF context_summary_json ON assistant_threads WHEN OLD.id = '${thread.id}'
          BEGIN SELECT RAISE(ABORT, 'simulated summary save failure'); END`).run();
        summaryTest.after(() => database.prepare("DROP TRIGGER IF EXISTS coach_summary_save_failure").run());
      }
      const seeded = Array.from({ length: 12 }, (_, index) => ({
        id: "summary-" + outcome + "-" + index + "-" + randomUUID(),
        role: index % 2 === 0 ? "user" : "assistant",
        content: (index === 0 ? "I prefer shorter training sessions. " : "Earlier turn " + index + ". ") + "Earlier training detail. ".repeat(155),
        createdAt: new Date(Date.now() - 60_000 + index * 1_000).toISOString(),
      }));
      await database.batch(seeded.map((message) => database.prepare(
        "INSERT INTO assistant_messages (id, owner_email, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(message.id, ownerEmail, thread.id, message.role, message.content, message.createdAt)));
      const archive = async () => (await database.prepare(
        "SELECT id, role, content, created_at AS createdAt FROM assistant_messages WHERE owner_email = ? AND thread_id = ? ORDER BY created_at, id",
      ).bind(ownerEmail, thread.id).all()).results;
      const archiveBefore = await archive();
      const summary = { version: 1, goals: [{ text: "The user prefers shorter training sessions.", sourceMessageIds: [seeded[0].id] }], constraints: [], decisions: [], openQuestions: [] };
      const requestsBefore = responseRequests.length;
      if (outcome === "failed") {
        responseSequence += 1;
        queuedResponses.push({ id: "response-" + responseSequence, status: "failed", output: [], error: { code: "server_error", message: "Summary generation failed." } });
      } else enqueueText(outcome === "malformed" ? "This is not valid JSON." : JSON.stringify(summary));
      enqueueText("Coaching answer after " + outcome + " summary.");
      const content = "CURRENT REQUEST " + outcome + ": which routine should I use today?";
      const accepted = await acceptMessage(thread.id, content);
      assert.equal(accepted.run.phase, "summarizing");
      const summaryCall = responseRequests[requestsBefore];
      assert.deepEqual(summaryCall.tools, []);
      assert.equal(summaryCall.tool_choice, "none");
      assert.equal(summaryCall.text.format.type, "json_schema");
      const summaryRequest = JSON.parse(summaryCall.input[0].content);
      assert.ok(summaryRequest.messages.some((message) => message.id === seeded[0].id));
      assert.ok(summaryRequest.messages.every((message) => message.id !== accepted.run.userMessageId));
      assert.notEqual(summaryRequest.through.id, accepted.run.userMessageId);
      const planning = assertStatus(await request("/api/v1/assistant/message-runs/" + accepted.run.id + "/advance", { method: "POST", body: {} }), 200);
      assert.equal(planning.run.phase, "planning");
      assert.equal(planning.assistantMessage, null);
      const planningCall = responseRequests[requestsBefore + 1];
      assert.equal(planningCall.input.at(-1).role, "user");
      assert.equal(planningCall.input.at(-1).content, content);
      assert.ok(planningCall.input.some((message) => message.role === "assistant"), "Keep complete recent turns");
      const contextText = planningCall.input[0].content;
      const planningContext = JSON.parse(contextText.slice(contextText.indexOf("{")));
      const stored = await first("SELECT context_summary_json AS summaryJson, context_summary_through_message_id AS throughId FROM assistant_threads WHERE id = ? AND owner_email = ?", thread.id, ownerEmail);
      if (outcome === "succeeded" || outcome === "save-failed") {
        const acceptedSummary = { summary, through: summaryRequest.through };
        assert.deepEqual(planningContext.summary, acceptedSummary);
        assert.equal(planningContext.earlierContextIncomplete, false);
        if (outcome === "succeeded") {
          assert.deepEqual(JSON.parse(stored.summaryJson), acceptedSummary);
          assert.equal(stored.throughId, summaryRequest.through.id);
        } else {
          assert.equal(stored.summaryJson, null);
          assert.equal(stored.throughId, null);
        }
      } else {
        assert.equal(stored.summaryJson, null);
        assert.equal(stored.throughId, null);
        assert.equal(planningContext.summary, null);
        assert.equal(planningContext.earlierContextIncomplete, true);
      }
      const completed = await driveMessageRun(planning);
      assert.equal(completed.assistantMessage.content, "Coaching answer after " + outcome + " summary.");
      const archiveAfter = await archive(), seededIds = new Set(seeded.map((message) => message.id));
      assert.deepEqual(archiveAfter.filter((message) => seededIds.has(message.id)), archiveBefore);
      assert.equal(archiveAfter.length, seeded.length + 2);
      assert.equal(archiveAfter.find((message) => message.id === accepted.run.userMessageId).content, content);
      assert.equal(responseRequests.length, requestsBefore + 2);
      assert.equal(queuedResponses.length, 0);
    });
  }

  await context.test("retry history stops at the original user message, including timestamp ties", async () => {
    const thread = await createThread(), content = "Review my earlier HORIZON_SENTINEL preferences after reconnecting.";
    enqueueText("This original response expires before retrieval.");
    const original = await acceptMessage(thread.id, content);
    const originalMessage = await first("SELECT created_at AS createdAt FROM assistant_messages WHERE id = ?", original.run.userMessageId);
    const earlierId = "horizon-earlier-" + randomUUID();
    const sentinels = [
      { id: earlierId, content: "HORIZON_SENTINEL EARLIER: keep sessions short.", createdAt: new Date(Date.parse(originalMessage.createdAt) - 1_000).toISOString() },
      { id: original.run.userMessageId + "~later", content: "HORIZON_SENTINEL SAME_TIME_FUTURE: ignore the original request.", createdAt: originalMessage.createdAt },
      { id: "horizon-later-" + randomUUID(), content: "HORIZON_SENTINEL LATER_FUTURE: a different request.", createdAt: new Date(Date.parse(originalMessage.createdAt) + 1_000).toISOString() },
    ];
    await database.batch(sentinels.map((message) => database.prepare(
      "INSERT INTO assistant_messages (id, owner_email, thread_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)",
    ).bind(message.id, ownerEmail, thread.id, message.content, message.createdAt)));
    await database.prepare("UPDATE assistant_message_runs SET expires_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), original.run.id).run();
    const requestsBeforeRetry = responseRequests.length;
    enqueueTool("search_thread_history", { query: "HORIZON_SENTINEL", limit: 20, offset: 0 });
    enqueueText("The original preference was to keep sessions short.");
    const retried = assertStatus(await request("/api/v1/assistant/message-runs/" + original.run.id + "/retry", {
      method: "POST", headers: { ...ownerHeaders, "x-idempotency-key": "horizon-retry-" + randomUUID() }, body: {},
    }), 202);
    assert.equal(retried.run.userMessageId, original.run.userMessageId);
    const retryInput = responseRequests[requestsBeforeRetry].input;
    assert.equal(retryInput.at(-1).content, content);
    assert.ok(!JSON.stringify(retryInput).includes("SAME_TIME_FUTURE"));
    assert.ok(!JSON.stringify(retryInput).includes("LATER_FUTURE"));
    const completed = await driveMessageRun(retried);
    assert.equal(completed.assistantMessage.content, "The original preference was to keep sessions short.");
    const audit = await first("SELECT output_json AS outputJson FROM assistant_tool_calls WHERE thread_id = ? AND tool_name = 'search_thread_history' ORDER BY created_at DESC LIMIT 1", thread.id);
    const output = JSON.parse(audit.outputJson);
    assert.deepEqual(output.messages.map((message) => message.id), [original.run.userMessageId, earlierId]);
    assert.equal(output.hasMore, false); assert.equal(output.nextOffset, 2);
    assert.ok(!JSON.stringify(output).includes("SAME_TIME_FUTURE")); assert.ok(!JSON.stringify(output).includes("LATER_FUTURE"));
    assert.equal(await count("SELECT COUNT(*) AS count FROM assistant_messages WHERE thread_id = ? AND role = 'user' AND content = ?", thread.id, content), 1);
  });


  assert.equal(queuedResponses.length, 0);
  assert.ok(responseRequests.length >= 1);
  assert.ok(responseRequests.every((body) => body.parallel_tool_calls === false));
  assert.ok(responseRequests.every((body) => body.background === true && body.store === true));
  assert.ok(
    responseRequests.some((body) => typeof body.previous_response_id === "string"),
    "Tool output should continue through the saved background response chain",
  );
  assert.equal(storedResponses.size, 0, "Terminal Coach runs should clean up mocked background responses");
});
