import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { dispatchNarrator } from "../src/tools/dispatch.ts";
import { SessionSchema, type Session } from "../src/types.ts";
import { type Engine } from "../src/tools/registry.ts";
import { SessionCache } from "../src/util/cache.ts";
import { getSettings } from "../src/util/config.ts";
import { registerCostFlush, tracker } from "../src/util/cost.ts";
import { getLogger } from "../src/util/log.ts";

interface Args {
  file?: string;
  all: boolean;
  limit?: number;
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
    file: opts.file,
    all: flags.has("all") || opts.all === "true",
    limit: opts.limit ? Number(opts.limit) : undefined,
    engine: opts.engine === "slm" || opts.engine === "llm" ? (opts.engine as Engine) : undefined,
  };
}

async function loadSessionsFromFile(path: string): Promise<Session[]> {
  const body = await readFile(path, "utf8");
  const out: Session[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parsed = SessionSchema.safeParse(JSON.parse(t));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

async function discoverLatestSessionFile(dir: string): Promise<string | null> {
  try {
    const entries = await readdir(dir);
    const jsonl = entries.filter((e) => e.endsWith(".jsonl"));
    if (jsonl.length === 0) return null;
    const stats = await Promise.all(
      jsonl.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })),
    );
    stats.sort((a, b) => b.mtime - a.mtime);
    return join(dir, stats[0]!.name);
  } catch {
    return null;
  }
}

const log = getLogger("narrate");
registerCostFlush();
const args = parseArgs(Bun.argv.slice(2));
const s = getSettings();

const sessionsDir = join(s.DATA_DIR, "sessions");
const cachePath = join(s.DATA_DIR, "cache", "narrations.jsonl");

let files: string[] = [];
if (args.file) {
  files = [args.file];
} else if (args.all) {
  const entries = await readdir(sessionsDir).catch(() => [] as string[]);
  files = entries.filter((e) => e.endsWith(".jsonl")).map((e) => join(sessionsDir, e));
} else {
  const latest = await discoverLatestSessionFile(sessionsDir);
  if (!latest) {
    console.error(`No session jsonl found in ${sessionsDir}. Run \`bun run ingest\` first.`);
    process.exit(1);
  }
  files = [latest];
}

const sessions: Session[] = [];
for (const f of files) {
  const part = await loadSessionsFromFile(f);
  sessions.push(...part);
  log.info("loaded_file", { file: f, sessions: part.length });
}
log.info("total_sessions", { count: sessions.length });

const cache = new SessionCache(cachePath);
await cache.load();
log.info("cache_loaded", { previously_narrated: cache.size() });

const todo = sessions.filter((sess) => !cache.has(sess.sessionId));
const work = args.limit ? todo.slice(0, args.limit) : todo;
log.info("plan", { uncached: todo.length, will_process: work.length });

let narrated = 0;
let resolvedEngine: string | null = null;

for (const sess of work) {
  try {
    const r = await dispatchNarrator(sess, args.engine);
    if (!resolvedEngine) {
      resolvedEngine = r.engine;
      log.info("engine_resolved", { tool: "narrator", engine: r.engine, model: r.model });
    }
    log.info("narrated", {
      sessionId: r.output.sessionId,
      engine: r.engine,
      inTok: r.inputTokens,
      outTok: r.outputTokens,
    });
    await cache.mark({ sessionId: r.output.sessionId, narration: r.output.narration });
    narrated++;
  } catch (e) {
    log.error("narrate_fail", { sessionId: sess.sessionId, err: String(e) });
  }
}

console.log(`\nNarrated: ${narrated} sessions`);
console.log(`Cached in: ${cachePath}`);
console.log(`Total cached: ${cache.size()}`);
console.log("\nCost summary:");
console.log(JSON.stringify(tracker.summary(), null, 2));
console.log(`Total USD: $${tracker.totalUsd().toFixed(6)}`);
