import type {
  PreviousExerciseSet,
  RecordedSetPerformance,
} from "../../contracts/api";

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
  loadType?: string;
};

export type CurrentSetComparisonIdentity = {
  sourceRoutineSetId?: string | null;
  setType: string;
  targetType?: string | null;
};

function displayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function resultLabel(
  set: ComparisonSet,
  performance: ComparisonPerformance,
) {
  const targetUnit = targetUnitFromTargetType(performance.targetType) ?? set.targetUnit;
  const result = targetUnit === "seconds"
    ? performance.actualDurationSec
    : performance.actualReps;
  if (result === null) return "—";
  const unit = targetUnit === "seconds" ? "sec" : targetUnit;
  return `${displayNumber(result)} ${unit}`;
}

function targetUnitFromTargetType(
  targetType: string | null | undefined,
): ComparisonSet["targetUnit"] | null {
  if (targetType === "duration") return "seconds";
  if (targetType === "rounds") return "rounds";
  if (targetType === "reps") return "reps";
  return null;
}

function normalizedSetType(value: string) {
  return value.trim().toLowerCase();
}

export function alignPreviousExerciseSets(
  currentSets: readonly CurrentSetComparisonIdentity[],
  previousSets: readonly PreviousExerciseSet[],
) {
  const matches: Array<PreviousExerciseSet | undefined> = currentSets.map(() => undefined);
  const remaining = previousSets.map((set) => set);

  for (const [currentIndex, current] of currentSets.entries()) {
    if (!current.sourceRoutineSetId) continue;
    const previousIndex = remaining.findIndex(
      (previous) => previous.sourceRoutineSetId === current.sourceRoutineSetId,
    );
    if (previousIndex < 0) continue;
    matches[currentIndex] = remaining.splice(previousIndex, 1)[0];
  }

  for (const [currentIndex, current] of currentSets.entries()) {
    if (matches[currentIndex]) continue;
    const currentTarget = targetUnitFromTargetType(current.targetType);
    if (!currentTarget) continue;
    const previousIndex = remaining.findIndex((previous) =>
      normalizedSetType(previous.setType) === normalizedSetType(current.setType)
      && targetUnitFromTargetType(previous.targetType) === currentTarget
    );
    if (previousIndex < 0) continue;
    matches[currentIndex] = remaining.splice(previousIndex, 1)[0];
  }

  for (const [currentIndex, current] of currentSets.entries()) {
    if (matches[currentIndex]) continue;
    const previousIndex = remaining.findIndex((previous) =>
      normalizedSetType(previous.setType) === normalizedSetType(current.setType)
      && targetUnitFromTargetType(previous.targetType) === null
    );
    if (previousIndex < 0) continue;
    matches[currentIndex] = remaining.splice(previousIndex, 1)[0];
  }

  return matches;
}

function loadLabel(set: ComparisonSet, performance: ComparisonPerformance) {
  const weight = performance.actualWeight;
  const unit = performance.weightUnit || set.weightUnit;
  const loadType = performance.loadType ?? set.loadType;
  if (loadType === "bodyweight") {
    return weight !== null && weight > 0
      ? `BW + ${displayNumber(weight)} ${unit}`
      : "BW";
  }
  if (loadType === "added") {
    return weight === null ? "BW + —" : `BW + ${displayNumber(weight)} ${unit}`;
  }
  if (loadType === "assistance") {
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
