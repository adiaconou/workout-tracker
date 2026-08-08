import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import type {
  ExerciseProgress,
  ExerciseProgressMetric,
  ExerciseProgressPoint,
} from "../../../domain/entities";
import { apiRequest } from "../../api/client";
import { Body, Button, Card, Eyebrow, Heading, Message } from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";
import {
  exerciseProgressRangeStart,
  type ExerciseProgressRange,
} from "./exercise-progress-range";

const rangeOptions: Array<[ExerciseProgressRange, string, string]> = [
  ["3m", "3M", "3 months"],
  ["6m", "6M", "6 months"],
  ["1y", "1Y", "1 year"],
  ["all", "All", "all time"],
];

function formatNumber(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return minutes ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

export function progressValueLabel(
  value: number,
  metric: ExerciseProgressMetric,
  unit: ExerciseProgress["unit"],
) {
  if (metric === "duration") return formatDuration(value);
  if (metric === "rounds") return `${formatNumber(value)} rounds`;
  if (metric === "reps") return `${formatNumber(value)} reps`;
  if (metric === "epley_estimated_1rm") return `${formatNumber(value)} ${unit}`;
  return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

export function progressSetLabel(point: ExerciseProgressPoint) {
  if (point.actualDurationSec !== null) return formatDuration(point.actualDurationSec);
  if (point.actualWeight !== null && point.actualWeight > 0 && point.actualReps !== null) {
    return `${formatNumber(point.actualWeight)} ${point.weightUnit} × ${formatNumber(point.actualReps)}`;
  }
  if (point.actualReps !== null) return `${formatNumber(point.actualReps)} reps`;
  return "Recorded working set";
}

function progressDeltaLabel(
  value: number,
  metric: ExerciseProgressMetric,
  unit: ExerciseProgress["unit"],
) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  if (metric === "duration") return `${sign}${formatDuration(absolute)}`;
  if (metric === "rounds") return `${sign}${formatNumber(absolute)} rounds`;
  if (metric === "reps") return `${sign}${formatNumber(absolute)} reps`;
  return `${sign}${formatNumber(absolute)} ${unit}`;
}

function metricTitle(metric: ExerciseProgressMetric) {
  if (metric === "epley_estimated_1rm") return "Estimated strength";
  if (metric === "duration") return "Best duration";
  if (metric === "rounds") return "Best rounds";
  if (metric === "reps") return "Best reps";
  return "Performance trend";
}

function metricExplanation(metric: ExerciseProgressMetric) {
  if (metric === "epley_estimated_1rm") {
    return "Uses the Epley estimate (weight × (1 + reps ÷ 30)) for completed working sets of 2–10 reps; a single uses its logged weight. Exact weight and reps stay visible below.";
  }
  if (metric === "duration") return "The longest completed working set from each workout.";
  if (metric === "rounds") return "The most completed rounds from each workout.";
  if (metric === "reps") return "The most completed reps from each workout. Logged weight remains visible when available.";
  return "The best comparable completed working set from each workout.";
}

function formatPointDate(value: string, includeYear = false) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
  }).format(date);
}

function statusLabel(status: ExerciseProgressPoint["workoutStatus"]) {
  return status === "Partial" ? "Finished early" : status;
}

function sampleChartPoints(points: ExerciseProgressPoint[], maximum: number) {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round(index * (points.length - 1) / (maximum - 1));
    return points[sourceIndex]!;
  });
}

export function ExerciseProgressCard({
  exerciseId,
  exerciseName,
}: {
  exerciseId: string;
  exerciseName: string;
}) {
  const { width } = useWindowDimensions();
  const [range, setRange] = useState<ExerciseProgressRange>("6m");
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: "50" });
    const from = exerciseProgressRangeStart(range);
    if (from) params.set("from", from);
    setLoading(true);
    setError("");

    void apiRequest<{ progress: ExerciseProgress }>(
      `/api/v1/exercises/${encodeURIComponent(exerciseId)}/progress?${params.toString()}`,
    ).then(({ progress: next }) => {
      if (cancelled) return;
      setProgress(next);
      setSelectedSetId(next.points.at(-1)?.setId ?? null);
    }).catch((caught) => {
      if (cancelled) return;
      setError(caught instanceof Error ? caught.message : "Progress could not be loaded.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [exerciseId, range, requestVersion]));

  const points = progress?.points ?? [];
  const selected = points.find((point) => point.setId === selectedSetId) ?? points.at(-1) ?? null;
  const chartPointCount = width < 560 ? 4 : width < 900 ? 8 : 12;
  const chartPoints = sampleChartPoints(points, chartPointCount);
  const chartValues = chartPoints.map((point) => point.value);
  const chartMinimum = chartValues.length ? Math.min(...chartValues) : 0;
  const chartMaximum = chartValues.length ? Math.max(...chartValues) : 0;
  const chartPadding = chartMaximum === chartMinimum
    ? Math.max(1, chartMaximum * 0.05)
    : (chartMaximum - chartMinimum) * 0.12;
  const chartLow = Math.max(0, chartMinimum - chartPadding);
  const chartHigh = chartMaximum + chartPadding;
  const chartSpan = Math.max(1, chartHigh - chartLow);
  const first = points[0] ?? null;
  const latest = points.at(-1) ?? null;
  const change = first && latest ? latest.value - first.value : 0;
  const summary = useMemo(() => {
    if (!progress || !points.length) return `${exerciseName} has no comparable progress observations in this range.`;
    const latestLabel = progressValueLabel(latest!.value, progress.metric, progress.unit);
    return `${exerciseName} ${metricTitle(progress.metric).toLowerCase()}: ${points.length} observations. Latest ${latestLabel}.${progress.hasMore ? ` Showing the latest ${points.length} observations.` : ""}`;
  }, [exerciseName, latest, points.length, progress]);

  return (
    <Card style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Eyebrow>Progress</Eyebrow>
          <Heading size="medium">{progress ? metricTitle(progress.metric) : "Exercise trend"}</Heading>
        </View>
        {latest && progress ? (
          <View style={styles.latestValue}>
            <Text style={styles.latestValueText}>
              {progressValueLabel(latest.value, progress.metric, progress.unit)}
            </Text>
            <Text style={styles.latestValueLabel}>Latest</Text>
          </View>
        ) : null}
      </View>

      <View accessibilityRole="tablist" style={styles.rangeRow}>
        {rangeOptions.map(([value, label, accessibleLabel]) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityLabel={`Show ${accessibleLabel} of progress`}
            accessibilityState={{ selected: range === value }}
            onPress={() => {
              if (value === range) return;
              setLoading(true);
              setError("");
              setProgress(null);
              setSelectedSetId(null);
              setRange(value);
            }}
            style={({ pressed }) => [
              styles.rangeButton,
              range === value && styles.rangeButtonSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[
              styles.rangeButtonText,
              range === value && styles.rangeButtonTextSelected,
            ]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {loading && progress ? (
        <Text accessibilityLiveRegion="polite" style={styles.refreshing}>Refreshing…</Text>
      ) : null}

      {loading && !progress ? <Body muted>Loading progress…</Body> : null}
      {error ? (
        <View style={styles.stateBlock}>
          <Message>{error}</Message>
          <Button
            title="Try again"
            variant="secondary"
            onPress={() => setRequestVersion((value) => value + 1)}
          />
        </View>
      ) : null}

      {!error && progress ? (
        <>
          <Body muted>{metricExplanation(progress.metric)}</Body>
          <Text accessibilityLabel={summary} style={styles.screenReaderOnly}>{summary}</Text>
          {progress.hasMore ? (
            <Text style={styles.limitNotice}>
              Showing the latest {points.length} comparable workouts in this range.
            </Text>
          ) : null}
          {!points.length ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No comparable sets yet</Text>
              <Body muted>Complete a non-warm-up working set to start this chart.</Body>
            </View>
          ) : (
            <>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>{progress.hasMore ? "Change shown" : "Change"}</Text>
                  <Text style={styles.summaryValue}>
                    {points.length < 2
                      ? "Baseline"
                      : progressDeltaLabel(change, progress.metric, progress.unit)}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Latest set</Text>
                  <Text style={styles.summaryValue}>{progressSetLabel(latest!)}</Text>
                </View>
              </View>

              {points.length === 1 ? (
                <View accessible accessibilityLabel={summary} style={styles.baselineState}>
                  <Text style={styles.baselineTitle}>Baseline recorded</Text>
                  <Text style={styles.baselineCopy}>
                    Your next comparable workout will start the trend.
                  </Text>
                </View>
              ) : (
                <View
                  accessible={false}
                  style={styles.chart}
                >
                  <View style={styles.axisLabels}>
                    <Text style={styles.axisLabel}>
                      {progressValueLabel(chartHigh, progress.metric, progress.unit)}
                    </Text>
                    <Text style={styles.axisLabel}>
                      {progressValueLabel(chartLow, progress.metric, progress.unit)}
                    </Text>
                  </View>
                  <View style={styles.plot}>
                    <View style={[styles.gridLine, styles.gridLineTop]} />
                    <View style={[styles.gridLine, styles.gridLineMiddle]} />
                    <View style={[styles.gridLine, styles.gridLineBottom]} />
                    <View style={styles.pointRow}>
                      {chartPoints.map((point) => {
                        const normalized = (point.value - chartLow) / chartSpan;
                        const stemHeight = 14 + Math.max(0, Math.min(1, normalized)) * 104;
                        const isSelected = selected?.setId === point.setId;
                        return (
                          <Pressable
                            key={point.setId}
                            accessibilityRole="button"
                            accessibilityLabel={`${formatPointDate(point.performedAt, true)}, ${progressValueLabel(point.value, progress.metric, progress.unit)}, from ${progressSetLabel(point)}`}
                            accessibilityState={{ selected: isSelected }}
                            onPress={() => setSelectedSetId(point.setId)}
                            style={({ pressed }) => [
                              styles.pointTrack,
                              pressed && styles.pressed,
                            ]}
                          >
                            <View style={[styles.stem, { height: stemHeight }]}>
                              <View style={[styles.point, isSelected && styles.pointSelected]} />
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={styles.dateAxis}>
                      <Text style={styles.dateLabel}>{formatPointDate(chartPoints[0]!.performedAt)}</Text>
                      <Text style={styles.dateLabel}>{formatPointDate(chartPoints.at(-1)!.performedAt)}</Text>
                    </View>
                  </View>
                </View>
              )}

              {selected ? (
                <View style={styles.selectedPoint}>
                  <View style={styles.selectedCopy}>
                    <Text style={styles.selectedDate}>
                      {formatPointDate(selected.performedAt, true)} · {selected.routineTitle}
                    </Text>
                    <Text style={styles.selectedSet}>{progressSetLabel(selected)}</Text>
                    <Text style={styles.selectedEstimate}>
                      {progressValueLabel(selected.value, progress.metric, progress.unit)} · {statusLabel(selected.workoutStatus)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`Open workout from ${formatPointDate(selected.performedAt, true)}`}
                    onPress={() => router.push(`/history/${selected.workoutId}`)}
                    style={({ pressed }) => [styles.openWorkout, pressed && styles.pressed]}
                  >
                    <Text style={styles.openWorkoutText}>Open workout →</Text>
                  </Pressable>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showData }}
                onPress={() => setShowData((value) => !value)}
                style={({ pressed }) => [styles.dataToggle, pressed && styles.pressed]}
              >
                <Text style={styles.dataToggleText}>{showData ? "Hide data" : "View data"}</Text>
              </Pressable>
              {showData ? (
                <View accessibilityLiveRegion="polite" style={styles.dataList}>
                  {points.map((point) => (
                    <Pressable
                      key={`data-${point.setId}`}
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${formatPointDate(point.performedAt, true)} workout, ${progressSetLabel(point)}, ${progressValueLabel(point.value, progress.metric, progress.unit)}`}
                      onPress={() => router.push(`/history/${point.workoutId}`)}
                      style={({ pressed }) => [styles.dataRow, pressed && styles.pressed]}
                    >
                      <Text style={styles.dataDate}>{formatPointDate(point.performedAt, true)}</Text>
                      <View style={styles.dataResult}>
                        <Text style={styles.dataSet}>{progressSetLabel(point)}</Text>
                        <Text style={styles.dataEstimate}>
                          {progressValueLabel(point.value, progress.metric, progress.unit)}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                  {progress.hasMore ? (
                    <Text style={styles.limitNote}>Earlier comparable workouts are outside this view.</Text>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  headingRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  headingCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  latestValue: { alignItems: "flex-end", gap: 2 },
  latestValueText: { color: colors.accent, fontSize: 18, fontWeight: "900" },
  latestValueLabel: { color: colors.textDim, fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  rangeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  rangeButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  rangeButtonSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  rangeButtonText: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
  rangeButtonTextSelected: { color: colors.accent },
  pressed: { opacity: 0.72 },
  refreshing: { color: colors.textDim, fontSize: 10, fontWeight: "700" },
  screenReaderOnly: { position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" },
  limitNotice: { color: colors.warning, fontSize: 10, fontWeight: "700" },
  stateBlock: { gap: spacing.sm },
  emptyState: { gap: spacing.xs, paddingVertical: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  summaryRow: { flexDirection: "row", gap: spacing.sm },
  summaryItem: { flex: 1, minWidth: 0, gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  summaryLabel: { color: colors.textDim, fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  summaryValue: { color: colors.text, fontSize: 13, fontWeight: "800" },
  baselineState: { gap: spacing.xs, padding: spacing.lg, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  baselineTitle: { color: colors.accent, fontSize: 15, fontWeight: "900" },
  baselineCopy: { color: colors.textMuted, fontSize: 12 },
  chart: { flexDirection: "row", minHeight: 172, gap: spacing.sm },
  axisLabels: { width: 64, justifyContent: "space-between", paddingBottom: 28 },
  axisLabel: { color: colors.textDim, fontSize: 9, fontWeight: "700" },
  plot: { flex: 1, minWidth: 0, height: 172, position: "relative" },
  gridLine: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  gridLineTop: { top: 4 },
  gridLineMiddle: { top: 64 },
  gridLineBottom: { top: 124 },
  pointRow: { height: 128, flexDirection: "row", alignItems: "flex-end" },
  pointTrack: { flex: 1, height: 128, minWidth: 0, alignItems: "center", justifyContent: "flex-end" },
  stem: { width: 2, minHeight: 14, backgroundColor: colors.borderStrong, alignItems: "center" },
  point: { position: "absolute", top: -7, width: 14, height: 14, borderRadius: radii.pill, borderWidth: 3, borderColor: colors.surface, backgroundColor: colors.textMuted },
  pointSelected: { width: 18, height: 18, top: -9, borderColor: colors.accentDark, backgroundColor: colors.accent },
  dateAxis: { height: 28, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  dateLabel: { color: colors.textDim, fontSize: 9, fontWeight: "700" },
  selectedPoint: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  selectedCopy: { flex: 1, minWidth: 0, gap: 2 },
  selectedDate: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  selectedSet: { color: colors.text, fontSize: 15, fontWeight: "900" },
  selectedEstimate: { color: colors.textMuted, fontSize: 11 },
  openWorkout: { minHeight: 44, justifyContent: "center" },
  openWorkoutText: { color: colors.accent, fontSize: 11, fontWeight: "900" },
  dataToggle: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  dataToggleText: { color: colors.accent, fontSize: 12, fontWeight: "900" },
  dataList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dataRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  dataDate: { width: 92, color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  dataResult: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  dataSet: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "800" },
  dataEstimate: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  limitNote: { color: colors.textDim, fontSize: 10, paddingTop: spacing.sm },
});
