export function stepNumericText(
  value: string,
  delta: number,
  minimum = 0,
) {
  const parsed = Number(value);
  const base = Number.isFinite(parsed) ? parsed : minimum;
  const next = Math.max(minimum, base + delta);
  return String(Math.round((next + Number.EPSILON) * 1000) / 1000);
}
