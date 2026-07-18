import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "./client";

const STORAGE_KEY = "workout-tracker.pending-set-writes.v1";

function createOperationId() {
  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join("-");
}

export type PendingSetWrite = {
  operationId: string;
  workoutId: string;
  prescribedSetId: string;
  createdAt: string;
  body: {
    prescribedSetId: string;
    status: "Completed" | "Skipped";
    actualWeight: number | null;
    actualReps: number | null;
    actualDurationSec: number | null;
  };
};

async function readQueue(): Promise<PendingSetWrite[]> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as PendingSetWrite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingSetWrite[]) {
  if (queue.length) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  else await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function enqueueSetWrite(
  workoutId: string,
  body: PendingSetWrite["body"],
) {
  const queue = await readQueue();
  const existing = queue.find(
    (item) => item.workoutId === workoutId && item.prescribedSetId === body.prescribedSetId,
  );
  const pending: PendingSetWrite = {
    operationId: existing?.operationId ?? createOperationId(),
    workoutId,
    prescribedSetId: body.prescribedSetId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    body,
  };
  await writeQueue([
    ...queue.filter((item) => item.operationId !== pending.operationId),
    pending,
  ]);
  return pending;
}

export async function removePendingSetWrite(operationId: string) {
  const queue = await readQueue();
  await writeQueue(queue.filter((item) => item.operationId !== operationId));
}

export async function countPendingSetWrites(workoutId?: string) {
  const queue = await readQueue();
  return workoutId ? queue.filter((item) => item.workoutId === workoutId).length : queue.length;
}

export async function flushPendingSetWrites() {
  const queue = await readQueue();
  for (const pending of queue) {
    try {
      await apiRequest(`/api/v1/workouts/${encodeURIComponent(pending.workoutId)}/sets`, {
        method: "POST",
        headers: { "x-idempotency-key": pending.operationId },
        body: JSON.stringify(pending.body),
      });
      await removePendingSetWrite(pending.operationId);
    } catch {
      break;
    }
  }
}
