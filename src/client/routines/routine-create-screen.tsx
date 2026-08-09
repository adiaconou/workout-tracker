import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Exercise, RoutineAggregate, RoutineVersionInput } from "../../contracts/api";
import { muscleGroups, type MuscleGroup } from "../../domain/entities";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/public";
import { Body, Button, Card, Eyebrow, Field, Heading, LoadingView, Message, Screen, StepperField } from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import { ExerciseLibraryPicker } from "./exercise-library-picker";
import {
  addExercisesToRoutineDraft,
  buildRoutineCreationPayload,
  createEmptyRoutineDraft,
  deriveRoutineCodeCandidate,
  editableRoutineFromInput,
  validateRoutineCreationDraft,
} from "./routine-creation-model";
import { RoutineDraftEditor } from "./routine-draft-editor";
import type { EditableRoutine } from "./routine-exercise-editing";

type CreateMode = "manual" | "ai";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";

type GeneratedRoutineDraft = {
  code: string;
  version: RoutineVersionInput;
  rationale: string;
};

type GeneratedProgram = {
  name: string;
  summary: string;
  warnings: string[];
  routines: GeneratedRoutineDraft[];
};

type EditableGeneratedRoutine = {
  code: string;
  draft: EditableRoutine;
  rationale: string;
};

export function RoutineCreateScreen({ initialMode }: { initialMode: CreateMode | null }) {
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
  const [generatedProgram, setGeneratedProgram] = useState<GeneratedProgram | null>(null);
  const [generatedRoutines, setGeneratedRoutines] = useState<EditableGeneratedRoutine[]>([]);
  const [editingGeneratedIndex, setEditingGeneratedIndex] = useState<number | null>(null);
  const [creatingProgram, setCreatingProgram] = useState(false);
  const [programError, setProgramError] = useState("");
  const programIdempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    void loadFoundation();
  }, []);

  useEffect(() => {
    if (manualCodeEdited) return;
    setManualCode(deriveRoutineCodeCandidate(manualDraft.focus, existingCodes));
  }, [existingCodes, manualCodeEdited, manualDraft.focus]);

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

  async function generateProgram() {
    if (generating) return;
    if (!goal.trim()) {
      setGenerationError("Describe the goal for this program.");
      return;
    }
    if (routineCount > trainingDays) {
      setGenerationError("Distinct routines cannot exceed training days per week.");
      return;
    }
    setGenerating(true);
    setGenerationError("");
    setProgramError("");
    try {
      const payload = await apiRequest<{ program: GeneratedProgram }>("/api/v1/assistant/programs/generate", {
        method: "POST",
        body: JSON.stringify({
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
        }),
      });
      const editable = payload.program.routines.map((routine) => ({
        code: routine.code,
        draft: editableRoutineFromInput(routine.version, exerciseLibrary),
        rationale: routine.rationale,
      }));
      setGeneratedProgram(payload.program);
      setProgramName(payload.program.name);
      setGeneratedRoutines(editable);
      setEditingGeneratedIndex(null);
      programIdempotencyKey.current = null;
    } catch (caught) {
      setGenerationError(caught instanceof Error ? caught.message : "Coach could not generate the program.");
    } finally {
      setGenerating(false);
    }
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
            <Button title="Create routine" loading={creatingManual} onPress={() => void createManualRoutine()} />
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
                <Card key={`${routine.code}:${index}`} style={styles.generatedCard}>
                  <View style={styles.generatedTopline}>
                    <View style={styles.generatedCopy}>
                      <Eyebrow>Routine {routine.code}</Eyebrow>
                      <Heading size="small">{routine.draft.focus}</Heading>
                    </View>
                    <Button title="Review & edit" compact variant="secondary" onPress={() => setEditingGeneratedIndex(index)} />
                  </View>
                  <Body muted>{routine.draft.summary}</Body>
                  <Text style={styles.generatedMeta}>{routine.draft.exercises.length} exercises · target {routine.draft.durationMin} min</Text>
                  <Text style={styles.rationale}>{routine.rationale}</Text>
                </Card>
              ))}
            </View>
          )}
          {programError ? <Message>{programError}</Message> : null}
          <Card style={styles.publishCard}>
            <Heading size="small">Ready to create this program?</Heading>
            <Body muted>All routines are created together and this becomes your active recommendation rotation.</Body>
            <Button title="Create program" loading={creatingProgram} disabled={editingGeneratedIndex !== null} onPress={() => void createGeneratedProgram()} />
            <Button title="Start over" variant="ghost" disabled={creatingProgram} onPress={() => {
              setGeneratedProgram(null);
              setGeneratedRoutines([]);
              setEditingGeneratedIndex(null);
              programIdempotencyKey.current = null;
            }} />
          </Card>
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

const styles = StyleSheet.create({
  backAction: { alignSelf: "flex-start", minHeight: 40, justifyContent: "center", borderRadius: radii.sm, paddingHorizontal: spacing.sm, marginLeft: -spacing.sm },
  backText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  intro: { gap: spacing.sm },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  modeCard: { flexGrow: 1, flexBasis: 320, minHeight: 240, justifyContent: "space-between", gap: spacing.md, padding: spacing.xl, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.lg, backgroundColor: colors.surface },
  modeMark: { width: 44, height: 44, textAlign: "center", textAlignVertical: "center", color: colors.background, backgroundColor: colors.accent, borderRadius: radii.md, fontSize: 24, lineHeight: 44, fontWeight: "900" },
  modeAction: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  publishCard: { gap: spacing.lg },
  aiForm: { gap: spacing.xl },
  formSection: { gap: spacing.sm },
  formLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 40, justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.pill, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
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
  rationale: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  editingHeader: { gap: spacing.md },
  pressed: { opacity: 0.72 },
});
