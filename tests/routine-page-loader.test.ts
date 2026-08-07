import assert from "node:assert/strict";
import test from "node:test";
import type { BootstrapPayload, WorkoutHistoryPage } from "../src/api/types";
import {
  loadRoutinePageData,
  type RoutinePageRequest,
} from "../src/features/routines/routine-page-loader";

const bootstrap = { routines: [] } as unknown as BootstrapPayload;
const history: WorkoutHistoryPage = {
  workouts: [],
  stats: { workoutCount: 0, completedSets: 0, durationSeconds: 0 },
  hasMore: false,
  offset: 0,
};

test("loads core routines without waiting for recent workout history", async () => {
  const paths: string[] = [];
  let resolveHistory!: (value: { history: WorkoutHistoryPage }) => void;
  const pendingHistory = new Promise<{ history: WorkoutHistoryPage }>((resolve) => {
    resolveHistory = resolve;
  });
  let receivedHistory: WorkoutHistoryPage | null = null;
  let historySettled = false;
  const request: RoutinePageRequest = <T>(path: string) => {
    paths.push(path);
    if (path === "/api/v1/bootstrap") return Promise.resolve(bootstrap as T);
    return pendingHistory as Promise<T>;
  };

  const result = await loadRoutinePageData({
    request,
    now: new Date("2026-08-07T12:00:00.000Z"),
    onRecentHistory: (value) => { receivedHistory = value; },
    onRecentHistoryError: () => assert.fail("History should not fail."),
    onRecentHistorySettled: () => { historySettled = true; },
  });

  assert.equal(result, bootstrap);
  assert.equal(receivedHistory, null);
  assert.equal(historySettled, false);
  assert.equal(paths[1], "/api/v1/bootstrap");
  const historyUrl = new URL(paths[0], "https://workout.test");
  assert.equal(historyUrl.pathname, "/api/v1/workouts");
  assert.equal(historyUrl.searchParams.get("view"), "history");
  assert.equal(historyUrl.searchParams.get("from"), "2026-07-31T12:00:00.000Z");
  assert.equal(historyUrl.searchParams.get("limit"), "50");

  resolveHistory({ history });
  await pendingHistory;
  assert.equal(receivedHistory, history);
  assert.equal(historySettled, true);
});

test("reports recent-history failure without rejecting the routines bootstrap", async () => {
  let historyFailed = false;
  let historySettled = false;
  const request: RoutinePageRequest = <T>(path: string) => path === "/api/v1/bootstrap"
    ? Promise.resolve(bootstrap as T)
    : Promise.reject(new Error("History unavailable"));

  const result = await loadRoutinePageData({
    request,
    onRecentHistory: () => assert.fail("History should not succeed."),
    onRecentHistoryError: () => { historyFailed = true; },
    onRecentHistorySettled: () => { historySettled = true; },
  });
  await Promise.resolve();

  assert.equal(result, bootstrap);
  assert.equal(historyFailed, true);
  assert.equal(historySettled, true);
});
