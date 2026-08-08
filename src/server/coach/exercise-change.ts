import { validateExerciseInput } from "../../domain/exercises/validation";
import type {
  Exercise,
  ExerciseInput,
  ExerciseMuscle,
  LoadType,
  SideMode,
  TrackingType,
} from "../../domain/entities";

export type ExerciseChangeAction = "create" | "update" | "archive";

export type CompleteExerciseInput = {
  name: string;
  equipment: string;
  movementPattern: string;
  trackingType: TrackingType;
  defaultLoadType: LoadType;
  sideMode: SideMode;
  instructions: string;
  muscles: ExerciseMuscle[];
};

export function completeExerciseInput(value: unknown): CompleteExerciseInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A complete proposed exercise is required.");
  }
  const validated = validateExerciseInput(value as ExerciseInput);
  return {
    name: validated.name,
    equipment: validated.equipment!,
    movementPattern: validated.movementPattern!,
    trackingType: validated.trackingType ?? "reps",
    defaultLoadType: validated.defaultLoadType ?? "external",
    sideMode: validated.sideMode ?? "bilateral",
    instructions: validated.instructions!,
    muscles: validated.muscles!,
  };
}

export function exerciseInputSnapshot(exercise: Exercise): CompleteExerciseInput {
  return {
    name: exercise.name,
    equipment: exercise.equipment,
    movementPattern: exercise.movementPattern,
    trackingType: exercise.trackingType,
    defaultLoadType: exercise.defaultLoadType,
    sideMode: exercise.sideMode,
    instructions: exercise.instructions,
    muscles: exercise.muscles,
  };
}

export function buildExerciseChangeDiff(
  action: ExerciseChangeAction,
  current: Exercise | null,
  proposed: CompleteExerciseInput | null,
) {
  if (action === "create") {
    if (!proposed) throw new Error("A new exercise needs a complete definition.");
    return [
      `Add \"${proposed.name}\" to the exercise library.`,
      `Equipment: ${proposed.equipment}; movement: ${proposed.movementPattern}.`,
      `Tracking: ${proposed.trackingType}; loading: ${proposed.defaultLoadType}; side mode: ${proposed.sideMode}.`,
      `Instructions: ${formatInstructions(proposed.instructions)}.`,
      `Muscles: ${formatMuscles(proposed.muscles)}.`,
    ];
  }

  if (!current) throw new Error("The target exercise could not be found.");
  if (action === "archive") {
    return [
      `Archive \"${current.name}\" from the exercise library.`,
      "Existing routine versions and workout history remain unchanged.",
    ];
  }
  if (!proposed) throw new Error("An exercise update needs a complete definition.");

  const changes: string[] = [];
  if (current.name !== proposed.name) changes.push(`Name: ${current.name} -> ${proposed.name}`);
  if (current.equipment !== proposed.equipment) changes.push(`Equipment: ${current.equipment} -> ${proposed.equipment}`);
  if (current.movementPattern !== proposed.movementPattern) changes.push(`Movement: ${current.movementPattern} -> ${proposed.movementPattern}`);
  if (current.trackingType !== proposed.trackingType) changes.push(`Tracking: ${current.trackingType} -> ${proposed.trackingType}`);
  if (current.defaultLoadType !== proposed.defaultLoadType) changes.push(`Loading: ${current.defaultLoadType} -> ${proposed.defaultLoadType}`);
  if (current.sideMode !== proposed.sideMode) changes.push(`Side mode: ${current.sideMode} -> ${proposed.sideMode}`);
  if (current.instructions !== proposed.instructions) {
    changes.push(`Instructions: ${formatInstructions(current.instructions)} -> ${formatInstructions(proposed.instructions)}`);
  }
  if (canonicalMuscles(current.muscles) !== canonicalMuscles(proposed.muscles)) {
    changes.push(`Muscles: ${formatMuscles(current.muscles)} -> ${formatMuscles(proposed.muscles)}`);
  }
  return changes;
}

function canonicalMuscles(muscles: ExerciseMuscle[]) {
  return JSON.stringify([...muscles]
    .sort((left, right) => left.muscleGroup.localeCompare(right.muscleGroup))
    .map((muscle) => [muscle.muscleGroup, muscle.role, muscle.weight]));
}

function formatMuscles(muscles: ExerciseMuscle[]) {
  if (!muscles.length) return "none specified";
  return [...muscles]
    .sort((left, right) => left.muscleGroup.localeCompare(right.muscleGroup))
    .map((muscle) => `${muscle.muscleGroup} (${muscle.role}, ${muscle.weight})`)
    .join(", ");
}

function formatInstructions(instructions: string) {
  return instructions ? JSON.stringify(instructions) : "none";
}
