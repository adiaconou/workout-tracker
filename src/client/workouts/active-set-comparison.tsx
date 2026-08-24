import { useEffect, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { WorkoutView } from "../../contracts/api";
import { colors, radii, spacing } from "../ui/tokens";
import {
  alignPreviousExerciseSets,
  formatSetComparisonPerformance,
  liveSetComparisonPerformance,
  type ComparisonPerformance,
} from "./set-comparison";
import { recommendProgressiveTarget } from "./progressive-target";

const CELL_WIDTH = 132;

export function ActiveSetComparison({
  sets,
  previousSets,
  recordedPerformanceBySetId,
  selectedSetId,
  activeSetIndex,
  navigationDisabled,
  onSelectSet,
  weight,
  result,
  progressiveTrainingEnabled,
}: {
  sets: WorkoutView["sets"];
  previousSets: NonNullable<WorkoutView["previousPerformanceByExercise"][number]>["sets"];
  recordedPerformanceBySetId: WorkoutView["recordedPerformanceBySetId"];
  selectedSetId: string;
  activeSetIndex: number;
  navigationDisabled: boolean;
  onSelectSet: (globalIndex: number) => void;
  weight: string;
  result: string;
  progressiveTrainingEnabled: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const currentOccurrenceIndex = sets.findIndex((set) => set.id === selectedSetId);
  const scrollTarget = Math.max(0, currentOccurrenceIndex * CELL_WIDTH - CELL_WIDTH / 2);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: scrollTarget, animated: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [scrollTarget, selectedSetId]);

  const currentValues = useMemo(() => sets.map((set) => {
    const recorded = recordedPerformanceBySetId[set.id];
    if (recorded) return formatSetComparisonPerformance(set, recorded);
    if (set.id !== selectedSetId) return "—";
    return formatSetComparisonPerformance(
      set,
      liveSetComparisonPerformance(set, weight, result),
    );
  }), [recordedPerformanceBySetId, result, selectedSetId, sets, weight]);

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

  const previousValues = useMemo(() => {
    return sets.map((set, index) => {
      const previous = alignedPreviousSets[index];
      if (!previous) return "—";
      const performance: ComparisonPerformance = {
        status: previous.status,
        actualWeight: previous.actualWeight,
        actualReps: previous.actualReps,
        actualDurationSec: previous.actualDurationSec,
        weightUnit: previous.weightUnit || set.weightUnit,
        targetType: previous.targetType,
        loadType: previous.loadType,
      };
      return formatSetComparisonPerformance(set, performance);
    });
  }, [alignedPreviousSets, sets]);

  const recommendedValues = useMemo(() => sets.map((set, index) => (
    formatSetComparisonPerformance(
      set,
      recommendProgressiveTarget(set, alignedPreviousSets[index]),
    )
  )), [alignedPreviousSets, sets]);

  return (
    <View style={[
      styles.comparison,
      progressiveTrainingEnabled && styles.comparisonProgressive,
    ]}>
      <View style={styles.rowLabels}>
        <Text style={styles.cornerLabel}>Set</Text>
        <Text style={styles.rowLabel}>This workout</Text>
        {progressiveTrainingEnabled ? (
          <Text style={[styles.rowLabel, styles.recommendedRowLabel]}>Recommended</Text>
        ) : null}
        <Text style={styles.rowLabel}>Last time</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        accessibilityLabel="Set-by-set performance comparison"
        contentContainerStyle={styles.scrollContent}
        onContentSizeChange={() => {
          scrollRef.current?.scrollTo({ x: scrollTarget, animated: false });
        }}
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
      >
        {sets.map((set, index) => {
          const active = set.id === selectedSetId;
          const selectable = set.globalIndex <= activeSetIndex;
          const recorded = recordedPerformanceBySetId[set.id];
          const skipped = recorded?.status === "Skipped";
          const completed = recorded?.status === "Completed";
          return (
            <View key={set.id} style={styles.column}>
              <Text style={[styles.columnLabel, active && styles.columnLabelActive]}>
                {index + 1}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View this workout, set ${index + 1}${active ? ", selected" : ""}, ${currentValues[index]}`}
                accessibilityState={{ disabled: !selectable || navigationDisabled, selected: active }}
                disabled={!selectable || navigationDisabled}
                onPress={() => onSelectSet(set.globalIndex)}
                style={({ pressed }) => [
                  styles.cell,
                  active && styles.cellActive,
                  completed && styles.cellCompleted,
                  skipped && styles.cellSkipped,
                  pressed && styles.cellPressed,
                  !selectable && styles.cellUnavailable,
                ]}
              >
                <Text
                  numberOfLines={2}
                  style={[
                    styles.cellText,
                    active && styles.cellTextActive,
                    skipped && styles.cellTextSkipped,
                  ]}
                >
                  {currentValues[index]}
                </Text>
              </Pressable>
              {progressiveTrainingEnabled ? (
                <View
                  accessible
                  accessibilityLabel={`Recommended target, set ${index + 1}, ${
                    recommendedValues[index] === "—"
                      ? "no baseline"
                      : recommendedValues[index]
                  }`}
                  style={[styles.cell, styles.recommendedCell]}
                >
                  <Text numberOfLines={2} style={[styles.cellText, styles.recommendedCellText]}>
                    {recommendedValues[index]}
                  </Text>
                </View>
              ) : null}
              <View
                accessible
                accessibilityLabel={`Last time, set ${index + 1}, ${previousValues[index]}`}
                style={styles.cell}
              >
                <Text numberOfLines={2} style={styles.cellText}>
                  {previousValues[index]}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  comparison: {
    minHeight: 116,
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    paddingTop: spacing.sm,
  },
  comparisonProgressive: { minHeight: 160 },
  rowLabels: { width: 92, flexShrink: 0 },
  cornerLabel: {
    height: 24,
    color: colors.textDim,
    fontSize: 9,
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  rowLabel: {
    height: 44,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    textAlignVertical: "center",
    paddingRight: spacing.sm,
  },
  recommendedRowLabel: { color: colors.recommendation },
  scroll: { flex: 1, minWidth: 0 },
  scrollContent: { paddingRight: spacing.sm },
  column: { width: CELL_WIDTH, gap: 0 },
  columnLabel: {
    height: 24,
    color: colors.textDim,
    fontSize: 10,
    lineHeight: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  columnLabelActive: { color: colors.accent },
  cell: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  cellActive: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radii.sm,
    backgroundColor: colors.accentDark,
  },
  recommendedCell: {
    borderColor: colors.recommendationBorder,
    backgroundColor: colors.recommendationSurface,
  },
  cellCompleted: { backgroundColor: colors.successSurface },
  cellSkipped: { backgroundColor: colors.surfaceRaised },
  cellPressed: { opacity: 0.72 },
  cellUnavailable: { opacity: 0.45 },
  cellText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  cellTextActive: { color: colors.text },
  cellTextSkipped: { color: colors.textDim },
  recommendedCellText: { color: colors.recommendation },
});
