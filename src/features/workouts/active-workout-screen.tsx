import { useCallback, useEffect, useMemo, useState } from "react";
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
import { apiRequest } from "../../api/client";
import {
  countPendingSetWrites,
  enqueueSetWrite,
  flushPendingSetWrites,
  removePendingSetWrite,
  removePendingSetWritesForWorkout,
} from "../../api/pending-writes";
import type { WorkoutView } from "../../api/types";
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
} from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";
import { formatPreviousSetPerformance } from "./previous-performance";
import {
  buildWorkoutExerciseProgress,
  type ExerciseProgress,
} from "./workout-progress";
import {
  formatStopwatch,
  getStopwatchElapsedMs,
  getStopwatchSeconds,
} from "./stopwatch";
import { DiscardWorkoutModal } from "./discard-workout-modal";

type RecordSetResponse = {
  performanceId: string;
  completedSets: number;
  skippedSets: number;
  nextSetIndex: number;
  restSeconds: number;
  restEndsAt: string | null;
  workoutCompleted: boolean;
};

type CompleteWorkoutResponse = {
  completedSets: number;
  skippedSets: number;
  remainingSetsSkipped: number;
  workoutCompleted: true;
  endedEarly: boolean;
};

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
  const [showFullProgress, setShowFullProgress] = useState(false);
  const [showFinishEarly, setShowFinishEarly] = useState(false);
  const [showDiscardWorkout, setShowDiscardWorkout] = useState(false);
  const [stopwatchStartedAt, setStopwatchStartedAt] = useState<number | null>(null);
  const [stopwatchElapsedMs, setStopwatchElapsedMs] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await flushPendingSetWrites();
      const payload = await apiRequest<{ workout: WorkoutView }>(
        `/api/v1/workouts/${encodeURIComponent(sessionId)}`,
      );
      const next = payload.workout;
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

  useEffect(() => {
    void load();
  }, [load]);

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
  const exerciseProgress = useMemo(
    () => buildWorkoutExerciseProgress(workout?.sets ?? [], currentIndex),
    [currentIndex, workout?.sets],
  );

  useEffect(() => {
    if (!currentSet) return;
    const startsAtZero = currentSet.loadType === "bodyweight" || currentSet.loadType === "added";
    setWeight(startsAtZero ? "0" : "");
    setResult("");
    setError("");
    setSaveState("");
    setStopwatchStartedAt(null);
    setStopwatchElapsedMs(0);
  }, [currentIndex, currentSet?.id]);

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

    const numericWeight = Number(weight);
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
    const numericResult = Number(resultForSave);
    if (status === "Completed" && (!Number.isFinite(numericWeight) || numericWeight < 0)) {
      setError("Enter the weight used for this set.");
      setSaving(false);
      return;
    }
    if (status === "Completed" && (!Number.isFinite(numericResult) || numericResult < 0)) {
      setError(`Enter the ${currentSet.targetUnit === "seconds" ? "seconds" : "reps"} completed.`);
      setSaving(false);
      return;
    }

    const body = {
      prescribedSetId: currentSet.id,
      status,
      actualWeight: status === "Completed" ? numericWeight : null,
      actualReps:
        status === "Completed" && currentSet.targetUnit === "reps" ? numericResult : null,
      actualDurationSec:
        status === "Completed" && currentSet.targetUnit === "seconds" ? numericResult : null,
    };
    const pending = await enqueueSetWrite(workout.id, body);
    setPendingCount(await countPendingSetWrites(workout.id));

    try {
      const payload = await apiRequest<RecordSetResponse>(
        `/api/v1/workouts/${encodeURIComponent(workout.id)}/sets`,
        {
          method: "POST",
          headers: { "x-idempotency-key": pending.operationId },
          body: JSON.stringify(body),
        },
      );
      await removePendingSetWrite(pending.operationId);
      setPendingCount(await countPendingSetWrites(workout.id));
      setCompletedSets(payload.completedSets);
      setSkippedSets(payload.skippedSets);
      setSaveState("Saved");
      if (payload.workoutCompleted) {
        setWorkoutCompleted(true);
        setRestEndsAt(null);
      } else {
        setCurrentIndex(payload.nextSetIndex);
        setRestDuration(payload.restSeconds);
        setRestEndsAt(payload.restEndsAt);
        setSecondsRemaining(payload.restSeconds);
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
    setSaving(true);
    setError("");
    setSaveState("");
    try {
      await flushPendingSetWrites();
      const remainingPending = await countPendingSetWrites(workout.id);
      setPendingCount(remainingPending);
      if (remainingPending) {
        throw new Error("Sync the pending set before finishing this workout.");
      }
      const payload = await apiRequest<CompleteWorkoutResponse>(
        `/api/v1/workouts/${encodeURIComponent(workout.id)}/complete`,
        { method: "POST" },
      );
      setCompletedSets(payload.completedSets);
      setSkippedSets(payload.skippedSets);
      setRestEndsAt(null);
      setSecondsRemaining(0);
      setStopwatchStartedAt(null);
      setShowFinishEarly(false);
      setShowFullProgress(false);
      setWorkoutCompleted(true);
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
      setRestEndsAt(null);
      setSecondsRemaining(0);
      setStopwatchStartedAt(null);
      setShowDiscardWorkout(false);
      setShowFinishEarly(false);
      setShowFullProgress(false);
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
        <Eyebrow>Routine complete</Eyebrow>
        <Heading>Workout saved.</Heading>
        <Body muted>
          {completedSets} sets completed and {skippedSets} skipped. Every set is stored against
          this routine snapshot.
        </Body>
        {pendingCount ? <Message tone="warning">{pendingCount} set action still needs to sync.</Message> : null}
        <Button title="Back to routines →" onPress={() => router.replace("/routines")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.topline}>
        <Pressable accessibilityRole="link" onPress={() => router.replace(`/routines/${workout.routineCode}`)}>
          <Text style={styles.exit}>← Exit workout</Text>
        </Pressable>
        <Text style={styles.routineLabel}>Routine {workout.routineCode} · v{workout.routineVersion}</Text>
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

      {restEndsAt && currentSet ? (
        <View style={styles.restLayout}>
          <Card style={styles.timerCard}>
            <Eyebrow>Rest in progress</Eyebrow>
            <Text
              accessibilityLabel={`${secondsRemaining} seconds remaining`}
              style={styles.timer}
            >
              {formatTimer(secondsRemaining)}
            </Text>
            <View style={styles.timerTrack}>
              <View
                style={[
                  styles.timerValue,
                  { width: `${restDuration ? (secondsRemaining / restDuration) * 100 : 0}%` },
                ]}
              />
            </View>
            <Button
              title="Skip rest →"
              variant="secondary"
              loading={saving}
              onPress={() => void skipRest()}
            />
          </Card>
          <Card>
            <Eyebrow>Next set</Eyebrow>
            <Heading size="medium">{currentSet.exerciseName}</Heading>
            <Body muted>
              {setTypeLabel(currentSet.setType)} {currentSet.typeSetNumber} of{" "}
              {currentSet.typeSetTotal}
            </Body>
            <Fact label="Target" value={currentSet.target} />
            <Fact label="Effort" value={currentSet.effort} />
            <PreviousPerformance
              sets={previousExerciseSets}
              setCount={currentSet.exerciseSetTotal}
            />
          </Card>
        </View>
      ) : currentSet ? (
        <>
          <View style={styles.exerciseLine}>
            <Eyebrow>Exercise {exercisePosition} of {exerciseOrders.length}</Eyebrow>
            <Text style={styles.setType}>{setTypeLabel(currentSet.setType)}</Text>
          </View>
          <Card style={styles.setCard}>
            <Heading>{currentSet.exerciseName}</Heading>
            <View style={styles.prescriptionGrid}>
              <Prescription label="Target" value={currentSet.target} />
              <Prescription label="Effort" value={currentSet.effort} />
              <Prescription label="Rest after" value={formatRest(currentSet.restSeconds, currentSet.restRule)} />
            </View>
            <Body muted>
              Set {currentSet.exerciseSetNumber} of {currentSet.exerciseSetTotal} ·{" "}
              {setTypeLabel(currentSet.setType)}
            </Body>
          </Card>

          <Card>
            <Eyebrow>Log this set</Eyebrow>
            {currentSet.targetUnit === "seconds" ? (
              <SetStopwatch
                elapsedMs={stopwatchElapsedMs}
                running={stopwatchStartedAt !== null}
                onStart={startStopwatch}
                onPause={pauseStopwatch}
                onReset={resetStopwatch}
              />
            ) : null}
            <StepperField
              label={loadLabel(currentSet.loadType)}
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              placeholder="0"
              selectTextOnFocus
            />
            <StepperField
              label={currentSet.targetUnit === "seconds" ? "Seconds completed" : "Reps completed"}
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
            <Button
              title={saving ? "Saving…" : "Complete set →"}
              loading={saving}
              onPress={() => void recordSet("Completed")}
            />
            <Button
              title="Skip this set"
              variant="ghost"
              disabled={saving}
              onPress={() => void recordSet("Skipped")}
            />
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
          </Card>
        </>
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function Prescription({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.prescription}>
      <Text style={styles.prescriptionLabel}>{label}</Text>
      <Text style={styles.prescriptionValue}>{value}</Text>
    </View>
  );
}

function PreviousPerformance({
  sets,
  setCount,
}: {
  sets: NonNullable<WorkoutView["previousPerformanceByExercise"][number]>["sets"];
  setCount: number;
}) {
  return (
    <View style={styles.previousPerformance}>
      <Text style={styles.previousHeading}>Last time</Text>
      {Array.from({ length: Math.max(1, setCount) }, (_, index) => (
        <View key={index} style={styles.previousSetRow}>
          <Text style={styles.previousSetLabel}>Set {index + 1}</Text>
          <Text style={styles.previousSetValue}>
            {formatPreviousSetPerformance(sets[index])}
          </Text>
        </View>
      ))}
    </View>
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
  if (type === "emom") return "EMOM round";
  if (type === "warmup") return "Warm-up set";
  if (type === "failure") return "Failure set";
  if (type === "drop") return "Drop set";
  return "Working set";
}

function loadLabel(type: string) {
  if (type === "assistance") return "Assistance used (lb)";
  if (type === "bodyweight" || type === "added") return "Added weight (lb)";
  return "Weight used (lb)";
}

function formatRest(seconds: number, rule: string) {
  if (rule === "emom") return "Start every minute";
  if (rule === "no_rest_before_drop") return "No rest before drop";
  if (rule === "after_superset") return "After superset";
  if (!seconds) return "None";
  const base = seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`;
  return rule === "after_both_sides" ? `${base} after both` : base;
}

const styles = StyleSheet.create({
  completeScreen: { justifyContent: "center", minHeight: 520 },
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
  restLayout: { gap: spacing.lg },
  timerCard: { alignItems: "stretch", paddingVertical: spacing.xl },
  timer: { color: colors.text, fontSize: 72, lineHeight: 80, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"], letterSpacing: -3 },
  timerTrack: { height: 6, borderRadius: radii.pill, backgroundColor: colors.background, overflow: "hidden", marginBottom: spacing.md },
  timerValue: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.accent },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  factLabel: { color: colors.textDim, fontSize: 11, textTransform: "uppercase", fontWeight: "700" },
  factValue: { color: colors.text, fontSize: 13, fontWeight: "600", textAlign: "right", flex: 1 },
  previousPerformance: {
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  previousHeading: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  previousSetRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  previousSetLabel: { color: colors.textMuted, fontSize: 12 },
  previousSetValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  exerciseLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  setType: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  setCard: { backgroundColor: colors.surfaceRaised, paddingVertical: spacing.xl },
  prescriptionGrid: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  prescription: { flexGrow: 1, flexBasis: 110, minHeight: 76, backgroundColor: colors.background, borderRadius: radii.md, padding: spacing.md, gap: spacing.xs },
  prescriptionLabel: { color: colors.textDim, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  prescriptionValue: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  saveState: { textAlign: "center", color: colors.success, fontSize: 12, fontWeight: "700" },
  saveFailed: { color: colors.danger },
});
