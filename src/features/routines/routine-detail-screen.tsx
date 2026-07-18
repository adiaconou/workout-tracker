import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { apiRequest } from "../../api/client";
import type { Routine } from "../../api/types";
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
} from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";

type StartResponse = {
  created: boolean;
  requiresConfirmation: boolean;
  session: { id: string; routineCode: string };
};

function cloneRoutine(value: Routine) {
  return JSON.parse(JSON.stringify(value)) as Routine;
}

export function RoutineDetailScreen({ routineId }: { routineId: string }) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [draft, setDraft] = useState<Routine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeRoutineCode, setActiveRoutineCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ routine: Routine }>(
        `/api/v1/routines/${encodeURIComponent(routineId)}/prescription`,
      );
      setRoutine(payload.routine);
      setDraft(cloneRoutine(payload.routine));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Routine could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [routineId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalSets = useMemo(
    () => routine?.exercises.reduce(
      (sum, exercise) =>
        sum +
        exercise.warmupSets +
        exercise.regularSets +
        exercise.failureSets +
        exercise.dropSets,
      0,
    ) ?? 0,
    [routine],
  );

  async function startWorkout(abandonActive = false) {
    if (!routine) return;
    setStarting(true);
    setError("");
    try {
      const payload = await apiRequest<StartResponse>("/api/v1/workouts", {
        method: "POST",
        body: JSON.stringify({ routineId: routine.code, abandonActive }),
      });
      if (payload.requiresConfirmation) {
        setActiveRoutineCode(payload.session.routineCode);
        return;
      }
      setActiveRoutineCode(null);
      router.replace(`/workouts/${payload.session.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workout could not be started.");
    } finally {
      setStarting(false);
    }
  }

  async function save() {
    if (!draft || !routine) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await apiRequest<{ routine: Routine }>(
        `/api/v1/routines/${encodeURIComponent(routine.code)}/prescription`,
        { method: "PATCH", body: JSON.stringify(draft) },
      );
      setRoutine(payload.routine);
      setDraft(cloneRoutine(payload.routine));
      setEditing(false);
      setMessage(`Routine ${payload.routine.code} saved as version ${payload.routine.version}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The routine could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function updateRoutine(
    field: "focus" | "summary" | "durationMin",
    value: string | number,
  ) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  function updateExercise(
    index: number,
    field: keyof Routine["exercises"][number],
    value: string | number,
  ) {
    setDraft((current) => current ? {
      ...current,
      exercises: current.exercises.map((exercise, exerciseIndex) =>
        exerciseIndex === index ? { ...exercise, [field]: value } : exercise
      ),
    } : current);
  }

  if (loading) return <LoadingView label={`Loading Routine ${routineId}…`} />;
  if (!routine || !draft) {
    return (
      <Screen>
        <Message>{error || "Routine not found."}</Message>
        <Button title="Back to routines" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Pressable accessibilityRole="link" onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.back}>← All routines</Text>
      </Pressable>

      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Eyebrow>Routine {routine.code} · Version {routine.version}</Eyebrow>
            {editing ? (
              <>
                <Field
                  label="Routine name"
                  value={draft.focus}
                  onChangeText={(value) => updateRoutine("focus", value)}
                />
                <Field
                  label="Summary"
                  value={draft.summary}
                  multiline
                  onChangeText={(value) => updateRoutine("summary", value)}
                />
                <Field
                  label="Estimated minutes"
                  keyboardType="number-pad"
                  value={String(draft.durationMin)}
                  onChangeText={(value) => updateRoutine("durationMin", Number(value) || 0)}
                />
              </>
            ) : (
              <>
                <Heading>{routine.focus}</Heading>
                <Body muted>{routine.summary}</Body>
              </>
            )}
          </View>
          {!editing ? (
            <View style={styles.stats}>
              <Text style={styles.statStrong}>{routine.exercises.length}</Text>
              <Text style={styles.statLabel}>exercises</Text>
              <Text style={styles.statStrong}>{totalSets}</Text>
              <Text style={styles.statLabel}>sets</Text>
              <Text style={styles.statStrong}>{routine.durationMin}</Text>
              <Text style={styles.statLabel}>min</Text>
            </View>
          ) : null}
        </View>
        <Button
          title={starting ? "Creating workout…" : "Start workout →"}
          loading={starting}
          disabled={editing}
          onPress={() => void startWorkout()}
        />
        <Body muted style={styles.snapshotNote}>
          Starting creates a durable workout instance from version {routine.version}.
        </Body>
      </Card>

      {message ? <Message tone="success">{message}</Message> : null}
      {error ? <Message>{error}</Message> : null}

      <View style={styles.sectionHeading}>
        <View>
          <Eyebrow>Prescription</Eyebrow>
          <Heading size="medium">Exercises</Heading>
        </View>
        {editing ? (
          <View style={styles.inlineActions}>
            <Button
              title="Cancel"
              compact
              variant="ghost"
              disabled={saving}
              onPress={() => {
                setDraft(cloneRoutine(routine));
                setEditing(false);
              }}
            />
            <Button title="Save" compact loading={saving} onPress={() => void save()} />
          </View>
        ) : (
          <Button
            title="Edit routine"
            compact
            variant="secondary"
            onPress={() => {
              setMessage("");
              setEditing(true);
            }}
          />
        )}
      </View>

      {(editing ? draft : routine).exercises.map((exercise, index) => (
        <Card key={exercise.id}>
          <View style={styles.exerciseTitle}>
            <View style={styles.order}>
              <Text style={styles.orderText}>{String(index + 1).padStart(2, "0")}</Text>
            </View>
            <View style={styles.exerciseTitleCopy}>
              <Heading size="small">{exercise.name}</Heading>
              {!editing ? <Body muted>{exercise.purpose}</Body> : null}
            </View>
          </View>

          {editing ? (
            <View style={styles.editGrid}>
              <Field
                label="Exercise name"
                value={exercise.name}
                onChangeText={(value) => updateExercise(index, "name", value)}
              />
              <View style={styles.countRow}>
                {([
                  ["warmupSets", "Warm-up"],
                  ["regularSets", "Regular"],
                  ["failureSets", "Failure"],
                  ["dropSets", "Drop"],
                ] as const).map(([field, label]) => (
                  <View style={styles.countField} key={field}>
                    <Field
                      label={label}
                      keyboardType="number-pad"
                      value={String(exercise[field])}
                      onChangeText={(value) => updateExercise(index, field, Number(value) || 0)}
                    />
                  </View>
                ))}
              </View>
              <Field
                label="Warm-up prescription"
                value={exercise.warmup}
                onChangeText={(value) => updateExercise(index, "warmup", value)}
              />
              <Field label="Target" value={exercise.target} onChangeText={(value) => updateExercise(index, "target", value)} />
              <Field label="Rest" value={exercise.rest} onChangeText={(value) => updateExercise(index, "rest", value)} />
              <Field label="Effort" value={exercise.effort} onChangeText={(value) => updateExercise(index, "effort", value)} />
              <Field
                label="Why it is included"
                value={exercise.purpose}
                multiline
                onChangeText={(value) => updateExercise(index, "purpose", value)}
              />
            </View>
          ) : (
            <View style={styles.facts}>
              <Fact label="Sets" value={setSummary(exercise)} />
              <Fact label="Target" value={exercise.target} />
              <Fact label="Rest" value={exercise.rest} />
              <Fact label="Effort" value={exercise.effort} />
              <Fact label="Warm-up" value={exercise.warmup} />
            </View>
          )}
        </Card>
      ))}

      <Body muted style={styles.safety}>
        Stop or modify an exercise if pain develops. Routine edits affect future workouts only;
        started workouts keep their original snapshot.
      </Body>

      <Modal
        transparent
        animationType="fade"
        visible={Boolean(activeRoutineCode)}
        onRequestClose={() => setActiveRoutineCode(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.dialog}>
            <Eyebrow>Workout in progress</Eyebrow>
            <Heading size="medium">Abandon Routine {activeRoutineCode}?</Heading>
            <Body muted>
              Starting Routine {routine.code} will mark Routine {activeRoutineCode} as abandoned.
              Sets already logged stay in history.
            </Body>
            <Button
              title={`Keep Routine ${activeRoutineCode}`}
              variant="secondary"
              disabled={starting}
              onPress={() => setActiveRoutineCode(null)}
            />
            <Button
              title={`Abandon and start Routine ${routine.code}`}
              variant="danger"
              loading={starting}
              onPress={() => void startWorkout(true)}
            />
          </Card>
        </View>
      </Modal>
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

function setSummary(exercise: Routine["exercises"][number]) {
  return [
    exercise.warmupSets ? `${exercise.warmupSets} warm-up` : null,
    exercise.regularSets ? `${exercise.regularSets} regular` : null,
    exercise.failureSets ? `${exercise.failureSets} failure` : null,
    exercise.dropSets ? `${exercise.dropSets} drop` : null,
  ].filter(Boolean).join(" · ");
}

const styles = StyleSheet.create({
  back: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  hero: { backgroundColor: colors.surfaceRaised, gap: spacing.lg },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xl },
  heroCopy: { flex: 1, gap: spacing.md },
  stats: { alignItems: "flex-end" },
  statStrong: { color: colors.text, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.textDim, fontSize: 10, textTransform: "uppercase", marginBottom: spacing.sm },
  snapshotNote: { fontSize: 12, textAlign: "center" },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  inlineActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  exerciseTitle: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  order: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, backgroundColor: colors.accentDark },
  orderText: { color: colors.accent, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  exerciseTitleCopy: { flex: 1, gap: spacing.xs },
  facts: { gap: 0 },
  fact: { flexDirection: "row", gap: spacing.lg, paddingVertical: spacing.sm, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  factLabel: { width: 72, color: colors.textDim, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  factValue: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  editGrid: { gap: spacing.md },
  countRow: { flexDirection: "row", gap: spacing.sm },
  countField: { flex: 1, minWidth: 70 },
  safety: { fontSize: 12, lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  dialog: { width: "100%", maxWidth: 480, borderColor: colors.borderStrong, padding: spacing.xl },
});
