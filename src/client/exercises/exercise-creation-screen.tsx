import { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import type { Exercise } from "../../contracts/api";
import {
  muscleGroups,
  type LoadType,
  type MuscleGroup,
  type SideMode,
  type TrackingType,
} from "../../domain/entities/exercise";
import { apiRequest } from "../api/client";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Field,
  Heading,
  Message,
  Screen,
} from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import {
  buildExerciseCreationInput,
  createExerciseCreationForm,
  exerciseEquipmentOptions,
  exerciseCreationMuscleError,
  exerciseCreationNameError,
  withPrimaryMuscle,
  withToggledSecondaryMuscle,
  type ExerciseCreationForm,
} from "./exercise-creation-model";
import { exerciseDetailHref } from "./exercise-routes";

const trackingTypeOptions: ReadonlyArray<readonly [TrackingType, string]> = [
  ["reps", "Reps"],
  ["duration", "Duration"],
  ["rounds", "Rounds"],
];

const loadTypeOptions: ReadonlyArray<readonly [LoadType, string]> = [
  ["external", "External weight"],
  ["bodyweight", "Bodyweight"],
  ["added", "Bodyweight + load"],
  ["assistance", "Assistance"],
];

const sideModeOptions: ReadonlyArray<readonly [SideMode, string]> = [
  ["bilateral", "Both sides"],
  ["per_side", "Per side"],
  ["per_leg", "Per leg"],
  ["left_right", "Left / right"],
];

const primaryMuscleOptions: ReadonlyArray<readonly [MuscleGroup | "", string]> = [
  ["", "Choose one"],
  ...muscleGroups.map((muscle) => [muscle, label(muscle)] as const),
];

export function ExerciseCreationScreen() {
  const [form, setForm] = useState<ExerciseCreationForm>(createExerciseCreationForm);
  const [nameError, setNameError] = useState("");
  const [muscleError, setMuscleError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function update(patch: Partial<ExerciseCreationForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function save() {
    if (saving) return;
    const nextNameError = exerciseCreationNameError(form);
    const nextMuscleError = exerciseCreationMuscleError(form);
    setNameError(nextNameError);
    setMuscleError(nextMuscleError);
    if (nextNameError || nextMuscleError) return;

    setSaving(true);
    setError("");
    try {
      const payload = await apiRequest<{ exercise: Exercise }>("/api/v1/exercises", {
        method: "POST",
        body: JSON.stringify(buildExerciseCreationInput(form)),
      });
      router.replace(exerciseDetailHref(payload.exercise.id));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Exercise could not be created.",
      );
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/exercises");
    }
  }

  return (
    <Screen safeTop={false} contentStyle={styles.screen}>
      <View style={styles.intro}>
        <Eyebrow>Your library</Eyebrow>
        <Heading>Add exercise</Heading>
        <Body muted>
          Create a movement for your own exercise library. It will be available
          when you build or edit your routines.
        </Body>
      </View>

      {error ? <Message>{error}</Message> : null}

      <Card>
        <Heading level={2} size="small">Exercise details</Heading>
        <Field
          label="Exercise name"
          error={nameError}
          editable={!saving}
          value={form.name}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={200}
          placeholder="Single-arm cable row"
          onChangeText={(name) => {
            update({ name });
            if (nameError) setNameError("");
          }}
        />
        <ChoiceGroup
          label="Equipment"
          value={form.equipment}
          options={exerciseEquipmentOptions}
          disabled={saving}
          onChange={(equipment) => update({ equipment })}
        />
        <Field
          label="Movement pattern"
          hint="Optional. Leave blank for Other."
          editable={!saving}
          value={form.movementPattern}
          autoCapitalize="sentences"
          maxLength={80}
          placeholder="Horizontal pull"
          onChangeText={(movementPattern) => update({ movementPattern })}
        />
        <Field
          label="Instructions"
          hint="Optional setup or technique notes."
          editable={!saving}
          value={form.instructions}
          maxLength={1000}
          multiline
          placeholder="Describe the setup and key cues."
          onChangeText={(instructions) => update({ instructions })}
        />
      </Card>

      <Card>
        <Heading level={2} size="small">How you track it</Heading>
        <ChoiceGroup
          label="Tracking type"
          value={form.trackingType}
          options={trackingTypeOptions}
          disabled={saving}
          onChange={(trackingType) => update({ trackingType })}
        />
        <ChoiceGroup
          label="Default load"
          value={form.defaultLoadType}
          options={loadTypeOptions}
          disabled={saving}
          onChange={(defaultLoadType) => update({ defaultLoadType })}
        />
        <ChoiceGroup
          label="Side mode"
          value={form.sideMode}
          options={sideModeOptions}
          disabled={saving}
          onChange={(sideMode) => update({ sideMode })}
        />
      </Card>

      <Card>
        <Heading level={2} size="small">Muscle tags</Heading>
        <Body muted>
          Tags help Coach and recovery recommendations understand where the
          exercise places demand.
        </Body>
        <ChoiceGroup
          label="Primary muscle"
          value={form.primaryMuscle}
          options={primaryMuscleOptions}
          disabled={saving}
          onChange={(primaryMuscle) => {
            setForm((current) => withPrimaryMuscle(current, primaryMuscle));
            if (primaryMuscle) setMuscleError("");
          }}
        />
        {muscleError ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.groupError}>
            {muscleError}
          </Text>
        ) : null}
        <SecondaryMuscleGroup
          primaryMuscle={form.primaryMuscle}
          selected={form.secondaryMuscles}
          disabled={saving}
          onToggle={(muscle) => setForm((current) =>
            withToggledSecondaryMuscle(current, muscle)
          )}
        />
      </Card>

      <View style={styles.actions}>
        <View style={styles.secondaryAction}>
          <Button
            title="Cancel"
            variant="secondary"
            disabled={saving}
            onPress={cancel}
          />
        </View>
        <View style={styles.primaryAction}>
          <Button
            title="Create exercise"
            loading={saving}
            onPress={() => void save()}
          />
        </View>
      </View>
    </Screen>
  );
}

function ChoiceGroup<T extends string>({
  label: groupLabel,
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
  const [focused, setFocused] = useState<T | null>(null);
  return (
    <View accessibilityLabel={groupLabel} role="radiogroup" style={styles.choiceGroup}>
      <Text style={styles.groupLabel}>{groupLabel}</Text>
      <View style={styles.choiceGrid}>
        {options.map(([option, optionLabel]) => {
          const checked = option === value;
          return (
            <Pressable
              key={option || "none"}
              accessibilityRole="radio"
              accessibilityLabel={optionLabel}
              accessibilityState={{ checked, disabled }}
              disabled={disabled}
              onBlur={() => setFocused(null)}
              onFocus={() => setFocused(option)}
              onPress={() => onChange(option)}
              style={({ pressed }) => [
                styles.choice,
                checked && styles.choiceSelected,
                pressed && styles.pressed,
                focused === option && Platform.OS === "web" && styles.webFocusRing,
              ]}
            >
              <Text style={[styles.choiceText, checked && styles.choiceTextSelected]}>
                {optionLabel}
              </Text>
              <Text accessible={false} style={styles.choiceCheck}>{checked ? "✓" : ""}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SecondaryMuscleGroup({
  primaryMuscle,
  selected,
  disabled,
  onToggle,
}: {
  primaryMuscle: MuscleGroup | "";
  selected: readonly MuscleGroup[];
  disabled: boolean;
  onToggle: (muscle: MuscleGroup) => void;
}) {
  const [focused, setFocused] = useState<MuscleGroup | null>(null);
  return (
    <View accessibilityLabel="Secondary muscles" role="group" style={styles.choiceGroup}>
      <Text style={styles.groupLabel}>Secondary muscles</Text>
      <View style={styles.choiceGrid}>
        {muscleGroups.map((muscle) => {
          const checked = selected.includes(muscle);
          const isPrimary = muscle === primaryMuscle;
          const unavailable = disabled || isPrimary;
          return (
            <Pressable
              key={muscle}
              accessibilityRole="checkbox"
              accessibilityLabel={label(muscle)}
              accessibilityHint={isPrimary ? "Already selected as the primary muscle." : undefined}
              accessibilityState={{ checked, disabled: unavailable }}
              disabled={unavailable}
              onBlur={() => setFocused(null)}
              onFocus={() => setFocused(muscle)}
              onPress={() => onToggle(muscle)}
              style={({ pressed }) => [
                styles.choice,
                checked && styles.choiceSelected,
                isPrimary && styles.choicePrimary,
                unavailable && styles.choiceDisabled,
                pressed && styles.pressed,
                focused === muscle && Platform.OS === "web" && styles.webFocusRing,
              ]}
            >
              <Text style={[
                styles.choiceText,
                checked && styles.choiceTextSelected,
                isPrimary && styles.choicePrimaryText,
              ]}>
                {label(muscle)}
              </Text>
              <Text accessible={false} style={styles.choiceCheck}>
                {isPrimary ? "Primary" : checked ? "✓" : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function label(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const styles = StyleSheet.create({
  screen: { maxWidth: 820, gap: spacing.xl },
  intro: { maxWidth: 680, gap: spacing.sm },
  choiceGroup: { gap: spacing.sm },
  groupLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  groupError: { color: colors.danger, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    minHeight: 44,
    minWidth: 128,
    flexGrow: 1,
    flexBasis: "22%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.background,
  },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  choicePrimary: { borderColor: colors.border },
  choiceDisabled: { opacity: 0.55 },
  choiceText: { flex: 1, color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  choiceTextSelected: { color: colors.accent },
  choicePrimaryText: { color: colors.textMuted },
  choiceCheck: { color: colors.accent, fontSize: 10, fontWeight: "900" },
  pressed: { opacity: 0.74 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap-reverse",
    justifyContent: "flex-end",
    gap: spacing.md,
  },
  secondaryAction: { minWidth: 150 },
  primaryAction: { minWidth: 220 },
  webFocusRing: {
    outlineColor: colors.accent,
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
});
