export function getStopwatchElapsedMs(
  startedAt: number | null,
  elapsedMs: number,
  now = Date.now(),
) {
  if (startedAt === null) return Math.max(0, elapsedMs);
  return Math.max(0, now - startedAt);
}

export function getStopwatchSeconds(elapsedMs: number) {
  if (elapsedMs <= 0) return 0;
  return Math.max(1, Math.round(elapsedMs / 1000));
}

export function formatStopwatch(elapsedMs: number) {
  const totalTenths = Math.max(0, Math.floor(elapsedMs / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}
