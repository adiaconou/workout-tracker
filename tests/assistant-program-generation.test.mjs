import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const ownerEmail = "program-generator@example.com";

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
  const queuedResponses = [];
  const responseRequests = [];
  const miniflare = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-22",
    bindings: {
      OWNER_EMAIL: ownerEmail,
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
      if (url.pathname === "/v1/responses") {
        responseRequests.push(await request.json());
        const response = queuedResponses.shift();
        assert.ok(response, "A mocked program response should be queued");
        return Response.json(response);
      }
      return Response.json({ error: { message: `Unexpected request ${url.pathname}` } }, { status: 404 });
    },
  });
  context.after(() => miniflare.dispose());

  async function request(path, { method = "GET", body } = {}) {
    const headers = new Headers({ "oai-authenticated-user-email": ownerEmail });
    if (body !== undefined) headers.set("content-type", "application/json");
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

  const invalid = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    body: { ...generationRequest, routineCount: 3 },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "coach_program_generation_invalid");
  assert.equal(responseRequests.length, 0);

  const impossiblePriority = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    body: { ...generationRequest, selectedMuscleGroups: [unavailableMuscle] },
  });
  assert.equal(impossiblePriority.status, 409);
  assert.equal(impossiblePriority.body.error.code, "selected_muscles_unavailable");
  assert.match(impossiblePriority.body.error.message, new RegExp(unavailableMuscle, "i"));
  assert.equal(responseRequests.length, 0);

  queuedResponses.push({
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
  });
  const generated = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    body: generationRequest,
  });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.equal(generated.body.program.routines.length, 2);
  assert.deepEqual(generated.body.program.routines.map((routine) => routine.code), ["GEN-A", "GEN-B"]);
  assert.equal(queuedResponses.length, 0);
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
  assert.equal(outbound.store, false);
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

  queuedResponses.push({
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
  });
  const rejectedDuration = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    body: generationRequest,
  });
  assert.equal(rejectedDuration.status, 502);
  assert.equal(rejectedDuration.body.error.code, "coach_program_generation_failed");
  assert.equal(rejectedDuration.body.error.retryable, true);
  assert.match(rejectedDuration.body.error.message, /estimated at 1 minute.*within 9 minutes/i);

  queuedResponses.push({
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
  });
  const rejectedOutput = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    body: generationRequest,
  });
  assert.equal(rejectedOutput.status, 502);
  assert.equal(rejectedOutput.body.error.code, "coach_program_generation_failed");
  assert.equal(rejectedOutput.body.error.retryable, true);
  assert.match(rejectedOutput.body.error.message, /not available/i);

  await database.prepare("UPDATE exercise_catalog SET is_active = 0 WHERE owner_email = ?")
    .bind(ownerEmail)
    .run();
  const withoutLibrary = await request("/api/v1/assistant/programs/generate", {
    method: "POST",
    body: generationRequest,
  });
  assert.equal(withoutLibrary.status, 409);
  assert.equal(withoutLibrary.body.error.code, "exercise_library_empty");
  assert.equal(responseRequests.length, 3, "An empty library must not invoke program generation");
});
