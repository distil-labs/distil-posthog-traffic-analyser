import type { PostHogEvent, Session } from "../types.ts";
import type { Completer } from "../integrations/completer.ts";

export const NARRATOR_SYSTEM = `You convert raw web-app event streams into short, plain-English user-behavior stories.

Rules:
- Output exactly 3 sentences. No more, no less.
- Past tense.
- Focus on: what the user tried, whether they succeeded, and any frustration signal (rage clicks, repeated failed attempts, abandonment, dead-ends).
- Never invent details that are not in the events.
- No preamble, no lists, no markdown. Plain prose only.`;

const HUMAN_PROP_KEYS = [
  "$current_url",
  "$pathname",
  "$host",
  "$browser",
  "error",
  "message",
  "feature",
  "button",
  "label",
];

function msToHuman(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function formatEvent(e: PostHogEvent): string {
  const props = e.properties as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of HUMAN_PROP_KEYS) {
    const v = props[k];
    if (v == null) continue;
    const sv = typeof v === "string" ? v : JSON.stringify(v);
    if (sv.length > 0 && sv.length < 200) parts.push(`${k}=${sv}`);
  }
  const tail = parts.length ? ` { ${parts.join(", ")} }` : "";
  return `- ${e.timestamp}  ${e.event}${tail}`;
}

export function buildNarratorPrompt(session: Session): string {
  const lines = session.events.map(formatEvent).join("\n");
  return [
    `Session: ${session.sessionId}`,
    `User: ${session.distinctId}`,
    `Span: ${session.startedAt} → ${session.endedAt} (${msToHuman(session.durationMs)}, ${session.eventCount} events)`,
    ``,
    `Events:`,
    lines,
    ``,
    `Write exactly 3 sentences describing what this user did.`,
  ].join("\n");
}

export interface Narration {
  sessionId: string;
  distinctId: string;
  narration: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function narrateSession(engine: Completer, session: Session): Promise<Narration> {
  const prompt = buildNarratorPrompt(session);
  const r = await engine.complete(prompt, {
    system: NARRATOR_SYSTEM,
    agent: "narrator",
    temperature: 0.3,
    maxTokens: 400,
  });
  return {
    sessionId: session.sessionId,
    distinctId: session.distinctId,
    narration: r.text.trim(),
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  };
}
