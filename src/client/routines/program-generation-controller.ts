import type { ProgramGenerationJob } from "../../contracts/api";
import {
  programGenerationIsActive,
  programGenerationPollDelay,
  programGenerationRetryDelay,
  type ProgramGenerationConnection,
} from "./program-generation-model";

export type ProgramGenerationRequest = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T>;

export type ProgramGenerationController = ReturnType<typeof createProgramGenerationController>;

export function createProgramGenerationController(dependencies: {
  request: ProgramGenerationRequest;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancelScheduled: (handle: unknown) => void;
  isRetryableError: (error: unknown) => boolean;
  errorMessage: (error: unknown) => string;
  onJob: (job: ProgramGenerationJob) => void;
  onConnection: (connection: ProgramGenerationConnection) => void;
  onFatalError: (message: string) => void;
}) {
  let generationId: string | null = null;
  let scheduled: unknown = null;
  let requestController: AbortController | null = null;
  let polling = false;
  let paused = false;
  let shouldPoll = false;
  let revision = 0;
  let consecutiveFailures = 0;

  function invalidatePendingWork() {
    revision += 1;
    if (scheduled !== null) dependencies.cancelScheduled(scheduled);
    scheduled = null;
    requestController?.abort();
    requestController = null;
    polling = false;
  }

  function schedulePoll(delayMs: number) {
    scheduled = dependencies.schedule(() => {
      scheduled = null;
      void poll();
    }, delayMs);
  }

  async function poll() {
    if (!generationId || paused || polling) return;
    const requestedGenerationId = generationId;
    const requestedRevision = revision;
    const controller = new AbortController();
    requestController = controller;
    polling = true;
    try {
      const payload = await dependencies.request<{ generation: ProgramGenerationJob }>(
        `/api/v1/assistant/program-generations/${encodeURIComponent(requestedGenerationId)}`,
        { signal: controller.signal },
      );
      if (requestedRevision !== revision || requestedGenerationId !== generationId) return;
      consecutiveFailures = 0;
      dependencies.onConnection("connected");
      dependencies.onJob(payload.generation);
      shouldPoll = programGenerationIsActive(payload.generation.status);
      if (shouldPoll) {
        schedulePoll(programGenerationPollDelay(payload.generation));
      }
    } catch (error) {
      if (requestedRevision !== revision || controller.signal.aborted) return;
      if (!dependencies.isRetryableError(error)) {
        dependencies.onConnection("failed");
        dependencies.onFatalError(dependencies.errorMessage(error));
        return;
      }
      consecutiveFailures += 1;
      dependencies.onConnection("reconnecting");
      schedulePoll(programGenerationRetryDelay(consecutiveFailures));
    } finally {
      if (requestedRevision === revision) {
        requestController = null;
        polling = false;
      }
    }
  }

  function monitor(id: string, initialJob?: ProgramGenerationJob) {
    invalidatePendingWork();
    generationId = id;
    consecutiveFailures = 0;
    shouldPoll = initialJob ? programGenerationIsActive(initialJob.status) : true;
    if (initialJob) dependencies.onJob(initialJob);
    if (paused) {
      dependencies.onConnection("paused");
      return;
    }
    dependencies.onConnection("connected");
    if (!shouldPoll) return;
    schedulePoll(initialJob ? programGenerationPollDelay(initialJob) : 0);
  }

  function pause() {
    if (paused) return;
    paused = true;
    invalidatePendingWork();
    if (generationId) dependencies.onConnection("paused");
  }

  function resume() {
    if (!paused) return;
    paused = false;
    dependencies.onConnection("connected");
    if (generationId && shouldPoll) schedulePoll(0);
  }

  function checkNow() {
    if (!generationId || !shouldPoll || paused || polling) return;
    if (scheduled !== null) dependencies.cancelScheduled(scheduled);
    scheduled = null;
    void poll();
  }

  function stop() {
    invalidatePendingWork();
    generationId = null;
    shouldPoll = false;
    consecutiveFailures = 0;
  }

  return { monitor, pause, resume, checkNow, stop };
}
