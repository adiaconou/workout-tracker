import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const ownerEmail = "program-generator@example.com";
const otherEmail = "other-program-generator@example.com";

function generatedRoutine(exerciseId, code, focus, setCount = 20) {
  return {
    code,
    rationale: `${focus} supports the requested goal.`,
    version: {
      focus,
      summary: `${focus} session`,
      durationMin: 45,
      exercises: [{
        exerciseId,
        position: 1,
        supersetGroup: null,
        instructions: "Move with control.",
        notes: "",
        sets: Array.from({ length: setCount }, (_, index) => ({
          position: index + 1,
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
        })),
      }],
    },
  };
}

test("Coach program generation forces editable, equipment-safe routine output", async (context) => {
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
  const startResponses = [];
  const pollResponses = new Map();
  const cancelResponses = new Map();
  const responseRequests = [];
  const responsePolls = [];
  const responseCancellations = [];
  const miniflare = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-22",
    bindings: {
      ALLOWED_USER_EMAILS: `${ownerEmail},${otherEmail}`,
      AUTH_SESSION_SECRET: "program-generation-test-secret-2026",
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_DEFAULT_MODEL: "gpt-5.6-terra",
    },
    d1Databases: { DB: "assistant-program-generation-test" },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/models") {
        return Response.json({ data: [{ id: "gpt-5.6-terra", created: 1 }] });
      }
      if (url.pathname === "/v1/responses" && request.method === "POST") {
        responseRequests.push(await request.json());
        const response = await startResponses.shift();
        assert.ok(response, "A mocked program start response should be queued");
        return Response.json(response);
      }
      const cancelMatch = url.pathname.match(/^\/v1\/responses\/([^/]+)\/cancel$/u);
      if (cancelMatch && request.method === "POST") {
        const responseId = decodeURIComponent(cancelMatch[1]);
        responseCancellations.push(responseId);
        const response = cancelResponses.get(responseId)?.shift();
        assert.ok(response, `A mocked cancellation response should be queued for ${responseId}`);
        if (response.httpStatus) {
          return Response.json(response.body, { status: response.httpStatus });
        }
        return Response.json(response);
      }
      const pollMatch = url.pathname.match(/^\/v1\/responses\/([^/]+)$/u);
      if (pollMatch && request.method === "GET") {
        const responseId = decodeURIComponent(pollMatch[1]);
        responsePolls.push(responseId);
        const response = pollResponses.get(responseId)?.shift();
        assert.ok(response, `A mocked poll response should be queued for ${responseId}`);
        if (response.httpStatus) {
          return Response.json(response.body, { status: response.httpStatus });
        }
        return Response.json(response);
      }
      return Response.json({ error: { message: `Unexpected request ${url.pathname}` } }, { status: 404 });
    },
  });
  context.after(() => miniflare.dispose());

  async function request(path, {
    method = "GET",
    body,
    email = ownerEmail,
    idempotencyKey,
  } = {}) {
    const headers = new Headers({ "oai-authenticated-user-email": email });
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

  const onboarding = await request("/api/v1/onboarding", {
    method: "PUT",
    body: { equipment: ["bodyweight"], sessionDurationMin: 45 },
  });
  assert.equal(onboarding.status, 200, JSON.stringify(onboarding.body));
  const otherOnboarding = await request("/api/v1/onboarding", {
    method: "PUT",
    email: otherEmail,
    body: { equipment: ["bodyweight"], sessionDurationMin: 45 },
  });
  assert.equal(otherOnboarding.status, 200, JSON.stringify(otherOnboarding.body));
  const exerciseResult = await request("/api/v1/exercises");
  assert.equal(exerciseResult.status, 200, JSON.stringify(exerciseResult.body));
  const exercises = exerciseResult.body.exercises;
  assert.ok(exercises.length > 0);
  assert.ok(exercises.every((exercise) => exercise.isActive));
  const exerciseByMuscle = new Map();
  for (const exercise of exercises) {
    for (const muscle of exercise.muscles) {
      if (!exerciseByMuscle.has(muscle.muscleGroup)) {
        exerciseByMuscle.set(muscle.muscleGroup, exercise);
      }
    }
  }
  const selectedMuscles = [...exerciseByMuscle.keys()].slice(0, 2);
  assert.equal(selectedMuscles.length, 2, "The seeded bodyweight library should cover two muscle groups");
  const firstExerciseId = exerciseByMuscle.get(selectedMuscles[0]).id;
  const secondExerciseId = exerciseByMuscle.get(selectedMuscles[1]).id;
  const allMuscles = [
    "back", "chest", "shoulders", "biceps", "triceps", "quads",
    "hamstrings", "glutes", "calves", "core", "grip",
  ];
  const unavailableMuscle = allMuscles.find((muscle) => !exerciseByMuscle.has(muscle));
  assert.ok(unavailableMuscle, "A bodyweight-only library should leave a muscle priority unavailable");
  const database = await miniflare.getD1Database("DB");
  const stateBefore = {
    routines: Number((await database.prepare(
      "SELECT COUNT(*) AS count FROM routines WHERE owner_email = ?",
    ).bind(ownerEmail).first()).count),
    programs: Number((await database.prepare(
      "SELECT COUNT(*) AS count FROM routine_programs WHERE owner_email = ?",
    ).bind(ownerEmail).first()).count),
  };

  const generationRequest = {
    name: "Bodyweight strength",
    goal: "Build general strength",
    selectedMuscleGroups: selectedMuscles,
    trainingDaysPerWeek: 2,
    routineCount: 2,
    targetDurationMin: 45,
    experienceLevel: "beginner",
    avoid: "",
    limitations: "",
    preferences: "Simple sessions",
  };

  const missingKey = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    body: generationRequest,
  });
  assert.equal(missingKey.status, 400);
  assert.match(missingKey.body.error.message, /idempotency key is required/i);
  const shortKey = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "short",
    body: generationRequest,
  });
  assert.equal(shortKey.status, 400);
  assert.match(shortKey.body.error.message, /at least 8 characters/i);

  const invalid = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-invalid",
    body: { ...generationRequest, routineCount: 3 },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "coach_program_generation_invalid");
  assert.equal(responseRequests.length, 0);

  const impossiblePriority = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-impossible",
    body: { ...generationRequest, selectedMuscleGroups: [unavailableMuscle] },
  });
  assert.equal(impossiblePriority.status, 409);
  assert.equal(impossiblePriority.body.error.code, "selected_muscles_unavailable");
  assert.match(impossiblePriority.body.error.message, new RegExp(unavailableMuscle, "i"));
  assert.equal(responseRequests.length, 0);

  startResponses.push({
    id: "program-response-1",
    status: "queued",
  });
  const generated = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-success",
    body: generationRequest,
  });
  assert.equal(generated.status, 202, JSON.stringify(generated.body));
  assert.equal(generated.body.generation.status, "queued");
  assert.equal(generated.body.generation.program, null);
  assert.equal(generated.body.generation.pollAfterMs, 2_000);
  const generationId = generated.body.generation.id;
  assert.ok(generationId);
  assert.equal(startResponses.length, 0);
  const activeStoredContext = await (await miniflare.getD1Database("DB"))
    .prepare("SELECT request_json AS requestJson FROM assistant_program_generation_jobs WHERE id = ?")
    .bind(generationId)
    .first();
  assert.deepEqual(Object.keys(JSON.parse(activeStoredContext.requestJson).request).sort(), [
    "routineCount",
    "selectedMuscleGroups",
    "targetDurationMin",
  ]);
  assert.equal(activeStoredContext.requestJson.includes(generationRequest.goal), false);
  assert.equal(activeStoredContext.requestJson.includes(generationRequest.preferences), false);

  const replay = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-success",
    body: generationRequest,
  });
  assert.equal(replay.status, 202);
  assert.equal(replay.body.generation.id, generationId);
  assert.equal(responseRequests.length, 1, "An idempotent replay must not start another model response");

  const conflict = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-success",
    body: { ...generationRequest, goal: "A different goal" },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "coach_program_generation_idempotency_conflict");

  const foreignRead = await request(`/api/v1/assistant/program-generations/${generationId}`, {
    email: otherEmail,
  });
  assert.equal(foreignRead.status, 404);

  pollResponses.set("program-response-1", [
    { id: "program-response-1", status: "in_progress" },
    {
      id: "program-response-1",
      status: "completed",
      output: [{
        type: "function_call",
        call_id: "program-call-1",
        name: "return_routine_program",
        arguments: JSON.stringify({
          name: "Bodyweight strength",
          summary: "Two simple full-body sessions.",
          warnings: ["Workout duration is an estimate."],
          routines: [
            generatedRoutine(firstExerciseId, "GEN-A", "Foundation A"),
            generatedRoutine(secondExerciseId, "GEN-B", "Foundation B"),
          ],
        }),
      }],
    },
  ]);
  const running = await request(`/api/v1/assistant/program-generations/${generationId}`);
  assert.equal(running.status, 200);
  assert.equal(running.body.generation.status, "in_progress");
  const completed = await request(`/api/v1/assistant/program-generations/${generationId}`);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.generation.status, "succeeded");
  assert.equal(completed.body.generation.program.routines.length, 2);
  assert.deepEqual(
    completed.body.generation.program.routines.map((routine) => routine.code),
    ["GEN-A", "GEN-B"],
  );
  const terminalReplay = await request(`/api/v1/assistant/program-generations/${generationId}`);
  assert.equal(terminalReplay.body.generation.status, "succeeded");
  assert.equal(responsePolls.length, 2, "A terminal job must be served from D1 without polling OpenAI again");
  const storedGeneration = await database.prepare(`SELECT request_fingerprint AS requestFingerprint,
    request_json AS requestJson FROM assistant_program_generation_jobs WHERE id = ?`)
    .bind(generationId)
    .first();
  assert.match(storedGeneration.requestFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(storedGeneration.requestFingerprint.includes(generationRequest.goal), false);
  assert.equal(storedGeneration.requestJson, "{}", "Terminal jobs must scrub sensitive request text");
  await database.prepare("UPDATE assistant_program_generation_jobs SET expires_at = ? WHERE id = ?")
    .bind("2000-01-01T00:00:00.000Z", generationId)
    .run();
  const prunedTerminal = await request(`/api/v1/assistant/program-generations/${generationId}`);
  assert.equal(prunedTerminal.status, 404);
  assert.equal(
    await database.prepare("SELECT id FROM assistant_program_generation_jobs WHERE id = ?")
      .bind(generationId)
      .first(),
    null,
  );
  const stateAfter = {
    routines: Number((await database.prepare(
      "SELECT COUNT(*) AS count FROM routines WHERE owner_email = ?",
    ).bind(ownerEmail).first()).count),
    programs: Number((await database.prepare(
      "SELECT COUNT(*) AS count FROM routine_programs WHERE owner_email = ?",
    ).bind(ownerEmail).first()).count),
  };
  assert.deepEqual(stateAfter, stateBefore, "Generation must not persist routines or a program before review");

  const outbound = responseRequests[0];
  assert.deepEqual(outbound.tool_choice, { type: "function", name: "return_routine_program" });
  assert.equal(outbound.parallel_tool_calls, false);
  assert.equal(outbound.background, true);
  assert.equal(outbound.store, false);
  assert.deepEqual(outbound.reasoning, { effort: "low" });
  assert.deepEqual(outbound.text, { verbosity: "low" });
  assert.equal(outbound.metadata.program_generation_id, generationId);
  assert.equal(outbound.safety_identifier.length > 0, true);
  assert.equal(outbound.tools.length, 1);
  assert.equal(outbound.tools[0].name, "return_routine_program");
  assert.equal(outbound.tools[0].strict, true);
  assert.equal(outbound.tools[0].parameters.additionalProperties, false);
  assert.equal(outbound.tools[0].parameters.properties.routines.minItems, 2);
  assert.equal(outbound.tools[0].parameters.properties.routines.maxItems, 2);
  const exerciseIdSchema = outbound.tools[0].parameters.properties.routines.items
    .properties.version.properties.exercises.items.properties.exerciseId;
  assert.deepEqual(new Set(exerciseIdSchema.enum), new Set(exercises.map((exercise) => exercise.id)));
  const outboundContext = JSON.parse(outbound.input[0].content);
  assert.deepEqual(outboundContext.durationEstimatePolicy, {
    secondsPerRep: 4,
    secondsPerRound: 60,
    unilateralWorkMultiplier: 2,
    targetFraction: 0.2,
    minimumMinutes: 5,
    allowedDeltaMinutes: 9,
  });

  startResponses.push({
    id: "program-response-2",
    status: "queued",
  });
  pollResponses.set("program-response-2", [{
    id: "program-response-2",
    status: "completed",
    output: [{
      type: "function_call",
      call_id: "program-call-2",
      name: "return_routine_program",
      arguments: JSON.stringify({
        name: "Underbuilt output",
        summary: "One routine is much shorter than requested.",
        warnings: [],
        routines: [
          generatedRoutine(firstExerciseId, "GEN-C", "Short A", 1),
          generatedRoutine(secondExerciseId, "GEN-D", "Valid B"),
        ],
      }),
    }],
  }]);
  const rejectedDuration = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-duration",
    body: generationRequest,
  });
  assert.equal(rejectedDuration.status, 202);
  const rejectedDurationPoll = await request(
    `/api/v1/assistant/program-generations/${rejectedDuration.body.generation.id}`,
  );
  assert.equal(rejectedDurationPoll.status, 200);
  assert.equal(rejectedDurationPoll.body.generation.status, "failed");
  assert.equal(rejectedDurationPoll.body.generation.error.code, "coach_program_generation_failed");
  assert.equal(rejectedDurationPoll.body.generation.error.retryable, true);
  assert.match(
    rejectedDurationPoll.body.generation.error.message,
    /estimated at 1 minute.*within 9 minutes/i,
  );

  startResponses.push({
    id: "program-response-3",
    status: "queued",
  });
  pollResponses.set("program-response-3", [{
    id: "program-response-3",
    status: "completed",
    output: [{
      type: "function_call",
      call_id: "program-call-3",
      name: "return_routine_program",
      arguments: JSON.stringify({
        name: "Unsafe output",
        summary: "Includes an unavailable exercise ID.",
        warnings: [],
        routines: [
          generatedRoutine("invented-exercise", "GEN-C", "Invalid A"),
          generatedRoutine(secondExerciseId, "GEN-D", "Valid B"),
        ],
      }),
    }],
  }]);
  const rejectedOutput = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-output",
    body: generationRequest,
  });
  assert.equal(rejectedOutput.status, 202);
  const rejectedOutputPoll = await request(
    `/api/v1/assistant/program-generations/${rejectedOutput.body.generation.id}`,
  );
  assert.equal(rejectedOutputPoll.status, 200);
  assert.equal(rejectedOutputPoll.body.generation.status, "failed");
  assert.equal(rejectedOutputPoll.body.generation.error.code, "coach_program_generation_failed");
  assert.equal(rejectedOutputPoll.body.generation.error.retryable, true);
  assert.match(rejectedOutputPoll.body.generation.error.message, /not available/i);

  startResponses.push({ id: "program-response-4", status: "queued" });
  const cancellable = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-cancel",
    body: generationRequest,
  });
  assert.equal(cancellable.status, 202);
  const cancellableId = cancellable.body.generation.id;
  const foreignCancel = await request(
    `/api/v1/assistant/program-generations/${cancellableId}/cancel`,
    { method: "POST", email: otherEmail },
  );
  assert.equal(foreignCancel.status, 404);
  cancelResponses.set("program-response-4", [{
    id: "program-response-4",
    status: "cancelled",
  }]);
  const cancelled = await request(
    `/api/v1/assistant/program-generations/${cancellableId}/cancel`,
    { method: "POST" },
  );
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.generation.status, "cancelled");
  const cancelledAgain = await request(
    `/api/v1/assistant/program-generations/${cancellableId}/cancel`,
    { method: "POST" },
  );
  assert.equal(cancelledAgain.body.generation.status, "cancelled");
  assert.deepEqual(responseCancellations, ["program-response-4"]);

  let releaseRacingStart;
  const racingStartResponse = new Promise((resolve) => {
    releaseRacingStart = resolve;
  });
  const requestCountBeforeRace = responseRequests.length;
  startResponses.push(racingStartResponse);
  const racingStart = request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-cancel-race",
    body: generationRequest,
  });
  while (responseRequests.length === requestCountBeforeRace) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const racingGenerationId = responseRequests.at(-1).metadata.program_generation_id;
  const racingResponseId = "program-response-cancel-race";
  const cancellingBeforeAttach = await request(
    `/api/v1/assistant/program-generations/${racingGenerationId}/cancel`,
    { method: "POST" },
  );
  assert.equal(cancellingBeforeAttach.status, 200);
  assert.equal(cancellingBeforeAttach.body.generation.status, "cancelling");
  cancelResponses.set(racingResponseId, [{ id: racingResponseId, status: "cancelled" }]);
  releaseRacingStart({ id: racingResponseId, status: "queued" });
  const reconciledCancellation = await racingStart;
  assert.equal(reconciledCancellation.status, 202);
  assert.equal(reconciledCancellation.body.generation.status, "cancelled");
  assert.equal(responseCancellations.includes(racingResponseId), true);

  startResponses.push({ id: "program-response-5", status: "queued" });
  const reconnecting = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-reconnect",
    body: generationRequest,
  });
  pollResponses.set("program-response-5", [
    { httpStatus: 503, body: { error: { message: "Temporary upstream outage" } } },
    {
      id: "program-response-5",
      status: "completed",
      output: [{
        type: "function_call",
        call_id: "program-call-5",
        name: "return_routine_program",
        arguments: JSON.stringify({
          name: "Recovered program",
          summary: "Generation recovered after a transient polling error.",
          warnings: [],
          routines: [
            generatedRoutine(firstExerciseId, "GEN-E", "Recovered A"),
            generatedRoutine(secondExerciseId, "GEN-F", "Recovered B"),
          ],
        }),
      }],
    },
  ]);
  const transientPoll = await request(
    `/api/v1/assistant/program-generations/${reconnecting.body.generation.id}`,
  );
  assert.equal(transientPoll.status, 502);
  assert.equal(transientPoll.body.error.retryable, true);
  const recoveredPoll = await request(
    `/api/v1/assistant/program-generations/${reconnecting.body.generation.id}`,
  );
  assert.equal(recoveredPoll.status, 200);
  assert.equal(recoveredPoll.body.generation.status, "succeeded");

  startResponses.push({ id: "program-response-cancel-errors", status: "queued" });
  const cancellationErrors = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-cancel-errors",
    body: generationRequest,
  });
  cancelResponses.set("program-response-cancel-errors", [
    { httpStatus: 401, body: { error: { message: "Invalid API key" } } },
    { httpStatus: 404, body: { error: { message: "Response no longer retained" } } },
  ]);
  const rejectedCancellation = await request(
    `/api/v1/assistant/program-generations/${cancellationErrors.body.generation.id}/cancel`,
    { method: "POST" },
  );
  assert.equal(rejectedCancellation.status, 400);
  assert.equal(rejectedCancellation.body.error.code, "coach_program_generation_cancel_failed");
  assert.equal(
    (await database.prepare("SELECT status FROM assistant_program_generation_jobs WHERE id = ?")
      .bind(cancellationErrors.body.generation.id)
      .first()).status,
    "cancelling",
  );
  const missingRemoteCancellation = await request(
    `/api/v1/assistant/program-generations/${cancellationErrors.body.generation.id}/cancel`,
    { method: "POST" },
  );
  assert.equal(missingRemoteCancellation.status, 200);
  assert.equal(missingRemoteCancellation.body.generation.status, "cancelled");

  startResponses.push({ id: "program-response-missing", status: "queued" });
  const missingRemote = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-missing-remote",
    body: generationRequest,
  });
  pollResponses.set("program-response-missing", [{
    httpStatus: 404,
    body: { error: { message: "Response no longer retained" } },
  }]);
  cancelResponses.set("program-response-missing", [{
    httpStatus: 404,
    body: { error: { message: "Response no longer retained" } },
  }]);
  const missingRemotePoll = await request(
    `/api/v1/assistant/program-generations/${missingRemote.body.generation.id}`,
  );
  assert.equal(missingRemotePoll.status, 200);
  assert.equal(missingRemotePoll.body.generation.status, "expired");
  assert.equal(missingRemotePoll.body.generation.error.retryable, true);

  startResponses.push({ id: "program-response-6", status: "queued" });
  const expiring = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-expire",
    body: generationRequest,
  });
  await database.prepare(`UPDATE assistant_program_generation_jobs SET expires_at = ?
    WHERE id = ? AND owner_email = ?`)
    .bind("2000-01-01T00:00:00.000Z", expiring.body.generation.id, ownerEmail)
    .run();
  cancelResponses.set("program-response-6", [{ id: "program-response-6", status: "cancelled" }]);
  const pollsBeforeHardExpiry = responsePolls.length;
  const expired = await request(
    `/api/v1/assistant/program-generations/${expiring.body.generation.id}`,
  );
  assert.equal(expired.status, 200);
  assert.equal(expired.body.generation.status, "expired");
  assert.equal(expired.body.generation.error.code, "coach_program_generation_expired");
  assert.equal(responsePolls.length, pollsBeforeHardExpiry, "Hard expiry must precede remote polling");

  startResponses.push({ id: "program-response-stale-context", status: "queued" });
  pollResponses.set("program-response-stale-context", [{
    id: "program-response-stale-context",
    status: "completed",
    output: [{
      type: "function_call",
      call_id: "program-call-stale-context",
      name: "return_routine_program",
      arguments: JSON.stringify({
        name: "Context changed",
        summary: "The exercise library changed during generation.",
        warnings: [],
        routines: [
          generatedRoutine(firstExerciseId, "GEN-G", "Context A"),
          generatedRoutine(secondExerciseId, "GEN-H", "Context B"),
        ],
      }),
    }],
  }]);
  const staleContext = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-stale-context",
    body: generationRequest,
  });
  await database.prepare("UPDATE exercise_catalog SET is_active = 0 WHERE owner_email = ? AND id = ?")
    .bind(ownerEmail, firstExerciseId)
    .run();
  const staleContextPoll = await request(
    `/api/v1/assistant/program-generations/${staleContext.body.generation.id}`,
  );
  assert.equal(staleContextPoll.status, 200);
  assert.equal(staleContextPoll.body.generation.status, "failed");
  assert.equal(
    staleContextPoll.body.generation.error.code,
    "coach_program_generation_context_changed",
  );
  assert.match(staleContextPoll.body.generation.error.message, /changed.*fresh draft/i);
  await database.prepare("UPDATE exercise_catalog SET is_active = 1 WHERE owner_email = ? AND id = ?")
    .bind(ownerEmail, firstExerciseId)
    .run();

  const reusableFingerprint = (await database.prepare(`SELECT request_fingerprint AS fingerprint
    FROM assistant_program_generation_jobs WHERE owner_email = ? LIMIT 1`)
    .bind(ownerEmail)
    .first()).fingerprint;
  const staleStartingId = "stale-unattached-generation";
  const staleIdempotencyKey = "generation-stale-start";
  await database.prepare(`INSERT INTO assistant_program_generation_jobs (
    id, owner_email, idempotency_key, request_fingerprint, openai_response_id,
    status, request_json, result_json, error_code, error_message, error_retryable,
    created_at, updated_at, expires_at
  ) VALUES (?, ?, ?, ?, NULL, 'starting', ?, NULL, NULL, NULL, 0, ?, ?, ?)`)
    .bind(
      staleStartingId,
      ownerEmail,
      staleIdempotencyKey,
      reusableFingerprint,
      JSON.stringify(generationRequest),
      "2026-08-09T00:00:00.000Z",
      "2026-08-09T00:00:00.000Z",
      "2099-01-01T00:00:00.000Z",
    )
    .run();
  const staleStarting = await request(`/api/v1/assistant/program-generations/${staleStartingId}`);
  assert.equal(staleStarting.status, 200);
  assert.equal(staleStarting.body.generation.status, "failed");
  assert.equal(staleStarting.body.generation.error.code, "coach_program_generation_start_lost");
  const requestCountBeforeStaleReplay = responseRequests.length;
  const staleStartingReplay = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: staleIdempotencyKey,
    body: generationRequest,
  });
  assert.equal(staleStartingReplay.status, 202);
  assert.equal(staleStartingReplay.body.generation.status, "failed");
  assert.equal(responseRequests.length, requestCountBeforeStaleReplay);

  await database.prepare("UPDATE exercise_catalog SET is_active = 0 WHERE owner_email = ?")
    .bind(ownerEmail)
    .run();
  const withoutLibrary = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    idempotencyKey: "generation-empty-library",
    body: generationRequest,
  });
  assert.equal(withoutLibrary.status, 409);
  assert.equal(withoutLibrary.body.error.code, "exercise_library_empty");
  assert.equal(responseRequests.length, 10, "An empty library must not invoke program generation");
});
