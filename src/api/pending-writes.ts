import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "./client";

const LEGACY_STORAGE_KEY = "workout-tracker.pending-set-writes.v1";
const STORAGE_KEY_PREFIX = "workout-tracker.pending-set-writes.v2";
let activeStorageKey: string | null = null;

export async function configurePendingSetWriteOwner(userId: string | null) {
  const normalizedUserId = userId?.trim() ?? "";
  activeStorageKey = normalizedUserId
    ? `${STORAGE_KEY_PREFIX}.${encodeURIComponent(normalizedUserId)}`
    : null;
  // The legacy queue was shared by every account on the device, so it cannot
  // be safely attributed after multi-user sign-in becomes available.
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => undefined);
}

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
    workoutElapsedSeconds: number;
  };
};

async function readQueue(storageKey: string | null = activeStorageKey): Promise<PendingSetWrite[]> {
  if (!storageKey) return [];
  const value = await AsyncStorage.getItem(storageKey);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as PendingSetWrite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingSetWrite[], storageKey: string | null = activeStorageKey) {
  if (!storageKey) {
    if (queue.length) throw new Error("A signed-in user is required to queue workout data.");
    return;
  }
  if (queue.length) await AsyncStorage.setItem(storageKey, JSON.stringify(queue));
  else await AsyncStorage.removeItem(storageKey);
}

export async function enqueueSetWrite(
  workoutId: string,
  body: PendingSetWrite["body"],
) {
  const storageKey = activeStorageKey;
  if (!storageKey) throw new Error("A signed-in user is required to queue workout data.");
  const queue = await readQueue(storageKey);
  const existing = queue.find(
    (item) => item.workoutId === workoutId && item.prescribedSetId === body.prescribedSetId,
  );
  const pending: PendingSetWrite = {
    operationId: existing?.operationId ?? createOperationId(),
    workoutId,
    prescribedSetId: body.prescribedSetId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    body: existing
      ? { ...body, workoutElapsedSeconds: existing.body.workoutElapsedSeconds }
      : body,
  };
  await writeQueue([
    ...queue.filter((item) => item.operationId !== pending.operationId),
    pending,
  ], storageKey);
  return pending;
}

export async function removePendingSetWrite(operationId: string) {
  const storageKey = activeStorageKey;
  const queue = await readQueue(storageKey);
  await writeQueue(queue.filter((item) => item.operationId !== operationId), storageKey);
}

export async function removePendingSetWritesForWorkout(workoutId: string) {
  const storageKey = activeStorageKey;
  const queue = await readQueue(storageKey);
  await writeQueue(queue.filter((item) => item.workoutId !== workoutId), storageKey);
}

export async function countPendingSetWrites(workoutId?: string) {
  const queue = await readQueue();
  return workoutId ? queue.filter((item) => item.workoutId === workoutId).length : queue.length;
}

export async function flushPendingSetWrites() {
  const storageKey = activeStorageKey;
  const queue = await readQueue(storageKey);
  for (const pending of queue) {
    try {
      await apiRequest(`/api/v1/workouts/${encodeURIComponent(pending.workoutId)}/sets`, {
        method: "POST",
        headers: { "x-idempotency-key": pending.operationId },
        body: JSON.stringify(pending.body),
      });
      await writeQueue(
        (await readQueue(storageKey)).filter((item) => item.operationId !== pending.operationId),
        storageKey,
      );
    } catch {
      break;
    }
  }
}
