import { useLocalSearchParams } from "expo-router";
import { WorkoutHistoryDetailScreen } from "../../src/features/history/workout-history-detail-screen";

export default function WorkoutHistoryDetailRoute() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  return <WorkoutHistoryDetailScreen workoutId={workoutId} />;
}
