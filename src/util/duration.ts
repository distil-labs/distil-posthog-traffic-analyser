const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

export function parseDuration(spec: string): number {
  const m = spec.trim().match(/^(\d+)\s*(ms|s|m|h|d|w)$/i);
  if (!m) throw new Error(`bad duration: ${spec} (expected like 24h, 7d, 30m)`);
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  return n * UNITS[unit]!;
}

export function sinceDate(spec: string, now = new Date()): Date {
  return new Date(now.getTime() - parseDuration(spec));
}
