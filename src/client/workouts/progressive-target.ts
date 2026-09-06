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
  | "weightSettings"
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

function stableWeight(value: number) {
  return Number(value.toFixed(2));
}

function configuredWeightValue(
  set: ProgressiveSet,
  value: number | null | undefined,
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const settingsUnit = canonicalWeightUnit(set.weightSettings?.unit ?? "");
  const currentUnit = canonicalWeightUnit(set.weightUnit);
  if (!settingsUnit || !currentUnit) return null;
  return convertWeight(value, settingsUnit, currentUnit);
}

function maximumLoad(set: ProgressiveSet) {
  return configuredWeightValue(set, set.weightSettings?.maximumAvailable);
}

function previousWeight(set: ProgressiveSet, previous: PreviousExerciseSet) {
  const value = previous.actualWeight;
  if (value === null) {
    return set.loadType === "bodyweight" ? { value: 0, atMaximum: false } : null;
  }
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return { value: 0, atMaximum: false };

  const previousUnitLabel = previous.weightUnit.trim() || set.weightUnit;
  const currentUnit = canonicalWeightUnit(set.weightUnit);
  const previousUnit = canonicalWeightUnit(previousUnitLabel);
  if (currentUnit && previousUnit) {
    const converted = convertWeight(value, previousUnit, currentUnit);
    const maximum = maximumLoad(set);
    if (maximum !== null && converted >= maximum) {
      return { value: stableWeight(maximum), atMaximum: true };
    }
    if (currentUnit === previousUnit) {
      return { value: stableWeight(converted), atMaximum: false };
    }
    const increment = loadIncrement(set)!;
    const quantized = stableWeight(Math.round(converted / increment) * increment);
    return {
      value: maximum === null ? quantized : Math.min(quantized, stableWeight(maximum)),
      atMaximum: maximum !== null && quantized >= maximum,
    };
  }
  return normalized(previousUnitLabel) === normalized(set.weightUnit)
    ? { value, atMaximum: false }
    : null;
}

function resultIncrement(set: ProgressiveSet) {
  return set.targetUnit === "seconds" ? 5 : 1;
}

function loadIncrement(set: ProgressiveSet) {
  const configured = configuredWeightValue(set, set.weightSettings?.minimumIncrement);
  if (configured !== null) return configured;
  const unit = canonicalWeightUnit(set.weightUnit);
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
  const previousLoad = previousWeight(set, previous);
  if (result === null || previousLoad === null) return undefined;
  const weight = previousLoad.value;

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

  const nextLoad = loadIncrement(set);
  if (targetMin !== null && nextLoad !== null) {
    if (loadType === "external" || loadType === "added" || (loadType === "bodyweight" && weight > 0)) {
      if (previousLoad.atMaximum) return performance(set, weight, targetMax);
      const maximum = maximumLoad(set);
      const increased = stableWeight(maximum === null
        ? weight + nextLoad
        : Math.min(weight + nextLoad, maximum));
      return increased > weight
        ? performance(set, increased, targetMin)
        : performance(set, weight, targetMax);
    }
    if (loadType === "assistance" && weight > 0) {
      return performance(set, stableWeight(Math.max(0, weight - nextLoad)), targetMin);
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
