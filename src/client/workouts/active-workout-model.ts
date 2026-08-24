import type { RecordSetResponse } from "../../contracts/api";

export type { RecordSetResponse } from "../../contracts/api";

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

export type SetCorrectionBody = {
  status: "completed" | "skipped";
  actualWeight: number | null;
  actualReps: number | null;
  actualDurationSec: number | null;
};

export type WorkoutSetNavigation = {
  activeIndex: number;
  viewedIndex: number;
};

export type WorkoutSetNavigationPosition = "past" | "current" | "future";

export type ExerciseNavigationSet = {
  exerciseOrder: number;
};

export type SupersetContextSet = {
  supersetGroup?: string | null;
  supersetDisplayGroup?: string | null;
  exerciseOrder: number;
  exerciseName: string;
  exerciseSetNumber: number;
  exerciseSetTotal: number;
};

export type SupersetContext = {
  label: string;
  memberNames: string[];
  round: number;
  totalRounds: number;
};

export type PreparedSetRecord =
  | { ok: false; error: string }
  | {
    ok: true;
    numericWeight: number;
    numericResult: number;
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
    && (
      !input.weight.trim()
      || !Number.isFinite(numericWeight)
      || numericWeight < 0
    )
  ) {
    return { ok: false, error: "Enter the weight used for this set." };
  }
  if (
    input.status === "Completed"
    && (
      !input.result.trim()
      || !Number.isFinite(numericResult)
      || numericResult < 0
    )
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

export function createSetCorrectionBody(input: {
  set: ActiveWorkoutSet;
  status: SetRecordStatus;
  numericWeight: number;
  numericResult: number;
}): SetCorrectionBody {
  return {
    status: input.status === "Completed" ? "completed" : "skipped",
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

function lastSetIndex(setCount: number) {
  return Math.max(0, Math.trunc(setCount) - 1);
}

function clampIndex(index: number, maximum: number) {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), maximum);
}

export function initialSetNavigation(
  activeIndex: number,
  setCount: number,
): WorkoutSetNavigation {
  const normalizedActiveIndex = clampIndex(activeIndex, lastSetIndex(setCount));
  return {
    activeIndex: normalizedActiveIndex,
    viewedIndex: normalizedActiveIndex,
  };
}

export function viewSetAtIndex(
  navigation: WorkoutSetNavigation,
  requestedIndex: number,
  setCount: number,
): WorkoutSetNavigation {
  return {
    ...navigation,
    viewedIndex: clampIndex(requestedIndex, lastSetIndex(setCount)),
  };
}

export function moveViewedSet(
  navigation: WorkoutSetNavigation,
  offset: number,
  setCount: number,
): WorkoutSetNavigation {
  return viewSetAtIndex(
    navigation,
    navigation.viewedIndex + offset,
    setCount,
  );
}

export function moveViewedExercise(
  navigation: WorkoutSetNavigation,
  sets: readonly ExerciseNavigationSet[],
  offset: number,
): WorkoutSetNavigation {
  const viewedSet = sets[navigation.viewedIndex];
  const normalizedOffset = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  if (!viewedSet || normalizedOffset === 0) return navigation;

  const exerciseOrders = Array.from(new Set(sets.map((set) => set.exerciseOrder)));
  const currentExercisePosition = exerciseOrders.indexOf(viewedSet.exerciseOrder);
  const targetExercisePosition = currentExercisePosition + normalizedOffset;
  if (
    currentExercisePosition < 0
    || targetExercisePosition < 0
    || targetExercisePosition >= exerciseOrders.length
  ) return navigation;

  const targetExerciseOrder = exerciseOrders[targetExercisePosition];
  const targetIndexes = sets.reduce<number[]>((indexes, set, index) => {
    if (set.exerciseOrder === targetExerciseOrder) indexes.push(index);
    return indexes;
  }, []);
  if (targetIndexes.includes(navigation.activeIndex)) {
    return { ...navigation, viewedIndex: navigation.activeIndex };
  }
  return {
    ...navigation,
    viewedIndex: targetIndexes[0],
  };
}

export function viewedSetPosition(
  navigation: WorkoutSetNavigation,
): WorkoutSetNavigationPosition {
  if (navigation.viewedIndex < navigation.activeIndex) return "past";
  return navigation.viewedIndex > navigation.activeIndex ? "future" : "current";
}

export function reconcileSetNavigation(input: {
  navigation: WorkoutSetNavigation;
  previousSetIds: readonly string[];
  nextSetIds: readonly string[];
  nextActiveIndex: number;
}): WorkoutSetNavigation {
  const next = initialSetNavigation(
    input.nextActiveIndex,
    input.nextSetIds.length,
  );

  if (viewedSetPosition(input.navigation) === "current") return next;

  const previouslyViewedId = input.previousSetIds[input.navigation.viewedIndex];
  const preservedIndex = previouslyViewedId === undefined
    ? -1
    : input.nextSetIds.indexOf(previouslyViewedId);
  const requestedIndex = preservedIndex >= 0
    ? preservedIndex
    : input.navigation.viewedIndex;

  return viewSetAtIndex(next, requestedIndex, input.nextSetIds.length);
}

export function supersetContext(
  sets: readonly SupersetContextSet[],
  currentIndex: number,
): SupersetContext | null {
  const current = sets[currentIndex];
  const group = current?.supersetGroup?.trim()
    || current?.supersetDisplayGroup?.trim();
  if (!current || !group) return null;

  const groupSets = sets.filter(
    (set) => (set.supersetGroup?.trim() || set.supersetDisplayGroup?.trim()) === group,
  );
  const roundSets = groupSets.filter(
    (set) => set.exerciseSetNumber === current.exerciseSetNumber,
  );
  const membersByOrder = new Map<number, string>();
  for (const set of roundSets) {
    if (!membersByOrder.has(set.exerciseOrder)) {
      membersByOrder.set(set.exerciseOrder, set.exerciseName);
    }
  }
  const members = [...membersByOrder.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, exerciseName]) => exerciseName);
  if (members.length < 2) return null;

  return {
    label: "Superset",
    memberNames: members,
    round: current.exerciseSetNumber,
    totalRounds: Math.max(...groupSets.map((set) => set.exerciseSetTotal)),
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
