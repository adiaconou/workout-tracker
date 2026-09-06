import assert from "node:assert/strict";
import test from "node:test";
import { coachTools } from "../src/server/coach/tool-definitions.ts";
import { routineProposalFromVersion } from "../src/server/coach/routine-edit.ts";
import { buildCoachEvalRequest, evaluateCoachScenario, executeCoachEvalTool, gradeCoachEval, validateCoachEvalScenarios } from "../scripts/evaluate-coach.mjs";
import { coachEvalScenarios, makeEvalData } from "./fixtures/coach-eval-scenarios.mjs";
const scenario = (id) => coachEvalScenarios.find((item) => item.id === id);
const callResponse = (name, args, id = "call-1") => ({ id: "response-" + id, output: [{ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) }] });
const textResponse = (text) => ({ id: "response-final", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 10, output_tokens: 5 } });
const explanation = { summary: "Requested change", rationale: "Synthetic test" };
test("Coach eval has 30 independent cases backed by production tools and policies", () => {
  assert.equal(validateCoachEvalScenarios(), 30);
  for (const item of coachEvalScenarios) {
    const first = buildCoachEvalRequest(item, "gpt-5.6-terra"), second = buildCoachEvalRequest(item, "gpt-5.6-terra");
    assert.equal(first.request.tools, coachTools); assert.equal(first.request.input.at(-1).content, item.prompt);
    assert.equal(first.request.store, false); assert.deepEqual(first.data, second.data); assert.notEqual(first.data, second.data);
    assert.ok(first.request.instructions.length > 100);
  }
  assert.throws(() => validateCoachEvalScenarios([scenario("progression"), scenario("progression")]), /Duplicate/);
  assert.throws(() => validateCoachEvalScenarios([{ ...scenario("progression"), id: "" }]), /Every eval/);
  assert.throws(() => validateCoachEvalScenarios([{ ...scenario("progression"), requiredToolGroups: [["nonexistent_tool"]] }]), /Unknown production tool/);
});
test("Coach eval adapters preserve history, paginate, and validate edits without mutation", () => {
  const data = makeEvalData(); data.paginateSearch = true;
  const first = executeCoachEvalTool(data, "search_exercises", { query: null, muscleGroup: null, offset: 0, limit: 10 });
  const second = executeCoachEvalTool(data, "search_exercises", { query: null, muscleGroup: null, offset: first.nextOffset, limit: 10 });
  assert.equal(first.hasMore, true); assert.notEqual(first.exercises[0].id, second.exercises[0].id);
  const history = executeCoachEvalTool(data, "get_workout_history", { limit: 1, offset: 0 }).history;
  assert.equal(history.workouts.length, 1); assert.equal(history.hasMore, true); assert.equal(history.stats.workoutCount, 3);
  assert.equal("exercises" in history.workouts[0], false);
  const original = structuredClone(data.routines[0]);
  const edit = { ...explanation, routineId: "A", baseVersionId: "version-A", operations: [{ type: "set_rest", placementId: "A-placement-1", setIds: ["A-set-1-1", "A-set-1-2"], seconds: 120 }] };
  const result = executeCoachEvalTool(data, "propose_routine_edit", edit);
  assert.equal(result.status, "ready_for_review"); assert.match(result.diff.join("\n"), /120|2m/);
  assert.deepEqual(data.routines[0], original);
  assert.throws(() => executeCoachEvalTool(data, "propose_routine_edit", { ...edit, baseVersionId: "old" }), /changed/);
  assert.throws(() => executeCoachEvalTool(data, "propose_routine_edit", { ...edit, operations: [{ ...edit.operations[0], setIds: ["nonexistent"] }] }), /Set edits/);
  assert.throws(() => executeCoachEvalTool(data, "propose_routine_change", { ...explanation, routineId: "A", baseVersionId: "version-A", proposedRoutine: routineProposalFromVersion(original.currentVersion) }), /does not change/);
  assert.match(executeCoachEvalTool(data, "propose_exercise_change", {}).error, /No action was staged/);
  data.planStatus = "draft"; const plan = executeCoachEvalTool(data, "get_plan", { planId: "plan-1" }).plan;
  assert.deepEqual({ status: plan.status, appliedAs: plan.appliedAs }, { status: "applied", appliedAs: "draft" });
});
test("Coach eval validates creation and every batch item before returning synthetic cards", () => {
  const data = makeEvalData(), original = structuredClone(data), proposedRoutine = routineProposalFromVersion(data.routines[0].currentVersion);
  proposedRoutine.exercises.forEach((placement) => { placement.sourceRoutineExerciseId = null; placement.sets.forEach((set) => { set.sourceRoutineSetId = null; }); });
  assert.equal(executeCoachEvalTool(data, "propose_new_routine", { ...explanation, routineCode: "C", proposedRoutine }).status, "ready_for_review");
  assert.deepEqual(data, original);
  assert.throws(() => executeCoachEvalTool(data, "propose_new_routine", { ...explanation, routineCode: "A", proposedRoutine }), /unique routine code/);
  const unavailable = structuredClone(proposedRoutine); unavailable.exercises[0].exerciseId = "unknown";
  assert.throws(() => executeCoachEvalTool(data, "propose_new_routine", { ...explanation, routineCode: "C", proposedRoutine: unavailable }), /unavailable/);
  const proposals = data.routines.map((item) => ({ ...explanation, action: "update", routineId: item.id, baseVersionId: item.currentVersion.id, proposedRoutine: routineProposalFromVersion(item.currentVersion) }));
  proposals.forEach((item) => item.proposedRoutine.exercises.forEach((placement) => placement.sets.forEach((set) => { set.restAfterSec = 120; })));
  assert.equal(executeCoachEvalTool(data, "propose_routine_changes", { proposals }).plans.length, 2);
  assert.throws(() => executeCoachEvalTool(data, "propose_routine_changes", { proposals: [{ ...proposals[0] }, { ...proposals[1], baseVersionId: "stale" }] }), /changed/);
  assert.deepEqual(data, original);
});
test("Coach eval runs injected responses offline and preserves unknown usage as null", async () => {
  let calls = 0;
  const result = await evaluateCoachScenario(scenario("missing-history"), { model: "gpt-5.6-terra", respond: async () => ++calls === 1 ? callResponse("get_exercise_progress", { exerciseId: "ex-bench", from: null, limit: 12, unit: "lb" }) : textResponse("There is no recorded performance yet. Log a session so we can assess it.") });
  assert.equal(result.passed, true); assert.equal(result.metrics.modelCalls, 2); assert.equal(result.metrics.toolCalls, 1);
  assert.equal(result.metrics.inputTokens, null); assert.equal(result.metrics.outputTokens, null);
  assert.deepEqual(result.trace[0].output.progress.points, []); assert.equal(result.humanReviewRequired, true);
  assert.equal(result.humanReviewCriterion, scenario("missing-history").review);
  const measured = await evaluateCoachScenario(scenario("chat-isolation"), { model: "gpt-4.1", respond: async () => textResponse("I cannot read your other chat.") });
  assert.equal(measured.metrics.inputTokens, 10); assert.equal(measured.metrics.outputTokens, 5);
});
test("Coach eval stops after successful review staging", async () => {
  let calls = 0;
  const result = await evaluateCoachScenario(scenario("small-rest-edit"), { model: "gpt-5.6-terra", respond: async () => {
    calls += 1; if (calls === 1) return callResponse("get_routine", { routineId: "A", offset: null });
    if (calls === 2) return callResponse("propose_routine_edit", { ...explanation, routineId: "A", baseVersionId: "version-A", operations: [{ type: "set_rest", placementId: "A-placement-1", setIds: ["A-set-1-1", "A-set-1-2"], seconds: 120 }] }, "call-2");
    throw new Error("No model call should follow staging.");
  } });
  assert.equal(result.passed, true); assert.equal(calls, 2); assert.equal(result.trace[1].output.status, "ready_for_review");
});
test("Coach eval grading catches tool mistakes, unsupported claims and incorrect arguments", () => {
  const badAdvice = gradeCoachEval(scenario("pain"), [{ name: "propose_exercise_change", status: "failed", arguments: {} }], "You have a torn tendon. Keep training.");
  assert.equal(badAdvice.passed, false); assert.ok(badAdvice.failures.some((failure) => failure.startsWith("Unexpected tool")));
  assert.ok(badAdvice.failures.some((failure) => failure.startsWith("Forbidden answer"))); assert.ok(badAdvice.failures.some((failure) => failure.startsWith("Missing answer")));
  const failedEdit = gradeCoachEval(scenario("small-rest-edit"), [{ name: "propose_routine_edit", status: "failed", arguments: { routineId: "B" } }], "I have applied the change.");
  assert.equal(failedEdit.passed, false); assert.ok(failedEdit.failures.includes("No proposal staged successfully."));
  assert.ok(failedEdit.failures.some((failure) => failure.startsWith("Missing argument"))); assert.ok(failedEdit.failures.some((failure) => failure.startsWith("Missing tool")));
});
test("Coach eval uses production budgets and surfaces missing data honestly", async () => {
  await assert.rejects(evaluateCoachScenario(scenario("chat-isolation"), { model: "gpt-4.1", respond: async () => callResponse("get_active_workout", {}) }), /without a final answer/);
  const tooMany = { id: "response", output: Array.from({ length: 13 }, (_, index) => ({ type: "function_call", name: "get_active_workout", call_id: "call-" + index, arguments: "{}" })) };
  await assert.rejects(evaluateCoachScenario(scenario("chat-isolation"), { model: "gpt-5.6-terra", respond: async () => tooMany }), /tool-call budget/);
  let calls = 0;
  const unavailable = await evaluateCoachScenario(scenario("tool-failure"), { model: "gpt-5.6-terra", respond: async () => ++calls === 1 ? callResponse("get_exercise_progress", { exerciseId: "ex-bench", from: null, limit: 12, unit: "lb" }) : textResponse("Your training history is unavailable right now.") });
  assert.equal(unavailable.passed, true); assert.equal(unavailable.trace[0].status, "failed");
});
