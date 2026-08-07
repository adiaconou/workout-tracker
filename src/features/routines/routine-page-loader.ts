import type { BootstrapPayload, WorkoutHistoryPage } from "../../api/types";
import { recentWorkoutRangeStart } from "./routine-card-format";

export type RoutinePageRequest = <T>(path: string) => Promise<T>;

type RoutinePageLoadOptions = {
  request: RoutinePageRequest;
  onRecentHistory: (history: WorkoutHistoryPage) => void;
  onRecentHistoryError: () => void;
  onRecentHistorySettled: () => void;
  now?: Date;
};

export function loadRoutinePageData({
  request,
  onRecentHistory,
  onRecentHistoryError,
  onRecentHistorySettled,
  now = new Date(),
}: RoutinePageLoadOptions) {
  const historyParams = new URLSearchParams({
    view: "history",
    from: recentWorkoutRangeStart(now),
    limit: "50",
    offset: "0",
  });

  void request<{ history: WorkoutHistoryPage }>(
    `/api/v1/workouts?${historyParams.toString()}`,
  ).then(
    ({ history }) => {
      try {
        onRecentHistory(history);
      } finally {
        onRecentHistorySettled();
      }
    },
    () => {
      try {
        onRecentHistoryError();
      } finally {
        onRecentHistorySettled();
      }
    },
  );

  return request<BootstrapPayload>("/api/v1/bootstrap");
}
