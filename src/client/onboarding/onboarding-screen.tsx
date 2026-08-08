import { useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useAuth } from "../auth/public";
import type { EquipmentId, WorkoutDurationMinutes } from "../../contracts/api";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Heading,
  Message,
  Screen,
} from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";

type EquipmentOption = {
  id: EquipmentId;
  label: string;
  description: string;
};

const equipmentOptions: EquipmentOption[] = [
  {
    id: "bodyweight",
    label: "Bodyweight",
    description: "Floor space and exercises that need no equipment.",
  },
  {
    id: "dumbbells",
    label: "Dumbbells",
    description: "Fixed or adjustable dumbbells.",
  },
  {
    id: "bench",
    label: "Adjustable bench",
    description: "Flat, incline, or supported exercises.",
  },
  {
    id: "barbell",
    label: "Barbell & rack",
    description: "A barbell, plates, and a safe rack or stand.",
  },
  {
    id: "kettlebells",
    label: "Kettlebells",
    description: "One or more kettlebells.",
  },
  {
    id: "pull_up_station",
    label: "Pull-up station",
    description: "A pull-up bar or assisted pull-up station.",
  },
  {
    id: "dip_station",
    label: "Dip / knee-raise station",
    description: "Parallel bars or a captain's chair.",
  },
  {
    id: "cable_machine",
    label: "Cable or multi-gym",
    description: "High and low pulleys with common attachments.",
  },
  {
    id: "ez_bar",
    label: "EZ curl bar",
    description: "An EZ bar with suitable plates.",
  },
  {
    id: "resistance_bands",
    label: "Resistance bands",
    description: "Loop or handled resistance bands.",
  },
];

const durationOptions = [30, 45, 60, 75, 90] as const;

export function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const { completeTrainingSetup, user } = useAuth();
  const trainingProfile = user?.trainingProfile;
  const firstSetup = !trainingProfile?.onboardingCompleted;
  const [step, setStep] = useState<1 | 2>(1);
  const [equipment, setEquipment] = useState<EquipmentId[]>(
    () => trainingProfile?.equipment ?? [],
  );
  const [sessionDurationMin, setSessionDurationMin] = useState<WorkoutDurationMinutes | null>(
    () => trainingProfile?.sessionDurationMin ?? null,
  );
  const [focusedOption, setFocusedOption] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [routeAfterSave, setRouteAfterSave] = useState<"coach" | null>(null);

  const selectedLabels = useMemo(
    () => equipmentOptions
      .filter((option) => equipment.includes(option.id))
      .map((option) => option.label),
    [equipment],
  );
  const equipmentTileStyle = width >= 900
    ? styles.equipmentTileWide
    : width >= 560
      ? styles.equipmentTileMedium
      : styles.equipmentTileNarrow;

  useEffect(() => {
    if (routeAfterSave === "coach" && trainingProfile?.onboardingCompleted) {
      router.replace({
        pathname: "/coach",
        params: { starter: "routine-design" },
      });
    }
  }, [routeAfterSave, trainingProfile?.onboardingCompleted]);

  function toggleEquipment(id: EquipmentId) {
    setError("");
    setEquipment((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  function continueToDuration() {
    if (!equipment.length) {
      setError("Choose at least one equipment option to shape your library.");
      return;
    }
    setError("");
    setStep(2);
  }

  async function save() {
    if (!sessionDurationMin || saving) {
      if (!sessionDurationMin) setError("Choose the workout length you want Coach to plan around.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await completeTrainingSetup({ equipment, sessionDurationMin });
      if (result.firstCompletion) {
        setRouteAfterSave("coach");
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/routines");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your training setup could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen safeTop={false} contentStyle={styles.screen}>
      <View accessibilityLiveRegion="polite" style={styles.intro}>
        <Eyebrow>{firstSetup ? `Step ${step} of 2` : "Training setup"}</Eyebrow>
        <Heading>{step === 1 ? "What can you train with?" : "How long should workouts be?"}</Heading>
        <Body muted>
          {step === 1
            ? "Choose everything you have access to. We’ll build a focused exercise library from it, then Coach can design custom routines around your equipment."
            : "Choose the length you want most workouts to fit. Coach will use it as the target when designing your routines."}
        </Body>
      </View>

      {error ? <Message>{error}</Message> : null}

      {step === 1 ? (
        <>
          <View
            accessibilityLabel="Available gym equipment"
            role="group"
            style={styles.equipmentGrid}
          >
            {equipmentOptions.map((option) => {
              const checked = equipment.includes(option.id);
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={option.label}
                  accessibilityHint={option.description}
                  accessibilityState={{ checked }}
                  onBlur={() => setFocusedOption(null)}
                  onFocus={() => setFocusedOption(`equipment-${option.id}`)}
                  onPress={() => toggleEquipment(option.id)}
                  style={({ pressed }) => [
                    styles.equipmentTile,
                    equipmentTileStyle,
                    checked && styles.optionSelected,
                    pressed && styles.optionPressed,
                    focusedOption === `equipment-${option.id}` &&
                      Platform.OS === "web" &&
                      styles.webFocusRing,
                  ]}
                >
                  <View style={styles.optionTopline}>
                    <Text style={[styles.optionTitle, checked && styles.optionTitleSelected]}>
                      {option.label}
                    </Text>
                    <View
                      accessible={false}
                      style={[styles.check, checked && styles.checkSelected]}
                    >
                      <Text style={[styles.checkText, checked && styles.checkTextSelected]}>
                        {checked ? "✓" : ""}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                  <Text style={[styles.selectionText, checked && styles.selectionTextSelected]}>
                    {checked ? "Selected" : "Select"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Card style={styles.promiseCard}>
            <Heading level={2} size="small">Built around your gym</Heading>
            <Body muted>
              Your starter library will only show built-in exercises matched to these choices. You can still create your own exercises, and Coach will use the library when proposing routines.
            </Body>
          </Card>

          <Button title="Continue →" onPress={continueToDuration} />
        </>
      ) : (
        <>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Your equipment</Text>
            <Text style={styles.summaryValue}>{selectedLabels.join(" · ")}</Text>
          </Card>

          <View
            accessibilityLabel="Preferred workout length"
            role="radiogroup"
            style={styles.durationGrid}
          >
            {durationOptions.map((minutes) => {
              const checked = sessionDurationMin === minutes;
              return (
                <Pressable
                  key={minutes}
                  accessibilityRole="radio"
                  accessibilityLabel={`${minutes} minutes`}
                  accessibilityState={{ checked }}
                  onBlur={() => setFocusedOption(null)}
                  onFocus={() => setFocusedOption(`duration-${minutes}`)}
                  onPress={() => {
                    setError("");
                    setSessionDurationMin(minutes);
                  }}
                  style={({ pressed }) => [
                    styles.durationOption,
                    checked && styles.optionSelected,
                    pressed && styles.optionPressed,
                    focusedOption === `duration-${minutes}` &&
                      Platform.OS === "web" &&
                      styles.webFocusRing,
                  ]}
                >
                  <Text style={[styles.durationNumber, checked && styles.durationNumberSelected]}>
                    {minutes}
                  </Text>
                  <Text style={[styles.durationUnit, checked && styles.selectionTextSelected]}>
                    minutes
                  </Text>
                  <Text style={[styles.selectionText, checked && styles.selectionTextSelected]}>
                    {checked ? "Selected ✓" : "Select"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Card style={styles.promiseCard}>
            <Heading level={2} size="small">A target, not a stopwatch</Heading>
            <Body muted>
              Coach will design routines to fit this window. As you log workouts, the app will continue showing how long they actually take.
            </Body>
            <Body muted>
              Coach will propose routines for your review. Nothing is created or changed until you approve a review card.
            </Body>
          </Card>

          <View style={[styles.actions, width < 520 && styles.actionsCompact]}>
            <Button
              title="Back"
              variant="secondary"
              disabled={saving}
              onPress={() => {
                setError("");
                setStep(1);
              }}
            />
            <View style={styles.primaryAction}>
              <Button
                title={firstSetup ? "Save and meet Coach →" : "Save changes"}
                loading={saving}
                onPress={() => void save()}
              />
            </View>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    maxWidth: 820,
    paddingTop: spacing.xl,
    gap: spacing.xl,
  },
  intro: { maxWidth: 700, gap: spacing.sm },
  equipmentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  equipmentTile: {
    minHeight: 136,
    flexGrow: 1,
    justifyContent: "space-between",
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  equipmentTileWide: { flexBasis: "31%" },
  equipmentTileMedium: { flexBasis: "47%" },
  equipmentTileNarrow: { flexBasis: "100%" },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDark,
  },
  optionPressed: { opacity: 0.74 },
  optionTopline: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  optionTitle: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  optionTitleSelected: { color: colors.accent },
  optionDescription: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  check: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
  },
  checkSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkText: { color: colors.textDim, fontSize: 14, lineHeight: 17, fontWeight: "900" },
  checkTextSelected: { color: colors.background },
  selectionText: {
    color: colors.textDim,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  selectionTextSelected: { color: colors.accent },
  promiseCard: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  summaryCard: { gap: spacing.xs },
  summaryLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  summaryValue: { color: colors.text, fontSize: 14, lineHeight: 21, fontWeight: "700" },
  durationGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  durationOption: {
    minWidth: 120,
    minHeight: 112,
    flexGrow: 1,
    flexBasis: "17%",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  durationNumber: { color: colors.text, fontSize: 28, lineHeight: 32, fontWeight: "900" },
  durationNumberSelected: { color: colors.accent },
  durationUnit: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", alignItems: "stretch", gap: spacing.md },
  actionsCompact: { flexDirection: "column" },
  primaryAction: { flex: 1 },
  webFocusRing: {
    outlineColor: colors.accent,
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
});
