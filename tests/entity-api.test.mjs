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
  assert.match(api, /routine_editor_required/);
  assert.doesNotMatch(api, /updateRoutine\(/);
  assert.match(api, /handleWorkouts/);
  assert.match(api, /createVersion/);
  assert.match(api, /publish/);
  assert.match(api, /correctSet/);
  assert.match(api, /completeWorkoutEarly/);
  assert.match(api, /child === "complete"/);
  assert.match(api, /child === "discard"/);
  assert.match(api, /service\.discard/);
  assert.match(api, /workout_not_in_progress/);
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
  assert.match(repository, /discardWorkout/);
  assert.match(repository, /DELETE FROM workout_sessions/);
  assert.match(repository, /status = 'In Progress'/);
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
  assert.match(store, /workout_history\.completed_at AS lastWorkoutAt/);
  assert.match(store, /average_duration_seconds AS averageDurationSeconds/);
  assert.match(store, /duration_sample_count AS durationSampleCount/);
  assert.match(store, /MAX\(completed_at\) AS completed_at/);
  assert.match(store, /status IN \('Completed', 'Partial'\)/);
});

test("runs an owner-scoped coaching assistant with strict review cards and user-controlled writes", async () => {
  const [api, assistant, toolLoop, models, types, schema, coachScreen, repository] = await Promise.all([
    readFile(new URL("server/api.ts", root), "utf8"),
    readFile(new URL("server/assistant.ts", root), "utf8"),
    readFile(new URL("server/coach-tool-loop.ts", root), "utf8"),
    readFile(new URL("server/assistant-models.ts", root), "utf8"),
    readFile(new URL("server/types.ts", root), "utf8"),
    readFile(new URL("infrastructure/d1/entity-schema.ts", root), "utf8"),
    readFile(new URL("src/features/coach/coach-screen.tsx", root), "utf8"),
    readFile(new URL("infrastructure/d1/entity-repository.ts", root), "utf8"),
  ]);

  assert.match(api, /handleAssistantRequest/);
  assert.match(assistant, /\/models/);
  assert.match(assistant, /\/responses/);
  assert.match(assistant, /parallel_tool_calls: false/);
  assert.match(assistant, /tool_choice: input\.toolChoice/);
  assert.match(assistant, /assistantReasoningOutputTokenBudget = 25_000/);
  assert.match(assistant, /max_output_tokens: outputTokenBudget\(input\.model\)/);
  assert.match(assistant, /listMessages\(env, user\.email, thread\.id, 50\)/);
  assert.doesNotMatch(assistant, /turn\s*<\s*6/);
  assert.doesNotMatch(assistant, /reached its tool-call limit/);
  assert.match(toolLoop, /while \(true\)/);
  assert.match(toolLoop, /defaultCoachRunDurationMs = 4 \* 60_000/);
  assert.match(toolLoop, /canonicalJson/);
  assert.match(toolLoop, /repeatedCallCount >= repeatedCallLimit/);
  assert.match(toolLoop, /proposalStaged = true/);
  assert.match(toolLoop, /forceFinalResponse = true/);
  assert.match(assistant, /isProposalTool: \(name\) => \["propose_routine_change", "propose_exercise_change"\]\.includes\(name\)/);
  assert.match(toolLoop, /forceFinalResponse \? "none" : "auto"/);
  assert.match(toolLoop, /response\.status === "incomplete"/);
  assert.match(toolLoop, /response\.status !== "completed"/);
  assert.match(toolLoop, /reason === "max_output_tokens"/);
  assert.match(assistant, /strict: true/);
  assert.match(assistant, /propose_routine_change/);
  assert.match(assistant, /Change review policy \(always follow this policy\)/);
  assert.match(assistant, /read-only tools to inspect and verify/);
  assert.match(assistant, /do not repeat an identical tool call unless the underlying data could have changed/);
  assert.match(assistant, /review-staging tools/);
  assert.match(assistant, /stage the matching review card in that same turn/);
  assert.match(assistant, /Do not ask for verbal approval before staging it/);
  assert.match(assistant, /asks only for advice or options.*without staging a review card/is);
  assert.match(assistant, /sourceRoutineExerciseId/);
  assert.match(assistant, /sourceRoutineSetId/);
  assert.match(assistant, /required: \["sourceRoutineExerciseId", "exerciseId"/);
  assert.match(assistant, /"sourceRoutineSetId", "position", "setType"/);
  assert.match(assistant, /only approval actions that mutate domain data/);
  assert.match(assistant, /prior chat approval is not required/);
  assert.match(assistant, /cannot create or publish a routine version or change the current routine/);
  assert.match(assistant, /status: "ready_for_review"/);
  assert.doesNotMatch(assistant, /explicit approval in a later message/);
  assert.doesNotMatch(assistant, /Only after the user explicitly approves a plan/);
  assert.match(assistant, /status = 'pending'/);
  assert.match(assistant, /childAction === "apply" && request\.method === "POST"/);
  assert.match(assistant, /routine\.currentVersionId !== plan\.baseVersionId/);
  assert.match(assistant, /current\.updatedAt !== plan\.baseUpdatedAt/);
  assert.match(assistant, /assertExerciseCanBeArchived/);
  assert.match(assistant, /status = 'stale'/);
  assert.match(assistant, /createVersion/);
  assert.match(assistant, /services\.routines\.publish/);
  assert.match(assistant, /services\.routines\.publish\([^;]*plan\.baseVersionId/s);
  assert.match(assistant, /publish && !publishedRoutine/);
  assert.match(assistant, /services\.exercises\.create/);
  assert.match(assistant, /services\.exercises\.updateIfUnchanged/);
  assert.match(assistant, /services\.exercises\.archiveIfUnchanged/);
  assert.match(assistant, /return await applyExerciseChangePlan/);
  assert.match(repository, /updated_at = \?.*is_active = 1 AND updated_at = \?/s);
  assert.match(repository, /ec\.is_active <> 1/);
  assert.match(repository, /rv\.status = 'draft'/);
  assert.match(repository, /UPDATE exercises SET name = \?, load_type = \?, updated_at = \?/);
  assert.match(repository, /typeof input\.isActive !== "boolean"/);
  assert.doesNotMatch(repository, /Number\(input\.isActive\)/);
  assert.match(assistant, /assistant_tool_calls/);
  assert.match(schema, /assistant_exercise_change_plans/);
  assert.match(coachScreen, /kind: "routine"/);
  assert.match(coachScreen, /kind: "exercise"/);
  assert.match(coachScreen, /plan\.kind === "routine"/);
  assert.match(models, /gpt-5\.6-terra/);
  assert.match(models, /Number\(minorVersion\) >= 6/);
  assert.match(models, /isCompatibleAssistantModel/);
  assert.match(types, /OPENAI_API_KEY/);
  assert.match(types, /OPENAI_DEFAULT_MODEL/);

  const toolBlock = assistant.match(/const coachTools = \[([\s\S]*?)\n\];/)?.[1];
  assert.ok(toolBlock, "Coach tool definitions should be discoverable");
  const toolNames = [...toolBlock.matchAll(/functionTool\("([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(toolNames, [
    "get_coaching_context",
    "get_routine",
    "list_routine_versions",
    "search_exercises",
    "get_exercise",
    "get_workout_history",
    "get_active_workout",
    "propose_routine_change",
    "propose_exercise_change",
  ]);
  assert.doesNotMatch(toolBlock, /functionTool\("(?:apply|publish|create|update|delete|archive)_/);
});
