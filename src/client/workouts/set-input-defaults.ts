import type { GuidedSet } from "../../domain/workout";
import type { RecordedSetPerformance } from "../../contracts/api";

export type SetInputValues = {
  weight: string;
  result: string;
};

export function getSetInputDefaults(
  set: Pick<GuidedSet, "loadType" | "targetUnit">,
): SetInputValues {
  const startsAtZero = set.loadType === "bodyweight" || set.loadType === "added";

  return {
    weight: startsAtZero ? "0" : "",
    result: "",
  };
}

export function getAdvancedSetInputDefaults(
  set: Pick<GuidedSet, "loadType" | "targetUnit">,
  _completedInput: SetInputValues,
) {
  return getSetInputDefaults(set);
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
