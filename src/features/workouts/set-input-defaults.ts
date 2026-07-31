import type { GuidedSet } from "../../../lib/workout";

export type CompletedSetInput = {
  actualWeight: number;
  actualReps: number | null;
};

export function getSetInputDefaults(
  set: Pick<GuidedSet, "loadType" | "targetUnit">,
  previous?: CompletedSetInput,
) {
  const startsAtZero = set.loadType === "bodyweight" || set.loadType === "added";

  return {
    weight: previous ? String(previous.actualWeight) : startsAtZero ? "0" : "",
    result:
      set.targetUnit === "reps" && previous?.actualReps != null
        ? String(previous.actualReps)
        : "",
  };
}
