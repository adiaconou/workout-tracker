import type { Exercise } from "../../contracts/api";
import type {
  RestRule,
  RoutineVersionInput,
  TargetType,
} from "../../domain/entities";
import { validateRoutineVersionInput } from "../../domain/routines/validation";
import { validateRoutineDraft } from "./routine-editor-model";
import {
  createRoutineExerciseFromLibrary,
  duplicateRoutineSet,
  moveRoutineSet,
  removeRoutineSet,
  routineVersionInputFromEditable,
  type EditableRoutine,
  type EditableRoutineExercise,
  type EditableRoutineSet,
} from "./routine-exercise-editing";

const DEFAULT_INTERNAL_SET_REST_SECONDS = 90;

export type RoutineCreationPayload = {
  code: string;
  version: RoutineVersionInput;
};

export type RoutineDurationEstimateStatus =
  | "under_target"
  | "on_target"
  | "over_target";

export type RoutineDurationEstimate = {
  estimatedMinutes: number;
  targetMinutes: number;
  deltaMinutes: number;
  status: RoutineDurationEstimateStatus;
  approximate: true;
};

/**
 * A deliberately conservative, deterministic estimate for live editor feedback.
 * It uses each set's upper target, doubles unilateral work, includes programmed
 * rest except after the routine's final set, and always rounds up to a minute.
 */
export const ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS = {
  secondsPerRep: 4,
  secondsPerRound: 60,
  unilateralWorkMultiplier: 2,
} as const;

let creationDraftIdentitySequence = 0;

function creationDraftIdentity(kind: "exercise" | "set") {
  creationDraftIdentitySequence += 1;
  return `draft:${kind}:creation:${Date.now()}:${creationDraftIdentitySequence}`;
}

export function createEmptyRoutineDraft(targetDurationMin: number): EditableRoutine {
  return {
    focus: "",
    summary: "",
    durationMin: targetDurationMin,
    exercises: [],
  };
}

export function deriveRoutineCodeCandidate(
  name: string,
  existingCodes: readonly string[],
) {
  const words = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .match(/[A-Z0-9]+/g) ?? [];
  const rawBase = words.length === 0
    ? "ROUTINE"
    : words.length === 1
      ? words[0]!
      : words.map((word) => word[0]!).join("");
  const base = rawBase.slice(0, 12);
  const unavailable = new Set(existingCodes.map((code) => code.trim().toUpperCase()));
  if (!unavailable.has(base)) return base;

  for (let suffixNumber = 2; ; suffixNumber += 1) {
    const suffix = `-${suffixNumber}`;
    const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (!unavailable.has(candidate)) return candidate;
  }
}

export function validateRoutineCreationDraft(code: string, draft: EditableRoutine) {
  const normalizedCode = code.trim();
  if (!normalizedCode) return "Routine code is required.";
  if (normalizedCode.length > 20) return "Routine code must be 20 characters or fewer.";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(normalizedCode)) {
    return "Routine code can use letters, numbers, hyphens, and underscores only.";
  }

  const editorError = validateRoutineDraft(draft);
  return editorError;
}

export function buildRoutineCreationPayload(
  code: string,
  draft: EditableRoutine,
): RoutineCreationPayload {
  const validationError = validateRoutineCreationDraft(code, draft);
  if (validationError) throw new Error(validationError);
  return {
    code: code.trim().toUpperCase(),
    version: validateRoutineVersionInput(routineVersionInputFromEditable(draft)),
  };
}

export function editableRoutineFromInput(
  input: RoutineVersionInput,
  library: readonly Exercise[],
): EditableRoutine {
  const normalized = validateRoutineVersionInput(input);
  const exerciseById = new Map(library.map((exercise) => [exercise.id, exercise]));
  return {
    focus: normalized.focus,
    summary: normalized.summary,
    durationMin: normalized.durationMin,
    exercises: [...normalized.exercises]
      .sort((left, right) => left.position - right.position)
      .map((exercise): EditableRoutineExercise => {
        const libraryExercise = exerciseById.get(exercise.exerciseId);
        if (!libraryExercise) {
          throw new Error(
            `Exercise ${exercise.exerciseId} is not available in the exercise library.`,
          );
        }
        return {
          draftId: creationDraftIdentity("exercise"),
          sourceRoutineExerciseId: null,
          exerciseId: exercise.exerciseId,
          exerciseName: libraryExercise.name,
          position: exercise.position,
          supersetGroup: exercise.supersetGroup ?? null,
          instructions: exercise.instructions ?? "",
          notes: exercise.notes ?? "",
          sets: [...exercise.sets]
            .sort((left, right) => left.position - right.position)
            .map((set): EditableRoutineSet => ({
              ...set,
              draftId: creationDraftIdentity("set"),
              sourceRoutineSetId: null,
            })),
        };
      }),
  };
}

export function estimateRoutineDuration(draft: EditableRoutine): RoutineDurationEstimate {
  const sets = draft.exercises.flatMap((exercise) => exercise.sets);
  const totalSeconds = sets.reduce((total, set, index) => {
    const isFinalSet = index === sets.length - 1;
    const workSeconds = estimatedSetWorkSeconds(set);
    const restSeconds = isFinalSet ? 0 : safeNonNegative(set.restAfterSec);
    return total + workSeconds + restSeconds;
  }, 0);
  const estimatedMinutes = Math.ceil(totalSeconds / 60);
  const targetMinutes = safeNonNegative(draft.durationMin);
  const deltaMinutes = estimatedMinutes - targetMinutes;
  const status = deltaMinutes < 0
    ? "under_target"
    : deltaMinutes > 0
      ? "over_target"
      : "on_target";
  return {
    estimatedMinutes,
    targetMinutes,
    deltaMinutes,
    status,
    approximate: true,
  };
}

export function setRestBetweenSets(
  sets: EditableRoutineSet[],
  restAfterSec: number,
  restRule?: RestRule,
) {
  if (!validRestSeconds(restAfterSec)) return sets;
  return sets.map((set, index) => index === sets.length - 1
    ? set
    : {
        ...set,
        restAfterSec,
        ...(restRule === undefined ? {} : { restRule }),
      });
}

export function setRestBeforeNextExercise(
  sets: EditableRoutineSet[],
  restAfterSec: number,
  restRule?: RestRule,
) {
  if (!validRestSeconds(restAfterSec)) return sets;
  return sets.map((set, index) => index !== sets.length - 1
    ? set
    : {
        ...set,
        restAfterSec,
        ...(restRule === undefined ? {} : { restRule }),
      });
}

export function appendRoutineSetPreservingTransition(
  sets: EditableRoutineSet[],
) {
  return duplicateRoutineSetPreservingTransition(sets, sets.length - 1);
}

export function duplicateRoutineSetPreservingTransition(
  sets: EditableRoutineSet[],
  index: number,
) {
  const sourceIndex = sets[index] ? index : sets.length - 1;
  const terminal = sets.at(-1);
  if (!terminal) return sets;
  const next = duplicateRoutineSet(sets, sourceIndex);

  if (sourceIndex === sets.length - 1) {
    const internal = sets.at(-2);
    next[sourceIndex] = {
      ...next[sourceIndex]!,
      restAfterSec: internal?.restAfterSec ?? DEFAULT_INTERNAL_SET_REST_SECONDS,
      restRule: internal?.restRule ?? "standard",
    };
  }
  return withTerminalTransition(next, terminal);
}

export function moveRoutineSetPreservingTransition(
  sets: EditableRoutineSet[],
  index: number,
  direction: -1 | 1,
) {
  const next = moveRoutineSet(sets, index, direction);
  if (next === sets) return sets;
  const terminalIndex = sets.length - 1;
  const destination = index + direction;
  if (index !== terminalIndex && destination !== terminalIndex) return next;

  const internal = sets[terminalIndex - 1]!;
  const terminal = sets[terminalIndex]!;
  return next.map((set, position) => position === terminalIndex - 1
    ? { ...set, restAfterSec: internal.restAfterSec, restRule: internal.restRule }
    : position === terminalIndex
      ? { ...set, restAfterSec: terminal.restAfterSec, restRule: terminal.restRule }
      : set);
}

export function removeRoutineSetPreservingTransition(
  sets: EditableRoutineSet[],
  index: number,
) {
  const terminal = sets.at(-1);
  if (!terminal) return sets;
  const next = removeRoutineSet(sets, index);
  return next === sets ? sets : withTerminalTransition(next, terminal);
}

export function addExercisesToRoutineDraft(
  draft: EditableRoutine,
  selected: readonly Exercise[],
): EditableRoutine {
  if (selected.length === 0) return draft;
  const startingPosition = draft.exercises.reduce(
    (highest, exercise) => Math.max(highest, exercise.position),
    0,
  ) + 1;
  return {
    ...draft,
    exercises: [
      ...draft.exercises,
      ...selected.map((exercise, index) =>
        createRoutineExerciseFromLibrary(exercise, startingPosition + index)
      ),
    ],
  };
}

function estimatedSetWorkSeconds(set: EditableRoutineSet) {
  const upperTarget = safeNonNegative(set.targetMax ?? set.targetMin ?? 0);
  const baseSeconds = secondsForTarget(set.targetType, upperTarget);
  const sideMultiplier = set.sideMode === "bilateral"
    ? 1
    : ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS.unilateralWorkMultiplier;
  return baseSeconds * sideMultiplier;
}

function withTerminalTransition(
  sets: EditableRoutineSet[],
  terminal: Pick<EditableRoutineSet, "restAfterSec" | "restRule">,
) {
  return sets.map((set, index) => index === sets.length - 1
    ? { ...set, restAfterSec: terminal.restAfterSec, restRule: terminal.restRule }
    : set);
}

function secondsForTarget(targetType: TargetType, target: number) {
  if (targetType === "duration") return target;
  if (targetType === "rounds") {
    return target * ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS.secondsPerRound;
  }
  return target * ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS.secondsPerRep;
}

function safeNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function validRestSeconds(restAfterSec: number) {
  return Number.isInteger(restAfterSec) && restAfterSec >= 0;
}
