import { useLocalSearchParams } from "expo-router";
import { RoutineDetailScreen } from "../../src/features/routines/routine-detail-screen";

export default function RoutineDetailRoute() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  return <RoutineDetailScreen routineId={routineId} />;
}
