import type { GuidedSet } from "../../domain/workout";

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
