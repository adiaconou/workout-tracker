import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
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

type RecordSetResponse = {
  performanceId: string;
  completedSets: number;
  skippedSets: number;
  nextSetIndex: number;
  restSeconds: number;
  restEndsAt: string | null;
  workoutCompleted: boolean;
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
      setWorkoutCompleted(next.status === "Completed");
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

  useEffect(() => {
    if (!currentSet) return;
    const startsAtZero = currentSet.loadType === "bodyweight" || currentSet.loadType === "added";
    setWeight(startsAtZero ? "0" : "");
    setResult("");
    setError("");
    setSaveState("");
  }, [currentIndex, currentSet?.id]);

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
    const numericResult = Number(result);
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
              onChangeText={setResult}
              keyboardType="number-pad"
              placeholder="0"
              selectTextOnFocus
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
    </Screen>
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
  restLayout: { gap: spacing.lg },
  timerCard: { alignItems: "stretch", paddingVertical: spacing.xl },
  timer: { color: colors.text, fontSize: 72, lineHeight: 80, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"], letterSpacing: -3 },
  timerTrack: { height: 6, borderRadius: radii.pill, backgroundColor: colors.background, overflow: "hidden", marginBottom: spacing.md },
  timerValue: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.accent },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  factLabel: { color: colors.textDim, fontSize: 11, textTransform: "uppercase", fontWeight: "700" },
  factValue: { color: colors.text, fontSize: 13, fontWeight: "600", textAlign: "right", flex: 1 },
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
