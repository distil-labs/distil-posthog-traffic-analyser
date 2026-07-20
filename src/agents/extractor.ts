import type { Completer } from "../integrations/completer.ts";
import { ExtractorOutputSchema, type RawFinding } from "../types.ts";

export const EXTRACTOR_SYSTEM = `You read short user-behavior narrations and identify:
- "bug": something visibly broke or errored.
- "gap": something the user clearly wanted to do but couldn't (missing feature, dead end, confusing UX).

For each finding output:
- kind: "bug" or "gap"
- severity: integer 1-5 (1=cosmetic, 5=blocks core flow)
- title: <=120 chars, action-oriented, no fluff
- evidence: one-sentence quote or paraphrase from the narration

Rules:
- Output VALID JSON only, matching: {"findings":[{...}, ...]}
- If nothing applies, output {"findings":[]}.
- Never invent details not in the narration.
- No markdown, no commentary, no code fences.`;

export function buildExtractorPrompt(narration: string): string {
  return `Narration:\n"""\n${narration.trim()}\n"""\n\nReturn JSON now.`;
}

export function cleanJsonOutput(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t;
}

export async function extractFromNarration(
  engine: Completer,
  narration: string,
): Promise<{ findings: RawFinding[]; raw: string; inputTokens: number; outputTokens: number; ok: boolean }> {
  const r = await engine.complete(buildExtractorPrompt(narration), {
    system: EXTRACTOR_SYSTEM,
    agent: "extractor",
    temperature: 0.1,
    maxTokens: 2048,
  });
  const cleaned = cleanJsonOutput(r.text);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    // Parse failure: not a real "no findings" result. `ok: false` so callers
    // (e.g. training-data collection) can skip it instead of recording an
    // empty-label pair.
    return { findings: [], raw: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: false };
  }
  const validated = ExtractorOutputSchema.safeParse(parsedJson);
  if (!validated.success) {
    return { findings: [], raw: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: false };
  }
  return {
    findings: validated.data.findings,
    raw: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    ok: true,
  };
}
