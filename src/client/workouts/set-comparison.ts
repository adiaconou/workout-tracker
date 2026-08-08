import type { RecordedSetPerformance } from "../../contracts/api";

export type ComparisonSet = {
  loadType: string;
  targetUnit: "reps" | "seconds" | "rounds";
  weightUnit: string;
};

export type ComparisonPerformance = Pick<
  RecordedSetPerformance,
  "actualWeight" | "actualReps" | "actualDurationSec" | "weightUnit"
> & {
  status: string;
  targetType?: string;
};

function displayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function resultLabel(
  set: ComparisonSet,
  performance: ComparisonPerformance,
) {
  if (performance.actualDurationSec !== null) {
    return `${displayNumber(performance.actualDurationSec)} sec`;
  }
  if (performance.actualReps === null) return "—";
  const unit = set.targetUnit === "rounds" || performance.targetType === "rounds"
    ? "rounds"
    : "reps";
  return `${displayNumber(performance.actualReps)} ${unit}`;
}

function loadLabel(set: ComparisonSet, performance: ComparisonPerformance) {
  const weight = performance.actualWeight;
  const unit = performance.weightUnit || set.weightUnit;
  if (set.loadType === "bodyweight") {
    return weight !== null && weight > 0
      ? `BW + ${displayNumber(weight)} ${unit}`
      : "BW";
  }
  if (set.loadType === "added") {
    return weight === null ? "BW + —" : `BW + ${displayNumber(weight)} ${unit}`;
  }
  if (set.loadType === "assistance") {
    return weight === null ? "BW − —" : `BW − ${displayNumber(weight)} ${unit}`;
  }
  return weight === null ? "—" : `${displayNumber(weight)} ${unit}`;
}

export function formatSetComparisonPerformance(
  set: ComparisonSet,
  performance: ComparisonPerformance | undefined,
) {
  if (!performance) return "—";
  if (performance.status.toLowerCase() === "skipped") return "Skipped";
  return `${loadLabel(set, performance)} × ${resultLabel(set, performance)}`;
}

function numericInput(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function liveSetComparisonPerformance(
  set: ComparisonSet,
  weight: string,
  result: string,
): ComparisonPerformance {
  const numericResult = numericInput(result);
  return {
    status: "Completed",
    actualWeight: numericInput(weight),
    actualReps: set.targetUnit === "seconds" ? null : numericResult,
    actualDurationSec: set.targetUnit === "seconds" ? numericResult : null,
    weightUnit: set.weightUnit,
    targetType: set.targetUnit === "rounds" ? "rounds" : undefined,
  };
}
