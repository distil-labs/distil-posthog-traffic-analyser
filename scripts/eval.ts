import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractFromNarration } from "../src/agents/extractor.ts";
import { LLMClient } from "../src/integrations/llm.ts";
import { SLMClient } from "../src/integrations/slm.ts";
import { getSettings } from "../src/util/config.ts";
import { registerCostFlush, tracker } from "../src/util/cost.ts";
import { getLogger } from "../src/util/log.ts";
import type { RawFinding } from "../src/types.ts";

interface Args {
  sample: number;
  cache?: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq >= 0) opts[a.slice(2, eq)] = a.slice(eq + 1);
    else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts[a.slice(2)] = next;
        i++;
      }
    }
  }
  return {
    sample: opts.sample ? Number(opts.sample) : 20,
    cache: opts.cache,
    out: opts.out,
  };
}

interface CacheLine {
  sessionId: string;
  narration: string;
}

async function loadCache(path: string): Promise<CacheLine[]> {
  const body = await readFile(path, "utf8");
  const out: CacheLine[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as CacheLine;
      if (o.sessionId && o.narration) out.push(o);
    } catch {
      // skip
    }
  }
  return out;
}

const JUDGE_SYSTEM = `You compare two sets of findings extracted from the same user-behavior narration.

You will receive: the narration, set A (SLM-extracted), set B (LLM-extracted).
Score each set on:
- precision: do the findings match what the narration actually shows?
- recall: are there obvious issues the set missed?
- severity calibration: are severities reasonable?

Output JSON only:
{
  "winner": "A" | "B" | "tie",
  "precision_a": 1-5, "precision_b": 1-5,
  "recall_a": 1-5, "recall_b": 1-5,
  "severity_a": 1-5, "severity_b": 1-5,
  "notes": "<1-2 sentences>"
}`;

function buildJudgePrompt(narration: string, a: RawFinding[], b: RawFinding[]): string {
  return [
    `Narration:`,
    `"""`,
    narration.trim(),
    `"""`,
    ``,
    `Set A (SLM):`,
    JSON.stringify(a, null, 2),
    ``,
    `Set B (LLM):`,
    JSON.stringify(b, null, 2),
    ``,
    `Return JSON now.`,
  ].join("\n");
}

const log = getLogger("eval");
registerCostFlush();
const args = parseArgs(Bun.argv.slice(2));
const s = getSettings();

const cachePath = args.cache ?? join(s.DATA_DIR, "cache", "narrations.jsonl");
const lines = await loadCache(cachePath);
if (lines.length === 0) {
  console.error(`No cached narrations at ${cachePath}. Run \`bun run narrate\` first.`);
  process.exit(1);
}
const sample = lines.slice(0, args.sample);
log.info("starting", { sample: sample.length });

const slm = new SLMClient();
const llm = new LLMClient();

interface Row {
  sessionId: string;
  a_count: number;
  b_count: number;
  a_avg_sev: number;
  b_avg_sev: number;
  winner: string;
  precision_a: number;
  precision_b: number;
  recall_a: number;
  recall_b: number;
  notes: string;
}

const rows: Row[] = [];
let aWins = 0;
let bWins = 0;
let ties = 0;

for (const line of sample) {
  const aRes = await extractFromNarration(slm, line.narration);
  const bRes = await extractFromNarration(llm, line.narration);

  const judge = await llm.complete(buildJudgePrompt(line.narration, aRes.findings, bRes.findings), {
    system: JUDGE_SYSTEM,
    agent: "eval-judge",
    maxTokens: 800,
    temperature: 0,
  });

  let verdict: { winner?: string; [k: string]: unknown } = {};
  try {
    const cleaned = judge.text.trim().replace(/^```(?:json)?\s*|```$/g, "");
    verdict = JSON.parse(cleaned);
  } catch {
    verdict = { winner: "tie", notes: "judge parse failed" };
  }

  const winner = String(verdict.winner ?? "tie");
  if (winner === "A") aWins++;
  else if (winner === "B") bWins++;
  else ties++;

  rows.push({
    sessionId: line.sessionId,
    a_count: aRes.findings.length,
    b_count: bRes.findings.length,
    a_avg_sev: aRes.findings.length
      ? aRes.findings.reduce((s, f) => s + f.severity, 0) / aRes.findings.length
      : 0,
    b_avg_sev: bRes.findings.length
      ? bRes.findings.reduce((s, f) => s + f.severity, 0) / bRes.findings.length
      : 0,
    winner,
    precision_a: Number(verdict["precision_a"] ?? 0),
    precision_b: Number(verdict["precision_b"] ?? 0),
    recall_a: Number(verdict["recall_a"] ?? 0),
    recall_b: Number(verdict["recall_b"] ?? 0),
    notes: String(verdict["notes"] ?? ""),
  });

  log.info("compared", { sessionId: line.sessionId, winner, a: aRes.findings.length, b: bRes.findings.length });
}

const md: string[] = [];
md.push(`# SLM vs LLM extractor eval`);
md.push(`Sample: ${sample.length} narrations`);
md.push(``);
md.push(`A wins (SLM): ${aWins}    B wins (LLM): ${bWins}    Ties: ${ties}`);
md.push(``);
md.push(`| session | winner | A# | B# | A precis | B precis | A recall | B recall | notes |`);
md.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const r of rows) {
  md.push(
    `| ${r.sessionId} | ${r.winner} | ${r.a_count} | ${r.b_count} | ${r.precision_a} | ${r.precision_b} | ${r.recall_a} | ${r.recall_b} | ${r.notes.replace(/\|/g, "\\|").slice(0, 120)} |`,
  );
}
md.push(``);
md.push(`## Cost`);
md.push("```");
md.push(JSON.stringify(tracker.summary(), null, 2));
md.push(`Total USD: $${tracker.totalUsd().toFixed(6)}`);
md.push("```");

const body = md.join("\n") + "\n";
const target = args.out ?? join(s.DATA_DIR, `eval-${new Date().toISOString().slice(0, 10)}.md`);
await mkdir(s.DATA_DIR, { recursive: true });
await writeFile(target, body);

console.log(body);
console.log(`\nEval written to: ${target}`);
