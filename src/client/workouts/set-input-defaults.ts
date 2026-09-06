import type { GuidedSet } from "../../domain/workout";
import type { RecordedSetPerformance } from "../../contracts/api";

export type SetInputValues = {
  weight: string;
  result: string;
};

type DefaultableSet = Pick<GuidedSet, "loadType" | "targetUnit"> & Partial<
  Pick<GuidedSet, "target" | "targetMax" | "targetMin">
>;

type InputSet = Pick<GuidedSet, "id" | "exerciseOrder"> & DefaultableSet;

type InputPerformance = Pick<
  RecordedSetPerformance,
  "status" | "actualWeight" | "actualReps" | "actualDurationSec"
>;

function numericTarget(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function multiplicationTarget(value: string | undefined) {
  const match = value?.match(/[×x]\s*(\d+(?:\.\d+)?)/iu);
  return match ? numericTarget(Number(match[1])) : null;
}

function legacyDisplayTarget(value: string | undefined) {
  const numbers = value?.match(/\d+(?:\.\d+)?/gu);
  return numbers?.length ? numericTarget(Number(numbers[numbers.length - 1])) : null;
}

export function getSetInputDefaults(set: DefaultableSet): SetInputValues {
  const startsAtZero = set.loadType === "bodyweight" || set.loadType === "added";
  const target = multiplicationTarget(set.target)
    ?? numericTarget(set.targetMax)
    ?? numericTarget(set.targetMin)
    ?? legacyDisplayTarget(set.target);

  return {
    weight: startsAtZero ? "0" : "",
    result: target === null ? "" : String(target),
  };
}

export function getReadySetInputDefaults(
  sets: readonly InputSet[],
  readyIndex: number,
  performanceBySetId: Readonly<Record<string, InputPerformance | undefined>>,
): SetInputValues {
  const readySet = sets[readyIndex];
  if (!readySet) return { weight: "", result: "" };

  const defaults = getSetInputDefaults(readySet);
  for (let index = readyIndex - 1; index >= 0; index -= 1) {
    const previousSet = sets[index];
    if (!previousSet || previousSet.exerciseOrder !== readySet.exerciseOrder) continue;

    const performance = performanceBySetId[previousSet.id];
    if (!performance || performance.status !== "Completed") continue;

    const recorded = getRecordedSetInputValues(previousSet, performance);
    return {
      weight: recorded.weight || defaults.weight,
      result:
        previousSet.targetUnit === readySet.targetUnit && recorded.result
          ? recorded.result
          : defaults.result,
    };
  }
  return defaults;
}

export function getRecordedSetInputValues(
  set: Pick<GuidedSet, "targetUnit">,
  performance: Pick<
    RecordedSetPerformance,
    "status" | "actualWeight" | "actualReps" | "actualDurationSec"
  >,
): SetInputValues {
  if (performance.status === "Skipped") return { weight: "", result: "" };

  const recordedResult = set.targetUnit === "seconds"
    ? performance.actualDurationSec
    : performance.actualReps;
  return {
    weight: performance.actualWeight === null ? "" : String(performance.actualWeight),
    result: recordedResult === null ? "" : String(recordedResult),
  };
}
