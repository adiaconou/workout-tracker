import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  Exercise,
  GeneratedRoutineProgram,
  ProgramGenerationJob,
  RoutineAggregate,
  RoutineVersionInput,
} from "../../contracts/api";
import { muscleGroups, type MuscleGroup } from "../../domain/entities";
import { ApiError, apiRequest } from "../api/client";
import { useAuth } from "../auth/public";
import { Body, Button, Card, Eyebrow, Field, Heading, LoadingView, Message, Screen, StepperField } from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import { ExerciseLibraryPicker } from "./exercise-library-picker";
import {
  createProgramGenerationController,
  type ProgramGenerationController,
} from "./program-generation-controller";
import {
  programGenerationAttemptKey,
  programGenerationCanRetry,
  programGenerationIsActive,
  programGenerationPresentation,
  type ProgramGenerationAttempt,
  type ProgramGenerationConnection,
} from "./program-generation-model";
import {
  addExercisesToRoutineDraft,
  buildRoutineCreationPayload,
  createEmptyRoutineDraft,
  deriveRoutineCodeCandidate,
  editableRoutineFromInput,
  estimateRoutineDuration,
  routineDurationEstimateIsWithinTolerance,
  validateRoutineCreationDraft,
} from "./routine-creation-model";
import { RoutineDraftEditor } from "./routine-draft-editor";
import type { EditableRoutine } from "./routine-exercise-editing";

type CreateMode = "manual" | "ai";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";

type EditableGeneratedRoutine = {
  code: string;
  draft: EditableRoutine;
  rationale: string;
};

export function RoutineCreateScreen({
  initialMode,
  initialGenerationId,
}: {
  initialMode: CreateMode | null;
  initialGenerationId: string | null;
}) {
  const { user } = useAuth();
  const defaultDuration = user?.trainingProfile.sessionDurationMin ?? 45;
  const [mode, setMode] = useState<CreateMode | null>(initialMode);
  const [exerciseLibrary, setExerciseLibrary] = useState<Exercise[]>([]);
  const [existingCodes, setExistingCodes] = useState<string[]>([]);
  const [loadingFoundation, setLoadingFoundation] = useState(true);
  const [foundationError, setFoundationError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");

  const [manualDraft, setManualDraft] = useState<EditableRoutine>(() => createEmptyRoutineDraft(defaultDuration));
  const [manualCode, setManualCode] = useState("");
  const [manualCodeEdited, setManualCodeEdited] = useState(false);
  const [creatingManual, setCreatingManual] = useState(false);
  const [manualError, setManualError] = useState("");

  const [programName, setProgramName] = useState("");
  const [goal, setGoal] = useState("Build strength and muscle");
  const [selectedMuscles, setSelectedMuscles] = useState<MuscleGroup[]>([]);
  const [trainingDays, setTrainingDays] = useState(3);
  const [routineCount, setRoutineCount] = useState(3);
  const [targetDuration, setTargetDuration] = useState<number>(defaultDuration);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("intermediate");
  const [avoid, setAvoid] = useState("");
  const [limitations, setLimitations] = useState("");
  const [preferences, setPreferences] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationJob, setGenerationJob] = useState<ProgramGenerationJob | null>(null);
  const [generationConnection, setGenerationConnection] = useState<ProgramGenerationConnection>("connected");
  const [generationTransportError, setGenerationTransportError] = useState("");
  const [cancellingGeneration, setCancellingGeneration] = useState(false);
  const [cancelGenerationError, setCancelGenerationError] = useState("");
  const [generatedProgram, setGeneratedProgram] = useState<GeneratedRoutineProgram | null>(null);
  const [generatedRoutines, setGeneratedRoutines] = useState<EditableGeneratedRoutine[]>([]);
  const [editingGeneratedIndex, setEditingGeneratedIndex] = useState<number | null>(null);
  const [creatingProgram, setCreatingProgram] = useState(false);
  const [programError, setProgramError] = useState("");
  const generationIdempotencyAttempt = useRef<ProgramGenerationAttempt | null>(null);
  const programIdempotencyKey = useRef<string | null>(null);
  const generationController = useRef<ProgramGenerationController | null>(null);
  const acceptedGenerationId = useRef<string | null>(null);
  const ignoredGenerationId = useRef<string | null>(null);
  const manualValidationError = validateRoutineCreationDraft(manualCode, manualDraft);
  const manualCodeInUse = existingCodes.some(
    (code) => code.toUpperCase() === manualCode.trim().toUpperCase(),
  );
  const manualCanCreate = !manualValidationError && !manualCodeInUse;

  useEffect(() => {
    void loadFoundation();
  }, []);

  useEffect(() => {
    if (manualCodeEdited) return;
    setManualCode(deriveRoutineCodeCandidate(manualDraft.focus, existingCodes));
  }, [existingCodes, manualCodeEdited, manualDraft.focus]);

  useEffect(() => {
    const controller = createProgramGenerationController({
      request: apiRequest,
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancelScheduled: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      isRetryableError: (caught) => !(caught instanceof ApiError) || caught.retryable,
      errorMessage: (caught) => caught instanceof Error
        ? caught.message
        : "Generation status could not be checked.",
      onJob: (job) => {
        setGenerationJob(job);
        setGenerationTransportError("");
      },
      onConnection: setGenerationConnection,
      onFatalError: setGenerationTransportError,
    });
    generationController.current = controller;
    return () => {
      controller.stop();
      generationController.current = null;
    };
  }, []);

  useEffect(() => {
    const generationId = initialGenerationId?.trim();
    if (!generationId) {
      ignoredGenerationId.current = null;
      return;
    }
    if (ignoredGenerationId.current === generationId) return;
    ignoredGenerationId.current = null;
    setMode("ai");
    setGeneratedProgram(null);
    setGeneratedRoutines([]);
    setEditingGeneratedIndex(null);
    acceptedGenerationId.current = null;
    generationController.current?.monitor(generationId);
  }, [initialGenerationId]);

  useFocusEffect(useCallback(() => {
    generationController.current?.resume();
    return () => generationController.current?.pause();
  }, []));

  useEffect(() => {
    if (Platform.OS === "web") {
      const updatePollingForVisibility = () => {
        if (document.visibilityState === "visible") generationController.current?.resume();
        else generationController.current?.pause();
      };
      window.addEventListener("focus", updatePollingForVisibility);
      document.addEventListener("visibilitychange", updatePollingForVisibility);
      updatePollingForVisibility();
      return () => {
        window.removeEventListener("focus", updatePollingForVisibility);
        document.removeEventListener("visibilitychange", updatePollingForVisibility);
      };
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") generationController.current?.resume();
      else generationController.current?.pause();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (
      loadingFoundation
      || !generationJob
      || generationJob.status !== "succeeded"
      || acceptedGenerationId.current === generationJob.id
    ) {
      return;
    }
    acceptedGenerationId.current = generationJob.id;
    if (!generationJob.program) {
      setGenerationTransportError("Coach finished, but the generated program could not be loaded.");
      return;
    }
    let editable: EditableGeneratedRoutine[];
    try {
      editable = generationJob.program.routines.map((routine) => ({
        code: routine.code,
        draft: editableRoutineFromInput(routine.version, exerciseLibrary),
        rationale: routine.rationale,
      }));
    } catch {
      setGenerationTransportError(
        "This draft uses an exercise that is no longer available. Edit the details and generate a fresh draft.",
      );
      return;
    }
    setGeneratedProgram(generationJob.program);
    setProgramName(generationJob.program.name);
    setGeneratedRoutines(editable);
    setEditingGeneratedIndex(null);
    programIdempotencyKey.current = null;
  }, [exerciseLibrary, generationJob, loadingFoundation]);

  async function loadFoundation() {
    setLoadingFoundation(true);
    setFoundationError("");
    try {
      const [exercisePayload, routinePayload] = await Promise.all([
        apiRequest<{ exercises: Exercise[] }>("/api/v1/exercises"),
        apiRequest<{ routines: RoutineAggregate[] }>("/api/v1/routines?includeArchived=true"),
      ]);
      setExerciseLibrary(exercisePayload.exercises);
      setExistingCodes(routinePayload.routines.map((routine) => routine.code));
    } catch (caught) {
      setFoundationError(caught instanceof Error ? caught.message : "Routine creation could not be prepared.");
    } finally {
      setLoadingFoundation(false);
    }
  }

  async function reloadLibrary() {
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

  function openLibrary() {
    setLibraryError("");
    setLibraryOpen(true);
    if (!exerciseLibrary.length) void reloadLibrary();
  }

  function addSelectedExercises(exercises: Exercise[]) {
    if (editingGeneratedIndex !== null) {
      setGeneratedRoutines((current) => current.map((routine, index) => index === editingGeneratedIndex
        ? { ...routine, draft: addExercisesToRoutineDraft(routine.draft, exercises) }
        : routine));
    } else {
      setManualDraft((current) => addExercisesToRoutineDraft(current, exercises));
    }
    setLibraryOpen(false);
  }

  async function createManualRoutine() {
    const validationError = validateRoutineCreationDraft(manualCode, manualDraft);
    const codeInUse = existingCodes.some((code) => code.toUpperCase() === manualCode.trim().toUpperCase());
    if (validationError || codeInUse || creatingManual) {
      setManualError(validationError || (codeInUse ? "That routine code is already in use." : ""));
      return;
    }
    setCreatingManual(true);
    setManualError("");
    try {
      const payload = await apiRequest<{ routine: RoutineAggregate }>("/api/v1/routines", {
        method: "POST",
        body: JSON.stringify(buildRoutineCreationPayload(manualCode, manualDraft)),
      });
      router.replace(`/routines/${encodeURIComponent(payload.routine.code)}`);
    } catch (caught) {
      setManualError(caught instanceof Error ? caught.message : "The routine could not be created.");
    } finally {
      setCreatingManual(false);
    }
  }

  async function generateProgram(newAttempt = false) {
    if (generating) return;
    if (!goal.trim()) {
      setGenerationError("Describe the goal for this program.");
      return;
    }
    if (routineCount > trainingDays) {
      setGenerationError("Distinct routines cannot exceed training days per week.");
      return;
    }
    if (newAttempt) {
      generationController.current?.stop();
      ignoredGenerationId.current = initialGenerationId?.trim() ?? generationJob?.id ?? null;
      setGenerationJob(null);
      setGeneratedProgram(null);
      setGeneratedRoutines([]);
      setEditingGeneratedIndex(null);
      acceptedGenerationId.current = null;
    }
    const generationBody = JSON.stringify({
      name: programName,
      goal,
      selectedMuscleGroups: selectedMuscles,
      trainingDaysPerWeek: trainingDays,
      routineCount,
      targetDurationMin: targetDuration,
      experienceLevel,
      avoid,
      limitations,
      preferences,
    });
    const idempotencyKey = programGenerationAttemptKey(
      generationIdempotencyAttempt.current,
      generationBody,
      newAttempt,
      createGenerationIdempotencyKey,
    );
    generationIdempotencyAttempt.current = {
      key: idempotencyKey,
      requestFingerprint: generationBody,
    };
    setGenerating(true);
    setGenerationError("");
    setGenerationTransportError("");
    setCancelGenerationError("");
    setProgramError("");
    try {
      const payload = await apiRequest<{ generation: ProgramGenerationJob }>("/api/v1/assistant/programs/generate", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: generationBody,
      });
      setGenerationJob(payload.generation);
      setGenerationConnection("connected");
      ignoredGenerationId.current = null;
      generationController.current?.monitor(payload.generation.id, payload.generation);
      router.setParams({ mode: "ai", generationId: payload.generation.id });
    } catch (caught) {
      setGenerationError(caught instanceof Error ? caught.message : "Coach could not generate the program.");
    } finally {
      setGenerating(false);
    }
  }

  async function cancelGeneration() {
    const generationId = generationJob?.id ?? initialGenerationId?.trim();
    if (
      !generationId
      || cancellingGeneration
      || (generationJob && !programGenerationIsActive(generationJob.status))
    ) return;
    setCancellingGeneration(true);
    setCancelGenerationError("");
    generationController.current?.pause();
    try {
      const payload = await apiRequest<{ generation: ProgramGenerationJob }>(
        `/api/v1/assistant/program-generations/${encodeURIComponent(generationId)}/cancel`,
        { method: "POST" },
      );
      setGenerationJob(payload.generation);
      generationController.current?.monitor(payload.generation.id, payload.generation);
      generationController.current?.resume();
    } catch (caught) {
      setCancelGenerationError(caught instanceof Error ? caught.message : "Generation could not be cancelled.");
      generationController.current?.resume();
    } finally {
      setCancellingGeneration(false);
    }
  }

  function editGenerationDetails() {
    generationController.current?.stop();
    ignoredGenerationId.current = generationJob?.id ?? initialGenerationId?.trim() ?? null;
    setGenerationJob(null);
    setGenerationConnection("connected");
    setGenerationTransportError("");
    setCancelGenerationError("");
    setGenerationError("");
    setGeneratedProgram(null);
    setGeneratedRoutines([]);
    setEditingGeneratedIndex(null);
    generationIdempotencyAttempt.current = null;
    acceptedGenerationId.current = null;
    router.setParams({ mode: "ai", generationId: "" });
  }

  async function createGeneratedProgram() {
    if (!generatedProgram || creatingProgram) return;
    const routines: Array<{ code: string; version: RoutineVersionInput }> = [];
    const unavailableCodes = new Set(existingCodes.map((code) => code.trim().toUpperCase()));
    const generatedCodes = new Set<string>();
    for (const routine of generatedRoutines) {
      const error = validateRoutineCreationDraft(routine.code, routine.draft);
      if (error) {
        setProgramError(`${routine.draft.focus || routine.code}: ${error}`);
        return;
      }
      const code = routine.code.trim().toUpperCase();
      if (unavailableCodes.has(code)) {
        setProgramError(`Routine code ${code} is already in use.`);
        return;
      }
      if (generatedCodes.has(code)) {
        setProgramError(`Routine code ${code} is used more than once in this program.`);
        return;
      }
      generatedCodes.add(code);
      routines.push(buildRoutineCreationPayload(routine.code, routine.draft));
    }

    setCreatingProgram(true);
    setProgramError("");
    programIdempotencyKey.current ??= createIdempotencyKey();
    try {
      await apiRequest("/api/v1/programs", {
        method: "POST",
        headers: { "x-idempotency-key": programIdempotencyKey.current },
        body: JSON.stringify({
          name: programName || generatedProgram.name,
          goal,
          selectedMuscleGroups: selectedMuscles,
          trainingDaysPerWeek: trainingDays,
          targetDurationMin: targetDuration,
          activate: true,
          routines,
        }),
      });
      router.replace("/routines");
    } catch (caught) {
      setProgramError(caught instanceof Error ? caught.message : "The program could not be created.");
    } finally {
      setCreatingProgram(false);
    }
  }

  if (loadingFoundation) return <LoadingView label="Preparing routine creation…" />;
  if (foundationError) {
    return (
      <Screen safeTop={false}>
        <Message>{foundationError}</Message>
        <Button title="Try again" onPress={() => void loadFoundation()} />
        <Button title="Back to routines" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const editingGenerated = editingGeneratedIndex === null ? null : generatedRoutines[editingGeneratedIndex] ?? null;
  const pickerExerciseIds = editingGenerated
    ? editingGenerated.draft.exercises.map((exercise) => exercise.exerciseId)
    : manualDraft.exercises.map((exercise) => exercise.exerciseId);
  const resumableGenerationId = initialGenerationId?.trim();
  const resumingGeneration = Boolean(
    resumableGenerationId
    && ignoredGenerationId.current !== resumableGenerationId
    && !generationJob
    && !generationError
    && !generating,
  );
  const generationStatusCard = generationJob ? (
    <ProgramGenerationStatusCard
      job={generationJob}
      connection={generationConnection}
      routineCount={routineCount}
      transportError={generationTransportError}
      cancelError={cancelGenerationError}
      cancelling={cancellingGeneration}
      onCheckNow={() => generationController.current?.checkNow()}
      onCancel={() => void cancelGeneration()}
      onRetry={() => void generateProgram(true)}
      onEdit={editGenerationDetails}
    />
  ) : null;

  return (
    <Screen safeTop={false}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={mode ? "Back to creation choices" : "Back to routines"}
        onPress={() => mode ? setMode(null) : router.back()}
        style={({ pressed }) => [styles.backAction, pressed && styles.pressed]}
      >
        <Text style={styles.backText}>← {mode ? "Creation choices" : "All routines"}</Text>
      </Pressable>

      {!mode ? (
        <>
          <View style={styles.intro}>
            <Eyebrow>New routine</Eyebrow>
            <Heading>How would you like to start?</Heading>
            <Body muted>Both paths use the same editor before anything is created.</Body>
          </View>
          {generatedProgram ? (
            <Card style={styles.resumeCard}>
              <Heading size="small">Your Coach draft is ready</Heading>
              <Body muted>Review and edit every routine before creating the program.</Body>
              <Button title="Review draft" variant="secondary" onPress={() => setMode("ai")} />
            </Card>
          ) : generationStatusCard ?? (resumingGeneration ? (
            <ProgramGenerationResumeCard
              connection={generationConnection}
              transportError={generationTransportError}
              cancelError={cancelGenerationError}
              cancelling={cancellingGeneration}
              onCheckNow={() => generationController.current?.checkNow()}
              onCancel={() => void cancelGeneration()}
              onEdit={editGenerationDetails}
            />
          ) : null)}
          <View style={styles.choiceGrid}>
            <Pressable accessibilityRole="button" onPress={() => setMode("manual")} style={({ pressed }) => [styles.modeCard, pressed && styles.pressed]}>
              <Text style={styles.modeMark}>＋</Text>
              <Heading size="medium">Build manually</Heading>
              <Body muted>Choose exercises from your library, then configure sets, targets, and rest.</Body>
              <Text style={styles.modeAction}>Start building →</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setMode("ai")} style={({ pressed }) => [styles.modeCard, pressed && styles.pressed]}>
              <Text style={styles.modeMark}>C</Text>
              <Heading size="medium">Create with Coach</Heading>
              <Body muted>Describe your goals and constraints, then review an editable series of routines.</Body>
              <Text style={styles.modeAction}>Design a program →</Text>
            </Pressable>
          </View>
        </>
      ) : mode === "manual" ? (
        <>
          <View style={styles.intro}>
            <Eyebrow>Manual routine</Eyebrow>
            <Heading>Build your routine</Heading>
            <Body muted>Nothing is saved until you choose Create routine.</Body>
          </View>
          <RoutineDraftEditor
            draft={manualDraft}
            exerciseLibrary={exerciseLibrary}
            disabled={creatingManual}
            onChange={setManualDraft}
            onOpenLibrary={openLibrary}
          />
          <Card style={styles.publishCard}>
            <Field
              label="Routine code"
              hint="Short label using letters, numbers, hyphens, or underscores. A unique suggestion is provided automatically."
              editable={!creatingManual}
              value={manualCode}
              autoCapitalize="characters"
              onChangeText={(code) => {
                setManualCodeEdited(true);
                setManualCode(code.toUpperCase());
              }}
            />
            {manualError ? <Message>{manualError}</Message> : null}
            {!manualCanCreate && !manualError ? (
              <Body muted>
                {manualCodeInUse ? "Choose a unique routine code to continue." : manualValidationError}
              </Body>
            ) : null}
            <Button
              title="Create routine"
              disabled={!manualCanCreate}
              loading={creatingManual}
              onPress={() => void createManualRoutine()}
            />
          </Card>
        </>
      ) : generatedProgram ? (
        <>
          <View style={styles.intro}>
            <Eyebrow>AI program draft</Eyebrow>
            <Heading>{generatedProgram.name}</Heading>
            <Body muted>{generatedProgram.summary}</Body>
            <Text style={styles.reviewNotice}>Nothing has been created yet. Review every routine before publishing.</Text>
          </View>
          {generatedProgram.warnings.map((warning, index) => <Message key={`${warning}:${index}`} tone="warning">{warning}</Message>)}
          {editingGenerated && editingGeneratedIndex !== null ? (
            <>
              <Card style={styles.editingHeader}>
                <Field
                  label="Routine code"
                  value={editingGenerated.code}
                  editable={!creatingProgram}
                  onChangeText={(code) => setGeneratedRoutines((current) => current.map((routine, index) => index === editingGeneratedIndex ? { ...routine, code: code.toUpperCase() } : routine))}
                />
                <Body muted>{editingGenerated.rationale}</Body>
                <Button title="Done editing" variant="secondary" onPress={() => setEditingGeneratedIndex(null)} />
              </Card>
              <RoutineDraftEditor
                draft={editingGenerated.draft}
                exerciseLibrary={exerciseLibrary}
                disabled={creatingProgram}
                onChange={(draft) => setGeneratedRoutines((current) => current.map((routine, index) => index === editingGeneratedIndex ? { ...routine, draft } : routine))}
                onOpenLibrary={openLibrary}
              />
            </>
          ) : (
            <View style={styles.generatedList}>
              {generatedRoutines.map((routine, index) => (
                <GeneratedRoutineOverviewCard
                  key={`${routine.code}:${index}`}
                  routine={routine}
                  onReview={() => setEditingGeneratedIndex(index)}
                />
              ))}
            </View>
          )}
          {programError ? <Message>{programError}</Message> : null}
          <Card style={styles.publishCard}>
            <Heading size="small">Ready to create this program?</Heading>
            <Body muted>All routines are created together and this becomes your active recommendation rotation.</Body>
            <Button title="Create program" loading={creatingProgram} disabled={editingGeneratedIndex !== null} onPress={() => void createGeneratedProgram()} />
            <Button title="Edit program details" variant="ghost" disabled={creatingProgram} onPress={editGenerationDetails} />
          </Card>
        </>
      ) : generationJob || resumingGeneration ? (
        <>
          <View style={styles.intro}>
            <Eyebrow>Create with Coach</Eyebrow>
            <Heading>Your program draft</Heading>
            <Body muted>You can leave this screen while Coach works. Return to this link to resume progress.</Body>
          </View>
          {generationStatusCard ?? (
            <ProgramGenerationResumeCard
              connection={generationConnection}
              transportError={generationTransportError}
              cancelError={cancelGenerationError}
              cancelling={cancellingGeneration}
              onCheckNow={() => generationController.current?.checkNow()}
              onCancel={() => void cancelGeneration()}
              onEdit={editGenerationDetails}
            />
          )}
        </>
      ) : (
        <>
          <View style={styles.intro}>
            <Eyebrow>Create with Coach</Eyebrow>
            <Heading>Design a program around you</Heading>
            <Body muted>Coach will use only exercises supported by your Training Setup. You review and edit the result before saving.</Body>
          </View>
          <Card style={styles.aiForm}>
            <Field label="Program name" hint="Optional; Coach can suggest one." value={programName} onChangeText={setProgramName} />
            <Field label="Primary goal" value={goal} multiline onChangeText={setGoal} />
            <View style={styles.formSection}>
              <Text style={styles.formLabel}>Priority muscles</Text>
              <Body muted>Optional. Select any muscles that deserve extra emphasis.</Body>
              <View style={styles.chips}>
                {muscleGroups.map((muscle) => <SelectionChip key={muscle} label={label(muscle)} selected={selectedMuscles.includes(muscle)} onPress={() => setSelectedMuscles((current) => toggleValue(current, muscle))} />)}
              </View>
            </View>
            <View style={styles.stepperGrid}>
              <StepperField label="Training days per week" minimum={1} step={1} keyboardType="number-pad" value={String(trainingDays)} onChangeText={(value) => updateWholeNumber(value, 1, 7, setTrainingDays)} />
              <StepperField label="Distinct routines" hint="For example, four days can rotate two routines A/B/A/B." minimum={1} step={1} keyboardType="number-pad" value={String(routineCount)} onChangeText={(value) => updateWholeNumber(value, 1, 7, setRoutineCount)} />
              <StepperField label="Target minutes per routine" minimum={10} step={5} keyboardType="number-pad" value={String(targetDuration)} onChangeText={(value) => updateWholeNumber(value, 10, 300, setTargetDuration)} />
            </View>
            <View style={styles.formSection}>
              <Text style={styles.formLabel}>Experience</Text>
              <View style={styles.chips}>
                {(["beginner", "intermediate", "advanced"] as ExperienceLevel[]).map((level) => <SelectionChip key={level} label={label(level)} selected={experienceLevel === level} onPress={() => setExperienceLevel(level)} />)}
              </View>
            </View>
            <View style={styles.equipmentSummary}>
              <Text style={styles.formLabel}>Available equipment</Text>
              <Text style={styles.equipmentText}>{user?.trainingProfile.equipment.map(label).join(" · ") || "Not configured"}</Text>
              <Button title="Edit Training Setup" compact variant="ghost" onPress={() => router.push("/profile")} />
            </View>
            <Field label="Movements to avoid" placeholder="Optional" value={avoid} multiline onChangeText={setAvoid} />
            <Field label="Limitations" placeholder="Optional; do not include private medical details" value={limitations} multiline onChangeText={setLimitations} />
            <Field label="Other preferences" placeholder="Favorite styles, exercises, or scheduling preferences" value={preferences} multiline onChangeText={setPreferences} />
            {generationError ? <Message>{generationError}</Message> : null}
            <Button title="Generate program" loading={generating} onPress={() => void generateProgram()} />
          </Card>
        </>
      )}

      <ExerciseLibraryPicker
        visible={libraryOpen}
        title={editingGenerated ? `Add to ${editingGenerated.draft.focus}` : "Add to new routine"}
        exercises={exerciseLibrary}
        existingExerciseIds={pickerExerciseIds}
        loading={libraryLoading}
        error={libraryError}
        onClose={() => setLibraryOpen(false)}
        onRetry={() => void reloadLibrary()}
        onAdd={addSelectedExercises}
      />
    </Screen>
  );
}

function GeneratedRoutineOverviewCard({
  routine,
  onReview,
}: {
  routine: EditableGeneratedRoutine;
  onReview: () => void;
}) {
  const estimate = estimateRoutineDuration(routine.draft);
  const withinTargetRange = routineDurationEstimateIsWithinTolerance(estimate);
  const deltaLabel = estimate.deltaMinutes === 0
    ? "0 min delta"
    : `${Math.abs(estimate.deltaMinutes)} min ${estimate.deltaMinutes < 0 ? "under" : "over"}`;

  return (
    <Card style={styles.generatedCard}>
      <View style={styles.generatedTopline}>
        <View style={styles.generatedCopy}>
          <Eyebrow>Routine {routine.code}</Eyebrow>
          <Heading size="small">{routine.draft.focus}</Heading>
        </View>
        <Button title="Review & edit" compact variant="secondary" onPress={onReview} />
      </View>
      <Body muted>{routine.draft.summary}</Body>
      <Text style={styles.generatedMeta}>{routine.draft.exercises.length} exercises</Text>
      <View style={styles.generatedTimingRow} accessibilityLiveRegion="polite">
        <Text style={styles.generatedTiming}>
          ~{estimate.estimatedMinutes} min estimated · {estimate.targetMinutes} min requested · {deltaLabel}
        </Text>
        <Text style={[
          styles.generatedTimingStatus,
          !withinTargetRange && styles.generatedTimingStatusWarning,
        ]}>
          {withinTargetRange ? "Within requested range" : "Timing needs adjustment"}
        </Text>
      </View>
      <Text style={styles.rationale}>{routine.rationale}</Text>
    </Card>
  );
}

function ProgramGenerationStatusCard({
  job,
  connection,
  routineCount,
  transportError,
  cancelError,
  cancelling,
  onCheckNow,
  onCancel,
  onRetry,
  onEdit,
}: {
  job: ProgramGenerationJob;
  connection: ProgramGenerationConnection;
  routineCount: number;
  transportError: string;
  cancelError: string;
  cancelling: boolean;
  onCheckNow: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const presentation = programGenerationPresentation(job, connection, routineCount);
  const reviewLoadFailed = job.status === "succeeded" && Boolean(transportError);
  const displayedPresentation = reviewLoadFailed
    ? {
        title: "This draft can no longer be opened",
        detail: "No routines were created. Generate a fresh draft from your saved program details.",
        active: false,
      }
    : presentation;
  const canCheckNow = programGenerationIsActive(job.status)
    && (connection === "reconnecting" || connection === "failed");
  const canCancel = programGenerationIsActive(job.status) && job.status !== "cancelling";
  const canStartAgain = programGenerationCanRetry(job)
    || job.status === "cancelled"
    || (job.status === "succeeded" && (!job.program || reviewLoadFailed));

  return (
    <Card style={styles.generationStatusCard}>
      <View
        role="status"
        accessibilityLiveRegion="polite"
        style={styles.generationStatusHeader}
      >
        {displayedPresentation.active ? (
          <ActivityIndicator
            accessibilityLabel="Program generation is active"
            color={colors.accent}
          />
        ) : null}
        <View style={styles.generationStatusCopy}>
          <Heading size="small">{displayedPresentation.title}</Heading>
          <Body muted>{displayedPresentation.detail}</Body>
        </View>
      </View>
      {job.error?.message ? <Message>{job.error.message}</Message> : null}
      {transportError ? <Message>{transportError}</Message> : null}
      {cancelError ? <Message>{cancelError}</Message> : null}
      <View style={styles.generationActions}>
        {canCheckNow ? (
          <Button title="Check now" variant="secondary" onPress={onCheckNow} />
        ) : null}
        {canCancel ? (
          <Button
            title="Cancel generation"
            variant="ghost"
            loading={cancelling}
            onPress={onCancel}
          />
        ) : null}
        {canStartAgain ? <Button title="Try again" onPress={onRetry} /> : null}
        {!displayedPresentation.active ? (
          <Button title="Edit details" variant="secondary" onPress={onEdit} />
        ) : null}
      </View>
    </Card>
  );
}

function ProgramGenerationResumeCard({
  connection,
  transportError,
  cancelError,
  cancelling,
  onCheckNow,
  onCancel,
  onEdit,
}: {
  connection: ProgramGenerationConnection;
  transportError: string;
  cancelError: string;
  cancelling: boolean;
  onCheckNow: () => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const failed = connection === "failed";
  const reconnecting = connection === "reconnecting";
  const title = failed
    ? "We could not resume this generation"
    : reconnecting
      ? "Reconnecting to your generation"
      : "Checking your generation";
  const detail = failed
    ? "The request may still be running. Check again, cancel it, or return to your program details."
    : "Coach keeps working on the server while we load the latest progress.";

  return (
    <Card style={styles.generationStatusCard}>
      <View role="status" accessibilityLiveRegion="polite" style={styles.generationStatusHeader}>
        {!failed ? <ActivityIndicator accessibilityLabel="Checking program generation" color={colors.accent} /> : null}
        <View style={styles.generationStatusCopy}>
          <Heading size="small">{title}</Heading>
          <Body muted>{detail}</Body>
        </View>
      </View>
      {transportError ? <Message>{transportError}</Message> : null}
      {cancelError ? <Message>{cancelError}</Message> : null}
      <View style={styles.generationActions}>
        {failed || reconnecting ? <Button title="Check now" variant="secondary" onPress={onCheckNow} /> : null}
        <Button title="Cancel generation" variant="ghost" loading={cancelling} onPress={onCancel} />
        {failed ? <Button title="Edit details" variant="secondary" onPress={onEdit} /> : null}
      </View>
    </Card>
  );
}

function SelectionChip({ label: chipLabel, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={chipLabel}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{chipLabel}</Text>
    </Pressable>
  );
}

function toggleValue<T>(current: readonly T[], value: T) {
  return current.includes(value) ? current.filter((candidate) => candidate !== value) : [...current, value];
}

function updateWholeNumber(
  text: string,
  minimum: number,
  maximum: number,
  onChange: (value: number) => void,
) {
  if (!text.trim()) return;
  const value = Number(text);
  if (Number.isInteger(value) && value >= minimum && value <= maximum) onChange(value);
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function createIdempotencyKey() {
  return `program-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createGenerationIdempotencyKey() {
  return `program-generation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const styles = StyleSheet.create({
  backAction: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", borderRadius: radii.sm, paddingHorizontal: spacing.sm, marginLeft: -spacing.sm },
  backText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  intro: { gap: spacing.sm },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  modeCard: { flexGrow: 1, flexBasis: 320, minHeight: 240, justifyContent: "space-between", gap: spacing.md, padding: spacing.xl, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.lg, backgroundColor: colors.surface },
  modeMark: { width: 44, height: 44, textAlign: "center", textAlignVertical: "center", color: colors.background, backgroundColor: colors.accent, borderRadius: radii.md, fontSize: 24, lineHeight: 44, fontWeight: "900" },
  modeAction: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  publishCard: { gap: spacing.lg },
  resumeCard: { gap: spacing.md },
  aiForm: { gap: spacing.xl },
  formSection: { gap: spacing.sm },
  formLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.pill, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: colors.accent },
  stepperGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  equipmentSummary: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background },
  equipmentText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  reviewNotice: { color: colors.warning, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  generatedList: { gap: spacing.md },
  generatedCard: { gap: spacing.md },
  generatedTopline: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  generatedCopy: { flex: 1, minWidth: 220, gap: spacing.xs },
  generatedMeta: { color: colors.accent, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  generatedTimingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm },
  generatedTiming: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: "800", fontVariant: ["tabular-nums"] },
  generatedTimingStatus: { color: colors.success, fontSize: 11, lineHeight: 16, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  generatedTimingStatusWarning: { color: colors.warning },
  rationale: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  editingHeader: { gap: spacing.md },
  generationStatusCard: { gap: spacing.lg },
  generationStatusHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  generationStatusCopy: { flex: 1, gap: spacing.xs },
  generationActions: { gap: spacing.sm },
  pressed: { opacity: 0.72 },
});
