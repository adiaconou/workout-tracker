import type { Exercise } from "../../contracts/api";
import type {
  RoutineExerciseInput,
  RoutineSetInput,
  RoutineVersion,
  RoutineVersionInput,
} from "../../domain/entities";

export type EditableRoutineSet = RoutineSetInput & {
  draftId: string;
  sourceRoutineSetId: string | null;
};

export type EditableRoutineExercise = Omit<RoutineExerciseInput, "sets"> & {
  draftId: string;
  sourceRoutineExerciseId: string | null;
  exerciseName: string;
  sets: EditableRoutineSet[];
};

export type EditableRoutine = Omit<RoutineVersionInput, "exercises"> & {
  exercises: EditableRoutineExercise[];
};

let draftIdentitySequence = 0;

function draftIdentity(kind: "exercise" | "set") {
  draftIdentitySequence += 1;
  return `draft:${kind}:${Date.now()}:${draftIdentitySequence}`;
}

function reindexSets(sets: EditableRoutineSet[]) {
  return sets.map((set, index) => ({ ...set, position: index + 1 }));
}

function reindexExercises(exercises: EditableRoutineExercise[]) {
  return exercises.map((exercise, index) => ({
    ...exercise,
    position: index + 1,
    sets: reindexSets(exercise.sets),
  }));
}

export function editableRoutineFromVersion(version: RoutineVersion): EditableRoutine {
  return {
    focus: version.focus,
    summary: version.summary,
    durationMin: version.durationMin,
    exercises: [...version.exercises]
      .sort((left, right) => left.position - right.position)
      .map((exercise) => ({
        draftId: exercise.id,
        sourceRoutineExerciseId: exercise.id,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        position: exercise.position,
        supersetGroup: exercise.supersetGroup ?? null,
        instructions: exercise.instructions ?? "",
        notes: exercise.notes ?? "",
        sets: [...exercise.sets]
          .sort((left, right) => left.position - right.position)
          .map((set) => ({
            draftId: set.id,
            sourceRoutineSetId: set.id,
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
  };
}

export function routineVersionInputFromEditable(draft: EditableRoutine): RoutineVersionInput {
  return {
    focus: draft.focus,
    summary: draft.summary,
    durationMin: draft.durationMin,
    exercises: reindexExercises(draft.exercises).map((exercise) => ({
      exerciseId: exercise.exerciseId,
      position: exercise.position,
      supersetGroup: exercise.supersetGroup ?? null,
      instructions: exercise.instructions ?? "",
      notes: exercise.notes ?? "",
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
        tempo: set.tempo ?? null,
        notes: set.notes,
      })),
    })),
  };
}

export function isRoutineDraftDirty(version: RoutineVersion, draft: EditableRoutine) {
  return JSON.stringify(routineVersionInputFromVersion(version)) !==
    JSON.stringify(routineVersionInputFromEditable(draft));
}

function routineVersionInputFromVersion(version: RoutineVersion): RoutineVersionInput {
  return routineVersionInputFromEditable(editableRoutineFromVersion(version));
}

export function moveRoutineExercise(
  exercises: EditableRoutineExercise[],
  index: number,
  direction: -1 | 1,
) {
  const destination = index + direction;
  if (index < 0 || index >= exercises.length || destination < 0 || destination >= exercises.length) {
    return exercises;
  }
  const reordered = [...exercises];
  [reordered[index], reordered[destination]] = [reordered[destination]!, reordered[index]!];
  return reindexExercises(reordered);
}

export function removeRoutineExercise(exercises: EditableRoutineExercise[], index: number) {
  if (exercises.length <= 1 || index < 0 || index >= exercises.length) return exercises;
  return reindexExercises(exercises.filter((_, exerciseIndex) => exerciseIndex !== index));
}

export function moveRoutineSet(sets: EditableRoutineSet[], index: number, direction: -1 | 1) {
  const destination = index + direction;
  if (index < 0 || index >= sets.length || destination < 0 || destination >= sets.length) return sets;
  const reordered = [...sets];
  [reordered[index], reordered[destination]] = [reordered[destination]!, reordered[index]!];
  return reindexSets(reordered);
}

export function removeRoutineSet(sets: EditableRoutineSet[], index: number) {
  if (sets.length <= 1 || index < 0 || index >= sets.length) return sets;
  return reindexSets(sets.filter((_, setIndex) => setIndex !== index));
}

export function duplicateRoutineSet(sets: EditableRoutineSet[], index = sets.length - 1) {
  const source = sets[index] ?? sets[sets.length - 1];
  if (!source) return sets;
  const duplicate: EditableRoutineSet = {
    ...source,
    draftId: draftIdentity("set"),
    sourceRoutineSetId: null,
    position: index + 2,
  };
  const next = [...sets];
  next.splice(index + 1, 0, duplicate);
  return reindexSets(next);
}

export function createRoutineExerciseFromLibrary(
  exercise: Exercise,
  position: number,
): EditableRoutineExercise {
  const target = exercise.trackingType === "duration"
    ? { display: "30 sec", min: 30, max: 30 }
    : exercise.trackingType === "rounds"
      ? { display: "3 rounds", min: 3, max: 3 }
      : { display: "8-12 reps", min: 8, max: 12 };
  const sets = Array.from({ length: 3 }, (_, index): EditableRoutineSet => ({
    draftId: draftIdentity("set"),
    sourceRoutineSetId: null,
    position: index + 1,
    setType: "regular",
    targetType: exercise.trackingType,
    targetMin: target.min,
    targetMax: target.max,
    targetDisplay: target.display,
    targetRirMin: exercise.trackingType === "reps" ? 2 : null,
    targetRirMax: exercise.trackingType === "reps" ? 2 : null,
    restAfterSec: 90,
    restRule: "standard",
    loadInstruction: "",
    sideMode: exercise.sideMode,
    tempo: null,
    notes: "",
  }));
  return {
    draftId: draftIdentity("exercise"),
    sourceRoutineExerciseId: null,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    position,
    supersetGroup: null,
    instructions: exercise.instructions,
    notes: "",
    sets,
  };
}
