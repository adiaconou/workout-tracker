import { useEffect, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { WorkoutView } from "../../contracts/api";
import { colors, radii, spacing } from "../ui/tokens";
import {
  alignPreviousExerciseSets,
  comparisonLoadHeading,
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
  showSummaryTable = true,
}: {
  sets: WorkoutView["sets"];
  previousSets: NonNullable<WorkoutView["previousPerformanceByExercise"][number]>["sets"];
  recordedPerformanceBySetId: WorkoutView["recordedPerformanceBySetId"];
  selectedSetId: string;
  activeSetIndex: number;
  navigationDisabled: boolean;
  onSelectSet: (globalIndex: number) => void;
  progressiveTrainingEnabled: boolean;
  showSummaryTable?: boolean;
}) {
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

  return (
    <View style={styles.comparison}>
      <View style={styles.selector}>
        <Text nativeID="active-set-selector-label" style={styles.selectorLabel}>Sets</Text>
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
                    <Text accessibilityElementsHidden style={styles.setStatusGlyph}>–</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {showSummaryTable && selectedSet ? (
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
    </View>
  );
}

const styles = StyleSheet.create({
  comparison: { gap: spacing.md },
  selector: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  selectorLabel: { width: 32, color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  selectorScroll: { flex: 1, minWidth: 0 },
  selectorContent: { alignItems: "center", gap: 6, paddingRight: spacing.sm },
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
});
