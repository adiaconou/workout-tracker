import assert from "node:assert/strict";
import test from "node:test";
import type { Exercise, RoutineVersionInput } from "../src/domain/entities";
import {
  ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS,
  addExercisesToRoutineDraft,
  appendRoutineSetPreservingTransition,
  buildRoutineCreationPayload,
  createEmptyRoutineDraft,
  deriveRoutineCodeCandidate,
  duplicateRoutineSetPreservingTransition,
  editableRoutineFromInput,
  estimateRoutineDuration,
  moveRoutineSetPreservingTransition,
  removeRoutineSetPreservingTransition,
  setRestBeforeNextExercise,
  setRestBetweenSets,
  validateRoutineCreationDraft,
} from "../src/client/routines/routine-creation-model";
import {
  routineVersionInputFromEditable,
  type EditableRoutine,
  type EditableRoutineSet,
} from "../src/client/routines/routine-exercise-editing";

function libraryExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "row",
    ownerEmail: "owner@example.com",
    name: "Cable row",
    normalizedName: "cable row",
    equipment: "cable",
    movementPattern: "horizontal pull",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "Keep the torso still.",
    muscles: [],
    isFavorite: false,
    isActive: true,
    createdAt: "now",
    updatedAt: "now",
    ...overrides,
  };
}

function editableSet(overrides: Partial<EditableRoutineSet> = {}): EditableRoutineSet {
  return {
    draftId: "set-1",
    sourceRoutineSetId: null,
    position: 1,
    setType: "regular",
    targetType: "reps",
    targetMin: 8,
    targetMax: 12,
    targetDisplay: "8-12 reps",
    targetRirMin: 1,
    targetRirMax: 2,
    restAfterSec: 90,
    restRule: "standard",
    loadInstruction: "Controlled",
    sideMode: "bilateral",
    tempo: null,
    notes: "",
    ...overrides,
  };
}

function generatedInput(): RoutineVersionInput {
  return {
    focus: "  Upper strength  ",
    summary: "  Generated draft  ",
    durationMin: 45,
    exercises: [
      {
        exerciseId: "plank",
        position: 2,
        sets: [{
          position: 1,
          setType: "regular",
          targetType: "duration",
          targetMin: 30,
          targetMax: 45,
          targetDisplay: "30-45 sec",
          targetRirMin: null,
          targetRirMax: null,
          restAfterSec: 60,
          restRule: "after_both_sides",
          loadInstruction: "",
          sideMode: "per_side",
          tempo: null,
          notes: "",
        }],
      },
      {
        exerciseId: "row",
        position: 1,
        supersetGroup: "A",
        instructions: "Pause at the torso.",
        notes: "Keep ribs down.",
        sets: [
          {
            position: 2,
            setType: "drop",
            targetType: "reps",
            targetMin: 6,
            targetMax: 8,
            targetDisplay: "6-8 reps",
            targetRirMin: 0,
            targetRirMax: 1,
            restAfterSec: 0,
            restRule: "no_rest_before_drop",
            loadInstruction: "Reduce 20%",
            sideMode: "bilateral",
            tempo: "3-1-1",
            notes: "Move directly to the drop.",
          },
          {
            position: 1,
            setType: "regular",
            targetType: "reps",
            targetMin: 8,
            targetMax: 12,
            targetDisplay: "8-12 reps",
            targetRirMin: 1,
            targetRirMax: 2,
            restAfterSec: 90,
            restRule: "after_superset",
            loadInstruction: "Controlled",
            sideMode: "bilateral",
            tempo: null,
            notes: "",
          },
        ],
      },
    ],
  };
}

function validCreationDraft(): EditableRoutine {
  return editableRoutineFromInput(generatedInput(), [
    libraryExercise(),
    libraryExercise({
      id: "plank",
      name: "Side plank",
      normalizedName: "side plank",
      trackingType: "duration",
      defaultLoadType: "bodyweight",
      sideMode: "per_side",
    }),
  ]);
}

test("creates an empty draft with the supplied target duration", () => {
  assert.deepEqual(createEmptyRoutineDraft(35), {
    focus: "",
    summary: "",
    durationMin: 35,
    exercises: [],
  });
});

test("derives short readable codes and resolves collisions case-insensitively", () => {
  assert.equal(deriveRoutineCodeCandidate("Séance jambes", []), "SJ");
  assert.equal(deriveRoutineCodeCandidate("abcdefghijklmnop", []), "ABCDEFGHIJKL");
  assert.equal(deriveRoutineCodeCandidate("---", []), "ROUTINE");
  assert.equal(
    deriveRoutineCodeCandidate("Full body strength", [" fbs ", "FBS-2"]),
    "FBS-3",
  );
});

test("validates creation fields with the routine editor rules and builds the POST payload", () => {
  const draft = validCreationDraft();
  assert.equal(validateRoutineCreationDraft(" strength ", draft), "");
  assert.equal(validateRoutineCreationDraft("   ", draft), "Routine code is required.");
  assert.equal(
    validateRoutineCreationDraft("123456789012345678901", draft),
    "Routine code must be 20 characters or fewer.",
  );
  assert.equal(
    validateRoutineCreationDraft("upper body", draft),
    "Routine code can use letters, numbers, hyphens, and underscores only.",
  );
  assert.equal(
    validateRoutineCreationDraft("/push", draft),
    "Routine code can use letters, numbers, hyphens, and underscores only.",
  );

  const invalidDraft = structuredClone(draft);
  invalidDraft.focus = "";
  assert.equal(
    validateRoutineCreationDraft("STRENGTH", invalidDraft),
    "Routine name is required.",
  );
  assert.throws(
    () => buildRoutineCreationPayload("STRENGTH", invalidDraft),
    /Routine name is required/,
  );

  const payload = buildRoutineCreationPayload(" strength ", draft);
  assert.equal(payload.code, "STRENGTH");
  assert.deepEqual(payload.version, routineVersionInputFromEditable(draft));
  assert.deepEqual(payload.version.exercises.map((exercise) => exercise.position), [1, 2]);
  assert.deepEqual(payload.version.exercises[0]!.sets.map((set) => set.position), [1, 2]);
});

test("turns generated input into a fresh editable draft without losing prescription fields", () => {
  const input = generatedInput();
  const draft = validCreationDraft();

  assert.equal(draft.focus, "Upper strength");
  assert.equal(draft.summary, "Generated draft");
  assert.deepEqual(draft.exercises.map((exercise) => exercise.exerciseName), [
    "Cable row",
    "Side plank",
  ]);
  assert.deepEqual(draft.exercises[0]!.sets.map((set) => set.position), [1, 2]);
  assert.ok(draft.exercises.every((exercise) =>
    exercise.sourceRoutineExerciseId === null && exercise.draftId.startsWith("draft:exercise:creation:")
  ));
  assert.ok(draft.exercises.flatMap((exercise) => exercise.sets).every((set) =>
    set.sourceRoutineSetId === null && set.draftId.startsWith("draft:set:creation:")
  ));
  assert.equal(
    new Set([
      ...draft.exercises.map((exercise) => exercise.draftId),
      ...draft.exercises.flatMap((exercise) => exercise.sets.map((set) => set.draftId)),
    ]).size,
    5,
  );

  assert.deepEqual(routineVersionInputFromEditable(draft), {
    ...input,
    focus: "Upper strength",
    summary: "Generated draft",
    exercises: [
      {
        ...input.exercises[1]!,
        position: 1,
        sets: [input.exercises[1]!.sets[1]!, input.exercises[1]!.sets[0]!],
      },
      {
        ...input.exercises[0]!,
        position: 2,
        supersetGroup: null,
        instructions: "",
        notes: "",
      },
    ],
  });

  assert.throws(
    () => editableRoutineFromInput(input, [libraryExercise()]),
    /Exercise plank is not available in the exercise library/,
  );
  assert.throws(
    () => editableRoutineFromInput({ ...input, focus: "" }, []),
    /Routine name is required/,
  );
});

test("estimates conservatively from upper targets, side modes, and programmed rest", () => {
  assert.deepEqual(ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS, {
    secondsPerRep: 4,
    secondsPerRound: 60,
    unilateralWorkMultiplier: 2,
  });
  const draft: EditableRoutine = {
    focus: "Mixed targets",
    summary: "",
    durationMin: 8,
    exercises: [{
      draftId: "exercise-1",
      sourceRoutineExerciseId: null,
      exerciseId: "mixed",
      exerciseName: "Mixed circuit",
      position: 1,
      supersetGroup: null,
      instructions: "",
      notes: "",
      sets: [
        editableSet({ targetType: "reps", targetMax: 12, restAfterSec: 90 }),
        editableSet({
          draftId: "set-2",
          position: 2,
          targetType: "duration",
          targetMin: 30,
          targetMax: null,
          sideMode: "per_side",
          restAfterSec: 20,
        }),
        editableSet({
          draftId: "set-3",
          position: 3,
          targetType: "rounds",
          targetMin: 1,
          targetMax: 2,
          sideMode: "per_leg",
          restAfterSec: -1,
        }),
        editableSet({
          draftId: "set-4",
          position: 4,
          targetMin: null,
          targetMax: null,
          restAfterSec: 999,
        }),
      ],
    }],
  };

  assert.deepEqual(estimateRoutineDuration(draft), {
    estimatedMinutes: 8,
    targetMinutes: 8,
    deltaMinutes: 0,
    status: "on_target",
    approximate: true,
  });
  assert.equal(
    estimateRoutineDuration({ ...draft, durationMin: 10 }).status,
    "under_target",
  );
  assert.deepEqual(estimateRoutineDuration({ ...draft, durationMin: 6 }), {
    estimatedMinutes: 8,
    targetMinutes: 6,
    deltaMinutes: 2,
    status: "over_target",
    approximate: true,
  });

  const invalidLiveDraft = structuredClone(draft);
  invalidLiveDraft.durationMin = Number.NaN;
  invalidLiveDraft.exercises[0]!.sets = [editableSet({ targetMax: Number.NaN })];
  assert.deepEqual(estimateRoutineDuration(invalidLiveDraft), {
    estimatedMinutes: 0,
    targetMinutes: 0,
    deltaMinutes: 0,
    status: "on_target",
    approximate: true,
  });
  assert.deepEqual(estimateRoutineDuration(createEmptyRoutineDraft(30)), {
    estimatedMinutes: 0,
    targetMinutes: 30,
    deltaMinutes: -30,
    status: "under_target",
    approximate: true,
  });
});

test("updates compact rest controls while retaining specialized rules by default", () => {
  const sets = [
    editableSet({ draftId: "one", restRule: "no_rest_before_drop", restAfterSec: 0 }),
    editableSet({ draftId: "two", position: 2, restRule: "emom", restAfterSec: 60 }),
    editableSet({ draftId: "three", position: 3, restRule: "after_superset", restAfterSec: 120 }),
  ];

  const between = setRestBetweenSets(sets, 75);
  assert.deepEqual(between.map((set) => [set.restAfterSec, set.restRule]), [
    [75, "no_rest_before_drop"],
    [75, "emom"],
    [120, "after_superset"],
  ]);
  assert.equal(between[2], sets[2]);
  assert.deepEqual(
    setRestBetweenSets(sets, 45, "standard").map((set) => [set.restAfterSec, set.restRule]),
    [[45, "standard"], [45, "standard"], [120, "after_superset"]],
  );

  const transition = setRestBeforeNextExercise(sets, 150);
  assert.deepEqual(transition.map((set) => [set.restAfterSec, set.restRule]), [
    [0, "no_rest_before_drop"],
    [60, "emom"],
    [150, "after_superset"],
  ]);
  assert.equal(transition[0], sets[0]);
  assert.deepEqual(
    setRestBeforeNextExercise(sets, 30, "standard").map((set) => [set.restAfterSec, set.restRule]),
    [[0, "no_rest_before_drop"], [60, "emom"], [30, "standard"]],
  );

  assert.deepEqual(setRestBetweenSets([], 0), []);
  assert.deepEqual(setRestBeforeNextExercise([], 0), []);
  assert.equal(setRestBetweenSets(sets, 1.5), sets);
  assert.equal(setRestBeforeNextExercise(sets, -1), sets);
});

test("set mutations preserve the terminal exercise-transition rest boundary", () => {
  const sets = [
    editableSet({ draftId: "one", restAfterSec: 60, restRule: "standard" }),
    editableSet({ draftId: "two", position: 2, restAfterSec: 75, restRule: "emom" }),
    editableSet({ draftId: "three", position: 3, restAfterSec: 180, restRule: "after_superset" }),
  ];

  const appended = appendRoutineSetPreservingTransition(sets);
  assert.deepEqual(appended.map((set) => [set.restAfterSec, set.restRule]), [
    [60, "standard"],
    [75, "emom"],
    [75, "emom"],
    [180, "after_superset"],
  ]);
  assert.equal(appended.at(-1)!.sourceRoutineSetId, null);

  const duplicated = duplicateRoutineSetPreservingTransition(sets, 0);
  assert.deepEqual(duplicated.map((set) => [set.draftId, set.restAfterSec]), [
    ["one", 60],
    [duplicated[1]!.draftId, 60],
    ["two", 75],
    ["three", 180],
  ]);
  assert.notEqual(duplicated[1]!.draftId, "one");
  assert.deepEqual(
    duplicateRoutineSetPreservingTransition([sets[2]!], 99).map((set) => [set.restAfterSec, set.restRule]),
    [[90, "standard"], [180, "after_superset"]],
  );

  const moved = moveRoutineSetPreservingTransition(sets, 2, -1);
  assert.deepEqual(moved.map((set) => set.draftId), ["one", "three", "two"]);
  assert.deepEqual(moved.map((set) => [set.restAfterSec, set.restRule]), [
    [60, "standard"],
    [75, "emom"],
    [180, "after_superset"],
  ]);
  assert.deepEqual(
    moveRoutineSetPreservingTransition(sets, 1, 1).map((set) => [set.draftId, set.restAfterSec, set.restRule]),
    [
      ["one", 60, "standard"],
      ["three", 75, "emom"],
      ["two", 180, "after_superset"],
    ],
  );
  assert.equal(moveRoutineSetPreservingTransition(sets, 0, -1), sets);

  const fourSets = [
    sets[0]!,
    sets[1]!,
    editableSet({ draftId: "three-internal", position: 3, restAfterSec: 105, restRule: "after_both_sides" }),
    editableSet({ draftId: "four-terminal", position: 4, restAfterSec: 180, restRule: "after_superset" }),
  ];
  const movedInternally = moveRoutineSetPreservingTransition(fourSets, 0, 1);
  assert.deepEqual(movedInternally.map((set) => [set.draftId, set.restAfterSec, set.restRule]), [
    ["two", 75, "emom"],
    ["one", 60, "standard"],
    ["three-internal", 105, "after_both_sides"],
    ["four-terminal", 180, "after_superset"],
  ]);

  const removedLast = removeRoutineSetPreservingTransition(sets, 2);
  assert.deepEqual(removedLast.map((set) => [set.draftId, set.restAfterSec, set.restRule]), [
    ["one", 60, "standard"],
    ["two", 180, "after_superset"],
  ]);
  const removedMiddle = removeRoutineSetPreservingTransition(sets, 1);
  assert.deepEqual(removedMiddle.map((set) => [set.draftId, set.restAfterSec]), [
    ["one", 60],
    ["three", 180],
  ]);
  assert.deepEqual(appendRoutineSetPreservingTransition([]), []);
  assert.deepEqual(duplicateRoutineSetPreservingTransition([], 0), []);
  assert.deepEqual(removeRoutineSetPreservingTransition([], 0), []);
  assert.equal(removeRoutineSetPreservingTransition([sets[0]!], 0)[0], sets[0]);
});

test("adds multiple selected library exercises as ordered editable placements", () => {
  const row = libraryExercise();
  const original = addExercisesToRoutineDraft(
    { ...createEmptyRoutineDraft(40), focus: "Pull" },
    [row],
  );
  original.exercises[0]!.position = 3;
  assert.equal(addExercisesToRoutineDraft(original, []), original);

  const selected = [
    libraryExercise({
      id: "plank",
      name: "Plank",
      normalizedName: "plank",
      trackingType: "duration",
      defaultLoadType: "bodyweight",
    }),
    libraryExercise({
      id: "carry",
      name: "Farmer carry",
      normalizedName: "farmer carry",
      trackingType: "rounds",
    }),
  ];
  const added = addExercisesToRoutineDraft(original, selected);
  assert.deepEqual(added.exercises.map((exercise) => [exercise.exerciseId, exercise.position]), [
    ["row", 3],
    ["plank", 4],
    ["carry", 5],
  ]);
  assert.equal(added.exercises[1]!.sets[0]!.targetType, "duration");
  assert.equal(added.exercises[2]!.sets[0]!.targetType, "rounds");
  assert.equal(original.exercises.length, 1);
});
