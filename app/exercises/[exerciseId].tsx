import { useLocalSearchParams } from "expo-router";
import { ExerciseDetailScreen } from "../../src/features/exercises/exercise-detail-screen";

export default function ExerciseDetailRoute() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  return <ExerciseDetailScreen exerciseId={exerciseId} />;
}
