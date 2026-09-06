import type { Exercise, RoutineVersion } from "../../domain/entities";
import { completeRoutineChangeProposal, type CoachRoutineProposal } from "./routine-change";

const nullableNumber = { type: ["number", "null"], minimum: 0 };
const setSelection = { placementId: { type: "string" }, setIds: { type: "array", minItems: 1, items: { type: "string" } } };

function rangeValue(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Targets must be non-negative numbers or null.");
  return value;
}

export function routineProposalFromVersion(current: RoutineVersion): CoachRoutineProposal {
  return { focus: current.focus, summary: current.summary, durationMin: current.durationMin,
    exercises: current.exercises.map((placement) => ({
      sourceRoutineExerciseId: placement.id, exerciseId: placement.exerciseId,
      position: placement.position, supersetGroup: placement.supersetGroup,
      instructions: placement.instructions, notes: placement.notes,
      sets: placement.sets.map(({ id, ownerEmail: _owner, routineExerciseId: _placement,
        createdAt: _created, updatedAt: _updated, ...set }) => ({ ...set, sourceRoutineSetId: id })),
    })),
  };
}

export function applyCoachRoutineEdits(current: RoutineVersion, value: unknown, library: readonly Exercise[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new Error("Provide between 1 and 50 routine edits.");
  const proposal = routineProposalFromVersion(current);
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A routine edit must be an object.");
    const edit = raw as Record<string, unknown>;
    if (edit.type === "reorder") {
      const ids = edit.placementIds;
      if (!Array.isArray(ids) || ids.length !== proposal.exercises.length || new Set(ids).size !== ids.length
        || ids.some((id) => !proposal.exercises.some((placement) => placement.sourceRoutineExerciseId === id))) {
        throw new Error("Reordering must include every current placement ID exactly once.");
      }
      proposal.exercises.forEach((placement) => { placement.position = ids.indexOf(placement.sourceRoutineExerciseId) + 1; });
      continue;
    }
    const placement = proposal.exercises.find((candidate) => candidate.sourceRoutineExerciseId === edit.placementId);
    if (!placement) throw new Error("The edit references a placement outside this routine version.");
    if (edit.type === "replace_exercise") {
      const original = library.find((exercise) => exercise.id === placement.exerciseId);
      const replacement = library.find((exercise) => exercise.id === edit.exerciseId);
      if (!original || !replacement || !replacement.isActive
        || original.trackingType !== replacement.trackingType || original.sideMode !== replacement.sideMode
        || original.defaultLoadType !== replacement.defaultLoadType) {
        throw new Error("This replacement needs a complete prescription because its tracking, side, or load mode differs.");
      }
      placement.exerciseId = replacement.id;
      continue;
    }
    const ids = edit.setIds;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length
      || ids.some((id) => !placement.sets.some((set) => set.sourceRoutineSetId === id))) {
      throw new Error("Set edits must reference unique existing sets in the selected placement.");
    }
    for (const set of placement.sets.filter((candidate) => ids.includes(candidate.sourceRoutineSetId))) {
      if (edit.type === "set_targets") {
        set.targetMin = rangeValue(edit.minimum);
        set.targetMax = rangeValue(edit.maximum);
        if (typeof edit.display !== "string" || !edit.display.trim()) throw new Error("Target display is required.");
        set.targetDisplay = edit.display.trim();
      } else if (edit.type === "set_rir") {
        set.targetRirMin = rangeValue(edit.minimum);
        set.targetRirMax = rangeValue(edit.maximum);
      } else if (edit.type === "set_rest") {
        set.restAfterSec = edit.seconds as number;
      } else if (edit.type === "set_load_instruction") {
        if (typeof edit.instruction !== "string" || edit.instruction.length > 1_000) throw new Error("Load instruction is invalid.");
        set.loadInstruction = edit.instruction.trim();
      } else throw new Error("Routine edit type is invalid.");
    }
  }
  return completeRoutineChangeProposal(current, proposal).proposal;
}

export const routineEditOperationSchema = {
  anyOf: [
    operation("set_targets", { ...setSelection, minimum: nullableNumber, maximum: nullableNumber, display: { type: "string" } }),
    operation("set_rir", { ...setSelection, minimum: nullableNumber, maximum: nullableNumber }),
    operation("set_rest", { ...setSelection, seconds: { type: "integer", minimum: 0 } }),
    operation("set_load_instruction", { ...setSelection, instruction: { type: "string", maxLength: 1_000 } }),
    operation("replace_exercise", { placementId: { type: "string" }, exerciseId: { type: "string" } }),
    operation("reorder", { placementIds: { type: "array", minItems: 1, items: { type: "string" } } }),
  ],
};

function operation(type: string, properties: Record<string, unknown>) {
  return { type: "object", properties: { type: { type: "string", enum: [type] }, ...properties },
    required: ["type", ...Object.keys(properties)], additionalProperties: false };
}
