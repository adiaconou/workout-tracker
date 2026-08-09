import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { RoutineAggregate } from "../../domain/entities";
import { apiRequest } from "../api/client";
import type { Exercise } from "../../contracts/api";
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
} from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import { ExerciseProgressCard } from "./exercise-progress-card";

export function ExerciseDetailScreen({ exerciseId }: { exerciseId: string }) {
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [usedIn, setUsedIn] = useState<RoutineAggregate[]>([]);
  const [usageStatus, setUsageStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [loading, setLoading] = useState(true);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setExercise(null);
    setUsedIn([]);
    setUsageStatus(exerciseId ? "loading" : "idle");

    if (!exerciseId) {
      setLoading(false);
      setError("Exercise not found.");
      return () => {
        cancelled = true;
      };
    }

    const routineRequest = apiRequest<{ routines: RoutineAggregate[] }>("/api/v1/routines").then(
      (value) => ({ status: "fulfilled" as const, value }),
      () => ({ status: "rejected" as const }),
    );

    void (async () => {
      try {
        const exercisePayload = await apiRequest<{ exercise: Exercise }>(
          `/api/v1/exercises/${encodeURIComponent(exerciseId)}`,
        );
        if (cancelled) return;

        setExercise(exercisePayload.exercise);
        setLoading(false);

        const routineResult = await routineRequest;
        if (cancelled) return;

        if (routineResult.status === "rejected") {
          setUsageStatus("error");
          return;
        }

        setUsedIn(routineResult.value.routines.filter(
          (routine) => routine.currentVersion?.exercises.some(
            (item) => item.exerciseId === exercisePayload.exercise.id,
          ),
        ));
        setUsageStatus("loaded");
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Exercise could not be loaded.");
        setLoading(false);
        setUsageStatus("idle");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  async function toggleFavorite() {
    if (!exercise || savingFavorite) return;
    const previous = exercise;
    const nextFavorite = !exercise.isFavorite;
    setSavingFavorite(true);
    setError("");
    setExercise({ ...exercise, isFavorite: nextFavorite });
    try {
      const payload = await apiRequest<{ exercise: Exercise }>(
        `/api/v1/exercises/${encodeURIComponent(exercise.id)}/favorite`,
        { method: nextFavorite ? "PUT" : "DELETE" },
      );
      setExercise(payload.exercise);
    } catch (caught) {
      setExercise(previous);
      setError(
        caught instanceof Error ? caught.message : "Favorite could not be saved.",
      );
    } finally {
      setSavingFavorite(false);
    }
  }

  if (loading) return <LoadingView label="Loading exercise…" />;
  if (!exercise) {
    return (
      <Screen safeTop={false}>
        <Message>{error || "Exercise not found."}</Message>
        <Button title="Back to library" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen safeTop={false}>
      <Pressable accessibilityRole="link" onPress={() => router.back()}>
        <Text style={styles.back}>← Exercise Library</Text>
      </Pressable>

      <View style={styles.title}>
        <View style={styles.titleCopy}>
          <Eyebrow>Exercise</Eyebrow>
          <Heading>{exercise.name}</Heading>
        </View>
        <View style={styles.titleActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${exercise.isFavorite ? "Remove" : "Add"} ${exercise.name} ${exercise.isFavorite ? "from" : "to"} favorites`}
            accessibilityState={{
              selected: exercise.isFavorite,
              disabled: savingFavorite,
            }}
            disabled={savingFavorite}
            onPress={() => void toggleFavorite()}
            style={({ pressed }) => [
              styles.favoriteButton,
              exercise.isFavorite && styles.favoriteButtonSelected,
              pressed && styles.favoriteButtonPressed,
              savingFavorite && styles.favoriteButtonDisabled,
            ]}
          >
            <Text style={[
              styles.favoriteIcon,
              exercise.isFavorite && styles.favoriteIconSelected,
            ]}>
              {exercise.isFavorite ? "★" : "☆"}
            </Text>
          </Pressable>
          <Text style={styles.active}>Active</Text>
        </View>
      </View>

      {error ? <Message>{error}</Message> : null}

      <Card style={styles.factGrid}>
        <Fact label="Equipment" value={label(exercise.equipment)} />
        <Fact label="Movement" value={label(exercise.movementPattern)} />
        <Fact label="Tracks" value={label(exercise.trackingType)} />
        <Fact label="Loading" value={label(exercise.defaultLoadType)} />
        <Fact label="Side mode" value={label(exercise.sideMode)} />
      </Card>

      <ExerciseProgressCard exerciseId={exercise.id} exerciseName={exercise.name} />

      <Card>
        <Eyebrow>Training effect</Eyebrow>
        <Heading size="medium">Muscle groups</Heading>
        {exercise.muscles.length ? exercise.muscles.map((muscle) => (
          <View style={styles.muscleRow} key={muscle.muscleGroup}>
            <Text style={styles.muscleName}>{label(muscle.muscleGroup)}</Text>
            <Text style={styles.muscleRole}>{label(muscle.role)}</Text>
          </View>
        )) : (
          <View style={styles.missingMuscles}>
            <Body muted>
              This legacy exercise has no muscle tags, so muscle filtering and generated routines may skip it.
            </Body>
            <Button
              title="Ask Coach to add tags"
              compact
              variant="secondary"
              onPress={() => router.push("/coach")}
            />
          </View>
        )}
      </Card>

      <Card style={styles.linksCard}>
        <View style={styles.cardHeading}>
          <View>
            <Eyebrow>Program usage</Eyebrow>
            <Heading size="medium">Used in routines</Heading>
          </View>
          <Text style={styles.count}>{usageStatus === "loaded" ? usedIn.length : "-"}</Text>
        </View>
        {usageStatus === "loading" ? <Body muted>Loading routine usage...</Body>
          : usageStatus === "error" ? <Body muted>Routine usage could not be loaded.</Body>
          : usedIn.length ? usedIn.map((routine) => (
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
  titleActions: { alignItems: "center", gap: spacing.xs },
  favoriteButton: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, backgroundColor: colors.surface },
  favoriteButtonSelected: { borderColor: colors.warning, backgroundColor: colors.warningSurface },
  favoriteButtonPressed: { opacity: 0.72 },
  favoriteButtonDisabled: { opacity: 0.55 },
  favoriteIcon: { color: colors.textDim, fontSize: 25, lineHeight: 28 },
  favoriteIconSelected: { color: colors.warning },
  active: { color: colors.success, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  factGrid: { flexDirection: "row", flexWrap: "wrap" },
  fact: { flexGrow: 1, flexBasis: 130, gap: spacing.xs, paddingVertical: spacing.sm },
  factLabel: { color: colors.textDim, fontSize: 9, textTransform: "uppercase", fontWeight: "800" },
  factValue: { color: colors.text, fontSize: 13, fontWeight: "700" },
  muscleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: spacing.sm },
  muscleName: { color: colors.text, fontSize: 13, fontWeight: "700" },
  muscleRole: { color: colors.textMuted, fontSize: 11 },
  missingMuscles: { alignItems: "flex-start", gap: spacing.sm, paddingTop: spacing.sm },
  linksCard: { paddingHorizontal: 0 },
  cardHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg },
  count: { color: colors.textDim, fontSize: 12, fontWeight: "800" },
  linkCopy: { flex: 1, gap: 2 },
  routineCode: { color: colors.accent, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  routineName: { color: colors.text, fontSize: 13, fontWeight: "700" },
});
