import type {
  AvailabilityStatus,
  RoutineRecommendation,
} from "../../domain/recommendations";

type RoutineLastDoneOptions = {
  now?: Date;
  timeZone?: string;
};

type RoutineWithLastWorkout = {
  lastWorkoutAt: string | null;
};

export type RoutineAvailabilityKind = AvailabilityStatus;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROUTINE_TITLE_LENGTH = 30;

const MUSCLE_GROUP_PATTERNS = [
  { label: "back", pattern: /\b(back|lats?|pull(?:-?ups?)?)\b/i },
  { label: "chest", pattern: /\b(chest|pecs?|bench(?:\s+press)?|push-?ups?|dips?)\b/i },
  { label: "shoulders", pattern: /\b(shoulders?|delts?|overhead(?:\s+press)?|military\s+press)\b/i },
  { label: "arms", pattern: /\b(arms?|biceps?|triceps?|curls?)\b/i },
  { label: "legs", pattern: /\b(legs?|quads?|hamstrings?|glutes?|calves?|squats?|lunges?)\b/i },
  { label: "core", pattern: /\b(core|abs?|abdominals?|obliques?)\b/i },
  { label: "forearms", pattern: /\b(grip|forearms?)\b/i },
] as const;

function localDateParts(value: Date, timeZone?: string) {
  if (!timeZone) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function calendarDay(parts: { year: number; month: number; day: number }) {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS;
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function listTitle(groups: readonly string[]) {
  const title = groups.length === 1
    ? groups[0]!
    : `${groups.slice(0, -1).join(", ")} & ${groups.at(-1)}`;
  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`;
}

export function routineMuscleTitle(focus: string, summary = "") {
  const routineCopy = `${focus} ${summary}`;
  const matchingGroups = MUSCLE_GROUP_PATTERNS
    .filter(({ pattern }) => pattern.test(routineCopy))
    .map(({ label }) => label);
  if (!matchingGroups.length) return "Muscle groups not set";

  const included: string[] = [];
  for (const group of matchingGroups) {
    const candidate = listTitle([...included, group]);
    if (candidate.length > MAX_ROUTINE_TITLE_LENGTH) continue;
    included.push(group);
  }
  return listTitle(included);
}

export function routineLastDoneLabel(
  value: string | null,
  options: RoutineLastDoneOptions = {},
) {
  if (!value) return "--/--/-- · Never";
  const completedAt = new Date(value);
  if (!Number.isFinite(completedAt.getTime())) return "--/--/-- · Unknown";

  const now = options.now ?? new Date();
  const completedParts = localDateParts(completedAt, options.timeZone);
  const nowParts = localDateParts(now, options.timeZone);
  const daysAgo = Math.max(0, calendarDay(nowParts) - calendarDay(completedParts));
  const dateLabel = `${twoDigits(completedParts.month)}/${twoDigits(completedParts.day)}/${twoDigits(completedParts.year % 100)}`;
  return `${dateLabel} · ${daysAgo} ${daysAgo === 1 ? "day" : "days"} ago`;
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
    return `Avg ${minutes} min`;
  }
  return `Est. ${Math.max(1, Math.round(estimatedDurationMinutes))} min`;
}

export function sortRoutinesByLastDone<T extends RoutineWithLastWorkout>(
  routines: readonly T[],
) {
  return routines
    .map((routine, originalIndex) => {
      const timestamp = routine.lastWorkoutAt
        ? new Date(routine.lastWorkoutAt).getTime()
        : Number.NEGATIVE_INFINITY;
      return {
        routine,
        originalIndex,
        timestamp: Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY,
      };
    })
    .sort((left, right) =>
      right.timestamp - left.timestamp || left.originalIndex - right.originalIndex)
    .map(({ routine }) => routine);
}

export function routineAvailabilityKind(
  guidance: RoutineRecommendation | undefined,
): RoutineAvailabilityKind {
  if (!guidance) return "caution";
  if (!guidance.equipmentCompatible) return "unavailable";
  return guidance.availability;
}
