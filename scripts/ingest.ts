import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PostHogClient } from "../src/integrations/posthog.ts";
import { groupSessions } from "../src/orchestrator/sessions.ts";
import type { PostHogEvent } from "../src/types.ts";
import { getSettings } from "../src/util/config.ts";
import { sinceDate } from "../src/util/duration.ts";
import { getLogger } from "../src/util/log.ts";

function parseArgs(argv: string[]): { since: string; out?: string; maxPages?: number; event?: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith("--")) continue;
    const eq = k.indexOf("=");
    if (eq >= 0) {
      out[k.slice(2, eq)] = k.slice(eq + 1);
    } else {
      out[k.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return {
    since: out.since ?? "24h",
    out: out.out,
    maxPages: out.maxPages ? Number(out.maxPages) : undefined,
    event: out.event,
  };
}

const log = getLogger("ingest");
const args = parseArgs(Bun.argv.slice(2));
const s = getSettings();

const after = sinceDate(args.since);
log.info("starting", { since: args.since, after: after.toISOString(), projectId: s.POSTHOG_PROJECT_ID });

const client = new PostHogClient();
const events: PostHogEvent[] = [];
for await (const e of client.fetchEvents({ after, maxPages: args.maxPages, eventFilter: args.event })) {
  events.push(e);
}
log.info("fetched", { count: events.length });

const sessions = groupSessions(events);
log.info("grouped", { sessions: sessions.length });

const dateSlug = new Date().toISOString().slice(0, 10);
const dir = join(s.DATA_DIR, "sessions");
await mkdir(dir, { recursive: true });
const target = args.out ?? join(dir, `${dateSlug}.jsonl`);
const body = sessions.map((sess) => JSON.stringify(sess)).join("\n") + (sessions.length ? "\n" : "");
await writeFile(target, body);
log.info("wrote", { path: target, sessions: sessions.length });

console.log(`Wrote ${sessions.length} sessions (${events.length} events) → ${target}`);
