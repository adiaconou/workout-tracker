export type ExerciseProgressRange = "3m" | "6m" | "1y" | "all";

export function exerciseProgressRangeStart(
  range: ExerciseProgressRange,
  now = new Date(),
) {
  if (range === "all") return null;
  const months = range === "3m" ? 3 : range === "6m" ? 6 : 12;
  const start = new Date(now);
  const day = start.getDate();
  start.setDate(1);
  start.setMonth(start.getMonth() - months);
  const lastDayOfTargetMonth = new Date(
    start.getFullYear(),
    start.getMonth() + 1,
    0,
  ).getDate();
  start.setDate(Math.min(day, lastDayOfTargetMonth));
  return start.toISOString();
}
