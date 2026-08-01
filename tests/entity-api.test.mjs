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
});

test("runs an owner-scoped coaching assistant with strict tools and approval-gated writes", async () => {
  const [api, assistant, toolLoop, models, types] = await Promise.all([
    readFile(new URL("server/api.ts", root), "utf8"),
    readFile(new URL("server/assistant.ts", root), "utf8"),
    readFile(new URL("server/coach-tool-loop.ts", root), "utf8"),
    readFile(new URL("server/assistant-models.ts", root), "utf8"),
    readFile(new URL("server/types.ts", root), "utf8"),
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
  assert.match(assistant, /isWriteTool: \(name\) => name === "propose_routine_change"/);
  assert.match(toolLoop, /forceFinalResponse \? "none" : "auto"/);
  assert.match(toolLoop, /response\.status === "incomplete"/);
  assert.match(toolLoop, /response\.status !== "completed"/);
  assert.match(toolLoop, /reason === "max_output_tokens"/);
  assert.match(assistant, /strict: true/);
  assert.match(assistant, /propose_routine_change/);
  assert.match(assistant, /Change-control policy \(always follow this policy\)/);
  assert.match(assistant, /read-only tools to investigate/);
  assert.match(assistant, /do not repeat an identical tool call unless the underlying data could have changed/);
  assert.match(assistant, /Never call a write tool in the same response where you first present its plan/);
  assert.match(assistant, /explicit approval in a later message/);
  assert.match(assistant, /initial request to make a change is not approval/);
  assert.match(assistant, /Do not infer approval from silence or an ambiguous response/);
  assert.match(assistant, /if the plan changes materially.*wait for approval again/is);
  assert.match(assistant, /re-read the routine.*then and only then call propose_routine_change/is);
  assert.match(assistant, /Only after the user explicitly approves a plan presented in an earlier assistant message/);
  assert.match(assistant, /This does not apply or publish the change/);
  assert.match(assistant, /status = 'pending'/);
  assert.match(assistant, /childAction === "apply" && request\.method === "POST"/);
  assert.match(assistant, /routine\.currentVersionId !== plan\.baseVersionId/);
  assert.match(assistant, /createVersion/);
  assert.match(assistant, /services\.routines\.publish/);
  assert.match(assistant, /assistant_tool_calls/);
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
    "get_workout_history",
    "get_active_workout",
    "propose_routine_change",
  ]);
  assert.doesNotMatch(toolBlock, /functionTool\("(?:apply|publish|create|update|delete|archive)_/);
});
