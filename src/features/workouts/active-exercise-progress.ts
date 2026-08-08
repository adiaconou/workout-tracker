export type LineChartPoint = { x: number; y: number };

export function buildLineChartGeometry(
  values: number[],
  width: number,
  height: number,
  paddingX = 8,
  paddingY = 10,
  timestamps?: number[],
): LineChartPoint[] {
  if (!values.length || width <= 0 || height <= 0) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const low = span === 0 ? minimum - 1 : minimum - span * 0.1;
  const high = span === 0 ? maximum + 1 : maximum + span * 0.1;
  const usableWidth = Math.max(0, width - paddingX * 2);
  const usableHeight = Math.max(0, height - paddingY * 2);
  const validTimeScale = timestamps?.length === values.length &&
    timestamps.every(Number.isFinite) &&
    timestamps.every((timestamp, index) =>
      index === 0 || timestamp >= timestamps[index - 1]!) &&
    timestamps.at(-1)! > timestamps[0]!;
  const firstTimestamp = validTimeScale ? timestamps![0]! : 0;
  const timestampSpan = validTimeScale
    ? timestamps!.at(-1)! - firstTimestamp
    : 0;

  return values.map((value, index) => ({
    x: values.length === 1
      ? width / 2
      : paddingX + usableWidth * (
          validTimeScale
            ? (timestamps![index]! - firstTimestamp) / timestampSpan
            : index / (values.length - 1)
        ),
    y: paddingY + (1 - (value - low) / (high - low)) * usableHeight,
  }));
}

export function progressTrend(values: number[]) {
  if (values.length === 0) return "empty" as const;
  if (values.length === 1) return "one" as const;
  const delta = values.at(-1)! - values[0]!;
  if (delta === 0) return "equal" as const;
  return delta > 0 ? "up" as const : "down" as const;
}
