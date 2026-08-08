import assert from "node:assert/strict";
import test from "node:test";
import type { RoutineAggregate, RoutineExercise, RoutineSet } from "../src/domain/entities";
import { isRoutineVersionSemanticallyEqual } from "../src/domain/routines/comparison";
import {
  buildRoutineChangeDiff,
  buildRoutineCreationDiff,
  completeRoutineChangeProposal,
  completeRoutineCreationProposal,
  type CoachRoutineProposal,
} from "../src/server/coach/routine-change";

type ProposedExercise = CoachRoutineProposal["exercises"][number];
type ProposedSet = ProposedExercise["sets"][number];

const timestamp = "2026-08-01T00:00:00.000Z";

function currentSet(overrides: Partial<RoutineSet> = {}): RoutineSet {
  return {
    id: "set-1",
    ownerEmail: "owner@example.com",
    routineExerciseId: "routine-exercise-1",
    position: 1,
    setType: "regular",
    targetType: "reps",
    targetMin: 8,
    targetMax: 10,
    targetDisplay: "8-10 reps",
    targetRirMin: 1,
    targetRirMax: 2,
    restAfterSec: 90,
    restRule: "standard",
    loadInstruction: "Use the last completed working weight.",
    sideMode: "bilateral",
    tempo: null,
    notes: "Stop if bar speed breaks down.",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function proposedSet(sourceRoutineSetId: string | null, overrides: Partial<ProposedSet> = {}): ProposedSet {
  return {
    sourceRoutineSetId,
    position: 1,
    setType: "regular",
    targetType: "reps",
    targetMin: 8,
    targetMax: 10,
    targetDisplay: "8-10 reps",
    targetRirMin: 1,
    targetRirMax: 2,
    restAfterSec: 90,
    restRule: "standard",
    loadInstruction: "Use the last completed working weight.",
    sideMode: "bilateral",
    tempo: null,
    notes: "Stop if bar speed breaks down.",
    ...overrides,
  };
}

function currentExercise(overrides: Partial<RoutineExercise> = {}): RoutineExercise {
  return {
    id: "routine-exercise-1",
    ownerEmail: "owner@example.com",
    routineVersionId: "version-1",
    exerciseId: "bench",
    exerciseName: "Barbell Bench Press",
    position: 1,
    supersetGroup: null,
    instructions: "Pause for one second on the chest.",
    notes: "Use a competition-width grip.",
    sets: [currentSet()],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function proposedExercise(overrides: Partial<ProposedExercise> = {}): ProposedExercise {
  return {
    sourceRoutineExerciseId: "routine-exercise-1",
    exerciseId: "bench",
    position: 1,
    supersetGroup: null,
    instructions: "Pause for one second on the chest.",
    notes: "Use a competition-width grip.",
    sets: [proposedSet("set-1")],
    ...overrides,
  };
}

function routine(exercises: RoutineExercise[] = [currentExercise()]): RoutineAggregate {
  return {
    id: "routine-1",
    ownerEmail: "owner@example.com",
    code: "PUSH",
    currentVersionId: "version-1",
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentVersion: {
      id: "version-1",
      ownerEmail: "owner@example.com",
      routineId: "routine-1",
      versionNumber: 1,
      status: "published",
      focus: "Strength",
      summary: "Heavy compounds with conservative accessories.",
      durationMin: 60,
      exercises,
      createdAt: timestamp,
      publishedAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function proposal(exercises: ProposedExercise[] = [proposedExercise()]): CoachRoutineProposal {
  return {
    focus: "Strength",
    summary: "Heavy compounds with conservative accessories.",
    durationMin: 60,
    exercises,
  };
}

const library = [
  { id: "bench", name: "Barbell Bench Press" },
  { id: "squat", name: "Back Squat" },
  { id: "deadlift", name: "Conventional Deadlift" },
];

test("validates and fully discloses a brand-new routine proposal", () => {
  const proposed = proposal([
    proposedExercise({
      sourceRoutineExerciseId: null,
      exerciseId: "deadlift",
      instructions: "Keep the bar close.",
      notes: "Reset every rep.",
      sets: [proposedSet(null, { tempo: "2-1-1", restAfterSec: 120 })],
    }),
  ]);
  const completed = completeRoutineCreationProposal(proposed);

  assert.equal(completed.proposal.exercises[0]?.sourceRoutineExerciseId, null);
  assert.equal(completed.proposal.exercises[0]?.sets[0]?.sourceRoutineSetId, null);
  assert.doesNotMatch(JSON.stringify(completed.input), /sourceRoutine(?:Exercise|Set)Id/);

  const text = buildRoutineCreationDiff("PULL-2", completed.proposal, library).join("\n");
  assert.match(text, /Create routine code "PULL-2"/i);
  assert.match(text, /Routine name[\s\S]*none[\s\S]*"Strength"/i);
  assert.match(text, /Routine summary[\s\S]*Heavy compounds/i);
  assert.match(text, /duration[\s\S]*60/i);
  assert.match(text, /Add "Conventional Deadlift"[\s\S]*position=1/i);
  assert.match(text, /instructions="Keep the bar close\."/i);
  assert.match(text, /notes="Reset every rep\."/i);
  assert.match(text, /add set[\s\S]*rest seconds=120[\s\S]*tempo="2-1-1"/i);
});

test("requires null source identities for every new routine placement and set", () => {
  assert.throws(
    () => completeRoutineCreationProposal(proposal()),
    /new routine must have a null source routine exercise ID/i,
  );

  const oldSet = proposal([
    proposedExercise({
      sourceRoutineExerciseId: null,
      sets: [proposedSet("set-from-another-routine")],
    }),
  ]);
  assert.throws(
    () => completeRoutineCreationProposal(oldSet),
    /new routine must have a null source routine set ID/i,
  );
});

test("discloses every routine and exercise-placement field with exact text", () => {
  const proposed = proposal([
    proposedExercise({
      exerciseId: "deadlift",
      position: 2,
      supersetGroup: "A",
      instructions: "Lower for exactly three seconds, then pause.",
      notes: "Leave one clean rep before technical failure.",
    }),
  ]);
  proposed.focus = "Hypertrophy";
  proposed.summary = "Moderate loads with controlled eccentrics and exact pauses.";
  proposed.durationMin = 75;

  const text = buildRoutineChangeDiff(routine(), proposed, library).join("\n");

  assert.match(text, /Routine name[\s\S]*"Strength"[\s\S]*"Hypertrophy"/i);
  assert.match(text, /Routine summary[\s\S]*"Heavy compounds with conservative accessories\."[\s\S]*"Moderate loads with controlled eccentrics and exact pauses\."/i);
  assert.match(text, /duration[\s\S]*60[\s\S]*75/i);
  assert.match(text, /exercise:[\s\S]*"Barbell Bench Press"[\s\S]*"Conventional Deadlift"/i);
  assert.match(text, /exercise position[\s\S]*1[\s\S]*2/i);
  assert.match(text, /superset group[\s\S]*none[\s\S]*"A"/i);
  assert.match(text, /exercise instructions[\s\S]*"Pause for one second on the chest\."[\s\S]*"Lower for exactly three seconds, then pause\."/i);
  assert.match(text, /exercise notes[\s\S]*"Use a competition-width grip\."[\s\S]*"Leave one clean rep before technical failure\."/i);
});

test("discloses before and after values for every editable set field", () => {
  const changed = proposedSet("set-1", {
    setType: "failure",
    targetType: "duration",
    targetMin: 40,
    targetMax: 50,
    targetDisplay: "40-50 seconds",
    targetRirMin: 0,
    targetRirMax: 0,
    restAfterSec: 120,
    restRule: "after_both_sides",
    loadInstruction: "Reduce the load after the left side.",
    sideMode: "left_right",
    tempo: "3-1-1",
    notes: "Technical failure only; do not grind another rep.",
  });
  const text = buildRoutineChangeDiff(
    routine(),
    proposal([proposedExercise({ sets: [changed] })]),
    library,
  ).join("\n");

  const expectedChanges = [
    [/set 1[^\n]*type:/i, /"regular"[\s\S]*"failure"/i],
    [/target type/i, /"reps"[\s\S]*"duration"/i],
    [/target minimum/i, /8[\s\S]*40/],
    [/target maximum/i, /10[\s\S]*50/],
    [/display target/i, /"8-10 reps"[\s\S]*"40-50 seconds"/],
    [/RIR minimum/i, /1[\s\S]*0/],
    [/RIR maximum/i, /2[\s\S]*0/],
    [/rest seconds/i, /90[\s\S]*120/],
    [/rest rule/i, /"standard"[\s\S]*"after_both_sides"/],
    [/load instruction/i, /"Use the last completed working weight\."[\s\S]*"Reduce the load after the left side\."/],
    [/side mode/i, /"bilateral"[\s\S]*"left_right"/],
    [/tempo/i, /none[\s\S]*"3-1-1"/i],
    [/set 1[^\n]*notes:/i, /"Stop if bar speed breaks down\."[\s\S]*"Technical failure only; do not grind another rep\."/],
  ] as const;

  for (const [label, values] of expectedChanges) {
    assert.match(text, label);
    assert.match(text, values);
  }
});

test("uses stable set IDs to report reorders, additions, and removals", () => {
  const first = currentSet({ id: "set-1", position: 1, targetDisplay: "First working set" });
  const second = currentSet({ id: "set-2", position: 2, targetDisplay: "Second working set" });
  const removed = currentSet({ id: "set-3", position: 3, targetDisplay: "Remove this backoff set" });
  const current = routine([currentExercise({ sets: [first, second, removed] })]);
  const proposed = proposal([
    proposedExercise({
      sets: [
        proposedSet("set-2", { position: 1, targetDisplay: "Second working set" }),
        proposedSet("set-1", { position: 2, targetDisplay: "First working set" }),
        proposedSet(null, { position: 4, targetDisplay: "New finisher set", setType: "failure" }),
      ],
    }),
  ]);

  const text = buildRoutineChangeDiff(current, proposed, library).join("\n");

  assert.match(text, /set[\s\S]*position[\s\S]*2[\s\S]*1/i);
  assert.match(text, /set[\s\S]*position[\s\S]*1[\s\S]*2/i);
  assert.match(text, /remove set[\s\S]*position=3[\s\S]*"Remove this backoff set"/i);
  assert.match(text, /add set[\s\S]*position=4[\s\S]*"New finisher set"/i);
});

test("adds, removes, and reorders exercises by stable placement ID", () => {
  const bench = currentExercise({ id: "routine-exercise-bench", position: 1 });
  const squat = currentExercise({
    id: "routine-exercise-squat",
    exerciseId: "squat",
    exerciseName: "Back Squat",
    position: 2,
    sets: [currentSet({ id: "squat-set", routineExerciseId: "routine-exercise-squat" })],
  });
  const proposed = proposal([
    proposedExercise({
      sourceRoutineExerciseId: "routine-exercise-bench",
      position: 2,
      sets: [proposedSet("set-1")],
    }),
    proposedExercise({
      sourceRoutineExerciseId: null,
      exerciseId: "deadlift",
      position: 1,
      instructions: "Keep the bar close to the shins.",
      notes: "No touch-and-go reps.",
      sets: [proposedSet(null, { targetDisplay: "3-5 reps" })],
    }),
  ]);

  const text = buildRoutineChangeDiff(routine([bench, squat]), proposed, library).join("\n");

  assert.match(text, /Remove[\s\S]*Back Squat/i);
  assert.match(text, /Add[\s\S]*Conventional Deadlift[\s\S]*position=1/i);
  assert.match(text, /Barbell Bench Press[\s\S]*exercise position[\s\S]*1[\s\S]*2/i);
  assert.match(text, /instructions="Keep the bar close to the shins\."/i);
  assert.match(text, /notes="No touch-and-go reps\."/i);
});

test("does not collapse duplicate exercise IDs and tracks each placement independently", () => {
  const first = currentExercise({
    id: "routine-exercise-first-bench",
    position: 1,
    instructions: "Wide-grip bench instructions.",
    notes: "First bench placement notes.",
    sets: [currentSet({ id: "first-bench-set", routineExerciseId: "routine-exercise-first-bench" })],
  });
  const second = currentExercise({
    id: "routine-exercise-second-bench",
    position: 2,
    instructions: "Close-grip bench instructions.",
    notes: "Second bench placement notes.",
    sets: [currentSet({ id: "second-bench-set", routineExerciseId: "routine-exercise-second-bench" })],
  });
  const proposed = proposal([
    proposedExercise({
      sourceRoutineExerciseId: "routine-exercise-second-bench",
      position: 1,
      instructions: "Close-grip bench instructions, elbows tucked.",
      notes: "Second bench placement notes.",
      sets: [proposedSet("second-bench-set")],
    }),
    proposedExercise({
      sourceRoutineExerciseId: "routine-exercise-first-bench",
      position: 2,
      instructions: "Wide-grip bench instructions.",
      notes: "First bench placement notes, keep feet planted.",
      sets: [proposedSet("first-bench-set")],
    }),
  ]);

  const text = buildRoutineChangeDiff(routine([first, second]), proposed, library).join("\n");

  assert.match(text, /"Close-grip bench instructions\."[\s\S]*"Close-grip bench instructions, elbows tucked\."/);
  assert.match(text, /"First bench placement notes\."[\s\S]*"First bench placement notes, keep feet planted\."/);
  assert.match(text, /exercise position[\s\S]*2[\s\S]*1/i);
  assert.match(text, /exercise position[\s\S]*1[\s\S]*2/i);
  assert.doesNotMatch(text, /Remove[\s\S]*Barbell Bench Press/i);
  assert.doesNotMatch(text, /Add[\s\S]*Barbell Bench Press/i);
});

test("returns an empty diff for a semantic no-op even when arrays are reordered", () => {
  const first = currentExercise({
    id: "routine-exercise-bench",
    position: 1,
    sets: [
      currentSet({ id: "bench-set-1", position: 1 }),
      currentSet({ id: "bench-set-2", position: 2, targetDisplay: "6 reps" }),
    ],
  });
  const second = currentExercise({
    id: "routine-exercise-squat",
    exerciseId: "squat",
    exerciseName: "Back Squat",
    position: 2,
    sets: [currentSet({ id: "squat-set", routineExerciseId: "routine-exercise-squat" })],
  });
  const unchanged = proposal([
    proposedExercise({
      sourceRoutineExerciseId: "routine-exercise-squat",
      exerciseId: "squat",
      position: 2,
      sets: [proposedSet("squat-set")],
    }),
    proposedExercise({
      sourceRoutineExerciseId: "routine-exercise-bench",
      position: 1,
      sets: [
        proposedSet("bench-set-2", { position: 2, targetDisplay: "6 reps" }),
        proposedSet("bench-set-1", { position: 1 }),
      ],
    }),
  ]);

  const currentRoutine = routine([first, second]);
  const completed = completeRoutineChangeProposal(currentRoutine.currentVersion!, unchanged);
  assert.equal(isRoutineVersionSemanticallyEqual(currentRoutine.currentVersion!, completed.input), true);
  assert.deepEqual(buildRoutineChangeDiff(currentRoutine, unchanged, library), []);
});

test("normalizes omitted optional placement fields when checking semantic equality", () => {
  const currentRoutine = routine([currentExercise({
    supersetGroup: null,
    instructions: "",
    notes: "",
  })]);
  const omittedOptionals = proposal();
  delete omittedOptionals.exercises[0]!.supersetGroup;
  delete omittedOptionals.exercises[0]!.instructions;
  delete omittedOptionals.exercises[0]!.notes;
  const completed = completeRoutineChangeProposal(currentRoutine.currentVersion!, omittedOptionals);

  assert.equal(isRoutineVersionSemanticallyEqual(currentRoutine.currentVersion!, completed.input), true);
});

test("validates stable source identities and strips them from the stored routine input", () => {
  const current = routine().currentVersion!;
  const valid = completeRoutineChangeProposal(current, proposal());
  assert.equal(valid.proposal.exercises[0]?.sourceRoutineExerciseId, "routine-exercise-1");
  assert.equal(valid.proposal.exercises[0]?.sets[0]?.sourceRoutineSetId, "set-1");
  assert.doesNotMatch(JSON.stringify(valid.input), /sourceRoutine(?:Exercise|Set)Id/);

  const foreignPlacement = structuredClone(proposal());
  foreignPlacement.exercises[0]!.sourceRoutineExerciseId = "another-version-placement";
  assert.throws(() => completeRoutineChangeProposal(current, foreignPlacement), /outside the current routine version/i);

  const duplicatePlacement = structuredClone(proposal());
  duplicatePlacement.exercises.push(structuredClone(duplicatePlacement.exercises[0]!));
  duplicatePlacement.exercises[1]!.position = 2;
  assert.throws(() => completeRoutineChangeProposal(current, duplicatePlacement), /placement can be referenced only once/i);

  const wrongParentSet = structuredClone(proposal());
  wrongParentSet.exercises[0]!.sets[0]!.sourceRoutineSetId = "another-placement-set";
  assert.throws(() => completeRoutineChangeProposal(current, wrongParentSet), /outside its current routine exercise/i);

  const newPlacementWithOldSet = structuredClone(proposal());
  newPlacementWithOldSet.exercises[0]!.sourceRoutineExerciseId = null;
  assert.throws(() => completeRoutineChangeProposal(current, newPlacementWithOldSet), /outside its current routine exercise/i);
});

test("detects an identical placement removed and re-added with null source IDs as a semantic no-op", () => {
  const currentRoutine = routine();
  const readded = proposal([
    proposedExercise({
      sourceRoutineExerciseId: null,
      sets: [proposedSet(null)],
    }),
  ]);
  const completed = completeRoutineChangeProposal(currentRoutine.currentVersion!, readded);

  assert.equal(isRoutineVersionSemanticallyEqual(currentRoutine.currentVersion!, completed.input), true);
  assert.notDeepEqual(
    buildRoutineChangeDiff(currentRoutine, completed.proposal, library),
    [],
    "Identity churn still produces a structural diff, so the semantic guard must decide no-op status.",
  );
});

test("detects swapped placement and set source IDs with an unchanged final prescription as a semantic no-op", () => {
  const first = currentExercise({
    id: "routine-exercise-first-bench",
    position: 1,
    instructions: "Wide-grip bench instructions.",
    notes: "First bench placement notes.",
    sets: [currentSet({
      id: "first-bench-set",
      routineExerciseId: "routine-exercise-first-bench",
      position: 1,
      targetDisplay: "8-10 wide-grip reps",
    })],
  });
  const second = currentExercise({
    id: "routine-exercise-second-bench",
    position: 2,
    instructions: "Close-grip bench instructions.",
    notes: "Second bench placement notes.",
    sets: [currentSet({
      id: "second-bench-set",
      routineExerciseId: "routine-exercise-second-bench",
      position: 1,
      targetDisplay: "10-12 close-grip reps",
    })],
  });
  const currentRoutine = routine([first, second]);
  const swappedSources = proposal([
    proposedExercise({
      sourceRoutineExerciseId: second.id,
      position: first.position,
      instructions: first.instructions,
      notes: first.notes,
      sets: [proposedSet("second-bench-set", {
        position: first.sets[0]!.position,
        targetDisplay: first.sets[0]!.targetDisplay,
      })],
    }),
    proposedExercise({
      sourceRoutineExerciseId: first.id,
      position: second.position,
      instructions: second.instructions,
      notes: second.notes,
      sets: [proposedSet("first-bench-set", {
        position: second.sets[0]!.position,
        targetDisplay: second.sets[0]!.targetDisplay,
      })],
    }),
  ]);
  const completed = completeRoutineChangeProposal(currentRoutine.currentVersion!, swappedSources);

  assert.equal(isRoutineVersionSemanticallyEqual(currentRoutine.currentVersion!, completed.input), true);
  assert.notDeepEqual(buildRoutineChangeDiff(currentRoutine, completed.proposal, library), []);
});
