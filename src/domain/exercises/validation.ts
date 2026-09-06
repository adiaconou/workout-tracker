import {
  muscleGroups,
  type ExerciseInput,
  type ExerciseMuscle,
  type ExerciseWeightSettings,
} from "../entities";
import { cleanOptional, cleanRequired } from "../validation";

export function validateExerciseInput(input: ExerciseInput): ExerciseInput {
  const name = cleanRequired(input.name, "Exercise name");
  if (
    input.trackingType
    && !["reps", "duration", "rounds"].includes(input.trackingType)
  ) {
    throw new Error("Tracking type is invalid.");
  }
  if (
    input.defaultLoadType
    && !["external", "bodyweight", "added", "assistance"].includes(input.defaultLoadType)
  ) {
    throw new Error("Load type is invalid.");
  }
  if (
    input.sideMode
    && !["bilateral", "per_side", "per_leg", "left_right"].includes(input.sideMode)
  ) {
    throw new Error("Side mode is invalid.");
  }
  const muscles = (input.muscles ?? []).map((muscle: ExerciseMuscle) => {
    if (!muscleGroups.includes(muscle.muscleGroup)) {
      throw new Error("Muscle group is invalid.");
    }
    if (!["primary", "secondary"].includes(muscle.role)) {
      throw new Error("Muscle role is invalid.");
    }
    if (!Number.isFinite(muscle.weight) || muscle.weight <= 0 || muscle.weight > 1) {
      throw new Error("Muscle weights must be greater than 0 and at most 1.");
    }
    return muscle;
  });
  if (new Set(muscles.map((muscle) => muscle.muscleGroup)).size !== muscles.length) {
    throw new Error("Each muscle group can appear only once per exercise.");
  }
  const weightSettings = validateExerciseWeightSettings(input.weightSettings);
  return {
    ...input,
    name,
    equipment: cleanOptional(input.equipment, 80) || "other",
    movementPattern: cleanOptional(input.movementPattern, 80) || "other",
    instructions: cleanOptional(input.instructions, 1000),
    muscles,
    weightSettings,
  };
}

function validateExerciseWeightSettings(
  value: ExerciseWeightSettings | null | undefined,
): ExerciseWeightSettings | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Weight settings are invalid.");
  }
  if (value.unit !== "lb" && value.unit !== "kg") {
    throw new Error("Weight settings unit must be lb or kg.");
  }
  const minimumIncrement = optionalPositiveWeight(
    value.minimumIncrement,
    "Minimum weight increment",
  );
  const maximumAvailable = optionalPositiveWeight(
    value.maximumAvailable,
    "Maximum available weight",
  );
  if (minimumIncrement === null && maximumAvailable === null) return null;
  if (
    minimumIncrement !== null
    && maximumAvailable !== null
    && maximumAvailable < minimumIncrement
  ) {
    throw new Error("Maximum available weight must be at least the minimum weight increment.");
  }
  return { unit: value.unit, minimumIncrement, maximumAvailable };
}

function optionalPositiveWeight(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number or blank.`);
  }
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Math.abs(value - rounded) > 1e-9) {
    throw new Error(`${label} can use at most two decimal places.`);
  }
  return value;
}
