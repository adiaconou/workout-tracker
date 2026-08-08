import type {
  ExerciseProgress,
  ExerciseProgressMetric,
  ExerciseProgressPoint,
  LoadType,
  TrackingType,
} from "./entities/exercise";

const POUNDS_PER_KILOGRAM = 2.2046226218;
const STRENGTH_SET_TYPES = new Set(["regular", "failure", "test"]);

export type ExerciseProgressCandidate = Omit<ExerciseProgressPoint, "value"> & {
  loadType: LoadType;
  targetType: TrackingType;
  setType: string;
  setPosition: number;
  actualRepsLeft: number | null;
  actualRepsRight: number | null;
};

export type BuildExerciseProgressInput = {
  exerciseId: string;
  trackingType: TrackingType;
  defaultLoadType: LoadType;
  candidates: ExerciseProgressCandidate[];
  limit: number;
};

function finitePositive(value: number | null) {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function canonicalWeightUnit(value: string): "lb" | "kg" | null {
  const normalized = value.trim().toLowerCase().replace(/\./g, "");
  if (["lb", "lbs", "pound", "pounds"].includes(normalized)) return "lb";
  if (["kg", "kgs", "kilogram", "kilograms"].includes(normalized)) return "kg";
  return null;
}

export function convertWeight(
  value: number,
  from: "lb" | "kg",
  to: "lb" | "kg",
) {
  if (from === to) return value;
  return from === "kg"
    ? value * POUNDS_PER_KILOGRAM
    : value / POUNDS_PER_KILOGRAM;
}

export function epleyEstimatedOneRepMax(weight: number, reps: number) {
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

function comparableReps(candidate: ExerciseProgressCandidate) {
  if (finitePositive(candidate.actualReps)) return candidate.actualReps;
  if (
    finitePositive(candidate.actualRepsLeft) &&
    finitePositive(candidate.actualRepsRight)
  ) {
    return Math.min(candidate.actualRepsLeft!, candidate.actualRepsRight!);
  }
  return null;
}

function newestCandidate(candidates: ExerciseProgressCandidate[]) {
  return [...candidates].sort((a, b) => {
    const dateDifference = Date.parse(b.performedAt) - Date.parse(a.performedAt);
    return dateDifference || b.setPosition - a.setPosition || b.setId.localeCompare(a.setId);
  })[0];
}

function metricFor(
  trackingType: TrackingType,
  defaultLoadType: LoadType,
  candidates: ExerciseProgressCandidate[],
): ExerciseProgressMetric {
  const latestTarget = newestCandidate(candidates)?.targetType ?? trackingType;
  if (latestTarget === "duration") return "duration";
  if (latestTarget === "rounds") return "rounds";
  const latestCandidate = newestCandidate(candidates);
  return (latestCandidate?.loadType ?? defaultLoadType) === "external"
    ? "epley_estimated_1rm"
    : "reps";
}

function metricUnit(
  metric: ExerciseProgressMetric,
  candidates: ExerciseProgressCandidate[],
) {
  if (metric === "duration") return "seconds" as const;
  if (metric === "rounds") return "rounds" as const;
  if (metric === "reps") return "reps" as const;
  const latestWeighted = newestCandidate(candidates.filter((candidate) => {
    const reps = comparableReps(candidate);
    return candidate.targetType === "reps" &&
      candidate.loadType === "external" &&
      STRENGTH_SET_TYPES.has(candidate.setType) &&
      canonicalWeightUnit(candidate.weightUnit) !== null &&
      finitePositive(candidate.actualWeight) &&
      reps !== null && Number.isInteger(reps) && reps >= 1 && reps <= 10;
  }));
  return canonicalWeightUnit(latestWeighted?.weightUnit ?? "") ?? "lb";
}

function pointValue(
  candidate: ExerciseProgressCandidate,
  metric: ExerciseProgressMetric,
  unit: ExerciseProgress["unit"],
  seriesLoadType: LoadType,
) {
  if (metric === "duration") {
    return candidate.setType !== "warmup" && candidate.setType !== "drop" &&
      candidate.targetType === "duration" && finitePositive(candidate.actualDurationSec)
      ? candidate.actualDurationSec
      : null;
  }
  const reps = comparableReps(candidate);
  if (metric === "rounds" || metric === "reps") {
    if (!STRENGTH_SET_TYPES.has(candidate.setType) && candidate.setType !== "emom") return null;
    if (candidate.targetType !== (metric === "rounds" ? "rounds" : "reps")) return null;
    if (metric === "reps" && candidate.loadType !== seriesLoadType) return null;
    return reps;
  }
  if (!STRENGTH_SET_TYPES.has(candidate.setType)) return null;
  const sourceUnit = canonicalWeightUnit(candidate.weightUnit);
  if (
    candidate.targetType !== "reps" || candidate.loadType !== "external" ||
    !finitePositive(candidate.actualWeight) || !sourceUnit ||
    reps === null || !Number.isInteger(reps) || reps < 1 || reps > 10 ||
    (unit !== "lb" && unit !== "kg")
  ) return null;
  const convertedWeight = convertWeight(candidate.actualWeight!, sourceUnit, unit);
  return epleyEstimatedOneRepMax(convertedWeight, reps);
}

function isBetterPoint(
  next: ExerciseProgressPoint & { setPosition: number },
  current: ExerciseProgressPoint & { setPosition: number },
) {
  if (next.value !== current.value) return next.value > current.value;
  const nextUnit = canonicalWeightUnit(next.weightUnit);
  const currentUnit = canonicalWeightUnit(current.weightUnit);
  const nextWeight = next.actualWeight !== null && nextUnit
    ? convertWeight(next.actualWeight, nextUnit, "lb")
    : -1;
  const currentWeight = current.actualWeight !== null && currentUnit
    ? convertWeight(current.actualWeight, currentUnit, "lb")
    : -1;
  if (nextWeight !== currentWeight) return nextWeight > currentWeight;
  const nextReps = next.actualReps ?? -1;
  const currentReps = current.actualReps ?? -1;
  if (nextReps !== currentReps) return nextReps > currentReps;
  if (next.setPosition !== current.setPosition) return next.setPosition < current.setPosition;
  return next.setId.localeCompare(current.setId) < 0;
}

export function buildExerciseProgress({
  exerciseId,
  trackingType,
  defaultLoadType,
  candidates,
  limit,
}: BuildExerciseProgressInput): ExerciseProgress {
  const validCandidates = candidates.filter((candidate) =>
    Number.isFinite(Date.parse(candidate.performedAt))
  );
  const seriesLoadType = newestCandidate(validCandidates)?.loadType ?? defaultLoadType;
  const metric = metricFor(trackingType, defaultLoadType, validCandidates);
  const unit = metricUnit(metric, validCandidates);
  const bestByWorkout = new Map<string, ExerciseProgressPoint & { setPosition: number }>();

  for (const candidate of validCandidates) {
    const value = pointValue(candidate, metric, unit, seriesLoadType);
    if (value === null || !Number.isFinite(value) || value <= 0) continue;
    const actualReps = comparableReps(candidate);
    const point = {
      workoutId: candidate.workoutId,
      routineCode: candidate.routineCode,
      routineTitle: candidate.routineTitle,
      workoutStatus: candidate.workoutStatus,
      performedAt: candidate.performedAt,
      setId: candidate.setId,
      value,
      actualWeight: candidate.actualWeight,
      actualReps,
      actualDurationSec: candidate.actualDurationSec,
      weightUnit: candidate.weightUnit,
      setPosition: candidate.setPosition,
    };
    const current = bestByWorkout.get(candidate.workoutId);
    if (!current || isBetterPoint(point, current)) bestByWorkout.set(candidate.workoutId, point);
  }

  const allPoints = [...bestByWorkout.values()]
    .sort((a, b) => Date.parse(a.performedAt) - Date.parse(b.performedAt) || a.workoutId.localeCompare(b.workoutId));
  const points = allPoints.slice(Math.max(0, allPoints.length - limit)).map(({ setPosition: _setPosition, ...point }) => point);
  return {
    exerciseId,
    metric,
    unit,
    points,
    hasMore: allPoints.length > points.length,
  };
}
