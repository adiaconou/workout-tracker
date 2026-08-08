type RoutineLastDoneOptions = {
  now?: Date;
  locale?: string;
  timeZone?: string;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_HOURS = 24;
const RECENT_WORKOUT_WINDOW_MS = 7 * DAY_HOURS * HOUR_MS;

function plural(value: number, unit: "day" | "hour") {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function routineElapsedLabel(completedAt: Date, now = new Date()) {
  const elapsedMs = now.getTime() - completedAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return "Just now";
  if (elapsedMs < HOUR_MS) return "Less than 1 hour ago";

  const elapsedHours = Math.floor(elapsedMs / HOUR_MS);
  if (elapsedHours < DAY_HOURS) return `${plural(elapsedHours, "hour")} ago`;

  const days = Math.floor(elapsedHours / DAY_HOURS);
  const hours = elapsedHours % DAY_HOURS;
  const parts = [plural(days, "day")];
  if (hours > 0) parts.push(plural(hours, "hour"));
  return `${parts.join(" ")} ago`;
}

export function routineLastDoneLabel(
  value: string | null,
  options: RoutineLastDoneOptions = {},
) {
  if (!value) return "Not done yet";
  const completedAt = new Date(value);
  if (!Number.isFinite(completedAt.getTime())) return "Last workout date unavailable";

  const now = options.now ?? new Date();
  const dateLabel = new Intl.DateTimeFormat(options.locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(completedAt);

  return `Last done ${dateLabel} · ${routineElapsedLabel(completedAt, now)}`;
}

export function routineDurationLabel(
  averageDurationSeconds: number | null,
  durationSampleCount: number,
  estimatedDurationMinutes: number,
) {
  if (
    averageDurationSeconds !== null &&
    Number.isFinite(averageDurationSeconds) &&
    averageDurationSeconds >= 0 &&
    durationSampleCount > 0
  ) {
    const minutes = Math.max(1, Math.round(averageDurationSeconds / 60));
    const samples = Math.max(1, Math.round(durationSampleCount));
    return `Avg ${minutes} min (${samples} ${samples === 1 ? "workout" : "workouts"})`;
  }
  return `Est. ${Math.max(1, Math.round(estimatedDurationMinutes))} min`;
}

export function recentWorkoutRangeStart(now = new Date()) {
  return new Date(now.getTime() - RECENT_WORKOUT_WINDOW_MS).toISOString();
}
