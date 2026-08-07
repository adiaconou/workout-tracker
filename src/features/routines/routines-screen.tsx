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
import type { BootstrapPayload, WorkoutHistoryPage } from "../../api/types";
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
import {
  formatHistoryDateTime,
  formatWorkoutDuration,
  historyStatusLabel,
} from "../history/history-format";
import { DiscardWorkoutModal } from "../workouts/discard-workout-modal";
import {
  routineDurationLabel,
  routineLastDoneLabel,
} from "./routine-card-format";
import { loadRoutinePageData } from "./routine-page-loader";

export function RoutinesScreen() {
  const { width } = useWindowDimensions();
  const compactLayout = width < 720;
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [recentHistory, setRecentHistory] = useState<WorkoutHistoryPage | null>(null);
  const [recentHistoryError, setRecentHistoryError] = useState("");
  const [recentHistoryLoading, setRecentHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showDiscardWorkout, setShowDiscardWorkout] = useState(false);
  const [discardingWorkout, setDiscardingWorkout] = useState(false);
  const [focusedAction, setFocusedAction] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setRefreshing(true);
    setRecentHistoryLoading(true);
    try {
      const next = await loadRoutinePageData({
        request: apiRequest,
        onRecentHistory: (history) => {
          if (requestId !== latestRequest.current) return;
          setRecentHistory(history);
          setRecentHistoryError("");
        },
        onRecentHistoryError: () => {
          if (requestId !== latestRequest.current) return;
          setRecentHistoryError("Recent workouts could not be refreshed.");
        },
        onRecentHistorySettled: () => {
          if (requestId === latestRequest.current) setRecentHistoryLoading(false);
        },
      });
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
  const recentWorkouts = recentHistory?.workouts ?? [];

  return (
    <Screen safeTop={false} contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <Heading>Routines</Heading>
        {refreshing ? (
          <Text accessibilityLiveRegion="polite" style={styles.refreshing}>Refreshing…</Text>
        ) : null}
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

          <View style={styles.recentSection}>
            <View style={styles.recentSectionHeader}>
              <Heading level={2} size="small">Last 7 days</Heading>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="View all workout history"
                onPress={() => router.push("/history")}
                onBlur={() => setFocusedAction(null)}
                onFocus={() => setFocusedAction("view-history")}
                style={({ pressed }) => [
                  styles.viewHistoryAction,
                  pressed && styles.actionPressed,
                  focusedAction === "view-history" &&
                    Platform.OS === "web" &&
                    styles.webFocusRing,
                ]}
              >
                <Text style={styles.viewHistoryText}>View all history →</Text>
              </Pressable>
            </View>

            {recentHistoryError && recentWorkouts.length > 0 ? (
              <Text accessibilityLiveRegion="polite" style={styles.recentHistoryNotice}>
                Recent workouts may be out of date.
              </Text>
            ) : null}

            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.headerCell, styles.codeCell]}>#</Text>
                <Text style={[styles.headerCell, styles.recentWorkoutCell]}>Workout</Text>
                {!compactLayout ? (
                  <>
                    <Text style={[styles.headerCell, styles.recentWhenCell]}>When</Text>
                    <Text style={[styles.headerCell, styles.recentResultCell]}>Result</Text>
                    <Text style={[styles.headerCell, styles.recentDurationCell]}>Time</Text>
                  </>
                ) : null}
                <View style={styles.arrowCell} />
              </View>

              {recentWorkouts.length ? recentWorkouts.map((workout, index) => {
                const workoutName = `Routine ${workout.routineCode}`;
                const whenLabel = formatHistoryDateTime(workout.startedAt);
                const statusLabel = historyStatusLabel(workout.status);
                const workoutDuration = formatWorkoutDuration(workout.durationSeconds);
                const skippedLabel = workout.skippedSets
                  ? `, ${workout.skippedSets} skipped`
                  : "";
                return (
                  <View key={workout.id} style={styles.recentWorkoutRow}>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`Review Routine ${workout.routineCode} workout from ${whenLabel}. ${statusLabel}, ${workout.completedSets} of ${workout.totalSets} sets completed${skippedLabel}, ${workout.exerciseCount} exercises, ${workoutDuration}`}
                      onPress={() => router.push(`/history/${workout.id}`)}
                      onBlur={() => setFocusedAction(null)}
                      onFocus={() => setFocusedAction(`history-${workout.id}`)}
                      style={({ pressed }) => [
                        styles.routineLink,
                        styles.recentWorkoutLink,
                        compactLayout && styles.recentWorkoutLinkCompact,
                        pressed && styles.routineLinkPressed,
                        focusedAction === `history-${workout.id}` &&
                          Platform.OS === "web" &&
                          styles.webFocusRing,
                      ]}
                    >
                      <Text style={[styles.code, styles.codeCell]}>{index + 1}</Text>
                      <View style={[
                        styles.recentWorkoutCell,
                        compactLayout && styles.recentWorkoutCellCompact,
                      ]}>
                        <Text numberOfLines={1} style={styles.routineName}>{workoutName}</Text>
                        {compactLayout ? (
                          <>
                            <Text numberOfLines={1} style={styles.compactMeta}>{whenLabel}</Text>
                            <Text numberOfLines={1} style={styles.recentCompactResult}>
                              {statusLabel} · {workout.completedSets}/{workout.totalSets} sets · {workout.exerciseCount} exercises · {workoutDuration}
                            </Text>
                          </>
                        ) : null}
                      </View>
                      {!compactLayout ? (
                        <>
                          <Text numberOfLines={1} style={[styles.value, styles.recentWhenCell]}>
                            {whenLabel}
                          </Text>
                          <View style={[styles.recentResultCell, styles.recentResultCopy]}>
                            <Text style={[
                              styles.recentStatus,
                              workout.status === "Partial" && styles.recentStatusPartial,
                              workout.status === "Abandoned" && styles.recentStatusAbandoned,
                            ]}>{statusLabel}</Text>
                            <Text numberOfLines={1} style={styles.recentResultMeta}>
                              {workout.completedSets}/{workout.totalSets} sets · {workout.exerciseCount} exercises
                            </Text>
                          </View>
                          <Text style={[styles.value, styles.recentDurationCell]}>
                            {workoutDuration}
                          </Text>
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
              }) : (
                <View style={styles.recentEmptyRow}>
                  <Text accessibilityLiveRegion="polite" style={styles.recentEmptyText}>
                    {recentHistoryLoading
                      ? "Loading recent workouts…"
                      : recentHistoryError
                      ? "Recent workouts are temporarily unavailable."
                      : "No workouts in the last 7 days."}
                  </Text>
                </View>
              )}
            </View>
          </View>
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
  recentSection: { gap: spacing.sm, marginTop: spacing.xs },
  recentSectionHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  viewHistoryAction: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  viewHistoryText: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  recentHistoryNotice: { color: colors.warning, fontSize: 11, lineHeight: 16 },
  recentWorkoutRow: {
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  recentWorkoutLink: { minHeight: 58 },
  recentWorkoutLinkCompact: { minHeight: 64, paddingVertical: 7 },
  recentWorkoutCell: { flex: 1.8, minWidth: 140, gap: 3 },
  recentWorkoutCellCompact: { minWidth: 0 },
  recentWhenCell: { flex: 1.5, minWidth: 170 },
  recentResultCell: { flex: 1.3, minWidth: 135 },
  recentResultCopy: { gap: 2 },
  recentDurationCell: { width: 64, flexShrink: 0 },
  recentCompactResult: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "700",
  },
  recentStatus: { color: colors.success, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  recentStatusPartial: { color: colors.warning },
  recentStatusAbandoned: { color: colors.danger },
  recentResultMeta: { color: colors.textDim, fontSize: 9, lineHeight: 12 },
  recentEmptyRow: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  recentEmptyText: { color: colors.textDim, fontSize: 11, lineHeight: 16, textAlign: "center" },
  webFocusRing: {
    outlineColor: colors.accent,
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
});
