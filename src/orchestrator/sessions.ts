import type { PostHogEvent, Session } from "../types.ts";

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

function hashSession(distinctId: string, startedAt: string): string {
  const slug = startedAt.replace(/[^0-9]/g, "").slice(0, 14);
  return `${distinctId}-${slug}`;
}

function ts(e: PostHogEvent): number {
  const n = Date.parse(e.timestamp);
  return Number.isFinite(n) ? n : 0;
}

export function groupSessions(events: PostHogEvent[], idleMs = DEFAULT_IDLE_MS): Session[] {
  if (events.length === 0) return [];

  const byUser = new Map<string, PostHogEvent[]>();
  for (const e of events) {
    const list = byUser.get(e.distinct_id) ?? [];
    list.push(e);
    byUser.set(e.distinct_id, list);
  }

  const sessions: Session[] = [];
  for (const [distinctId, userEvents] of byUser) {
    userEvents.sort((a, b) => ts(a) - ts(b));
    let bucket: PostHogEvent[] = [];
    let lastTs = 0;

    const flush = () => {
      if (bucket.length === 0) return;
      const start = bucket[0]!;
      const end = bucket[bucket.length - 1]!;
      sessions.push({
        sessionId: hashSession(distinctId, start.timestamp),
        distinctId,
        startedAt: start.timestamp,
        endedAt: end.timestamp,
        durationMs: Math.max(0, ts(end) - ts(start)),
        eventCount: bucket.length,
        events: bucket,
      });
      bucket = [];
    };

    for (const e of userEvents) {
      const t = ts(e);
      if (bucket.length > 0 && t - lastTs > idleMs) flush();
      bucket.push(e);
      lastTs = t;
    }
    flush();
  }

  sessions.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return sessions;
}
