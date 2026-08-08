import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "./client";

const LEGACY_STORAGE_KEY = "workout-tracker.pending-set-writes.v1";
const STORAGE_KEY_PREFIX = "workout-tracker.pending-set-writes.v2";

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

export type PendingSetWriteStorage = Pick<
  typeof AsyncStorage,
  "getItem" | "setItem" | "removeItem"
>;

export type PendingSetWriteQueueDependencies = {
  storage: PendingSetWriteStorage;
  request: typeof apiRequest;
  now: () => number;
  random: () => number;
};

export function createPendingSetWriteQueue(dependencies: PendingSetWriteQueueDependencies) {
  let activeStorageKey: string | null = null;

  async function configureOwner(userId: string | null) {
    const normalizedUserId = userId?.trim() ?? "";
    activeStorageKey = normalizedUserId
      ? `${STORAGE_KEY_PREFIX}.${encodeURIComponent(normalizedUserId)}`
      : null;
    // The legacy queue was shared by every account on the device, so it cannot
    // be safely attributed after multi-user sign-in becomes available.
    await dependencies.storage.removeItem(LEGACY_STORAGE_KEY).catch(() => undefined);
  }

  function createOperationId() {
    return [
      dependencies.now().toString(36),
      dependencies.random().toString(36).slice(2),
      dependencies.random().toString(36).slice(2),
    ].join("-");
  }

  async function readQueue(
    storageKey: string | null = activeStorageKey,
  ): Promise<PendingSetWrite[]> {
    if (!storageKey) return [];
    const value = await dependencies.storage.getItem(storageKey);
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as PendingSetWrite[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeQueue(
    queue: PendingSetWrite[],
    storageKey: string | null,
  ) {
    if (!storageKey) return;
    if (queue.length) await dependencies.storage.setItem(storageKey, JSON.stringify(queue));
    else await dependencies.storage.removeItem(storageKey);
  }

  async function enqueue(workoutId: string, body: PendingSetWrite["body"]) {
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
      createdAt: existing?.createdAt ?? new Date(dependencies.now()).toISOString(),
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

  async function remove(operationId: string) {
    const storageKey = activeStorageKey;
    const queue = await readQueue(storageKey);
    await writeQueue(queue.filter((item) => item.operationId !== operationId), storageKey);
  }

  async function removeForWorkout(workoutId: string) {
    const storageKey = activeStorageKey;
    const queue = await readQueue(storageKey);
    await writeQueue(queue.filter((item) => item.workoutId !== workoutId), storageKey);
  }

  async function count(workoutId?: string) {
    const queue = await readQueue();
    return workoutId ? queue.filter((item) => item.workoutId === workoutId).length : queue.length;
  }

  async function flush() {
    const storageKey = activeStorageKey;
    const queue = await readQueue(storageKey);
    for (const pending of queue) {
      try {
        await dependencies.request(
          `/api/v1/workouts/${encodeURIComponent(pending.workoutId)}/sets`,
          {
            method: "POST",
            headers: { "x-idempotency-key": pending.operationId },
            body: JSON.stringify(pending.body),
          },
        );
        await writeQueue(
          (await readQueue(storageKey)).filter((item) => item.operationId !== pending.operationId),
          storageKey,
        );
      } catch {
        break;
      }
    }
  }

  return {
    configureOwner,
    enqueue,
    remove,
    removeForWorkout,
    count,
    flush,
  };
}

const defaultQueue = createPendingSetWriteQueue({
  storage: AsyncStorage,
  request: apiRequest,
  now: () => Date.now(),
  random: () => Math.random(),
});

export async function configurePendingSetWriteOwner(userId: string | null) {
  return defaultQueue.configureOwner(userId);
}

export async function enqueueSetWrite(workoutId: string, body: PendingSetWrite["body"]) {
  return defaultQueue.enqueue(workoutId, body);
}

export async function removePendingSetWrite(operationId: string) {
  return defaultQueue.remove(operationId);
}

export async function removePendingSetWritesForWorkout(workoutId: string) {
  return defaultQueue.removeForWorkout(workoutId);
}

export async function countPendingSetWrites(workoutId?: string) {
  return defaultQueue.count(workoutId);
}

export async function flushPendingSetWrites() {
  return defaultQueue.flush();
}
