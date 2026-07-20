import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FindingsDB } from "../src/integrations/db.ts";
import {
  findingsPerDay,
  rankedPerDay,
  readCostLog,
  sessionsPerDay,
  summary,
  type DailyCount,
} from "../src/orchestrator/metrics.ts";
import { getSettings } from "../src/util/config.ts";

interface Args {
  out?: string;
  topN: number;
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
  return { out: opts.out, topN: opts.top ? Number(opts.top) : 10 };
}

function table(rows: DailyCount[]): string {
  if (rows.length === 0) return "_(no data)_\n";
  const lines = ["| date | count |", "| --- | --- |"];
  for (const r of rows) lines.push(`| ${r.date} | ${r.count} |`);
  return lines.join("\n") + "\n";
}

const args = parseArgs(Bun.argv.slice(2));
const s = getSettings();
const costPath = join(s.DATA_DIR, "cost.jsonl");

const db = new FindingsDB();
const findings = db.list();
const sessions = await sessionsPerDay(s.DATA_DIR);
const cost = await readCostLog(costPath);
const summ = summary(findings, sessions, cost);

const fd = findingsPerDay(findings);
const rd = rankedPerDay(findings);
const top = findings.slice(0, args.topN);

const out: string[] = [];
out.push(`# Distil PostHog Traffic Analyser — Report`);
out.push(`Generated: ${new Date().toISOString()}`);
out.push(``);
out.push(`## Summary`);
out.push(``);
out.push(`| metric | value |`);
out.push(`| --- | --- |`);
out.push(`| Sessions ingested | ${summ.totalSessions} |`);
out.push(`| Findings (bug/gap) | ${summ.totalFindings} (${summ.totalBugs} / ${summ.totalGaps}) |`);
out.push(`| Bug ratio | ${(summ.bugRatio * 100).toFixed(1)}% |`);
out.push(`| Ranked | ${summ.totalRanked} |`);
out.push(`| Total spend | $${summ.totalUsd.toFixed(4)} |`);
out.push(`| $ per finding | ${summ.totalFindings > 0 ? "$" + summ.usdPerFinding.toFixed(4) : "n/a"} |`);
out.push(``);
out.push(`## Cost by agent`);
out.push(``);
out.push(`| agent | calls | in tok | out tok | $ |`);
out.push(`| --- | --- | --- | --- | --- |`);
for (const a of cost.byAgent) {
  out.push(`| ${a.agent} | ${a.calls} | ${a.inputTokens} | ${a.outputTokens} | $${a.usd.toFixed(4)} |`);
}
out.push(``);
out.push(`## Cost by model`);
out.push(``);
out.push(`| model | calls | in tok | out tok | $ |`);
out.push(`| --- | --- | --- | --- | --- |`);
for (const m of cost.byModel) {
  out.push(`| ${m.model} | ${m.calls} | ${m.inputTokens} | ${m.outputTokens} | $${m.usd.toFixed(4)} |`);
}
out.push(``);
out.push(`## Sessions per day`);
out.push(table(sessions));
out.push(`## Findings per day`);
out.push(table(fd));
out.push(`## Ranked per day`);
out.push(table(rd));
out.push(``);
out.push(`## Top ${args.topN} findings`);
out.push(``);
out.push(`| rank | kind | sev | occ | title | evidence |`);
out.push(`| --- | --- | --- | --- | --- | --- |`);
for (const f of top) {
  const rank = f.priorityRank ?? "-";
  const ev = f.evidence.replace(/\|/g, "\\|").slice(0, 120);
  out.push(`| ${rank} | ${f.kind} | ${f.severity} | ${f.occurrences} | ${f.title.replace(/\|/g, "\\|")} | ${ev} |`);
}

const body = out.join("\n") + "\n";
const target = args.out ?? join(s.DATA_DIR, `report-${new Date().toISOString().slice(0, 10)}.md`);
await mkdir(s.DATA_DIR, { recursive: true });
await writeFile(target, body);

console.log(body);
console.log(`\nReport written to: ${target}`);
db.close();
