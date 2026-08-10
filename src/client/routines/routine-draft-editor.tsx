import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  Exercise,
  RestRule,
  RoutineSetType,
  SideMode,
  TargetType,
} from "../../domain/entities";
import { Body, Button, Card, Field, Heading, StepperField } from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import {
  appendRoutineSetPreservingTransition,
  duplicateRoutineSetPreservingTransition,
  estimateRoutineDuration,
  moveRoutineSetPreservingTransition,
  removeRoutineSetPreservingTransition,
  routineDurationEstimateIsWithinTolerance,
  setRestBeforeNextExercise,
  setRestBetweenSets,
} from "./routine-creation-model";
import {
  moveRoutineExercise,
  type EditableRoutine,
  type EditableRoutineExercise,
  type EditableRoutineSet,
} from "./routine-exercise-editing";

const setTypeOptions: ReadonlyArray<readonly [RoutineSetType, string]> = [
  ["warmup", "Warm-up"],
  ["regular", "Regular"],
  ["failure", "Failure"],
  ["drop", "Drop"],
  ["emom", "EMOM"],
  ["test", "Test"],
];
const targetTypeOptions: ReadonlyArray<readonly [TargetType, string]> = [
  ["reps", "Reps"],
  ["duration", "Duration"],
  ["rounds", "Rounds"],
];
const restRuleOptions: ReadonlyArray<readonly [RestRule, string]> = [
  ["standard", "Standard"],
  ["after_both_sides", "After both sides"],
  ["no_rest_before_drop", "No rest before drop"],
  ["emom", "EMOM"],
  ["after_superset", "After superset"],
];
const sideModeOptions: ReadonlyArray<readonly [SideMode, string]> = [
  ["bilateral", "Bilateral"],
  ["per_side", "Per side"],
  ["per_leg", "Per leg"],
  ["left_right", "Left / right"],
];

export function RoutineDraftEditor({
  draft,
  exerciseLibrary,
  disabled = false,
  onChange,
  onOpenLibrary,
}: {
  draft: EditableRoutine;
  exerciseLibrary: readonly Exercise[];
  disabled?: boolean;
  onChange: (next: EditableRoutine) => void;
  onOpenLibrary: () => void;
}) {
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(() => new Set());
  const [expandedSets, setExpandedSets] = useState<Set<string>>(() => new Set());
  const estimate = estimateRoutineDuration(draft);
  const hasEstimatedWork = draft.exercises.some((exercise) => exercise.sets.length > 0);
  const timingWithinTolerance = hasEstimatedWork
    && routineDurationEstimateIsWithinTolerance(estimate);
  const timingNeedsAttention = hasEstimatedWork && !timingWithinTolerance;
  const exerciseById = useMemo(
    () => new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise])),
    [exerciseLibrary],
  );

  function updateDraft(patch: Partial<EditableRoutine>) {
    onChange({ ...draft, ...patch });
  }

  function updateExercise(index: number, patch: Partial<EditableRoutineExercise>) {
    onChange({
      ...draft,
      exercises: draft.exercises.map((exercise, exerciseIndex) => (
        exerciseIndex === index ? { ...exercise, ...patch } : exercise
      )),
    });
  }

  function updateSet(exerciseIndex: number, setIndex: number, patch: Partial<EditableRoutineSet>) {
    const exercise = draft.exercises[exerciseIndex];
    if (!exercise) return;
    updateExercise(exerciseIndex, {
      sets: exercise.sets.map((set, currentIndex) => currentIndex === setIndex ? { ...set, ...patch } : set),
    });
  }

  function removeExercise(index: number) {
    const exercises = draft.exercises
      .filter((_, exerciseIndex) => exerciseIndex !== index)
      .map((exercise, exerciseIndex) => ({ ...exercise, position: exerciseIndex + 1 }));
    onChange({ ...draft, exercises });
  }

  return (
    <View style={styles.editor}>
      <Card style={styles.detailsCard}>
        <Heading size="small">Routine details</Heading>
        <Field
          label="Routine name"
          editable={!disabled}
          value={draft.focus}
          placeholder="Upper-body strength"
          onChangeText={(focus) => updateDraft({ focus })}
        />
        <Field
          label="Summary"
          editable={!disabled}
          value={draft.summary}
          placeholder="What this routine is designed to accomplish"
          multiline
          onChangeText={(summary) => updateDraft({ summary })}
        />
        <StepperField
          label="Target duration"
          hint="Minutes. This is your time budget, not a promise."
          editable={!disabled}
          minimum={5}
          step={5}
          keyboardType="number-pad"
          value={Number.isFinite(draft.durationMin) ? String(draft.durationMin) : ""}
          onChangeText={(value) => updateDraftNumber(value, (durationMin) => updateDraft({ durationMin }))}
        />
        <View accessibilityLiveRegion="polite" style={styles.durationRow}>
          <View>
            <Text style={styles.durationValue}>
              {hasEstimatedWork ? `~${estimate.estimatedMinutes} min` : "—"}
            </Text>
            <Text style={styles.durationLabel}>live estimate</Text>
          </View>
          <View style={[
            styles.durationStatus,
            timingNeedsAttention && styles.durationStatusWarning,
            !hasEstimatedWork && styles.durationStatusNeutral,
          ]}>
            <Text style={[
              styles.durationStatusText,
              timingNeedsAttention && styles.durationStatusWarningText,
              !hasEstimatedWork && styles.durationStatusNeutralText,
            ]}>
              {!hasEstimatedWork
                ? "Add exercises to estimate"
                : estimate.status === "on_target"
                  ? "On target"
                  : `${Math.abs(estimate.deltaMinutes)} min ${estimate.status === "over_target" ? "over" : "under"}${timingWithinTolerance ? " · in range" : ""}`}
            </Text>
          </View>
        </View>
      </Card>

      <View style={styles.sectionHeading}>
        <View style={styles.sectionCopy}>
          <Heading size="medium">Exercises</Heading>
          <Body muted>
            {draft.exercises.length
              ? `${draft.exercises.length} selected · reorder or fine-tune any set`
              : "Choose exercises from your library"}
          </Body>
        </View>
        {draft.exercises.length ? (
          <Button title="Add exercises" compact variant="secondary" disabled={disabled} onPress={onOpenLibrary} />
        ) : null}
      </View>

      {!draft.exercises.length ? (
        <Card style={styles.emptyCard}>
          <Heading size="small">Choose your first exercises</Heading>
          <Body muted>Search or filter by muscle, equipment, movement, or any matching keyword.</Body>
          <Button title="Choose exercises" onPress={onOpenLibrary} disabled={disabled} />
        </Card>
      ) : null}

      {draft.exercises.map((exercise, exerciseIndex) => {
        const expanded = expandedExercises.has(exercise.draftId);
        const libraryExercise = exerciseById.get(exercise.exerciseId);
        const primaryMuscles = libraryExercise?.muscles
          .filter((muscle) => muscle.role === "primary")
          .map((muscle) => label(muscle.muscleGroup)) ?? [];
        const secondaryMuscles = libraryExercise?.muscles
          .filter((muscle) => muscle.role === "secondary")
          .map((muscle) => label(muscle.muscleGroup)) ?? [];
        const workSet = exercise.sets.find((set) => set.setType !== "warmup") ?? exercise.sets[0];
        const lastExercise = exerciseIndex === draft.exercises.length - 1;
        const betweenRest = exercise.sets.at(0)?.restAfterSec ?? 0;
        const transitionRest = exercise.sets.at(-1)?.restAfterSec ?? 0;

        return (
          <Card key={exercise.draftId} style={styles.exerciseCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${exercise.exerciseName}`}
              accessibilityState={{ expanded }}
              onPress={() => setExpandedExercises((current) => toggled(current, exercise.draftId))}
              style={({ pressed }) => [styles.exerciseHeader, pressed && styles.pressed]}
            >
              <View style={styles.exerciseHeaderCopy}>
                <Text style={styles.exerciseName}>{exerciseIndex + 1}. {exercise.exerciseName}</Text>
                <Text style={styles.exerciseSummary}>
                  {exercise.sets.length} {exercise.sets.length === 1 ? "set" : "sets"}
                  {workSet ? ` · ${workSet.targetDisplay}` : ""}
                  {exercise.sets.length > 1 ? ` · ${betweenRest}s between` : ""}
                </Text>
              </View>
              <Text style={styles.disclosure}>{expanded ? "−" : "+"}</Text>
            </Pressable>

            <View style={styles.compactActions}>
              <Button
                title="Up"
                accessibilityLabel={`Move ${exercise.exerciseName} up`}
                compact
                variant="ghost"
                disabled={disabled || exerciseIndex === 0}
                onPress={() => onChange({ ...draft, exercises: moveRoutineExercise(draft.exercises, exerciseIndex, -1) })}
              />
              <Button
                title="Down"
                accessibilityLabel={`Move ${exercise.exerciseName} down`}
                compact
                variant="ghost"
                disabled={disabled || lastExercise}
                onPress={() => onChange({ ...draft, exercises: moveRoutineExercise(draft.exercises, exerciseIndex, 1) })}
              />
              <Button
                title="Remove"
                accessibilityLabel={`Remove ${exercise.exerciseName}`}
                compact
                variant="ghost"
                disabled={disabled}
                onPress={() => removeExercise(exerciseIndex)}
              />
            </View>

            {primaryMuscles.length || secondaryMuscles.length ? (
              <View style={styles.tags}>
                {primaryMuscles.map((muscle) => (
                  <View key={`primary:${muscle}`} style={[styles.tag, styles.primaryTag]}>
                    <Text style={styles.primaryTagText}>{muscle} · primary</Text>
                  </View>
                ))}
                {secondaryMuscles.map((muscle) => (
                  <View key={`secondary:${muscle}`} style={styles.tag}>
                    <Text style={styles.tagText}>{muscle} · secondary</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.untagged}>Muscle tags are missing for this library exercise.</Text>
            )}

            {expanded ? (
              <View style={styles.expandedContent}>
                {exercise.sets.length > 1 ? (
                  <StepperField
                    label="Rest between sets"
                    hint="Seconds. Applies to every set except the last."
                    editable={!disabled}
                    minimum={0}
                    step={15}
                    keyboardType="number-pad"
                    value={String(betweenRest)}
                    onChangeText={(value) => updateDraftNumber(value, (restAfterSec) => updateExercise(exerciseIndex, {
                      sets: setRestBetweenSets(exercise.sets, restAfterSec),
                    }))}
                  />
                ) : null}
                {!lastExercise ? (
                  <StepperField
                    label="Rest before next exercise"
                    hint="Seconds after the final set of this exercise."
                    editable={!disabled}
                    minimum={0}
                    step={15}
                    keyboardType="number-pad"
                    value={String(transitionRest)}
                    onChangeText={(value) => updateDraftNumber(value, (restAfterSec) => updateExercise(exerciseIndex, {
                      sets: setRestBeforeNextExercise(exercise.sets, restAfterSec),
                    }))}
                  />
                ) : (
                  <Text style={styles.finalRestNote}>The final exercise ends the workout; no transition rest is started.</Text>
                )}

                <Field
                  label="Superset group"
                  hint="Optional. Give linked exercises the same group label."
                  editable={!disabled}
                  value={exercise.supersetGroup ?? ""}
                  onChangeText={(supersetGroup) => updateExercise(exerciseIndex, { supersetGroup: supersetGroup || null })}
                />
                <Field
                  label="Exercise instructions"
                  editable={!disabled}
                  value={exercise.instructions ?? ""}
                  multiline
                  onChangeText={(instructions) => updateExercise(exerciseIndex, { instructions })}
                />

                <View style={styles.setHeading}>
                  <Heading size="small">Sets</Heading>
                  <Button
                    title="+ Set"
                    accessibilityLabel={`Add a set to ${exercise.exerciseName}`}
                    compact
                    variant="secondary"
                    disabled={disabled}
                    onPress={() => updateExercise(exerciseIndex, { sets: appendRoutineSetPreservingTransition(exercise.sets) })}
                  />
                </View>

                {exercise.sets.map((set, setIndex) => {
                  const setExpanded = expandedSets.has(set.draftId);
                  const lastSet = setIndex === exercise.sets.length - 1;
                  const restLabel = lastSet && !lastExercise
                    ? "Rest before next exercise"
                    : lastSet && lastExercise
                      ? "No post-workout rest"
                      : "Rest before next set";
                  return (
                    <View key={set.draftId} style={styles.setCard}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${setExpanded ? "Collapse" : "Expand"} ${exercise.exerciseName} set ${setIndex + 1}`}
                        accessibilityState={{ expanded: setExpanded }}
                        onPress={() => setExpandedSets((current) => toggled(current, set.draftId))}
                        style={({ pressed }) => [styles.setHeader, pressed && styles.pressed]}
                      >
                        <View>
                          <Text style={styles.setTitle}>Set {setIndex + 1} · {label(set.setType)}</Text>
                          <Text style={styles.setSummary}>{set.targetDisplay} · {restLabel}{lastSet && lastExercise ? "" : ` ${set.restAfterSec}s`}</Text>
                        </View>
                        <Text style={styles.disclosure}>{setExpanded ? "−" : "+"}</Text>
                      </Pressable>
                      <View style={styles.compactActions}>
                        <Button title="Up" accessibilityLabel={`Move set ${setIndex + 1} up`} compact variant="ghost" disabled={disabled || setIndex === 0} onPress={() => updateExercise(exerciseIndex, { sets: moveRoutineSetPreservingTransition(exercise.sets, setIndex, -1) })} />
                        <Button title="Down" accessibilityLabel={`Move set ${setIndex + 1} down`} compact variant="ghost" disabled={disabled || lastSet} onPress={() => updateExercise(exerciseIndex, { sets: moveRoutineSetPreservingTransition(exercise.sets, setIndex, 1) })} />
                        <Button title="Duplicate" accessibilityLabel={`Duplicate set ${setIndex + 1}`} compact variant="ghost" disabled={disabled} onPress={() => updateExercise(exerciseIndex, { sets: duplicateRoutineSetPreservingTransition(exercise.sets, setIndex) })} />
                        <Button title="Remove" accessibilityLabel={`Remove set ${setIndex + 1}`} compact variant="ghost" disabled={disabled || exercise.sets.length === 1} onPress={() => updateExercise(exerciseIndex, { sets: removeRoutineSetPreservingTransition(exercise.sets, setIndex) })} />
                      </View>

                      {setExpanded ? (
                        <View style={styles.setFields}>
                          <ChoiceField label="Set type" value={set.setType} options={setTypeOptions} disabled={disabled} onChange={(setType) => updateSet(exerciseIndex, setIndex, { setType })} />
                          <ChoiceField label="Target type" value={set.targetType} options={targetTypeOptions} disabled={disabled} onChange={(targetType) => updateSet(exerciseIndex, setIndex, { targetType })} />
                          <Field label="Display target" editable={!disabled} value={set.targetDisplay} onChangeText={(targetDisplay) => updateSet(exerciseIndex, setIndex, { targetDisplay })} />
                          <View style={styles.fieldPair}>
                            <NumberField label="Target minimum" value={set.targetMin} disabled={disabled} onChange={(targetMin) => updateSet(exerciseIndex, setIndex, { targetMin })} />
                            <NumberField label="Target maximum" value={set.targetMax} disabled={disabled} onChange={(targetMax) => updateSet(exerciseIndex, setIndex, { targetMax })} />
                            <NumberField label="RIR minimum" value={set.targetRirMin} disabled={disabled} onChange={(targetRirMin) => updateSet(exerciseIndex, setIndex, { targetRirMin })} />
                            <NumberField label="RIR maximum" value={set.targetRirMax} disabled={disabled} onChange={(targetRirMax) => updateSet(exerciseIndex, setIndex, { targetRirMax })} />
                            <NumberField label={restLabel} value={lastSet && lastExercise ? 0 : set.restAfterSec} disabled={disabled || (lastSet && lastExercise)} onChange={(restAfterSec) => updateSet(exerciseIndex, setIndex, { restAfterSec: restAfterSec ?? 0 })} />
                            <Field label="Tempo" editable={!disabled} value={set.tempo ?? ""} placeholder="Optional" onChangeText={(tempo) => updateSet(exerciseIndex, setIndex, { tempo: tempo || null })} />
                          </View>
                          <ChoiceField label="Rest rule" value={set.restRule} options={restRuleOptions} disabled={disabled || (lastSet && lastExercise)} onChange={(restRule) => updateSet(exerciseIndex, setIndex, { restRule })} />
                          <ChoiceField label="Side mode" value={set.sideMode} options={sideModeOptions} disabled={disabled} onChange={(sideMode) => updateSet(exerciseIndex, setIndex, { sideMode })} />
                          <Field label="Load instruction" editable={!disabled} value={set.loadInstruction} multiline onChangeText={(loadInstruction) => updateSet(exerciseIndex, setIndex, { loadInstruction })} />
                          <Field label="Set notes" editable={!disabled} value={set.notes} multiline onChangeText={(notes) => updateSet(exerciseIndex, setIndex, { notes })} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </Card>
        );
      })}

      {draft.exercises.length ? (
        <Button title="Add more exercises" variant="secondary" disabled={disabled} onPress={onOpenLibrary} />
      ) : null}
    </View>
  );
}

function ChoiceField<T extends string>({
  label: fieldLabel,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choiceField}>
      <Text style={styles.fieldLabel}>{fieldLabel}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={fieldLabel} style={styles.choiceRow}>
        {options.map(([option, optionLabel]) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={`${fieldLabel}: ${optionLabel}`}
            accessibilityState={{ checked: option === value, disabled }}
            disabled={disabled}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.choice,
              option === value && styles.choiceSelected,
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}
          >
            <Text style={[styles.choiceText, option === value && styles.choiceTextSelected]}>{optionLabel}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NumberField({
  label: fieldLabel,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <View style={styles.numberField}>
      <Field
        label={fieldLabel}
        editable={!disabled}
        keyboardType="decimal-pad"
        value={value === null || !Number.isFinite(value) ? "" : String(value)}
        onChangeText={(text) => onChange(text.trim() ? Number(text) : null)}
      />
    </View>
  );
}

function toggled(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function updateDraftNumber(text: string, onChange: (value: number) => void) {
  if (!text.trim()) return;
  const value = Number(text);
  if (Number.isInteger(value) && value >= 0) onChange(value);
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  editor: { gap: spacing.lg },
  detailsCard: { gap: spacing.lg },
  durationRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  durationValue: { color: colors.text, fontSize: 24, lineHeight: 28, fontWeight: "900", fontVariant: ["tabular-nums"] },
  durationLabel: { color: colors.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700" },
  durationStatus: { backgroundColor: colors.successSurface, borderColor: colors.success, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  durationStatusWarning: { backgroundColor: colors.warningSurface, borderColor: colors.warning },
  durationStatusNeutral: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong },
  durationStatusText: { color: colors.success, fontSize: 12, fontWeight: "800" },
  durationStatusWarningText: { color: colors.warning },
  durationStatusNeutralText: { color: colors.textMuted },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  sectionCopy: { flex: 1, minWidth: 220, gap: spacing.xs },
  emptyCard: { alignItems: "stretch" },
  exerciseCard: { padding: spacing.md, gap: spacing.sm },
  exerciseHeader: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md },
  exerciseHeaderCopy: { flex: 1, minWidth: 0 },
  exerciseName: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: "800" },
  exerciseSummary: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  disclosure: { color: colors.accent, width: 28, textAlign: "center", fontSize: 22, fontWeight: "800" },
  compactActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tag: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  primaryTag: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  tagText: { color: colors.textMuted, fontSize: 10, lineHeight: 14, fontWeight: "700" },
  primaryTagText: { color: colors.accent, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  untagged: { color: colors.warning, fontSize: 11, lineHeight: 16 },
  expandedContent: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.md },
  finalRestNote: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  setHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  setCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background, padding: spacing.sm, gap: spacing.sm },
  setHeader: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderRadius: radii.sm, paddingHorizontal: spacing.sm },
  setTitle: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  setSummary: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  setFields: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.md },
  fieldPair: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  numberField: { flexGrow: 1, flexBasis: 180, minWidth: 150 },
  choiceField: { gap: spacing.sm },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { minHeight: 42, justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.background },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  choiceText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  choiceTextSelected: { color: colors.accent },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
