import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { WorkoutView } from "../../contracts/api";
import { colors, radii, spacing } from "../ui/tokens";
import {
  alignPreviousExerciseSets,
  comparisonLoadHeading,
  comparisonLoadPhrase,
  comparisonResultHeading,
  formatComparisonTableCells,
  formatComparisonTargetCells,
  type ComparisonPerformance,
  type ComparisonTableCells,
} from "./set-comparison";
import { recommendProgressiveTarget } from "./progressive-target";

const SET_BUTTON_STRIDE = 50;

export function ActiveSetComparison({
  sets,
  previousSets,
  recordedPerformanceBySetId,
  selectedSetId,
  activeSetIndex,
  navigationDisabled,
  onSelectSet,
  progressiveTrainingEnabled,
}: {
  sets: WorkoutView["sets"];
  previousSets: NonNullable<WorkoutView["previousPerformanceByExercise"][number]>["sets"];
  recordedPerformanceBySetId: WorkoutView["recordedPerformanceBySetId"];
  selectedSetId: string;
  activeSetIndex: number;
  navigationDisabled: boolean;
  onSelectSet: (globalIndex: number) => void;
  progressiveTrainingEnabled: boolean;
}) {
  const [showAllSets, setShowAllSets] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const selectedIndex = Math.max(0, sets.findIndex((set) => set.id === selectedSetId));
  const selectedSet = sets[selectedIndex];
  const scrollTarget = Math.max(0, selectedIndex * SET_BUTTON_STRIDE - SET_BUTTON_STRIDE);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: scrollTarget, animated: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [scrollTarget, selectedSetId]);

  const alignedPreviousSets = useMemo(() => alignPreviousExerciseSets(
    sets.map((set) => ({
      sourceRoutineSetId: set.sourceRoutineSetId,
      setType: set.setType,
      targetType: set.targetType ?? (set.targetUnit === "seconds"
        ? "duration"
        : set.targetUnit),
    })),
    previousSets,
  ), [previousSets, sets]);

  const rows = useMemo(() => {
    if (!selectedSet) return [];
    const previous = alignedPreviousSets[selectedIndex];
    const previousPerformance: ComparisonPerformance | undefined = previous
      ? {
          status: previous.status,
          actualWeight: previous.actualWeight,
          actualReps: previous.actualReps,
          actualDurationSec: previous.actualDurationSec,
          weightUnit: previous.weightUnit || selectedSet.weightUnit,
          targetType: previous.targetType,
          loadType: previous.loadType,
        }
      : undefined;
    const targetCells = formatComparisonTargetCells(selectedSet);
    const recommended = formatComparisonTableCells(
      selectedSet,
      recommendProgressiveTarget(selectedSet, previous),
    );
    const comparisonRows: Array<{
      label: string;
      cells: ComparisonTableCells;
      recommended?: boolean;
    }> = [];
    if (progressiveTrainingEnabled) {
      comparisonRows.push({
        label: "Recommended",
        cells: { ...recommended, rir: targetCells.rir },
        recommended: true,
      });
    }
    comparisonRows.push(
      { label: "Range", cells: targetCells },
      {
        label: "Last time",
        cells: formatComparisonTableCells(selectedSet, previousPerformance),
      },
    );
    return comparisonRows;
  }, [alignedPreviousSets, progressiveTrainingEnabled, selectedIndex, selectedSet]);

  const allSetRows = useMemo(() => sets.map((set, index) => {
    const recorded = recordedPerformanceBySetId[set.id];
    const current = set.globalIndex === activeSetIndex;
    const status = current
      ? "Current"
      : recorded?.status === "Completed"
        ? "Completed"
        : recorded?.status === "Skipped"
          ? "Skipped"
          : set.globalIndex > activeSetIndex
            ? "Upcoming"
            : "Not logged";
    const targetCells = formatComparisonTargetCells(set);
    const recommendedPerformance = progressiveTrainingEnabled
      ? recommendProgressiveTarget(set, alignedPreviousSets[index])
      : undefined;
    const recommendedCells = formatComparisonTableCells(set, recommendedPerformance);
    const plannedLoad = recommendedCells.load === "—"
      ? "—"
      : comparisonLoadPhrase(set.loadType, recommendedCells.load);
    const plannedResult = metricWithUnit(
      recommendedPerformance ? recommendedCells.result : targetCells.result,
      set.targetUnit,
    );
    const plannedRir = targetCells.rir === "—" ? null : `RIR ${targetCells.rir}`;
    const resultCells = formatComparisonTableCells(set, recorded);
    const recordedLoad = resultCells.load === "—"
      ? "—"
      : comparisonLoadPhrase(set.loadType, resultCells.load);
    const recordedResult = metricWithUnit(resultCells.result, set.targetUnit);
    return {
      id: set.id,
      number: index + 1,
      type: setTypeLabel(set.setType),
      status,
      selected: set.id === selectedSetId,
      current,
      plannedPrimary: plannedLoad === "—" ? plannedResult : plannedLoad,
      plannedSecondary: [plannedLoad === "—" ? null : plannedResult, plannedRir]
        .filter(Boolean)
        .join(" · "),
      resultPrimary: status === "Skipped"
        ? "Skipped"
        : recordedLoad === "—"
          ? recordedResult
          : recordedLoad,
      resultSecondary: status === "Skipped"
        ? ""
        : recordedLoad === "—"
          ? ""
          : recordedResult,
    };
  }), [
    activeSetIndex,
    alignedPreviousSets,
    progressiveTrainingEnabled,
    recordedPerformanceBySetId,
    selectedSetId,
    sets,
  ]);

  return (
    <View style={styles.comparison}>
      <View style={styles.selector}>
        <View style={styles.selectorHeader}>
          <Text nativeID="active-set-selector-label" style={styles.selectorLabel}>Sets</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View all ${sets.length} sets for ${sets[0]?.exerciseName ?? "this exercise"}`}
            accessibilityState={{ disabled: navigationDisabled }}
            disabled={navigationDisabled}
            onPress={() => setShowAllSets(true)}
            hitSlop={4}
            style={({ pressed }) => [
              styles.viewAllSets,
              pressed && styles.viewAllSetsPressed,
              navigationDisabled && styles.viewAllSetsDisabled,
            ]}
          >
            <Text style={styles.viewAllSetsText}>View all sets</Text>
          </Pressable>
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          accessibilityLabelledBy="active-set-selector-label"
          contentContainerStyle={styles.selectorContent}
          onContentSizeChange={() => {
            scrollRef.current?.scrollTo({ x: scrollTarget, animated: false });
          }}
          showsHorizontalScrollIndicator={false}
          style={styles.selectorScroll}
        >
          {sets.map((set, index) => {
            const recorded = recordedPerformanceBySetId[set.id];
            const completed = recorded?.status === "Completed";
            const skipped = recorded?.status === "Skipped";
            const current = set.globalIndex === activeSetIndex;
            const selected = set.id === selectedSetId;
            const upcoming = !recorded && set.globalIndex > activeSetIndex;
            const selectable = current || Boolean(recorded);
            const disabled = navigationDisabled || !selectable;
            const state = current
              ? "current workout set"
              : completed
                ? "completed"
                : skipped
                  ? "skipped"
                  : upcoming
                    ? "upcoming"
                    : "not logged";
            return (
              <Pressable
                key={set.id}
                accessibilityRole="button"
                accessibilityLabel={`Set ${index + 1}, ${state}${selected ? ", selected" : ""}`}
                accessibilityState={{ disabled, selected }}
                disabled={disabled}
                onPress={() => onSelectSet(set.globalIndex)}
                style={({ pressed }) => [
                  styles.setButton,
                  pressed && styles.setButtonPressed,
                  disabled && styles.setButtonDisabled,
                ]}
              >
                <View style={[
                  styles.setMarker,
                  (completed || skipped) && styles.setMarkerRecorded,
                  selected && !current && styles.setMarkerViewed,
                  current && styles.setMarkerCurrent,
                ]}>
                  <Text style={[
                    styles.setNumber,
                    selected && !current && styles.setNumberViewed,
                    current && styles.setNumberCurrent,
                  ]}>
                    {index + 1}
                  </Text>
                  {completed ? (
                    <Text accessibilityElementsHidden style={[
                      styles.setStatusGlyph,
                      selected && !current && styles.setNumberViewed,
                    ]}>✓</Text>
                  ) : skipped ? (
                    <Text accessibilityElementsHidden style={[
                      styles.setStatusGlyph,
                      selected && !current && styles.setNumberViewed,
                    ]}>–</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text accessibilityLiveRegion="polite" style={styles.screenReaderStatus}>
          {selectedSet?.globalIndex === activeSetIndex
            ? `Current workout set ${selectedIndex + 1} selected.`
            : `Viewing ${recordedPerformanceBySetId[selectedSet?.id ?? ""]?.status.toLowerCase() ?? "past"} set ${selectedIndex + 1}. ${sets.some((set) => set.globalIndex === activeSetIndex)
              ? `Current workout remains on set ${sets.findIndex((set) => set.globalIndex === activeSetIndex) + 1}.`
              : "Current workout remains on another exercise."}`}
        </Text>
      </View>

      {selectedSet ? (
        <View
          accessible
          accessibilityLabel={`Set comparison. ${rows.map((row) => `${row.label}: ${row.cells.load}, ${row.cells.result}, RIR ${row.cells.rir}`).join(". ")}`}
          style={styles.table}
        >
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableHeaderText, styles.labelColumn]}> </Text>
            <Text style={[styles.tableHeaderText, styles.loadColumn]}>
              {comparisonLoadHeading(selectedSet.loadType)}
            </Text>
            <Text style={[styles.tableHeaderText, styles.resultColumn]}>
              {comparisonResultHeading(selectedSet.targetUnit)}
            </Text>
            <Text style={[styles.tableHeaderText, styles.rirColumn]}>RIR</Text>
          </View>
          {rows.map((row) => (
            <View key={row.label} style={styles.tableRow}>
              <Text style={[
                styles.rowLabel,
                styles.labelColumn,
                row.recommended && styles.recommendedText,
              ]}>
                {row.label}
              </Text>
              <Text style={[
                styles.cellText,
                styles.loadColumn,
                row.recommended && styles.recommendedText,
              ]}>{row.cells.load}</Text>
              <Text style={[
                styles.cellText,
                styles.resultColumn,
                row.recommended && styles.recommendedText,
              ]}>{row.cells.result}</Text>
              <Text style={[
                styles.cellText,
                styles.rirColumn,
                row.recommended && styles.recommendedText,
              ]}>{row.cells.rir}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Modal
        visible={showAllSets}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowAllSets(false)}
      >
        <View style={styles.allSetsOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close all exercise sets"
            onPress={() => setShowAllSets(false)}
            style={styles.allSetsBackdrop}
          />
          <View accessibilityViewIsModal style={styles.allSetsSheet}>
            <View style={styles.allSetsHeader}>
              <View style={styles.allSetsTitleBlock}>
                <Text accessibilityRole="header" style={styles.allSetsTitle}>
                  {sets[0]?.exerciseName ?? "Exercise"}
                </Text>
                <Text style={styles.allSetsSubtitle}>All sets</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close all exercise sets"
                onPress={() => setShowAllSets(false)}
                style={({ pressed }) => [
                  styles.allSetsDone,
                  pressed && styles.allSetsDonePressed,
                ]}
              >
                <Text style={styles.allSetsDoneText}>Done</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.allSetsScroll}
              contentContainerStyle={styles.allSetsContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.allSetsTable}>
                <View style={[styles.allSetsRow, styles.allSetsTableHeader]}>
                  <Text style={[styles.allSetsHeaderText, styles.allSetsSetColumn]}>Set</Text>
                  <Text style={[styles.allSetsHeaderText, styles.allSetsValueColumn]}>Planned</Text>
                  <Text style={[styles.allSetsHeaderText, styles.allSetsValueColumn]}>Result</Text>
                </View>
                {allSetRows.map((row) => (
                  <View
                    key={row.id}
                    accessible
                    accessibilityLabel={`Set ${row.number}, ${row.type}, ${row.status}. Planned ${row.plannedPrimary}${row.plannedSecondary ? `, ${row.plannedSecondary}` : ""}. Result ${row.resultPrimary}${row.resultSecondary ? `, ${row.resultSecondary}` : ""}.`}
                    style={[
                      styles.allSetsRow,
                      row.selected && !row.current && styles.allSetsRowSelected,
                      row.current && styles.allSetsRowCurrent,
                    ]}
                  >
                    <View style={styles.allSetsSetColumn}>
                      <Text style={[
                        styles.allSetsSetNumber,
                        row.current && styles.allSetsCurrentText,
                      ]}>
                        {row.number}{row.status === "Completed" ? "  ✓" : row.status === "Skipped" ? "  –" : row.current ? "  ●" : ""}
                      </Text>
                      <Text numberOfLines={1} style={styles.allSetsMeta}>
                        {row.type} · {row.status}
                      </Text>
                    </View>
                    <View style={styles.allSetsValueColumn}>
                      <Text numberOfLines={1} style={styles.allSetsValue}>
                        {row.plannedPrimary}
                      </Text>
                      {row.plannedSecondary ? (
                        <Text numberOfLines={1} style={styles.allSetsMeta}>
                          {row.plannedSecondary}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.allSetsValueColumn}>
                      <Text numberOfLines={1} style={[
                        styles.allSetsValue,
                        row.status === "Upcoming" && styles.allSetsUpcomingText,
                      ]}>
                        {row.resultPrimary}
                      </Text>
                      {row.resultSecondary ? (
                        <Text numberOfLines={1} style={styles.allSetsMeta}>
                          {row.resultSecondary}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function metricWithUnit(
  value: string,
  unit: WorkoutView["sets"][number]["targetUnit"],
) {
  if (value === "—" || value === "Skipped") return value;
  return `${value} ${comparisonResultHeading(unit).toLowerCase()}`;
}

function setTypeLabel(setType: string) {
  const normalized = setType.trim().toLowerCase();
  if (normalized === "warmup" || normalized === "warm-up") return "Warm-up";
  if (normalized === "regular" || normalized === "working") return "Working";
  if (!normalized) return "Set";
  return normalized
    .split(/[\s_-]+/u)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

const styles = StyleSheet.create({
  comparison: { gap: spacing.md },
  selector: {
    minHeight: 52,
    gap: spacing.xs,
  },
  selectorHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  selectorLabel: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  viewAllSets: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  viewAllSetsPressed: { opacity: 0.68 },
  viewAllSetsDisabled: { opacity: 0.42 },
  viewAllSetsText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  selectorScroll: { width: "100%", minWidth: 0 },
  selectorContent: { alignItems: "center", gap: 6, paddingRight: spacing.sm },
  screenReaderStatus: {
    position: "absolute",
    left: -10_000,
    width: 1,
    height: 1,
    overflow: "hidden",
  },
  setButton: {
    width: 44,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  setButtonPressed: { opacity: 0.72 },
  setButtonDisabled: { opacity: 0.48 },
  setMarker: {
    width: 34,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    borderRadius: radii.pill,
  },
  setMarkerRecorded: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  setMarkerViewed: {
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.surfaceRaised,
  },
  setMarkerCurrent: { backgroundColor: colors.accent },
  setNumber: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  setNumberViewed: { color: colors.text },
  setNumberCurrent: { color: colors.background, fontWeight: "900" },
  setStatusGlyph: { color: colors.textMuted, fontSize: 10, lineHeight: 13, fontWeight: "900" },
  table: {
    width: "100%",
  },
  tableRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tableHeader: {
    minHeight: 28,
  },
  tableHeaderText: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    textAlign: "right",
  },
  rowLabel: { color: colors.textMuted, fontSize: 13, lineHeight: 18, fontWeight: "400" },
  recommendedText: { color: colors.text, fontWeight: "500" },
  cellText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  labelColumn: { width: "36%", paddingRight: spacing.sm, textAlign: "left" },
  loadColumn: { width: "28%", paddingHorizontal: 2 },
  resultColumn: { width: "18%", paddingHorizontal: 2 },
  rirColumn: { width: "18%", paddingLeft: 2 },
  allSetsOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: colors.overlay,
    paddingTop: spacing.xl,
  },
  allSetsBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  allSetsSheet: {
    width: "100%",
    maxWidth: 680,
    maxHeight: "88%",
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  allSetsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  allSetsTitleBlock: { flex: 1, minWidth: 0, gap: spacing.xs },
  allSetsTitle: {
    color: colors.text,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "800",
  },
  allSetsSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  allSetsDone: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  allSetsDonePressed: { opacity: 0.68 },
  allSetsDoneText: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  allSetsScroll: { flexShrink: 1 },
  allSetsContent: { paddingBottom: spacing.sm },
  allSetsTable: {
    width: "100%",
    overflow: "hidden",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  allSetsRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  allSetsTableHeader: {
    minHeight: 36,
    backgroundColor: colors.surfaceRaised,
  },
  allSetsRowSelected: { backgroundColor: colors.surfaceRaised },
  allSetsRowCurrent: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  allSetsHeaderText: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  allSetsSetColumn: { width: "28%", minWidth: 0, paddingRight: spacing.sm },
  allSetsValueColumn: { width: "36%", minWidth: 0, paddingRight: spacing.xs },
  allSetsSetNumber: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  allSetsCurrentText: { color: colors.accent },
  allSetsValue: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  allSetsMeta: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ["tabular-nums"],
  },
  allSetsUpcomingText: { color: colors.textMuted },
});
