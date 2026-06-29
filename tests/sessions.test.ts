import { describe, expect, test } from "bun:test";
import { DEFAULT_IDLE_MS, groupSessions } from "../src/orchestrator/sessions.ts";
import type { PostHogEvent } from "../src/types.ts";

function ev(distinctId: string, isoTs: string, event = "$pageview"): PostHogEvent {
  return {
    id: `${distinctId}-${isoTs}`,
    distinct_id: distinctId,
    event,
    timestamp: isoTs,
    properties: {},
  };
}

describe("groupSessions", () => {
  test("empty in -> empty out", () => {
    expect(groupSessions([])).toEqual([]);
  });

  test("single user, no gap -> one session", () => {
    const events = [
      ev("u1", "2026-06-17T10:00:00Z"),
      ev("u1", "2026-06-17T10:05:00Z"),
      ev("u1", "2026-06-17T10:10:00Z"),
    ];
    const sessions = groupSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.eventCount).toBe(3);
    expect(sessions[0]!.durationMs).toBe(10 * 60_000);
  });

  test("single user, gap > idle -> two sessions", () => {
    const events = [
      ev("u1", "2026-06-17T10:00:00Z"),
      ev("u1", "2026-06-17T10:05:00Z"),
      ev("u1", "2026-06-17T11:00:00Z"),
    ];
    const sessions = groupSessions(events, DEFAULT_IDLE_MS);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.eventCount).toBe(2);
    expect(sessions[1]!.eventCount).toBe(1);
  });

  test("multi user -> separate sessions, sorted by start", () => {
    const events = [
      ev("u2", "2026-06-17T11:00:00Z"),
      ev("u1", "2026-06-17T10:00:00Z"),
      ev("u1", "2026-06-17T10:01:00Z"),
    ];
    const sessions = groupSessions(events);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.distinctId).toBe("u1");
    expect(sessions[1]!.distinctId).toBe("u2");
  });

  test("out-of-order events get sorted before grouping", () => {
    const events = [
      ev("u1", "2026-06-17T10:10:00Z"),
      ev("u1", "2026-06-17T10:00:00Z"),
      ev("u1", "2026-06-17T10:05:00Z"),
    ];
    const sessions = groupSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.startedAt).toBe("2026-06-17T10:00:00Z");
    expect(sessions[0]!.endedAt).toBe("2026-06-17T10:10:00Z");
  });

  test("session id stable per user+start", () => {
    const a = groupSessions([ev("u1", "2026-06-17T10:00:00Z")]);
    const b = groupSessions([ev("u1", "2026-06-17T10:00:00Z")]);
    expect(a[0]!.sessionId).toBe(b[0]!.sessionId);
  });
});
