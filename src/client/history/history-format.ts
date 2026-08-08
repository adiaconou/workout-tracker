import type {
  Workout,
  WorkoutHistorySummary,
  WorkoutSet,
} from "../../domain/entities";

export type HistoryRange = "30" | "90" | "365" | "all";

export function historyRangeStart(
  range: HistoryRange,
  now = new Date(),
) {
  if (range === "all") return null;
  const start = new Date(now);
  start.setDate(start.getDate() - Number(range));
  return start.toISOString();
}

export function historyRangeLabel(range: HistoryRange) {
  if (range === "30") return "Last 30 days";
  if (range === "90") return "Last 90 days";
  if (range === "365") return "Last year";
  return "All time";
}

export function formatHistoryDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.round((safeSeconds % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

export function formatWorkoutDuration(totalSeconds: number) {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return `${minutes} min`;
}

export function historyStatusLabel(
  status: WorkoutHistorySummary["status"] | Workout["status"],
) {
  if (status === "Partial") return "Finished early";
  if (status === "Abandoned") return "Abandoned";
  if (status === "In Progress") return "In progress";
  return "Completed";
}

export function formatHistoryDay(value: string, now = new Date()) {
  const date = new Date(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const difference = Math.round(
    (today.getTime() - target.getTime()) / 86_400_000,
  );
  if (difference === 0) return "Today";
  if (difference === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatHistoryDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatMuscleGroup(value: string) {
  return value
    .split("_")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(" ");
}

export function formatSetResult(
  set: WorkoutSet,
  loadType: string,
) {
  if (set.status === "skipped") return "Skipped";
  if (set.actualDurationSec !== null) {
    const load = set.actualWeight && set.actualWeight > 0
      ? ` · ${set.actualWeight} ${set.weightUnit}`
      : "";
    return `${set.actualDurationSec} sec${load}`;
  }
  if (set.actualReps === null) return "—";
  if (
    (loadType === "bodyweight" || loadType === "added") &&
    (!set.actualWeight || set.actualWeight === 0)
  ) {
    return `Bodyweight × ${set.actualReps}`;
  }
  return set.actualWeight !== null
    ? `${set.actualWeight} ${set.weightUnit} × ${set.actualReps}`
    : `${set.actualReps} reps`;
}
