import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  centimetersToFeetAndInches,
  feetAndInchesToCentimeters,
  kilogramsToPounds,
  poundsToKilograms,
  type MeasurementSystem,
  type UserProfile,
  type UserProfilePatch,
} from "../../domain/profile";
import { useProfile } from "./profile-context";
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

type FormErrors = Partial<Record<"height" | "feet" | "inches" | "weight", string>>;

export function ProfileScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 640;
  const { error: loadError, isLoading, isSaving, profile, reload, saveProfile } = useProfile();
  const [measurementSystem, setMeasurementSystem] = useState<MeasurementSystem>("imperial");
  const [heightCm, setHeightCm] = useState("");
  const [heightFeet, setHeightFeet] = useState("");
  const [heightInches, setHeightInches] = useState("");
  const [bodyWeightKg, setBodyWeightKg] = useState("");
  const [bodyWeightLb, setBodyWeightLb] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [operationError, setOperationError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (profile) populateForm(profile, {
      setMeasurementSystem,
      setHeightCm,
      setHeightFeet,
      setHeightInches,
      setBodyWeightKg,
      setBodyWeightLb,
    });
  }, [profile]);

  if (isLoading && !profile) return <LoadingView label="Loading profile…" />;

  if (!profile) {
    return (
      <Screen safeTop={false} contentStyle={styles.narrowScreen}>
        <Eyebrow>Account</Eyebrow>
        <Heading>Profile & settings</Heading>
        <Message>{loadError || "Profile could not be loaded."}</Message>
        <Button title="Try again" variant="secondary" onPress={() => void reload()} />
      </Screen>
    );
  }

  function changeMeasurementSystem(next: MeasurementSystem) {
    if (next === measurementSystem) return;
    if (next === "metric") {
      const feet = optionalNumber(heightFeet);
      const inches = optionalNumber(heightInches);
      if (feet !== null || inches !== null) {
        const converted = feetAndInchesToCentimeters(feet ?? 0, inches ?? 0);
        if (Number.isFinite(converted) && converted > 0) setHeightCm(formatDecimal(converted));
      } else {
        setHeightCm("");
      }
      const pounds = optionalNumber(bodyWeightLb);
      if (pounds !== null && pounds > 0) {
        setBodyWeightKg(formatDecimal(poundsToKilograms(pounds)));
      } else {
        setBodyWeightKg("");
      }
    } else {
      const centimeters = optionalNumber(heightCm);
      if (centimeters !== null && centimeters > 0) {
        const converted = centimetersToFeetAndInches(centimeters);
        setHeightFeet(String(converted.feet));
        setHeightInches(formatDecimal(converted.inches));
      } else {
        setHeightFeet("");
        setHeightInches("");
      }
      const kilograms = optionalNumber(bodyWeightKg);
      if (kilograms !== null && kilograms > 0) {
        setBodyWeightLb(formatDecimal(kilogramsToPounds(kilograms)));
      } else {
        setBodyWeightLb("");
      }
    }
    setMeasurementSystem(next);
    setErrors({});
    setOperationError("");
    setSuccess("");
  }

  async function handleSave() {
    setOperationError("");
    setSuccess("");
    const result = buildProfilePatch({
      measurementSystem,
      heightCm,
      heightFeet,
      heightInches,
      bodyWeightKg,
      bodyWeightLb,
    });
    setErrors(result.errors);
    if (!result.patch) return;
    try {
      await saveProfile(result.patch);
      setSuccess("Profile saved.");
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Profile could not be saved.");
    }
  }

  async function handleClear() {
    setErrors({});
    setOperationError("");
    setSuccess("");
    try {
      const saved = await saveProfile({
        heightCm: null,
        bodyWeightKg: null,
        measurementSystem,
      });
      populateForm(saved, {
        setMeasurementSystem,
        setHeightCm,
        setHeightFeet,
        setHeightInches,
        setBodyWeightKg,
        setBodyWeightLb,
      });
      setSuccess("Measurements cleared. Past workout values were kept.");
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Measurements could not be cleared.");
    }
  }

  return (
    <Screen safeTop={false} contentStyle={styles.screen}>
      <View style={[styles.pageHeader, compact && styles.stack]}>
        <View style={styles.headerCopy}>
          <Eyebrow>Account</Eyebrow>
          <Heading>Profile & settings</Heading>
          <Body muted>Choose how measurements are entered and shown across your account.</Body>
        </View>
        <Button title="Back" compact variant="secondary" onPress={() => router.back()} />
      </View>

      <Card>
        <Heading size="small">Identity</Heading>
        <Body muted>Your sign-in provider manages these details, so they are read-only here.</Body>
        <View style={[styles.identityGrid, compact && styles.stack]}>
          <View style={styles.identityItem}>
            <Text style={styles.label}>Name</Text>
            <Text selectable style={styles.identityValue}>{profile.displayName}</Text>
          </View>
          <View style={styles.identityItem}>
            <Text style={styles.label}>Email</Text>
            <Text selectable style={styles.identityValue}>{profile.email}</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Heading size="small">Measurements</Heading>
        <Body muted>
          Height and body weight are optional. Saving a body weight fills only your finalized workouts that do not already have one.
        </Body>
        <View accessibilityRole="radiogroup" accessibilityLabel="Measurement system" style={styles.unitSelector}>
          <UnitOption
            checked={measurementSystem === "imperial"}
            label="Imperial"
            onPress={() => changeMeasurementSystem("imperial")}
          />
          <UnitOption
            checked={measurementSystem === "metric"}
            label="Metric"
            onPress={() => changeMeasurementSystem("metric")}
          />
        </View>

        {measurementSystem === "imperial" ? (
          <View style={[styles.fields, compact && styles.stack]}>
            <View style={styles.fieldColumn}>
              <Field
                label="Height (feet)"
                value={heightFeet}
                onChangeText={setHeightFeet}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="5"
                error={errors.feet}
              />
            </View>
            <View style={styles.fieldColumn}>
              <Field
                label="Height (inches)"
                value={heightInches}
                onChangeText={setHeightInches}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="10"
                error={errors.inches}
              />
            </View>
            <View style={styles.fieldColumn}>
              <Field
                label="Body weight (lb)"
                value={bodyWeightLb}
                onChangeText={setBodyWeightLb}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="Optional"
                error={errors.weight}
              />
            </View>
          </View>
        ) : (
          <View style={[styles.fields, compact && styles.stack]}>
            <View style={styles.fieldColumn}>
              <Field
                label="Height (cm)"
                value={heightCm}
                onChangeText={setHeightCm}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="Optional"
                error={errors.height}
              />
            </View>
            <View style={styles.fieldColumn}>
              <Field
                label="Body weight (kg)"
                value={bodyWeightKg}
                onChangeText={setBodyWeightKg}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="Optional"
                error={errors.weight}
              />
            </View>
          </View>
        )}

        {operationError || loadError ? <Message>{operationError || loadError}</Message> : null}
        {success ? <Message tone="success">{success}</Message> : null}
        <View style={[styles.actions, compact && styles.stack]}>
          <View style={styles.actionButton}>
            <Button title="Save profile" loading={isSaving} onPress={() => void handleSave()} />
          </View>
          <View style={styles.actionButton}>
            <Button
              title="Clear measurements"
              variant="secondary"
              disabled={isSaving}
              onPress={() => void handleClear()}
            />
          </View>
        </View>
      </Card>
    </Screen>
  );
}

export function buildProfilePatch(input: {
  measurementSystem: MeasurementSystem;
  heightCm: string;
  heightFeet: string;
  heightInches: string;
  bodyWeightKg: string;
  bodyWeightLb: string;
}): { patch: UserProfilePatch | null; errors: FormErrors } {
  const errors: FormErrors = {};
  let canonicalHeight: number | null | undefined = null;
  let canonicalWeight: number | null | undefined = null;

  if (input.measurementSystem === "metric") {
    canonicalHeight = parsePositiveOptional(input.heightCm);
    canonicalWeight = parsePositiveOptional(input.bodyWeightKg);
    if (canonicalHeight === undefined) errors.height = "Enter a positive number or leave this blank.";
    if (canonicalWeight === undefined) errors.weight = "Enter a positive number or leave this blank.";
  } else {
    const feet = parseNonNegativeOptional(input.heightFeet);
    const inches = parseNonNegativeOptional(input.heightInches);
    const hasHeight = input.heightFeet.trim() !== "" || input.heightInches.trim() !== "";
    if (feet === undefined) errors.feet = "Enter zero or a positive number.";
    if (inches === undefined || (inches !== null && inches >= 12)) {
      errors.inches = "Enter inches from 0 up to 11.99.";
    }
    if (hasHeight && feet !== undefined && inches !== undefined) {
      canonicalHeight = feetAndInchesToCentimeters(feet ?? 0, inches ?? 0);
      if (canonicalHeight <= 0) errors.feet = "Combined height must be greater than zero.";
    }
    canonicalWeight = parsePositiveOptional(input.bodyWeightLb);
    if (canonicalWeight === undefined) {
      errors.weight = "Enter a positive number or leave this blank.";
    } else if (canonicalWeight !== null) {
      canonicalWeight = poundsToKilograms(canonicalWeight);
    }
  }

  if (Object.keys(errors).length > 0 || canonicalHeight === undefined || canonicalWeight === undefined) {
    return { patch: null, errors };
  }
  return {
    patch: {
      heightCm: canonicalHeight,
      bodyWeightKg: canonicalWeight,
      measurementSystem: input.measurementSystem,
    },
    errors,
  };
}

function UnitOption({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} measurements`}
      accessibilityState={{ checked }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.unitOption,
        checked && styles.unitOptionSelected,
        pressed && styles.pressed,
        focused && Platform.OS === "web" && styles.webFocusRing,
      ]}
    >
      <View style={[styles.radio, checked && styles.radioSelected]} />
      <Text style={[styles.unitText, checked && styles.unitTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function populateForm(profile: UserProfile, setters: {
  setMeasurementSystem: (value: MeasurementSystem) => void;
  setHeightCm: (value: string) => void;
  setHeightFeet: (value: string) => void;
  setHeightInches: (value: string) => void;
  setBodyWeightKg: (value: string) => void;
  setBodyWeightLb: (value: string) => void;
}) {
  setters.setMeasurementSystem(profile.measurementSystem);
  setters.setHeightCm(profile.heightCm === null ? "" : formatDecimal(profile.heightCm));
  if (profile.heightCm === null) {
    setters.setHeightFeet("");
    setters.setHeightInches("");
  } else {
    const imperialHeight = centimetersToFeetAndInches(profile.heightCm);
    setters.setHeightFeet(String(imperialHeight.feet));
    setters.setHeightInches(formatDecimal(imperialHeight.inches));
  }
  setters.setBodyWeightKg(profile.bodyWeightKg === null ? "" : formatDecimal(profile.bodyWeightKg));
  setters.setBodyWeightLb(
    profile.bodyWeightKg === null ? "" : formatDecimal(kilogramsToPounds(profile.bodyWeightKg)),
  );
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveOptional(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeOptional(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatDecimal(value: number) {
  return String(Math.round(value * 10) / 10);
}

const styles = StyleSheet.create({
  screen: { maxWidth: 820 },
  narrowScreen: { maxWidth: 560 },
  pageHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.lg },
  headerCopy: { flex: 1, gap: spacing.sm },
  stack: { flexDirection: "column" },
  identityGrid: { flexDirection: "row", gap: spacing.lg },
  identityItem: { flex: 1, minWidth: 0, gap: spacing.xs },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  identityValue: { color: colors.text, fontSize: 15, lineHeight: 22 },
  unitSelector: { flexDirection: "row", gap: spacing.sm },
  unitOption: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.background,
  },
  unitOptionSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  radio: { width: 14, height: 14, borderWidth: 2, borderColor: colors.textDim, borderRadius: radii.pill },
  radioSelected: { borderWidth: 4, borderColor: colors.accent },
  unitText: { color: colors.textMuted, fontSize: 14, fontWeight: "800" },
  unitTextSelected: { color: colors.accent },
  fields: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  fieldColumn: { flex: 1, width: "100%" },
  actions: { flexDirection: "row", gap: spacing.md },
  actionButton: { flex: 1, width: "100%" },
  pressed: { opacity: 0.76 },
  webFocusRing: { outlineColor: colors.accent, outlineOffset: 2, outlineStyle: "solid", outlineWidth: 2 },
});
