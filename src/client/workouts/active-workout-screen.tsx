import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { router } from "expo-router";
import { apiRequest } from "../api/client";
import {
  countPendingSetWrites,
  enqueueSetWrite,
  flushPendingSetWrites,
  removePendingSetWrite,
  removePendingSetWritesForWorkout,
} from "../api/pending-writes";
import type { Workout, WorkoutView } from "../../contracts/api";
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
  getSetInputDefaults,
} from "./set-input-defaults";
import { DiscardWorkoutModal } from "./discard-workout-modal";
import {
  formatElapsedDuration,
  summarizeWorkoutTiming,
  type WorkoutExerciseTimingSummary,
} from "./workout-timing";
import {
  createSetRecordBody,
  discardWorkoutSuccessState,
  elapsedFromAnchor,
  finishEarlySuccessState,
  pendingFinishError,
  prepareSetRecord,
  recordedSetPerformance,
  recordSetSuccessState,
  resultUnitName,
  type CompleteWorkoutResponse,
  type ElapsedAnchor,
  type RecordSetResponse,
} from "./active-workout-model";

export function ActiveWorkoutScreen({ sessionId }: { sessionId: string }) {
  const [workout, setWorkout] = useState<WorkoutView | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedSets, setCompletedSets] = useState(0);
  const [skippedSets, setSkippedSets] = useState(0);
  const [restEndsAt, setRestEndsAt] = useState<string | null>(null);
  const [restDuration, setRestDuration] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [weight, setWeight] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"Saved" | "Save failed" | "">("");
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
  const [showFinishEarly, setShowFinishEarly] = useState(false);
  const [showDiscardWorkout, setShowDiscardWorkout] = useState(false);
  const [stopwatchStartedAt, setStopwatchStartedAt] = useState<number | null>(null);
  const [stopwatchElapsedMs, setStopwatchElapsedMs] = useState(0);
  const [timingNow, setTimingNow] = useState(() => Date.now());
  const workoutElapsedAnchor = useRef<ElapsedAnchor>({ seconds: 0, anchoredAt: Date.now() });
  const currentSetElapsedAnchor = useRef<ElapsedAnchor>({ seconds: 0, anchoredAt: Date.now() });

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
      setCurrentIndex(next.currentSetIndex);
      setCompletedSets(next.completedSets);
      setSkippedSets(next.skippedSets);
      setWorkoutCompleted(next.status === "Completed" || next.status === "Partial");
      setRestEndsAt(next.restEndsAt);
      setRestDuration(next.currentRestSeconds);
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
  const completedOrSkipped = completedSets + skippedSets;
  const progress = workout?.totalSets
    ? Math.min(1, completedOrSkipped / workout.totalSets)
    : 0;
  const exerciseOrders = useMemo(
    () => Array.from(new Set(workout?.sets.map((set) => set.exerciseOrder) ?? [])),
    [workout?.sets],
  );
  const exercisePosition = currentSet
    ? exerciseOrders.indexOf(currentSet.exerciseOrder) + 1
    : exerciseOrders.length;
  const previousExerciseSets = currentSet
    ? workout?.previousPerformanceByExercise[currentSet.exerciseOrder]?.sets ?? []
    : [];
  const currentExerciseSets = useMemo(
    () => currentSet
      ? workout?.sets.filter((set) => set.exerciseOrder === currentSet.exerciseOrder) ?? []
      : [],
    [currentSet?.exerciseOrder, workout?.sets],
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
  const liveCurrentSetElapsedSeconds = workoutCompleted
    ? currentSetElapsedAnchor.current.seconds
    : elapsedFromAnchor(currentSetElapsedAnchor.current, timingNow);

  useEffect(() => {
    if (!currentSet) return;
    const defaults = getSetInputDefaults(currentSet);
    setWeight(defaults.weight);
    setResult(defaults.result);
    setError("");
    setSaveState("");
    setStopwatchStartedAt(null);
    setStopwatchElapsedMs(0);
  }, [currentIndex, currentSet?.id, sessionId, workout?.id]);

  useEffect(() => {
    if (stopwatchStartedAt === null) return;
    const tick = () => {
      const elapsedMs = getStopwatchElapsedMs(stopwatchStartedAt, 0);
      setStopwatchElapsedMs(elapsedMs);
      setResult(String(getStopwatchSeconds(elapsedMs)));
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [stopwatchStartedAt]);

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
    if (!workout || !currentSet || saving) return;
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
          [currentSet.id]: recordedSetPerformance(
            currentSet,
            status,
            prepared.numericWeight,
            prepared.numericResult,
          ),
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
          setWeight(nextSetInputs.weight);
          setResult(nextSetInputs.result);
        }
        currentSetElapsedAnchor.current = success.nextSet.elapsedAnchor;
        setCurrentIndex(success.nextSet.index);
        setRestDuration(success.nextSet.restSeconds);
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
    if (!workout || saving) return;
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
    setStopwatchStartedAt(Date.now() - stopwatchElapsedMs);
  }

  function pauseStopwatch() {
    if (stopwatchStartedAt === null) return;
    const elapsedMs = getStopwatchElapsedMs(
      stopwatchStartedAt,
      stopwatchElapsedMs,
    );
    setStopwatchElapsedMs(elapsedMs);
    setStopwatchStartedAt(null);
    setResult(String(getStopwatchSeconds(elapsedMs)));
  }

  function resetStopwatch() {
    setStopwatchStartedAt(null);
    setStopwatchElapsedMs(0);
    setResult("");
  }

  function updateDurationResult(value: string) {
    setResult(value);
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

  return (
    <Screen>
      <View style={styles.topline}>
        <Pressable accessibilityRole="link" onPress={() => router.replace(`/routines/${workout.routineCode}`)}>
          <Text style={styles.exit}>← Exit workout</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.routineLabel}>
          Routine {workout.routineCode} · Elapsed {formatElapsedDuration(liveWorkoutElapsedSeconds)}
        </Text>
        <Text style={styles.setCounter}>{completedOrSkipped}/{workout.totalSets}</Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: workout.totalSets, now: completedOrSkipped }}
        style={styles.progressTrack}
      >
        <View style={[styles.progressValue, { width: `${progress * 100}%` }]} />
      </View>
      <View style={styles.progressActions}>
        <Text style={styles.progressCaption}>
          {exerciseProgress.filter((exercise) => exercise.status === "completed").length} of{" "}
          {exerciseProgress.length} exercises done
          {!restEndsAt ? ` · Set ${formatElapsedDuration(liveCurrentSetElapsedSeconds)}` : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View full workout progress"
          onPress={() => setShowFullProgress(true)}
          hitSlop={8}
        >
          <Text style={styles.progressLink}>View full workout →</Text>
        </Pressable>
      </View>

      <WorkoutProgressModal
        visible={showFullProgress}
        routineCode={workout.routineCode}
        completedSets={completedOrSkipped}
        totalSets={workout.totalSets}
        exercises={exerciseProgress}
        onClose={() => setShowFullProgress(false)}
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

      {currentSet ? (
        <Card style={styles.setCard}>
          <CompactSetOverview
            eyebrow={`${restEndsAt ? "Next · " : ""}Exercise ${exercisePosition} of ${exerciseOrders.length}`}
            workoutSet={currentSet}
          />
          {restEndsAt ? (
            <View style={styles.inlineRest}>
              <View style={styles.inlineRestTopline}>
                <Eyebrow>Rest in progress</Eyebrow>
                <Text
                  accessibilityLabel={`${secondsRemaining} seconds remaining`}
                  accessibilityLiveRegion="polite"
                  style={styles.inlineRestTimer}
                >
                  {formatTimer(secondsRemaining)}
                </Text>
              </View>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="Rest time remaining"
                accessibilityValue={{
                  min: 0,
                  max: Math.max(1, restDuration),
                  now: Math.min(Math.max(0, secondsRemaining), Math.max(1, restDuration)),
                  text: `${secondsRemaining} seconds remaining`,
                }}
                style={styles.timerTrack}
              >
                <View
                  style={[
                    styles.timerValue,
                    { width: `${restDuration ? (secondsRemaining / restDuration) * 100 : 0}%` },
                  ]}
                />
              </View>
              <Button
                title="Skip Rest"
                variant="secondary"
                compact
                loading={saving}
                onPress={() => void skipRest()}
              />
            </View>
          ) : null}
          <ActiveExerciseProgressChart
            key={`progress:${currentSet.exerciseId}:${currentSet.exerciseOrder}`}
            exerciseId={currentSet.exerciseId}
            exerciseName={currentSet.exerciseName}
          />
          <ActiveSetComparison
            sets={currentExerciseSets}
            previousSets={previousExerciseSets}
            recordedPerformanceBySetId={workout.recordedPerformanceBySetId ?? {}}
            currentSetId={currentSet.id}
            weight={weight}
            result={result}
          />
          {!restEndsAt ? (
            <View style={styles.logControls}>
              {currentSet.targetUnit === "seconds" ? (
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
                    label={loadLabel(currentSet.loadType, currentSet.weightUnit)}
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    selectTextOnFocus
                  />
                </View>
                <View style={styles.logField}>
                  <StepperField
                    label={`${resultUnitName(currentSet.targetUnit, true)} completed`}
                    value={result}
                    onChangeText={
                      currentSet.targetUnit === "seconds"
                        ? updateDurationResult
                        : setResult
                    }
                    keyboardType="number-pad"
                    placeholder="0"
                    selectTextOnFocus
                    editable={currentSet.targetUnit !== "seconds" || stopwatchStartedAt === null}
                  />
                </View>
              </View>
              <View style={styles.setActions}>
                <View style={styles.setAction}>
                  <Button
                    title={saving ? "Saving…" : "Complete"}
                    compact
                    loading={saving}
                    onPress={() => void recordSet("Completed")}
                  />
                </View>
                <View style={styles.setAction}>
                  <Button
                    title="Skip"
                    variant="secondary"
                    compact
                    disabled={saving}
                    onPress={() => void recordSet("Skipped")}
                  />
                </View>
              </View>
              {saveState ? (
                <Text style={[
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
            </View>
          ) : null}
        </Card>
      ) : (
        <Message>There are no remaining sets, but this workout has not been finalized.</Message>
      )}
      <View style={styles.finishEarlyAction}>
        <Button
          title="Finish workout early"
          variant="ghost"
          disabled={saving}
          onPress={() => setShowFinishEarly(true)}
        />
        <Text style={styles.finishEarlyHint}>
          Saves completed work and marks every remaining set as skipped.
        </Text>
      </View>
      <View style={styles.discardWorkoutAction}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard this workout permanently"
          disabled={saving}
          onPress={() => setShowDiscardWorkout(true)}
          style={({ pressed }) => [
            styles.discardWorkoutButton,
            pressed && styles.discardWorkoutButtonPressed,
          ]}
        >
          <Text style={styles.discardWorkoutButtonText}>Discard workout</Text>
        </Pressable>
        <Text style={styles.discardWorkoutHint}>
          Permanently deletes this in-progress workout instead of saving it to history.
        </Text>
      </View>
    </Screen>
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
  eyebrow,
  workoutSet,
}: {
  eyebrow: string;
  workoutSet: WorkoutView["sets"][number];
}) {
  return (
    <>
      <Eyebrow>{eyebrow}</Eyebrow>
      <View style={styles.setHeadingRow}>
        <View style={styles.setHeadingCopy}>
          <Heading size="medium">{workoutSet.exerciseName}</Heading>
        </View>
        <Text style={styles.setMeta}>
          {setTypeLabel(workoutSet.setType)} · Set {workoutSet.exerciseSetNumber} of{" "}
          {workoutSet.exerciseSetTotal}
        </Text>
      </View>
      <View style={styles.setSummary}>
        <View style={styles.setMetric}>
          <Text style={styles.setMetricLabel}>Target</Text>
          <Text style={styles.setMetricValue}>{workoutSet.target}</Text>
        </View>
      </View>
    </>
  );
}

function WorkoutProgressModal({
  visible,
  routineCode,
  completedSets,
  totalSets,
  exercises,
  onClose,
}: {
  visible: boolean;
  routineCode: string;
  completedSets: number;
  totalSets: number;
  exercises: ExerciseProgress[];
  onClose: () => void;
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

function ExerciseProgressRow({ exercise }: { exercise: ExerciseProgress }) {
  const statusLabel =
    exercise.status === "completed"
      ? "Done"
      : exercise.status === "current"
        ? "Current"
        : exercise.status === "in_progress"
          ? "In progress"
          : "Upcoming";
  return (
    <View
      style={[
        styles.progressExercise,
        exercise.status === "completed" && styles.progressExerciseCompleted,
        exercise.status === "current" && styles.progressExerciseCurrent,
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
    </View>
  );
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function setTypeLabel(type: string) {
  if (type === "emom") return "EMOM";
  if (type === "test") return "Test";
  if (type === "warmup") return "Warm-up";
  if (type === "failure") return "Failure";
  if (type === "drop") return "Drop";
  return "Working";
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
  topline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  exit: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  routineLabel: { color: colors.textDim, fontSize: 11, flex: 1, textAlign: "center" },
  setCounter: { color: colors.text, fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  progressTrack: { height: 5, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  progressValue: { height: "100%", backgroundColor: colors.accent, borderRadius: radii.pill },
  progressActions: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  progressCaption: { color: colors.textDim, fontSize: 11 },
  progressLink: { color: colors.accent, fontSize: 12, fontWeight: "800" },
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
  inlineRest: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  inlineRestTopline: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  inlineRestTimer: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  timerTrack: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  timerValue: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.accent },
  setCard: { backgroundColor: colors.surfaceRaised, gap: spacing.md },
  setHeadingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  setHeadingCopy: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
  setMeta: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  setSummary: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.background,
  },
  setMetric: { gap: 2 },
  setMetricLabel: {
    color: colors.textDim,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  setMetricValue: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  logControls: {
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  logFields: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  logField: { flexGrow: 1, flexBasis: 260, minWidth: 0 },
  setActions: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
  setAction: { flex: 1, minWidth: 0 },
  saveState: { textAlign: "center", color: colors.success, fontSize: 12, fontWeight: "700" },
  saveFailed: { color: colors.danger },
});
