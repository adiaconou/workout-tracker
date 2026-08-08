import { useLocalSearchParams } from "expo-router";
import { RoutineDetailScreen } from "../../client/routines/routine-detail-screen";

export default function RoutineDetailRoute() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  return <RoutineDetailScreen routineId={routineId} />;
}
