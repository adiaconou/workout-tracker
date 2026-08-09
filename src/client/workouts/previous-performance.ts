import type { PreviousExerciseSet } from "../../contracts/api";

function displayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatPreviousSetPerformance(
  set: PreviousExerciseSet | undefined,
) {
  if (!set || set.status !== "completed") return "— × —";
  const weight = set.actualWeight === null
    ? "—"
    : `${displayNumber(set.actualWeight)} ${set.weightUnit}`;
  const result = set.targetType === "duration"
    ? set.actualDurationSec === null
      ? "—"
      : `${displayNumber(set.actualDurationSec)} sec`
    : set.targetType === "reps" || set.targetType === "rounds"
      ? set.actualReps === null
        ? "—"
        : `${displayNumber(set.actualReps)} ${set.targetType === "rounds" ? "rounds" : "reps"}`
      : set.actualReps !== null
        ? `${displayNumber(set.actualReps)} reps`
        : set.actualDurationSec !== null
          ? `${displayNumber(set.actualDurationSec)} sec`
          : "—";
  return `${weight} × ${result}`;
}
