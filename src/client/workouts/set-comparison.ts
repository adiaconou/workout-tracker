import type {
  PreviousExerciseSet,
  RecordedSetPerformance,
} from "../../contracts/api";

export type ComparisonSet = {
  loadType: string;
  targetUnit: "reps" | "seconds" | "rounds";
  weightUnit: string;
};

export type ComparisonTableSet = ComparisonSet & {
  effort?: string;
  target: string;
  targetMax?: number | null;
  targetMin?: number | null;
  targetRirMax?: number | null;
  targetRirMin?: number | null;
};

export type ComparisonTableCells = {
  load: string;
  result: string;
  rir: string;
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

function rangeLabel(minimum: number | null, maximum: number | null) {
  if (minimum === null) return maximum === null ? "—" : displayNumber(maximum);
  if (maximum === null || maximum === minimum) return displayNumber(minimum);
  return `${displayNumber(minimum)}–${displayNumber(maximum)}`;
}

function optionalFiniteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function contextualLoadLabel(
  set: ComparisonSet,
  performance: ComparisonPerformance,
) {
  const weight = performance.actualWeight;
  const unit = performance.weightUnit || set.weightUnit;
  const loadType = (performance.loadType ?? set.loadType).trim().toLowerCase();
  if (loadType === "bodyweight") {
    return weight !== null && weight > 0
      ? `BW + ${displayNumber(weight)} ${unit}`
      : "BW";
  }
  return weight === null ? "—" : `${displayNumber(weight)} ${unit}`;
}

function resultValue(
  set: ComparisonSet,
  performance: ComparisonPerformance,
) {
  const targetUnit = targetUnitFromTargetType(performance.targetType) ?? set.targetUnit;
  const value = targetUnit === "seconds"
    ? performance.actualDurationSec
    : performance.actualReps;
  return value === null ? "—" : displayNumber(value);
}

export function comparisonLoadHeading(loadType: string) {
  const normalized = loadType.trim().toLowerCase();
  if (normalized === "assistance") return "Assistance";
  if (normalized === "added") return "Added weight";
  if (normalized === "external") return "Weight";
  return "Load";
}

export function comparisonResultHeading(targetUnit: ComparisonSet["targetUnit"]) {
  if (targetUnit === "seconds") return "Seconds";
  if (targetUnit === "rounds") return "Rounds";
  return "Reps";
}

export function comparisonLoadPhrase(loadType: string, formattedLoad: string) {
  if (formattedLoad === "—" || formattedLoad.startsWith("BW")) return formattedLoad;
  const normalized = loadType.trim().toLowerCase();
  if (normalized === "assistance") return `${formattedLoad} assistance`;
  if (normalized === "added") return `${formattedLoad} added weight`;
  return formattedLoad;
}

export function formatComparisonTableCells(
  set: ComparisonSet,
  performance: ComparisonPerformance | undefined,
): ComparisonTableCells {
  if (!performance) return { load: "—", result: "—", rir: "—" };
  if (performance.status.trim().toLowerCase() === "skipped") {
    return { load: "—", result: "Skipped", rir: "—" };
  }
  return {
    load: contextualLoadLabel(set, performance),
    result: resultValue(set, performance),
    rir: "—",
  };
}

export function formatComparisonTargetCells(
  set: ComparisonTableSet,
): ComparisonTableCells {
  const targetMin = optionalFiniteNumber(set.targetMin);
  const targetMax = optionalFiniteNumber(set.targetMax);
  const explicitRange = rangeLabel(targetMin, targetMax);
  const fallbackTarget = set.target
    .trim()
    .replace(/\s*(?:reps?|seconds?|secs?|rounds?)\b/giu, "")
    .trim();
  const rirMin = optionalFiniteNumber(set.targetRirMin);
  const rirMax = optionalFiniteNumber(set.targetRirMax);
  const explicitRir = rangeLabel(rirMin, rirMax);
  const legacyRir = explicitRir === "—"
    ? set.effort?.trim().match(/^(?:RIR\s*:?\s*)?≈?\s*(\d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?)(?:\s+RIR)?$/iu)?.[1]
    : undefined;
  return {
    load: "—",
    result: explicitRange === "—" ? fallbackTarget || "—" : explicitRange,
    rir: explicitRir === "—"
      ? legacyRir?.replace(/\s*[–-]\s*/gu, "–") ?? "—"
      : explicitRir,
  };
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
