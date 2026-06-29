import { describe, expect, test } from "bun:test";
import { buildNarratorPrompt, NARRATOR_SYSTEM } from "../src/agents/narrator.ts";
import type { PostHogEvent, Session } from "../src/types.ts";

function ev(event: string, ts: string, props: Record<string, unknown> = {}): PostHogEvent {
  return { id: `${event}-${ts}`, distinct_id: "u1", event, timestamp: ts, properties: props };
}

function session(events: PostHogEvent[]): Session {
  return {
    sessionId: "sess-123",
    distinctId: "u1",
    startedAt: events[0]!.timestamp,
    endedAt: events[events.length - 1]!.timestamp,
    durationMs: Date.parse(events[events.length - 1]!.timestamp) - Date.parse(events[0]!.timestamp),
    eventCount: events.length,
    events,
  };
}

describe("narrator", () => {
  test("system prompt enforces 3 sentences", () => {
    expect(NARRATOR_SYSTEM).toContain("exactly 3 sentences");
    expect(NARRATOR_SYSTEM).toContain("Past tense");
  });

  test("prompt includes session metadata", () => {
    const s = session([
      ev("$pageview", "2026-06-17T10:00:00Z", { $pathname: "/export" }),
      ev("button_click", "2026-06-17T10:00:30Z", { button: "Export CSV" }),
    ]);
    const p = buildNarratorPrompt(s);
    expect(p).toContain("sess-123");
    expect(p).toContain("u1");
    expect(p).toContain("/export");
    expect(p).toContain("Export CSV");
    expect(p).toContain("3 sentences");
  });

  test("prompt formats duration human-readable", () => {
    const s = session([
      ev("a", "2026-06-17T10:00:00Z"),
      ev("b", "2026-06-17T10:05:00Z"),
    ]);
    expect(buildNarratorPrompt(s)).toContain("5m");
  });

  test("prompt is deterministic for same session", () => {
    const events = [ev("$pageview", "2026-06-17T10:00:00Z", { $pathname: "/home" })];
    const a = buildNarratorPrompt(session(events));
    const b = buildNarratorPrompt(session(events));
    expect(a).toBe(b);
  });
});
