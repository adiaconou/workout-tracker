import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { apiRequest } from "../../api/client";
import type { Exercise } from "../../api/types";
import {
  Body,
  Button,
  Eyebrow,
  Heading,
  LoadingView,
  Message,
  Screen,
} from "../../components/ui";
import { colors, maxContentWidth, radii, spacing } from "../../theme/tokens";

export function ExerciseLibraryScreen() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ exercises: Exercise[] }>("/api/v1/exercises");
      setExercises(payload.exercises);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Exercises could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () => normalizedQuery
      ? exercises.filter((exercise) => searchableText(exercise).includes(normalizedQuery))
      : exercises,
    [exercises, normalizedQuery],
  );

  if (loading && !exercises.length) return <LoadingView label="Loading exercise library…" />;

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Eyebrow>Movement catalog</Eyebrow>
          <Heading>Exercise Library</Heading>
        </View>
        <Text style={styles.total}>{exercises.length} total</Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          accessibilityLabel="Filter exercises"
          value={query}
          onChangeText={setQuery}
          placeholder="Filter by exercise, equipment, or muscle"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={styles.search}
        />
        {query ? (
          <Pressable accessibilityRole="button" onPress={() => setQuery("")}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
        <Text style={styles.count}>{filtered.length}</Text>
      </View>

      {error ? (
        <>
          <Message>{error}</Message>
          <Button title="Try again" variant="secondary" onPress={() => void load()} />
        </>
      ) : (
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerCell, styles.indexCell]}>#</Text>
            <Text style={[styles.headerCell, styles.nameCell]}>Exercise</Text>
            <Text style={[styles.headerCell, styles.movementCell]}>Movement</Text>
            <Text style={[styles.headerCell, styles.muscleCell]}>Primary muscles</Text>
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={!filtered.length ? styles.emptyList : undefined}
            ListEmptyComponent={(
              <View style={styles.empty}>
                <Body>No exercises match “{query}”.</Body>
                <Button title="Clear filter" compact variant="secondary" onPress={() => setQuery("")} />
              </View>
            )}
            renderItem={({ item, index }) => (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${item.name}`}
                onPress={() => router.push(`/exercises/${encodeURIComponent(item.id)}`)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text style={[styles.index, styles.indexCell]}>{String(index + 1).padStart(2, "0")}</Text>
                <View style={styles.nameCell}>
                  <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
                  <Text numberOfLines={1} style={styles.equipment}>{label(item.equipment)}</Text>
                </View>
                <Text numberOfLines={1} style={[styles.value, styles.movementCell]}>{label(item.movementPattern)}</Text>
                <Text numberOfLines={1} style={[styles.value, styles.muscleCell]}>
                  {primaryMuscles(item) || "Not tagged"}
                </Text>
                <Text style={styles.arrow}>→</Text>
              </Pressable>
            )}
          />
        </View>
      )}
    </Screen>
  );
}

function searchableText(exercise: Exercise) {
  return [
    exercise.name,
    exercise.equipment,
    exercise.movementPattern,
    exercise.trackingType,
    exercise.defaultLoadType,
    exercise.sideMode,
    ...exercise.muscles.map((muscle) => muscle.muscleGroup),
  ].join(" ").replaceAll("_", " ").toLowerCase();
}

function label(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function primaryMuscles(exercise: Exercise) {
  const primary = exercise.muscles.filter((muscle) => muscle.role === "primary");
  return (primary.length ? primary : exercise.muscles)
    .slice(0, 3)
    .map((muscle) => label(muscle.muscleGroup))
    .join(", ");
}

const styles = StyleSheet.create({
  screen: { flex: 1, maxWidth: maxContentWidth, paddingBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md },
  total: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  searchWrap: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  search: { flex: 1, color: colors.text, paddingVertical: spacing.sm, fontSize: 14, outlineStyle: "none" } as never,
  clear: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  count: { minWidth: 24, color: colors.textDim, fontSize: 11, textAlign: "right", fontVariant: ["tabular-nums"] },
  table: { flex: 1, minHeight: 240, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface },
  tableHeader: { minHeight: 28, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  headerCell: { color: colors.textDim, fontSize: 9, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  row: { minHeight: 46, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.sm },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  indexCell: { width: 24 },
  nameCell: { flex: 2.1, minWidth: 130 },
  movementCell: { flex: 1.1, minWidth: 80 },
  muscleCell: { flex: 1.3, minWidth: 100 },
  index: { color: colors.textDim, fontSize: 9, fontVariant: ["tabular-nums"] },
  name: { color: colors.text, fontSize: 12, lineHeight: 15, fontWeight: "700" },
  equipment: { color: colors.textDim, fontSize: 9, lineHeight: 12 },
  value: { color: colors.textMuted, fontSize: 10 },
  arrow: { color: colors.textDim, fontSize: 13 },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.md },
});
