import type { RoutineVersion, RoutineVersionInput } from "../../domain/entities";
import {
  isRoutineDraftDirty,
  routineVersionInputFromEditable,
  type EditableRoutine,
} from "./routine-exercise-editing";

export type RoutineEditorSnapshot = {
  editing: boolean;
  dirty: boolean;
  currentVersionId: string | null;
};

export type RoutineEditorModel = {
  snapshot: RoutineEditorSnapshot;
  validationError: string;
  canSave: boolean;
};

export type RoutineEditorSaveRequest = {
  routineId: string;
  payload: {
    baseVersionId: string;
    proposedRoutine: RoutineVersionInput;
  };
};

export function validateRoutineDraft(draft: EditableRoutine) {
  if (!draft.focus.trim()) return "Routine name is required.";
  if (!Number.isInteger(draft.durationMin) || draft.durationMin < 5 || draft.durationMin > 300) {
    return "Estimated minutes must be a whole number between 5 and 300.";
  }
  if (!draft.exercises.length) return "A routine needs at least one exercise.";
  for (const exercise of draft.exercises) {
    if (!exercise.sets.length) return `${exercise.exerciseName} needs at least one set.`;
    for (const set of exercise.sets) {
      if (!set.targetDisplay.trim()) {
        return `${exercise.exerciseName} set ${set.position} needs a display target.`;
      }
      if (
        !nonNegativeOrNull(set.targetMin) ||
        !nonNegativeOrNull(set.targetMax) ||
        !nonNegativeOrNull(set.targetRirMin) ||
        !nonNegativeOrNull(set.targetRirMax)
      ) {
        return `${exercise.exerciseName} set ${set.position} has an invalid target or RIR value.`;
      }
      if (set.targetMin !== null && set.targetMax !== null && set.targetMin > set.targetMax) {
        return `${exercise.exerciseName} set ${set.position} minimum cannot exceed its maximum.`;
      }
      if (
        set.targetRirMin !== null &&
        set.targetRirMax !== null &&
        set.targetRirMin > set.targetRirMax
      ) {
        return `${exercise.exerciseName} set ${set.position} RIR minimum cannot exceed its maximum.`;
      }
      if (!Number.isInteger(set.restAfterSec) || set.restAfterSec < 0) {
        return `${exercise.exerciseName} set ${set.position} rest must be a non-negative whole number.`;
      }
    }
  }
  return "";
}

export function deriveRoutineEditorModel({
  editing,
  currentVersion,
  draft,
  stale,
}: {
  editing: boolean;
  currentVersion: RoutineVersion | null;
  draft: EditableRoutine | null;
  stale: boolean;
}): RoutineEditorModel {
  const dirty = Boolean(
    editing && currentVersion && draft && isRoutineDraftDirty(currentVersion, draft),
  );
  const validationError = editing && draft ? validateRoutineDraft(draft) : "";
  return {
    snapshot: {
      editing,
      dirty,
      currentVersionId: currentVersion?.id ?? null,
    },
    validationError,
    canSave: dirty && !validationError && !stale,
  };
}

export function routineEditorRefreshDecision({
  force,
  editor,
  incomingVersionId,
}: {
  force: boolean;
  editor: RoutineEditorSnapshot;
  incomingVersionId: string | null;
}) {
  const preserveDraft = !force && editor.editing && editor.dirty;
  const versionChanged = incomingVersionId !== editor.currentVersionId;
  return {
    preserveDraft,
    markStale: preserveDraft && versionChanged,
    resetDisclosure: !preserveDraft && versionChanged,
  };
}

export function createRoutineEditorSaveRequest({
  draft,
  routineId,
  currentVersion,
  canSave,
  saving,
}: {
  draft: EditableRoutine | null;
  routineId: string | null;
  currentVersion: RoutineVersion | null;
  canSave: boolean;
  saving: boolean;
}): RoutineEditorSaveRequest | null {
  if (!draft || !routineId || !currentVersion || !canSave || saving) return null;
  return {
    routineId,
    payload: {
      baseVersionId: currentVersion.id,
      proposedRoutine: routineVersionInputFromEditable(draft),
    },
  };
}

function nonNegativeOrNull(value: number | null) {
  return value === null || (Number.isFinite(value) && value >= 0);
}
