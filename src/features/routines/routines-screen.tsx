import { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { apiRequest } from "../../api/client";
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

export function RoutinesScreen() {
  const { signOut } = useAuth();
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

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

  if (!data && refreshing) return <LoadingView label="Loading your program…" />;

  const recommendation = data?.recommendations;
  const recommendedRoutine = data?.routines.find(
    (routine) => routine.code === recommendation?.recommendedRoutineCode,
  );
  const recommendedGuidance = recommendation?.routines.find(
    (routine) => routine.isRecommended,
  );

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Eyebrow>Your program</Eyebrow>
          <Heading>Routines</Heading>
          <Body muted>Choose what fits today. Recovery guidance never locks a routine.</Body>
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
        <Card style={styles.resumeCard}>
          <Eyebrow>Workout in progress</Eyebrow>
          <Heading size="small">Routine {data.activeWorkout.routineCode}</Heading>
          <Body muted>
            {data.activeWorkout.completedSets + data.activeWorkout.skippedSets} of{" "}
            {data.activeWorkout.totalSets} sets recorded
          </Body>
          <Button
            title="Resume workout →"
            onPress={() => router.push(`/workouts/${data.activeWorkout!.id}`)}
          />
        </Card>
      ) : null}

      <Card style={styles.todayCard}>
        <View style={styles.todayTopline}>
          <Eyebrow>Best today</Eyebrow>
          {recommendedGuidance ? (
            <AvailabilityBadge status={recommendedGuidance.availability} label={recommendedGuidance.availabilityLabel} />
          ) : null}
        </View>
        <Heading size="medium">
          {recommendedRoutine
            ? `Routine ${recommendedRoutine.code} · ${recommendedRoutine.focus}`
            : "Take a recovery day"}
        </Heading>
        <Body>{recommendation?.summary ?? "Your recommendation will appear after the program loads."}</Body>
        {recommendedGuidance ? <Body muted>{recommendedGuidance.goalReason}</Body> : null}
        {recommendedRoutine ? (
          <Button
            title={`Review Routine ${recommendedRoutine.code} →`}
            onPress={() => router.push(`/routines/${recommendedRoutine.code}`)}
          />
        ) : null}
      </Card>

      <View style={styles.sectionHeading}>
        <View>
          <Eyebrow>All routines</Eyebrow>
          <Heading size="small">Rolling A → B → C → D</Heading>
        </View>
        {refreshing && data ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
      </View>

      <Card style={styles.listCard}>
        {data?.routines.map((routine, index) => {
          const guidance = recommendation?.routines.find((item) => item.code === routine.code);
          return (
            <RowLink
              key={routine.code}
              label={`Open Routine ${routine.code}, ${routine.focus}`}
              onPress={() => router.push(`/routines/${routine.code}`)}
            >
              <Text style={styles.index}>{String(index + 1).padStart(2, "0")}</Text>
              <View style={styles.codeBox}>
                <Text style={styles.code}>{routine.code}</Text>
              </View>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.routineName}>{routine.focus}</Text>
                <View style={styles.routineMeta}>
                  <Text style={styles.meta}>{routine.exerciseCount} exercises</Text>
                  <Text style={styles.dot}>·</Text>
                  <Text style={styles.meta}>{routine.setCount} sets</Text>
                  {guidance ? (
                    <>
                      <Text style={styles.dot}>·</Text>
                      <Text style={[
                        styles.availabilityInline,
                        guidance.availability === "recovering" && styles.availabilityRecovering,
                      ]}>
                        {guidance.availabilityLabel}
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>
            </RowLink>
          );
        })}
      </Card>

      <Body muted style={styles.guidanceNote}>
        Availability estimates use completed sets from the past 72 hours. They do not measure pain,
        sleep, injury, or medical readiness.
      </Body>
      {Platform.OS === "web" ? (
        <Body muted style={styles.guidanceNote}>
          Install the Android APK for a full-screen native experience without browser chrome.
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

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.lg },
  headerCopy: { flex: 1, gap: spacing.sm },
  signOut: { color: colors.textMuted, fontSize: 13, fontWeight: "700", paddingTop: 2 },
  resumeCard: { borderColor: colors.accent },
  todayCard: { backgroundColor: colors.surfaceRaised, gap: spacing.lg },
  todayTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  badge: { backgroundColor: colors.successSurface, borderColor: colors.success, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  badgeCaution: { backgroundColor: colors.warningSurface, borderColor: colors.warning },
  badgeRecovering: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  badgeText: { color: colors.success, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  badgeTextCaution: { color: colors.warning },
  badgeTextRecovering: { color: colors.danger },
  sectionHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md },
  refreshing: { color: colors.textDim, fontSize: 12 },
  listCard: { padding: 0, overflow: "hidden", gap: 0 },
  index: { width: 20, color: colors.textDim, fontSize: 10, fontVariant: ["tabular-nums"] },
  codeBox: { width: 32, height: 32, borderRadius: radii.sm, backgroundColor: colors.accentDark, alignItems: "center", justifyContent: "center" },
  code: { color: colors.accent, fontSize: 14, fontWeight: "900" },
  rowCopy: { flex: 1, gap: 4, minWidth: 0 },
  routineName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  routineMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  meta: { color: colors.textDim, fontSize: 11 },
  dot: { color: colors.borderStrong, fontSize: 11 },
  availabilityInline: { color: colors.success, fontSize: 11, fontWeight: "700" },
  availabilityRecovering: { color: colors.danger },
  guidanceNote: { fontSize: 12, lineHeight: 18 },
});
