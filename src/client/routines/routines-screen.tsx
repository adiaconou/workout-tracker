import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { apiRequest } from "../api/client";
import { removePendingSetWritesForWorkout } from "../api/pending-writes";
import type { BootstrapPayload, RoutineSummary } from "../../contracts/api";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Heading,
  LoadingView,
  Message,
  Screen,
} from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import { DiscardWorkoutModal } from "../workouts/public";
import {
  routineAvailabilityKind,
  routineDurationLabel,
  routineLastDoneLabel,
  routineMuscleTitle,
  sortRoutinesByLastDone,
  type RoutineAvailabilityKind,
} from "./routine-card-format";
import { loadRoutinePageData } from "./routine-page-loader";

type StartResponse = {
  created: boolean;
  requiresConfirmation: boolean;
  session: { id: string; routineCode: string };
};

type PendingStart = {
  activeRoutineCode: string;
  routineCode: string;
};

type AvailabilityKeyAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AvailabilityKeyPosition = {
  top: number;
  right: number;
  width: number;
  maxHeight: number;
};

const AVAILABILITY_KEY: Array<{
  kind: RoutineAvailabilityKind;
  label: string;
  description: string;
}> = [
  {
    kind: "recommended",
    label: "Recommended",
    description: "Best available option for today’s rolling plan.",
  },
  {
    kind: "available",
    label: "Available",
    description: "Equipment is available with lower recent muscle overlap.",
  },
  {
    kind: "caution",
    label: "Use caution",
    description: "Recent muscle overlap or missing guidance; you can still start.",
  },
  {
    kind: "unavailable",
    label: "Unavailable",
    description: "Required equipment is not in your Training setup.",
  },
];

export function RoutinesScreen() {
  const { height, width } = useWindowDimensions();
  const compactLayout = width < 720;
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState("");
  const [startError, setStartError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showDiscardWorkout, setShowDiscardWorkout] = useState(false);
  const [discardingWorkout, setDiscardingWorkout] = useState(false);
  const [availabilityKeyOpen, setAvailabilityKeyOpen] = useState(false);
  const [availabilityKeyAnchor, setAvailabilityKeyAnchor] = useState<AvailabilityKeyAnchor | null>(null);
  const [expandedRoutineCode, setExpandedRoutineCode] = useState<string | null>(null);
  const [startingRoutineCode, setStartingRoutineCode] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const [focusedAction, setFocusedAction] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setRefreshing(true);
    try {
      const next = await loadRoutinePageData({ request: apiRequest });
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

  async function startWorkout(routineCode: string, abandonActive = false) {
    if (startingRoutineCode) return;
    const activeWorkout = data?.activeWorkout;
    if (!abandonActive && activeWorkout?.routineCode === routineCode) {
      router.push(`/workouts/${activeWorkout.id}`);
      return;
    }

    setStartingRoutineCode(routineCode);
    setStartError("");
    try {
      const payload = await apiRequest<StartResponse>("/api/v1/workouts", {
        method: "POST",
        body: JSON.stringify({ routineId: routineCode, abandonActive }),
      });
      if (payload.requiresConfirmation) {
        setPendingStart({
          activeRoutineCode: payload.session.routineCode,
          routineCode,
        });
        return;
      }
      setPendingStart(null);
      router.push(`/workouts/${payload.session.id}`);
    } catch (caught) {
      setStartError(
        caught instanceof Error
          ? caught.message
          : "The workout could not be started.",
      );
    } finally {
      setStartingRoutineCode(null);
    }
  }

  function toggleAvailabilityKey(anchor: AvailabilityKeyAnchor | null) {
    if (availabilityKeyOpen) {
      setAvailabilityKeyOpen(false);
      return;
    }
    setAvailabilityKeyAnchor(anchor);
    setAvailabilityKeyOpen(true);
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
  const sortedRoutines = sortRoutinesByLastDone(data?.routines ?? []);
  const keyPanelWidth = Math.min(
    compactLayout ? 430 : 760,
    Math.max(0, width - spacing.lg * 2),
  );
  const keyPanelBelowTop = availabilityKeyAnchor
    ? availabilityKeyAnchor.y + availabilityKeyAnchor.height + spacing.sm
    : spacing.xxl;
  const keyPanelSpaceBelow = height - keyPanelBelowTop - spacing.lg;
  const keyPanelSpaceAbove = (availabilityKeyAnchor?.y ?? height) - spacing.lg - spacing.sm;
  const keyPanelOpensBelow = !availabilityKeyAnchor
    || keyPanelSpaceBelow >= 240
    || keyPanelSpaceBelow >= keyPanelSpaceAbove;
  const keyPanelIdealRight = availabilityKeyAnchor
    ? width - availabilityKeyAnchor.x - availabilityKeyAnchor.width
    : spacing.lg;
  const keyPanelMaxRight = Math.max(spacing.lg, width - keyPanelWidth - spacing.lg);
  const keyPanelPosition: AvailabilityKeyPosition = {
    top: keyPanelOpensBelow ? keyPanelBelowTop : spacing.lg,
    right: Math.min(Math.max(spacing.lg, keyPanelIdealRight), keyPanelMaxRight),
    width: keyPanelWidth,
    maxHeight: Math.max(
      160,
      keyPanelOpensBelow ? keyPanelSpaceBelow : keyPanelSpaceAbove,
    ),
  };

  return (
    <Screen safeTop={false} contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <Heading>Routines</Heading>
        <View style={styles.headerActions}>
          {refreshing && (!compactLayout || !data?.routines.length) ? (
            <Text accessibilityLiveRegion="polite" style={styles.refreshing}>Refreshing…</Text>
          ) : null}
          {compactLayout && data?.routines.length ? (
            <AvailabilityKeyTrigger
              compact
              open={availabilityKeyOpen}
              onPress={toggleAvailabilityKey}
            />
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
                      {activeRoutine
                        ? ` · ${routineMuscleTitle(activeRoutine.focus, activeRoutine.summary)}`
                        : ""}
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

          {recommendation?.recommendationKind === "equipment_setup" ? (
            <View style={styles.guidanceNotice}>
              <View style={styles.guidanceMark} />
              <View style={styles.guidanceCopy}>
                <Text style={styles.guidanceTitle}>Routine update needed</Text>
                <Text style={styles.guidanceText}>{recommendation.summary}</Text>
                <View style={styles.setupAction}>
                  <Button title="Ask Coach to adapt them" onPress={() => router.push("/coach")} />
                </View>
              </View>
            </View>
          ) : recommendation?.recommendationKind === "recovery" ? (
            <View
              accessible
              accessibilityLabel={`Use caution today. ${recommendation.summary}`}
              style={styles.guidanceNotice}
            >
              <View style={styles.guidanceMark} />
              <View style={styles.guidanceCopy}>
                <Text style={styles.guidanceTitle}>Use caution today</Text>
                <Text style={styles.guidanceText}>{recommendation.summary}</Text>
              </View>
            </View>
          ) : null}

          {startError ? (
            <View accessibilityRole="alert" style={styles.actionError}>
              <Text style={styles.actionErrorText}>{startError}</Text>
            </View>
          ) : null}

          {data.routines.length ? (
            <>
              {compactLayout ? (
                <Text style={styles.sortLabel}>Last done · newest first</Text>
              ) : null}
              <View role={compactLayout ? "list" : "table"} style={styles.table}>
                {!compactLayout ? (
                  <View role="row" style={styles.tableHeader}>
                    <Text role="columnheader" style={[styles.headerCell, styles.routineSummaryCell]}>Routine</Text>
                    <Text role="columnheader" style={[styles.headerCell, styles.lastDoneColumn]}>Last done ↓</Text>
                    <View role="columnheader" style={styles.availabilityColumn}>
                      <AvailabilityKeyTrigger
                        open={availabilityKeyOpen}
                        onPress={toggleAvailabilityKey}
                      />
                    </View>
                    <Text role="columnheader" style={[styles.headerCell, styles.actionsColumn]}>Actions</Text>
                  </View>
                ) : null}
                {sortedRoutines.map((routine) => {
                  const guidance = recommendation?.routines.find(
                    (item) => item.code === routine.code,
                  );
                  const availabilityKind = routineAvailabilityKind(guidance);
                  const defaultAvailability = AVAILABILITY_KEY.find(
                    (item) => item.kind === availabilityKind,
                  )!;
                  const availabilityDescription = guidance?.availabilityReason
                    ?? defaultAvailability.description;
                  const active = data.activeWorkout?.routineCode === routine.code;
                  return (
                    <RoutineListRow
                      key={routine.code}
                      active={active}
                      availabilityDescription={availabilityDescription}
                      availabilityKind={availabilityKind}
                      compact={compactLayout}
                      expanded={expandedRoutineCode === routine.code}
                      now={renderedAt}
                      routine={routine}
                      startDisabled={
                        Boolean(startingRoutineCode) ||
                        (availabilityKind === "unavailable" && !active)
                      }
                      starting={startingRoutineCode === routine.code}
                      onOpen={() => router.push(`/routines/${encodeURIComponent(routine.code)}`)}
                      onStart={() => void startWorkout(routine.code)}
                      onToggle={() => setExpandedRoutineCode((current) =>
                        current === routine.code ? null : routine.code)}
                    />
                  );
                })}
              </View>
            </>
          ) : (
            <Card style={styles.stateCard}>
              <Eyebrow>Start your program</Eyebrow>
              <Heading size="small">No routines yet</Heading>
              <Body muted>Ask Coach to build a routine, or return after one has been added from another device.</Body>
              <Button title="Open Coach" onPress={() => router.push("/coach")} />
            </Card>
          )}

          <Modal
            transparent
            animationType="fade"
            visible={Boolean(pendingStart)}
            accessibilityLabel="Replace active workout confirmation"
            accessibilityViewIsModal
            onRequestClose={() => {
              if (!startingRoutineCode) setPendingStart(null);
            }}
          >
            <View style={styles.modalBackdrop}>
              <Card style={styles.dialog}>
                <Eyebrow>Workout in progress</Eyebrow>
                <Heading size="medium">
                  Abandon Routine {pendingStart?.activeRoutineCode}?
                </Heading>
                <Body muted>
                  Starting Routine {pendingStart?.routineCode} will mark Routine {pendingStart?.activeRoutineCode} as abandoned.
                  Sets already logged stay in history.
                </Body>
                {startError ? (
                  <Text accessibilityRole="alert" style={styles.dialogError}>
                    {startError}
                  </Text>
                ) : null}
                <Button
                  title={`Keep Routine ${pendingStart?.activeRoutineCode ?? ""}`}
                  variant="secondary"
                  disabled={Boolean(startingRoutineCode)}
                  onPress={() => setPendingStart(null)}
                />
                <Button
                  title={`Abandon and start Routine ${pendingStart?.routineCode ?? ""}`}
                  variant="danger"
                  loading={Boolean(startingRoutineCode)}
                  onPress={() => {
                    if (pendingStart) void startWorkout(pendingStart.routineCode, true);
                  }}
                />
              </Card>
            </View>
          </Modal>

          <Modal
            transparent
            animationType="fade"
            visible={availabilityKeyOpen && Boolean(data.routines.length)}
            accessibilityLabel="Availability key"
            accessibilityViewIsModal
            onRequestClose={() => setAvailabilityKeyOpen(false)}
          >
            <View style={styles.keyModalBackdrop}>
              <Pressable
                accessible={false}
                aria-hidden
                focusable={false}
                onPress={() => setAvailabilityKeyOpen(false)}
                style={styles.keyModalDismissArea}
                tabIndex={-1}
              />
              <AvailabilityKeyPanel
                compact={compactLayout}
                onClose={() => setAvailabilityKeyOpen(false)}
                position={keyPanelPosition}
              />
            </View>
          </Modal>
        </>
      ) : null}
    </Screen>
  );
}

function RoutineListRow({
  active,
  availabilityDescription,
  availabilityKind,
  compact,
  expanded,
  now,
  routine,
  startDisabled,
  starting,
  onOpen,
  onStart,
  onToggle,
}: {
  active: boolean;
  availabilityDescription: string;
  availabilityKind: RoutineAvailabilityKind;
  compact: boolean;
  expanded: boolean;
  now: Date;
  routine: RoutineSummary;
  startDisabled: boolean;
  starting: boolean;
  onOpen: () => void;
  onStart: () => void;
  onToggle: () => void;
}) {
  const [focusedAction, setFocusedAction] = useState<"details" | "open" | "start" | null>(null);
  const title = routineMuscleTitle(routine.focus, routine.summary);
  const durationLabel = routineDurationLabel(
    routine.averageDurationSeconds,
    routine.durationSampleCount,
    routine.durationMin,
  );
  const metadata = `${durationLabel} · ${routine.exerciseCount} exercises · ${routine.setCount} sets`;
  const lastDoneLabel = routineLastDoneLabel(routine.lastWorkoutAt, { now });
  const description = routine.summary.trim() || "No description has been added.";
  const descriptionLabelId = `routine-${routine.code.replace(/[^a-z0-9_-]/gi, "-")}-description-label`;
  const availabilityLabel = AVAILABILITY_KEY.find(
    (item) => item.kind === availabilityKind,
  )!.label;

  const actions = (
    <View
      role={compact ? undefined : "cell"}
      style={[styles.routineActions, compact && styles.routineActionsCompact]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} details for Routine ${routine.code}, ${title}`}
        accessibilityState={{ expanded }}
        onBlur={() => setFocusedAction(null)}
        onFocus={() => setFocusedAction("details")}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.rowAction,
          pressed && styles.rowActionPressed,
          focusedAction === "details" && Platform.OS === "web" && styles.webFocusRing,
        ]}
      >
        <Text style={styles.rowActionText}>Details</Text>
        <Text aria-hidden accessible={false} style={styles.rowActionIcon}>
          {expanded ? "⌃" : "⌄"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${active ? "Resume" : "Start"} Routine ${routine.code}, ${title}`}
        accessibilityHint={availabilityKind === "unavailable" && !active
          ? availabilityDescription
          : undefined}
        accessibilityState={{ busy: starting, disabled: startDisabled }}
        disabled={startDisabled}
        onBlur={() => setFocusedAction(null)}
        onFocus={() => setFocusedAction("start")}
        onPress={onStart}
        style={({ pressed }) => [
          styles.rowAction,
          startDisabled && styles.actionDisabled,
          pressed && styles.rowActionPressed,
          focusedAction === "start" && Platform.OS === "web" && styles.webFocusRing,
        ]}
      >
        <Text aria-hidden accessible={false} style={styles.startIcon}>▶</Text>
        <Text numberOfLines={1} style={styles.rowActionText}>
          {starting ? "Starting…" : active ? "Resume" : "Start"}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View role={compact ? "listitem" : "rowgroup"} style={styles.routineRow}>
      {compact ? (
        <View style={styles.routineMainCompact}>
          <View style={styles.compactTitleLine}>
            <RoutineCodeBadge code={routine.code} />
            <Text numberOfLines={2} style={styles.routineName}>{title}</Text>
            <AvailabilityIcon
              description={availabilityDescription}
              kind={availabilityKind}
            />
          </View>
          <Text style={styles.routineMetadata}>{metadata}</Text>
          <Text style={styles.lastDone}>{lastDoneLabel}</Text>
          {actions}
        </View>
      ) : (
        <View role="row" style={styles.routineMain}>
          <View role="cell" style={styles.routineSummaryCell}>
            <RoutineCodeBadge code={routine.code} />
            <View style={styles.routineSummaryCopy}>
              <Text numberOfLines={1} style={styles.routineName}>{title}</Text>
              <Text numberOfLines={1} style={styles.routineMetadata}>{metadata}</Text>
            </View>
          </View>
          <Text role="cell" numberOfLines={1} style={[styles.lastDone, styles.lastDoneColumn]}>
            {lastDoneLabel}
          </Text>
          <View role="cell" style={styles.availabilityColumn}>
            <AvailabilityIcon
              description={availabilityDescription}
              kind={availabilityKind}
            />
          </View>
          {actions}
        </View>
      )}
      {expanded ? (
        <View
          accessibilityLabelledBy={compact ? descriptionLabelId : undefined}
          role={compact ? "region" : "row"}
          style={[styles.descriptionPanel, compact && styles.descriptionPanelCompact]}
        >
          <View role={compact ? undefined : "cell"} style={styles.descriptionContent}>
            <Text
              accessibilityLabel={`Description for Routine ${routine.code}, ${title}`}
              nativeID={descriptionLabelId}
              style={styles.descriptionLabel}
            >
              Description
            </Text>
            <Text style={styles.descriptionText}>{description}</Text>
            <Text style={styles.descriptionLabel}>Availability</Text>
            <Text style={styles.descriptionText}>
              {availabilityLabel}. {availabilityDescription}
            </Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open full Routine ${routine.code}, ${title}`}
              onBlur={() => setFocusedAction(null)}
              onFocus={() => setFocusedAction("open")}
              onPress={onOpen}
              style={({ pressed }) => [
                styles.openRoutineAction,
                pressed && styles.actionPressed,
                focusedAction === "open" && Platform.OS === "web" && styles.webFocusRing,
              ]}
            >
              <Text style={styles.openRoutineText}>Open full routine →</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RoutineCodeBadge({ code }: { code: string }) {
  return (
    <View style={styles.codeBadge}>
      <Text numberOfLines={1} style={styles.code}>{code}</Text>
    </View>
  );
}

function AvailabilityIcon({
  description,
  kind,
  decorative = false,
}: {
  description: string;
  kind: RoutineAvailabilityKind;
  decorative?: boolean;
}) {
  const entry = AVAILABILITY_KEY.find((item) => item.kind === kind)!;
  const glyph = kind === "recommended"
    ? "★"
    : kind === "available"
      ? "✓"
      : kind === "caution"
        ? "!"
        : "×";
  return (
    <View
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : `${entry.label}. ${description}`}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityElementsHidden={decorative}
      aria-hidden={decorative || undefined}
      importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}
      style={styles.availabilityIcon}
    >
      <Text aria-hidden accessible={false} style={[
        styles.availabilityGlyph,
        kind === "recommended" && styles.availabilityRecommended,
        kind === "available" && styles.availabilityAvailable,
        kind === "caution" && styles.availabilityCaution,
        kind === "unavailable" && styles.availabilityUnavailable,
      ]}>{glyph}</Text>
    </View>
  );
}

function AvailabilityKeyTrigger({
  compact = false,
  open,
  onPress,
}: {
  compact?: boolean;
  open: boolean;
  onPress: (anchor: AvailabilityKeyAnchor | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const triggerRef = useRef<View>(null);

  function handlePress() {
    if (open || !triggerRef.current) {
      onPress(null);
      return;
    }
    triggerRef.current.measureInWindow((x, y, width, height) => {
      onPress({ x, y, width, height });
    });
  }

  return (
    <Pressable
      ref={triggerRef}
      accessibilityRole="button"
      accessibilityLabel={`${open ? "Hide" : "Show"} availability key`}
      accessibilityHint="Explains the availability icons used for each routine."
      accessibilityState={{ expanded: open }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.availabilityKeyTrigger,
        compact && styles.availabilityKeyTriggerCompact,
        pressed && styles.actionPressed,
        focused && Platform.OS === "web" && styles.webFocusRing,
      ]}
    >
      <Text style={[
        styles.headerCell,
        compact && styles.availabilityKeyTriggerTextCompact,
      ]}>{compact ? "Availability key" : "Availability"}</Text>
      <Text aria-hidden accessible={false} style={styles.infoIcon}>ⓘ</Text>
    </Pressable>
  );
}

function AvailabilityKeyPanel({
  compact = false,
  onClose,
  position,
}: {
  compact?: boolean;
  onClose: () => void;
  position: AvailabilityKeyPosition;
}) {
  const [closeFocused, setCloseFocused] = useState(false);
  return (
    <View
      accessibilityLabelledBy="availability-key-title"
      role="dialog"
      style={[
        styles.availabilityKeyPanel,
        compact && styles.availabilityKeyPanelCompact,
        position,
      ]}
    >
      <View style={styles.availabilityKeyHeader}>
        <Text
          accessibilityRole="header"
          nativeID="availability-key-title"
          style={styles.availabilityKeyTitle}
        >
          Availability key
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close availability key"
          onBlur={() => setCloseFocused(false)}
          onFocus={() => setCloseFocused(true)}
          onPress={onClose}
          style={({ pressed }) => [
            styles.availabilityKeyClose,
            pressed && styles.actionPressed,
            closeFocused && Platform.OS === "web" && styles.webFocusRing,
          ]}
        >
          <Text style={styles.availabilityKeyCloseText}>Close</Text>
        </Pressable>
      </View>
      <ScrollView
        showsVerticalScrollIndicator
        style={styles.availabilityKeyScroll}
        contentContainerStyle={styles.availabilityKeyItems}
      >
        {AVAILABILITY_KEY.map((entry) => (
          <View
            key={entry.kind}
            style={[styles.availabilityKeyItem, compact && styles.availabilityKeyItemCompact]}
          >
            <AvailabilityIcon decorative description={entry.description} kind={entry.kind} />
            <View style={styles.availabilityKeyCopy}>
              <Text style={styles.availabilityKeyLabel}>{entry.label}</Text>
              <Text style={styles.availabilityKeyDescription}>{entry.description}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
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
  guidanceNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radii.md,
    backgroundColor: colors.warningSurface,
  },
  guidanceMark: {
    width: 8,
    height: 8,
    marginTop: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.warning,
  },
  guidanceCopy: { flex: 1, minWidth: 0, gap: 2 },
  guidanceTitle: { color: colors.warning, fontSize: 13, fontWeight: "800" },
  guidanceText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  setupAction: { alignSelf: "flex-start", marginTop: spacing.sm },
  actionError: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSurface,
  },
  actionErrorText: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  dialogError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
  },
  sortLabel: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  table: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  tableHeader: {
    minHeight: 44,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  routineMain: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  routineMainCompact: {
    minHeight: 136,
    gap: 5,
    padding: spacing.md,
  },
  compactTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  routineSummaryCell: {
    flex: 1,
    minWidth: 210,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  routineSummaryCopy: { flex: 1, minWidth: 0, gap: 3 },
  codeBadge: {
    width: 40,
    height: 28,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    backgroundColor: colors.surfaceRaised,
  },
  code: {
    maxWidth: 34,
    color: colors.textDim,
    fontSize: 9,
    fontWeight: "900",
  },
  routineName: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  routineMetadata: { color: colors.textDim, fontSize: 10, lineHeight: 15 },
  lastDone: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
  },
  lastDoneColumn: { width: 150, flexShrink: 0 },
  availabilityColumn: {
    width: 100,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  actionsColumn: { width: 168, flexShrink: 0 },
  availabilityIcon: {
    width: 28,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  availabilityGlyph: { fontSize: 18, lineHeight: 22, fontWeight: "900" },
  availabilityRecommended: { color: colors.accent },
  availabilityAvailable: { color: colors.success },
  availabilityCaution: { color: colors.warning },
  availabilityUnavailable: { color: colors.danger },
  routineActions: {
    width: 168,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  routineActionsCompact: { width: "100%", marginTop: spacing.xs },
  rowAction: {
    minHeight: 44,
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaised,
  },
  rowActionPressed: { backgroundColor: colors.border },
  rowActionText: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  rowActionIcon: { color: colors.textMuted, fontSize: 15, lineHeight: 16, fontWeight: "800" },
  startIcon: { color: colors.text, fontSize: 11, lineHeight: 16 },
  descriptionPanel: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingRight: spacing.lg,
    paddingBottom: spacing.xl,
    paddingLeft: 62,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  descriptionPanelCompact: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  descriptionContent: { flex: 1, gap: spacing.sm },
  descriptionLabel: {
    color: colors.textDim,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  descriptionText: { color: colors.text, fontSize: 12, lineHeight: 20 },
  openRoutineAction: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  openRoutineText: {
    color: colors.accent,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  availabilityKeyTrigger: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  availabilityKeyTriggerCompact: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  availabilityKeyTriggerTextCompact: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0,
    textTransform: "none",
  },
  infoIcon: { color: colors.textMuted, fontSize: 14, lineHeight: 18 },
  keyModalBackdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  keyModalDismissArea: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  availabilityKeyPanel: {
    position: "absolute",
    maxWidth: 760,
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    shadowColor: colors.background,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 12,
  },
  availabilityKeyPanelCompact: {
    maxWidth: 430,
  },
  availabilityKeyHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  availabilityKeyTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  availabilityKeyClose: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  availabilityKeyCloseText: {
    color: colors.accent,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  availabilityKeyScroll: { flexShrink: 1 },
  availabilityKeyItems: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  availabilityKeyItem: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 210,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  availabilityKeyItemCompact: { flexBasis: "100%", minWidth: 0 },
  availabilityKeyCopy: { flex: 1, minWidth: 0, gap: 2 },
  availabilityKeyLabel: { color: colors.text, fontSize: 11, lineHeight: 15, fontWeight: "800" },
  availabilityKeyDescription: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 14,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.overlay,
  },
  dialog: { width: "100%", maxWidth: 480, borderColor: colors.borderStrong, padding: spacing.xl },
  webFocusRing: {
    outlineColor: colors.accent,
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
});
