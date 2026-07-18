import { useCallback, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { apiRequest } from "../../api/client";
import type { WorkoutHistoryPage } from "../../api/types";
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
import {
  formatHistoryDay,
  formatHistoryDuration,
  formatMuscleGroup,
  formatWorkoutDuration,
  historyRangeLabel,
  historyRangeStart,
  historyStatusLabel,
  type HistoryRange,
} from "./history-format";

const PAGE_SIZE = 20;
const ROUTINES = ["A", "B", "C", "D"];
const STATUSES = [
  { value: "", label: "All" },
  { value: "Completed", label: "Completed" },
  { value: "Partial", label: "Finished early" },
  { value: "Abandoned", label: "Abandoned" },
];

type HistoryFilters = {
  routineCode: string;
  status: string;
  exercise: string;
};

const emptyFilters: HistoryFilters = {
  routineCode: "",
  status: "",
  exercise: "",
};

export function HistoryScreen() {
  const [history, setHistory] = useState<WorkoutHistoryPage | null>(null);
  const [range, setRange] = useState<HistoryRange>("30");
  const [filters, setFilters] = useState<HistoryFilters>(emptyFilters);
  const [draftFilters, setDraftFilters] = useState<HistoryFilters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const loadPage = useCallback(async (offset = 0) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setError("");
    try {
      const params = new URLSearchParams({
        view: "history",
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const from = historyRangeStart(range);
      if (from) params.set("from", from);
      if (filters.routineCode) params.set("routineCode", filters.routineCode);
      if (filters.status) params.set("status", filters.status);
      if (filters.exercise.trim()) params.set("exercise", filters.exercise.trim());
      const payload = await apiRequest<{ history: WorkoutHistoryPage }>(
        `/api/v1/workouts?${params.toString()}`,
      );
      setHistory((current) => {
        if (offset === 0 || !current) return payload.history;
        return {
          ...payload.history,
          workouts: [...current.workouts, ...payload.history.workouts],
        };
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Workout history could not be loaded.",
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filters, range]);

  useFocusEffect(useCallback(() => {
    void loadPage(0);
  }, [loadPage]));

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      {
        label: string;
        workouts: NonNullable<typeof history>["workouts"];
      }
    >();
    for (const workout of history?.workouts ?? []) {
      const date = new Date(workout.startedAt);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const group = groups.get(key) ?? {
        label: formatHistoryDay(workout.startedAt),
        workouts: [],
      };
      groups.set(key, {
        ...group,
        workouts: [...group.workouts, workout],
      });
    }
    return [...groups.entries()];
  }, [history]);
  const activeFilterCount = [
    filters.routineCode,
    filters.status,
    filters.exercise.trim(),
  ].filter(Boolean).length;

  function openFilters() {
    setDraftFilters(filters);
    setShowFilters(true);
  }

  function applyFilters() {
    setFilters({
      ...draftFilters,
      exercise: draftFilters.exercise.trim(),
    });
    setShowFilters(false);
  }

  if (loading && !history) {
    return <LoadingView label="Loading workout history…" />;
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Eyebrow>Your training</Eyebrow>
          <Heading>History</Heading>
          <Body muted>Review every session, exercise, set, and rest interval.</Body>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filter workout history"
          onPress={openFilters}
          style={({ pressed }) => [
            styles.filterButton,
            activeFilterCount > 0 && styles.filterButtonActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[
            styles.filterButtonText,
            activeFilterCount > 0 && styles.filterButtonTextActive,
          ]}>
            Filter{activeFilterCount ? ` · ${activeFilterCount}` : ""}
          </Text>
        </Pressable>
      </View>

      <Card style={styles.summaryCard}>
        <View style={styles.summaryTopline}>
          <Eyebrow>{historyRangeLabel(range)}</Eyebrow>
          {loading && history ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
        </View>
        <View style={styles.stats}>
          <Stat value={String(history?.stats.workoutCount ?? 0)} label="Workouts" />
          <Stat value={String(history?.stats.completedSets ?? 0)} label="Completed sets" />
          <Stat
            value={formatHistoryDuration(history?.stats.durationSeconds ?? 0)}
            label="Training time"
          />
        </View>
      </Card>

      <ScrollView
        horizontal
        contentContainerStyle={styles.rangeRow}
        showsHorizontalScrollIndicator={false}
      >
        {([
          ["30", "30 days"],
          ["90", "90 days"],
          ["365", "1 year"],
          ["all", "All time"],
        ] as Array<[HistoryRange, string]>).map(([value, label]) => (
          <FilterChip
            key={value}
            label={label}
            selected={range === value}
            onPress={() => setRange(value)}
          />
        ))}
      </ScrollView>

      {error ? (
        <>
          <Message>{error}</Message>
          <Button
            title="Try again"
            variant="secondary"
            onPress={() => void loadPage(0)}
          />
        </>
      ) : null}

      {!error && grouped.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Heading size="small">No matching workouts</Heading>
          <Body muted>
            Complete a workout or adjust the history filters to see more sessions.
          </Body>
          {activeFilterCount ? (
            <Button
              title="Clear filters"
              variant="secondary"
              onPress={() => setFilters(emptyFilters)}
            />
          ) : null}
        </Card>
      ) : null}

      {grouped.map(([key, group]) => (
        <View key={key} style={styles.daySection}>
          <Text style={styles.dayLabel}>{group.label}</Text>
          <View style={styles.workoutList}>
            {group.workouts.map((workout) => (
              <Pressable
                key={workout.id}
                accessibilityRole="link"
                accessibilityLabel={`Review Routine ${workout.routineCode} workout`}
                onPress={() => router.push(`/history/${workout.id}`)}
                style={({ pressed }) => [
                  styles.workoutRow,
                  pressed && styles.workoutRowPressed,
                ]}
              >
                <View style={styles.workoutCode}>
                  <Text style={styles.workoutCodeText}>{workout.routineCode}</Text>
                </View>
                <View style={styles.workoutCopy}>
                  <View style={styles.workoutTopline}>
                    <Text style={styles.workoutTitle}>
                      Routine {workout.routineCode}
                    </Text>
                    <StatusBadge status={workout.status} />
                  </View>
                  <Text style={styles.workoutMeta}>
                    {workout.completedSets}/{workout.totalSets} sets ·{" "}
                    {workout.exerciseCount} exercises ·{" "}
                    {formatWorkoutDuration(workout.durationSeconds)}
                  </Text>
                  <Text numberOfLines={1} style={styles.workoutMuscles}>
                    {(workout.muscleGroups.length
                      ? workout.muscleGroups.map(formatMuscleGroup)
                      : workout.exerciseNames
                    ).slice(0, 4).join(" · ") || "Workout details"}
                  </Text>
                </View>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {history?.hasMore ? (
        <Button
          title={loadingMore ? "Loading…" : "Show more workouts"}
          variant="secondary"
          loading={loadingMore}
          onPress={() => void loadPage(history.workouts.length)}
        />
      ) : null}

      <HistoryFilterModal
        visible={showFilters}
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={applyFilters}
        onReset={() => {
          setDraftFilters(emptyFilters);
          setFilters(emptyFilters);
          setShowFilters(false);
        }}
        onClose={() => setShowFilters(false)}
      />
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text numberOfLines={1} style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatusBadge({
  status,
}: {
  status: "Completed" | "Partial" | "Abandoned";
}) {
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

function HistoryFilterModal({
  visible,
  filters,
  onChange,
  onApply,
  onReset,
  onClose,
}: {
  visible: boolean;
  filters: HistoryFilters;
  onChange: (filters: HistoryFilters) => void;
  onApply: () => void;
  onReset: () => void;
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
          accessibilityLabel="Close workout history filters"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.filterSheet}>
          <View style={styles.sheetHeader}>
            <View>
              <Eyebrow>Narrow the list</Eyebrow>
              <Heading size="medium">Filters</Heading>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close workout history filters"
              onPress={onClose}
              hitSlop={10}
              style={styles.close}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Routine</Text>
            <View style={styles.wrapRow}>
              <FilterChip
                label="All"
                selected={!filters.routineCode}
                onPress={() => onChange({ ...filters, routineCode: "" })}
              />
              {ROUTINES.map((routine) => (
                <FilterChip
                  key={routine}
                  label={`Routine ${routine}`}
                  selected={filters.routineCode === routine}
                  onPress={() => onChange({ ...filters, routineCode: routine })}
                />
              ))}
            </View>
          </View>
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Status</Text>
            <View style={styles.wrapRow}>
              {STATUSES.map((status) => (
                <FilterChip
                  key={status.value || "all"}
                  label={status.label}
                  selected={filters.status === status.value}
                  onPress={() => onChange({ ...filters, status: status.value })}
                />
              ))}
            </View>
          </View>
          <Field
            label="Exercise"
            value={filters.exercise}
            onChangeText={(exercise) => onChange({ ...filters, exercise })}
            placeholder="e.g. bench press"
            returnKeyType="search"
            onSubmitEditing={onApply}
          />
          <View style={styles.sheetActions}>
            <Button title="Apply filters" onPress={onApply} />
            <Button title="Reset" variant="ghost" onPress={onReset} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  headerCopy: { flex: 1, gap: spacing.sm },
  filterButton: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  filterButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  filterButtonText: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  filterButtonTextActive: { color: colors.accent },
  pressed: { opacity: 0.72 },
  summaryCard: { backgroundColor: colors.surfaceRaised, gap: spacing.lg },
  summaryTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  refreshing: { color: colors.textDim, fontSize: 11 },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: {
    flex: 1,
    minWidth: 0,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  statValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  statLabel: { color: colors.textDim, fontSize: 10, lineHeight: 14 },
  rangeRow: { gap: spacing.sm },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  chipText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  chipTextSelected: { color: colors.accent },
  emptyCard: { alignItems: "stretch" },
  daySection: { gap: spacing.sm },
  dayLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  workoutList: {
    overflow: "hidden",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  workoutRow: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  workoutRowPressed: { backgroundColor: colors.surfaceRaised },
  workoutCode: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentDark,
  },
  workoutCodeText: { color: colors.accent, fontSize: 15, fontWeight: "900" },
  workoutCopy: { flex: 1, minWidth: 0, gap: 4 },
  workoutTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  workoutTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  workoutMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  workoutMuscles: { color: colors.textDim, fontSize: 10 },
  status: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.successSurface,
  },
  statusPartial: { backgroundColor: colors.warningSurface },
  statusAbandoned: { backgroundColor: colors.dangerSurface },
  statusText: { color: colors.success, fontSize: 9, fontWeight: "800" },
  statusTextPartial: { color: colors.warning },
  statusTextAbandoned: { color: colors.danger },
  arrow: { color: colors.textDim, fontSize: 22 },
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
  filterSheet: {
    width: "100%",
    maxWidth: 680,
    maxHeight: "92%",
    padding: spacing.xl,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    gap: spacing.lg,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
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
  filterGroup: { gap: spacing.sm },
  filterLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sheetActions: { gap: spacing.sm },
});
