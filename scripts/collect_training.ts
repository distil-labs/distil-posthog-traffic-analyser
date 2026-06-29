/**
 * Distil Labs training-data collector.
 *
 * For each distillable tool in src/tools/registry.ts, run the LLM as
 * "teacher" on real inputs from data/, validate the JSON output against
 * the tool's outputSchema, and dump (input, output) pairs to
 *   data/training/<tool>.jsonl
 *
 * Hand those jsonl files to Distil Labs as seed/SFT data.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { extractFromNarration } from "../src/agents/extractor.ts";
import { narrateSession } from "../src/agents/narrator.ts";
import { prioritize, toInputItem } from "../src/agents/prioritizer.ts";
import { FindingsDB } from "../src/integrations/db.ts";
import { LLMClient } from "../src/integrations/llm.ts";
import { listDistillableTools, type ToolSpec } from "../src/tools/registry.ts";
import { SessionSchema, type Session, type StoredFinding } from "../src/types.ts";
import { getSettings } from "../src/util/config.ts";
import { registerCostFlush, tracker } from "../src/util/cost.ts";
import { getLogger } from "../src/util/log.ts";

const log = getLogger("collect-training");
registerCostFlush();

interface Args {
  tools: string[];
  limit: number;
  out?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq >= 0) {
      opts[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts[a.slice(2)] = next;
        i++;
      } else {
        flags.add(a.slice(2));
      }
    }
  }
  return {
    tools: (opts.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    limit: opts.limit ? Number(opts.limit) : 50,
    out: opts.out,
    dryRun: flags.has("dry-run"),
  };
}

interface CacheLine {
  sessionId: string;
  narration: string;
  narratedAt: string;
}

async function loadNarrationCache(path: string): Promise<CacheLine[]> {
  try {
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
  } catch {
    return [];
  }
}

async function loadSessions(dir: string, limit: number): Promise<Session[]> {
  const out: Session[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  const files = entries.filter((e) => e.endsWith(".jsonl"));
  const stamped = await Promise.all(
    files.map(async (n) => ({ n, mtime: (await stat(join(dir, n))).mtimeMs })),
  );
  stamped.sort((a, b) => b.mtime - a.mtime);
  for (const { n } of stamped) {
    if (out.length >= limit) break;
    const body = await readFile(join(dir, n), "utf8");
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = SessionSchema.safeParse(JSON.parse(t));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // skip
      }
      if (out.length >= limit) break;
    }
  }
  return out;
}

interface Pair {
  tool: string;
  teacher: string;
  input: unknown;
  output: unknown;
}

function validate(spec: ToolSpec, input: unknown, output: unknown): boolean {
  try {
    spec.inputSchema.parse(input);
    spec.outputSchema.parse(output);
    return true;
  } catch (e) {
    log.warn("validation_failed", { tool: spec.name, err: String(e).slice(0, 200) });
    return false;
  }
}

async function teachNarrator(llm: LLMClient, sessions: Session[]): Promise<Pair[]> {
  const out: Pair[] = [];
  for (const s of sessions) {
    try {
      const n = await narrateSession(llm, s);
      const input = s;
      const output = {
        sessionId: n.sessionId,
        distinctId: n.distinctId,
        narration: n.narration,
      };
      out.push({ tool: "narrator", teacher: n.model, input, output });
    } catch (e) {
      log.warn("narrator_teach_fail", { session: s.sessionId, err: String(e) });
    }
  }
  return out;
}

async function teachExtractor(llm: LLMClient, narrations: CacheLine[]): Promise<Pair[]> {
  const out: Pair[] = [];
  for (const n of narrations) {
    try {
      const r = await extractFromNarration(llm, n.narration);
      const input = { narration: n.narration };
      const output = { findings: r.findings };
      out.push({ tool: "extractor", teacher: "llm-extractor", input, output });
    } catch (e) {
      log.warn("extractor_teach_fail", { session: n.sessionId, err: String(e) });
    }
  }
  return out;
}

async function teachPrioritizer(llm: LLMClient, findings: StoredFinding[]): Promise<Pair[]> {
  if (findings.length === 0) return [];
  const out: Pair[] = [];
  // Bundle in chunks of 20 so output stays under model output limits.
  const chunkSize = 20;
  for (let i = 0; i < findings.length; i += chunkSize) {
    const chunk = findings.slice(i, i + chunkSize);
    try {
      const r = await prioritize(llm, chunk);
      const input = { findings: chunk.map(toInputItem) };
      const output = { ranked: r.ranked };
      out.push({ tool: "prioritizer", teacher: "llm-prioritizer", input, output });
    } catch (e) {
      log.warn("prioritizer_teach_fail", { chunk: i, err: String(e) });
    }
  }
  return out;
}

const args = parseArgs(Bun.argv.slice(2));
const s = getSettings();
const all = listDistillableTools();
const selected =
  args.tools.length > 0 ? all.filter((t) => args.tools.includes(t.name)) : all;
if (selected.length === 0) {
  console.error(`No matching tools. Available: ${all.map((t) => t.name).join(", ")}`);
  process.exit(1);
}

const outDir = args.out ?? join(s.DATA_DIR, "training");
await mkdir(outDir, { recursive: true });
log.info("starting", { tools: selected.map((t) => t.name), limit: args.limit, outDir });

const llm = new LLMClient();
const summary: Record<string, { written: number; rejected: number }> = {};

for (const spec of selected) {
  log.info("tool_start", { tool: spec.name });
  let pairs: Pair[] = [];

  if (spec.name === "narrator") {
    const sessions = await loadSessions(join(s.DATA_DIR, "sessions"), args.limit);
    log.info("narrator_inputs", { sessions: sessions.length });
    pairs = await teachNarrator(llm, sessions);
  } else if (spec.name === "extractor") {
    const cache = await loadNarrationCache(join(s.DATA_DIR, "cache", "narrations.jsonl"));
    log.info("extractor_inputs", { narrations: cache.length });
    pairs = await teachExtractor(llm, cache.slice(0, args.limit));
  } else if (spec.name === "prioritizer") {
    const db = new FindingsDB();
    const findings = db.list().slice(0, args.limit);
    db.close();
    log.info("prioritizer_inputs", { findings: findings.length });
    pairs = await teachPrioritizer(llm, findings);
  } else {
    log.warn("tool_unhandled", { tool: spec.name });
    continue;
  }

  const valid = pairs.filter((p) => validate(spec, p.input, p.output));
  const rejected = pairs.length - valid.length;
  log.info("tool_validated", { tool: spec.name, valid: valid.length, rejected });

  if (args.dryRun) {
    console.log(`[dry-run] ${spec.name}: would write ${valid.length} pairs to ${outDir}/${spec.name}.jsonl`);
  } else {
    const target = join(outDir, `${spec.name}.jsonl`);
    const body = valid.map((p) => JSON.stringify(p)).join("\n") + (valid.length ? "\n" : "");
    await writeFile(target, body);
    log.info("written", { tool: spec.name, path: target, count: valid.length });
  }
  summary[spec.name] = { written: valid.length, rejected };
}

console.log("\nTraining-data summary:");
for (const [t, s2] of Object.entries(summary)) {
  console.log(`  ${t.padEnd(14)}  written=${s2.written}  rejected=${s2.rejected}`);
}
console.log("\nHand each tool's .jsonl to Distil Labs as SFT seeds.");
console.log("Each line: { tool, teacher, input (schema-validated), output (schema-validated) }");
console.log("\nCost summary (Opus as teacher):");
console.log(JSON.stringify(tracker.summary(), null, 2));
console.log(`Total USD: $${tracker.totalUsd().toFixed(6)}`);

// Touch z to keep tree-shaker honest (we use it indirectly via spec schemas).
void z;
