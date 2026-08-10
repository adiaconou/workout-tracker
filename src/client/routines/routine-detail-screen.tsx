import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ApiError, apiRequest } from "../api/client";
import type { Exercise, RoutineAggregate, RoutineExercise, RoutineVersion } from "../../contracts/api";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Field,
  Heading,
  LoadingView,
  Message,
  Screen,
} from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import {
  createRoutineExerciseFromLibrary,
  editableRoutineFromVersion,
  moveRoutineExercise,
  removeRoutineExercise,
  type EditableRoutine,
  type EditableRoutineExercise,
  type EditableRoutineSet,
} from "./routine-exercise-editing";
import {
  duplicateRoutineSetPreservingTransition,
  moveRoutineSetPreservingTransition,
  removeRoutineSetPreservingTransition,
} from "./routine-creation-model";
import { ExerciseLibraryPicker } from "./exercise-library-picker";
import {
  createRoutineEditorSaveRequest,
  deriveRoutineEditorModel,
  routineEditorRefreshDecision,
} from "./routine-editor-model";

type StartResponse = {
  created: boolean;
  requiresConfirmation: boolean;
  session: { id: string; routineCode: string };
};

type RoutineEditorPayload = {
  routine: RoutineAggregate;
  versions: RoutineVersion[];
  activeWorkout?: { id: string; routineCode: string } | null;
};

type DiscardIntent = "cancel" | "back" | "reload" | null;

const setTypeOptions = [
  ["warmup", "Warm-up"],
  ["regular", "Regular"],
  ["failure", "Failure"],
  ["drop", "Drop"],
  ["emom", "EMOM"],
  ["test", "Test"],
] as const;
const targetTypeOptions = [["reps", "Reps"], ["duration", "Duration"], ["rounds", "Rounds"]] as const;
const restRuleOptions = [
  ["standard", "Standard"],
  ["after_both_sides", "After both sides"],
  ["no_rest_before_drop", "No rest before drop"],
  ["emom", "EMOM"],
  ["after_superset", "After superset"],
] as const;
const sideModeOptions = [
  ["bilateral", "Bilateral"],
  ["per_side", "Per side"],
  ["per_leg", "Per leg"],
  ["left_right", "Left / right"],
] as const;

export function RoutineDetailScreen({ routineId }: { routineId: string }) {
  const [routine, setRoutine] = useState<RoutineAggregate | null>(null);
  const [versions, setVersions] = useState<RoutineVersion[]>([]);
  const [activeWorkout, setActiveWorkout] = useState<RoutineEditorPayload["activeWorkout"]>(null);
  const [draft, setDraft] = useState<EditableRoutine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stale, setStale] = useState(false);
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent>(null);
  const [showRemoveRoutine, setShowRemoveRoutine] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [showExerciseLibrary, setShowExerciseLibrary] = useState(false);
  const [exerciseLibrary, setExerciseLibrary] = useState<Exercise[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [expandedExerciseIds, setExpandedExerciseIds] = useState<Set<string>>(() => new Set());
  const [expandedSetIds, setExpandedSetIds] = useState<Set<string>>(() => new Set());
  const [activeRoutineCode, setActiveRoutineCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const editorState = useRef({ editing: false, dirty: false, currentVersionId: null as string | null });

  const applyPayload = useCallback((payload: RoutineEditorPayload, resetDisclosure = true) => {
    setRoutine(payload.routine);
    setVersions(payload.versions);
    if (payload.activeWorkout !== undefined) setActiveWorkout(payload.activeWorkout);
    if (payload.routine.currentVersion) setDraft(editableRoutineFromVersion(payload.routine.currentVersion));
    if (resetDisclosure) {
      setExpandedExerciseIds(new Set());
      setExpandedSetIds(new Set());
    }
    setStale(false);
  }, []);

  const load = useCallback(async (force = false) => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setError("");
    try {
      const payload = await apiRequest<RoutineEditorPayload>(
        `/api/v1/routines/${encodeURIComponent(routineId)}/editor`,
      );
      if (requestId !== latestRequest.current) return;
      if (!payload.routine.isActive) {
        applyPayload(payload);
        setEditing(false);
        setDiscardIntent(null);
        setShowRemoveRoutine(false);
        return;
      }
      const state = editorState.current;
      const refreshDecision = routineEditorRefreshDecision({
        force,
        editor: state,
        incomingVersionId: payload.routine.currentVersionId,
      });
      if (refreshDecision.preserveDraft) {
        setVersions(payload.versions);
        if (payload.activeWorkout !== undefined) setActiveWorkout(payload.activeWorkout);
        if (refreshDecision.markStale) {
          setStale(true);
          setMessage("");
        }
        return;
      }
      applyPayload(payload, refreshDecision.resetDisclosure);
    } catch (caught) {
      if (requestId === latestRequest.current) {
        setError(caught instanceof Error ? caught.message : "Routine could not be loaded.");
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [applyPayload, routineId]);

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

  const currentVersion = routine?.currentVersion ?? null;
  const visibleExercises: Array<EditableRoutineExercise | RoutineExercise> = editing
    ? draft?.exercises ?? []
    : currentVersion?.exercises ?? [];
  const totalSets = currentVersion?.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) ?? 0;
  const editorModel = deriveRoutineEditorModel({ editing, currentVersion, draft, stale });
  const { dirty } = editorModel.snapshot;
  const { validationError, canSave } = editorModel;
  editorState.current = editorModel.snapshot;
  const savedDrafts = versions.filter((version) => version.status === "draft");

  useEffect(() => {
    if (!dirty || saving) return;
    if (Platform.OS === "web") {
      const preventUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", preventUnload);
      return () => window.removeEventListener("beforeunload", preventUnload);
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setDiscardIntent("back");
      return true;
    });
    return () => subscription.remove();
  }, [dirty, saving]);

  async function startWorkout(abandonActive = false) {
    if (!routine) return;
    const active = activeWorkout;
    if (!abandonActive && active?.routineCode === routine.code) {
      router.replace(`/workouts/${active.id}`);
      return;
    }
    setStarting(true);
    setError("");
    try {
      let startRoutine = routine;
      if (!abandonActive) {
        latestRequest.current += 1;
        const latest = await apiRequest<RoutineEditorPayload>(
          `/api/v1/routines/${encodeURIComponent(routine.id)}/editor`,
        );
        latestRequest.current += 1;
        applyPayload(latest, latest.routine.currentVersionId !== routine.currentVersionId);
        if (latest.routine.currentVersionId !== routine.currentVersionId) {
          setMessage("This routine changed elsewhere. Review the latest published version before starting it.");
          return;
        }
        if (latest.activeWorkout?.routineCode === latest.routine.code) {
          router.replace(`/workouts/${latest.activeWorkout.id}`);
          return;
        }
        startRoutine = latest.routine;
      }
      const payload = await apiRequest<StartResponse>("/api/v1/workouts", {
        method: "POST",
        body: JSON.stringify({
          routineId: startRoutine.code,
          expectedRoutineVersionId: startRoutine.currentVersionId,
          abandonActive,
        }),
      });
      if (payload.requiresConfirmation) {
        setActiveRoutineCode(payload.session.routineCode);
        return;
      }
      setActiveRoutineCode(null);
      router.replace(`/workouts/${payload.session.id}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "routine_version_stale") {
        setStale(true);
        setMessage("");
      }
      setError(caught instanceof Error ? caught.message : "Workout could not be started.");
    } finally {
      setStarting(false);
    }
  }

  async function save() {
    const request = createRoutineEditorSaveRequest({
      draft,
      routineId: routine?.id ?? null,
      currentVersion,
      canSave,
      saving,
    });
    if (!request) return;
    setSaving(true);
    setError("");
    setMessage("");
    latestRequest.current += 1;
    try {
      const payload = await apiRequest<RoutineEditorPayload>(
        `/api/v1/routines/${encodeURIComponent(request.routineId)}/editor`,
        {
          method: "PATCH",
          body: JSON.stringify(request.payload),
        },
      );
      latestRequest.current += 1;
      applyPayload(payload);
      setEditing(false);
      setMessage(`Routine ${payload.routine.code} published as version ${payload.routine.currentVersion?.versionNumber}.`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "routine_version_stale") setStale(true);
      setError(caught instanceof Error ? caught.message : "The routine could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function openRemoveRoutine() {
    if (saving || removing) return;
    setRemoveError("");
    setShowRemoveRoutine(true);
  }

  function closeRemoveRoutine() {
    if (removing) return;
    setShowRemoveRoutine(false);
    setRemoveError("");
  }

  async function removeRoutine() {
    if (!routine || removing) return;
    const immutableRoutineId = routine.id;
    setRemoving(true);
    setRemoveError("");
    latestRequest.current += 1;
    try {
      await apiRequest(`/api/v1/routines/${encodeURIComponent(immutableRoutineId)}`, {
        method: "DELETE",
      });
      router.replace("/routines");
    } catch (caught) {
      setRemoveError(caught instanceof Error ? caught.message : "The routine could not be removed.");
      setRemoving(false);
    }
  }

  function beginEditing() {
    if (!currentVersion) return;
    setDraft(editableRoutineFromVersion(currentVersion));
    setEditing(true);
    setStale(false);
    setMessage("");
  }

  function finishCancel() {
    if (currentVersion) setDraft(editableRoutineFromVersion(currentVersion));
    setEditing(false);
    setStale(false);
    setDiscardIntent(null);
    setShowExerciseLibrary(false);
    setExpandedSetIds(new Set());
  }

  function requestCancel(intent: Exclude<DiscardIntent, null>) {
    if (dirty) {
      setDiscardIntent(intent);
      return;
    }
    if (intent === "back") router.back();
    else if (intent === "reload") {
      finishCancel();
      void load(true);
    } else finishCancel();
  }

  function updateDraft(patch: Partial<EditableRoutine>) {
    if (saving) return;
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function patchExercise(index: number, patch: Partial<EditableRoutineExercise>) {
    if (saving) return;
    setDraft((current) => current ? {
      ...current,
      exercises: current.exercises.map((exercise, exerciseIndex) =>
        exerciseIndex === index ? { ...exercise, ...patch } : exercise
      ),
    } : current);
  }

  function patchSet(exerciseIndex: number, setIndex: number, patch: Partial<EditableRoutineSet>) {
    if (saving) return;
    setDraft((current) => current ? {
      ...current,
      exercises: current.exercises.map((exercise, currentExerciseIndex) =>
        currentExerciseIndex === exerciseIndex
          ? {
              ...exercise,
              sets: exercise.sets.map((set, currentSetIndex) =>
                currentSetIndex === setIndex ? { ...set, ...patch } : set
              ),
            }
          : exercise
      ),
    } : current);
  }

  function moveExercise(index: number, direction: -1 | 1) {
    if (saving) return;
    setDraft((current) => current
      ? { ...current, exercises: moveRoutineExercise(current.exercises, index, direction) }
      : current);
  }

  function removeExercise(index: number) {
    if (saving) return;
    const draftId = draft?.exercises[index]?.draftId;
    setDraft((current) => current
      ? { ...current, exercises: removeRoutineExercise(current.exercises, index) }
      : current);
    if (draftId) setExpandedExerciseIds((current) => withoutId(current, draftId));
  }

  function moveSet(exerciseIndex: number, setIndex: number, direction: -1 | 1) {
    if (saving) return;
    const exercise = draft?.exercises[exerciseIndex];
    if (!exercise) return;
    patchExercise(exerciseIndex, { sets: moveRoutineSetPreservingTransition(exercise.sets, setIndex, direction) });
  }

  function removeSet(exerciseIndex: number, setIndex: number) {
    if (saving) return;
    const exercise = draft?.exercises[exerciseIndex];
    const draftId = exercise?.sets[setIndex]?.draftId;
    if (!exercise) return;
    patchExercise(exerciseIndex, { sets: removeRoutineSetPreservingTransition(exercise.sets, setIndex) });
    if (draftId) setExpandedSetIds((current) => withoutId(current, draftId));
  }

  function addSet(exerciseIndex: number, afterIndex?: number) {
    if (saving) return;
    const exercise = draft?.exercises[exerciseIndex];
    if (!exercise) return;
    patchExercise(exerciseIndex, {
      sets: duplicateRoutineSetPreservingTransition(exercise.sets, afterIndex ?? exercise.sets.length - 1),
    });
  }

  function toggleExercise(draftId: string) {
    setExpandedExerciseIds((current) => toggled(current, draftId));
  }

  function toggleSet(draftId: string) {
    setExpandedSetIds((current) => toggled(current, draftId));
  }

  async function loadExerciseLibrary() {
    setLibraryLoading(true);
    setLibraryError("");
    try {
      const payload = await apiRequest<{ exercises: Exercise[] }>("/api/v1/exercises");
      setExerciseLibrary(payload.exercises);
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : "The exercise library could not be loaded.");
    } finally {
      setLibraryLoading(false);
    }
  }

  function openExerciseLibrary() {
    setLibraryError("");
    setShowExerciseLibrary(true);
    void loadExerciseLibrary();
  }

  function addExercises(exercises: Exercise[]) {
    if (saving) return;
    const startPosition = (draft?.exercises.length ?? 0) + 1;
    const placements = exercises.map((exercise, index) => (
      createRoutineExerciseFromLibrary(exercise, startPosition + index)
    ));
    setDraft((current) => current
      ? { ...current, exercises: [...current.exercises, ...placements] }
      : current);
    setExpandedExerciseIds((current) => {
      const next = new Set(current);
      for (const placement of placements) next.add(placement.draftId);
      return next;
    });
    setExpandedSetIds((current) => {
      const next = new Set(current);
      for (const placement of placements) if (placement.sets[0]) next.add(placement.sets[0].draftId);
      return next;
    });
    setShowExerciseLibrary(false);
  }

  if (loading) return <LoadingView label={`Loading Routine ${routineId}…`} />;
  if (!routine || !currentVersion || !draft) {
    return (
      <Screen safeTop={false}>
        <Message>{error || "Routine not found."}</Message>
        <Button title="Back to routines" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!routine.isActive) {
    return (
      <Screen safeTop={false}>
        <Card style={styles.removedState}>
          <Eyebrow>Routine {routine.code}</Eyebrow>
          <Heading>Routine removed</Heading>
          <Body muted>
            This routine no longer appears in your routines or recommendations. Past workouts remain in
            History, but the routine cannot currently be restored in the app.
          </Body>
          {activeWorkout?.routineCode === routine.code ? (
            <Body muted>Your workout in progress remains available from the Routines page.</Body>
          ) : null}
          <Button title="Back to routines" onPress={() => router.replace("/routines")} />
        </Card>
      </Screen>
    );
  }

  const sameRoutineActive = activeWorkout?.routineCode === routine.code;
  const startTitle = sameRoutineActive ? "Resume workout →" : starting ? "Creating workout…" : "Start workout →";

  return (
    <Screen safeTop={false}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Back to all routines"
        onBlur={() => setFocusedControl(null)}
        onFocus={() => setFocusedControl("back")}
        onPress={() => editing ? requestCancel("back") : router.back()}
        hitSlop={12}
        style={({ pressed }) => [
          styles.backAction,
          pressed && styles.controlPressed,
          focusedControl === "back" && Platform.OS === "web" && styles.webFocusRing,
        ]}
      >
        <Text style={styles.back}>← All routines</Text>
      </Pressable>

      {savedDrafts.length ? (
        <Message tone="warning">
          {savedDrafts.length === 1
            ? `Draft version ${savedDrafts[0]!.versionNumber} is saved. The published routine below is version ${currentVersion.versionNumber}.`
            : `${savedDrafts.length} draft versions are saved. The published routine below is version ${currentVersion.versionNumber}.`}
        </Message>
      ) : null}

      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Eyebrow>Routine {routine.code} · Published version {currentVersion.versionNumber}</Eyebrow>
            {editing ? (
              <>
                <View style={styles.editingLabel}><Text style={styles.editingLabelText}>Editing unpublished changes</Text></View>
                <Field label="Routine name" editable={!saving} value={draft.focus} onChangeText={(focus) => updateDraft({ focus })} />
                <Field label="Summary" editable={!saving} value={draft.summary} multiline onChangeText={(summary) => updateDraft({ summary })} />
                <Field
                  label="Estimated minutes"
                  editable={!saving}
                  keyboardType="number-pad"
                  value={String(draft.durationMin)}
                  onChangeText={(value) => updateDraft({ durationMin: Number(value) })}
                />
              </>
            ) : (
              <>
                <Heading>{currentVersion.focus}</Heading>
                <Body muted>{currentVersion.summary}</Body>
              </>
            )}
          </View>
          {!editing ? (
            <View style={styles.stats}>
              <Text style={styles.statStrong}>{currentVersion.exercises.length}</Text>
              <Text style={styles.statLabel}>exercises</Text>
              <Text style={styles.statStrong}>{totalSets}</Text>
              <Text style={styles.statLabel}>sets</Text>
              <Text style={styles.statStrong}>{currentVersion.durationMin}</Text>
              <Text style={styles.statLabel}>min</Text>
            </View>
          ) : null}
        </View>
        {!editing ? (
          <>
            <Button title={startTitle} loading={starting} onPress={() => void startWorkout()} />
            <Body muted style={styles.snapshotNote}>
              {sameRoutineActive
                ? "This routine already has a workout in progress."
                : activeWorkout
                  ? `Routine ${activeWorkout.routineCode} is in progress; you will confirm before replacing it.`
                  : `Starting creates a durable workout instance from version ${currentVersion.versionNumber}.`}
            </Body>
          </>
        ) : null}
      </Card>

      {message ? <Message tone="success">{message}</Message> : null}
      {error ? <Message>{error}</Message> : null}
      {stale ? (
        <Button
          title={editing && dirty ? "Discard edits and reload latest" : "Reload latest version"}
          variant="secondary"
          onPress={() => editing ? requestCancel("reload") : void load(true)}
        />
      ) : null}

      <View style={styles.sectionHeading}>
        <View>
          <Eyebrow>Prescription</Eyebrow>
          <Heading size="medium">Exercises</Heading>
        </View>
        {!editing ? <Button title="Edit routine" compact variant="secondary" onPress={beginEditing} /> : null}
      </View>

      {editing ? (
        <>
          <EditorActions
            dirty={dirty}
            saving={saving}
            stale={stale}
            validationError={validationError}
            canSave={canSave}
            onCancel={() => requestCancel("cancel")}
            onSave={() => void save()}
          />
          <Card style={styles.addExerciseCard}>
            <View style={styles.addExerciseCopy}>
              <Heading size="small">Add exercise</Heading>
              <Body muted>Add any library exercise, including another placement of one already used.</Body>
            </View>
            <Button title="Add exercise from library" variant="secondary" disabled={saving} onPress={openExerciseLibrary} />
          </Card>
        </>
      ) : null}

      {visibleExercises.map((exercise, index) => {
        const draftExercise = "draftId" in exercise ? exercise : null;
        const exerciseId = "draftId" in exercise ? exercise.draftId : exercise.id;
        const exerciseName = exercise.exerciseName;
        const sets = exercise.sets;
        const expanded = expandedExerciseIds.has(exerciseId);
        return (
          <Card key={exerciseId}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${exerciseName}`}
              accessibilityState={{ expanded }}
              hitSlop={6}
              onBlur={() => setFocusedControl(null)}
              onFocus={() => setFocusedControl(`exercise:${exerciseId}`)}
              style={({ pressed }) => [
                styles.exerciseHeader,
                pressed && styles.controlPressed,
                focusedControl === `exercise:${exerciseId}` && Platform.OS === "web" && styles.webFocusRing,
              ]}
              onPress={() => toggleExercise(exerciseId)}
            >
              <View style={styles.exerciseTitle}>
                <View style={styles.order}><Text style={styles.orderText}>{String(index + 1).padStart(2, "0")}</Text></View>
                <View style={styles.exerciseTitleCopy}>
                  <Heading size="small">{exerciseName}</Heading>
                  <Text style={styles.exerciseSummary}>{placementSummary(sets)}</Text>
                </View>
              </View>
              <Text style={styles.disclosureText}>{expanded ? "−" : "+"}</Text>
            </Pressable>

            {editing ? (
              <View style={styles.exerciseActions}>
                <Button title="Move up" accessibilityLabel={`Move ${exerciseName} up`} compact variant="ghost" disabled={index === 0 || saving} onPress={() => moveExercise(index, -1)} />
                <Button title="Move down" accessibilityLabel={`Move ${exerciseName} down`} compact variant="ghost" disabled={index === draft.exercises.length - 1 || saving} onPress={() => moveExercise(index, 1)} />
                <Button title="Remove" accessibilityLabel={`Remove ${exerciseName}`} compact variant="danger" disabled={draft.exercises.length === 1 || saving} onPress={() => removeExercise(index)} />
              </View>
            ) : null}

            {expanded && editing ? (
              <View style={styles.editGrid}>
                <Body muted>The exercise name comes from your library and is not changed by routine edits.</Body>
                <Field
                  label="Superset group"
                  hint="Optional. Use the same group label for exercises performed together."
                  editable={!saving}
                  value={draftExercise!.supersetGroup ?? ""}
                  onChangeText={(supersetGroup) => patchExercise(index, { supersetGroup: supersetGroup || null })}
                />
                <Field label="Exercise instructions" editable={!saving} value={draftExercise!.instructions ?? ""} multiline onChangeText={(instructions) => patchExercise(index, { instructions })} />
                <Field label="Exercise notes" editable={!saving} value={draftExercise!.notes ?? ""} multiline onChangeText={(notes) => patchExercise(index, { notes })} />
                <View style={styles.setSectionHeading}>
                  <Heading size="small">Sets</Heading>
                  <Button title="Add set" compact variant="secondary" disabled={saving} onPress={() => addSet(index)} />
                </View>
                {draftExercise!.sets.map((set, setIndex) => (
                  <EditableSetCard
                    key={set.draftId}
                    set={set}
                    exerciseName={exerciseName}
                    setIndex={setIndex}
                    expanded={expandedSetIds.has(set.draftId)}
                    saving={saving}
                    onlySet={draftExercise!.sets.length === 1}
                    onToggle={() => toggleSet(set.draftId)}
                    onPatch={(patch) => patchSet(index, setIndex, patch)}
                    onMove={(direction) => moveSet(index, setIndex, direction)}
                    onDuplicate={() => addSet(index, setIndex)}
                    onRemove={() => removeSet(index, setIndex)}
                    last={setIndex === draftExercise!.sets.length - 1}
                  />
                ))}
              </View>
            ) : expanded ? (
              <View style={styles.readDetails}>
                {exercise.supersetGroup ? <Fact label="Superset" value={exercise.supersetGroup} /> : null}
                {exercise.instructions ? <Fact label="Instructions" value={exercise.instructions} /> : null}
                {exercise.notes ? <Fact label="Notes" value={exercise.notes} /> : null}
                {[...sets].sort((left, right) => left.position - right.position).map((set) => (
                  <ReadOnlySet key={"id" in set ? set.id : `${exerciseId}:${set.position}`} set={set} />
                ))}
              </View>
            ) : null}
          </Card>
        );
      })}

      {editing ? (
        <>
          <EditorActions
            dirty={dirty}
            saving={saving}
            stale={stale}
            validationError={validationError}
            canSave={canSave}
            onCancel={() => requestCancel("cancel")}
            onSave={() => void save()}
          />
          <Card style={styles.dangerZone}>
            <View style={styles.dangerZoneCopy}>
              <Heading size="small">Remove routine</Heading>
              <Body muted>
                Remove this routine from your routine list and recommendations. Workout history is kept.
              </Body>
            </View>
            <Button
              title="Remove routine"
              variant="danger"
              disabled={saving || removing}
              onPress={openRemoveRoutine}
            />
          </Card>
        </>
      ) : null}

      <Body muted style={styles.safety}>
        Stop or modify an exercise if pain develops. Routine edits affect future workouts only;
        started workouts keep their original snapshot.
      </Body>

      <ExerciseLibraryPicker
        visible={showExerciseLibrary}
        title={`Add to Routine ${routine.code}`}
        exercises={exerciseLibrary}
        existingExerciseIds={draft.exercises.map((exercise) => exercise.exerciseId)}
        loading={libraryLoading}
        error={libraryError}
        onClose={() => setShowExerciseLibrary(false)}
        onRetry={() => void loadExerciseLibrary()}
        onAdd={addExercises}
      />

      <Modal
        transparent
        animationType="fade"
        visible={showRemoveRoutine}
        accessibilityLabel="Remove routine confirmation"
        accessibilityViewIsModal
        onRequestClose={closeRemoveRoutine}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessible={false}
            disabled={removing}
            tabIndex={-1}
            onPress={closeRemoveRoutine}
            style={styles.modalDismissArea}
          />
          <Card style={styles.dialog}>
            <Eyebrow>Routine {routine.code}</Eyebrow>
            <Heading size="medium">Remove this routine?</Heading>
            <Body muted>
              {currentVersion.focus} will be removed from your routines and recommendations. Past workouts
              will stay in History. This cannot currently be undone in the app.
            </Body>
            {dirty ? <Body muted>Your unsaved edits will also be discarded.</Body> : null}
            {sameRoutineActive ? (
              <Body muted>
                Your workout in progress will remain available to finish, but you will not be able to start
                another workout from this routine.
              </Body>
            ) : null}
            {removeError ? <Message>{removeError}</Message> : null}
            <Button title="Keep routine" variant="secondary" disabled={removing} onPress={closeRemoveRoutine} />
            <Button
              title={removing ? "Removing…" : "Remove routine"}
              variant="danger"
              loading={removing}
              onPress={() => void removeRoutine()}
            />
          </Card>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={Boolean(discardIntent)}
        accessibilityLabel="Discard routine edits confirmation"
        accessibilityViewIsModal
        onRequestClose={() => setDiscardIntent(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.dialog}>
            <Eyebrow>Unsaved routine changes</Eyebrow>
            <Heading size="medium">Discard your edits?</Heading>
            <Body muted>
              {discardIntent === "reload"
                ? "Your edits will be discarded and the latest published version will be loaded."
                : "The published routine will stay unchanged."}
            </Body>
            <Button title="Keep editing" variant="secondary" onPress={() => setDiscardIntent(null)} />
            <Button
              title={discardIntent === "reload" ? "Discard edits and reload" : "Discard edits"}
              variant="danger"
              onPress={() => {
                const intent = discardIntent;
                 finishCancel();
                 if (intent === "back") router.back();
                 else if (intent === "reload") void load(true);
              }}
            />
          </Card>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={Boolean(activeRoutineCode)}
        accessibilityLabel="Replace active workout confirmation"
        accessibilityViewIsModal
        onRequestClose={() => setActiveRoutineCode(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.dialog}>
            <Eyebrow>Workout in progress</Eyebrow>
            <Heading size="medium">Abandon Routine {activeRoutineCode}?</Heading>
            <Body muted>
              Starting Routine {routine.code} will mark Routine {activeRoutineCode} as abandoned.
              Sets already logged stay in history.
            </Body>
            <Button title={`Keep Routine ${activeRoutineCode}`} variant="secondary" disabled={starting} onPress={() => setActiveRoutineCode(null)} />
            <Button title={`Abandon and start Routine ${routine.code}`} variant="danger" loading={starting} onPress={() => void startWorkout(true)} />
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

function EditorActions({
  dirty,
  saving,
  stale,
  validationError,
  canSave,
  onCancel,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  stale: boolean;
  validationError: string;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Card style={styles.editorBar}>
      <View style={styles.editorState}>
        <Text style={styles.editorStateTitle}>{stale ? "A newer version is available" : dirty ? "Unsaved changes" : "No changes yet"}</Text>
        <Text style={styles.editorStateDetail}>{validationError || (stale ? "Reload before saving." : "Saving publishes a new routine version.")}</Text>
      </View>
      <View style={styles.inlineActions}>
        <Button title="Cancel" compact variant="ghost" disabled={saving} onPress={onCancel} />
        <Button title="Save & publish" compact loading={saving} disabled={!canSave} onPress={onSave} />
      </View>
    </Card>
  );
}

function EditableSetCard({
  set,
  exerciseName,
  setIndex,
  expanded,
  saving,
  onlySet,
  last,
  onToggle,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
}: {
  set: EditableRoutineSet;
  exerciseName: string;
  setIndex: number;
  expanded: boolean;
  saving: boolean;
  onlySet: boolean;
  last: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<EditableRoutineSet>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.setEditor}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${exerciseName} set ${setIndex + 1}`}
        accessibilityState={{ expanded }}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.setHeader,
          pressed && styles.controlPressed,
          focused && Platform.OS === "web" && styles.webFocusRing,
        ]}
      >
        <View style={styles.setHeaderCopy}>
          <Text style={styles.setTitle}>Set {setIndex + 1} · {humanize(set.setType)}</Text>
          <Text style={styles.setSummary}>{setSummary(set)}</Text>
        </View>
        <Text style={styles.disclosureText}>{expanded ? "−" : "+"}</Text>
      </Pressable>
      <View style={styles.setActions}>
        <Button title="Up" accessibilityLabel={`Move ${exerciseName} set ${setIndex + 1} up`} compact variant="ghost" disabled={setIndex === 0 || saving} onPress={() => onMove(-1)} />
        <Button title="Down" accessibilityLabel={`Move ${exerciseName} set ${setIndex + 1} down`} compact variant="ghost" disabled={last || saving} onPress={() => onMove(1)} />
        <Button title="Duplicate" accessibilityLabel={`Duplicate ${exerciseName} set ${setIndex + 1}`} compact variant="ghost" disabled={saving} onPress={onDuplicate} />
        <Button title="Remove" accessibilityLabel={`Remove ${exerciseName} set ${setIndex + 1}`} compact variant="danger" disabled={onlySet || saving} onPress={onRemove} />
      </View>
      {expanded ? (
        <View style={styles.setFields}>
          <ChoiceField label="Set type" disabled={saving} value={set.setType} options={setTypeOptions} onChange={(setType) => onPatch({ setType })} />
          <ChoiceField label="Target type" disabled={saving} value={set.targetType} options={targetTypeOptions} onChange={(targetType) => onPatch({ targetType })} />
          <Field label="Display target" editable={!saving} value={set.targetDisplay} onChangeText={(targetDisplay) => onPatch({ targetDisplay })} />
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}><NullableNumberField label="Target minimum" disabled={saving} value={set.targetMin} onChange={(targetMin) => onPatch({ targetMin })} /></View>
            <View style={styles.fieldHalf}><NullableNumberField label="Target maximum" disabled={saving} value={set.targetMax} onChange={(targetMax) => onPatch({ targetMax })} /></View>
            <View style={styles.fieldHalf}><NullableNumberField label="RIR minimum" disabled={saving} value={set.targetRirMin} onChange={(targetRirMin) => onPatch({ targetRirMin })} /></View>
            <View style={styles.fieldHalf}><NullableNumberField label="RIR maximum" disabled={saving} value={set.targetRirMax} onChange={(targetRirMax) => onPatch({ targetRirMax })} /></View>
            <View style={styles.fieldHalf}><Field label="Rest seconds" editable={!saving} keyboardType="number-pad" value={String(set.restAfterSec)} onChangeText={(value) => onPatch({ restAfterSec: Number(value) })} /></View>
            <View style={styles.fieldHalf}><Field label="Tempo" editable={!saving} placeholder="Optional" value={set.tempo ?? ""} onChangeText={(tempo) => onPatch({ tempo: tempo || null })} /></View>
          </View>
          <ChoiceField label="Rest rule" disabled={saving} value={set.restRule} options={restRuleOptions} onChange={(restRule) => onPatch({ restRule })} />
          <ChoiceField label="Side mode" disabled={saving} value={set.sideMode} options={sideModeOptions} onChange={(sideMode) => onPatch({ sideMode })} />
          <Field label="Load instruction" editable={!saving} value={set.loadInstruction} multiline onChangeText={(loadInstruction) => onPatch({ loadInstruction })} />
          <Field label="Set notes" editable={!saving} value={set.notes} multiline onChangeText={(notes) => onPatch({ notes })} />
        </View>
      ) : null}
    </View>
  );
}

function NullableNumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(() => nullableNumberText(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(nullableNumberText(value));
  }, [focused, value]);

  function update(nextText: string) {
    setText(nextText);
    onChange(nextText.trim() ? Number(nextText) : null);
  }

  function commit() {
    setFocused(false);
    if (!text.trim()) {
      setText("");
      onChange(null);
      return;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setText("");
      onChange(null);
      return;
    }
    setText(String(parsed));
    onChange(parsed);
  }

  return (
    <Field
      label={label}
      editable={!disabled}
      keyboardType="decimal-pad"
      value={text}
      onBlur={commit}
      onFocus={() => setFocused(true)}
      onChangeText={update}
    />
  );
}

function ChoiceField<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const [focusedOption, setFocusedOption] = useState<T | null>(null);
  return (
    <View style={styles.choiceField}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choiceRow}>
        {options.map(([option, optionLabel]) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${optionLabel}`}
            accessibilityState={{ checked: option === value, disabled }}
            disabled={disabled}
            onBlur={() => setFocusedOption(null)}
            onFocus={() => setFocusedOption(option)}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.choice,
              option === value && styles.choiceSelected,
              disabled && styles.choiceDisabled,
              pressed && styles.controlPressed,
              focusedOption === option && Platform.OS === "web" && styles.webFocusRing,
            ]}
          >
            <Text style={[styles.choiceText, option === value && styles.choiceTextSelected]}>{optionLabel}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ReadOnlySet({ set }: { set: RoutineVersion["exercises"][number]["sets"][number] | EditableRoutineSet }) {
  return (
    <View style={styles.readSet}>
      <Text style={styles.setTitle}>Set {set.position} · {humanize(set.setType)}</Text>
      <Text style={styles.readSetPrimary}>{set.targetDisplay}</Text>
      <Text style={styles.readSetSecondary}>{setSummary(set)}</Text>
      <View style={styles.readSetDetails}>
        <Text style={styles.readSetDetail}>Target type: {humanize(set.targetType)}</Text>
        <Text style={styles.readSetDetail}>Range: {rangeText(set.targetMin, set.targetMax)}</Text>
        <Text style={styles.readSetDetail}>RIR: {rangeText(set.targetRirMin, set.targetRirMax)}</Text>
        <Text style={styles.readSetDetail}>Rest rule: {humanize(set.restRule)}</Text>
        <Text style={styles.readSetDetail}>Side mode: {humanize(set.sideMode)}</Text>
        <Text style={styles.readSetDetail}>Tempo: {set.tempo || "None"}</Text>
      </View>
      {set.loadInstruction ? <Text style={styles.readSetNote}>Load: {set.loadInstruction}</Text> : null}
      {set.notes ? <Text style={styles.readSetNote}>Notes: {set.notes}</Text> : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;
}

function placementSummary(sets: Array<{ setType: string; targetDisplay: string; restAfterSec: number }>) {
  const workSet = sets.find((set) => set.setType !== "warmup") ?? sets[0];
  if (!workSet) return "No sets";
  return `${sets.length} ${sets.length === 1 ? "set" : "sets"} · ${workSet.targetDisplay} · ${workSet.restAfterSec}s rest`;
}

function setSummary(set: { targetDisplay: string; targetRirMin: number | null; targetRirMax: number | null; restAfterSec: number }) {
  const rir = set.targetRirMin === null ? "RIR not set" : `${rangeText(set.targetRirMin, set.targetRirMax)} RIR`;
  return `${set.targetDisplay} · ${rir} · ${set.restAfterSec}s rest`;
}

function rangeText(minimum: number | null, maximum: number | null) {
  if (minimum === null && maximum === null) return "None";
  if (maximum === null || minimum === maximum) return String(minimum ?? maximum);
  if (minimum === null) return String(maximum);
  return `${minimum}-${maximum}`;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function nullableNumberText(value: number | null) {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

function toggled(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function withoutId(current: Set<string>, id: string) {
  const next = new Set(current);
  next.delete(id);
  return next;
}

const styles = StyleSheet.create({
  back: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  backAction: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", borderRadius: radii.sm, paddingHorizontal: spacing.xs },
  controlPressed: { opacity: 0.76 },
  hero: { backgroundColor: colors.surfaceRaised, gap: spacing.lg },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xl, flexWrap: "wrap" },
  heroCopy: { flex: 1, minWidth: 240, gap: spacing.md },
  editingLabel: { alignSelf: "flex-start", borderRadius: radii.pill, backgroundColor: colors.warningSurface, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  editingLabelText: { color: colors.warning, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  stats: { alignItems: "flex-end" },
  statStrong: { color: colors.text, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.textDim, fontSize: 10, textTransform: "uppercase", marginBottom: spacing.sm },
  snapshotNote: { fontSize: 12, textAlign: "center" },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  inlineActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap" },
  editorBar: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  editorState: { flex: 1, minWidth: 190, gap: spacing.xs },
  editorStateTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  editorStateDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  removedState: { marginTop: spacing.xl, borderColor: colors.borderStrong },
  dangerZone: { borderColor: colors.danger, backgroundColor: colors.dangerSurface },
  dangerZoneCopy: { gap: spacing.xs },
  addExerciseCard: { borderStyle: "dashed", borderColor: colors.borderStrong, alignItems: "stretch" },
  addExerciseCopy: { flex: 1, gap: spacing.xs },
  exerciseHeader: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md },
  exerciseTitle: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  order: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, backgroundColor: colors.accentDark },
  orderText: { color: colors.accent, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  exerciseTitleCopy: { flex: 1, gap: spacing.xs },
  exerciseSummary: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  disclosureText: { color: colors.accent, fontSize: 20, lineHeight: 24, fontWeight: "700" },
  exerciseActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.xs },
  editGrid: { gap: spacing.md },
  setSectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap", marginTop: spacing.sm },
  setEditor: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background, padding: spacing.md, gap: spacing.sm },
  setHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.md },
  setHeaderCopy: { flex: 1, gap: 3 },
  setTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  setSummary: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  setActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.xs, flexWrap: "wrap" },
  setFields: { gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  fieldRow: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  fieldHalf: { flexGrow: 1, flexBasis: 150, minWidth: 120 },
  choiceField: { gap: spacing.sm },
  choiceLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { minHeight: 38, justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  choiceDisabled: { opacity: 0.52 },
  choiceText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  choiceTextSelected: { color: colors.accent },
  readDetails: { gap: spacing.sm },
  fact: { flexDirection: "row", gap: spacing.lg, paddingVertical: spacing.sm, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  factLabel: { width: 84, color: colors.textDim, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  factValue: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  readSet: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.xs },
  readSetPrimary: { color: colors.text, fontSize: 15, fontWeight: "700" },
  readSetSecondary: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  readSetDetails: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  readSetDetail: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  readSetNote: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  safety: { fontSize: 12, lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalDismissArea: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  dialog: { width: "100%", maxWidth: 480, borderColor: colors.borderStrong, padding: spacing.xl },
  libraryDialog: { maxWidth: 620, maxHeight: "88%", minHeight: 0, flexShrink: 1 },
  libraryHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  librarySearch: { minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background, color: colors.text, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 16 },
  libraryCount: { fontSize: 12 },
  libraryList: { maxHeight: 440, minHeight: 0, flexShrink: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md },
  libraryListContent: { flexGrow: 1 },
  libraryRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  libraryRowPressed: { backgroundColor: colors.surfaceRaised },
  libraryRowCopy: { flex: 1, gap: 3 },
  libraryName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  libraryMeta: { color: colors.textDim, fontSize: 11, textTransform: "capitalize" },
  libraryAdd: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  libraryEmpty: { minHeight: 140, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  webFocusRing: {
    outlineColor: colors.accent,
    outlineOffset: -2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
});
