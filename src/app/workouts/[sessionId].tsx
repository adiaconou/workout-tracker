import { useLocalSearchParams } from "expo-router";
import { ActiveWorkoutScreen } from "../../client/workouts/active-workout-screen";

export default function ActiveWorkoutRoute() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return <ActiveWorkoutScreen sessionId={sessionId} />;
}
