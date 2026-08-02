import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { apiRequest } from "../../api/client";
import { removePendingSetWritesForWorkout } from "../../api/pending-writes";
import type { BootstrapPayload } from "../../api/types";
import { useAuth } from "../../auth/auth-context";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Heading,
  LoadingView,
  Message,
  RowLink,
  Screen,
} from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";
import { DiscardWorkoutModal } from "../workouts/discard-workout-modal";

export function RoutinesScreen() {
  const { signOut } = useAuth();
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

  return (
    <Screen contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Heading>Routines</Heading>
          <Body muted>Choose a session, review recovery, or continue your workout.</Body>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={() => void signOut()}
          onBlur={() => setFocusedAction(null)}
          onFocus={() => setFocusedAction("sign-out")}
          hitSlop={12}
          style={({ pressed }) => [
            styles.signOutAction,
            pressed && styles.actionPressed,
            focusedAction === "sign-out" && Platform.OS === "web" && styles.webFocusRing,
          ]}
        >
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
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
              accessibilityLabel={`Recovery recommended. ${recommendation.summary}`}
              style={styles.recoveryNotice}
            >
              <View style={styles.recoveryMark} />
              <View style={styles.recoveryCopy}>
                <Text style={styles.recoveryTitle}>Recovery recommended today</Text>
                <Text style={styles.recoveryText}>{recommendation.summary}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.sectionHeading}>
            <Heading size="small">Your routines</Heading>
            {refreshing ? (
              <Text accessibilityLiveRegion="polite" style={styles.refreshing}>Refreshing…</Text>
            ) : null}
          </View>

          {data.routines.length ? (
            <Card style={styles.listCard}>
              {data.routines.map((routine, index) => {
                const guidance = recommendation?.routines.find((item) => item.code === routine.code);
                const isRecommended = routine.code === recommendation?.recommendedRoutineCode;
                const showReason = guidance?.availability !== "available";
                return (
                  <View
                    key={routine.code}
                    style={[
                      styles.routineRow,
                      index === 0 && styles.firstRoutineRow,
                      index === data.routines.length - 1 && styles.lastRoutineRow,
                      isRecommended && styles.recommendedRoutineRow,
                    ]}
                  >
                    <RowLink
                      label={`Open Routine ${routine.code}, ${routine.focus}. ${routine.durationMin} minutes, ${routine.exerciseCount} exercises, ${routine.setCount} sets${
                        isRecommended ? ". Recommended today" : ""
                      }${guidance ? `. ${guidance.availabilityLabel}. ${guidance.availabilityReason}` : ""}`}
                      onPress={() => router.push(`/routines/${routine.code}`)}
                    >
                      <View style={[
                        styles.codeBox,
                        isRecommended && styles.recommendedCodeBox,
                      ]}>
                        <Text style={[
                          styles.code,
                          isRecommended && styles.recommendedCode,
                        ]}>{routine.code}</Text>
                      </View>
                      <View style={styles.rowCopy}>
                        <View style={styles.routineTitleLine}>
                          <Text numberOfLines={2} style={styles.routineName}>{routine.focus}</Text>
                          {isRecommended ? (
                            <View style={styles.recommendedBadge}>
                              <Text style={styles.recommendedBadgeText}>Recommended today</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.routineMeta}>
                          <Text style={styles.meta}>{routine.durationMin} min</Text>
                          <Text style={styles.dot}>·</Text>
                          <Text style={styles.meta}>{routine.exerciseCount} exercises</Text>
                          <Text style={styles.dot}>·</Text>
                          <Text style={styles.meta}>{routine.setCount} sets</Text>
                        </View>
                        {guidance ? (
                          <View style={styles.guidanceLine}>
                            <AvailabilityLabel
                              status={guidance.availability}
                              label={guidance.availabilityLabel}
                            />
                            {showReason ? (
                              <Text numberOfLines={2} style={styles.availabilityReason}>
                                {guidance.availabilityReason}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    </RowLink>
                  </View>
                );
              })}
            </Card>
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
              Estimates use completed sets from the past 72 hours. They do not measure pain,
              sleep, injury, or medical readiness.
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
      <Text style={[
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  signOutAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  signOut: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
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
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  refreshing: { color: colors.textDim, fontSize: 12 },
  listCard: { padding: 0, gap: 0 },
  routineRow: { backgroundColor: colors.surface },
  firstRoutineRow: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  lastRoutineRow: { borderBottomLeftRadius: radii.lg, borderBottomRightRadius: radii.lg },
  recommendedRoutineRow: {
    backgroundColor: colors.accentDark,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  codeBox: {
    width: 34,
    height: 34,
    flexShrink: 0,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  recommendedCodeBox: { borderColor: colors.accent, backgroundColor: colors.background },
  code: { color: colors.text, fontSize: 13, fontWeight: "900" },
  recommendedCode: { color: colors.accent },
  rowCopy: { flex: 1, gap: 5, minWidth: 0 },
  routineTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  routineName: { color: colors.text, fontSize: 15, lineHeight: 19, fontWeight: "800", flexShrink: 1 },
  recommendedBadge: {
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  recommendedBadgeText: {
    color: colors.background,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  routineMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  meta: { color: colors.textDim, fontSize: 11 },
  dot: { color: colors.borderStrong, fontSize: 11 },
  guidanceLine: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 6 },
  availabilityLabel: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 18 },
  availabilityDot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.success },
  availabilityDotCaution: { backgroundColor: colors.warning },
  availabilityDotRecovering: { backgroundColor: colors.danger },
  availabilityText: { color: colors.textMuted, fontSize: 10, lineHeight: 16, fontWeight: "800" },
  availabilityTextCaution: { color: colors.warning },
  availabilityTextRecovering: { color: colors.danger },
  availabilityReason: { color: colors.textDim, fontSize: 10, lineHeight: 16, flex: 1, minWidth: 150 },
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
