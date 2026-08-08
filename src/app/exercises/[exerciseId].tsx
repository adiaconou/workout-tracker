import { useLocalSearchParams } from "expo-router";
import { ExerciseDetailScreen } from "../../client/exercises/exercise-detail-screen";
import { exerciseIdFromParam } from "../../client/exercises/exercise-routes";

export default function ExerciseDetailRoute() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId?: string | string[] }>();
  return <ExerciseDetailScreen exerciseId={exerciseIdFromParam(exerciseId)} />;
}
