import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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

  const load = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      setData(await apiRequest<BootstrapPayload>("/api/v1/bootstrap"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Routines could not be loaded.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

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
        // The server deletion is authoritative; do not restore the discarded card.
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

  if (!data && refreshing) return <LoadingView label="Loading your program…" />;

  const recommendation = data?.recommendations;
  const recommendedRoutine = data?.routines.find(
    (routine) => routine.code === recommendation?.recommendedRoutineCode,
  );
  const recommendedGuidance = recommendation?.routines.find(
    (routine) => routine.isRecommended,
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
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Heading>Today</Heading>
          <Body muted>Continue training or choose what fits your recovery.</Body>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={12}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {error ? (
        <>
          <Message>{error}</Message>
          <Button title="Try again" onPress={() => void load()} variant="secondary" />
        </>
      ) : null}

      {data?.activeWorkout ? (
        <>
          <Card style={styles.resumeCard}>
            <View style={styles.cardTopline}>
              <View style={styles.cardTitle}>
                <View style={styles.inProgressLabel}>
                  <View style={styles.liveDot} />
                  <Eyebrow>Workout in progress</Eyebrow>
                </View>
                <Heading size="small">
                  Routine {data.activeWorkout.routineCode}
                  {activeRoutine ? ` · ${activeRoutine.focus}` : ""}
                </Heading>
              </View>
              <Text style={styles.progressCount}>
                {activeRecordedSets}/{data.activeWorkout.totalSets}
              </Text>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: data.activeWorkout.totalSets,
                now: activeRecordedSets,
              }}
              style={styles.progressTrack}
            >
              <View
                style={[
                  styles.progressValue,
                  { width: `${activeProgress * 100}%` },
                ]}
              />
            </View>
            <Button
              title="Resume workout →"
              compact
              disabled={discardingWorkout}
              onPress={() => router.push(`/workouts/${data.activeWorkout!.id}`)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Discard Routine ${data.activeWorkout.routineCode} workout`}
              disabled={discardingWorkout}
              onPress={() => setShowDiscardWorkout(true)}
              style={({ pressed }) => [
                styles.discardAction,
                pressed && styles.discardActionPressed,
              ]}
            >
              <Text style={styles.discardActionText}>Discard workout</Text>
            </Pressable>
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

      <Card style={styles.todayCard}>
        <View style={styles.todayTopline}>
          <Eyebrow>Recommended today</Eyebrow>
          {recommendedGuidance ? (
            <AvailabilityBadge status={recommendedGuidance.availability} label={recommendedGuidance.availabilityLabel} />
          ) : null}
        </View>
        <View style={styles.recommendationTitle}>
          <Heading size="medium">
            {recommendedRoutine
              ? `Routine ${recommendedRoutine.code}`
              : "Take a recovery day"}
          </Heading>
          {recommendedRoutine
            ? <Text style={styles.recommendationFocus}>{recommendedRoutine.focus}</Text>
            : null}
        </View>
        <Body>{recommendation?.summary ?? "Your recommendation will appear after the program loads."}</Body>
        {recommendedGuidance ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showRecommendationDetails }}
              onPress={() => setShowRecommendationDetails((current) => !current)}
              style={({ pressed }) => [
                styles.disclosure,
                pressed && styles.disclosurePressed,
              ]}
            >
              <Text style={styles.disclosureText}>Why this recommendation</Text>
              <Text style={styles.disclosureIcon}>
                {showRecommendationDetails ? "−" : "+"}
              </Text>
            </Pressable>
            {showRecommendationDetails ? (
              <View style={styles.detailPanel}>
                <Body muted>{recommendedGuidance.goalReason}</Body>
                <Body muted style={styles.detailNote}>
                  Guidance informs your choice; it never locks a routine.
                </Body>
              </View>
            ) : null}
          </>
        ) : null}
        {recommendedRoutine ? (
          data?.activeWorkout ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/routines/${recommendedRoutine.code}`)}
              style={({ pressed }) => [
                styles.reviewLink,
                pressed && styles.reviewLinkPressed,
              ]}
            >
              <Text style={styles.reviewLinkText}>
                Review Routine {recommendedRoutine.code} →
              </Text>
            </Pressable>
          ) : (
            <Button
              title={`Review Routine ${recommendedRoutine.code} →`}
              compact
              onPress={() => router.push(`/routines/${recommendedRoutine.code}`)}
            />
          )
        ) : null}
      </Card>

      <View style={styles.sectionHeading}>
        <Heading size="small">All routines</Heading>
        {refreshing && data ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
      </View>

      <Card style={styles.listCard}>
        {data?.routines.map((routine) => {
          const guidance = recommendation?.routines.find((item) => item.code === routine.code);
          return (
            <RowLink
              key={routine.code}
              label={`Open Routine ${routine.code}, ${routine.focus}${
                guidance ? `, ${guidance.availabilityLabel}` : ""
              }`}
              onPress={() => router.push(`/routines/${routine.code}`)}
            >
              <View style={styles.codeBox}>
                <Text style={styles.code}>{routine.code}</Text>
              </View>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.routineName}>{routine.focus}</Text>
                <View style={styles.routineMeta}>
                  <Text style={styles.meta}>{routine.exerciseCount} exercises</Text>
                  <Text style={styles.dot}>·</Text>
                  <Text style={styles.meta}>{routine.setCount} sets</Text>
                </View>
              </View>
              {guidance ? (
                <AvailabilityLabel
                  status={guidance.availability}
                  label={guidance.availabilityLabel}
                />
              ) : null}
            </RowLink>
          );
        })}
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showAvailabilityHelp }}
        onPress={() => setShowAvailabilityHelp((current) => !current)}
        style={({ pressed }) => [
          styles.availabilityHelp,
          pressed && styles.disclosurePressed,
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
    </Screen>
  );
}

function AvailabilityBadge({
  status,
  label,
}: {
  status: "available" | "caution" | "recovering";
  label: string;
}) {
  return (
    <View style={[
      styles.badge,
      status === "caution" && styles.badgeCaution,
      status === "recovering" && styles.badgeRecovering,
    ]}>
      <Text style={[
        styles.badgeText,
        status === "caution" && styles.badgeTextCaution,
        status === "recovering" && styles.badgeTextRecovering,
      ]}>
        {label}
      </Text>
    </View>
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
      accessible
      accessibilityLabel={`Availability: ${label}`}
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
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.lg },
  headerCopy: { flex: 1, gap: spacing.xs },
  signOut: { color: colors.textMuted, fontSize: 13, fontWeight: "700", paddingTop: 2 },
  resumeCard: { borderColor: colors.borderStrong, gap: spacing.md },
  cardTopline: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  cardTitle: { flex: 1, gap: spacing.sm },
  inProgressLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  liveDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.accent },
  progressCount: { color: colors.textMuted, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  progressTrack: { height: 3, overflow: "hidden", borderRadius: radii.pill, backgroundColor: colors.border },
  progressValue: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.accent },
  discardAction: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  discardActionPressed: { backgroundColor: colors.dangerSurface },
  discardActionText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  todayCard: { backgroundColor: colors.surfaceRaised, gap: spacing.md },
  todayTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  recommendationTitle: { gap: 2 },
  recommendationFocus: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  badge: { backgroundColor: colors.successSurface, borderColor: colors.success, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  badgeCaution: { backgroundColor: colors.warningSurface, borderColor: colors.warning },
  badgeRecovering: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  badgeText: { color: colors.success, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  badgeTextCaution: { color: colors.warning },
  badgeTextRecovering: { color: colors.danger },
  disclosure: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong, paddingTop: spacing.sm },
  disclosurePressed: { opacity: 0.7 },
  disclosureText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  disclosureIcon: { color: colors.textDim, fontSize: 18, fontWeight: "500" },
  detailPanel: { borderLeftWidth: 2, borderLeftColor: colors.borderStrong, paddingLeft: spacing.md, gap: spacing.sm },
  detailNote: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  reviewLink: { minHeight: 40, alignItems: "flex-start", justifyContent: "center", borderRadius: radii.sm },
  reviewLinkPressed: { opacity: 0.7 },
  reviewLinkText: { color: colors.accent, fontSize: 13, fontWeight: "800" },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, marginTop: spacing.sm },
  refreshing: { color: colors.textDim, fontSize: 12 },
  listCard: { padding: 0, overflow: "hidden", gap: 0 },
  codeBox: { width: 30, height: 30, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  code: { color: colors.text, fontSize: 13, fontWeight: "900" },
  rowCopy: { flex: 1, gap: 4, minWidth: 0 },
  routineName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  routineMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  meta: { color: colors.textDim, fontSize: 11 },
  dot: { color: colors.borderStrong, fontSize: 11 },
  availabilityLabel: { flexDirection: "row", alignItems: "center", gap: 5 },
  availabilityDot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.success },
  availabilityDotCaution: { backgroundColor: colors.warning },
  availabilityDotRecovering: { backgroundColor: colors.danger },
  availabilityText: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  availabilityTextCaution: { color: colors.warning },
  availabilityTextRecovering: { color: colors.danger },
  availabilityHelp: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xs },
  availabilityHelpText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  availabilityHelpIcon: { color: colors.textDim, fontSize: 17 },
  guidanceNote: { fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.xs },
});
