/**
 * End-to-end demo on bundled sample sessions.
 *
 * The intelligent harness has three engines per tool: `distil` (Distil
 * Labs production model), `slm` (Ollama / OpenAI-compatible local
 * runtime), and `llm` (Anthropic Opus / OpenAI GPT-5 teacher).
 *
 * No Distil Labs URLs are configured yet, so the resolver's natural
 * fallback would be `slm` (which needs Ollama running). For a one-key
 * reviewer demo we force `--engine llm` so the entire pipeline runs on
 * the cloud LLM (Claude Opus by default, or OpenAI if LLM_PROVIDER=
 * openai). `bun run demo --engine slm` opts into the SLM fallback if
 * you have Ollama up.
 *
 * Stages run in-process (no subprocess spawning) so a single transcript
 * is easy to follow.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dispatchExtractor, dispatchNarrator, dispatchPrioritizer } from "../src/tools/dispatch.ts";
import { FindingsDB } from "../src/integrations/db.ts";
import { SessionSchema, type Session } from "../src/types.ts";
import { type Engine } from "../src/tools/registry.ts";
import { SessionCache } from "../src/util/cache.ts";
import { getSettings } from "../src/util/config.ts";
import { registerCostFlush, tracker } from "../src/util/cost.ts";
import { getLogger } from "../src/util/log.ts";

interface Args {
  engine: Engine;
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
  let engine: Engine = "llm";
  if (opts.engine === "slm" || opts.engine === "llm") {
    engine = opts.engine as Engine;
  }
  return { engine };
}

const log = getLogger("demo");
registerCostFlush();
const s = getSettings();
const args = parseArgs(Bun.argv.slice(2));

const SAMPLE_SRC = join(import.meta.dir, "..", "examples", "sample-sessions.jsonl");
const sessionsDir = join(s.DATA_DIR, "sessions");
const sessionsTarget = join(sessionsDir, "demo-sample.jsonl");
const cachePath = join(s.DATA_DIR, "cache", "narrations.jsonl");

await mkdir(sessionsDir, { recursive: true });
if (!existsSync(sessionsTarget)) {
  await copyFile(SAMPLE_SRC, sessionsTarget);
  log.info("samples_seeded", { from: SAMPLE_SRC, to: sessionsTarget });
} else {
  log.info("samples_already_seeded", { at: sessionsTarget });
}

async function loadSessions(): Promise<Session[]> {
  const body = await readFile(sessionsTarget, "utf8");
  const out: Session[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parsed = SessionSchema.safeParse(JSON.parse(t));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

const sessions = await loadSessions();

const engineNote =
  args.engine === "llm"
    ? `engine=llm (cloud teacher: provider=${s.LLM_PROVIDER})`
    : `engine=slm (local: provider=${s.SLM_PROVIDER})`;
console.log(`\n=== DEMO MODE — ${sessions.length} sample sessions, ${engineNote} ===`);
console.log(
  `Note: distillable tools default to "slm". This demo forces --engine llm so a reviewer can`,
);
console.log(
  `      run the loop with one Anthropic/OpenAI key, no local model required. Run`,
);
console.log(
  `      "bun run demo --engine slm" if you have Ollama (or any OpenAI-compatible runtime)`,
);
console.log(
  `      to see the SLM path. After Distil Labs ships a fine-tune for a tool, deploy it on`,
);
console.log(
  `      your runtime and set TOOL_<NAME>_MODEL=<distilled-weights-name> — no code change.\n`,
);

console.log(`-- Stage 1: narrate (${sessions.length} sessions)`);
const cache = new SessionCache(cachePath);
await cache.load();
const narrations: { sessionId: string; narration: string }[] = [];
for (const sess of sessions) {
  if (cache.has(sess.sessionId)) {
    log.info("narration_cached", { sessionId: sess.sessionId });
    continue;
  }
  const r = await dispatchNarrator(sess, args.engine);
  await cache.mark({ sessionId: r.output.sessionId, narration: r.output.narration });
  narrations.push({ sessionId: r.output.sessionId, narration: r.output.narration });
  console.log(`  [${sess.sessionId}] ${r.output.narration.slice(0, 140).replace(/\n/g, " ")}…`);
}

console.log(`\n-- Stage 2: extract bugs/gaps from narrations`);
const allNarrations = await readFile(cachePath, "utf8")
  .then((b) =>
    b
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { sessionId: string; narration: string }),
  )
  .catch(() => []);

const db = new FindingsDB();
let totalFindings = 0;
for (const n of allNarrations) {
  const r = await dispatchExtractor(n.narration, args.engine);
  totalFindings += r.output.findings.length;
  for (const f of r.output.findings) {
    db.insert(f, n.sessionId);
    console.log(`  [${f.kind} sev=${f.severity}] ${f.title}`);
  }
}
console.log(`  Extracted ${totalFindings} findings (dedup skipped in demo for clarity).`);

console.log(`\n-- Stage 3: prioritize`);
const findings = db.list();
if (findings.length > 0) {
  const r = await dispatchPrioritizer(findings, args.engine);
  for (const item of r.output.ranked) {
    db.setPriority(item.id, item.rank, item.reason);
  }
  for (const item of r.output.ranked.slice(0, 10)) {
    console.log(`  #${item.rank}  ${item.id.slice(0, 8)}  ${item.reason.slice(0, 100)}`);
  }
}

console.log(`\n-- Top 5 prioritized findings`);
const top = db.list().filter((f) => f.priorityRank !== null).slice(0, 5);
for (const f of top) {
  console.log(`  #${f.priorityRank}  [${f.kind} sev=${f.severity}]  ${f.title}`);
  console.log(`         evidence: ${f.evidence.slice(0, 120)}`);
  if (f.priorityReason) console.log(`         reason:   ${f.priorityReason.slice(0, 120)}`);
}

console.log(`\n=== Demo complete ===`);
console.log(`Findings DB: ${s.DATA_DIR}/findings.db`);
console.log(`Cost log:    ${s.DATA_DIR}/cost.jsonl (flushed at exit)`);
console.log(`\nCost summary:`);
console.log(JSON.stringify(tracker.summary(), null, 2));
console.log(`Total USD: $${tracker.totalUsd().toFixed(6)}`);

console.log(`\nRun \`bun run report\` for a markdown rollup or \`bun run dashboard\` for the live UI.`);
console.log(`Run \`bun run collect-training\` to see the jsonl you would hand to Distil Labs.`);

db.close();
