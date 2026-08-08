import type { WorkoutSet } from "../../domain/entities";
import type { WorkoutHistoryPage } from "../../contracts/api";
import {
  formatHistoryDay,
  historyRangeStart,
  type HistoryRange,
} from "./history-format";

const HISTORY_PAGE_SIZE = 20;

export type HistoryFilters = {
  routineCode: string;
  status: string;
  exercise: string;
};

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  routineCode: "",
  status: "",
  exercise: "",
};

export function normalizeHistoryFilters(filters: HistoryFilters): HistoryFilters {
  return { ...filters, exercise: filters.exercise.trim() };
}

export function countActiveHistoryFilters(filters: HistoryFilters) {
  return [filters.routineCode, filters.status, filters.exercise.trim()].filter(Boolean).length;
}

export function buildHistoryRequestPath(
  range: HistoryRange,
  filters: HistoryFilters,
  offset: number,
  now = new Date(),
) {
  const params = new URLSearchParams({
    view: "history",
    limit: String(HISTORY_PAGE_SIZE),
    offset: String(offset),
  });
  const from = historyRangeStart(range, now);
  if (from) params.set("from", from);
  if (filters.routineCode) params.set("routineCode", filters.routineCode);
  if (filters.status) params.set("status", filters.status);
  const exercise = filters.exercise.trim();
  if (exercise) params.set("exercise", exercise);
  return `/api/v1/workouts?${params.toString()}`;
}

export function mergeHistoryPage(
  current: WorkoutHistoryPage | null,
  incoming: WorkoutHistoryPage,
  offset: number,
): WorkoutHistoryPage {
  if (offset === 0 || !current) return incoming;
  return {
    ...incoming,
    workouts: [...current.workouts, ...incoming.workouts],
  };
}

export function groupHistoryWorkouts(
  history: WorkoutHistoryPage | null,
  now = new Date(),
) {
  const groups = new Map<
    string,
    {
      label: string;
      workouts: WorkoutHistoryPage["workouts"];
    }
  >();
  for (const workout of history?.workouts ?? []) {
    const date = new Date(workout.startedAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const group = groups.get(key) ?? {
      label: formatHistoryDay(workout.startedAt, now),
      workouts: [],
    };
    groups.set(key, {
      ...group,
      workouts: [...group.workouts, workout],
    });
  }
  return [...groups.entries()];
}

export type SetEditStatus = "completed" | "skipped";

export type SetEditDraft = {
  status: SetEditStatus;
  weight: string;
  result: string;
  rir: string;
  rest: string;
  notes: string;
};

export type SetEditValues = {
  status: SetEditStatus;
  weight: number | null;
  reps: number | null;
  duration: number | null;
  rir: number | null;
  rest: number | null;
  notes: string;
};

export function nonNegativeNumberOrNull(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function setEditDraftFromSet(set: WorkoutSet): SetEditDraft {
  return {
    status: set.status === "skipped" ? "skipped" : "completed",
    weight: set.actualWeight === null ? "" : String(set.actualWeight),
    result: String(
      set.plannedTargetType === "duration"
        ? set.actualDurationSec ?? ""
        : set.actualReps ?? "",
    ),
    rir: set.actualRir === null ? "" : String(set.actualRir),
    rest: set.actualRestSec === null ? "" : String(set.actualRestSec),
    notes: set.notes,
  };
}

export function setEditValuesFromDraft(
  set: WorkoutSet,
  draft: SetEditDraft,
): SetEditValues {
  const durationTarget = set.plannedTargetType === "duration";
  return {
    status: draft.status,
    weight: nonNegativeNumberOrNull(draft.weight),
    reps: durationTarget ? null : nonNegativeNumberOrNull(draft.result),
    duration: durationTarget ? nonNegativeNumberOrNull(draft.result) : null,
    rir: nonNegativeNumberOrNull(draft.rir),
    rest: nonNegativeNumberOrNull(draft.rest),
    notes: draft.notes,
  };
}

export function setCorrectionPayload(values: SetEditValues) {
  const completed = values.status === "completed";
  return {
    status: values.status,
    actualWeight: completed ? values.weight : null,
    actualReps: completed ? values.reps : null,
    actualDurationSec: completed ? values.duration : null,
    actualRir: completed ? values.rir : null,
    actualRestSec: completed ? values.rest : null,
    notes: values.notes,
  };
}
