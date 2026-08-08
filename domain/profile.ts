export type MeasurementSystem = "imperial" | "metric";

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  heightCm: number | null;
  bodyWeightKg: number | null;
  measurementSystem: MeasurementSystem;
};

export type UserProfilePatch = Partial<Pick<
  UserProfile,
  "heightCm" | "bodyWeightKg" | "measurementSystem"
>>;

export const CENTIMETERS_PER_INCH = 2.54;
export const POUNDS_PER_KILOGRAM = 2.2046226218487757;

export function centimetersToInches(centimeters: number) {
  return centimeters / CENTIMETERS_PER_INCH;
}

export function inchesToCentimeters(inches: number) {
  return inches * CENTIMETERS_PER_INCH;
}

export function kilogramsToPounds(kilograms: number) {
  return kilograms * POUNDS_PER_KILOGRAM;
}

export function poundsToKilograms(pounds: number) {
  return pounds / POUNDS_PER_KILOGRAM;
}

export function centimetersToFeetAndInches(centimeters: number) {
  const totalInches = centimetersToInches(centimeters);
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: totalInches - feet * 12 };
}

export function feetAndInchesToCentimeters(feet: number, inches: number) {
  return inchesToCentimeters(feet * 12 + inches);
}
