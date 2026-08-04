import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { WorkoutSet } from "../../../domain/entities";
import { apiRequest } from "../../api/client";
import type {
  PreviousExercisePerformance,
  Workout,
} from "../../api/types";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Field,
  Heading,
  LoadingView,
  Message,
  Screen,
  StepperField,
} from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";
import { formatPreviousSetPerformance } from "../workouts/previous-performance";
import {
  formatElapsedDuration,
  summarizeWorkoutTiming,
} from "../workouts/workout-timing";
import {
  formatHistoryDateTime,
  formatSetResult,
  historyStatusLabel,
} from "./history-format";

type HistoryDetailPayload = {
  workout: Workout;
  previousPerformanceByExercise: Record<number, PreviousExercisePerformance>;
};

type EditableSet = {
  set: WorkoutSet;
  exerciseName: string;
  loadType: string;
};

export function WorkoutHistoryDetailScreen({
  workoutId,
}: {
  workoutId: string;
}) {
  const [data, setData] = useState<HistoryDetailPayload | null>(null);
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<EditableSet | null>(null);
  const [expandedExerciseIds, setExpandedExerciseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<HistoryDetailPayload>(
        `/api/v1/workouts/${encodeURIComponent(workoutId)}/history`,
      );
      setData(payload);
      setNotes(payload.workout.notes);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "This workout could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [workoutId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function saveNotes() {
    if (!data || savingNotes) return;
    setSavingNotes(true);
    setError("");
    setSaved("");
    try {
      await apiRequest(`/api/v1/workouts/${encodeURIComponent(data.workout.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ notes }),
      });
      setData({
        ...data,
        workout: { ...data.workout, notes },
      });
      setSaved("Notes saved");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Notes could not be saved.",
      );
    } finally {
      setSavingNotes(false);
    }
  }

  async function saveSet(
    set: WorkoutSet,
    values: {
      status: "completed" | "skipped";
      weight: number | null;
      reps: number | null;
      duration: number | null;
      rir: number | null;
      rest: number | null;
      notes: string;
    },
  ) {
    if (!data) return;
    await apiRequest(
      `/api/v1/workouts/${encodeURIComponent(data.workout.id)}/sets/${encodeURIComponent(set.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: values.status,
          actualWeight: values.status === "completed" ? values.weight : null,
          actualReps: values.status === "completed" ? values.reps : null,
          actualDurationSec:
            values.status === "completed" ? values.duration : null,
          actualRir: values.status === "completed" ? values.rir : null,
          actualRestSec: values.status === "completed" ? values.rest : null,
          notes: values.notes,
        }),
      },
    );
    setEditing(null);
    setSaved("Set updated");
    await load();
  }

  function toggleExercise(exerciseId: string) {
    setExpandedExerciseIds((current) => {
      const next = new Set(current);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  }

  if (loading && !data) return <LoadingView label="Loading workout review…" />;
  if (!data) {
    return (
      <Screen>
        <Pressable accessibilityRole="link" onPress={() => router.back()}>
          <Text style={styles.back}>← History</Text>
        </Pressable>
        <Message>{error || "Workout not found."}</Message>
      </Screen>
    );
  }

  const { workout, previousPerformanceByExercise } = data;
  const completedSets = workout.exercises.reduce(
    (count, exercise) =>
      count + exercise.sets.filter((set) => set.status === "completed").length,
    0,
  );
  const skippedSets = workout.exercises.reduce(
    (count, exercise) =>
      count + exercise.sets.filter((set) => set.status === "skipped").length,
    0,
  );
  const totalSets = workout.exercises.reduce(
    (count, exercise) => count + exercise.sets.length,
    0,
  );
  const timing = summarizeWorkoutTiming(workout);

  return (
    <Screen>
      <View style={styles.topline}>
        <Pressable accessibilityRole="link" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>← History</Text>
        </Pressable>
        <StatusBadge status={workout.status} />
      </View>
      <View style={styles.header}>
        <Eyebrow>Routine {workout.routineCode}</Eyebrow>
        <Heading>Workout review</Heading>
        <Body muted>{formatHistoryDateTime(workout.startedAt)}</Body>
      </View>

      {error ? <Message>{error}</Message> : null}
      {saved ? <Message tone="success">{saved}</Message> : null}

      <Card style={styles.summaryCard}>
        <View style={styles.summaryStats}>
          <SummaryStat
            value={formatElapsedDuration(timing.elapsedSeconds)}
            label="Total elapsed"
          />
          <SummaryStat value={`${completedSets}/${totalSets}`} label="Completed sets" />
          <SummaryStat value={String(skippedSets)} label="Skipped" />
          <SummaryStat value={String(workout.exercises.length)} label="Exercises" />
        </View>
      </Card>

      <View style={styles.sectionHeading}>
        <Eyebrow>Performance</Eyebrow>
        {loading ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
      </View>

      {workout.exercises.map((exercise) => {
        const previous = previousPerformanceByExercise[exercise.position];
        const expanded = expandedExerciseIds.has(exercise.id);
        const exerciseCompletedSets = exercise.sets.filter(
          (set) => set.status === "completed",
        ).length;
        const exerciseTiming = timing.exercises.find((item) => item.id === exercise.id);
        const exerciseElapsed = exerciseTiming?.elapsedSeconds === null ||
          exerciseTiming?.elapsedSeconds === undefined
          ? "Elapsed —"
          : `${formatElapsedDuration(exerciseTiming.elapsedSeconds)} elapsed`;
        return (
          <Card key={exercise.id} style={styles.exerciseCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${exercise.exerciseNameSnapshot}`}
              accessibilityState={{ expanded }}
              onPress={() => toggleExercise(exercise.id)}
              style={({ pressed }) => [
                styles.exerciseHeader,
                pressed && styles.exerciseHeaderPressed,
              ]}
            >
              <View style={styles.exerciseOrder}>
                <Text style={styles.exerciseOrderText}>{exercise.position}</Text>
              </View>
              <View style={styles.exerciseCopy}>
                <Heading size="small">{exercise.exerciseNameSnapshot}</Heading>
                <Body muted>
                  {exerciseCompletedSets}/{exercise.sets.length} sets completed · {exerciseElapsed}
                </Body>
              </View>
              <View style={[
                styles.expander,
                expanded && styles.expanderExpanded,
              ]}>
                <Text style={[
                  styles.expanderText,
                  expanded && styles.expanderTextExpanded,
                ]}>
                  {expanded ? "⌄" : "›"}
                </Text>
              </View>
            </Pressable>
            {expanded ? (
              <View style={styles.setList}>
                {exercise.sets.map((set, index) => {
                  const setTiming = exerciseTiming?.sets.find((item) => item.id === set.id);
                  const elapsed = setTiming?.elapsedSeconds === null ||
                    setTiming?.elapsedSeconds === undefined
                    ? "Elapsed —"
                    : `${formatElapsedDuration(setTiming.elapsedSeconds)} elapsed`;
                  const rest = set.status === "skipped" || set.actualRestSec === null
                    ? "Rest —"
                    : `Rest ${formatElapsedDuration(set.actualRestSec)}`;
                  return (
                    <Pressable
                      key={set.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${exercise.exerciseNameSnapshot} set ${index + 1}, ${elapsed}, ${rest}`}
                      onPress={() => setEditing({
                        set,
                        exerciseName: exercise.exerciseNameSnapshot,
                        loadType: exercise.loadTypeSnapshot,
                      })}
                      style={({ pressed }) => [
                        styles.setRow,
                        pressed && styles.setRowPressed,
                      ]}
                    >
                      <View style={styles.setNumber}>
                        <Text style={styles.setNumberText}>{index + 1}</Text>
                      </View>
                      <View style={styles.setCopy}>
                        <View style={styles.setTopline}>
                          <Text style={styles.setResult}>
                            {formatSetResult(set, exercise.loadTypeSnapshot)}
                          </Text>
                          <Text style={styles.setRest}>{elapsed}</Text>
                        </View>
                        <Text numberOfLines={1} style={styles.setTarget}>
                          Target {set.plannedTargetDisplay} · {set.setType} · {rest}
                        </Text>
                        <Text numberOfLines={1} style={styles.setPrevious}>
                          Previous: {formatPreviousSetPerformance(previous?.sets[index])}
                        </Text>
                      </View>
                      <Text style={styles.edit}>Edit</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </Card>
        );
      })}

      <Card>
        <Eyebrow>Session notes</Eyebrow>
        <Field
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="How did the workout feel?"
          multiline
          textAlignVertical="top"
        />
        <Button
          title={savingNotes ? "Saving…" : "Save notes"}
          variant="secondary"
          loading={savingNotes}
          disabled={notes === workout.notes}
          onPress={() => void saveNotes()}
        />
      </Card>

      <Button
        title={`Repeat Routine ${workout.routineCode} →`}
        onPress={() => router.push(`/routines/${workout.routineCode}`)}
      />

      <SetEditModal
        editable={editing}
        onClose={() => setEditing(null)}
        onSave={saveSet}
      />
    </Screen>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.summaryStat}>
      <Text numberOfLines={1} style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: Workout["status"] }) {
  return (
    <View style={[
      styles.status,
      status === "Partial" && styles.statusPartial,
      status === "Abandoned" && styles.statusAbandoned,
    ]}>
      <Text style={[
        styles.statusText,
        status === "Partial" && styles.statusTextPartial,
        status === "Abandoned" && styles.statusTextAbandoned,
      ]}>
        {historyStatusLabel(status)}
      </Text>
    </View>
  );
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function SetEditModal({
  editable,
  onClose,
  onSave,
}: {
  editable: EditableSet | null;
  onClose: () => void;
  onSave: (
    set: WorkoutSet,
    values: {
      status: "completed" | "skipped";
      weight: number | null;
      reps: number | null;
      duration: number | null;
      rir: number | null;
      rest: number | null;
      notes: string;
    },
  ) => Promise<void>;
}) {
  const set = editable?.set;
  const [status, setStatus] = useState<"completed" | "skipped">("completed");
  const [weight, setWeight] = useState("");
  const [result, setResult] = useState("");
  const [rir, setRir] = useState("");
  const [rest, setRest] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!set) return;
    setStatus(set.status === "skipped" ? "skipped" : "completed");
    setWeight(set.actualWeight === null ? "" : String(set.actualWeight));
    setResult(String(
      set.plannedTargetType === "duration"
        ? set.actualDurationSec ?? ""
        : set.actualReps ?? "",
    ));
    setRir(set.actualRir === null ? "" : String(set.actualRir));
    setRest(set.actualRestSec === null ? "" : String(set.actualRestSec));
    setNotes(set.notes);
    setError("");
  }, [set]);

  async function save() {
    if (!set || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(set, {
        status,
        weight: numberOrNull(weight),
        reps: set.plannedTargetType === "duration" ? null : numberOrNull(result),
        duration: set.plannedTargetType === "duration" ? numberOrNull(result) : null,
        rir: numberOrNull(rir),
        rest: numberOrNull(rest),
        notes,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Set could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={Boolean(editable)}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close set editor"
          disabled={saving}
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.editSheet}>
          <View style={styles.editHeader}>
            <View style={styles.editHeaderCopy}>
              <Eyebrow>Edit set</Eyebrow>
              <Heading size="medium">{editable?.exerciseName}</Heading>
              <Body muted>{set?.plannedTargetDisplay}</Body>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close set editor"
              disabled={saving}
              onPress={onClose}
              hitSlop={10}
              style={styles.close}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.editFields}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.statusChoice}>
              {(["completed", "skipped"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: status === value }}
                  onPress={() => setStatus(value)}
                  style={[
                    styles.statusChoiceButton,
                    status === value && styles.statusChoiceButtonSelected,
                  ]}
                >
                  <Text style={[
                    styles.statusChoiceText,
                    status === value && styles.statusChoiceTextSelected,
                  ]}>
                    {value === "completed" ? "Completed" : "Skipped"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {error ? <Message>{error}</Message> : null}
            <StepperField
              label="Weight (lb)"
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              placeholder="0"
              editable={status === "completed"}
            />
            <StepperField
              label={set?.plannedTargetType === "duration" ? "Seconds" : "Reps"}
              value={result}
              onChangeText={setResult}
              keyboardType="number-pad"
              placeholder="0"
              editable={status === "completed"}
            />
            <StepperField
              label="Actual RIR"
              value={rir}
              onChangeText={setRir}
              keyboardType="decimal-pad"
              placeholder="Optional"
              editable={status === "completed"}
            />
            <StepperField
              label="Rest taken (sec)"
              value={rest}
              onChangeText={setRest}
              keyboardType="number-pad"
              placeholder="Optional"
              editable={status === "completed"}
            />
            <Field
              label="Set notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional"
            />
            <Button
              title={saving ? "Saving…" : "Save changes"}
              loading={saving}
              onPress={() => void save()}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  back: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  header: { gap: spacing.sm },
  status: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.successSurface,
  },
  statusPartial: { backgroundColor: colors.warningSurface },
  statusAbandoned: { backgroundColor: colors.dangerSurface },
  statusText: { color: colors.success, fontSize: 10, fontWeight: "800" },
  statusTextPartial: { color: colors.warning },
  statusTextAbandoned: { color: colors.danger },
  summaryCard: { backgroundColor: colors.surfaceRaised },
  summaryStats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryStat: {
    flexGrow: 1,
    flexBasis: 120,
    minWidth: 0,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  summaryLabel: { color: colors.textDim, fontSize: 10 },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  refreshing: { color: colors.textDim, fontSize: 11 },
  exerciseCard: { padding: 0, overflow: "hidden", gap: 0 },
  exerciseHeader: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  exerciseHeaderPressed: { opacity: 0.76 },
  exerciseOrder: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.accentDark,
  },
  exerciseOrderText: { color: colors.accent, fontSize: 12, fontWeight: "900" },
  exerciseCopy: { flex: 1, minWidth: 0 },
  expander: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  expanderExpanded: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  expanderText: {
    color: colors.textMuted,
    fontSize: 23,
    lineHeight: 25,
    fontWeight: "600",
  },
  expanderTextExpanded: { color: colors.accent },
  setList: { gap: 0 },
  setRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  setRowPressed: { backgroundColor: colors.surfaceRaised },
  setNumber: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  setNumberText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  setCopy: { flex: 1, minWidth: 0, gap: 3 },
  setTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  setResult: { color: colors.text, fontSize: 13, fontWeight: "800" },
  setRest: { color: colors.textMuted, fontSize: 10 },
  setTarget: { color: colors.textMuted, fontSize: 10 },
  setPrevious: { color: colors.textDim, fontSize: 10 },
  edit: { color: colors.accent, fontSize: 10, fontWeight: "800" },
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
  editSheet: {
    width: "100%",
    maxWidth: 680,
    maxHeight: "94%",
    padding: spacing.xl,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    gap: spacing.lg,
  },
  editHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  editHeaderCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  close: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  closeText: { color: colors.text, fontSize: 25, lineHeight: 27 },
  editFields: { gap: spacing.md, paddingBottom: spacing.sm },
  statusChoice: { flexDirection: "row", gap: spacing.sm },
  statusChoiceButton: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  statusChoiceButtonSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  statusChoiceText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  statusChoiceTextSelected: { color: colors.accent },
});
