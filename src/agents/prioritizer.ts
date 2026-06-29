import type { Completer } from "../integrations/completer.ts";
import { PrioritizerOutputSchema, type PriorityItem, type StoredFinding } from "../types.ts";
import { cleanJsonOutput } from "./extractor.ts";

export const PRIORITIZER_SYSTEM = `You rank product findings by impact * frequency * effort.

Given a list of findings, return JSON of the form:
{ "ranked": [ { "id": "<uuid>", "rank": 1, "reason": "<=2 sentences" }, ... ] }

Rules:
- rank=1 is highest priority.
- Every input id must appear in the output EXACTLY ONCE.
- Do not invent ids. Do not skip ids.
- Consider: severity (5=blocks core flow), occurrences (how many distinct users hit it),
  kind (bug fix is usually cheaper than building a missing feature),
  and likely cost-of-delay.
- "reason" must justify the placement; cite numbers from the input when possible.
- Output VALID JSON only. No markdown, no commentary, no code fences.`;

export interface PrioritizerInputItem {
  id: string;
  kind: StoredFinding["kind"];
  severity: number;
  occurrences: number;
  title: string;
  evidence: string;
}

export function toInputItem(f: StoredFinding): PrioritizerInputItem {
  return {
    id: f.id,
    kind: f.kind,
    severity: f.severity,
    occurrences: f.occurrences,
    title: f.title,
    evidence: f.evidence,
  };
}

export function buildPrioritizerPrompt(items: PrioritizerInputItem[]): string {
  return [
    `Findings (${items.length}):`,
    JSON.stringify(items, null, 2),
    ``,
    `Return JSON now. Every id above must appear in "ranked" exactly once.`,
  ].join("\n");
}

export interface PrioritizerResult {
  ranked: PriorityItem[];
  raw: string;
  inputTokens: number;
  outputTokens: number;
  missingIds: string[];
  unknownIds: string[];
  duplicateIds: string[];
}

function validateCoverage(
  inputIds: string[],
  output: PriorityItem[],
): { missing: string[]; unknown: string[]; duplicates: string[] } {
  const inputSet = new Set(inputIds);
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  for (const item of output) {
    const count = (seen.get(item.id) ?? 0) + 1;
    seen.set(item.id, count);
    if (count === 2) duplicates.push(item.id);
    if (!inputSet.has(item.id)) unknown.push(item.id);
  }
  const missing = inputIds.filter((id) => !seen.has(id));
  return { missing, unknown, duplicates };
}

export async function prioritize(
  engine: Completer,
  findings: StoredFinding[],
): Promise<PrioritizerResult> {
  const items = findings.map(toInputItem);
  const prompt = buildPrioritizerPrompt(items);
  const r = await engine.complete(prompt, {
    system: PRIORITIZER_SYSTEM,
    agent: "prioritizer",
    maxTokens: 4096,
    temperature: 0.1,
  });
  const cleaned = cleanJsonOutput(r.text);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    return {
      ranked: [],
      raw: r.text,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      missingIds: items.map((i) => i.id),
      unknownIds: [],
      duplicateIds: [],
    };
  }
  const validated = PrioritizerOutputSchema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      ranked: [],
      raw: r.text,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      missingIds: items.map((i) => i.id),
      unknownIds: [],
      duplicateIds: [],
    };
  }
  const ranked = validated.data.ranked;
  const cov = validateCoverage(
    items.map((i) => i.id),
    ranked,
  );
  return {
    ranked,
    raw: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    missingIds: cov.missing,
    unknownIds: cov.unknown,
    duplicateIds: cov.duplicates,
  };
}
