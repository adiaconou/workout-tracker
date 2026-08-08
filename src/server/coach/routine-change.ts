import { validateRoutineVersionInput } from "../../domain/routines/validation";
import type {
  RoutineAggregate,
  RoutineExercise,
  RoutineExerciseInput,
  RoutineSet,
  RoutineSetInput,
  RoutineVersion,
  RoutineVersionInput,
} from "../../domain/entities";

type ExerciseLibraryEntry = { id: string; name: string };
type SetShape = RoutineSet | RoutineSetInput;

export type CoachRoutineSetProposal = RoutineSetInput & {
  sourceRoutineSetId: string | null;
};

export type CoachRoutineExerciseProposal = Omit<RoutineExerciseInput, "sets"> & {
  sourceRoutineExerciseId: string | null;
  sets: CoachRoutineSetProposal[];
};

export type CoachRoutineProposal = Omit<RoutineVersionInput, "exercises"> & {
  exercises: CoachRoutineExerciseProposal[];
};

type RoutineProposalMode = "create" | "update";

const setFields = [
  ["position", "position"],
  ["setType", "type"],
  ["targetType", "target type"],
  ["targetMin", "target minimum"],
  ["targetMax", "target maximum"],
  ["targetDisplay", "display target"],
  ["targetRirMin", "RIR minimum"],
  ["targetRirMax", "RIR maximum"],
  ["restAfterSec", "rest seconds"],
  ["restRule", "rest rule"],
  ["loadInstruction", "load instruction"],
  ["sideMode", "side mode"],
  ["tempo", "tempo"],
  ["notes", "notes"],
] as const satisfies ReadonlyArray<readonly [keyof RoutineSetInput, string]>;

export function completeRoutineChangeProposal(current: RoutineVersion, value: unknown) {
  return completeRoutineProposal(current, value, "update");
}

export function completeRoutineCreationProposal(value: unknown) {
  return completeRoutineProposal(null, value, "create");
}

function completeRoutineProposal(
  current: RoutineVersion | null,
  value: unknown,
  mode: RoutineProposalMode,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A complete proposed routine is required.");
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.exercises)) throw new Error("A proposed routine needs exercises.");

  const currentPlacements = new Map(current?.exercises.map((exercise) => [exercise.id, exercise]) ?? []);
  const usedPlacementIds = new Set<string>();
  const usedSetIds = new Set<string>();
  const identityExercises = raw.exercises.map((exerciseValue, exerciseIndex) => {
    if (!exerciseValue || typeof exerciseValue !== "object" || Array.isArray(exerciseValue)) {
      throw new Error(`Proposed exercise ${exerciseIndex + 1} is invalid.`);
    }
    const exercise = exerciseValue as Record<string, unknown>;
    const sourceRoutineExerciseId = sourceId(
      exercise.sourceRoutineExerciseId,
      `Proposed exercise ${exerciseIndex + 1} source`,
    );
    if (mode === "create" && sourceRoutineExerciseId !== null) {
      throw new Error("Every exercise in a new routine must have a null source routine exercise ID.");
    }
    const currentPlacement = sourceRoutineExerciseId
      ? currentPlacements.get(sourceRoutineExerciseId)
      : null;
    if (sourceRoutineExerciseId) {
      if (!currentPlacement) throw new Error("A proposed exercise references a placement outside the current routine version.");
      if (usedPlacementIds.has(sourceRoutineExerciseId)) throw new Error("A routine placement can be referenced only once.");
      usedPlacementIds.add(sourceRoutineExerciseId);
    }
    if (!Array.isArray(exercise.sets)) throw new Error(`Proposed exercise ${exerciseIndex + 1} needs sets.`);
    const currentSets = new Map(currentPlacement?.sets.map((set) => [set.id, set]) ?? []);
    const sets = exercise.sets.map((setValue, setIndex) => {
      if (!setValue || typeof setValue !== "object" || Array.isArray(setValue)) {
        throw new Error(`Proposed set ${setIndex + 1} for exercise ${exerciseIndex + 1} is invalid.`);
      }
      const set = setValue as Record<string, unknown>;
      const sourceRoutineSetId = sourceId(
        set.sourceRoutineSetId,
        `Proposed set ${setIndex + 1} source`,
      );
      if (mode === "create" && sourceRoutineSetId !== null) {
        throw new Error("Every set in a new routine must have a null source routine set ID.");
      }
      if (sourceRoutineSetId) {
        if (!currentPlacement || !currentSets.has(sourceRoutineSetId)) {
          throw new Error("A proposed set references a set outside its current routine exercise.");
        }
        if (usedSetIds.has(sourceRoutineSetId)) throw new Error("A routine set can be referenced only once.");
        usedSetIds.add(sourceRoutineSetId);
      }
      return { ...set, sourceRoutineSetId };
    });
    return { ...exercise, sourceRoutineExerciseId, sets };
  });

  const input = validateRoutineVersionInput({
    focus: raw.focus as string,
    summary: raw.summary as string,
    durationMin: raw.durationMin as number,
    exercises: identityExercises.map(({ sourceRoutineExerciseId: _source, sets, ...exercise }) => ({
      ...exercise,
      sets: sets.map(({ sourceRoutineSetId: _setSource, ...set }) => set as RoutineSetInput),
    })) as RoutineExerciseInput[],
  });
  const proposal: CoachRoutineProposal = {
    ...input,
    exercises: input.exercises.map((exercise, exerciseIndex) => ({
      ...exercise,
      sourceRoutineExerciseId: identityExercises[exerciseIndex]!.sourceRoutineExerciseId,
      sets: exercise.sets.map((set, setIndex) => ({
        ...set,
        sourceRoutineSetId: identityExercises[exerciseIndex]!.sets[setIndex]!.sourceRoutineSetId,
      })),
    })),
  };
  return { proposal, input };
}

export function buildRoutineCreationDiff(
  routineCode: string,
  proposed: CoachRoutineProposal,
  exerciseLibrary: ExerciseLibraryEntry[],
) {
  const changes: string[] = [`Create routine code ${formatValue(routineCode)}.`];
  pushFieldChange(changes, "Routine name", null, proposed.focus);
  pushFieldChange(changes, "Routine summary", null, proposed.summary);
  pushFieldChange(changes, "Estimated duration (minutes)", null, proposed.durationMin);

  const names = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise.name]));
  for (const exercise of sortedPlacements(proposed.exercises)) {
    const label = JSON.stringify(names.get(exercise.exerciseId) ?? exercise.exerciseId);
    changes.push(`Add ${label}: ${formatPlacement(exercise)}.`);
    for (const set of sortedSets(exercise.sets)) changes.push(`${label} · add set: ${formatSet(set)}.`);
  }
  return changes;
}

export function buildRoutineChangeDiff(
  routine: RoutineAggregate,
  proposed: CoachRoutineProposal,
  exerciseLibrary: ExerciseLibraryEntry[],
) {
  const current = routine.currentVersion;
  const changes: string[] = [];
  pushFieldChange(changes, "Routine name", current?.focus ?? null, proposed.focus);
  pushFieldChange(changes, "Routine summary", current?.summary ?? null, proposed.summary);
  pushFieldChange(changes, "Estimated duration (minutes)", current?.durationMin ?? null, proposed.durationMin);

  const names = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise.name]));
  const currentById = new Map(current?.exercises.map((exercise) => [exercise.id, exercise]) ?? []);
  const retainedPlacementIds = new Set(proposed.exercises
    .map((exercise) => exercise.sourceRoutineExerciseId)
    .filter((id): id is string => Boolean(id)));

  for (const exercise of sortedPlacements(current?.exercises ?? [])) {
    if (retainedPlacementIds.has(exercise.id)) continue;
    const label = currentPlacementLabel(exercise);
    changes.push(`Remove ${label}: ${formatPlacement(exercise)}.`);
    for (const set of sortedSets(exercise.sets)) changes.push(`${label} · remove set: ${formatSet(set)}.`);
  }

  for (const exercise of sortedPlacements(proposed.exercises)) {
    const existing = exercise.sourceRoutineExerciseId
      ? currentById.get(exercise.sourceRoutineExerciseId)
      : null;
    const proposedName = names.get(exercise.exerciseId) ?? existing?.exerciseName ?? exercise.exerciseId;
    if (!existing) {
      const label = JSON.stringify(proposedName);
      changes.push(`Add ${label}: ${formatPlacement(exercise)}.`);
      for (const set of sortedSets(exercise.sets)) changes.push(`${label} · add set: ${formatSet(set)}.`);
      continue;
    }

    const label = currentPlacementLabel(existing);
    pushFieldChange(changes, `${label} · exercise`, existing.exerciseName, proposedName);
    pushFieldChange(changes, `${label} · exercise position`, existing.position, exercise.position);
    pushFieldChange(changes, `${label} · superset group`, existing.supersetGroup ?? null, exercise.supersetGroup ?? null);
    pushFieldChange(changes, `${label} · exercise instructions`, existing.instructions ?? "", exercise.instructions ?? "");
    pushFieldChange(changes, `${label} · exercise notes`, existing.notes ?? "", exercise.notes ?? "");
    pushSetChanges(changes, label, existing.sets, exercise.sets);
  }
  return changes;
}

function pushSetChanges(
  changes: string[],
  exerciseLabel: string,
  currentSets: RoutineSet[],
  proposedSets: CoachRoutineSetProposal[],
) {
  const currentById = new Map(currentSets.map((set) => [set.id, set]));
  const retainedSetIds = new Set(proposedSets
    .map((set) => set.sourceRoutineSetId)
    .filter((id): id is string => Boolean(id)));

  for (const set of sortedSets(currentSets)) {
    if (!retainedSetIds.has(set.id)) changes.push(`${exerciseLabel} · remove set: ${formatSet(set)}.`);
  }
  for (const set of sortedSets(proposedSets)) {
    const current = set.sourceRoutineSetId ? currentById.get(set.sourceRoutineSetId) : null;
    if (!current) {
      changes.push(`${exerciseLabel} · add set: ${formatSet(set)}.`);
      continue;
    }
    for (const [field, label] of setFields) {
      pushFieldChange(changes, `${exerciseLabel} · set ${current.position} · ${label}`, current[field], set[field]);
    }
  }
}

function sortedPlacements<T extends { position: number }>(placements: T[]) {
  return [...placements].sort((left, right) => left.position - right.position);
}

function sortedSets<T extends { position: number }>(sets: T[]) {
  return [...sets].sort((left, right) => left.position - right.position);
}

function currentPlacementLabel(exercise: RoutineExercise) {
  return `${JSON.stringify(exercise.exerciseName)} placement at position ${exercise.position}`;
}

function formatPlacement(placement: RoutineExercise | RoutineExerciseInput) {
  return [
    `position=${placement.position}`,
    `superset group=${formatValue(placement.supersetGroup ?? null)}`,
    `instructions=${formatValue(placement.instructions ?? "")}`,
    `notes=${formatValue(placement.notes ?? "")}`,
  ].join("; ");
}

function formatSet(set: SetShape) {
  return setFields.map(([field, label]) => `${label}=${formatValue(set[field])}`).join("; ");
}

function pushFieldChange(changes: string[], label: string, before: unknown, after: unknown) {
  if (Object.is(before, after)) return;
  changes.push(`${label}: ${formatValue(before)} -> ${formatValue(after)}.`);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function sourceId(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be an ID or null.`);
  return value.trim();
}
