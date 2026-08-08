import type { RoutineVersionInput } from "../entities";
import {
  assertNonNegative,
  cleanOptional,
  cleanRequired,
} from "../validation";

export function validateRoutineVersionInput(
  input: RoutineVersionInput,
): RoutineVersionInput {
  const focus = cleanRequired(input.focus, "Routine name");
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    throw new Error("A routine needs at least one exercise.");
  }
  const positions = input.exercises.map((exercise) => Number(exercise.position));
  if (
    new Set(positions).size !== positions.length
    || positions.some((position) => !Number.isInteger(position) || position < 1)
  ) {
    throw new Error("Routine exercise positions must be unique positive integers.");
  }
  for (const exercise of input.exercises) {
    cleanRequired(exercise.exerciseId, "Exercise");
    if (!Array.isArray(exercise.sets) || exercise.sets.length === 0) {
      throw new Error("Every routine exercise needs at least one set.");
    }
    const setPositions = exercise.sets.map((set) => Number(set.position));
    if (
      new Set(setPositions).size !== setPositions.length
      || setPositions.some((position) => !Number.isInteger(position) || position < 1)
    ) {
      throw new Error("Set positions must be unique positive integers within an exercise.");
    }
    exercise.sets.forEach((set) => {
      if (
        !["warmup", "regular", "failure", "drop", "emom", "test"].includes(set.setType)
      ) {
        throw new Error("Set type is invalid.");
      }
      if (!["reps", "duration", "rounds"].includes(set.targetType)) {
        throw new Error("Target type is invalid.");
      }
      if (
        ![
          "standard",
          "after_both_sides",
          "no_rest_before_drop",
          "emom",
          "after_superset",
        ].includes(set.restRule)
      ) {
        throw new Error("Rest rule is invalid.");
      }
      if (
        !["bilateral", "per_side", "per_leg", "left_right"].includes(set.sideMode)
      ) {
        throw new Error("Set side mode is invalid.");
      }
      cleanRequired(set.targetDisplay, "Set target");
      assertNonNegative(set.targetMin, "Target minimum");
      assertNonNegative(set.targetMax, "Target maximum");
      assertNonNegative(set.targetRirMin, "RIR minimum");
      assertNonNegative(set.targetRirMax, "RIR maximum");
      assertNonNegative(set.restAfterSec, "Rest", false);
      if (
        set.targetMin !== null
        && set.targetMax !== null
        && set.targetMin > set.targetMax
      ) {
        throw new Error("Target minimum cannot exceed target maximum.");
      }
      if (
        set.targetRirMin !== null
        && set.targetRirMax !== null
        && set.targetRirMin > set.targetRirMax
      ) {
        throw new Error("RIR minimum cannot exceed RIR maximum.");
      }
      if (!Number.isInteger(set.restAfterSec)) {
        throw new Error("Rest must be a non-negative whole number.");
      }
    });
  }
  const durationMin = Math.round(Number(input.durationMin));
  if (!Number.isFinite(durationMin) || durationMin < 5 || durationMin > 300) {
    throw new Error("Duration must be between 5 and 300 minutes.");
  }
  return {
    ...input,
    focus,
    summary: cleanOptional(input.summary, 500),
    durationMin,
  };
}
