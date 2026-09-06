import { useLocalSearchParams } from "expo-router";
import { ExerciseDetailScreen } from "../../client/exercises/exercise-detail-screen";
import { useCoachRouteTarget } from "../../client/coach/coach-route-target";
import { exerciseIdFromParam } from "../../client/exercises/exercise-routes";

export default function ExerciseDetailRoute() {
  const onCoachTargetChange = useCoachRouteTarget();
  const { exerciseId } = useLocalSearchParams<{ exerciseId?: string | string[] }>();
  return <ExerciseDetailScreen exerciseId={exerciseIdFromParam(exerciseId)} onCoachTargetChange={onCoachTargetChange} />;
}
