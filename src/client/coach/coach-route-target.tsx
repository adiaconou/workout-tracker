import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useCoachOverlay } from "./coach-overlay-host";
import type { CoachTargetSelection } from "./coach-conversation-state";
export function useCoachRouteTarget() {
  const { registerTarget } = useCoachOverlay();
  const [target, setTarget] = useState<CoachTargetSelection | null>(null);
  useFocusEffect(useCallback(() => registerTarget(target), [registerTarget, target]));
  return setTarget;
}
