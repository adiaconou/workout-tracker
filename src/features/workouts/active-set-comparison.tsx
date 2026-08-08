import { useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { WorkoutView } from "../../api/types";
import { colors, radii, spacing } from "../../theme/tokens";
import {
  formatSetComparisonPerformance,
  liveSetComparisonPerformance,
  type ComparisonPerformance,
} from "./set-comparison";

const CELL_WIDTH = 132;

export function ActiveSetComparison({
  sets,
  previousSets,
  recordedPerformanceBySetId,
  currentSetId,
  weight,
  result,
}: {
  sets: WorkoutView["sets"];
  previousSets: NonNullable<WorkoutView["previousPerformanceByExercise"][number]>["sets"];
  recordedPerformanceBySetId: WorkoutView["recordedPerformanceBySetId"];
  currentSetId: string;
  weight: string;
  result: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const currentOccurrenceIndex = sets.findIndex((set) => set.id === currentSetId);
  const scrollTarget = Math.max(0, currentOccurrenceIndex * CELL_WIDTH - CELL_WIDTH / 2);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: scrollTarget, animated: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [currentSetId, scrollTarget]);

  const currentValues = useMemo(() => sets.map((set) => {
    const recorded = recordedPerformanceBySetId[set.id];
    if (recorded) return formatSetComparisonPerformance(set, recorded);
    if (set.id !== currentSetId) return "—";
    return formatSetComparisonPerformance(
      set,
      liveSetComparisonPerformance(set, weight, result),
    );
  }), [currentSetId, recordedPerformanceBySetId, result, sets, weight]);

  const previousValues = useMemo(() => sets.map((set, index) => {
    const previous = previousSets[index];
    if (!previous) return "—";
    const performance: ComparisonPerformance = {
      status: previous.status,
      actualWeight: previous.actualWeight,
      actualReps: previous.actualReps,
      actualDurationSec: previous.actualDurationSec,
      weightUnit: previous.weightUnit || set.weightUnit,
      targetType: previous.targetType,
    };
    return formatSetComparisonPerformance(set, performance);
  }), [previousSets, sets]);

  return (
    <View style={styles.comparison}>
      <View style={styles.rowLabels}>
        <Text style={styles.cornerLabel}>Set</Text>
        <Text style={styles.rowLabel}>This workout</Text>
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
          const active = set.id === currentSetId;
          const recorded = recordedPerformanceBySetId[set.id];
          const skipped = recorded?.status === "Skipped";
          const completed = recorded?.status === "Completed";
          return (
            <View key={set.id} style={styles.column}>
              <Text style={[styles.columnLabel, active && styles.columnLabelActive]}>
                {index + 1}
              </Text>
              <View
                accessible
                accessibilityLabel={`This workout, set ${index + 1}${active ? ", active" : ""}, ${currentValues[index]}`}
                accessibilityState={{ selected: active }}
                style={[
                  styles.cell,
                  active && styles.cellActive,
                  completed && styles.cellCompleted,
                  skipped && styles.cellSkipped,
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
              </View>
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
  cellCompleted: { backgroundColor: colors.successSurface },
  cellSkipped: { backgroundColor: colors.surfaceRaised },
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
});
