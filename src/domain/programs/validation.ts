import {
  muscleGroups,
  type MuscleGroup,
  type RoutineProgramCreateInput,
  type RoutineProgramRoutineInput,
} from "../entities";
import { validateRoutineVersionInput } from "../routines/validation";
import { cleanRequired } from "../validation";

const muscleGroupSet = new Set<string>(muscleGroups);

export class RoutineProgramInputError extends Error {}

function wholeNumberBetween(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return number;
}

function validateMuscles(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Selected muscle groups must be a list.");
  }
  const selected = value.map((muscle) => {
    if (typeof muscle !== "string" || !muscleGroupSet.has(muscle)) {
      throw new Error("A selected muscle group is invalid.");
    }
    return muscle as MuscleGroup;
  });
  return muscleGroups.filter((muscle) => selected.includes(muscle));
}

function validateRoutineItems(value: unknown): RoutineProgramRoutineInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("A program needs at least one routine.");
  }
  if (value.length > 20) {
    throw new Error("A program cannot contain more than 20 routines.");
  }
  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Each program routine must reference or define a routine.");
    }
    const item = candidate as Record<string, unknown>;
    const hasRoutineId = typeof item.routineId === "string" && Boolean(item.routineId.trim());
    const hasDraft = typeof item.code === "string" && Boolean(item.code.trim()) && Boolean(item.version);
    if (hasRoutineId === hasDraft) {
      throw new Error("Each program routine must contain either a routine id or a complete routine draft.");
    }
    if (hasRoutineId) {
      const routineId = cleanRequired(item.routineId, "Routine id");
      const key = `id:${routineId}`;
      if (seen.has(key)) throw new Error("A program cannot contain the same routine twice.");
      seen.add(key);
      return { routineId };
    }
    const code = cleanRequired(item.code, "Routine code", 20).toUpperCase();
    const key = `code:${code}`;
    if (seen.has(key)) throw new Error("Routine codes must be unique within a program.");
    seen.add(key);
    return {
      code,
      version: validateRoutineVersionInput(item.version as never),
    };
  });
}

export function validateRoutineProgramCreateInput(
  input: RoutineProgramCreateInput,
): RoutineProgramCreateInput & { activate: boolean } {
  if (!input || typeof input !== "object") {
    throw new Error("Program details are required.");
  }
  if (input.activate !== undefined && typeof input.activate !== "boolean") {
    throw new Error("Program active state must be a boolean.");
  }
  return {
    name: cleanRequired(input.name, "Program name", 80),
    goal: cleanRequired(input.goal, "Program goal", 500),
    selectedMuscleGroups: validateMuscles(input.selectedMuscleGroups),
    trainingDaysPerWeek: wholeNumberBetween(input.trainingDaysPerWeek, "Training days", 1, 7),
    targetDurationMin: wholeNumberBetween(input.targetDurationMin, "Target duration", 5, 300),
    activate: input.activate ?? true,
    routines: validateRoutineItems(input.routines),
  };
}

export function routineProgramRequestFingerprint(
  input: RoutineProgramCreateInput & { activate: boolean },
) {
  return JSON.stringify(input);
}
