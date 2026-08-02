import assert from "node:assert/strict";
import test from "node:test";
import type { Exercise, RoutineVersion } from "../domain/entities";
import {
  createRoutineExerciseFromLibrary,
  duplicateRoutineSet,
  editableRoutineFromVersion,
  isRoutineDraftDirty,
  moveRoutineExercise,
  removeRoutineExercise,
  routineVersionInputFromEditable,
} from "../src/features/routines/routine-exercise-editing";

function versionFixture(): RoutineVersion {
  const common = {
    ownerEmail: "owner@example.com",
    routineVersionId: "version-7",
    exerciseId: "exercise-shared",
    exerciseName: "Cable row",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  return {
    id: "version-7",
    ownerEmail: "owner@example.com",
    routineId: "routine-a",
    versionNumber: 7,
    status: "published",
    focus: "Strength",
    summary: "Exact normalized prescription",
    durationMin: 48,
    exercises: [
      {
        ...common,
        id: "placement-second",
        position: 2,
        supersetGroup: " B2 ",
        instructions: "Second placement instructions",
        notes: "Second placement notes",
        sets: [{
          id: "set-second",
          ownerEmail: common.ownerEmail,
          routineExerciseId: "placement-second",
          position: 1,
          setType: "drop",
          targetType: "duration",
          targetMin: 35,
          targetMax: 45,
          targetDisplay: "35-45 sec",
          targetRirMin: null,
          targetRirMax: null,
          restAfterSec: 0,
          restRule: "no_rest_before_drop",
          loadInstruction: "Reduce by 20%",
          sideMode: "left_right",
          tempo: " 3-1-1 ",
          notes: "Drop immediately",
          createdAt: common.createdAt,
          updatedAt: common.updatedAt,
        }],
      },
      {
        ...common,
        id: "placement-first",
        position: 1,
        supersetGroup: "A1",
        instructions: "Pause at contraction",
        notes: "First placement notes",
        sets: [{
          id: "set-first",
          ownerEmail: common.ownerEmail,
          routineExerciseId: "placement-first",
          position: 1,
          setType: "test",
          targetType: "reps",
          targetMin: 4,
          targetMax: 6,
          targetDisplay: "4-6 reps",
          targetRirMin: 0,
          targetRirMax: 1,
          restAfterSec: 180,
          restRule: "after_superset",
          loadInstruction: "Use a challenging fixed load",
          sideMode: "per_side",
          tempo: null,
          notes: "Stop if form changes",
          createdAt: common.createdAt,
          updatedAt: common.updatedAt,
        }],
      },
    ],
    createdAt: common.createdAt,
    publishedAt: common.updatedAt,
    updatedAt: common.updatedAt,
  };
}

function libraryExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "library-exercise",
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

test("round-trips every normalized placement and set field without loss", () => {
  const version = versionFixture();
  const input = routineVersionInputFromEditable(editableRoutineFromVersion(version));

  assert.deepEqual(input, {
    focus: version.focus,
    summary: version.summary,
    durationMin: version.durationMin,
    exercises: [...version.exercises]
      .sort((left, right) => left.position - right.position)
      .map((exercise) => ({
        exerciseId: exercise.exerciseId,
        position: exercise.position,
        supersetGroup: exercise.supersetGroup,
        instructions: exercise.instructions,
        notes: exercise.notes,
        sets: exercise.sets.map((set) => ({
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
  });
});

test("duplicate exercise placements move and remove by placement identity", () => {
  const original = editableRoutineFromVersion(versionFixture()).exercises;
  assert.equal(original[0].exerciseId, original[1].exerciseId);
  assert.notEqual(original[0].draftId, original[1].draftId);

  const moved = moveRoutineExercise(original, 1, -1);
  assert.deepEqual(moved.map((exercise) => exercise.draftId), ["placement-second", "placement-first"]);
  assert.deepEqual(moved.map((exercise) => exercise.position), [1, 2]);

  const remaining = removeRoutineExercise(moved, 1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].draftId, "placement-second");
  assert.equal(remaining[0].exerciseId, "exercise-shared");
  assert.equal(removeRoutineExercise(remaining, 0), remaining);
});

test("dirty detection ignores local identities but catches exact prescription changes", () => {
  const version = versionFixture();
  const draft = editableRoutineFromVersion(version);
  assert.equal(isRoutineDraftDirty(version, draft), false);

  const identityOnly = {
    ...draft,
    exercises: draft.exercises.map((exercise) => ({
      ...exercise,
      draftId: `local-${exercise.draftId}`,
      sourceRoutineExerciseId: null,
      sets: exercise.sets.map((set) => ({
        ...set,
        draftId: `local-${set.draftId}`,
        sourceRoutineSetId: null,
      })),
    })),
  };
  assert.equal(isRoutineDraftDirty(version, identityOnly), false);

  const changed = structuredClone(draft);
  changed.exercises[0].sets[0].restRule = "emom";
  assert.equal(isRoutineDraftDirty(version, changed), true);
});

test("new and duplicated sets are complete normalized inputs", () => {
  const exercise = createRoutineExerciseFromLibrary(libraryExercise(), 3);
  assert.equal(exercise.exerciseId, "library-exercise");
  assert.equal(exercise.exerciseName, "Cable row");
  assert.equal(exercise.instructions, "Keep the torso still.");
  assert.equal(exercise.sets.length, 3);
  assert.deepEqual(exercise.sets.map((set) => set.position), [1, 2, 3]);
  assert.ok(exercise.sets.every((set) => set.targetDisplay === "8-12 reps" && set.targetRirMin === 2));

  const duplicated = duplicateRoutineSet(exercise.sets, 0);
  assert.equal(duplicated.length, 4);
  assert.deepEqual(duplicated.map((set) => set.position), [1, 2, 3, 4]);
  assert.equal(duplicated[1].sourceRoutineSetId, null);
  assert.notEqual(duplicated[0].draftId, duplicated[1].draftId);
});

test("uses duration and rounds defaults for matching library tracking types", () => {
  const duration = createRoutineExerciseFromLibrary(
    libraryExercise({ id: "plank", trackingType: "duration", sideMode: "per_side" }),
    1,
  );
  assert.ok(duration.sets.every((set) =>
    set.targetType === "duration" && set.targetDisplay === "30 sec" && set.targetRirMin === null && set.sideMode === "per_side"
  ));

  const rounds = createRoutineExerciseFromLibrary(
    libraryExercise({ id: "carry", trackingType: "rounds" }),
    2,
  );
  assert.ok(rounds.sets.every((set) => set.targetType === "rounds" && set.targetDisplay === "3 rounds"));
});
