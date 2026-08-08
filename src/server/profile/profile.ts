import {
  kilogramsToPounds,
  type MeasurementSystem,
  type UserProfile,
  type UserProfilePatch,
} from "../../domain/profile";
import { ensureEntitySchema } from "../db/entity-schema";
import type { ApiUser, WorkerEnv } from "../types";

type ProfileRow = {
  id: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  heightCm: number | null;
  bodyWeightKg: number | null;
  measurementSystem: string;
};

const editableProfileFields = new Set([
  "heightCm",
  "bodyWeightKg",
  "measurementSystem",
]);

export async function getUserProfile(
  env: WorkerEnv,
  user: Pick<ApiUser, "id" | "email">,
): Promise<UserProfile | null> {
  await ensureEntitySchema(env.DB);
  const row = await env.DB.prepare(`SELECT id, owner_email AS email,
    display_name AS displayName, photo_url AS photoUrl, height_cm AS heightCm,
    body_weight_kg AS bodyWeightKg, measurement_system AS measurementSystem
    FROM app_users WHERE id = ? AND owner_email = ?`)
    .bind(user.id, user.email)
    .first<ProfileRow>();
  return row ? serializeProfile(row) : null;
}

export async function updateUserProfile(
  env: WorkerEnv,
  user: Pick<ApiUser, "id" | "email">,
  input: unknown,
): Promise<UserProfile | null> {
  const patch = validateProfilePatch(input);
  const current = await getUserProfile(env, user);
  if (!current) return null;

  const profile: UserProfile = {
    ...current,
    ...patch,
  };
  const assignments: string[] = [];
  const values: unknown[] = [];
  if ("heightCm" in patch) {
    assignments.push("height_cm = ?");
    values.push(patch.heightCm);
  }
  if ("bodyWeightKg" in patch) {
    assignments.push("body_weight_kg = ?");
    values.push(patch.bodyWeightKg);
  }
  if ("measurementSystem" in patch) {
    assignments.push("measurement_system = ?");
    values.push(patch.measurementSystem);
  }

  const now = new Date().toISOString();
  assignments.push("updated_at = ?");
  values.push(now, user.id, user.email);
  const statements = [
    env.DB.prepare(`UPDATE app_users SET ${assignments.join(", ")}
      WHERE id = ? AND owner_email = ?`).bind(...values),
  ];

  if (profile.bodyWeightKg !== null) {
    const bodyWeight = profile.measurementSystem === "metric"
      ? profile.bodyWeightKg
      : kilogramsToPounds(profile.bodyWeightKg);
    const weightUnit = profile.measurementSystem === "metric" ? "kg" : "lb";
    statements.push(env.DB.prepare(`UPDATE workout_sessions
      SET body_weight = ?, weight_unit = ?, body_weight_source = 'profile_backfill',
        updated_at = ?
      WHERE owner_email = ? AND body_weight IS NULL
        AND status IN ('Completed', 'Partial', 'Abandoned')`)
      .bind(bodyWeight, weightUnit, now, user.email));
  }

  await env.DB.batch(statements);
  return profile;
}

export function validateProfilePatch(input: unknown): UserProfilePatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Profile changes must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  const unsupported = Object.keys(record).find((key) => !editableProfileFields.has(key));
  if (unsupported) {
    throw new Error(`Profile field \"${unsupported}\" is read-only or unsupported.`);
  }

  const patch: UserProfilePatch = {};
  if (Object.prototype.hasOwnProperty.call(record, "heightCm")) {
    patch.heightCm = optionalPositiveNumber(record.heightCm, "Height");
  }
  if (Object.prototype.hasOwnProperty.call(record, "bodyWeightKg")) {
    patch.bodyWeightKg = optionalPositiveNumber(record.bodyWeightKg, "Body weight");
  }
  if (Object.prototype.hasOwnProperty.call(record, "measurementSystem")) {
    if (record.measurementSystem !== "imperial" && record.measurementSystem !== "metric") {
      throw new Error("Measurement system must be imperial or metric.");
    }
    patch.measurementSystem = record.measurementSystem;
  }
  return patch;
}

function optionalPositiveNumber(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number or null.`);
  }
  return value;
}

function serializeProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    photoUrl: row.photoUrl,
    heightCm: row.heightCm === null ? null : Number(row.heightCm),
    bodyWeightKg: row.bodyWeightKg === null ? null : Number(row.bodyWeightKg),
    measurementSystem: normalizeMeasurementSystem(row.measurementSystem),
  };
}

function normalizeMeasurementSystem(value: string): MeasurementSystem {
  return value === "metric" ? "metric" : "imperial";
}
