import assert from "node:assert/strict";
import test from "node:test";
import type { RoutineVersion } from "../src/domain/entities";
import {
  createRoutineEditorSaveRequest,
  deriveRoutineEditorModel,
  routineEditorRefreshDecision,
  validateRoutineDraft,
  type RoutineEditorSnapshot,
} from "../src/client/routines/routine-editor-model";
import {
  editableRoutineFromVersion,
  type EditableRoutine,
} from "../src/client/routines/routine-exercise-editing";

function versionFixture(): RoutineVersion {
  return {
    id: "version-7",
    ownerEmail: "owner@example.com",
    routineId: "routine-a",
    versionNumber: 7,
    status: "published",
    focus: "Strength",
    summary: "A complete routine",
    durationMin: 45,
    exercises: [{
      id: "placement-1",
      ownerEmail: "owner@example.com",
      routineVersionId: "version-7",
      exerciseId: "exercise-1",
      exerciseName: "Cable row",
      position: 1,
      supersetGroup: null,
      instructions: "Stay tall.",
      notes: "",
      sets: [{
        id: "set-1",
        ownerEmail: "owner@example.com",
        routineExerciseId: "placement-1",
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
        loadInstruction: "Use a controlled load.",
        sideMode: "bilateral",
        tempo: null,
        notes: "",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    }],
    createdAt: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function draftFixture() {
  return editableRoutineFromVersion(versionFixture());
}

function changedDraft() {
  const draft = draftFixture();
  draft.summary = "Changed summary";
  return draft;
}

function validationFor(change: (draft: EditableRoutine) => void) {
  const draft = draftFixture();
  change(draft);
  return validateRoutineDraft(draft);
}

test("validates routine-level fields and requires exercises and sets", () => {
  assert.equal(validateRoutineDraft(draftFixture()), "");
  assert.equal(validationFor((draft) => { draft.focus = "   "; }), "Routine name is required.");

  for (const duration of [4.5, 4, 301]) {
    assert.equal(
      validationFor((draft) => { draft.durationMin = duration; }),
      "Estimated minutes must be a whole number between 5 and 300.",
    );
  }
  for (const duration of [5, 300]) {
    assert.equal(validationFor((draft) => { draft.durationMin = duration; }), "");
  }

  assert.equal(
    validationFor((draft) => { draft.exercises = []; }),
    "A routine needs at least one exercise.",
  );
  assert.equal(
    validationFor((draft) => { draft.exercises[0]!.sets = []; }),
    "Cable row needs at least one set.",
  );
});

test("validates every target value without collapsing field-specific branches", () => {
  assert.equal(
    validationFor((draft) => { draft.exercises[0]!.sets[0]!.targetDisplay = " "; }),
    "Cable row set 1 needs a display target.",
  );

  for (const field of ["targetMin", "targetMax", "targetRirMin", "targetRirMax"] as const) {
    assert.equal(
      validationFor((draft) => { draft.exercises[0]!.sets[0]![field] = -1; }),
      "Cable row set 1 has an invalid target or RIR value.",
    );
  }
  assert.equal(
    validationFor((draft) => { draft.exercises[0]!.sets[0]!.targetMin = Number.NaN; }),
    "Cable row set 1 has an invalid target or RIR value.",
  );

  assert.equal(validationFor((draft) => {
    const set = draft.exercises[0]!.sets[0]!;
    set.targetMin = null;
    set.targetMax = null;
    set.targetRirMin = null;
    set.targetRirMax = null;
  }), "");
});

test("validates target ranges, RIR ranges, and rest duration", () => {
  assert.equal(
    validationFor((draft) => {
      draft.exercises[0]!.sets[0]!.targetMin = 13;
      draft.exercises[0]!.sets[0]!.targetMax = 12;
    }),
    "Cable row set 1 minimum cannot exceed its maximum.",
  );
  assert.equal(validationFor((draft) => {
    draft.exercises[0]!.sets[0]!.targetMin = null;
  }), "");
  assert.equal(validationFor((draft) => {
    draft.exercises[0]!.sets[0]!.targetMax = null;
  }), "");

  assert.equal(
    validationFor((draft) => {
      draft.exercises[0]!.sets[0]!.targetRirMin = 3;
      draft.exercises[0]!.sets[0]!.targetRirMax = 2;
    }),
    "Cable row set 1 RIR minimum cannot exceed its maximum.",
  );
  assert.equal(validationFor((draft) => {
    draft.exercises[0]!.sets[0]!.targetRirMin = null;
  }), "");
  assert.equal(validationFor((draft) => {
    draft.exercises[0]!.sets[0]!.targetRirMax = null;
  }), "");

  for (const restAfterSec of [1.5, -1]) {
    assert.equal(
      validationFor((draft) => { draft.exercises[0]!.sets[0]!.restAfterSec = restAfterSec; }),
      "Cable row set 1 rest must be a non-negative whole number.",
    );
  }
  assert.equal(validationFor((draft) => { draft.exercises[0]!.sets[0]!.restAfterSec = 0; }), "");
});

test("derives clean, dirty, invalid, and stale editor states", () => {
  const version = versionFixture();
  const cleanDraft = draftFixture();

  assert.deepEqual(deriveRoutineEditorModel({
    editing: false,
    currentVersion: version,
    draft: cleanDraft,
    stale: false,
  }), {
    snapshot: { editing: false, dirty: false, currentVersionId: "version-7" },
    validationError: "",
    canSave: false,
  });
  assert.deepEqual(deriveRoutineEditorModel({
    editing: true,
    currentVersion: null,
    draft: cleanDraft,
    stale: false,
  }), {
    snapshot: { editing: true, dirty: false, currentVersionId: null },
    validationError: "",
    canSave: false,
  });
  assert.deepEqual(deriveRoutineEditorModel({
    editing: true,
    currentVersion: version,
    draft: null,
    stale: false,
  }), {
    snapshot: { editing: true, dirty: false, currentVersionId: "version-7" },
    validationError: "",
    canSave: false,
  });
  assert.equal(deriveRoutineEditorModel({
    editing: true,
    currentVersion: version,
    draft: cleanDraft,
    stale: false,
  }).snapshot.dirty, false);

  const changed = changedDraft();
  const ready = deriveRoutineEditorModel({
    editing: true,
    currentVersion: version,
    draft: changed,
    stale: false,
  });
  assert.equal(ready.snapshot.dirty, true);
  assert.equal(ready.validationError, "");
  assert.equal(ready.canSave, true);
  assert.equal(deriveRoutineEditorModel({
    editing: true,
    currentVersion: version,
    draft: changed,
    stale: true,
  }).canSave, false);

  changed.focus = "";
  const invalid = deriveRoutineEditorModel({
    editing: true,
    currentVersion: version,
    draft: changed,
    stale: false,
  });
  assert.equal(invalid.snapshot.dirty, true);
  assert.equal(invalid.validationError, "Routine name is required.");
  assert.equal(invalid.canSave, false);
});

test("preserves only dirty edits and distinguishes no-op refreshes from stale versions", () => {
  const base: RoutineEditorSnapshot = {
    editing: true,
    dirty: true,
    currentVersionId: "version-7",
  };
  assert.deepEqual(routineEditorRefreshDecision({
    force: true,
    editor: base,
    incomingVersionId: "version-7",
  }), { preserveDraft: false, markStale: false, resetDisclosure: false });
  assert.deepEqual(routineEditorRefreshDecision({
    force: false,
    editor: { ...base, editing: false },
    incomingVersionId: "version-8",
  }), { preserveDraft: false, markStale: false, resetDisclosure: true });
  assert.deepEqual(routineEditorRefreshDecision({
    force: false,
    editor: { ...base, dirty: false },
    incomingVersionId: "version-7",
  }), { preserveDraft: false, markStale: false, resetDisclosure: false });
  assert.deepEqual(routineEditorRefreshDecision({
    force: false,
    editor: base,
    incomingVersionId: "version-7",
  }), { preserveDraft: true, markStale: false, resetDisclosure: false });
  assert.deepEqual(routineEditorRefreshDecision({
    force: false,
    editor: base,
    incomingVersionId: "version-8",
  }), { preserveDraft: true, markStale: true, resetDisclosure: false });
});

test("creates a normalized save request only when every save precondition passes", () => {
  const version = versionFixture();
  const draft = changedDraft();
  const input = {
    draft,
    routineId: "routine-a",
    currentVersion: version,
    canSave: true,
    saving: false,
  };

  assert.equal(createRoutineEditorSaveRequest({ ...input, draft: null }), null);
  assert.equal(createRoutineEditorSaveRequest({ ...input, routineId: null }), null);
  assert.equal(createRoutineEditorSaveRequest({ ...input, currentVersion: null }), null);
  assert.equal(createRoutineEditorSaveRequest({ ...input, canSave: false }), null);
  assert.equal(createRoutineEditorSaveRequest({ ...input, saving: true }), null);

  draft.exercises[0]!.position = 4;
  draft.exercises[0]!.sets[0]!.position = 8;
  const request = createRoutineEditorSaveRequest(input);
  assert.equal(request?.routineId, "routine-a");
  assert.equal(request?.payload.baseVersionId, "version-7");
  assert.equal(request?.payload.proposedRoutine.summary, "Changed summary");
  assert.equal(request?.payload.proposedRoutine.exercises[0]?.position, 1);
  assert.equal(request?.payload.proposedRoutine.exercises[0]?.sets[0]?.position, 1);
});
