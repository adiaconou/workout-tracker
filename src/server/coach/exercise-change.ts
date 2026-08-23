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

const trackingLabels: Readonly<Record<TrackingType, string>> = {
  reps: "Reps",
  duration: "Duration",
  rounds: "Rounds",
};

const loadLabels: Readonly<Record<LoadType, string>> = {
  external: "External weight",
  bodyweight: "Bodyweight",
  added: "Added weight",
  assistance: "Assistance",
};

const sideLabels: Readonly<Record<SideMode, string>> = {
  bilateral: "Bilateral",
  per_side: "Per side",
  per_leg: "Per leg",
  left_right: "Left / right",
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
      asSentence(`Add ${proposed.name} to the exercise library`),
      asSentence(
        `Equipment: ${formatIdentifier(proposed.equipment)}; Movement: ${formatIdentifier(proposed.movementPattern)}`,
      ),
      asSentence(
        `Tracking: ${trackingLabels[proposed.trackingType]}; `
        + `Loading: ${loadLabels[proposed.defaultLoadType]}; `
        + `Side mode: ${sideLabels[proposed.sideMode]}`,
      ),
      asSentence(`Instructions: ${formatInstructions(proposed.instructions)}`),
      asSentence(`Muscles: ${formatMuscles(proposed.muscles)}`),
    ];
  }

  if (!current) throw new Error("The target exercise could not be found.");
  if (action === "archive") {
    return [
      `Archive ${current.name} from the exercise library.`,
      "Existing routine versions and workout history remain unchanged.",
    ];
  }
  if (!proposed) throw new Error("An exercise update needs a complete definition.");

  const changes: string[] = [];
  pushFieldChange(changes, "Name", current.name, proposed.name, String);
  pushFieldChange(changes, "Equipment", current.equipment, proposed.equipment, formatIdentifier);
  pushFieldChange(changes, "Movement", current.movementPattern, proposed.movementPattern, formatIdentifier);
  pushFieldChange(changes, "Tracking", current.trackingType, proposed.trackingType, formatTracking);
  pushFieldChange(changes, "Loading", current.defaultLoadType, proposed.defaultLoadType, formatLoading);
  pushFieldChange(changes, "Side mode", current.sideMode, proposed.sideMode, formatSideMode);
  pushFieldChange(changes, "Instructions", current.instructions, proposed.instructions, formatInstructions);
  if (canonicalMuscles(current.muscles) !== canonicalMuscles(proposed.muscles)) {
    changes.push(asSentence(`Muscles: ${formatMuscles(current.muscles)} → ${formatMuscles(proposed.muscles)}`));
  }
  return changes;
}

function pushFieldChange<T extends string>(
  changes: string[],
  label: string,
  before: T,
  after: T,
  formatter: (value: T) => string,
) {
  if (before === after) return;
  changes.push(asSentence(`${label}: ${formatter(before)} → ${formatter(after)}`));
}

function canonicalMuscles(muscles: ExerciseMuscle[]) {
  return JSON.stringify([...muscles]
    .sort((left, right) => left.muscleGroup.localeCompare(right.muscleGroup))
    .map((muscle) => [muscle.muscleGroup, muscle.role, muscle.weight]));
}

function formatMuscles(muscles: ExerciseMuscle[]) {
  if (!muscles.length) return "None specified";
  return [...muscles]
    .sort((left, right) => left.muscleGroup.localeCompare(right.muscleGroup))
    .map((muscle) => (
      `${formatIdentifier(muscle.muscleGroup)} (${formatIdentifier(muscle.role)}, weight ${muscle.weight})`
    ))
    .join(", ");
}

function formatInstructions(instructions: string) {
  return instructions || "None";
}

function formatIdentifier(value: string) {
  const readable = value.replaceAll("_", " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

function formatTracking(value: TrackingType) {
  return trackingLabels[value];
}

function formatLoading(value: LoadType) {
  return loadLabels[value];
}

function formatSideMode(value: SideMode) {
  return sideLabels[value];
}

function asSentence(value: string) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}
