import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  muscleGroups,
  type Exercise,
  type MuscleGroup,
  type SideMode,
  type TrackingType,
} from "../../domain/entities";
import { Body, Button, Card, Eyebrow, Heading, LoadingView, Message } from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import {
  exerciseBodyAreaAliases,
  filterExerciseLibrary,
  type ExerciseLibraryFilters,
  type ExerciseLibraryMuscleRole,
} from "./exercise-library-filter";

const trackingTypes: TrackingType[] = ["reps", "duration", "rounds"];
const sideModes: SideMode[] = ["bilateral", "per_side", "per_leg", "left_right"];

export function ExerciseLibraryPicker({
  visible,
  title,
  exercises,
  existingExerciseIds,
  loading,
  error,
  onClose,
  onRetry,
  onAdd,
}: {
  visible: boolean;
  title: string;
  exercises: readonly Exercise[];
  existingExerciseIds: readonly string[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  onAdd: (exercises: Exercise[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedMuscles, setSelectedMuscles] = useState<MuscleGroup[]>([]);
  const [muscleRole, setMuscleRole] = useState<ExerciseLibraryMuscleRole>("any");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [movementPatterns, setMovementPatterns] = useState<string[]>([]);
  const [selectedTrackingTypes, setSelectedTrackingTypes] = useState<TrackingType[]>([]);
  const [selectedSideModes, setSelectedSideModes] = useState<SideMode[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setSelectedIds([]);
  }, [visible]);

  const equipmentOptions = useMemo(
    () => unique(exercises.map((exercise) => exercise.equipment)),
    [exercises],
  );
  const movementOptions = useMemo(
    () => unique(exercises.map((exercise) => exercise.movementPattern)),
    [exercises],
  );
  const activeFilterCount = selectedMuscles.length
    + equipment.length
    + movementPatterns.length
    + selectedTrackingTypes.length
    + selectedSideModes.length
    + Number(favoritesOnly)
    + Number(muscleRole !== "any");
  const filters: ExerciseLibraryFilters = {
    query,
    muscles: selectedMuscles,
    muscleRole,
    equipment,
    movementPatterns,
    trackingTypes: selectedTrackingTypes,
    sideModes: selectedSideModes,
    favoritesOnly,
  };
  const matches = useMemo(
    () => filterExerciseLibrary(exercises, filters),
    [
      exercises,
      query,
      selectedMuscles,
      muscleRole,
      equipment,
      movementPatterns,
      selectedTrackingTypes,
      selectedSideModes,
      favoritesOnly,
    ],
  );
  const existingCounts = useMemo(() => countValues(existingExerciseIds), [existingExerciseIds]);
  const selected = selectedIds
    .map((id) => exercises.find((exercise) => exercise.id === id))
    .filter((exercise): exercise is Exercise => Boolean(exercise));

  function clearFilters() {
    setQuery("");
    setSelectedMuscles([]);
    setMuscleRole("any");
    setEquipment([]);
    setMovementPatterns([]);
    setSelectedTrackingTypes([]);
    setSelectedSideModes([]);
    setFavoritesOnly(false);
  }

  function toggleExercise(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id]);
  }

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      accessibilityLabel={title}
      accessibilityViewIsModal
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Card style={styles.dialog}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Eyebrow>Exercise library</Eyebrow>
              <Heading size="medium">{title}</Heading>
            </View>
            <Button title="Close" compact variant="ghost" onPress={onClose} />
          </View>

          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel="Search exercise library"
              value={query}
              onChangeText={setQuery}
              placeholder="Try ‘arms dumbbell’ or ‘legs unilateral’"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              style={styles.search}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Exercise filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`}
              accessibilityState={{ expanded: filtersOpen }}
              onPress={() => setFiltersOpen((current) => !current)}
              style={({ pressed }) => [styles.filterButton, filtersOpen && styles.filterButtonActive, pressed && styles.pressed]}
            >
              <Text style={[styles.filterButtonText, filtersOpen && styles.filterButtonTextActive]}>
                Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
              </Text>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilters}>
            <FilterChip label="Favorites" selected={favoritesOnly} onPress={() => setFavoritesOnly((current) => !current)} />
            {(Object.entries(exerciseBodyAreaAliases) as Array<[keyof typeof exerciseBodyAreaAliases, readonly MuscleGroup[]]>).map(([area, groups]) => (
              <FilterChip
                key={area}
                label={label(area)}
                selected={groups.every((muscle) => selectedMuscles.includes(muscle))}
                onPress={() => setSelectedMuscles((current) => toggleGroup(current, groups))}
              />
            ))}
            <FilterChip label="Core" selected={selectedMuscles.includes("core")} onPress={() => setSelectedMuscles((current) => toggleValue(current, "core"))} />
          </ScrollView>

          {filtersOpen ? (
            <ScrollView style={styles.filtersPanel} contentContainerStyle={styles.filtersContent} keyboardShouldPersistTaps="handled">
              <FilterSection title="Specific muscles" hint="Choose any. Primary matches are listed first.">
                {muscleGroups.map((muscle) => (
                  <FilterChip key={muscle} label={label(muscle)} selected={selectedMuscles.includes(muscle)} onPress={() => setSelectedMuscles((current) => toggleValue(current, muscle))} />
                ))}
              </FilterSection>
              <FilterSection title="Muscle role">
                <FilterChip label="Primary + secondary" selected={muscleRole === "any"} onPress={() => setMuscleRole("any")} />
                <FilterChip label="Primary only" selected={muscleRole === "primary"} onPress={() => setMuscleRole("primary")} />
                <FilterChip label="Secondary only" selected={muscleRole === "secondary"} onPress={() => setMuscleRole("secondary")} />
              </FilterSection>
              <FilterSection title="Equipment">
                {equipmentOptions.map((value) => <FilterChip key={value} label={label(value)} selected={equipment.includes(value)} onPress={() => setEquipment((current) => toggleValue(current, value))} />)}
              </FilterSection>
              <FilterSection title="Movement">
                {movementOptions.map((value) => <FilterChip key={value} label={label(value)} selected={movementPatterns.includes(value)} onPress={() => setMovementPatterns((current) => toggleValue(current, value))} />)}
              </FilterSection>
              <FilterSection title="Tracking">
                {trackingTypes.map((value) => <FilterChip key={value} label={label(value)} selected={selectedTrackingTypes.includes(value)} onPress={() => setSelectedTrackingTypes((current) => toggleValue(current, value))} />)}
              </FilterSection>
              <FilterSection title="Side mode">
                {sideModes.map((value) => <FilterChip key={value} label={label(value)} selected={selectedSideModes.includes(value)} onPress={() => setSelectedSideModes((current) => toggleValue(current, value))} />)}
              </FilterSection>
              <Button title="Clear all filters" compact variant="ghost" onPress={clearFilters} />
            </ScrollView>
          ) : null}

          {error ? (
            <View style={styles.state}>
              <Message>{error}</Message>
              <Button title="Try again" compact variant="secondary" onPress={onRetry} />
            </View>
          ) : loading ? (
            <LoadingView label="Loading exercise library…" />
          ) : (
            <>
              <View style={styles.resultSummary}>
                <Text accessibilityLiveRegion="polite" style={styles.resultCount}>{matches.length} matches</Text>
                {query || activeFilterCount ? <Button title="Clear" compact variant="ghost" onPress={clearFilters} /> : null}
              </View>
              <ScrollView style={styles.results} contentContainerStyle={styles.resultsContent} keyboardShouldPersistTaps="handled">
                {matches.length ? matches.map(({ exercise, reasons }) => {
                  const checked = selectedIds.includes(exercise.id);
                  const existingCount = existingCounts.get(exercise.id) ?? 0;
                  const primary = exercise.muscles.filter((muscle) => muscle.role === "primary");
                  const secondary = exercise.muscles.filter((muscle) => muscle.role === "secondary");
                  return (
                    <Pressable
                      key={exercise.id}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${checked ? "Remove" : "Select"} ${exercise.name}`}
                      accessibilityState={{ checked }}
                      onBlur={() => setFocusedId(null)}
                      onFocus={() => setFocusedId(exercise.id)}
                      onPress={() => toggleExercise(exercise.id)}
                      style={({ pressed }) => [
                        styles.resultRow,
                        checked && styles.resultRowSelected,
                        pressed && styles.pressed,
                        focusedId === exercise.id && Platform.OS === "web" && styles.webFocusRing,
                      ]}
                    >
                      <View style={[styles.checkbox, checked && styles.checkboxSelected]}>
                        <Text style={styles.checkboxText}>{checked ? "✓" : ""}</Text>
                      </View>
                      <View style={styles.resultCopy}>
                        <Text style={styles.exerciseName}>{exercise.isFavorite ? "★ " : ""}{exercise.name}</Text>
                        <Text style={styles.exerciseMeta}>
                          {label(exercise.equipment)} · {label(exercise.movementPattern)} · {label(exercise.trackingType)}
                          {existingCount ? ` · already used ${existingCount}×` : ""}
                        </Text>
                        <View style={styles.tags}>
                          {primary.map((muscle) => <Tag key={`primary:${muscle.muscleGroup}`} label={`${label(muscle.muscleGroup)} · primary`} primary />)}
                          {secondary.map((muscle) => <Tag key={`secondary:${muscle.muscleGroup}`} label={`${label(muscle.muscleGroup)} · secondary`} />)}
                          {!exercise.muscles.length ? <Tag label="Muscles not tagged" warning /> : null}
                        </View>
                        {reasons.length ? (
                          <Text style={styles.matchReason}>Matched: {reasons.slice(0, 3).map((reason) => reason.label).join(" · ")}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                }) : (
                  <View style={styles.emptyResults}>
                    <Heading size="small">No exercises match</Heading>
                    <Body muted>Try fewer words or clear one of the active filters.</Body>
                    <Button title="Clear filters" compact variant="secondary" onPress={clearFilters} />
                  </View>
                )}
              </ScrollView>
            </>
          )}

          <View style={styles.footer}>
            <View style={styles.footerCopy}>
              <Text style={styles.selectedCount}>{selected.length} selected</Text>
              <Text numberOfLines={1} style={styles.selectedNames}>{selected.map((exercise) => exercise.name).join(", ") || "Choose one or more exercises"}</Text>
            </View>
            <Button
              title={selected.length ? `Add ${selected.length}` : "Add exercises"}
              accessibilityLabel={selected.length ? `Add ${selected.length} selected exercises` : "Add exercises"}
              disabled={!selected.length}
              onPress={() => onAdd(selected)}
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

function FilterSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.filterSection}>
      <Text style={styles.filterTitle}>{title}</Text>
      {hint ? <Text style={styles.filterHint}>{hint}</Text> : null}
      <View style={styles.filterChips}>{children}</View>
    </View>
  );
}

function FilterChip({ label: chipLabel, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={chipLabel}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{chipLabel}</Text>
    </Pressable>
  );
}

function Tag({ label: tagLabel, primary = false, warning = false }: { label: string; primary?: boolean; warning?: boolean }) {
  return (
    <View style={[styles.tag, primary && styles.primaryTag, warning && styles.warningTag]}>
      <Text style={[styles.tagText, primary && styles.primaryTagText, warning && styles.warningTagText]}>{tagLabel}</Text>
    </View>
  );
}

function toggleValue<T>(current: readonly T[], value: T) {
  return current.includes(value) ? current.filter((candidate) => candidate !== value) : [...current, value];
}

function toggleGroup<T>(current: readonly T[], values: readonly T[]) {
  const allSelected = values.every((value) => current.includes(value));
  return allSelected
    ? current.filter((candidate) => !values.includes(candidate))
    : [...new Set([...current, ...values])];
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function countValues(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", alignItems: "center", paddingTop: spacing.xl },
  dialog: { width: "100%", maxWidth: 900, height: "96%", maxHeight: "96%", borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "stretch" },
  search: { flex: 1, minWidth: 0, minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background, color: colors.text, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 16 },
  filterButton: { minHeight: 48, justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.md },
  filterButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  filterButtonText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  filterButtonTextActive: { color: colors.accent },
  quickFilters: { gap: spacing.sm, paddingRight: spacing.md },
  filtersPanel: { maxHeight: 260, flexShrink: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background },
  filtersContent: { padding: spacing.md, gap: spacing.lg },
  filterSection: { gap: spacing.sm },
  filterTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  filterHint: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  filterChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 38, justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: colors.accent },
  state: { gap: spacing.md },
  resultSummary: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  resultCount: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  results: { flex: 1, minHeight: 120 },
  resultsContent: { gap: spacing.sm, paddingBottom: spacing.sm },
  resultRow: { minHeight: 74, flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background },
  resultRowSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  checkbox: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 6, borderWidth: 1, borderColor: colors.borderStrong, marginTop: 2 },
  checkboxSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkboxText: { color: colors.background, fontSize: 15, fontWeight: "900" },
  resultCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  exerciseName: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  exerciseMeta: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tag: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  primaryTag: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  warningTag: { borderColor: colors.warning, backgroundColor: colors.warningSurface },
  tagText: { color: colors.textMuted, fontSize: 9, lineHeight: 13, fontWeight: "700" },
  primaryTagText: { color: colors.accent },
  warningTagText: { color: colors.warning },
  matchReason: { color: colors.textDim, fontSize: 10, lineHeight: 14 },
  emptyResults: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  footerCopy: { flex: 1, minWidth: 0 },
  selectedCount: { color: colors.text, fontSize: 13, fontWeight: "800" },
  selectedNames: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  pressed: { opacity: 0.72 },
  webFocusRing: { outlineColor: colors.accent, outlineOffset: -2, outlineStyle: "solid", outlineWidth: 2 },
});
