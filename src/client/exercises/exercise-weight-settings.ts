import type {
  ExerciseWeightSettings,
  WeightUnit,
} from "../../domain/entities/exercise";
import type { MeasurementSystem } from "../../domain/profile";

export type ExerciseWeightSettingsDraft = {
  unit: WeightUnit;
  minimumIncrement: string;
  maximumAvailable: string;
};

export type ExerciseWeightSettingsDraftErrors = Partial<Record<
  "minimumIncrement" | "maximumAvailable",
  string
>>;

export function preferredExerciseWeightUnit(
  measurementSystem: MeasurementSystem | null | undefined,
): WeightUnit {
  return measurementSystem === "metric" ? "kg" : "lb";
}

export function createExerciseWeightSettingsDraft(
  settings: ExerciseWeightSettings | null,
  fallbackUnit: WeightUnit,
): ExerciseWeightSettingsDraft {
  return {
    unit: settings?.unit ?? fallbackUnit,
    minimumIncrement: settings?.minimumIncrement === null || settings === null
      ? ""
      : String(settings.minimumIncrement),
    maximumAvailable: settings?.maximumAvailable === null || settings === null
      ? ""
      : String(settings.maximumAvailable),
  };
}

export function parseExerciseWeightSettingsDraft(
  draft: ExerciseWeightSettingsDraft,
): {
  value: ExerciseWeightSettings | null;
  errors: ExerciseWeightSettingsDraftErrors;
} {
  const minimum = parseOptionalWeight(draft.minimumIncrement);
  const maximum = parseOptionalWeight(draft.maximumAvailable);
  const errors: ExerciseWeightSettingsDraftErrors = {};
  if (minimum.error) errors.minimumIncrement = minimum.error;
  if (maximum.error) errors.maximumAvailable = maximum.error;
  if (
    !minimum.error
    && !maximum.error
    && minimum.value !== null
    && maximum.value !== null
    && maximum.value < minimum.value
  ) {
    errors.maximumAvailable = "Maximum must be at least the minimum increment.";
  }
  if (Object.keys(errors).length) return { value: null, errors };
  if (minimum.value === null && maximum.value === null) return { value: null, errors };
  return {
    value: {
      unit: draft.unit,
      minimumIncrement: minimum.value,
      maximumAvailable: maximum.value,
    },
    errors,
  };
}

function parseOptionalWeight(value: string): { value: number | null; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  if (!/^(?:\d+|\d*\.\d+)$/u.test(trimmed)) {
    return { value: null, error: "Enter a positive number or leave this blank." };
  }
  if ((trimmed.split(".")[1]?.length ?? 0) > 2) {
    return { value: null, error: "Use at most two decimal places." };
  }
  const number = Number(trimmed);
  return Number.isFinite(number) && number > 0
    ? { value: number }
    : { value: null, error: "Enter a positive number or leave this blank." };
}
