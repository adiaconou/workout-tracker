import { useLocalSearchParams } from "expo-router";
import { RoutineCreateScreen } from "../../client/routines/routine-create-screen";

export default function RoutineCreateRoute() {
  const { mode, generationId } = useLocalSearchParams<{
    mode?: string;
    generationId?: string | string[];
  }>();
  const generationIdValue = Array.isArray(generationId) ? generationId[0] : generationId;
  const initialGenerationId = generationIdValue?.trim() || null;
  const initialMode = initialGenerationId
    ? "ai"
    : mode === "manual" || mode === "ai"
      ? mode
      : null;

  return (
    <RoutineCreateScreen
      initialMode={initialMode}
      initialGenerationId={initialGenerationId}
    />
  );
}
