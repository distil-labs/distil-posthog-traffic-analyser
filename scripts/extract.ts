import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FindingsDB } from "../src/integrations/db.ts";
import { Embedder } from "../src/integrations/embeddings.ts";
import { findNearest } from "../src/orchestrator/dedupe.ts";
import { dispatchExtractor } from "../src/tools/dispatch.ts";
import { type Engine } from "../src/tools/registry.ts";
import { getSettings } from "../src/util/config.ts";
import { registerCostFlush, tracker } from "../src/util/cost.ts";
import { getLogger } from "../src/util/log.ts";

interface Args {
  cache?: string;
  limit?: number;
  threshold: number;
  skipEmbed: boolean;
  engine?: Engine;
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
    cache: opts.cache,
    limit: opts.limit ? Number(opts.limit) : undefined,
    threshold: opts.threshold ? Number(opts.threshold) : 0.85,
    skipEmbed: flags.has("skip-embed"),
    engine: opts.engine === "slm" || opts.engine === "llm" ? (opts.engine as Engine) : undefined,
  };
}

interface CacheLine {
  sessionId: string;
  narration: string;
  narratedAt: string;
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
      // ignore
    }
  }
  return out;
}

const log = getLogger("extract");
registerCostFlush();
const s = getSettings();
const args = parseArgs(Bun.argv.slice(2));

const cachePath = args.cache ?? join(s.DATA_DIR, "cache", "narrations.jsonl");
const lines = await loadCache(cachePath);
log.info("loaded_cache", { path: cachePath, count: lines.length });

const work = args.limit ? lines.slice(0, args.limit) : lines;
const embedder = args.skipEmbed ? null : new Embedder();
const db = new FindingsDB();

let totalRaw = 0;
let inserted = 0;
let merged = 0;
let dropped = 0;
let resolvedEngine: string | null = null;

for (const line of work) {
  let extracted: Awaited<ReturnType<typeof dispatchExtractor>>;
  try {
    extracted = await dispatchExtractor(line.narration, args.engine);
  } catch (e) {
    log.error("extract_fail", { sessionId: line.sessionId, err: String(e) });
    continue;
  }
  if (!resolvedEngine) {
    resolvedEngine = extracted.engine;
    log.info("engine_resolved", { tool: "extractor", engine: extracted.engine, model: extracted.model });
  }
  totalRaw += extracted.output.findings.length;
  log.info("extracted", {
    sessionId: line.sessionId,
    findings: extracted.output.findings.length,
    engine: extracted.engine,
    inTok: extracted.inputTokens,
    outTok: extracted.outputTokens,
  });

  for (const f of extracted.output.findings) {
    const text = `${f.title}\n${f.evidence}`;
    let emb: number[] | undefined;
    if (embedder) {
      try {
        emb = await embedder.embed(text);
      } catch (e) {
        log.warn("embed_fail", { err: String(e) });
      }
    }

    let nearestId: string | null = null;
    if (emb) {
      const match = findNearest(emb, db.candidates(), args.threshold);
      nearestId = match?.id ?? null;
    }

    if (nearestId) {
      db.mergeOccurrence(nearestId, line.sessionId, f.severity);
      merged++;
    } else if (f.title.trim().length > 0) {
      db.insert(f, line.sessionId, emb);
      inserted++;
    } else {
      dropped++;
    }
  }
}

console.log(`\nExtracted (raw): ${totalRaw}`);
console.log(`Inserted new:    ${inserted}`);
console.log(`Merged (dedup):  ${merged}`);
console.log(`Dropped:         ${dropped}`);
console.log(`DB total:        ${db.size()}`);
console.log("\nCost summary:");
console.log(JSON.stringify(tracker.summary(), null, 2));
console.log(`Total USD: $${tracker.totalUsd().toFixed(6)}`);

db.close();
