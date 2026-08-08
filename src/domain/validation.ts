export function cleanRequired(value: unknown, label: string, max = 200) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim().slice(0, max);
}

export function cleanOptional(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function assertNonNegative(
  value: unknown,
  label: string,
  nullable = true,
) {
  if (value === undefined || value === null) {
    if (nullable) return;
    throw new Error(`${label} is required.`);
  }
  if (!Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
}
