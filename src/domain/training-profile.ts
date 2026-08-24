export const equipmentIds = [
  "bodyweight",
  "dumbbells",
  "bench",
  "kettlebells",
  "pull_up_station",
  "dip_station",
  "cable_machine",
  "ez_bar",
  "resistance_bands",
  "barbell",
] as const;

export type EquipmentId = (typeof equipmentIds)[number];

export const workoutDurationOptions = [30, 45, 60, 75, 90] as const;
export type WorkoutDurationMinutes = (typeof workoutDurationOptions)[number];

export const currentOnboardingVersion = 1;
export const defaultWorkoutDurationMinutes: WorkoutDurationMinutes = 45;
export const legacyWorkoutDurationMinutes: WorkoutDurationMinutes = 60;
export const legacyAllEquipmentJson = JSON.stringify(equipmentIds);

export const equipmentOptions: ReadonlyArray<{
  id: EquipmentId;
  label: string;
}> = [
  { id: "bodyweight", label: "Bodyweight" },
  { id: "dumbbells", label: "Dumbbells" },
  { id: "bench", label: "Bench" },
  { id: "kettlebells", label: "Kettlebells" },
  { id: "pull_up_station", label: "Pull-up station" },
  { id: "dip_station", label: "Dip station" },
  { id: "cable_machine", label: "Cable machine" },
  { id: "ez_bar", label: "EZ bar" },
  { id: "resistance_bands", label: "Resistance bands" },
  { id: "barbell", label: "Barbell" },
];

export type TrainingProfile = {
  equipment: EquipmentId[];
  sessionDurationMin: WorkoutDurationMinutes;
  progressiveTrainingEnabled: boolean;
  onboardingCompletedAt: string | null;
  onboardingCompleted: boolean;
};

export type TrainingProfileInput = Pick<TrainingProfile, "equipment" | "sessionDurationMin"> & {
  progressiveTrainingEnabled?: boolean;
};

export type StoredTrainingProfile = {
  equipmentPreferencesJson?: unknown;
  preferredWorkoutDurationMin?: unknown;
  progressiveTrainingEnabled?: unknown;
  onboardingVersion?: unknown;
  onboardingCompletedAt?: unknown;
};

type EquipmentRequirement =
  | { allOf: EquipmentId[] }
  | { anyOf: EquipmentId[] };

const equipmentIdSet = new Set<string>(equipmentIds);
const durationSet = new Set<number>(workoutDurationOptions);
const equipmentLabelById = new Map(
  equipmentOptions.map((option) => [option.id, option.label]),
);

const requirementsByStoredEquipment: Record<string, EquipmentRequirement> = {
  bodyweight: { allOf: ["bodyweight"] },
  bench: { allOf: ["bench"] },
  bench_and_bodyweight: { allOf: ["bodyweight", "bench"] },
  dumbbell: { allOf: ["dumbbells"] },
  dumbbells: { allOf: ["dumbbells"] },
  dumbbell_and_bench: { allOf: ["dumbbells", "bench"] },
  dumbbell_or_kettlebell: { anyOf: ["dumbbells", "kettlebells"] },
  kettlebell: { allOf: ["kettlebells"] },
  kettlebells: { allOf: ["kettlebells"] },
  pull_up_station: { allOf: ["pull_up_station"] },
  dip_knee_raise_station: { allOf: ["dip_station"] },
  dip_station: { allOf: ["dip_station"] },
  cable: { allOf: ["cable_machine"] },
  cable_machine: { allOf: ["cable_machine"] },
  high_cable: { allOf: ["cable_machine"] },
  low_cable: { allOf: ["cable_machine"] },
  low_cable_ankle_strap: { allOf: ["cable_machine"] },
  multi_gym: { allOf: ["cable_machine"] },
  ez_bar: { allOf: ["ez_bar"] },
  ez_bar_and_bench: { allOf: ["ez_bar", "bench"] },
  resistance_band: { allOf: ["resistance_bands"] },
  resistance_bands: { allOf: ["resistance_bands"] },
  barbell: { allOf: ["barbell"] },
};

export function parseStoredEquipmentPreferences(value: unknown): EquipmentId[] {
  if (value === null || value === undefined || value === "" || value === "all" || value === "all_equipment") {
    return [...equipmentIds];
  }

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [...equipmentIds];
    const normalized = parsed.filter(
      (candidate): candidate is EquipmentId => typeof candidate === "string" && equipmentIdSet.has(candidate),
    );
    if (normalized.length !== parsed.length) return [...equipmentIds];
    return equipmentIds.filter((equipmentId) => normalized.includes(equipmentId));
  } catch {
    return [...equipmentIds];
  }
}

export function trainingProfileFromStored(input: StoredTrainingProfile): TrainingProfile {
  const preferredDuration = Number(input.preferredWorkoutDurationMin);
  const onboardingVersion = Number(input.onboardingVersion);
  const equipment = parseStoredEquipmentPreferences(input.equipmentPreferencesJson);
  return {
    equipment,
    sessionDurationMin: durationSet.has(preferredDuration)
      ? preferredDuration as WorkoutDurationMinutes
      : legacyWorkoutDurationMinutes,
    progressiveTrainingEnabled: Number(input.progressiveTrainingEnabled) === 1,
    onboardingCompletedAt: typeof input.onboardingCompletedAt === "string" && input.onboardingCompletedAt
      ? input.onboardingCompletedAt
      : null,
    onboardingCompleted: (
      Number.isInteger(onboardingVersion)
        ? onboardingVersion >= currentOnboardingVersion
        : true
    ) && equipment.length > 0,
  };
}

export function isTrainingProfileComplete(profile: TrainingProfile) {
  return profile.onboardingCompleted;
}

export function validateTrainingProfileInput(input: unknown): TrainingProfileInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Training preferences must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  const allowedFields = new Set([
    "equipment",
    "sessionDurationMin",
    "progressiveTrainingEnabled",
  ]);
  const unsupported = Object.keys(record).find((key) => !allowedFields.has(key));
  if (unsupported) throw new Error(`Training preference field \"${unsupported}\" is unsupported.`);
  if (!Array.isArray(record.equipment) || record.equipment.length === 0) {
    throw new Error("Select at least one equipment option.");
  }
  const invalidEquipment = record.equipment.find(
    (candidate) => typeof candidate !== "string" || !equipmentIdSet.has(candidate),
  );
  if (invalidEquipment !== undefined) throw new Error("An equipment selection is invalid.");
  const normalizedEquipment = equipmentIds.filter((equipmentId) => (
    (record.equipment as string[]).includes(equipmentId)
  ));
  const duration = Number(record.sessionDurationMin);
  if (!durationSet.has(duration)) {
    throw new Error("Workout duration must be 30, 45, 60, 75, or 90 minutes.");
  }
  if (
    Object.hasOwn(record, "progressiveTrainingEnabled")
    && typeof record.progressiveTrainingEnabled !== "boolean"
  ) {
    throw new Error("Progressive training must be enabled or disabled.");
  }
  return {
    equipment: normalizedEquipment,
    sessionDurationMin: duration as WorkoutDurationMinutes,
    ...(typeof record.progressiveTrainingEnabled === "boolean"
      ? { progressiveTrainingEnabled: record.progressiveTrainingEnabled }
      : {}),
  };
}

export function equipmentDescription(selectedEquipment: readonly EquipmentId[]) {
  return equipmentIds
    .filter((equipmentId) => selectedEquipment.includes(equipmentId))
    .map((equipmentId) => equipmentLabelById.get(equipmentId)!)
    .join(", ");
}

export function isExerciseEquipmentAvailable(
  storedEquipment: string,
  selectedEquipment: readonly EquipmentId[],
) {
  return missingExerciseEquipmentLabels(storedEquipment, selectedEquipment).length === 0;
}

export function missingExerciseEquipmentLabels(
  storedEquipment: string,
  selectedEquipment: readonly EquipmentId[],
): string[] {
  const requirement = requirementsByStoredEquipment[storedEquipment.trim().toLowerCase()];
  if (!requirement) return [];
  const selected = new Set(selectedEquipment);
  if ("allOf" in requirement) {
    return requirement.allOf
      .filter((equipmentId) => !selected.has(equipmentId))
      .map((equipmentId) => equipmentLabelById.get(equipmentId)!);
  }
  if (requirement.anyOf.some((equipmentId) => selected.has(equipmentId))) return [];
  return [requirement.anyOf
    .map((equipmentId) => equipmentLabelById.get(equipmentId)!)
    .join(" or ")];
}
