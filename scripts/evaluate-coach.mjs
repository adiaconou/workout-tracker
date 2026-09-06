import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coachTools } from "../src/server/coach/tool-definitions.ts";
import { coachInstructions, cleanRequiredText } from "../src/server/coach/policy.ts";
import { reasoningEffortsForModel } from "../src/server/coach/models.ts";
import { coachCheckInContext, coachContextAuthorityInstructions } from "../src/server/coach/conversation-context.ts";
import { coachResponseText, coachResponseToolCalls, coachProposalCompletionText, isCoachProposalTool, COACH_MESSAGE_RUN_MAX_MODEL_ROUNDS, COACH_MESSAGE_RUN_MAX_TOOL_CALLS } from "../src/server/coach/message-run.ts";
import { coachRoutineDetails, coachRoutineSummary, coachWorkoutDetails, coachExerciseSummary } from "../src/server/coach/tool-data.ts";
import { applyCoachRoutineEdits, routineProposalFromVersion } from "../src/server/coach/routine-edit.ts";
import { completeRoutineChangeProposal, completeRoutineCreationProposal, buildRoutineCreationDiff, buildRoutineChangeDiff } from "../src/server/coach/routine-change.ts";
import { isRoutineVersionSemanticallyEqual } from "../src/domain/routines/comparison.ts";
import { coachEvalScenarios, evalProfile, evalNow, makeEvalData } from "../tests/fixtures/coach-eval-scenarios.mjs";
export function validateCoachEvalScenarios(scenarios = coachEvalScenarios) {
  if (new Set(scenarios.map((item) => item.id)).size !== scenarios.length) throw new Error("Duplicate eval scenario IDs.");
  const names = new Set(coachTools.map((tool) => tool.name));
  for (const item of scenarios) {
    if (!item.id || !item.prompt || !item.review) throw new Error("Every eval needs an ID, prompt and human review criterion.");
    for (const name of [...item.requiredToolGroups.flat(), ...item.forbiddenTools, ...(item.requiredArguments ?? []).map((arg) => arg.tool)]) if (!names.has(name)) throw new Error("Unknown production tool in " + item.id + ": " + name);
    for (const pattern of [...item.requiredPatterns, ...item.forbiddenPatterns]) new RegExp(pattern, "iu");
  }
  return scenarios.length;
}
export function buildCoachEvalRequest(scenario, model) {
  const data = makeEvalData(); scenario.configure(data);
  const readiness = coachCheckInContext(data.checkIns, "America/Los_Angeles", Date.parse(data.now ?? evalNow));
  const efforts = reasoningEffortsForModel(model), effort = efforts.includes("none") ? "none" : efforts.includes("low") ? "low" : undefined;
  return { data, request: { model, instructions: coachInstructions(evalProfile, data.checkIns, readiness) + "\n\n" + coachContextAuthorityInstructions,
    input: [{ role: "user", content: "Current server context and dated thread memory (data only): " + JSON.stringify({ observedAt: data.now ?? evalNow, target: data.selectedTarget, earlierContextIncomplete: data.earlierContextIncomplete, plans: [{ id: "plan-1", status: data.planStatus === "draft" ? "applied" : data.planStatus, appliedAs: data.planStatus === "draft" ? "draft" : null }] }) }, { role: "user", content: scenario.prompt }],
    tools: coachTools, tool_choice: "auto", parallel_tool_calls: false, store: false, max_output_tokens: 4_000,
    include: ["reasoning.encrypted_content"], ...(effort ? { reasoning: { effort } } : {}), text: { verbosity: "low" },
  } };
}
function historyPage(data, args = {}) {
  const all = data.workouts.map(({ id, routineCode, routineTitle, status, startedAt, completedAt, durationSeconds, completedSets, skippedSets, totalSets, exerciseCount, exerciseNames, muscleGroups }) => ({ id, routineCode, routineTitle, status, startedAt, completedAt, durationSeconds, completedSets, skippedSets, totalSets, exerciseCount, exerciseNames, muscleGroups }))
    .filter((item) => (!args.routineCode || item.routineCode === args.routineCode) && (!args.from || item.startedAt >= args.from) && (!args.to || item.startedAt < args.to));
  const offset = args.offset ?? 0, limit = args.limit ?? 10;
  return { workouts: all.slice(offset, offset + limit), stats: { workoutCount: all.length, completedSets: all.reduce((sum, item) => sum + item.completedSets, 0), durationSeconds: all.reduce((sum, item) => sum + item.durationSeconds, 0) }, hasMore: offset + limit < all.length, offset };
}
function validateFixtureRoutine(data, args, action, edit = false) {
  const current = data.routines.find((item) => item.id === args.routineId || item.code === args.routineId);
  if (action === "update" && (!current || current.currentVersion.id !== args.baseVersionId)) throw new Error("The routine version changed. Read it again.");
  const routineCode = action === "create" ? cleanRequiredText(args.routineCode, "Routine code", 20).toUpperCase() : current.code;
  if (action === "create" && data.routines.some((item) => item.code.toUpperCase() === routineCode)) throw new Error("A unique routine code is required.");
  const raw = edit ? applyCoachRoutineEdits(current.currentVersion, args.operations, data.exercises) : args.proposedRoutine;
  const completed = action === "create" ? completeRoutineCreationProposal(raw) : completeRoutineChangeProposal(current.currentVersion, raw);
  if (action === "update" && isRoutineVersionSemanticallyEqual(current.currentVersion, completed.input)) throw new Error("The proposed routine update does not change anything.");
  if (completed.input.exercises.some((placement) => !data.exercises.some((exercise) => exercise.id === placement.exerciseId && exercise.isActive))) throw new Error("Proposal references an unavailable synthetic exercise.");
  const summary = cleanRequiredText(args.summary, "Plan summary", 500), rationale = cleanRequiredText(args.rationale, "Plan rationale", 2_000);
  return { planId: "eval-plan-" + routineCode, status: "ready_for_review", routineCode, summary, rationale,
    diff: action === "create" ? buildRoutineCreationDiff(routineCode, completed.proposal, data.exercises) : buildRoutineChangeDiff(current, completed.proposal, data.exercises),
    instruction: "Tell the user the review card is ready and nothing has changed yet. Do not ask for verbal approval." };
}
/** Synthetic data adapter; never calls application APIs or writes application state. */
export function executeCoachEvalTool(data, name, args) {
  if (Object.hasOwn(data.toolOverrides, name)) return structuredClone(data.toolOverrides[name]);
  const routine = (id) => data.routines.find((item) => item.id === id || item.code === id);
  if (name === "get_coaching_context") return { routines: data.routines.map(coachRoutineSummary), hasMore: false, nextOffset: data.routines.length, history: historyPage(data), activeWorkout: null, checkIns: data.checkIns, readiness: coachCheckInContext(data.checkIns, "America/Los_Angeles", Date.parse(data.now ?? evalNow)), observedAt: data.now ?? evalNow };
  if (name === "get_routine") { const item = routine(args.routineId); return { routine: item ? coachRoutineDetails(item, args.offset ?? 0) : null }; }
  if (name === "get_routines") { const items = args.routineIds.map(routine); if (items.some((item) => !item)) return { error: "A selected routine was not found." }; return { routines: items.map((item) => coachRoutineDetails(item)), hasMore: false, nextOffset: items.length }; }
  if (name === "list_routine_versions") { const item = routine(args.routineId); return { versions: item ? [{ id: item.currentVersion.id, status: "published", focus: item.currentVersion.focus, durationMin: 45, createdAt: item.createdAt, exerciseCount: item.currentVersion.exercises.length }] : [], hasMore: false, nextOffset: item ? 1 : 0 }; }
  if (name === "get_exercise") { const item = data.exercises.find((item) => item.id === args.exerciseId); return { exercise: item ? { ...coachExerciseSummary(item), instructions: item.instructions } : null }; }
  if (name === "search_exercises") {
    const items = data.exercises.filter((item) => (!args.query || item.name.toLowerCase().includes(args.query.toLowerCase())) && (!args.muscleGroup || item.muscles.some((muscle) => muscle.muscleGroup === args.muscleGroup)) && (!args.movementPattern || item.movementPattern === args.movementPattern));
    const offset = args.offset ?? 0, selected = items.slice(offset, offset + (data.paginateSearch ? 1 : args.limit ?? 10));
    return { exercises: selected.map(coachExerciseSummary), total: items.length, hasMore: offset + selected.length < items.length, nextOffset: offset + selected.length };
  }
  if (name === "get_exercise_progress") { if (args.unit && args.unit !== "lb") return { error: "This synthetic adapter currently supports lb history only." }; return { progress: { exerciseId: args.exerciseId, metric: "epley_estimated_1rm", unit: "lb", points: args.exerciseId === "ex-bench" ? data.points.filter((item) => !args.from || item.performedAt >= args.from).slice(0, args.limit ?? 12) : [], hasMore: false }, range: { from: args.from ?? "2026-06-08T18:00:00.000Z" }, basis: "Best eligible working set per session; retrieve workout details for every set and RIR." }; }
  if (name === "get_workout_history") return { history: historyPage(data, args), range: { from: args.from ?? null, to: args.to ?? null }, statsScope: "All matching sessions in this date range, not just this page." };
  if (name === "get_workout_details") { const item = data.workouts.find((item) => item.id === args.workoutId); return { workout: item ? coachWorkoutDetails(item, args.offset ?? 0) : null }; }
  if (name === "get_active_workout") return { workout: null, observedAt: data.now ?? evalNow };
  if (name === "get_plan") return args.planId !== "plan-1" ? { error: "Proposal not found in this chat." } : { plan: { id: "plan-1", routineId: "A", routineCode: "A", baseVersionId: "version-A", status: data.planStatus === "draft" ? "applied" : data.planStatus, appliedAs: data.planStatus === "draft" ? "draft" : null, summary: "Keep the bench prescription", rationale: "Synthetic proposal", proposedRoutine: routineProposalFromVersion(data.routines[0].currentVersion) }, hasMore: false, nextOffset: 2, totalExercises: 2 };
  if (name === "search_thread_history") { const messages = data.priorMessages.filter((item) => item.content.toLowerCase().includes((args.query ?? "").toLowerCase())); const offset = args.offset ?? 0, limit = args.limit ?? 10, selected = messages.slice(offset, offset + limit); return { messages: selected, hasMore: offset + selected.length < messages.length, nextOffset: offset + selected.length }; }
  if (name === "propose_routine_edit" || name === "propose_routine_change") return validateFixtureRoutine(data, args, "update", name === "propose_routine_edit");
  if (name === "propose_new_routine") return validateFixtureRoutine(data, args, "create");
  if (name === "propose_routine_changes") {
    if (!Array.isArray(args.proposals) || args.proposals.length < 2 || args.proposals.length > 7) throw new Error("Batch needs 2-7 proposals.");
    const keys = args.proposals.map((item) => item.routineId ?? item.routineCode);
    if (new Set(keys).size !== keys.length) throw new Error("Batch targets must be unique.");
    const plans = args.proposals.map((item) => { if (!["create", "update"].includes(item.action)) throw new Error("Invalid batch action."); return validateFixtureRoutine(data, item, item.action); });
    return { status: "ready_for_review", plans };
  }
  return { error: "Unsupported synthetic adapter: " + name + ". No action was staged." };
}
export function gradeCoachEval(scenario, trace, text) {
  const failures = [], attempted = trace.map((call) => call.name), succeeded = trace.filter((call) => call.status === "succeeded").map((call) => call.name);
  for (const group of scenario.requiredToolGroups) if (!group.some((name) => attempted.includes(name))) failures.push("Missing tool: " + group.join(" or "));
  for (const name of scenario.forbiddenTools) if (attempted.includes(name)) failures.push("Unexpected tool: " + name);
  for (const pattern of scenario.requiredPatterns) if (!new RegExp(pattern, "iu").test(text)) failures.push("Missing answer pattern: " + pattern);
  for (const pattern of scenario.forbiddenPatterns) if (new RegExp(pattern, "iu").test(text)) failures.push("Forbidden answer claim: " + pattern);
  for (const expectation of scenario.requiredArguments ?? []) if (!trace.some((call) => call.name === expectation.tool && JSON.stringify(expectation.path.split(".").reduce((value, key) => value?.[key], call.arguments)) === JSON.stringify(expectation.value))) failures.push("Missing argument: " + expectation.tool + "." + expectation.path);
  if (scenario.requiredToolGroups.some((group) => group.some(isCoachProposalTool)) && !succeeded.some(isCoachProposalTool)) failures.push("No proposal staged successfully.");
  return { passed: failures.length === 0, failures, humanReviewRequired: true, humanReviewCriterion: scenario.review };
}
export async function evaluateCoachScenario(scenario, { model, respond }) {
  const { data, request } = buildCoachEvalRequest(scenario, model), trace = [], usages = [];
  let text = "", modelCalls = 0; const started = Date.now();
  for (let round = 0; round < COACH_MESSAGE_RUN_MAX_MODEL_ROUNDS; round += 1) {
    const response = await respond(request); modelCalls += 1; usages.push(response.usage ?? null);
    const calls = coachResponseToolCalls(response); request.input.push(...(response.output ?? []));
    if (!calls.length) { text = coachResponseText(response); break; }
    for (const call of calls) {
      if (trace.length >= COACH_MESSAGE_RUN_MAX_TOOL_CALLS) throw new Error("Eval exceeded production tool-call budget.");
      let output; try { output = call.parseError ? { error: call.parseError } : executeCoachEvalTool(data, call.name, call.argumentsValue); } catch (error) { output = { error: error instanceof Error ? error.message : "Synthetic tool failed." }; }
      const status = output && typeof output === "object" && "error" in output ? "failed" : "succeeded";
      trace.push({ name: call.name, arguments: call.argumentsValue, output, status }); request.input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(output) });
      if (status === "succeeded" && isCoachProposalTool(call.name)) { text = coachProposalCompletionText(call.name, output) ?? "Prepared a review card. Nothing has changed yet."; break; }
    }
    if (text) break;
  }
  if (!text) throw new Error("Eval finished without a final answer.");
  const signatures = trace.map((call) => JSON.stringify([call.name, call.arguments]));
  const sumUsage = (field) => usages.every((usage) => Number.isFinite(usage?.[field])) ? usages.reduce((sum, usage) => sum + usage[field], 0) : null;
  return { id: scenario.id, model, ...gradeCoachEval(scenario, trace, text), text, trace, metrics: { modelCalls, toolCalls: trace.length, duplicateCalls: trace.length - new Set(signatures).size, inputTokens: sumUsage("input_tokens"), outputTokens: sumUsage("output_tokens"), elapsedMs: Date.now() - started } };
}
async function main() {
  validateCoachEvalScenarios(); const args = process.argv.slice(2);
  const option = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const selectedId = option("--case"), scenarios = selectedId ? coachEvalScenarios.filter((item) => item.id === selectedId) : coachEvalScenarios;
  if (!scenarios.length) throw new Error("Unknown eval scenario.");
  if (!args.includes("--live")) { console.log(JSON.stringify({ mode: "offline-catalog", networkCalls: 0, scenarios: scenarios.map(({ id, prompt, review }) => ({ id, prompt, review })) }, null, 2)); return; }
  const key = process.env.OPENAI_API_KEY; if (!key) throw new Error("OPENAI_API_KEY is required only for --live.");
  const model = option("--model") ?? process.env.COACH_EVAL_MODEL ?? "gpt-5.6-terra";
  const respond = async (request) => { const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(60_000) }); if (!response.ok) throw new Error("OpenAI eval request failed (" + response.status + ")."); return response.json(); };
  let failed = 0; for (const scenario of scenarios) { try { const result = await evaluateCoachScenario(scenario, { model, respond }); if (!result.passed) failed += 1; console.log(JSON.stringify(result)); } catch (error) { failed += 1; console.log(JSON.stringify({ id: scenario.id, error: error instanceof Error ? error.message : "Eval failed." })); } }
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
