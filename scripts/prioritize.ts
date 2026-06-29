import { FindingsDB } from "../src/integrations/db.ts";
import { dispatchPrioritizer } from "../src/tools/dispatch.ts";
import { type Engine } from "../src/tools/registry.ts";
import { registerCostFlush, tracker } from "../src/util/cost.ts";
import { getLogger } from "../src/util/log.ts";

interface Args {
  limit: number;
  reset: boolean;
  dryRun: boolean;
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
    limit: opts.limit ? Number(opts.limit) : 50,
    reset: flags.has("reset"),
    dryRun: flags.has("dry-run"),
    engine: opts.engine === "slm" || opts.engine === "llm" ? (opts.engine as Engine) : undefined,
  };
}

const log = getLogger("prioritize");
registerCostFlush();
const args = parseArgs(Bun.argv.slice(2));

const db = new FindingsDB();
if (args.reset) {
  db.clearPriorities();
  log.info("reset_priorities");
}

const findings = db.unprioritized(args.limit);
log.info("loaded", { count: findings.length, limit: args.limit });

if (findings.length === 0) {
  console.log("Nothing to prioritize.");
  db.close();
  process.exit(0);
}

const result = await dispatchPrioritizer(findings, args.engine);
log.info("engine_resolved", { tool: "prioritizer", engine: result.engine, model: result.model });
log.info("ranked", {
  ranked: result.output.ranked.length,
  missing: result.missingIds.length,
  unknown: result.unknownIds.length,
  duplicates: result.duplicateIds.length,
  engine: result.engine,
  inTok: result.inputTokens,
  outTok: result.outputTokens,
});

if (result.missingIds.length > 0) {
  log.warn("missing_ids", { ids: result.missingIds.slice(0, 5) });
}
if (result.unknownIds.length > 0) {
  log.warn("unknown_ids", { ids: result.unknownIds.slice(0, 5) });
}

if (args.dryRun) {
  console.log("\nDry run. Ranked output:");
  for (const r of result.output.ranked.slice(0, 10)) {
    console.log(`  #${r.rank}  ${r.id}  ${r.reason.slice(0, 80)}`);
  }
} else {
  let written = 0;
  for (const r of result.output.ranked) {
    if (result.unknownIds.includes(r.id)) continue;
    db.setPriority(r.id, r.rank, r.reason);
    written++;
  }
  log.info("written", { count: written });
}

console.log("\nCost summary:");
console.log(JSON.stringify(tracker.summary(), null, 2));
console.log(`Total USD: $${tracker.totalUsd().toFixed(6)}`);

db.close();
