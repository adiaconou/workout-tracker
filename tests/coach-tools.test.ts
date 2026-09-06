import assert from "node:assert/strict";
import test from "node:test";
import type { Exercise, RoutineAggregate, RoutineVersion, Workout } from "../src/domain/entities";
import { applyCoachRoutineEdits, routineProposalFromVersion } from "../src/server/coach/routine-edit";
import { coachExerciseSummary, coachPage, coachPageNumber, coachRoutineDetails, coachRoutineSummary,
  coachWorkoutDetails, normalizeCoachMessageContext } from "../src/server/coach/tool-data";
import { coachProposalCompletionText, isCoachProposalTool } from "../src/server/coach/message-run";

const exercise = (id = "e1", overrides = {}): Exercise => ({ id, ownerEmail: "owner", name: id,
  normalizedName: id, equipment: "dumbbells", movementPattern: "push", trackingType: "reps",
  defaultLoadType: "external", sideMode: "bilateral", weightSettings: null, instructions: "Control the descent.",
  muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }], isFavorite: false,
  isActive: true, createdAt: "2026-09-01", updatedAt: "2026-09-01", ...overrides });
const current = (): RoutineVersion => ({ id: "v1", ownerEmail: "owner", routineId: "r1", versionNumber: 1,
  status: "published", focus: "Upper", summary: "Keep this summary", durationMin: 45,
  createdAt: "2026-09-01", updatedAt: "2026-09-01", publishedAt: "2026-09-01",
  exercises: [1, 2].map((n) => ({ id: `p${n}`, ownerEmail: "owner", routineVersionId: "v1",
    exerciseId: "e1", exerciseName: "Press", position: n, supersetGroup: "A", instructions: "Keep cue", notes: "Keep placement note",
    createdAt: "2026-09-01", updatedAt: "2026-09-01", sets: [1, 2].map((s) => ({ id: `s${n}${s}`,
      ownerEmail: "owner", routineExerciseId: `p${n}`, position: s, setType: "regular", targetType: "reps",
      targetMin: 8, targetMax: 12, targetDisplay: "8-12 reps", targetRirMin: 2, targetRirMax: 3,
      restAfterSec: 90, restRule: "after_superset", loadInstruction: "Same load", sideMode: "bilateral",
      tempo: "3010", notes: "Keep set note", createdAt: "2026-09-01", updatedAt: "2026-09-01" })),
  })),
});
const routine = (): RoutineAggregate => ({ id: "r1", code: "A", currentVersionId: "v1", ownerEmail: "owner",
  isActive: true, createdAt: "2026-09-01", updatedAt: "2026-09-01", currentVersion: current() });

test("small edits address exact placements and preserve every untouched prescription field", () => {
  const version = current();
  const before = structuredClone(version);
  const changed = applyCoachRoutineEdits(version, [{ type: "set_rest", placementId: "p1", setIds: ["s11"], seconds: 120 }], []);
  const expected = routineProposalFromVersion(version);
  expected.exercises[0]!.sets[0]!.restAfterSec = 120;
  assert.deepEqual(changed, expected);
  assert.deepEqual(version, before);
  const combined = applyCoachRoutineEdits(version, [
    { type: "set_targets", placementId: "p1", setIds: ["s11", "s12"], minimum: 6, maximum: 8, display: "6-8 reps" },
    { type: "set_rir", placementId: "p2", setIds: ["s21"], minimum: null, maximum: null },
    { type: "set_load_instruction", placementId: "p2", setIds: ["s22"], instruction: "  Comfortable load  " },
    { type: "replace_exercise", placementId: "p2", exerciseId: "e2" },
    { type: "reorder", placementIds: ["p2", "p1"] },
  ], [exercise(), exercise("e2")]);
  assert.equal(combined.exercises[0]!.sets[0]!.targetMin, 6);
  assert.equal(combined.exercises[0]!.sets[1]!.targetMax, 8);
  assert.equal(combined.exercises[1]!.sets[0]!.targetRirMin, null);
  assert.equal(combined.exercises[1]!.sets[1]!.loadInstruction, "Comfortable load");
  assert.equal(combined.exercises[1]!.exerciseId, "e2");
  assert.equal(combined.exercises[1]!.position, 1);
  assert.equal(combined.exercises[1]!.supersetGroup, "A");
});

test("small edits reject invalid selections, incompatible replacements, and invalid values", () => {
  for (const input of [null, [], Array(51).fill({}), [null], [[]]]) assert.throws(() => applyCoachRoutineEdits(current(), input, []));
  for (const ids of [null, ["p1"], ["p1", "p1"], ["p1", "foreign"]]) {
    assert.throws(() => applyCoachRoutineEdits(current(), [{ type: "reorder", placementIds: ids }], []));
  }
  assert.throws(() => applyCoachRoutineEdits(current(), [{ type: "set_rest", placementId: "foreign" }], []));
  for (const setIds of [null, [], ["s11", "s11"], ["s21"]]) {
    assert.throws(() => applyCoachRoutineEdits(current(), [{ type: "set_rest", placementId: "p1", setIds, seconds: 10 }], []));
  }
  const selection = { placementId: "p1", setIds: ["s11"] };
  for (const minimum of [undefined, -1, Infinity, "5"]) {
    assert.throws(() => applyCoachRoutineEdits(current(), [{ ...selection, type: "set_targets", minimum, maximum: 8, display: "target" }], []));
  }
  for (const display of [null, " "]) assert.throws(() => applyCoachRoutineEdits(current(), [{ ...selection, type: "set_targets", minimum: 1, maximum: null, display }], []));
  for (const instruction of [null, "x".repeat(1001)]) assert.throws(() => applyCoachRoutineEdits(current(), [{ ...selection, type: "set_load_instruction", instruction }], []));
  assert.throws(() => applyCoachRoutineEdits(current(), [{ ...selection, type: "unknown" }], []));
  assert.throws(() => applyCoachRoutineEdits(current(), [{ ...selection, type: "set_rest", seconds: -1 }], []));
  assert.throws(() => applyCoachRoutineEdits(current(), [{ ...selection, type: "set_rir", minimum: 4, maximum: 1 }], []));
  for (const library of [[], [exercise()], [exercise("e2")],
    [exercise(), exercise("e2", { isActive: false })], [exercise(), exercise("e2", { trackingType: "duration" })],
    [exercise(), exercise("e2", { sideMode: "per_side" })], [exercise(), exercise("e2", { defaultLoadType: "assistance" })]]) {
    assert.throws(() => applyCoachRoutineEdits(current(), [{ type: "replace_exercise", placementId: "p1", exerciseId: "e2" }], library));
  }
});

test("tool paging retains whole records and has actionable continuation metadata", () => {
  assert.equal(coachPageNumber(null, 10, 25), 10);
  assert.equal(coachPageNumber(undefined, 10, 25), 10);
  assert.equal(coachPageNumber(0, 0, 100, 0), 0);
  for (const value of ["2", 1.2, -1, 26]) assert.throws(() => coachPageNumber(value, 10, 25));
  assert.deepEqual(coachPage(["one", "two", "three"], 2, 1), { items: ["two", "three"], total: 3, hasMore: false, nextOffset: 3 });
  assert.deepEqual(coachPage(["one", "two"], 2, 0, 9), { items: ["one"], total: 2, hasMore: true, nextOffset: 1 });
  assert.throws(() => coachPage(["oversized"], 1, 0, 2), /narrower page/);
  assert.equal(coachPage([], 1, 0).hasMore, false);
});

test("training projections preserve evidence and stable IDs without owner metadata", () => {
  assert.equal("ownerEmail" in coachExerciseSummary(exercise()), false);
  const summary = coachRoutineSummary(routine());
  assert.equal(summary.exerciseCount, 2);
  const unpublished = { ...routine(), currentVersion: null };
  assert.deepEqual(coachRoutineSummary(unpublished), { id: "r1", code: "A", currentVersionId: "v1", name: "A", durationMin: null, exerciseCount: 0 });
  assert.equal(coachRoutineDetails(unpublished).currentVersion, null);
  assert.equal(coachRoutineDetails(routine()).currentVersion!.exercises.length, 2);
  const detail = coachRoutineDetails(routine(), 1, 1);
  assert.equal(detail.currentVersion!.exercises[0]!.id, "p2");
  assert.equal(detail.currentVersion!.exercises[0]!.sets[0]!.id, "s21");
  assert.equal("ownerEmail" in detail.currentVersion!.exercises[0]!.sets[0]!, false);
  const workout = { id: "w1", routineCode: "A", status: "Completed", startedAt: "2026-09-01", completedAt: "2026-09-01",
    weightUnit: "kg", bodyWeight: 70, notes: "Keep context", exercises: [{ id: "we1", exerciseId: "e1", position: 1,
      sets: [{ id: "ws1", actualWeight: 20, weightUnit: "kg", actualRepsLeft: 8, actualRepsRight: 7, actualRir: 2 }] }] } as unknown as Workout;
  const result = coachWorkoutDetails(workout);
  assert.equal(result.exercises[0]!.sets[0]!.actualRepsRight, 7);
  assert.equal(result.exercises[0]!.sets[0]!.actualRir, 2);
  assert.equal(result.hasMore, false);
  assert.equal(coachWorkoutDetails(workout, 1, 1).exercises.length, 0);
});

test("message targets normalize only known identifiers and reject malformed contexts", () => {
  for (const value of [undefined, null, {}]) assert.deepEqual(normalizeCoachMessageContext(value), {});
  assert.deepEqual(normalizeCoachMessageContext({ revisePlanId: " p ", target: { kind: "routine", routineId: " r " } }),
    { revisePlanId: "p", target: { kind: "routine", routineId: "r" } });
  assert.deepEqual(normalizeCoachMessageContext({ target: { kind: "routine", routineId: "r", versionId: "v" } }).target,
    { kind: "routine", routineId: "r", versionId: "v" });
  assert.deepEqual(normalizeCoachMessageContext({ target: { kind: "exercise", exerciseId: "e" } }).target, { kind: "exercise", exerciseId: "e" });
  assert.deepEqual(normalizeCoachMessageContext({ target: { kind: "workout", workoutId: "w" } }).target, { kind: "workout", workoutId: "w" });
  assert.deepEqual(normalizeCoachMessageContext({ target: { kind: "workout", workoutId: "w", viewedSetId: "s" } }).target,
    { kind: "workout", workoutId: "w", viewedSetId: "s" });
  for (const value of [[], "text", { revisePlanId: 3 }, { revisePlanId: " " }, { revisePlanId: "x".repeat(301) },
    { target: null }, { target: [] }, { target: "text" }, { target: { kind: "foreign" } }]) {
    assert.throws(() => normalizeCoachMessageContext(value));
  }
});

test("new proposal tools finish with accurate deterministic review wording", () => {
  assert.equal(isCoachProposalTool("propose_routine_edit"), true);
  assert.equal(isCoachProposalTool("propose_routine_changes"), true);
  assert.match(coachProposalCompletionText("propose_routine_edit")!, /Nothing has changed/);
  assert.match(coachProposalCompletionText("propose_routine_changes", { plans: [{}, {}] })!, /2 routine proposals/);
  for (const output of [undefined, null, "text", {}]) assert.match(coachProposalCompletionText("propose_routine_changes", output)!, /your routine proposals/);
});
