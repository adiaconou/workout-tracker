import { useLocalSearchParams } from "expo-router";
import { ActiveWorkoutScreen } from "../../client/workouts/active-workout-screen";
import { useCoachRouteTarget } from "../../client/coach/coach-route-target";

export default function ActiveWorkoutRoute() {
  const onCoachTargetChange = useCoachRouteTarget();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return <ActiveWorkoutScreen sessionId={sessionId} onCoachTargetChange={onCoachTargetChange} />;
}
