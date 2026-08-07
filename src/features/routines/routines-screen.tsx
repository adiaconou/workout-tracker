import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { apiRequest } from "../../api/client";
import { removePendingSetWritesForWorkout } from "../../api/pending-writes";
import type { BootstrapPayload } from "../../api/types";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Heading,
  LoadingView,
  Message,
  Screen,
} from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";
import { DiscardWorkoutModal } from "../workouts/discard-workout-modal";
import {
  routineDurationLabel,
  routineLastDoneLabel,
} from "./routine-card-format";

export function RoutinesScreen() {
  const { width } = useWindowDimensions();
  const compactLayout = width < 720;
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showDiscardWorkout, setShowDiscardWorkout] = useState(false);
  const [discardingWorkout, setDiscardingWorkout] = useState(false);
  const [showRecommendationDetails, setShowRecommendationDetails] = useState(false);
  const [showAvailabilityHelp, setShowAvailabilityHelp] = useState(false);
  const [focusedAction, setFocusedAction] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setRefreshing(true);
    try {
      const next = await apiRequest<BootstrapPayload>("/api/v1/bootstrap");
      if (requestId === latestRequest.current) {
        setData(next);
        setError("");
      }
    } catch (caught) {
      if (requestId === latestRequest.current) {
        setError(caught instanceof Error ? caught.message : "Routines could not be loaded.");
      }
    } finally {
      if (requestId === latestRequest.current) setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  useEffect(() => {
    let lastFocusRefreshAt = 0;
    const refreshAfterFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAt < 250) return;
      lastFocusRefreshAt = now;
      void load();
    };

    if (Platform.OS === "web") {
      const refreshAfterVisibility = () => {
        if (document.visibilityState === "visible") refreshAfterFocus();
      };
      window.addEventListener("focus", refreshAfterFocus);
      document.addEventListener("visibilitychange", refreshAfterVisibility);
      return () => {
        window.removeEventListener("focus", refreshAfterFocus);
        document.removeEventListener("visibilitychange", refreshAfterVisibility);
      };
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") refreshAfterFocus();
    });
    return () => subscription.remove();
  }, [load]);

  async function discardActiveWorkout() {
    const activeWorkout = data?.activeWorkout;
    if (!activeWorkout || discardingWorkout) return;
    setDiscardingWorkout(true);
    setError("");
    try {
      await apiRequest(
        `/api/v1/workouts/${encodeURIComponent(activeWorkout.id)}/discard`,
        { method: "DELETE" },
      );
      setShowDiscardWorkout(false);
      setData((current) => current
        ? { ...current, activeWorkout: null }
        : current);
      try {
        await removePendingSetWritesForWorkout(activeWorkout.id);
      } catch {
        // The server deletion is authoritative; do not restore the discarded banner.
      }
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The workout could not be discarded.",
      );
      setShowDiscardWorkout(false);
    } finally {
      setDiscardingWorkout(false);
    }
  }

  if (!data && refreshing) return <LoadingView label="Loading your routines…" />;

  const recommendation = data?.recommendations;
  const recommendedRoutine = data?.routines.find(
    (routine) => routine.code === recommendation?.recommendedRoutineCode,
  );
  const recommendedGuidance = recommendation?.routines.find(
    (routine) => routine.code === recommendation?.recommendedRoutineCode,
  );
  const activeRoutine = data?.routines.find(
    (routine) => routine.code === data.activeWorkout?.routineCode,
  );
  const activeRecordedSets = data?.activeWorkout
    ? data.activeWorkout.completedSets + data.activeWorkout.skippedSets
    : 0;
  const activeProgress = data?.activeWorkout?.totalSets
    ? Math.min(1, activeRecordedSets / data.activeWorkout.totalSets)
    : 0;
  const renderedAt = new Date();

  return (
    <Screen safeTop={false} contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <Heading>Routines</Heading>
        <View style={styles.headerStats}>
          {data ? <Text style={styles.total}>{data.routines.length} total</Text> : null}
          {refreshing ? (
            <Text accessibilityLiveRegion="polite" style={styles.refreshing}>Refreshing…</Text>
          ) : null}
        </View>
      </View>

      {!data && error ? (
        <Card style={styles.stateCard}>
          <Eyebrow>Unable to load</Eyebrow>
          <Heading size="small">Your routines are temporarily unavailable</Heading>
          <Body muted>Check your connection and try again. No routine data has been changed.</Body>
          <Text style={styles.errorDetail}>{error}</Text>
          <Button title="Try again" onPress={() => void load()} variant="secondary" />
        </Card>
      ) : null}

      {data ? (
        <>
          {error ? (
            <View style={styles.refreshError}>
              <View style={styles.refreshErrorCopy}>
                <Message>These routines may be out of date. {error}</Message>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry refreshing routines"
                onPress={() => void load()}
                onBlur={() => setFocusedAction(null)}
                onFocus={() => setFocusedAction("retry")}
                style={({ pressed }) => [
                  styles.retryAction,
                  pressed && styles.actionPressed,
                  focusedAction === "retry" && Platform.OS === "web" && styles.webFocusRing,
                ]}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {data.activeWorkout ? (
            <>
              <Card style={styles.resumeCard}>
                <View style={styles.resumeTopline}>
                  <View style={styles.resumeCopy}>
                    <View style={styles.inProgressLabel}>
                      <View style={styles.liveDot} />
                      <Eyebrow>Workout in progress</Eyebrow>
                    </View>
                    <Text style={styles.resumeTitle}>
                      Routine {data.activeWorkout.routineCode}
                      {activeRoutine ? ` · ${activeRoutine.focus}` : ""}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`Resume Routine ${data.activeWorkout.routineCode} workout`}
                    disabled={discardingWorkout}
                    onPress={() => router.push(`/workouts/${data.activeWorkout!.id}`)}
                    onBlur={() => setFocusedAction(null)}
                    onFocus={() => setFocusedAction("resume")}
                    style={({ pressed }) => [
                      styles.resumeAction,
                      discardingWorkout && styles.actionDisabled,
                      pressed && styles.resumeActionPressed,
                      focusedAction === "resume" && Platform.OS === "web" && styles.webFocusRing,
                    ]}
                  >
                    <Text style={styles.resumeActionText}>Resume →</Text>
                  </Pressable>
                </View>
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel="Workout set progress"
                  accessibilityValue={{
                    min: 0,
                    max: data.activeWorkout.totalSets,
                    now: activeRecordedSets,
                  }}
                  style={styles.progressTrack}
                >
                  <View style={[styles.progressValue, { width: `${activeProgress * 100}%` }]} />
                </View>
                <View style={styles.resumeFooter}>
                  <Text style={styles.progressCount}>
                    {activeRecordedSets} of {data.activeWorkout.totalSets} sets recorded
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Discard Routine ${data.activeWorkout.routineCode} workout`}
                    disabled={discardingWorkout}
                    onPress={() => setShowDiscardWorkout(true)}
                    onBlur={() => setFocusedAction(null)}
                    onFocus={() => setFocusedAction("discard")}
                    style={({ pressed }) => [
                      styles.discardAction,
                      discardingWorkout && styles.actionDisabled,
                      pressed && styles.discardActionPressed,
                      focusedAction === "discard" && Platform.OS === "web" && styles.webFocusRing,
                    ]}
                  >
                    <Text style={styles.discardActionText}>Discard workout</Text>
                  </Pressable>
                </View>
              </Card>
              <DiscardWorkoutModal
                visible={showDiscardWorkout}
                routineCode={data.activeWorkout.routineCode}
                recordedSets={
                  data.activeWorkout.completedSets + data.activeWorkout.skippedSets
                }
                discarding={discardingWorkout}
                onCancel={() => setShowDiscardWorkout(false)}
                onConfirm={() => void discardActiveWorkout()}
              />
            </>
          ) : null}

          {recommendation?.recommendedRoutineCode === null ? (
            <View
              accessible
              accessibilityLabel={`Recovery suggested. ${recommendation.summary}`}
              style={styles.recoveryNotice}
            >
              <View style={styles.recoveryMark} />
              <View style={styles.recoveryCopy}>
                <Text style={styles.recoveryTitle}>Recovery suggested today</Text>
                <Text style={styles.recoveryText}>{recommendation.summary}</Text>
              </View>
            </View>
          ) : null}

          {data.routines.length ? (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.headerCell, styles.codeCell]}>#</Text>
                <Text style={[styles.headerCell, styles.routineCell]}>Routine</Text>
                {!compactLayout ? (
                  <>
                    <Text style={[styles.headerCell, styles.planCell]}>Plan</Text>
                    <Text style={[styles.headerCell, styles.lastDoneCell]}>Last done</Text>
                    <Text style={[styles.headerCell, styles.statusCell]}>Status</Text>
                  </>
                ) : null}
                <View style={styles.arrowCell} />
              </View>
              {data.routines.map((routine) => {
                const guidance = recommendation?.routines.find((item) => item.code === routine.code);
                const isRecommended = routine.code === recommendation?.recommendedRoutineCode;
                const lastDoneLabel = routineLastDoneLabel(routine.lastWorkoutAt, { now: renderedAt });
                const durationLabel = routineDurationLabel(
                  routine.averageDurationSeconds,
                  routine.durationSampleCount,
                  routine.durationMin,
                );
                return (
                  <View
                    key={routine.code}
                    style={[
                      styles.routineRow,
                      isRecommended && styles.recommendedRoutineRow,
                    ]}
                  >
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`Open Routine ${routine.code}, ${routine.focus}. ${durationLabel}, ${routine.exerciseCount} exercises, ${routine.setCount} sets${
                        isRecommended ? ". Recommended today" : ""
                      }. ${lastDoneLabel}${guidance ? `. ${guidance.availabilityLabel}` : ""}`}
                      onPress={() => router.push(`/routines/${routine.code}`)}
                      onBlur={() => setFocusedAction(null)}
                      onFocus={() => setFocusedAction(`routine-${routine.code}`)}
                      style={({ pressed }) => [
                        styles.routineLink,
                        pressed && styles.routineLinkPressed,
                        focusedAction === `routine-${routine.code}` &&
                          Platform.OS === "web" &&
                          styles.webFocusRing,
                      ]}
                    >
                      <Text style={[
                        styles.code,
                        styles.codeCell,
                        isRecommended && styles.recommendedCode,
                      ]}>{routine.code}</Text>
                      <View style={[
                        styles.routineCell,
                        compactLayout && styles.routineCellCompact,
                      ]}>
                        <View style={styles.routineTitleLine}>
                          <Text numberOfLines={1} style={styles.routineName}>{routine.focus}</Text>
                          {isRecommended ? (
                            <View style={styles.recommendedBadge}>
                              <Text style={styles.recommendedBadgeText}>Recommended today</Text>
                            </View>
                          ) : null}
                        </View>
                        {compactLayout ? (
                          <>
                            <Text numberOfLines={1} style={styles.compactMeta}>
                              {durationLabel} · {routine.exerciseCount} exercises · {routine.setCount} sets
                            </Text>
                            <View style={[
                              styles.routineStatusLine,
                              !routine.lastWorkoutAt && styles.routineStatusLineWithoutHistory,
                            ]}>
                              <Text style={styles.lastDone}>{lastDoneLabel}</Text>
                              {guidance ? (
                                <AvailabilityLabel
                                  status={guidance.availability}
                                  label={guidance.availabilityLabel}
                                />
                              ) : null}
                            </View>
                          </>
                        ) : null}
                      </View>
                      {!compactLayout ? (
                        <>
                          <Text numberOfLines={1} style={[styles.value, styles.planCell]}>
                            {durationLabel} · {routine.exerciseCount} exercises · {routine.setCount} sets
                          </Text>
                          <Text numberOfLines={1} style={[styles.value, styles.lastDoneCell]}>
                            {lastDoneLabel}
                          </Text>
                          <View style={styles.statusCell}>
                            {guidance ? (
                              <AvailabilityLabel
                                status={guidance.availability}
                                label={guidance.availabilityLabel}
                              />
                            ) : <Text style={styles.value}>—</Text>}
                          </View>
                        </>
                      ) : null}
                      <Text
                        aria-hidden
                        accessible={false}
                        style={[styles.arrow, styles.arrowCell]}
                      >→</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : (
            <Card style={styles.stateCard}>
              <Eyebrow>Start your program</Eyebrow>
              <Heading size="small">No routines yet</Heading>
              <Body muted>Ask Coach to build a routine, or return after one has been added from another device.</Body>
              <Button title="Open Coach" onPress={() => router.push("/coach")} />
            </Card>
          )}

          {recommendedRoutine && recommendedGuidance ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Why Routine ${recommendedRoutine.code} is recommended`}
                accessibilityState={{ expanded: showRecommendationDetails }}
                onPress={() => setShowRecommendationDetails((current) => !current)}
                onBlur={() => setFocusedAction(null)}
                onFocus={() => setFocusedAction("recommendation-details")}
                style={({ pressed }) => [
                  styles.disclosure,
                  pressed && styles.actionPressed,
                  focusedAction === "recommendation-details" &&
                    Platform.OS === "web" &&
                    styles.webFocusRing,
                ]}
              >
                <Text style={styles.disclosureText}>
                  Why Routine {recommendedRoutine.code} is recommended
                </Text>
                <Text style={styles.disclosureIcon}>
                  {showRecommendationDetails ? "−" : "+"}
                </Text>
              </Pressable>
              {showRecommendationDetails ? (
                <View style={styles.detailPanel}>
                  <Body>{recommendation?.summary ?? recommendedGuidance.goalReason}</Body>
                  <Body muted>{recommendedGuidance.goalReason}</Body>
                  {recommendedGuidance.availability !== "available" ? (
                    <Body muted>{recommendedGuidance.availabilityReason}</Body>
                  ) : null}
                  <Body muted style={styles.detailNote}>
                    This guidance informs your choice; it never locks a routine.
                  </Body>
                </View>
              ) : null}
            </>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="How routine availability works"
            accessibilityState={{ expanded: showAvailabilityHelp }}
            onPress={() => setShowAvailabilityHelp((current) => !current)}
            onBlur={() => setFocusedAction(null)}
            onFocus={() => setFocusedAction("availability-help")}
            style={({ pressed }) => [
              styles.availabilityHelp,
              pressed && styles.actionPressed,
              focusedAction === "availability-help" &&
                Platform.OS === "web" &&
                styles.webFocusRing,
            ]}
          >
            <Text style={styles.availabilityHelpText}>How availability works</Text>
            <Text style={styles.availabilityHelpIcon}>
              {showAvailabilityHelp ? "−" : "+"}
            </Text>
          </Pressable>
          {showAvailabilityHelp ? (
            <Body muted style={styles.guidanceNote}>
              These overlap estimates use completed sets logged in the past 72 hours. They do
              not measure soreness, pain, sleep, stress, injury, warm-up performance, or medical
              readiness. You can always choose a different routine.
            </Body>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function AvailabilityLabel({
  status,
  label,
}: {
  status: "available" | "caution" | "recovering";
  label: string;
}) {
  return (
    <View
      aria-hidden
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.availabilityLabel}
    >
      <View style={[
        styles.availabilityDot,
        status === "caution" && styles.availabilityDotCaution,
        status === "recovering" && styles.availabilityDotRecovering,
      ]} />
      <Text numberOfLines={2} style={[
        styles.availabilityText,
        status === "caution" && styles.availabilityTextCaution,
        status === "recovering" && styles.availabilityTextRecovering,
      ]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingTop: spacing.lg, gap: spacing.md },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerStats: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  total: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  refreshing: { color: colors.textDim, fontSize: 12 },
  actionPressed: { opacity: 0.68 },
  actionDisabled: { opacity: 0.45 },
  stateCard: { alignItems: "flex-start", gap: spacing.md },
  errorDetail: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  refreshError: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  refreshErrorCopy: { flex: 1, minWidth: 0 },
  retryAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: "800" },
  resumeCard: { borderColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm },
  resumeTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  resumeCopy: { flex: 1, minWidth: 0, gap: 3 },
  inProgressLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  liveDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.accent },
  resumeTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  resumeAction: {
    minHeight: 44,
    minWidth: 92,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  resumeActionPressed: { opacity: 0.78 },
  resumeActionText: { color: colors.background, fontSize: 13, fontWeight: "900" },
  progressTrack: {
    height: 4,
    overflow: "hidden",
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  progressValue: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.accent },
  resumeFooter: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  progressCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  discardAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  discardActionPressed: { backgroundColor: colors.dangerSurface },
  discardActionText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  recoveryNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radii.md,
    backgroundColor: colors.warningSurface,
  },
  recoveryMark: {
    width: 8,
    height: 8,
    marginTop: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.warning,
  },
  recoveryCopy: { flex: 1, minWidth: 0, gap: 2 },
  recoveryTitle: { color: colors.warning, fontSize: 13, fontWeight: "800" },
  recoveryText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  table: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  tableHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingRight: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  headerCell: {
    color: colors.textDim,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  routineRow: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  recommendedRoutineRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  routineLink: {
    minHeight: 54,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: 6,
  },
  routineLinkPressed: { backgroundColor: colors.surfaceRaised },
  codeCell: { width: 24 },
  code: { color: colors.textDim, fontSize: 10, fontWeight: "900" },
  recommendedCode: { color: colors.accent },
  routineCell: { flex: 2.2, minWidth: 140, gap: 3 },
  routineCellCompact: { minWidth: 0 },
  planCell: { flex: 1.8, minWidth: 150 },
  lastDoneCell: { flex: 1.25, minWidth: 112 },
  statusCell: { flex: 1.1, minWidth: 94 },
  routineTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  routineName: { color: colors.text, fontSize: 12, lineHeight: 15, fontWeight: "700", flexShrink: 1 },
  recommendedBadge: {
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  recommendedBadgeText: {
    color: colors.background,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  compactMeta: { color: colors.textDim, fontSize: 9, lineHeight: 12 },
  value: { color: colors.textMuted, fontSize: 10, lineHeight: 15 },
  arrow: { color: colors.textDim, fontSize: 13 },
  arrowCell: { width: 13, flexShrink: 0 },
  routineStatusLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  routineStatusLineWithoutHistory: { flexDirection: "column", alignItems: "flex-start", gap: 2 },
  lastDone: { color: colors.textMuted, fontSize: 9, lineHeight: 15, fontWeight: "700" },
  availabilityLabel: {
    minWidth: 0,
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
  },
  availabilityDot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.success },
  availabilityDotCaution: { backgroundColor: colors.warning },
  availabilityDotRecovering: { backgroundColor: colors.danger },
  availabilityText: {
    minWidth: 0,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "800",
    flexShrink: 1,
  },
  availabilityTextCaution: { color: colors.warning },
  availabilityTextRecovering: { color: colors.danger },
  disclosure: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  disclosureText: { color: colors.textMuted, fontSize: 12, fontWeight: "700", flex: 1 },
  disclosureIcon: { color: colors.textDim, fontSize: 18, fontWeight: "500" },
  detailPanel: {
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    paddingLeft: spacing.md,
    gap: spacing.sm,
  },
  detailNote: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  availabilityHelp: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  availabilityHelpText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  availabilityHelpIcon: { color: colors.textDim, fontSize: 17 },
  guidanceNote: { fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.xs },
  webFocusRing: {
    outlineColor: colors.accent,
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
});
