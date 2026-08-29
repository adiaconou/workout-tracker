import { useLocalSearchParams } from "expo-router";
import { ActiveWorkoutScreen } from "../../client/workouts/active-workout-screen";
import { CoachLauncher } from "../../client/coach/coach-overlay-host";

export default function ActiveWorkoutRoute() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return (
    <ActiveWorkoutScreen
      sessionId={sessionId}
      headerRightAccessory={<CoachLauncher />}
    />
  );
}
