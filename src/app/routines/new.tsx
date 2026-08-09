import { useLocalSearchParams } from "expo-router";
import { RoutineCreateScreen } from "../../client/routines/routine-create-screen";

export default function RoutineCreateRoute() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return <RoutineCreateScreen initialMode={mode === "manual" || mode === "ai" ? mode : null} />;
}
