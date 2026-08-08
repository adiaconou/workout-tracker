import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { apiRequest } from "../../api/client";
import type { ExerciseProgress } from "../../api/types";
import { colors, radii, spacing } from "../../theme/tokens";
import { useProfile } from "../../profile/profile-context";
import { exerciseProgressRangeStart } from "../exercises/exercise-progress-range";
import { buildLineChartGeometry, progressTrend } from "./active-exercise-progress";

const FRAME_HEIGHT = 184;
const STATE_HEIGHT = 118;
const PLOT_HEIGHT = 78;
const PLOT_PADDING_X = 8;
const PLOT_PADDING_Y = 10;

function displayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function valueLabel(value: number, progress: ExerciseProgress) {
  if (progress.unit === "seconds") return `${displayNumber(value)} sec`;
  return `${displayNumber(value)} ${progress.unit}`;
}

function metricTitle(progress: ExerciseProgress) {
  if (progress.metric === "epley_estimated_1rm") return "Est. strength";
  if (progress.metric === "epley_estimated_total_load") {
    return "Est. total-load strength";
  }
  if (progress.metric === "duration") return "Duration";
  if (progress.metric === "rounds") return "Rounds";
  return "Reps";
}

function pointDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
}

function trendLabel(progress: ExerciseProgress) {
  const values = progress.points.map((point) => point.value);
  const trend = progressTrend(values);
  if (trend === "empty") return "";
  if (trend === "one") return "1 point · Baseline";
  const delta = values.at(-1)! - values[0]!;
  if (trend === "equal") return "No change";
  return `${trend === "up" ? "↑ Up" : "↓ Down"} ${valueLabel(Math.abs(delta), progress)}`;
}

function LinePlot({ progress }: { progress: ExerciseProgress }) {
  const [width, setWidth] = useState(0);
  const geometry = useMemo(
    () => buildLineChartGeometry(
      progress.points.map((point) => point.value),
      width,
      PLOT_HEIGHT,
      PLOT_PADDING_X,
      PLOT_PADDING_Y,
      progress.points.map((point) => Date.parse(point.performedAt)),
    ),
    [progress.points, width],
  );
  const usesEstimatedBodyWeight = progress.points.some((point) => point.bodyWeightEstimated);

  function measure(event: LayoutChangeEvent) {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth !== width) setWidth(nextWidth);
  }

  const accessibilityLabel = `${metricTitle(progress)} for ${progress.points.length} completed set${progress.points.length === 1 ? "" : "s"} in the last 6 months. ${trendLabel(progress)}. Latest ${valueLabel(progress.points.at(-1)!.value, progress)}.${usesEstimatedBodyWeight ? " Some points use estimated body weight." : ""}`;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={styles.linePlot}
    >
      <View onLayout={measure} style={styles.plot}>
        <View style={[styles.gridLine, styles.gridLineTop]} />
        <View style={[styles.gridLine, styles.gridLineMiddle]} />
        <View style={[styles.gridLine, styles.gridLineBottom]} />
        {geometry.slice(1).map((point, index) => {
          const previous = geometry[index]!;
          const dx = point.x - previous.x;
          const dy = point.y - previous.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);
          return (
            <View
              key={`line-${progress.points[index + 1]!.setId}`}
              pointerEvents="none"
              style={[
                styles.line,
                {
                  left: (previous.x + point.x) / 2 - length / 2,
                  top: (previous.y + point.y) / 2 - 1,
                  width: length,
                  transform: [{ rotateZ: `${angle}rad` }],
                },
              ]}
            />
          );
        })}
        {geometry.map((point, index) => (
          <View
            key={progress.points[index]!.setId}
            pointerEvents="none"
            style={[
              styles.point,
              index === geometry.length - 1 && styles.latestPoint,
              progress.points[index]!.bodyWeightEstimated && styles.estimatedPoint,
              {
                left: point.x - (index === geometry.length - 1 ? 5 : 4),
                top: point.y - (index === geometry.length - 1 ? 5 : 4),
              },
            ]}
          />
        ))}
      </View>
      <View style={[
        styles.dateAxis,
        progress.points.length === 1 && styles.dateAxisSingle,
      ]}>
        <Text style={styles.dateLabel}>{pointDate(progress.points[0]!.performedAt)}</Text>
        {progress.points.length > 1 ? (
          <Text style={styles.dateLabel}>{pointDate(progress.points.at(-1)!.performedAt)}</Text>
        ) : null}
      </View>
      {usesEstimatedBodyWeight ? (
        <Text style={styles.estimatedNote}>Hollow points use estimated body weight</Text>
      ) : null}
    </View>
  );
}

export function ActiveExerciseProgressChart({
  exerciseId,
  exerciseName,
}: {
  exerciseId: string;
  exerciseName: string;
}) {
  const { profile } = useProfile();
  const preferredWeightUnit = profile?.measurementSystem === "metric" ? "kg" : "lb";
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const from = exerciseProgressRangeStart("6m");
    const params = new URLSearchParams({
      from: from!,
      limit: "50",
      unit: preferredWeightUnit,
    });
    setLoading(true);
    setError("");
    setProgress(null);

    void apiRequest<{ progress: ExerciseProgress }>(
      `/api/v1/exercises/${encodeURIComponent(exerciseId)}/progress?${params.toString()}`,
    ).then(({ progress: next }) => {
      if (!cancelled) setProgress(next);
    }).catch((caught) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : "Progress could not be loaded.");
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [exerciseId, preferredWeightUnit, requestVersion]);

  const points = progress?.points ?? [];
  const latest = points.at(-1);

  return (
    <View style={styles.frame}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text numberOfLines={1} style={styles.heading}>
            {progress ? metricTitle(progress) : "Exercise trend"}
          </Text>
          <Text style={styles.range}>Last 6 months</Text>
        </View>
        {progress && latest ? (
          <View style={styles.latest}>
            <Text style={styles.latestValue}>{valueLabel(latest.value, progress)}</Text>
            <Text style={styles.trend}>{trendLabel(progress)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.stateArea}>
        {loading ? (
          <View accessibilityLiveRegion="polite" style={styles.centeredState}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.stateText}>Loading 6 month progress…</Text>
          </View>
        ) : error ? (
          <View accessibilityRole="alert" style={styles.errorState}>
            <Text numberOfLines={2} style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retry ${exerciseName} progress`}
              onPress={() => setRequestVersion((value) => value + 1)}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : !progress || !points.length ? (
          <View accessibilityLiveRegion="polite" style={styles.centeredState}>
            <Text style={styles.emptyText}>No completed sets in the last 6 months</Text>
          </View>
        ) : (
          <LinePlot progress={progress} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    minHeight: FRAME_HEIGHT,
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  headingRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headingCopy: { flex: 1, minWidth: 0 },
  heading: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  range: { color: colors.textDim, fontSize: 9, lineHeight: 13 },
  latest: { flex: 1, minWidth: 0, alignItems: "flex-end" },
  latestValue: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  trend: { color: colors.accent, fontSize: 10, lineHeight: 14, fontWeight: "700" },
  stateArea: { minHeight: STATE_HEIGHT },
  centeredState: {
    height: STATE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  stateText: { color: colors.textDim, fontSize: 11 },
  emptyText: { color: colors.textMuted, fontSize: 12, textAlign: "center" },
  errorState: {
    height: STATE_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  errorText: { flex: 1, minWidth: 0, color: colors.danger, fontSize: 11, lineHeight: 16 },
  retry: {
    minHeight: 44,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  retryText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.72 },
  linePlot: { minHeight: STATE_HEIGHT },
  plot: { height: PLOT_HEIGHT, position: "relative", overflow: "hidden" },
  dateAxis: {
    height: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateAxisSingle: { justifyContent: "center" },
  dateLabel: { color: colors.textDim, fontSize: 9, lineHeight: 13 },
  estimatedNote: { color: colors.textDim, fontSize: 9, lineHeight: 14, textAlign: "right" },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  gridLineTop: { top: PLOT_PADDING_Y },
  gridLineMiddle: { top: PLOT_HEIGHT / 2 },
  gridLineBottom: { bottom: PLOT_PADDING_Y },
  line: {
    position: "absolute",
    height: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  point: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.surfaceRaised,
    backgroundColor: colors.textMuted,
  },
  latestPoint: { width: 10, height: 10, backgroundColor: colors.accent },
  estimatedPoint: {
    borderColor: colors.warning,
    backgroundColor: colors.surfaceRaised,
  },
});
