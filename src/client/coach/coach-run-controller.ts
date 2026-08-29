import {
  coachRunIsActive,
  coachRunPollDelay,
  coachRunRetryDelay,
  type CoachRunConnection,
  type CoachRunResponse,
} from "./coach-model";

export type CoachRunRequest = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T>;

export type CoachRunController = ReturnType<typeof createCoachRunController>;

export function createCoachRunController(dependencies: {
  request: CoachRunRequest;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancelScheduled: (handle: unknown) => void;
  isRetryableError: (error: unknown) => boolean;
  errorMessage: (error: unknown) => string;
  onResponse: (response: CoachRunResponse) => void;
  onConnection: (connection: CoachRunConnection) => void;
  onFatalError: (message: string) => void;
}) {
  let runId: string | null = null;
  let scheduled: unknown = null;
  let requestController: AbortController | null = null;
  let advancing = false;
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
    advancing = false;
  }

  function scheduleAdvance(delayMs: number) {
    const scheduledRevision = revision;
    scheduled = dependencies.schedule(() => {
      scheduled = null;
      if (scheduledRevision !== revision) return;
      void advance();
    }, delayMs);
  }

  async function advance() {
    if (!runId || paused || advancing || !shouldPoll) return;
    const requestedRunId = runId;
    const requestedRevision = revision;
    const controller = new AbortController();
    requestController = controller;
    advancing = true;
    try {
      const payload = await dependencies.request<CoachRunResponse>(
        `/api/v1/assistant/message-runs/${encodeURIComponent(requestedRunId)}/advance`,
        { method: "POST", signal: controller.signal },
      );
      if (
        requestedRevision !== revision
        || requestedRunId !== runId
        || payload.run.id !== requestedRunId
      ) return;
      consecutiveFailures = 0;
      shouldPoll = coachRunIsActive(payload.run.status);
      dependencies.onConnection("connected");
      dependencies.onResponse(payload);
      if (shouldPoll) scheduleAdvance(coachRunPollDelay(payload.run));
    } catch (error) {
      if (requestedRevision !== revision || controller.signal.aborted) return;
      if (!dependencies.isRetryableError(error)) {
        dependencies.onConnection("failed");
        dependencies.onFatalError(dependencies.errorMessage(error));
        return;
      }
      consecutiveFailures += 1;
      dependencies.onConnection("reconnecting");
      scheduleAdvance(coachRunRetryDelay(consecutiveFailures));
    } finally {
      if (requestedRevision === revision) {
        requestController = null;
        advancing = false;
      }
    }
  }

  function monitor(run: CoachRunResponse["run"]) {
    invalidatePendingWork();
    runId = run.id;
    consecutiveFailures = 0;
    shouldPoll = coachRunIsActive(run.status);
    if (paused) {
      dependencies.onConnection("paused");
      return;
    }
    dependencies.onConnection("connected");
    if (shouldPoll) scheduleAdvance(coachRunPollDelay(run));
  }

  function pause() {
    if (paused) return;
    paused = true;
    invalidatePendingWork();
    if (runId && shouldPoll) dependencies.onConnection("paused");
  }

  function resume() {
    if (!paused) return;
    paused = false;
    if (!runId || !shouldPoll) return;
    dependencies.onConnection("connected");
    scheduleAdvance(0);
  }

  function checkNow() {
    if (!runId || !shouldPoll || paused || advancing) return;
    if (scheduled !== null) dependencies.cancelScheduled(scheduled);
    scheduled = null;
    void advance();
  }

  function stop() {
    invalidatePendingWork();
    runId = null;
    shouldPoll = false;
    consecutiveFailures = 0;
  }

  return { monitor, pause, resume, checkNow, stop };
}
