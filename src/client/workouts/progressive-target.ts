import type { PreviousExerciseSet } from "../../contracts/api";
import { canonicalWeightUnit, convertWeight } from "../../domain/exercise-progress";
import type { GuidedSet } from "../../domain/workout";
import type { ComparisonPerformance } from "./set-comparison";

type ProgressiveSet = Pick<
  GuidedSet,
  | "loadType"
  | "setType"
  | "targetMax"
  | "targetMin"
  | "targetType"
  | "targetUnit"
  | "weightUnit"
>;

const supportedLoadTypes = new Set(["external", "bodyweight", "added", "assistance"]);
const holdSetTypes = new Set(["warmup", "failure", "drop", "emom", "test"]);

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function targetUnitFromType(value: string | null | undefined) {
  if (value === "duration") return "seconds";
  if (value === "reps" || value === "rounds") return value;
  return null;
}

function currentTargetType(set: ProgressiveSet) {
  return set.targetType ?? (set.targetUnit === "seconds" ? "duration" : set.targetUnit);
}

function positiveTarget(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function previousResult(set: ProgressiveSet, previous: PreviousExerciseSet) {
  const value = set.targetUnit === "seconds"
    ? previous.actualDurationSec
    : previous.actualReps;
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function previousWeight(set: ProgressiveSet, previous: PreviousExerciseSet) {
  const value = previous.actualWeight;
  if (value === null) return set.loadType === "bodyweight" ? 0 : null;
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return 0;

  const previousUnitLabel = previous.weightUnit.trim() || set.weightUnit;
  const currentUnit = canonicalWeightUnit(set.weightUnit);
  const previousUnit = canonicalWeightUnit(previousUnitLabel);
  if (currentUnit && previousUnit) {
    const converted = convertWeight(value, previousUnit, currentUnit);
    const increment = loadIncrement(set.weightUnit)!;
    return Number((Math.round(converted / increment) * increment).toFixed(2));
  }
  return normalized(previousUnitLabel) === normalized(set.weightUnit) ? value : null;
}

function resultIncrement(set: ProgressiveSet) {
  return set.targetUnit === "seconds" ? 5 : 1;
}

function loadIncrement(weightUnit: string) {
  const unit = canonicalWeightUnit(weightUnit);
  if (unit === "kg") return 1;
  if (unit === "lb") return 2.5;
  return null;
}

function performance(
  set: ProgressiveSet,
  weight: number,
  result: number,
): ComparisonPerformance {
  return {
    status: "Completed",
    actualWeight: weight,
    actualReps: set.targetUnit === "seconds" ? null : result,
    actualDurationSec: set.targetUnit === "seconds" ? result : null,
    weightUnit: set.weightUnit,
    targetType: currentTargetType(set),
    loadType: set.loadType,
  };
}

export function recommendProgressiveTarget(
  set: ProgressiveSet,
  previous: PreviousExerciseSet | undefined,
): ComparisonPerformance | undefined {
  if (!previous || normalized(previous.status) !== "completed") return undefined;

  const loadType = normalized(set.loadType);
  if (!supportedLoadTypes.has(loadType)) return undefined;
  if (previous.loadType && normalized(previous.loadType) !== loadType) return undefined;

  if (previous.targetType) {
    const previousTargetUnit = targetUnitFromType(normalized(previous.targetType));
    if (!previousTargetUnit || previousTargetUnit !== set.targetUnit) return undefined;
  }

  const result = previousResult(set, previous);
  const weight = previousWeight(set, previous);
  if (result === null || weight === null) return undefined;

  const targetMin = positiveTarget(set.targetMin);
  const targetMax = positiveTarget(set.targetMax);
  if (
    holdSetTypes.has(normalized(set.setType))
  ) {
    return performance(set, weight, result);
  }
  if (targetMin !== null && result < targetMin) {
    return performance(set, weight, targetMin);
  }

  const increment = resultIncrement(set);
  if (targetMax === null || result < targetMax) {
    return performance(
      set,
      weight,
      targetMax === null ? result + increment : Math.min(result + increment, targetMax),
    );
  }

  const nextLoad = loadIncrement(set.weightUnit);
  if (targetMin !== null && nextLoad !== null) {
    if (loadType === "external" || loadType === "added" || (loadType === "bodyweight" && weight > 0)) {
      return performance(set, weight + nextLoad, targetMin);
    }
    if (loadType === "assistance" && weight > 0) {
      return performance(set, Math.max(0, weight - nextLoad), targetMin);
    }
  }

  if (
    (loadType === "bodyweight" || loadType === "assistance")
    && weight === 0
  ) {
    return performance(set, weight, result + increment);
  }
  return performance(set, weight, targetMax);
}
