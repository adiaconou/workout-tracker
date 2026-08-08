export type ElapsedAnchor = {
  seconds: number;
  anchoredAt: number;
};

export type ActiveWorkoutSet = {
  id: string;
  targetUnit: "reps" | "seconds" | "rounds";
  weightUnit: string;
};

export type SetRecordStatus = "Completed" | "Skipped";

export type SetRecordBody = {
  prescribedSetId: string;
  status: SetRecordStatus;
  workoutElapsedSeconds: number;
  actualWeight: number | null;
  actualReps: number | null;
  actualDurationSec: number | null;
};

export type PreparedSetRecord =
  | { ok: false; error: string }
  | {
    ok: true;
    numericWeight: number;
    numericResult: number;
  };

export type RecordSetResponse = {
  performanceId: string;
  completedSets: number;
  skippedSets: number;
  nextSetIndex: number;
  restSeconds: number;
  restEndsAt: string | null;
  workoutCompleted: boolean;
  workoutElapsedSeconds: number;
};

export type CompleteWorkoutResponse = {
  completedSets: number;
  skippedSets: number;
  remainingSetsSkipped: number;
  workoutCompleted: true;
  endedEarly: boolean;
};

export function elapsedFromAnchor(anchor: ElapsedAnchor, now: number) {
  return Math.max(
    0,
    Math.floor(anchor.seconds + Math.max(0, now - anchor.anchoredAt) / 1000),
  );
}

export function resultUnitName(
  unit: ActiveWorkoutSet["targetUnit"],
  capitalize = false,
) {
  const label = unit === "seconds" ? "seconds" : unit === "rounds" ? "rounds" : "reps";
  return capitalize ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : label;
}

export function prepareSetRecord(input: {
  set: ActiveWorkoutSet;
  status: SetRecordStatus;
  weight: string;
  result: string;
}): PreparedSetRecord {
  const numericWeight = Number(input.weight);
  const numericResult = Number(input.result);

  if (
    input.status === "Completed"
    && (!Number.isFinite(numericWeight) || numericWeight < 0)
  ) {
    return { ok: false, error: "Enter the weight used for this set." };
  }
  if (
    input.status === "Completed"
    && (!Number.isFinite(numericResult) || numericResult < 0)
  ) {
    return {
      ok: false,
      error: `Enter the ${resultUnitName(input.set.targetUnit)} completed.`,
    };
  }

  return {
    ok: true,
    numericWeight,
    numericResult,
  };
}

export function createSetRecordBody(input: {
  set: ActiveWorkoutSet;
  status: SetRecordStatus;
  numericWeight: number;
  numericResult: number;
  workoutElapsedSeconds: number;
}): SetRecordBody {
  return {
    prescribedSetId: input.set.id,
    status: input.status,
    workoutElapsedSeconds: input.workoutElapsedSeconds,
    actualWeight: input.status === "Completed" ? input.numericWeight : null,
    actualReps:
      input.status === "Completed" && input.set.targetUnit !== "seconds"
        ? input.numericResult
        : null,
    actualDurationSec:
      input.status === "Completed" && input.set.targetUnit === "seconds"
        ? input.numericResult
        : null,
  };
}

export function recordedSetPerformance(
  set: ActiveWorkoutSet,
  status: SetRecordStatus,
  numericWeight: number,
  numericResult: number,
) {
  return {
    status,
    actualWeight: status === "Completed" ? numericWeight : null,
    actualReps:
      status === "Completed" && set.targetUnit !== "seconds" ? numericResult : null,
    actualDurationSec:
      status === "Completed" && set.targetUnit === "seconds" ? numericResult : null,
    weightUnit: set.weightUnit,
  };
}

export function recordSetSuccessState(payload: RecordSetResponse, respondedAt: number) {
  if (payload.workoutCompleted) {
    return {
      completedSets: payload.completedSets,
      skippedSets: payload.skippedSets,
      workoutCompleted: true as const,
      restEndsAt: null,
      nextSet: null,
    };
  }

  const nextSetStartedAt = payload.restEndsAt
    ? Date.parse(payload.restEndsAt)
    : respondedAt;
  return {
    completedSets: payload.completedSets,
    skippedSets: payload.skippedSets,
    workoutCompleted: false as const,
    restEndsAt: payload.restEndsAt,
    nextSet: {
      index: payload.nextSetIndex,
      restSeconds: payload.restSeconds,
      elapsedAnchor: {
        seconds: 0,
        anchoredAt: Number.isFinite(nextSetStartedAt) ? nextSetStartedAt : respondedAt,
      },
    },
  };
}

export function pendingFinishError(pendingCount: number) {
  return pendingCount
    ? "Sync the pending set before finishing this workout."
    : null;
}

export function finishEarlySuccessState(
  payload: CompleteWorkoutResponse,
  workoutElapsedSeconds: number,
  completedAt: number,
) {
  return {
    workoutElapsedAnchor: {
      seconds: workoutElapsedSeconds,
      anchoredAt: completedAt,
    },
    timingNow: completedAt,
    completedSets: payload.completedSets,
    skippedSets: payload.skippedSets,
    restEndsAt: null,
    secondsRemaining: 0,
    stopwatchStartedAt: null,
    showFinishEarly: false,
    showFullProgress: false,
    workoutCompleted: true,
  } as const;
}

export function discardWorkoutSuccessState() {
  return {
    restEndsAt: null,
    secondsRemaining: 0,
    stopwatchStartedAt: null,
    showDiscardWorkout: false,
    showFinishEarly: false,
    showFullProgress: false,
  } as const;
}
