import {
  muscleGroups,
  type ExerciseInput,
  type ExerciseMuscle,
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
  return {
    ...input,
    name,
    equipment: cleanOptional(input.equipment, 80) || "other",
    movementPattern: cleanOptional(input.movementPattern, 80) || "other",
    instructions: cleanOptional(input.instructions, 1000),
    muscles,
  };
}
