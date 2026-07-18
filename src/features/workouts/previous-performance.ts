import type { PreviousExerciseSet } from "../../../lib/store";

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
  const result = set.actualReps !== null
    ? `${displayNumber(set.actualReps)} reps`
    : set.actualDurationSec !== null
      ? `${displayNumber(set.actualDurationSec)} sec`
      : "—";
  return `${weight} × ${result}`;
}
