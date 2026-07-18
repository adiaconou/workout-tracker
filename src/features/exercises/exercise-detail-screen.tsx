import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { RoutineAggregate } from "../../../domain/entities";
import { apiRequest } from "../../api/client";
import type { Exercise } from "../../api/types";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Heading,
  LoadingView,
  Message,
  RowLink,
  Screen,
} from "../../components/ui";
import { colors, spacing } from "../../theme/tokens";

export function ExerciseDetailScreen({ exerciseId }: { exerciseId: string }) {
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [usedIn, setUsedIn] = useState<RoutineAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [exercisePayload, routinePayload] = await Promise.all([
        apiRequest<{ exercise: Exercise }>(`/api/v1/exercises/${encodeURIComponent(exerciseId)}`),
        apiRequest<{ routines: RoutineAggregate[] }>("/api/v1/routines"),
      ]);
      setExercise(exercisePayload.exercise);
      setUsedIn(routinePayload.routines.filter(
        (routine) => routine.currentVersion?.exercises.some(
          (item) => item.exerciseId === exercisePayload.exercise.id,
        ),
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Exercise could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [exerciseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingView label="Loading exercise…" />;
  if (!exercise) {
    return (
      <Screen>
        <Message>{error || "Exercise not found."}</Message>
        <Button title="Back to library" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Pressable accessibilityRole="link" onPress={() => router.back()}>
        <Text style={styles.back}>← Exercise Library</Text>
      </Pressable>

      <View style={styles.title}>
        <View style={styles.titleCopy}>
          <Eyebrow>Exercise</Eyebrow>
          <Heading>{exercise.name}</Heading>
        </View>
        <Text style={styles.active}>Active</Text>
      </View>

      <Card style={styles.factGrid}>
        <Fact label="Equipment" value={label(exercise.equipment)} />
        <Fact label="Movement" value={label(exercise.movementPattern)} />
        <Fact label="Tracks" value={label(exercise.trackingType)} />
        <Fact label="Loading" value={label(exercise.defaultLoadType)} />
        <Fact label="Side mode" value={label(exercise.sideMode)} />
      </Card>

      <Card>
        <Eyebrow>Training effect</Eyebrow>
        <Heading size="medium">Muscle groups</Heading>
        {exercise.muscles.length ? exercise.muscles.map((muscle) => (
          <View style={styles.muscleRow} key={muscle.muscleGroup}>
            <Text style={styles.muscleName}>{label(muscle.muscleGroup)}</Text>
            <Text style={styles.muscleRole}>{label(muscle.role)}</Text>
          </View>
        )) : <Body muted>No muscle groups have been tagged.</Body>}
      </Card>

      <Card style={styles.linksCard}>
        <View style={styles.cardHeading}>
          <View>
            <Eyebrow>Program usage</Eyebrow>
            <Heading size="medium">Used in routines</Heading>
          </View>
          <Text style={styles.count}>{usedIn.length}</Text>
        </View>
        {usedIn.length ? usedIn.map((routine) => (
          <RowLink
            key={routine.id}
            label={`Open Routine ${routine.code}`}
            onPress={() => router.push(`/routines/${routine.code}`)}
          >
            <View style={styles.linkCopy}>
              <Text style={styles.routineCode}>Routine {routine.code}</Text>
              <Text style={styles.routineName}>{routine.currentVersion?.focus}</Text>
            </View>
          </RowLink>
        )) : <Body muted>This exercise is not used in an active routine.</Body>}
      </Card>

      <Card>
        <Eyebrow>Notes</Eyebrow>
        <Heading size="medium">Instructions</Heading>
        <Body muted>{exercise.instructions || "No exercise-level instructions have been added yet."}</Body>
      </Card>
    </Screen>
  );
}

function Fact({ label: factLabel, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{factLabel}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function label(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

const styles = StyleSheet.create({
  back: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  title: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  titleCopy: { flex: 1, gap: spacing.sm },
  active: { color: colors.success, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  factGrid: { flexDirection: "row", flexWrap: "wrap" },
  fact: { flexGrow: 1, flexBasis: 130, gap: spacing.xs, paddingVertical: spacing.sm },
  factLabel: { color: colors.textDim, fontSize: 9, textTransform: "uppercase", fontWeight: "800" },
  factValue: { color: colors.text, fontSize: 13, fontWeight: "700" },
  muscleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: spacing.sm },
  muscleName: { color: colors.text, fontSize: 13, fontWeight: "700" },
  muscleRole: { color: colors.textMuted, fontSize: 11 },
  linksCard: { paddingHorizontal: 0 },
  cardHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg },
  count: { color: colors.textDim, fontSize: 12, fontWeight: "800" },
  linkCopy: { flex: 1, gap: 2 },
  routineCode: { color: colors.accent, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  routineName: { color: colors.text, fontSize: 13, fontWeight: "700" },
});
