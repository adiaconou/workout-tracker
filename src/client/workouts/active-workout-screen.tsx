import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { router } from "expo-router";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/public";
import {
  countPendingSetWrites,
  enqueueSetWrite,
  flushPendingSetWrites,
  removePendingSetWrite,
  removePendingSetWritesForWorkout,
} from "../api/pending-writes";
import type { RecordSetResponse, Workout, WorkoutView } from "../../contracts/api";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Heading,
  LoadingView,
  Message,
  Screen,
  StepperField,
} from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import { ActiveExerciseProgressChart } from "./active-exercise-progress-chart";
import { ActiveSetComparison } from "./active-set-comparison";
import {
  activeSetPrescription,
  specialSetTypeLabel,
} from "./active-set-prescription";
import { buildCompactSetDetails } from "./set-guidance";
import {
  buildWorkoutExerciseProgress,
  type ExerciseProgress,
} from "./workout-progress";
import {
  formatStopwatch,
  getStopwatchElapsedMs,
  getStopwatchSeconds,
} from "./stopwatch";
import {
  getAdvancedSetInputDefaults,
  getRecordedSetInputValues,
  getSetInputDefaults,
  type SetInputValues,
} from "./set-input-defaults";
import { DiscardWorkoutModal } from "./discard-workout-modal";
import {
  formatElapsedDuration,
  summarizeWorkoutTiming,
  type WorkoutExerciseTimingSummary,
} from "./workout-timing";
import {
  createSetCorrectionBody,
  createSetRecordBody,
  discardWorkoutSuccessState,
  elapsedFromAnchor,
  finishEarlySuccessState,
  initialSetNavigation,
  moveViewedExercise,
  pendingFinishError,
  prepareSetRecord,
  reconcileSetNavigation,
  recordedSetPerformance,
  recordSetSuccessState,
  resultUnitName,
  setEntryMode,
  supersetContext,
  viewedSetPosition,
  viewSetAtIndex,
  type CompleteWorkoutResponse,
  type ElapsedAnchor,
  type SupersetContext,
  type WorkoutSetNavigation,
} from "./active-workout-model";

export function ActiveWorkoutScreen({ sessionId }: { sessionId: string }) {
  const { user } = useAuth();
  const [workout, setWorkout] = useState<WorkoutView | null>(null);
  const [setNavigation, setSetNavigation] = useState<WorkoutSetNavigation>(() =>
    initialSetNavigation(0, 0)
  );
  const [completedSets, setCompletedSets] = useState(0);
  const [skippedSets, setSkippedSets] = useState(0);
  const [restEndsAt, setRestEndsAt] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [weight, setWeight] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"Saved" | "Set updated" | "Save failed" | "">("");
  const [replacingPastSet, setReplacingPastSet] = useState(false);
  const [error, setError] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [workoutCompleted, setWorkoutCompleted] = useState(false);
  const [completedWorkout, setCompletedWorkout] = useState<Workout | null>(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionError, setCompletionError] = useState("");
  const [expandedCompletionExerciseIds, setExpandedCompletionExerciseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showFullProgress, setShowFullProgress] = useState(false);
  const [showWorkoutMenu, setShowWorkoutMenu] = useState(false);
  const [showFinishEarly, setShowFinishEarly] = useState(false);
  const [showDiscardWorkout, setShowDiscardWorkout] = useState(false);
  const [stopwatchStartedAt, setStopwatchStartedAt] = useState<number | null>(null);
  const [stopwatchElapsedMs, setStopwatchElapsedMs] = useState(0);
  const [timingNow, setTimingNow] = useState(() => Date.now());
  const workoutElapsedAnchor = useRef<ElapsedAnchor>({ seconds: 0, anchoredAt: Date.now() });
  const currentSetElapsedAnchor = useRef<ElapsedAnchor>({ seconds: 0, anchoredAt: Date.now() });
  const navigationWorkoutId = useRef<string | null>(null);
  const navigationSetIds = useRef<readonly string[]>([]);
  const setInputDrafts = useRef<Record<string, SetInputValues>>({});

  const currentIndex = setNavigation.activeIndex;
  const viewedIndex = setNavigation.viewedIndex;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await flushPendingSetWrites();
      const payload = await apiRequest<{ workout: WorkoutView }>(
        `/api/v1/workouts/${encodeURIComponent(sessionId)}`,
      );
      const next = payload.workout;
      const loadedAt = Date.now();
      const nextSetIds = next.sets.map((set) => set.id);
      const previousSetIds = navigationSetIds.current;
      const replacingWorkout = navigationWorkoutId.current !== next.id;
      navigationWorkoutId.current = next.id;
      navigationSetIds.current = nextSetIds;
      if (replacingWorkout) setInputDrafts.current = {};
      const restEnd = next.restEndsAt ? Date.parse(next.restEndsAt) : Number.NaN;
      workoutElapsedAnchor.current = {
        seconds: next.workoutElapsedSeconds,
        anchoredAt: loadedAt,
      };
      currentSetElapsedAnchor.current = {
        seconds: next.currentSetElapsedSeconds,
        anchoredAt: Number.isFinite(restEnd) ? Math.max(loadedAt, restEnd) : loadedAt,
      };
      setTimingNow(loadedAt);
      setWorkout(next);
      setSetNavigation((current) => replacingWorkout
        ? initialSetNavigation(next.currentSetIndex, next.sets.length)
        : reconcileSetNavigation({
          navigation: current,
          previousSetIds,
          nextSetIds,
          nextActiveIndex: next.currentSetIndex,
        }));
      setCompletedSets(next.completedSets);
      setSkippedSets(next.skippedSets);
      setWorkoutCompleted(next.status === "Completed" || next.status === "Partial");
      setRestEndsAt(next.restEndsAt);
      setSecondsRemaining(
        next.restEndsAt
          ? Math.max(0, Math.ceil((new Date(next.restEndsAt).getTime() - Date.now()) / 1000))
          : 0,
      );
      setPendingCount(await countPendingSetWrites(sessionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workout could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadCompletionSummary = useCallback(async () => {
    setCompletionLoading(true);
    setCompletionError("");
    try {
      const payload = await apiRequest<{ workout: Workout }>(
        `/api/v1/workouts/${encodeURIComponent(sessionId)}/history`,
      );
      setCompletedWorkout(payload.workout);
    } catch (caught) {
      setCompletionError(
        caught instanceof Error
          ? caught.message
          : "The workout timing summary could not be loaded.",
      );
    } finally {
      setCompletionLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workoutCompleted) return;
    void loadCompletionSummary();
  }, [loadCompletionSummary, workoutCompleted]);

  useEffect(() => {
    if (!workout || workoutCompleted) return;
    const tick = () => setTimingNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [workout?.id, workoutCompleted]);

  const currentSet = workout?.sets[currentIndex];
  const viewedSet = workout?.sets[viewedIndex];
  const viewedPosition = viewedSetPosition(setNavigation);
  const isViewingPast = viewedPosition === "past";
  const isViewingCurrent = viewedPosition === "current";
  const isViewingFuture = viewedPosition === "future";
  const entryMode = setEntryMode(viewedPosition, replacingPastSet);
  const setInputsEditable = entryMode === "current" || entryMode === "past-editing";
  const overviewSet = isViewingPast
    && viewedSet?.exerciseOrder === currentSet?.exerciseOrder
    && currentSet
    ? currentSet
    : viewedSet;
  const overviewIndex = overviewSet?.id === currentSet?.id ? currentIndex : viewedIndex;
  const viewedRecordedPerformance = viewedSet
    ? workout?.recordedPerformanceBySetId[viewedSet.id]
    : undefined;
  const completedOrSkipped = completedSets + skippedSets;
  const progress = workout?.totalSets
    ? Math.min(1, completedOrSkipped / workout.totalSets)
    : 0;
  const exerciseOrders = useMemo(
    () => Array.from(new Set(workout?.sets.map((set) => set.exerciseOrder) ?? [])),
    [workout?.sets],
  );
  const previousExerciseSets = viewedSet
    ? workout?.previousPerformanceByExercise[viewedSet.exerciseOrder]?.sets ?? []
    : [];
  const currentExerciseSets = useMemo(
    () => viewedSet
      ? workout?.sets.filter((set) => set.exerciseOrder === viewedSet.exerciseOrder) ?? []
      : [],
    [viewedSet?.exerciseOrder, workout?.sets],
  );
  const overviewSupersetContext = useMemo(
    () => supersetContext(workout?.sets ?? [], overviewIndex),
    [overviewIndex, workout?.sets],
  );
  const exerciseProgress = useMemo(
    () => buildWorkoutExerciseProgress(workout?.sets ?? [], currentIndex),
    [currentIndex, workout?.sets],
  );
  const completionTiming = useMemo(
    () => completedWorkout ? summarizeWorkoutTiming(completedWorkout) : null,
    [completedWorkout],
  );
  const liveWorkoutElapsedSeconds = workoutCompleted
    ? workoutElapsedAnchor.current.seconds
    : elapsedFromAnchor(workoutElapsedAnchor.current, timingNow);

  useEffect(() => {
    if (!viewedSet) return;
    const recordedInputs = isViewingPast
      ? viewedRecordedPerformance
        ? getRecordedSetInputValues(viewedSet, viewedRecordedPerformance)
        : { weight: "", result: "" }
      : getSetInputDefaults(viewedSet);
    const draft = isViewingPast
      ? recordedInputs
      : setInputDrafts.current[viewedSet.id] ?? recordedInputs;
    if (!isViewingPast) setInputDrafts.current[viewedSet.id] = draft;
    setWeight(draft.weight);
    setResult(draft.result);
    setStopwatchStartedAt(null);
    setStopwatchElapsedMs(
      viewedSet.targetUnit === "seconds" && draft.result
        ? Math.max(0, Number(draft.result) || 0) * 1000
        : 0,
    );
  }, [
    isViewingPast,
    sessionId,
    viewedIndex,
    viewedRecordedPerformance?.actualDurationSec,
    viewedRecordedPerformance?.actualReps,
    viewedRecordedPerformance?.actualWeight,
    viewedRecordedPerformance?.status,
    viewedSet?.id,
    viewedSet?.targetUnit,
    workout?.id,
  ]);

  useEffect(() => {
    setError("");
    setSaveState("");
    setReplacingPastSet(false);
  }, [sessionId, viewedIndex, viewedSet?.id, workout?.id]);

  useEffect(() => {
    if (stopwatchStartedAt === null) return;
    const tick = () => {
      const elapsedMs = getStopwatchElapsedMs(stopwatchStartedAt, 0);
      const nextResult = String(getStopwatchSeconds(elapsedMs));
      setStopwatchElapsedMs(elapsedMs);
      setResult(nextResult);
      if (viewedSet) {
        setInputDrafts.current[viewedSet.id] = { weight, result: nextResult };
      }
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [stopwatchStartedAt, viewedSet?.id, weight]);

  useEffect(() => {
    if (!restEndsAt) return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(restEndsAt).getTime() - Date.now()) / 1000),
      );
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        setRestEndsAt(null);
        Vibration.vibrate([0, 120, 80, 120]);
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [restEndsAt]);

  async function recordSet(status: "Completed" | "Skipped") {
    if (!workout || !currentSet || !isViewingCurrent || saving) return;
    setSaving(true);
    setError("");
    setSaveState("");

    let resultForSave = result;
    if (
      status === "Completed" &&
      currentSet.targetUnit === "seconds" &&
      (stopwatchStartedAt !== null || stopwatchElapsedMs > 0)
    ) {
      const elapsedMs = getStopwatchElapsedMs(
        stopwatchStartedAt,
        stopwatchElapsedMs,
      );
      resultForSave = String(getStopwatchSeconds(elapsedMs));
      setStopwatchElapsedMs(elapsedMs);
      setStopwatchStartedAt(null);
      setResult(resultForSave);
    }
    const prepared = prepareSetRecord({
      set: currentSet,
      status,
      weight,
      result: resultForSave,
    });
    if (!prepared.ok) {
      setError(prepared.error);
      setSaving(false);
      return;
    }

    const recordedAt = Date.now();
    const body = createSetRecordBody({
      set: currentSet,
      status,
      numericWeight: prepared.numericWeight,
      numericResult: prepared.numericResult,
      workoutElapsedSeconds: elapsedFromAnchor(workoutElapsedAnchor.current, recordedAt),
    });
    const pending = await enqueueSetWrite(workout.id, body);
    setPendingCount(await countPendingSetWrites(workout.id));

    try {
      const payload = await apiRequest<RecordSetResponse>(
        `/api/v1/workouts/${encodeURIComponent(workout.id)}/sets`,
        {
          method: "POST",
          headers: { "x-idempotency-key": pending.operationId },
          body: JSON.stringify(pending.body),
        },
      );
      const respondedAt = Date.now();
      await removePendingSetWrite(pending.operationId);
      setPendingCount(await countPendingSetWrites(workout.id));
      const success = recordSetSuccessState(payload, respondedAt);
      setCompletedSets(success.completedSets);
      setSkippedSets(success.skippedSets);
      setSaveState("Saved");
      setWorkout((current) => current ? {
        ...current,
        recordedPerformanceBySetId: {
          ...(current.recordedPerformanceBySetId ?? {}),
          [currentSet.id]: {
            workoutSetId: payload.workoutSetId,
            ...recordedSetPerformance(
              currentSet,
              status,
              prepared.numericWeight,
              prepared.numericResult,
            ),
          },
        },
      } : current);
      workoutElapsedAnchor.current = {
        seconds: payload.workoutElapsedSeconds,
        anchoredAt: recordedAt,
      };
      setTimingNow(respondedAt);
      if (success.workoutCompleted) {
        setWorkoutCompleted(true);
        setRestEndsAt(success.restEndsAt);
      } else {
        const nextSet = workout.sets[success.nextSet.index];
        if (nextSet) {
          const nextSetInputs = getAdvancedSetInputDefaults(
            nextSet,
            { weight, result },
          );
          setInputDrafts.current[nextSet.id] = nextSetInputs;
          setWeight(nextSetInputs.weight);
          setResult(nextSetInputs.result);
        }
        currentSetElapsedAnchor.current = success.nextSet.elapsedAnchor;
        setSetNavigation(initialSetNavigation(success.nextSet.index, workout.sets.length));
        setRestEndsAt(success.restEndsAt);
        setSecondsRemaining(success.nextSet.restSeconds);
      }
    } catch (caught) {
      setSaveState("Save failed");
      setError(caught instanceof Error ? caught.message : "This set could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function skipRest() {
    if (!workout || saving || !isViewingCurrent || !restEndsAt) return;
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/v1/workouts/${encodeURIComponent(workout.id)}/rest/skip`, {
        method: "POST",
      });
      const skippedAt = Date.now();
      currentSetElapsedAnchor.current = {
        seconds: currentSetElapsedAnchor.current.seconds,
        anchoredAt: skippedAt,
      };
      setTimingNow(skippedAt);
      setRestEndsAt(null);
      setSecondsRemaining(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rest could not be skipped.");
    } finally {
      setSaving(false);
    }
  }

  async function retryPending() {
    setSaving(true);
    setError("");
    try {
      await flushPendingSetWrites();
      await load();
      setSaveState("Saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pending set could not be retried.");
    } finally {
      setSaving(false);
    }
  }

  function startStopwatch() {
    if (!isViewingCurrent) return;
    setStopwatchStartedAt(Date.now() - stopwatchElapsedMs);
  }

  function updateSetWeight(value: string) {
    setWeight(value);
    if (viewedSet) {
      setInputDrafts.current[viewedSet.id] = { weight: value, result };
    }
  }

  function updateSetResult(value: string) {
    setResult(value);
    if (viewedSet) {
      setInputDrafts.current[viewedSet.id] = { weight, result: value };
    }
  }

  function pauseStopwatch() {
    if (stopwatchStartedAt === null) return;
    const elapsedMs = getStopwatchElapsedMs(
      stopwatchStartedAt,
      stopwatchElapsedMs,
    );
    setStopwatchElapsedMs(elapsedMs);
    setStopwatchStartedAt(null);
    updateSetResult(String(getStopwatchSeconds(elapsedMs)));
  }

  function resetStopwatch() {
    setStopwatchStartedAt(null);
    setStopwatchElapsedMs(0);
    updateSetResult("");
  }

  function updateDurationResult(value: string) {
    updateSetResult(value);
    if (stopwatchStartedAt !== null) return;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      setStopwatchElapsedMs(seconds * 1000);
    }
  }

  async function finishWorkoutEarly() {
    if (!workout || saving) return;
    const completedAt = Date.now();
    const workoutElapsedSeconds = elapsedFromAnchor(workoutElapsedAnchor.current, completedAt);
    setSaving(true);
    setError("");
    setSaveState("");
    try {
      await flushPendingSetWrites();
      const remainingPending = await countPendingSetWrites(workout.id);
      setPendingCount(remainingPending);
      const pendingError = pendingFinishError(remainingPending);
      if (pendingError) throw new Error(pendingError);
      const payload = await apiRequest<CompleteWorkoutResponse>(
        `/api/v1/workouts/${encodeURIComponent(workout.id)}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ workoutElapsedSeconds }),
        },
      );
      const success = finishEarlySuccessState(
        payload,
        workoutElapsedSeconds,
        completedAt,
      );
      workoutElapsedAnchor.current = success.workoutElapsedAnchor;
      setTimingNow(success.timingNow);
      setCompletedSets(success.completedSets);
      setSkippedSets(success.skippedSets);
      setRestEndsAt(success.restEndsAt);
      setSecondsRemaining(success.secondsRemaining);
      setStopwatchStartedAt(success.stopwatchStartedAt);
      setShowFinishEarly(success.showFinishEarly);
      setShowFullProgress(success.showFullProgress);
      setWorkoutCompleted(success.workoutCompleted);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The workout could not be completed early.",
      );
      setShowFinishEarly(false);
    } finally {
      setSaving(false);
    }
  }

  async function discardWorkout() {
    if (!workout || saving) return;
    setSaving(true);
    setError("");
    setSaveState("");
    try {
      await apiRequest(
        `/api/v1/workouts/${encodeURIComponent(workout.id)}/discard`,
        { method: "DELETE" },
      );
      const success = discardWorkoutSuccessState();
      setRestEndsAt(success.restEndsAt);
      setSecondsRemaining(success.secondsRemaining);
      setStopwatchStartedAt(success.stopwatchStartedAt);
      setShowDiscardWorkout(success.showDiscardWorkout);
      setShowFinishEarly(success.showFinishEarly);
      setShowFullProgress(success.showFullProgress);
      try {
        await removePendingSetWritesForWorkout(workout.id);
      } catch {
        // The remote workout is gone, so local cleanup must not block navigation.
      }
      router.replace("/routines");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The workout could not be discarded.",
      );
      setShowDiscardWorkout(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !workout) return <LoadingView label="Restoring your workout…" />;
  if (!workout) {
    return (
      <Screen>
        <Message>{error || "Workout not found."}</Message>
        <Button title="Back to routines" variant="secondary" onPress={() => router.replace("/routines")} />
      </Screen>
    );
  }

  if (workoutCompleted) {
    return (
      <Screen contentStyle={styles.completeScreen}>
        <Eyebrow>Routine {workout.routineCode} complete</Eyebrow>
        <Heading>Workout saved.</Heading>
        <Body muted>
          Your session timing and every recorded set are saved to history.
        </Body>
        {pendingCount ? <Message tone="warning">{pendingCount} set action still needs to sync.</Message> : null}

        <Card style={styles.completionSummaryCard}>
          <View style={styles.completionStats}>
            <CompletionStat
              value={completionTiming ? formatElapsedDuration(completionTiming.elapsedSeconds) : "—"}
              label="Total elapsed"
            />
            <CompletionStat
              value={`${completedSets}/${workout.totalSets}`}
              label="Completed sets"
            />
            <CompletionStat
              value={String(completionTiming?.totalExercises ?? exerciseOrders.length)}
              label="Exercises"
            />
          </View>
          {skippedSets ? (
            <Text style={styles.completionSkipped}>
              {skippedSets} {skippedSets === 1 ? "set was" : "sets were"} skipped
            </Text>
          ) : null}
        </Card>

        <View style={styles.completionSectionHeading}>
          <Eyebrow>Exercise timing</Eyebrow>
          {completionLoading ? <Text style={styles.completionLoading}>Loading…</Text> : null}
        </View>
        {completionError ? (
          <Card style={styles.completionErrorCard}>
            <Body muted>Your workout is saved, but its timing details could not be loaded.</Body>
            <Text style={styles.completionErrorDetail}>{completionError}</Text>
            <Button
              title="Try again"
              variant="secondary"
              loading={completionLoading}
              onPress={() => void loadCompletionSummary()}
            />
          </Card>
        ) : null}
        {completionTiming?.exercises.map((exercise) => (
          <CompletionExerciseTimingCard
            key={exercise.id}
            exercise={exercise}
            expanded={expandedCompletionExerciseIds.has(exercise.id)}
            onToggle={() => setExpandedCompletionExerciseIds((current) => {
              const next = new Set(current);
              if (next.has(exercise.id)) next.delete(exercise.id);
              else next.add(exercise.id);
              return next;
            })}
          />
        ))}

        <View style={styles.completionActions}>
          <Button
            title="View workout details →"
            onPress={() => router.replace(`/history/${workout.id}`)}
          />
          <Button
            title="Back to routines"
            variant="secondary"
            onPress={() => router.replace("/routines")}
          />
        </View>
      </Screen>
    );
  }

  async function savePastSet() {
    if (!workout || !viewedSet || !isViewingPast || saving) return;
    setSaving(true);
    setError("");
    setSaveState("");

    try {
      const unsyncedSets = await countPendingSetWrites(workout.id);
      setPendingCount(unsyncedSets);
      if (unsyncedSets) {
        throw new Error("Sync the pending set before editing an earlier result.");
      }
      const recorded = workout.recordedPerformanceBySetId[viewedSet.id];
      if (!recorded?.workoutSetId) {
        throw new Error("Reload the workout before editing this set.");
      }

      const prepared = prepareSetRecord({
        set: viewedSet,
        status: "Completed",
        weight,
        result,
      });
      if (!prepared.ok) throw new Error(prepared.error);

      await apiRequest(
        `/api/v1/workouts/${encodeURIComponent(workout.id)}/sets/${encodeURIComponent(recorded.workoutSetId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(createSetCorrectionBody({
            set: viewedSet,
            status: "Completed",
            numericWeight: prepared.numericWeight,
            numericResult: prepared.numericResult,
          })),
        },
      );
      delete setInputDrafts.current[viewedSet.id];
      setReplacingPastSet(false);
      await load();
      setSaveState("Set updated");
    } catch (caught) {
      setSaveState("Save failed");
      setError(caught instanceof Error ? caught.message : "This set could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  function viewExercise(exerciseOrder: number) {
    if (!workout || saving || replacingPastSet || stopwatchStartedAt !== null) return;
    Keyboard.dismiss();
    setSetNavigation((current) => {
      const activeExerciseOrder = workout.sets[current.activeIndex]?.exerciseOrder;
      if (exerciseOrder === activeExerciseOrder) {
        return viewSetAtIndex(current, current.activeIndex, workout.sets.length);
      }
      const orders = Array.from(new Set(workout.sets.map((set) => set.exerciseOrder)));
      const viewedOrder = workout.sets[current.viewedIndex]?.exerciseOrder;
      const from = orders.indexOf(viewedOrder ?? exerciseOrder);
      const to = orders.indexOf(exerciseOrder);
      return moveViewedExercise(current, workout.sets, to - Math.max(0, from));
    });
    setShowFullProgress(false);
  }

  function viewSet(globalIndex: number) {
    if (!workout || saving || replacingPastSet || stopwatchStartedAt !== null) return;
    Keyboard.dismiss();
    setSetNavigation((current) => viewSetAtIndex(current, globalIndex, workout.sets.length));
  }

  function returnToCurrentSet() {
    if (!workout || saving || replacingPastSet || stopwatchStartedAt !== null) return;
    Keyboard.dismiss();
    setSetNavigation((current) => viewSetAtIndex(
      current,
      current.activeIndex,
      workout.sets.length,
    ));
  }

  function beginPastSetEdit() {
    if (!viewedSet || !viewedRecordedPerformance || !isViewingPast || saving) return;
    Keyboard.dismiss();
    const defaults = getRecordedSetInputValues(viewedSet, viewedRecordedPerformance);
    setReplacingPastSet(true);
    setStopwatchStartedAt(null);
    setStopwatchElapsedMs(0);
    setInputDrafts.current[viewedSet.id] = defaults;
    setWeight(defaults.weight);
    setResult(defaults.result);
    setSaveState("");
    setError("");
  }

  function cancelPastSetEdit() {
    if (!viewedSet || !viewedRecordedPerformance || saving) return;
    const recorded = getRecordedSetInputValues(viewedSet, viewedRecordedPerformance);
    setInputDrafts.current[viewedSet.id] = recorded;
    setWeight(recorded.weight);
    setResult(recorded.result);
    setStopwatchStartedAt(null);
    setStopwatchElapsedMs(
      viewedSet.targetUnit === "seconds" && recorded.result
        ? Math.max(0, Number(recorded.result) || 0) * 1000
        : 0,
    );
    setReplacingPastSet(false);
    setSaveState("");
    setError("");
  }

  return (
    <Screen>
      <View style={styles.workoutHeader}>
        <View style={styles.workoutHeaderSide}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Back to Routine ${workout.routineCode}`}
            accessibilityState={{ disabled: replacingPastSet }}
            disabled={replacingPastSet}
            onPress={() => router.replace(`/routines/${workout.routineCode}`)}
            style={({ pressed }) => [
              styles.headerBack,
              pressed && styles.headerActionPressed,
              replacingPastSet && styles.headerActionDisabled,
            ]}
          >
            <View accessibilityElementsHidden style={styles.headerBackChevron} />
            <Text style={styles.headerBackText}>Back</Text>
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.workoutHeaderTitle}>
          Routine {workout.routineCode}
        </Text>
        <View style={[styles.workoutHeaderSide, styles.workoutHeaderRight]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More workout actions"
            accessibilityState={{ expanded: showWorkoutMenu }}
            disabled={saving || replacingPastSet}
            onPress={() => setShowWorkoutMenu(true)}
            style={({ pressed }) => [
              styles.moreAction,
              pressed && styles.headerActionPressed,
              (saving || replacingPastSet) && styles.headerActionDisabled,
            ]}
          >
            <View accessibilityElementsHidden style={styles.moreDots}>
              <View style={styles.moreDot} />
              <View style={styles.moreDot} />
              <View style={styles.moreDot} />
            </View>
          </Pressable>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View workout, ${completedOrSkipped} of ${workout.totalSets} sets, ${formatElapsedDuration(liveWorkoutElapsedSeconds)} elapsed`}
        onPress={() => setShowFullProgress(true)}
        style={({ pressed }) => [styles.workoutProgress, pressed && styles.workoutProgressPressed]}
      >
        <View style={styles.workoutProgressRow}>
          <Text numberOfLines={1} style={styles.workoutProgressCopy}>
            <Text style={styles.workoutProgressCount}>
              {completedOrSkipped} of {workout.totalSets} sets
            </Text>
            <Text style={styles.workoutProgressTime}>
              {` · ${formatElapsedDuration(liveWorkoutElapsedSeconds)} elapsed`}
            </Text>
          </Text>
          <View accessibilityElementsHidden style={styles.workoutProgressAction}>
            <Text style={styles.workoutProgressActionText}>View workout</Text>
            <View style={styles.inlineChevron} />
          </View>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: workout.totalSets, now: completedOrSkipped }}
          style={styles.progressTrack}
        >
          <View style={[styles.progressValue, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>

      <WorkoutProgressModal
        visible={showFullProgress}
        routineCode={workout.routineCode}
        completedSets={completedOrSkipped}
        totalSets={workout.totalSets}
        exercises={exerciseProgress}
        navigationDisabled={saving || replacingPastSet || stopwatchStartedAt !== null}
        onClose={() => setShowFullProgress(false)}
        onSelectExercise={viewExercise}
      />
      <WorkoutMenu
        visible={showWorkoutMenu}
        saving={saving || replacingPastSet}
        onClose={() => setShowWorkoutMenu(false)}
        onFinishEarly={() => {
          setShowWorkoutMenu(false);
          setShowFinishEarly(true);
        }}
        onDiscard={() => {
          setShowWorkoutMenu(false);
          setShowDiscardWorkout(true);
        }}
      />
      <FinishWorkoutModal
        visible={showFinishEarly}
        completedSets={completedOrSkipped}
        remainingSets={Math.max(0, workout.totalSets - completedOrSkipped)}
        saving={saving}
        onCancel={() => setShowFinishEarly(false)}
        onConfirm={() => void finishWorkoutEarly()}
      />
      <DiscardWorkoutModal
        visible={showDiscardWorkout}
        routineCode={workout.routineCode}
        recordedSets={completedOrSkipped}
        discarding={saving}
        onCancel={() => setShowDiscardWorkout(false)}
        onConfirm={() => void discardWorkout()}
      />

      {pendingCount ? (
        <Message tone="warning">
          {pendingCount} set action is waiting to sync. Your entry is preserved on this device.
        </Message>
      ) : null}
      {error ? <Message>{error}</Message> : null}

      {viewedSet ? (
        <View style={styles.activeSetStack}>
          {restEndsAt ? (
            <RestTimerIsland
              secondsRemaining={secondsRemaining}
              viewingCurrent={isViewingCurrent}
              saving={saving}
              onSkip={() => void skipRest()}
            />
          ) : null}
          <View style={styles.setCard}>
            {overviewSupersetContext ? (
              <SupersetBanner context={overviewSupersetContext} />
            ) : null}
            {stopwatchStartedAt !== null ? (
              <Text style={styles.navigationHint}>
                Pause the stopwatch to review another exercise or set.
              </Text>
            ) : null}
            <CompactSetOverview
              qualifier={[
                restEndsAt && overviewSet?.id === currentSet?.id ? "Next" : null,
                overviewSet ? specialSetTypeLabel(overviewSet.setType) : null,
              ].filter(Boolean).join(" · ")}
              exercisePosition={overviewSet
                ? exerciseOrders.indexOf(overviewSet.exerciseOrder) + 1
                : 0}
              exerciseTotal={exerciseOrders.length}
              workoutSet={overviewSet ?? viewedSet}
            />
            <ActiveSetComparison
              sets={currentExerciseSets}
              previousSets={previousExerciseSets}
              recordedPerformanceBySetId={workout.recordedPerformanceBySetId ?? {}}
              selectedSetId={viewedSet.id}
              activeSetIndex={currentIndex}
              navigationDisabled={saving || replacingPastSet || stopwatchStartedAt !== null}
              onSelectSet={viewSet}
              progressiveTrainingEnabled={Boolean(
                user?.trainingProfile.progressiveTrainingEnabled,
              )}
            />

            {isViewingFuture ? (
              <View style={styles.futureSetNotice}>
                <Text style={styles.futureSetText}>This set is upcoming.</Text>
                <Button
                  title="Return to current set"
                  variant="secondary"
                  disabled={saving || stopwatchStartedAt !== null}
                  onPress={returnToCurrentSet}
                />
              </View>
            ) : null}

          {(entryMode === "current" && !restEndsAt)
            || entryMode === "past-readonly"
            || entryMode === "past-editing" ? (
            <View style={styles.logControls}>
              {viewedSet.targetUnit === "seconds" && entryMode === "current" ? (
                <SetStopwatch
                  elapsedMs={stopwatchElapsedMs}
                  running={stopwatchStartedAt !== null}
                  onStart={startStopwatch}
                  onPause={pauseStopwatch}
                  onReset={resetStopwatch}
                />
              ) : null}
              <View style={styles.logFields}>
                <View style={styles.logField}>
                  <StepperField
                    label={loadLabel(viewedSet.loadType, viewedSet.weightUnit)}
                    variant="segmented"
                    value={weight}
                    onChangeText={updateSetWeight}
                    keyboardType="decimal-pad"
                    placeholder={entryMode === "past-readonly" ? "—" : "0"}
                    selectTextOnFocus={setInputsEditable}
                    editable={setInputsEditable}
                    accessibilityLabel={entryMode === "past-readonly"
                      ? `Recorded ${loadLabel(viewedSet.loadType, viewedSet.weightUnit)}, ${weight || "not recorded"}, read only`
                      : undefined}
                    accessibilityHint={entryMode === "past-readonly"
                      ? `Use Edit result to correct completed set ${viewedSet.exerciseSetNumber}`
                      : undefined}
                  />
                </View>
                <View style={styles.logField}>
                  <StepperField
                    label={`${resultUnitName(viewedSet.targetUnit, true)} completed`}
                    variant="segmented"
                    value={result}
                    onChangeText={
                      viewedSet.targetUnit === "seconds"
                        ? updateDurationResult
                        : updateSetResult
                    }
                    keyboardType="number-pad"
                    placeholder={entryMode === "past-readonly" ? "—" : "0"}
                    selectTextOnFocus={setInputsEditable}
                    editable={setInputsEditable && (
                      viewedSet.targetUnit !== "seconds"
                      || entryMode !== "current"
                      || stopwatchStartedAt === null
                    )}
                    accessibilityLabel={entryMode === "past-readonly"
                      ? `Recorded ${resultUnitName(viewedSet.targetUnit, true)}, ${viewedRecordedPerformance?.status === "Skipped" ? "skipped" : result || "not recorded"}, read only`
                      : undefined}
                    accessibilityHint={entryMode === "past-readonly"
                      ? `Use Edit result to correct completed set ${viewedSet.exerciseSetNumber}`
                      : undefined}
                  />
                </View>
              </View>
              {entryMode === "past-editing" ? (
                <Button
                  title={saving ? "Saving…" : "Save correction"}
                  loading={saving}
                  disabled={pendingCount > 0}
                  onPress={() => void savePastSet()}
                />
              ) : entryMode === "past-readonly" ? (
                <Button
                  title="Edit result"
                  variant="secondary"
                  disabled={saving || pendingCount > 0 || !viewedRecordedPerformance}
                  onPress={beginPastSetEdit}
                />
              ) : (
                <Button
                  title={saving ? "Saving…" : "Complete set"}
                  loading={saving}
                  onPress={() => void recordSet("Completed")}
                />
              )}
              <View style={styles.skipSetRow}>
                {entryMode === "current" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Skip current set ${viewedSet.exerciseSetNumber}`}
                    disabled={saving}
                    onPress={() => void recordSet("Skipped")}
                    style={({ pressed }) => [
                      styles.skipSetAction,
                      pressed && styles.skipSetActionPressed,
                      saving && styles.headerActionDisabled,
                    ]}
                  >
                    <Text style={styles.skipSetText}>Skip this set</Text>
                  </Pressable>
                ) : entryMode === "past-editing" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel result correction"
                    disabled={saving}
                    onPress={cancelPastSetEdit}
                    style={({ pressed }) => [
                      styles.skipSetAction,
                      pressed && styles.skipSetActionPressed,
                      saving && styles.headerActionDisabled,
                    ]}
                  >
                    <Text style={styles.skipSetText}>Cancel</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
            {saveState ? (
              <Text accessibilityLiveRegion="polite" style={[
                styles.saveState,
                saveState === "Save failed" && styles.saveFailed,
              ]}>
                {saveState}
              </Text>
            ) : null}
            {pendingCount ? (
              <Button
                title="Retry pending save"
                variant="secondary"
                compact
                loading={saving}
                onPress={() => void retryPending()}
              />
            ) : null}
            <ActiveExerciseProgressChart
              key={`progress:${workout.id}:${viewedSet.exerciseId}:${viewedSet.exerciseOrder}`}
              exerciseId={viewedSet.exerciseId}
              exerciseName={viewedSet.exerciseName}
              title="6-month progress"
              quietDisclosure
            />
          </View>
        </View>
      ) : (
        <Message>There are no remaining sets, but this workout has not been finalized.</Message>
      )}
    </Screen>
  );
}

function RestTimerIsland({
  secondsRemaining,
  viewingCurrent,
  saving,
  onSkip,
}: {
  secondsRemaining: number;
  viewingCurrent: boolean;
  saving: boolean;
  onSkip: () => void;
}) {
  const [skipFocused, setSkipFocused] = useState(false);
  return (
    <View style={styles.restIsland}>
      <View style={styles.restIslandRail}>
        <Text accessible={false} style={styles.restIslandLabel}>REST</Text>
      </View>
      <Text
        accessibilityLabel={formatRestAccessibilityLabel(secondsRemaining)}
        style={styles.restIslandTimer}
      >
        {formatTimer(secondsRemaining)}
      </Text>
      <View style={styles.restIslandRail}>
        {!viewingCurrent ? (
          <Text
            accessibilityLabel="Current rest continues"
            style={styles.restIslandPastLabel}
          >
            Current rest
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip remaining rest"
            accessibilityHint="Starts the current set now"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onBlur={() => setSkipFocused(false)}
            onFocus={() => setSkipFocused(true)}
            onPress={onSkip}
            style={({ pressed }) => [
              styles.restIslandSkip,
              saving && styles.restIslandSkipDisabled,
              pressed && styles.restIslandSkipPressed,
              skipFocused && Platform.OS === "web" && styles.restIslandSkipFocused,
            ]}
          >
            <Text style={styles.restIslandSkipText}>Skip</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SetStopwatch({
  elapsedMs,
  running,
  onStart,
  onPause,
  onReset,
}: {
  elapsedMs: number;
  running: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
}) {
  return (
    <View style={styles.stopwatch}>
      <View style={styles.stopwatchTopline}>
        <View>
          <Text style={styles.stopwatchLabel}>Built-in stopwatch</Text>
          <Text style={styles.stopwatchHint}>
            Time is copied into seconds completed.
          </Text>
        </View>
        <View style={[styles.stopwatchLiveDot, running && styles.stopwatchLiveDotRunning]} />
      </View>
      <Text
        accessibilityLabel={`${getStopwatchSeconds(elapsedMs)} seconds elapsed`}
        style={styles.stopwatchTime}
      >
        {formatStopwatch(elapsedMs)}
      </Text>
      <View style={styles.stopwatchControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={running ? "Pause stopwatch" : "Start stopwatch"}
          onPress={running ? onPause : onStart}
          style={({ pressed }) => [
            styles.stopwatchPrimary,
            pressed && styles.stopwatchControlPressed,
          ]}
        >
          <Text style={styles.stopwatchPrimaryText}>
            {running ? "Pause" : elapsedMs ? "Resume" : "Start"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset stopwatch"
          disabled={!elapsedMs && !running}
          onPress={onReset}
          style={({ pressed }) => [
            styles.stopwatchSecondary,
            !elapsedMs && !running && styles.stopwatchControlDisabled,
            pressed && styles.stopwatchControlPressed,
          ]}
        >
          <Text style={styles.stopwatchSecondaryText}>Reset</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CompletionStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.completionStat}>
      <Text numberOfLines={1} style={styles.completionStatValue}>{value}</Text>
      <Text style={styles.completionStatLabel}>{label}</Text>
    </View>
  );
}

function CompletionExerciseTimingCard({
  exercise,
  expanded,
  onToggle,
}: {
  exercise: WorkoutExerciseTimingSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const exerciseElapsed = exercise.elapsedSeconds === null
    ? "—"
    : formatElapsedDuration(exercise.elapsedSeconds);
  return (
    <Card style={styles.completionExerciseCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${exercise.name} timing, ${exerciseElapsed}`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.completionExerciseHeader,
          pressed && styles.completionExerciseHeaderPressed,
        ]}
      >
        <View style={styles.completionExerciseOrder}>
          <Text style={styles.completionExerciseOrderText}>{exercise.position}</Text>
        </View>
        <View style={styles.completionExerciseCopy}>
          <Text numberOfLines={1} style={styles.completionExerciseName}>{exercise.name}</Text>
          <Text style={styles.completionExerciseMeta}>
            {exercise.completedSets}/{exercise.totalSets} sets completed
            {exercise.skippedSets ? ` · ${exercise.skippedSets} skipped` : ""}
          </Text>
        </View>
        <Text style={styles.completionExerciseElapsed}>{exerciseElapsed}</Text>
        <Text style={styles.completionExerciseChevron}>{expanded ? "⌄" : "›"}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.completionSetList}>
          {exercise.sets.map((set, index) => {
            const elapsed = set.elapsedSeconds === null
              ? "Elapsed —"
              : `${formatElapsedDuration(set.elapsedSeconds)} elapsed`;
            const rest = set.restSeconds === null
              ? "Rest —"
              : set.restSeconds > 0
                ? `${formatElapsedDuration(set.restSeconds)} rest`
                : "No rest";
            return (
              <View key={set.id} style={styles.completionSetRow}>
                <View style={styles.completionSetNumber}>
                  <Text style={styles.completionSetNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.completionSetCopy}>
                  <Text style={styles.completionSetStatus}>
                    {set.status === "skipped" ? `Skipped · ${elapsed}` : elapsed}
                  </Text>
                  <Text style={styles.completionSetRest}>
                    {set.status === "skipped" ? "Rest —" : rest}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

function CompactSetOverview({
  qualifier,
  exercisePosition,
  exerciseTotal,
  workoutSet,
}: {
  qualifier: string;
  exercisePosition: number;
  exerciseTotal: number;
  workoutSet: WorkoutView["sets"][number];
}) {
  const prescription = activeSetPrescription(workoutSet);
  const secondaryMetadata = prescription.metadata.filter(
    (item) => !item.text.startsWith("RIR "),
  );
  const guidance = buildCompactSetDetails({
    primaryValues: [
      prescription.target,
      ...prescription.metadata.map((item) => item.text),
    ],
    details: [
      { id: "load", label: "Load", value: workoutSet.loadInstruction },
      { id: "cue", label: "Cue", value: workoutSet.exerciseInstructions },
      { id: "set-note", label: "Set note", value: workoutSet.notes },
    ],
  });
  return (
    <>
      {qualifier ? <Text style={styles.exerciseQualifier}>{qualifier}</Text> : null}
      <View style={styles.setHeadingBlock}>
        <Text accessibilityRole="header" style={styles.exerciseName}>
          {workoutSet.exerciseName}
        </Text>
        <Text style={styles.exercisePosition}>
          Exercise {exercisePosition} of {exerciseTotal}
        </Text>
        {secondaryMetadata.length ? (
          <Text style={styles.exerciseMetadata}>
            {secondaryMetadata.map((item) => item.text).join(" · ")}
          </Text>
        ) : null}
      </View>
      {guidance.length ? (
        <View style={styles.setGuidance}>
          {guidance.map((detail) => (
            <Text key={detail.id} style={styles.setGuidanceText}>
              <Text style={styles.setGuidanceLabel}>{detail.label}: </Text>
              {detail.value}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

function SupersetBanner({ context }: { context: SupersetContext }) {
  return (
    <View accessibilityLabel={`${context.label}, round ${context.round} of ${context.totalRounds}`} style={styles.supersetBanner}>
      <View style={styles.supersetTopline}>
        <Text style={styles.supersetLabel}>
          {context.label} · {context.memberNames.length} exercises
        </Text>
        <Text style={styles.supersetRound}>
          Round {context.round} of {context.totalRounds}
        </Text>
      </View>
      <View style={styles.supersetMembers}>
        {context.memberNames.map((name, index) => (
          <View key={`${index}:${name}`} style={styles.supersetMember}>
            {index ? <Text style={styles.supersetArrow}>→</Text> : null}
            <Text style={styles.supersetMemberName}>{name}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.supersetHint}>
        Alternate these exercises each round before taking the superset rest.
      </Text>
    </View>
  );
}

function WorkoutMenu({
  visible,
  saving,
  onClose,
  onFinishEarly,
  onDiscard,
}: {
  visible: boolean;
  saving: boolean;
  onClose: () => void;
  onFinishEarly: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.menuOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close workout actions"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.workoutMenu}>
          <Pressable
            accessibilityRole="menuitem"
            disabled={saving}
            onPress={onFinishEarly}
            style={({ pressed }) => [styles.workoutMenuItem, pressed && styles.workoutMenuItemPressed]}
          >
            <Text style={styles.workoutMenuItemText}>Finish workout early</Text>
          </Pressable>
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel="Discard this workout permanently"
            disabled={saving}
            onPress={onDiscard}
            style={({ pressed }) => [
              styles.workoutMenuItem,
              styles.workoutMenuDangerItem,
              pressed && styles.workoutMenuItemPressed,
            ]}
          >
            <Text style={styles.workoutMenuDangerText}>Discard workout</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function WorkoutProgressModal({
  visible,
  routineCode,
  completedSets,
  totalSets,
  exercises,
  navigationDisabled,
  onClose,
  onSelectExercise,
}: {
  visible: boolean;
  routineCode: string;
  completedSets: number;
  totalSets: number;
  exercises: ExerciseProgress[];
  navigationDisabled: boolean;
  onClose: () => void;
  onSelectExercise: (exerciseOrder: number) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close full workout progress"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.progressSheet}>
          <View style={styles.progressSheetHeader}>
            <View style={styles.progressSheetTitle}>
              <Eyebrow>Routine {routineCode}</Eyebrow>
              <Heading size="medium">Full workout</Heading>
              <Body muted>
                {completedSets} of {totalSets} sets logged
              </Body>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close full workout progress"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [
                styles.modalClose,
                pressed && styles.modalClosePressed,
              ]}
            >
              <Text style={styles.modalCloseText}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.progressList}
            contentContainerStyle={styles.progressListContent}
            showsVerticalScrollIndicator={false}
          >
            {exercises.map((exercise) => (
              <ExerciseProgressRow
                key={exercise.exerciseOrder}
                exercise={exercise}
                disabled={navigationDisabled}
                onPress={() => onSelectExercise(exercise.exerciseOrder)}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FinishWorkoutModal({
  visible,
  completedSets,
  remainingSets,
  saving,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  completedSets: number;
  remainingSets: number;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keep workout in progress"
          disabled={saving}
          onPress={onCancel}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.finishEarlySheet}>
          <Eyebrow>Finish early</Eyebrow>
          <Heading size="medium">End this workout now?</Heading>
          <Body muted>
            {completedSets} sets are already logged. The remaining {remainingSets}{" "}
            {remainingSets === 1 ? "set" : "sets"} will be marked skipped, and this
            workout cannot be resumed.
          </Body>
          <View style={styles.finishEarlyButtons}>
            <Button
              title={
                saving
                  ? "Finishing…"
                  : `Finish and skip ${remainingSets} ${remainingSets === 1 ? "set" : "sets"}`
              }
              variant="danger"
              loading={saving}
              onPress={onConfirm}
            />
            <Button
              title="Keep training"
              variant="secondary"
              disabled={saving}
              onPress={onCancel}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ExerciseProgressRow({
  exercise,
  disabled,
  onPress,
}: {
  exercise: ExerciseProgress;
  disabled: boolean;
  onPress: () => void;
}) {
  const statusLabel =
    exercise.status === "completed"
      ? "Done"
      : exercise.status === "current"
        ? "Current"
        : exercise.status === "in_progress"
          ? "In progress"
          : "Upcoming";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${exercise.exerciseName}, ${statusLabel.toLowerCase()}, ${exercise.completedSets} of ${exercise.totalSets} sets logged`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.progressExercise,
        exercise.status === "completed" && styles.progressExerciseCompleted,
        exercise.status === "current" && styles.progressExerciseCurrent,
        pressed && styles.progressExercisePressed,
        disabled && styles.progressExerciseDisabled,
      ]}
    >
      <View
        style={[
          styles.progressExerciseOrder,
          exercise.status === "completed" && styles.progressExerciseOrderDone,
          exercise.status === "current" && styles.progressExerciseOrderCurrent,
        ]}
      >
        <Text
          style={[
            styles.progressExerciseOrderText,
            exercise.status === "completed" && styles.progressExerciseOrderTextDone,
            exercise.status === "current" && styles.progressExerciseOrderTextCurrent,
          ]}
        >
          {exercise.status === "completed" ? "✓" : exercise.exerciseOrder}
        </Text>
      </View>
      <View style={styles.progressExerciseCopy}>
        <Text
          numberOfLines={1}
          style={[
            styles.progressExerciseName,
            exercise.status === "completed" && styles.progressExerciseNameDone,
          ]}
        >
          {exercise.exerciseName}
        </Text>
        <Text style={styles.progressExerciseMeta}>
          {exercise.completedSets}/{exercise.totalSets} sets
          {exercise.remainingSets ? ` · ${exercise.remainingSets} left` : " · complete"}
        </Text>
        <Text numberOfLines={1} style={styles.progressExerciseRest}>
          {exercise.restLabel}
        </Text>
      </View>
      <View
        style={[
          styles.progressStatus,
          exercise.status === "completed" && styles.progressStatusDone,
          exercise.status === "current" && styles.progressStatusCurrent,
          exercise.status === "in_progress" && styles.progressStatusInProgress,
        ]}
      >
        <Text
          style={[
            styles.progressStatusText,
            exercise.status === "completed" && styles.progressStatusTextDone,
            exercise.status === "current" && styles.progressStatusTextCurrent,
            exercise.status === "in_progress" && styles.progressStatusTextInProgress,
          ]}
        >
          {statusLabel}
        </Text>
      </View>
      <View accessibilityElementsHidden style={styles.progressExerciseChevron} />
    </Pressable>
  );
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatRestAccessibilityLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (remainder || !minutes) {
    parts.push(`${remainder} second${remainder === 1 ? "" : "s"}`);
  }
  return `Rest, ${parts.join(" ")} remaining`;
}

function loadLabel(type: string, unit: string) {
  if (type === "assistance") return `Assistance (${unit})`;
  if (type === "bodyweight" || type === "added") return `Added weight (${unit})`;
  return `Weight (${unit})`;
}

const styles = StyleSheet.create({
  completeScreen: { minHeight: 520 },
  completionSummaryCard: { backgroundColor: colors.surfaceRaised, gap: spacing.md },
  completionStats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  completionStat: {
    flexGrow: 1,
    flexBasis: 120,
    minWidth: 0,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  completionStatValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  completionStatLabel: { color: colors.textDim, fontSize: 10 },
  completionSkipped: { color: colors.textMuted, fontSize: 11 },
  completionSectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  completionLoading: { color: colors.textDim, fontSize: 11 },
  completionErrorCard: { gap: spacing.md },
  completionErrorDetail: { color: colors.danger, fontSize: 11 },
  completionExerciseCard: { padding: 0, overflow: "hidden", gap: 0 },
  completionExerciseHeader: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  completionExerciseHeaderPressed: { opacity: 0.76 },
  completionExerciseOrder: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.accentDark,
  },
  completionExerciseOrderText: { color: colors.accent, fontSize: 11, fontWeight: "900" },
  completionExerciseCopy: { flex: 1, minWidth: 0, gap: 2 },
  completionExerciseName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  completionExerciseMeta: { color: colors.textMuted, fontSize: 10 },
  completionExerciseElapsed: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  completionExerciseChevron: { color: colors.textMuted, fontSize: 22 },
  completionSetList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  completionSetRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  completionSetNumber: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  completionSetNumberText: { color: colors.textMuted, fontSize: 10, fontWeight: "800" },
  completionSetCopy: { flex: 1, minWidth: 0, gap: 2 },
  completionSetStatus: { color: colors.text, fontSize: 12, fontWeight: "700" },
  completionSetRest: { color: colors.textDim, fontSize: 10 },
  completionActions: { gap: spacing.sm, paddingTop: spacing.sm },
  workoutHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  workoutHeaderSide: { width: 88, alignItems: "flex-start" },
  workoutHeaderRight: { alignItems: "flex-end" },
  workoutHeaderTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  headerBack: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  headerBackChevron: {
    width: 8,
    height: 8,
    borderLeftWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.textMuted,
    transform: [{ rotateZ: "45deg" }],
  },
  headerBackText: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  headerActionPressed: { opacity: 0.68 },
  headerActionDisabled: { opacity: 0.42 },
  moreAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  moreDots: { flexDirection: "row", alignItems: "center", gap: 3 },
  moreDot: { width: 3, height: 3, borderRadius: radii.pill, backgroundColor: colors.textMuted },
  workoutProgress: {
    position: "relative",
    minHeight: 70,
    justifyContent: "center",
    paddingTop: 10,
    paddingBottom: 15,
  },
  workoutProgressPressed: { opacity: 0.72 },
  workoutProgressRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  workoutProgressCopy: {
    flex: 1,
    minWidth: 0,
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  workoutProgressCount: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "500" },
  workoutProgressTime: { color: colors.textDim },
  workoutProgressAction: { flexDirection: "row", alignItems: "center", gap: 0 },
  workoutProgressActionText: { color: colors.textMuted, fontSize: 13, lineHeight: 16, fontWeight: "500" },
  inlineChevron: {
    width: 7,
    height: 7,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.textMuted,
    transform: [{ rotateZ: "-45deg" }],
  },
  progressTrack: {
    position: "absolute",
    right: 0,
    bottom: 7,
    left: 0,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
  },
  progressValue: { height: "100%", backgroundColor: colors.accent, borderRadius: radii.pill },
  menuOverlay: {
    flex: 1,
    alignItems: "flex-end",
    paddingTop: 64,
    paddingHorizontal: spacing.lg,
  },
  workoutMenu: {
    width: 220,
    overflow: "hidden",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  workoutMenuItem: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  workoutMenuDangerItem: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  workoutMenuItemPressed: { backgroundColor: colors.surfaceRaised },
  workoutMenuItemText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  workoutMenuDangerText: { color: colors.danger, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: colors.overlay,
    paddingTop: spacing.xl,
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  progressSheet: {
    width: "100%",
    maxWidth: 680,
    maxHeight: "88%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  progressSheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  progressSheetTitle: { flex: 1, gap: spacing.xs },
  modalClose: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalClosePressed: { opacity: 0.72 },
  modalCloseText: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 27,
    fontWeight: "500",
  },
  progressList: { flexShrink: 1 },
  progressListContent: { gap: spacing.sm, paddingBottom: spacing.sm },
  progressExercise: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  progressExerciseCompleted: { opacity: 0.72 },
  progressExerciseCurrent: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  progressExercisePressed: { opacity: 0.7 },
  progressExerciseDisabled: { opacity: 0.44 },
  progressExerciseOrder: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  progressExerciseOrderDone: { backgroundColor: colors.successSurface },
  progressExerciseOrderCurrent: { backgroundColor: colors.accent },
  progressExerciseOrderText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  progressExerciseOrderTextDone: { color: colors.success },
  progressExerciseOrderTextCurrent: { color: colors.background },
  progressExerciseCopy: { flex: 1, minWidth: 0, gap: 2 },
  progressExerciseName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  progressExerciseNameDone: { color: colors.textMuted },
  progressExerciseMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  progressExerciseRest: { color: colors.textDim, fontSize: 11 },
  progressStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
  },
  progressStatusDone: { backgroundColor: colors.successSurface },
  progressStatusCurrent: { backgroundColor: colors.accent },
  progressStatusInProgress: { backgroundColor: colors.warningSurface },
  progressStatusText: { color: colors.textDim, fontSize: 9, fontWeight: "800" },
  progressStatusTextDone: { color: colors.success },
  progressStatusTextCurrent: { color: colors.background },
  progressStatusTextInProgress: { color: colors.warning },
  progressExerciseChevron: {
    width: 7,
    height: 7,
    marginRight: 3,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.textMuted,
    transform: [{ rotateZ: "-45deg" }],
  },
  stopwatch: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  stopwatchTopline: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  stopwatchLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  stopwatchHint: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  stopwatchLiveDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.textDim,
    marginTop: spacing.xs,
  },
  stopwatchLiveDotRunning: { backgroundColor: colors.accent },
  stopwatchTime: {
    color: colors.text,
    fontSize: 52,
    lineHeight: 60,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: -2,
    textAlign: "center",
  },
  stopwatchControls: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  stopwatchPrimary: {
    flex: 2,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  stopwatchSecondary: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  stopwatchPrimaryText: { color: colors.background, fontSize: 14, fontWeight: "800" },
  stopwatchSecondaryText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  stopwatchControlPressed: { opacity: 0.74 },
  stopwatchControlDisabled: { opacity: 0.4 },
  finishEarlyAction: {
    alignItems: "stretch",
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  finishEarlyHint: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  discardWorkoutAction: {
    alignItems: "stretch",
    gap: spacing.xs,
  },
  discardWorkoutButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  discardWorkoutButtonPressed: { backgroundColor: colors.dangerSurface },
  discardWorkoutButtonText: { color: colors.danger, fontSize: 13, fontWeight: "800" },
  discardWorkoutHint: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  finishEarlySheet: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  finishEarlyButtons: { gap: spacing.sm },
  activeSetStack: { width: "100%", gap: spacing.md },
  restIsland: {
    width: "100%",
    maxWidth: 280,
    minHeight: 58,
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  restIslandRail: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  restIslandLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  restIslandTimer: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  restIslandPastLabel: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  restIslandSkip: {
    minWidth: 64,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  restIslandSkipDisabled: { opacity: 0.45 },
  restIslandSkipPressed: { opacity: 0.72 },
  restIslandSkipFocused: {
    outlineColor: colors.accent,
    outlineOffset: -2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
  restIslandSkipText: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  setCard: { gap: spacing.md },
  supersetBanner: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  supersetTopline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  supersetLabel: {
    color: colors.accent,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  supersetRound: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  supersetMembers: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  supersetMember: {
    minWidth: 0,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  supersetArrow: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  supersetMemberName: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  supersetHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  setNavigator: {
    overflow: "hidden",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  setNavigatorRow: { minHeight: 48, flexDirection: "row", alignItems: "stretch" },
  setNavigatorButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
  },
  setNavigatorButtonDisabled: { opacity: 0.38 },
  setNavigatorButtonPressed: { opacity: 0.72 },
  setNavigatorButtonText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  setNavigatorStatus: {
    flex: 1.3,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  setNavigatorStatusLabel: {
    color: colors.accent,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  setNavigatorPosition: {
    color: colors.textDim,
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  navigationHint: { color: colors.textDim, fontSize: 11, lineHeight: 16, textAlign: "center" },
  exerciseQualifier: {
    color: colors.accent,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1,
    textAlign: "center",
    textTransform: "uppercase",
  },
  setHeadingBlock: {
    minHeight: 78,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  exerciseName: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "500",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  exercisePosition: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 15,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  exerciseMetadata: { color: colors.textMuted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  setSummary: {
    minHeight: 44,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  setMetricLabel: {
    color: colors.textDim,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  setMetricValue: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    flexShrink: 1,
  },
  setPrescription: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  setPrescriptionMetadata: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexShrink: 1,
  },
  setMetricSeparator: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  setMetricMeta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    flexShrink: 1,
  },
  setGuidance: { gap: spacing.xs },
  setGuidanceText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  setGuidanceLabel: { color: colors.textDim, fontWeight: "800" },
  skipSetRow: { minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  skipSetAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  skipSetActionPressed: { opacity: 0.66 },
  skipSetText: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  futureSetNotice: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  futureSetText: { color: colors.textMuted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  logControls: {
    gap: spacing.md,
  },
  logFields: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  logField: { flexGrow: 1, flexBasis: 150, minWidth: 0 },
  saveState: { textAlign: "center", color: colors.success, fontSize: 12, fontWeight: "700" },
  saveFailed: { color: colors.danger },
});
