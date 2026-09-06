import type {
  ExerciseInput,
  LoadType,
  MuscleGroup,
  SideMode,
  TrackingType,
  WeightUnit,
} from "../../domain/entities/exercise";
import { validateExerciseInput } from "../../domain/exercises/validation";
import {
  createExerciseWeightSettingsDraft,
  parseExerciseWeightSettingsDraft,
  type ExerciseWeightSettingsDraft,
} from "./exercise-weight-settings";

export const exerciseEquipmentOptions = [
  ["other", "Other / not listed"],
  ["bodyweight", "Bodyweight"],
  ["bench", "Bench"],
  ["bench_and_bodyweight", "Bench + bodyweight"],
  ["dumbbells", "Dumbbells"],
  ["dumbbell_and_bench", "Dumbbells + bench"],
  ["dumbbell_or_kettlebell", "Dumbbells or kettlebell"],
  ["kettlebells", "Kettlebells"],
  ["pull_up_station", "Pull-up station"],
  ["dip_station", "Dip station"],
  ["cable_machine", "Cable machine"],
  ["ez_bar", "EZ bar"],
  ["ez_bar_and_bench", "EZ bar + bench"],
  ["resistance_bands", "Resistance bands"],
  ["barbell", "Barbell"],
] as const;

export type ExerciseEquipmentRequirement =
  (typeof exerciseEquipmentOptions)[number][0];

export type ExerciseCreationForm = {
  name: string;
  equipment: ExerciseEquipmentRequirement;
  movementPattern: string;
  trackingType: TrackingType;
  defaultLoadType: LoadType;
  sideMode: SideMode;
  instructions: string;
  primaryMuscle: MuscleGroup | "";
  secondaryMuscles: MuscleGroup[];
  weightSettings: ExerciseWeightSettingsDraft;
};

export function createExerciseCreationForm(weightUnit: WeightUnit = "lb"): ExerciseCreationForm {
  return {
    name: "",
    equipment: "other",
    movementPattern: "",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "",
    primaryMuscle: "",
    secondaryMuscles: [],
    weightSettings: createExerciseWeightSettingsDraft(null, weightUnit),
  };
}

export function exerciseCreationNameError(form: ExerciseCreationForm) {
  return form.name.trim() ? "" : "Exercise name is required.";
}

export function exerciseCreationMuscleError(form: ExerciseCreationForm) {
  return form.primaryMuscle ? "" : "Select a primary muscle.";
}

export function withPrimaryMuscle(
  form: ExerciseCreationForm,
  primaryMuscle: MuscleGroup | "",
): ExerciseCreationForm {
  return {
    ...form,
    primaryMuscle,
    secondaryMuscles: primaryMuscle
      ? form.secondaryMuscles.filter((muscle) => muscle !== primaryMuscle)
      : form.secondaryMuscles,
  };
}

export function withToggledSecondaryMuscle(
  form: ExerciseCreationForm,
  muscle: MuscleGroup,
): ExerciseCreationForm {
  if (muscle === form.primaryMuscle) return form;
  const selected = form.secondaryMuscles.includes(muscle);
  return {
    ...form,
    secondaryMuscles: selected
      ? form.secondaryMuscles.filter((candidate) => candidate !== muscle)
      : [...form.secondaryMuscles, muscle],
  };
}

export function buildExerciseCreationInput(
  form: ExerciseCreationForm,
): ExerciseInput {
  const nameError = exerciseCreationNameError(form);
  if (nameError) throw new Error(nameError);
  const muscleError = exerciseCreationMuscleError(form);
  if (muscleError) throw new Error(muscleError);
  const primaryMuscle = form.primaryMuscle as MuscleGroup;
  const parsedWeightSettings = parseExerciseWeightSettingsDraft(form.weightSettings);
  const weightError = Object.values(parsedWeightSettings.errors)[0];
  if (weightError) throw new Error(weightError);

  return validateExerciseInput({
    name: form.name,
    equipment: form.equipment,
    movementPattern: form.movementPattern,
    trackingType: form.trackingType,
    defaultLoadType: form.defaultLoadType,
    sideMode: form.sideMode,
    instructions: form.instructions,
    weightSettings: parsedWeightSettings.value,
    muscles: [
      { muscleGroup: primaryMuscle, role: "primary" as const, weight: 1 },
      ...form.secondaryMuscles.map((muscleGroup) => ({
        muscleGroup,
        role: "secondary" as const,
        weight: 0.5,
      })),
    ],
  });
}
