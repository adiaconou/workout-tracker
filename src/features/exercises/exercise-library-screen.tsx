import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
  const { width } = useWindowDimensions();
  const compactLayout = width < 720;
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [savingFavoriteIds, setSavingFavoriteIds] = useState<Set<string>>(
    () => new Set(),
  );

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
  const favoriteCount = useMemo(
    () => exercises.filter((exercise) => exercise.isFavorite).length,
    [exercises],
  );

  async function toggleFavorite(exercise: Exercise) {
    if (savingFavoriteIds.has(exercise.id)) return;
    const nextFavorite = !exercise.isFavorite;
    setFavoriteError("");
    setSavingFavoriteIds((current) => new Set(current).add(exercise.id));
    setExercises((current) => current.map((item) => (
      item.id === exercise.id ? { ...item, isFavorite: nextFavorite } : item
    )));
    try {
      const payload = await apiRequest<{ exercise: Exercise }>(
        `/api/v1/exercises/${encodeURIComponent(exercise.id)}/favorite`,
        { method: nextFavorite ? "PUT" : "DELETE" },
      );
      setExercises((current) => current.map((item) => (
        item.id === exercise.id ? payload.exercise : item
      )));
    } catch (caught) {
      setExercises((current) => current.map((item) => (
        item.id === exercise.id ? exercise : item
      )));
      setFavoriteError(
        caught instanceof Error ? caught.message : "Favorite could not be saved.",
      );
    } finally {
      setSavingFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(exercise.id);
        return next;
      });
    }
  }

  if (loading && !exercises.length) return <LoadingView label="Loading exercise library…" />;

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Eyebrow>Movement catalog</Eyebrow>
          <Heading>Exercise Library</Heading>
        </View>
        <Text style={styles.total}>
          {exercises.length} total · {favoriteCount} favorite{favoriteCount === 1 ? "" : "s"}
        </Text>
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
        <>
          {favoriteError ? <Message>{favoriteError}</Message> : null}
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.headerCell, styles.favoriteCell]}>Fav</Text>
              <Text style={[styles.headerCell, styles.indexCell]}>#</Text>
              <Text style={[styles.headerCell, styles.nameCell]}>Exercise</Text>
              {!compactLayout ? (
                <>
                  <Text style={[styles.headerCell, styles.movementCell]}>Movement</Text>
                  <Text style={[styles.headerCell, styles.muscleCell]}>Primary muscles</Text>
                </>
              ) : null}
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
              renderItem={({ item, index }) => {
                const savingFavorite = savingFavoriteIds.has(item.id);
                return (
                  <View style={styles.row}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${item.isFavorite ? "Remove" : "Add"} ${item.name} ${item.isFavorite ? "from" : "to"} favorites`}
                      accessibilityState={{
                        selected: item.isFavorite,
                        disabled: savingFavorite,
                      }}
                      disabled={savingFavorite}
                      onPress={() => void toggleFavorite(item)}
                      style={({ pressed }) => [
                        styles.favoriteButton,
                        pressed && styles.favoriteButtonPressed,
                        savingFavorite && styles.favoriteButtonDisabled,
                      ]}
                    >
                      <Text style={[
                        styles.favoriteIcon,
                        item.isFavorite && styles.favoriteIconSelected,
                      ]}>
                        {item.isFavorite ? "★" : "☆"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${item.name}`}
                      onPress={() => router.push(`/exercises/${encodeURIComponent(item.id)}`)}
                      style={({ pressed }) => [
                        styles.rowLink,
                        pressed && styles.rowPressed,
                      ]}
                    >
                      <Text style={[styles.index, styles.indexCell]}>{String(index + 1).padStart(2, "0")}</Text>
                      <View style={[
                        styles.nameCell,
                        compactLayout && styles.nameCellCompact,
                      ]}>
                        <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
                        <Text numberOfLines={1} style={styles.equipment}>
                          {compactLayout
                            ? `${label(item.equipment)} · ${label(item.movementPattern)} · ${primaryMuscles(item) || "Not tagged"}`
                            : label(item.equipment)}
                        </Text>
                      </View>
                      {!compactLayout ? (
                        <>
                          <Text numberOfLines={1} style={[styles.value, styles.movementCell]}>{label(item.movementPattern)}</Text>
                          <Text numberOfLines={1} style={[styles.value, styles.muscleCell]}>
                            {primaryMuscles(item) || "Not tagged"}
                          </Text>
                        </>
                      ) : null}
                      <Text style={styles.arrow}>→</Text>
                    </Pressable>
                  </View>
                );
              }}
            />
          </View>
        </>
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
  tableHeader: { minHeight: 28, flexDirection: "row", alignItems: "center", paddingRight: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  headerCell: { color: colors.textDim, fontSize: 9, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  row: { minHeight: 46, flexDirection: "row", alignItems: "stretch", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLink: { minHeight: 46, flex: 1, flexDirection: "row", alignItems: "center", paddingRight: spacing.sm, paddingVertical: 5, gap: spacing.sm },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  favoriteCell: { width: 46, textAlign: "center" },
  favoriteButton: { width: 46, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
  favoriteButtonPressed: { backgroundColor: colors.surfaceRaised },
  favoriteButtonDisabled: { opacity: 0.55 },
  favoriteIcon: { color: colors.textDim, fontSize: 20, lineHeight: 22 },
  favoriteIconSelected: { color: colors.warning },
  indexCell: { width: 24 },
  nameCell: { flex: 2.1, minWidth: 130 },
  nameCellCompact: { minWidth: 0 },
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
