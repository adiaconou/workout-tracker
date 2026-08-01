import { useLocalSearchParams } from "expo-router";
import { ExerciseDetailScreen } from "../../src/features/exercises/exercise-detail-screen";
import { exerciseIdFromParam } from "../../src/features/exercises/exercise-routes";

export default function ExerciseDetailRoute() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId?: string | string[] }>();
  return <ExerciseDetailScreen exerciseId={exerciseIdFromParam(exerciseId)} />;
}
