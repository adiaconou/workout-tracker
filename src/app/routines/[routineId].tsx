import { useLocalSearchParams } from "expo-router";
import { RoutineDetailScreen } from "../../client/routines/routine-detail-screen";
import { useCoachRouteTarget } from "../../client/coach/coach-route-target";

export default function RoutineDetailRoute() {
  const onCoachTargetChange = useCoachRouteTarget();
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  return <RoutineDetailScreen routineId={routineId} onCoachTargetChange={onCoachTargetChange} />;
}
