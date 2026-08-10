import type {
  ProgramGenerationJob,
  ProgramGenerationStatus,
} from "../../contracts/api";

export type ProgramGenerationConnection =
  | "connected"
  | "paused"
  | "reconnecting"
  | "failed";

export type ProgramGenerationPresentation = {
  title: string;
  detail: string;
  active: boolean;
};

export type ProgramGenerationAttempt = {
  key: string;
  requestFingerprint: string;
};

const activeStatuses = new Set<ProgramGenerationStatus>([
  "starting",
  "queued",
  "in_progress",
  "cancelling",
]);

const retryDelaysMs = [2_000, 4_000, 8_000, 15_000] as const;

export function programGenerationIsActive(status: ProgramGenerationStatus) {
  return activeStatuses.has(status);
}

export function programGenerationRetryDelay(failureCount: number) {
  const index = Math.min(
    retryDelaysMs.length - 1,
    Math.max(0, Math.floor(failureCount) - 1),
  );
  return retryDelaysMs[index]!;
}

export function programGenerationPollDelay(job: ProgramGenerationJob) {
  const requested = Number.isFinite(job.pollAfterMs) && job.pollAfterMs > 0
    ? job.pollAfterMs
    : 2_000;
  return Math.min(15_000, Math.max(1_000, requested));
}

export function programGenerationAttemptKey(
  currentAttempt: ProgramGenerationAttempt | null,
  requestFingerprint: string,
  newAttempt: boolean,
  createKey: () => string,
) {
  return !newAttempt && currentAttempt?.requestFingerprint === requestFingerprint
    ? currentAttempt.key
    : createKey();
}

export function programGenerationCanRetry(job: ProgramGenerationJob) {
  return job.status === "expired" || (job.status === "failed" && Boolean(job.error?.retryable));
}

export function programGenerationPresentation(
  job: ProgramGenerationJob,
  connection: ProgramGenerationConnection,
  routineCount: number,
): ProgramGenerationPresentation {
  const active = programGenerationIsActive(job.status);
  if (active && connection === "reconnecting") {
    return {
      title: "Coach is still working",
      detail: "We lost contact temporarily. We will check again automatically.",
      active: true,
    };
  }
  if (active && connection === "paused") {
    return {
      title: "Progress checks are paused",
      detail: "Coach keeps working on the server. We will check again when you return.",
      active: true,
    };
  }
  if (connection === "failed") {
    return {
      title: "We could not check this generation",
      detail: "The generation may still be running. Check again or return to your details.",
      active,
    };
  }
  if (job.status === "starting" || job.status === "queued") {
    return {
      title: "Coach is getting your program ready",
      detail: "Your request is queued. You can leave this screen; generation will continue.",
      active: true,
    };
  }
  if (job.status === "in_progress") {
    return {
      title: `Coach is building ${routineCount} ${routineCount === 1 ? "routine" : "routines"}`,
      detail: "This can take a few minutes. Nothing will be created until you review and publish.",
      active: true,
    };
  }
  if (job.status === "cancelling") {
    return {
      title: "Cancelling generation",
      detail: "Coach is stopping this request. No routines have been created.",
      active: true,
    };
  }
  if (job.status === "cancelled") {
    return {
      title: "Generation cancelled",
      detail: "No routines were created. Your program details are still here.",
      active: false,
    };
  }
  if (job.status === "expired") {
    return {
      title: "This generation expired",
      detail: "No draft is available. Your program details are still here to try again.",
      active: false,
    };
  }
  if (job.status === "failed") {
    return {
      title: "Coach could not finish this draft",
      detail: "No routines were created. Try again or edit your program details.",
      active: false,
    };
  }
  if (job.program) {
    return {
      title: "Preparing your program draft",
      detail: "Coach finished. We are opening the editable review now.",
      active: true,
    };
  }
  return {
    title: "Coach finished, but the draft could not be loaded",
    detail: "No routines were created. Try again or edit your program details.",
    active: false,
  };
}
