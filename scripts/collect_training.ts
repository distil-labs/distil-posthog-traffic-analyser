/**
 * Distil Labs training-data collector.
 *
 * For each distillable tool in src/tools/registry.ts, run the LLM as
 * "teacher" on real inputs from data/, validate the JSON output against
 * the tool's outputSchema, and dump (input, output) pairs to
 *   data/training/<tool>.jsonl
 *
 * Hand those jsonl files to Distil Labs as seed/SFT data.
 *
 * Teacher selection goes through buildEngine("llm", spec), so the
 * teacher honors LLM_PROVIDER (anthropic|openai) and per-tool
 * TOOL_<NAME>_LLM_PROVIDER overrides. The recorded `teacher` field is
 * the actual model that produced the pair.
 *
 * The pipeline is a chain: sessions -> narrations -> findings. When the
 * on-disk inputs for a stage are missing (e.g. a fresh clone), the stage
 * bootstraps them from the bundled examples/sample-sessions.jsonl and the
 * earlier stages' teacher output, so `bun run collect-training` produces
 * non-empty JSONL as a standalone command.
 */
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractFromNarration } from "../src/agents/extractor.ts";
import { narrateSession } from "../src/agents/narrator.ts";
import { prioritize } from "../src/agents/prioritizer.ts";
import type { Completer } from "../src/integrations/completer.ts";
import { FindingsDB } from "../src/integrations/db.ts";
import { buildEngine, getTool, listDistillableTools, type ToolSpec } from "../src/tools/registry.ts";
import { SessionCache } from "../src/util/cache.ts";
import { SessionSchema, type RawFinding, type Session, type StoredFinding } from "../src/types.ts";
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

const s = getSettings();
const SESSIONS_DIR = join(s.DATA_DIR, "sessions");
const NARRATION_CACHE = join(s.DATA_DIR, "cache", "narrations.jsonl");
const EXAMPLES = join(import.meta.dir, "..", "examples", "sample-sessions.jsonl");

function parseSessions(body: string, limit: number, out: Session[]): void {
  for (const line of body.split("\n")) {
    if (out.length >= limit) break;
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = SessionSchema.safeParse(JSON.parse(t));
      if (parsed.success) out.push(parsed.data);
    } catch {
      // skip corrupt line
    }
  }
}

async function loadSessionsFromDir(dir: string, limit: number): Promise<Session[]> {
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
    parseSessions(await readFile(join(dir, n), "utf8"), limit, out);
  }
  return out;
}

async function loadSessionsFromFile(path: string, limit: number): Promise<Session[]> {
  const out: Session[] = [];
  try {
    parseSessions(await readFile(path, "utf8"), limit, out);
  } catch {
    // missing file
  }
  return out;
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

/** Teacher completer for a tool: honors LLM_PROVIDER + per-tool overrides. */
function teacherFor(toolName: string): Completer {
  return buildEngine("llm", getTool(toolName));
}

/**
 * Sessions to teach on: prefer real ingested sessions in data/sessions,
 * fall back to the bundled examples so a fresh clone still produces pairs.
 */
async function getSessions(limit: number): Promise<Session[]> {
  const disk = await loadSessionsFromDir(SESSIONS_DIR, limit);
  if (disk.length > 0) return disk;
  const seeded = await loadSessionsFromFile(EXAMPLES, limit);
  if (seeded.length > 0) {
    log.info("seeded_sessions_from_examples", { count: seeded.length, path: EXAMPLES });
  }
  return seeded;
}

/**
 * Narrations to feed the extractor: prefer the narration cache (written by
 * the narrator stage or a prior `bun run narrate`), otherwise generate them
 * from sessions with the narrator teacher and persist to the cache.
 */
async function getNarrations(limit: number): Promise<CacheLine[]> {
  const cached = await loadNarrationCache(NARRATION_CACHE);
  if (cached.length > 0) return cached.slice(0, limit);

  const sessions = await getSessions(limit);
  if (sessions.length === 0) return [];

  const teacher = teacherFor("narrator");
  const cache = new SessionCache(NARRATION_CACHE);
  await cache.load();
  const produced: CacheLine[] = [];
  for (const sess of sessions) {
    try {
      const n = await narrateSession(teacher, sess);
      if (!cache.has(n.sessionId)) {
        await cache.mark({ sessionId: n.sessionId, narration: n.narration });
      }
      produced.push({ sessionId: n.sessionId, narration: n.narration, narratedAt: new Date().toISOString() });
    } catch (e) {
      log.warn("bootstrap_narrate_fail", { session: sess.sessionId, err: String(e) });
    }
  }
  log.info("bootstrapped_narrations", { count: produced.length });
  return produced.slice(0, limit);
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

async function teachNarrator(
  teacher: Completer,
  sessions: Session[],
): Promise<{ pairs: Pair[]; narrations: CacheLine[] }> {
  const pairs: Pair[] = [];
  const narrations: CacheLine[] = [];
  for (const sess of sessions) {
    try {
      const n = await narrateSession(teacher, sess);
      pairs.push({
        tool: "narrator",
        teacher: n.model,
        input: sess,
        output: { sessionId: n.sessionId, distinctId: n.distinctId, narration: n.narration },
      });
      narrations.push({ sessionId: n.sessionId, narration: n.narration, narratedAt: new Date().toISOString() });
    } catch (e) {
      log.warn("narrator_teach_fail", { session: sess.sessionId, err: String(e) });
    }
  }
  return { pairs, narrations };
}

async function teachExtractor(
  teacher: Completer,
  narrations: CacheLine[],
): Promise<{ pairs: Pair[]; findings: { finding: RawFinding; sessionId: string }[] }> {
  const pairs: Pair[] = [];
  const findings: { finding: RawFinding; sessionId: string }[] = [];
  for (const n of narrations) {
    try {
      const r = await extractFromNarration(teacher, n.narration);
      if (!r.ok) {
        // Teacher output failed to parse/validate. Skip it rather than record
        // a spurious "no findings" label.
        log.warn("extractor_teach_unparsable", { session: n.sessionId });
        continue;
      }
      pairs.push({
        tool: "extractor",
        teacher: teacher.model,
        input: { narration: n.narration },
        output: { findings: r.findings },
      });
      for (const f of r.findings) findings.push({ finding: f, sessionId: n.sessionId });
    } catch (e) {
      log.warn("extractor_teach_fail", { session: n.sessionId, err: String(e) });
    }
  }
  return { pairs, findings };
}

async function teachPrioritizer(teacher: Completer, findings: StoredFinding[]): Promise<Pair[]> {
  if (findings.length === 0) return [];
  const out: Pair[] = [];
  // Bundle in chunks of 20 so output stays under model output limits.
  const chunkSize = 20;
  for (let i = 0; i < findings.length; i += chunkSize) {
    const chunk = findings.slice(i, i + chunkSize);
    try {
      const r = await prioritize(teacher, chunk);
      if (!r.ok) {
        log.warn("prioritizer_teach_unparsable", { chunk: i });
        continue;
      }
      out.push({
        tool: "prioritizer",
        teacher: teacher.model,
        input: { findings: chunk.map((f) => ({
          id: f.id,
          kind: f.kind,
          severity: f.severity,
          occurrences: f.occurrences,
          title: f.title,
          evidence: f.evidence,
        })) },
        output: { ranked: r.ranked },
      });
    } catch (e) {
      log.warn("prioritizer_teach_fail", { chunk: i, err: String(e) });
    }
  }
  return out;
}

/**
 * Findings to feed the prioritizer. Prefer the production findings.db (a
 * prior `bun run extract` on real data). If it is empty, use the bootstrap
 * DB — populated by the extractor stage in this run, or freshly extracted
 * from narrations here. The production DB is never written to.
 */
async function getFindings(limit: number, bootstrapDb: FindingsDB): Promise<StoredFinding[]> {
  const prod = new FindingsDB();
  const prodFindings = prod.list();
  prod.close();
  if (prodFindings.length > 0) return prodFindings.slice(0, limit);

  if (bootstrapDb.size() === 0) {
    const narrations = await getNarrations(limit);
    const teacher = teacherFor("extractor");
    for (const n of narrations) {
      try {
        const r = await extractFromNarration(teacher, n.narration);
        for (const f of r.findings) bootstrapDb.insert(f, n.sessionId);
      } catch (e) {
        log.warn("bootstrap_extract_fail", { session: n.sessionId, err: String(e) });
      }
    }
    log.info("bootstrapped_findings", { count: bootstrapDb.size() });
  }
  return bootstrapDb.list().slice(0, limit);
}

const args = parseArgs(Bun.argv.slice(2));
const all = listDistillableTools();
const selected =
  args.tools.length > 0 ? all.filter((t) => args.tools.includes(t.name)) : all;
if (selected.length === 0) {
  console.error(`No matching tools. Available: ${all.map((t) => t.name).join(", ")}`);
  process.exit(1);
}

const outDir = args.out ?? join(s.DATA_DIR, "training");
await mkdir(outDir, { recursive: true });
log.info("starting", {
  tools: selected.map((t) => t.name),
  limit: args.limit,
  outDir,
  provider: s.LLM_PROVIDER,
});

// Ephemeral DB so prioritizer bootstrapping never mutates the real findings.db.
const bootstrapDbPath = join(outDir, ".bootstrap.db");
for (const suffix of ["", "-wal", "-shm"]) {
  await unlink(bootstrapDbPath + suffix).catch(() => {});
}
const bootstrapDb = new FindingsDB(bootstrapDbPath);

const summary: Record<string, { written: number; rejected: number }> = {};

for (const spec of selected) {
  log.info("tool_start", { tool: spec.name });
  let pairs: Pair[] = [];

  if (spec.name === "narrator") {
    const sessions = await getSessions(args.limit);
    log.info("narrator_inputs", { sessions: sessions.length });
    const res = await teachNarrator(teacherFor("narrator"), sessions);
    pairs = res.pairs;
    // Persist narrations so the extractor stage (and reruns) can reuse them.
    if (res.narrations.length > 0) {
      const cache = new SessionCache(NARRATION_CACHE);
      await cache.load();
      for (const n of res.narrations) {
        if (!cache.has(n.sessionId)) await cache.mark({ sessionId: n.sessionId, narration: n.narration });
      }
    }
  } else if (spec.name === "extractor") {
    const narrations = await getNarrations(args.limit);
    log.info("extractor_inputs", { narrations: narrations.length });
    const res = await teachExtractor(teacherFor("extractor"), narrations);
    pairs = res.pairs;
    // Seed the bootstrap DB so the prioritizer stage reuses these findings.
    for (const { finding, sessionId } of res.findings) bootstrapDb.insert(finding, sessionId);
  } else if (spec.name === "prioritizer") {
    const findings = await getFindings(args.limit, bootstrapDb);
    log.info("prioritizer_inputs", { findings: findings.length });
    pairs = await teachPrioritizer(teacherFor("prioritizer"), findings);
  } else {
    log.warn("tool_unhandled", { tool: spec.name });
    continue;
  }

  const valid = pairs.filter((p) => validate(spec, p.input, p.output));
  const rejected = pairs.length - valid.length;
  log.info("tool_validated", { tool: spec.name, valid: valid.length, rejected });
  if (valid.length === 0) {
    log.warn("no_pairs", {
      tool: spec.name,
      hint: "no inputs found and examples/sample-sessions.jsonl could not seed them; run `bun run demo` or `bun run ingest` first",
    });
  }

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

bootstrapDb.close();
for (const suffix of ["", "-wal", "-shm"]) {
  await unlink(bootstrapDbPath + suffix).catch(() => {});
}

console.log("\nTraining-data summary:");
for (const [t, s2] of Object.entries(summary)) {
  console.log(`  ${t.padEnd(14)}  written=${s2.written}  rejected=${s2.rejected}`);
}
console.log("\nHand each tool's .jsonl to Distil Labs as SFT seeds.");
console.log("Each line: { tool, teacher, input (schema-validated), output (schema-validated) }");
console.log(`\nCost summary (teacher provider: ${s.LLM_PROVIDER}):`);
console.log(JSON.stringify(tracker.summary(), null, 2));
console.log(`Total USD: $${tracker.totalUsd().toFixed(6)}`);
