import type {
  ExerciseProgress,
  ExerciseProgressMetric,
  ExerciseProgressPoint,
  LoadType,
  TrackingType,
} from "./entities/exercise";

const POUNDS_PER_KILOGRAM = 2.2046226218;
const STRENGTH_SET_TYPES = new Set(["regular", "failure", "test"]);
const TOTAL_LOAD_TYPES = new Set<LoadType>([
  "bodyweight",
  "added",
  "assistance",
]);

type WeightUnit = "lb" | "kg";

export type ExerciseProgressCandidate = Omit<
  ExerciseProgressPoint,
  "value" | "effectiveLoad" | "effectiveLoadUnit" | "bodyWeightEstimated"
> & {
  targetType: TrackingType;
  setType: string;
  setPosition: number;
  actualRepsLeft: number | null;
  actualRepsRight: number | null;
  bodyWeightSource: string | null;
};

export type BuildExerciseProgressInput = {
  exerciseId: string;
  trackingType: TrackingType;
  defaultLoadType: LoadType;
  candidates: ExerciseProgressCandidate[];
  limit: number;
  unit?: WeightUnit;
};

type PointMeasurement = {
  value: number;
  effectiveLoad: number | null;
  effectiveLoadUnit: WeightUnit | null;
};

function finitePositive(value: number | null) {
  return value !== null && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number | null) {
  return value !== null && Number.isFinite(value) && value >= 0;
}

export function canonicalWeightUnit(value: string): WeightUnit | null {
  const normalized = value.trim().toLowerCase().replace(/\./g, "");
  if (["lb", "lbs", "pound", "pounds"].includes(normalized)) return "lb";
  if (["kg", "kgs", "kilogram", "kilograms"].includes(normalized)) return "kg";
  return null;
}

export function convertWeight(
  value: number,
  from: WeightUnit,
  to: WeightUnit,
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

function validEstimateReps(candidate: ExerciseProgressCandidate) {
  const reps = comparableReps(candidate);
  return reps !== null && Number.isInteger(reps) && reps >= 1 && reps <= 10
    ? reps
    : null;
}

function newestCandidate(candidates: ExerciseProgressCandidate[]) {
  return [...candidates].sort((a, b) => {
    const dateDifference = Date.parse(b.performedAt) - Date.parse(a.performedAt);
    return dateDifference || b.setPosition - a.setPosition || b.setId.localeCompare(a.setId);
  })[0];
}

function externalLoad(
  candidate: ExerciseProgressCandidate,
  unit: WeightUnit,
) {
  const sourceUnit = canonicalWeightUnit(candidate.weightUnit);
  if (
    candidate.targetType !== "reps" ||
    candidate.loadType !== "external" ||
    !STRENGTH_SET_TYPES.has(candidate.setType) ||
    !finitePositive(candidate.actualWeight) ||
    !sourceUnit ||
    validEstimateReps(candidate) === null
  ) {
    return null;
  }
  return convertWeight(candidate.actualWeight!, sourceUnit, unit);
}

function totalLoad(
  candidate: ExerciseProgressCandidate,
  unit: WeightUnit,
) {
  const bodyWeightUnit = canonicalWeightUnit(candidate.bodyWeightUnit);
  if (
    candidate.targetType !== "reps" ||
    !TOTAL_LOAD_TYPES.has(candidate.loadType) ||
    !STRENGTH_SET_TYPES.has(candidate.setType) ||
    !finitePositive(candidate.bodyWeight) ||
    !bodyWeightUnit ||
    validEstimateReps(candidate) === null
  ) {
    return null;
  }

  const convertedBodyWeight = convertWeight(
    candidate.bodyWeight!,
    bodyWeightUnit,
    unit,
  );
  const addedWeightUnit = canonicalWeightUnit(candidate.weightUnit);
  if (!finiteNonNegative(candidate.actualWeight) || !addedWeightUnit) return null;
  const convertedAddedWeight = convertWeight(
    candidate.actualWeight!,
    addedWeightUnit,
    unit,
  );
  const effectiveLoad = candidate.loadType !== "assistance"
    ? convertedBodyWeight + convertedAddedWeight
    : convertedBodyWeight - convertedAddedWeight;
  return finitePositive(effectiveLoad) ? effectiveLoad : null;
}

function metricFor(
  trackingType: TrackingType,
  defaultLoadType: LoadType,
  candidates: ExerciseProgressCandidate[],
): ExerciseProgressMetric {
  const latestCandidate = newestCandidate(candidates);
  const latestTarget = latestCandidate?.targetType ?? trackingType;
  if (latestTarget === "duration") return "duration";
  if (latestTarget === "rounds") return "rounds";

  const latestLoadType = latestCandidate?.loadType ?? defaultLoadType;
  if (
    latestLoadType === "external" &&
    candidates.some((candidate) => externalLoad(candidate, "lb") !== null)
  ) {
    return "epley_estimated_1rm";
  }
  if (
    TOTAL_LOAD_TYPES.has(latestLoadType) &&
    candidates.some((candidate) => totalLoad(candidate, "lb") !== null)
  ) {
    return "epley_estimated_total_load";
  }
  return "reps";
}

function metricUnit(
  metric: ExerciseProgressMetric,
  candidates: ExerciseProgressCandidate[],
  requestedUnit?: WeightUnit,
): ExerciseProgress["unit"] {
  if (metric === "duration") return "seconds";
  if (metric === "rounds") return "rounds";
  if (metric === "reps") return "reps";
  if (requestedUnit) return requestedUnit;

  if (metric === "epley_estimated_1rm") {
    const latestWeighted = newestCandidate(candidates.filter(
      (candidate) => externalLoad(candidate, "lb") !== null,
    ));
    return canonicalWeightUnit(latestWeighted?.weightUnit ?? "") ?? "lb";
  }

  const latestWeighted = newestCandidate(candidates.filter(
    (candidate) => totalLoad(candidate, "lb") !== null,
  ));
  return canonicalWeightUnit(latestWeighted?.bodyWeightUnit ?? "") ??
    canonicalWeightUnit(latestWeighted?.weightUnit ?? "") ??
    "lb";
}

function pointMeasurement(
  candidate: ExerciseProgressCandidate,
  metric: ExerciseProgressMetric,
  unit: ExerciseProgress["unit"],
  seriesLoadType: LoadType,
): PointMeasurement | null {
  if (metric === "duration") {
    return candidate.setType !== "warmup" && candidate.setType !== "drop" &&
      candidate.targetType === "duration" && finitePositive(candidate.actualDurationSec)
      ? {
          value: candidate.actualDurationSec!,
          effectiveLoad: null,
          effectiveLoadUnit: null,
        }
      : null;
  }

  const reps = comparableReps(candidate);
  if (metric === "rounds" || metric === "reps") {
    if (!STRENGTH_SET_TYPES.has(candidate.setType) && candidate.setType !== "emom") return null;
    if (candidate.targetType !== (metric === "rounds" ? "rounds" : "reps")) return null;
    if (metric === "reps" && candidate.loadType !== seriesLoadType) return null;
    return reps === null
      ? null
      : { value: reps, effectiveLoad: null, effectiveLoadUnit: null };
  }

  if (unit !== "lb" && unit !== "kg") return null;
  const effectiveLoad = metric === "epley_estimated_1rm"
    ? externalLoad(candidate, unit)
    : totalLoad(candidate, unit);
  const estimateReps = validEstimateReps(candidate);
  if (effectiveLoad === null || estimateReps === null) return null;
  return {
    value: epleyEstimatedOneRepMax(effectiveLoad, estimateReps),
    effectiveLoad,
    effectiveLoadUnit: unit,
  };
}

function isBetterPoint(
  next: ExerciseProgressPoint & { setPosition: number },
  current: ExerciseProgressPoint & { setPosition: number },
) {
  if (next.value !== current.value) return next.value > current.value;
  const nextEffectiveLoad = next.effectiveLoad ?? -1;
  const currentEffectiveLoad = current.effectiveLoad ?? -1;
  if (nextEffectiveLoad !== currentEffectiveLoad) {
    return nextEffectiveLoad > currentEffectiveLoad;
  }
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
  unit: requestedUnit,
}: BuildExerciseProgressInput): ExerciseProgress {
  const validCandidates = candidates.filter((candidate) =>
    Number.isFinite(Date.parse(candidate.performedAt))
  );
  const seriesLoadType = newestCandidate(validCandidates)?.loadType ?? defaultLoadType;
  const metric = metricFor(trackingType, defaultLoadType, validCandidates);
  const unit = metricUnit(metric, validCandidates, requestedUnit);
  const bestByWorkout = new Map<string, ExerciseProgressPoint & { setPosition: number }>();

  for (const candidate of validCandidates) {
    const measurement = pointMeasurement(candidate, metric, unit, seriesLoadType);
    if (
      measurement === null ||
      !Number.isFinite(measurement.value) ||
      measurement.value <= 0
    ) {
      continue;
    }
    const actualReps = comparableReps(candidate);
    const point = {
      workoutId: candidate.workoutId,
      routineCode: candidate.routineCode,
      routineTitle: candidate.routineTitle,
      workoutStatus: candidate.workoutStatus,
      performedAt: candidate.performedAt,
      setId: candidate.setId,
      value: measurement.value,
      actualWeight: candidate.actualWeight,
      actualReps,
      actualDurationSec: candidate.actualDurationSec,
      weightUnit: candidate.weightUnit,
      loadType: candidate.loadType,
      effectiveLoad: measurement.effectiveLoad,
      effectiveLoadUnit: measurement.effectiveLoadUnit,
      bodyWeight: candidate.bodyWeight,
      bodyWeightUnit: candidate.bodyWeightUnit,
      bodyWeightEstimated: candidate.bodyWeightSource === "profile_backfill",
      setPosition: candidate.setPosition,
    } satisfies ExerciseProgressPoint & { setPosition: number };
    const current = bestByWorkout.get(candidate.workoutId);
    if (!current || isBetterPoint(point, current)) bestByWorkout.set(candidate.workoutId, point);
  }

  const allPoints = [...bestByWorkout.values()]
    .sort((a, b) => Date.parse(a.performedAt) - Date.parse(b.performedAt) || a.workoutId.localeCompare(b.workoutId));
  const points = allPoints
    .slice(Math.max(0, allPoints.length - limit))
    .map(({ setPosition: _setPosition, ...point }) => point);
  return {
    exerciseId,
    metric,
    unit,
    points,
    hasMore: allPoints.length > points.length,
  };
}
