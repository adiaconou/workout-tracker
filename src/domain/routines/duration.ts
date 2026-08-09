import type { RoutineSetInput } from "../entities";

type RoutineDurationSet = Pick<
  RoutineSetInput,
  "targetType" | "targetMin" | "targetMax" | "restAfterSec" | "sideMode"
>;

export type RoutineDurationInput = {
  durationMin: number;
  exercises: ReadonlyArray<{
    sets: readonly RoutineDurationSet[];
  }>;
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
 * Shared deterministic assumptions for editor feedback and generated-program
 * validation. Upper set targets make the estimate conservative, unilateral
 * work is counted for both sides, and the routine's final rest is omitted.
 */
export const ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS = {
  secondsPerRep: 4,
  secondsPerRound: 60,
  unilateralWorkMultiplier: 2,
} as const;

/**
 * Real sessions vary with setup and transitions. Generated routines may vary
 * by 20% from the requested target, with at least five minutes of allowance;
 * larger gaps are treated as generation failures instead of silently passing.
 */
export const ROUTINE_DURATION_ESTIMATE_TOLERANCE = {
  targetFraction: 0.2,
  minimumMinutes: 5,
} as const;

export function estimateRoutineDuration(
  routine: RoutineDurationInput,
): RoutineDurationEstimate {
  const sets = routine.exercises.flatMap((exercise) => exercise.sets);
  const totalSeconds = sets.reduce((total, set, index) => {
    const isFinalSet = index === sets.length - 1;
    const workSeconds = estimatedSetWorkSeconds(set);
    const restSeconds = isFinalSet ? 0 : safeNonNegative(set.restAfterSec);
    return total + workSeconds + restSeconds;
  }, 0);
  const estimatedMinutes = Math.ceil(totalSeconds / 60);
  const targetMinutes = safeNonNegative(routine.durationMin);
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

export function routineDurationToleranceMinutes(targetMinutes: number) {
  const safeTarget = safeNonNegative(targetMinutes);
  return Math.max(
    ROUTINE_DURATION_ESTIMATE_TOLERANCE.minimumMinutes,
    Math.ceil(safeTarget * ROUTINE_DURATION_ESTIMATE_TOLERANCE.targetFraction),
  );
}

export function routineDurationEstimateIsWithinTolerance(
  estimate: RoutineDurationEstimate,
) {
  return Math.abs(estimate.deltaMinutes)
    <= routineDurationToleranceMinutes(estimate.targetMinutes);
}

function estimatedSetWorkSeconds(set: RoutineDurationSet) {
  const upperTarget = safeNonNegative(set.targetMax ?? set.targetMin ?? 0);
  const baseSeconds = secondsForTarget(set.targetType, upperTarget);
  const sideMultiplier = set.sideMode === "bilateral"
    ? 1
    : ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS.unilateralWorkMultiplier;
  return baseSeconds * sideMultiplier;
}

function secondsForTarget(
  targetType: RoutineDurationSet["targetType"],
  target: number,
) {
  if (targetType === "duration") return target;
  if (targetType === "rounds") {
    return target * ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS.secondsPerRound;
  }
  return target * ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS.secondsPerRep;
}

function safeNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
