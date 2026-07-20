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

const PORT = Number(process.env.DASHBOARD_PORT ?? 8787);

function num(n: number, digits = 4): string {
  return n.toFixed(digits);
}

function tableHTML(rows: { [k: string]: string | number }[]): string {
  if (rows.length === 0) return `<p class="empty">(no data)</p>`;
  const headers = Object.keys(rows[0]!);
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${headers.map((h) => `<td>${esc(String(r[h] ?? ""))}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function dailyRows(d: DailyCount[]): { date: string; count: number }[] {
  return d.map((r) => ({ date: r.date, count: r.count }));
}

async function render(): Promise<string> {
  const s = getSettings();
  const db = new FindingsDB();
  const findings = db.list();
  const sessions = await sessionsPerDay(s.DATA_DIR);
  const cost = await readCostLog(join(s.DATA_DIR, "cost.jsonl"));
  const summ = summary(findings, sessions, cost);
  db.close();

  const summRows = [
    { metric: "Sessions ingested", value: String(summ.totalSessions) },
    {
      metric: "Findings (bug/gap)",
      value: `${summ.totalFindings} (${summ.totalBugs} / ${summ.totalGaps})`,
    },
    { metric: "Bug ratio", value: `${(summ.bugRatio * 100).toFixed(1)}%` },
    { metric: "Ranked", value: String(summ.totalRanked) },
    { metric: "Total spend", value: `$${num(summ.totalUsd)}` },
    {
      metric: "$ per finding",
      value: summ.totalFindings > 0 ? `$${num(summ.usdPerFinding)}` : "n/a",
    },
  ];

  const agentRows = cost.byAgent.map((a) => ({
    agent: a.agent,
    calls: a.calls,
    in_tok: a.inputTokens,
    out_tok: a.outputTokens,
    usd: `$${num(a.usd)}`,
  }));
  const modelRows = cost.byModel.map((m) => ({
    model: m.model,
    calls: m.calls,
    in_tok: m.inputTokens,
    out_tok: m.outputTokens,
    usd: `$${num(m.usd)}`,
  }));
  const topRows = findings.slice(0, 20).map((f) => ({
    rank: f.priorityRank ?? "-",
    kind: f.kind,
    sev: f.severity,
    occ: f.occurrences,
    title: f.title,
    evidence: f.evidence.slice(0, 80),
  }));

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Distil PostHog Traffic Analyser Dashboard</title>
<meta http-equiv="refresh" content="30" />
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 1100px; margin: 24px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { margin: 0 0 4px; }
  .meta { color: #666; margin-bottom: 24px; }
  h2 { margin-top: 32px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eee; }
  th { background: #fafafa; font-weight: 600; }
  td { font-variant-numeric: tabular-nums; }
  .empty { color: #999; font-style: italic; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
</style></head>
<body>
<h1>Distil PostHog Traffic Analyser Dashboard</h1>
<div class="meta">Generated ${new Date().toISOString()} · auto-refresh 30s</div>

<h2>Summary</h2>
${tableHTML(summRows)}

<div class="grid">
<div>
<h2>Cost by agent</h2>
${tableHTML(agentRows)}
</div>
<div>
<h2>Cost by model</h2>
${tableHTML(modelRows)}
</div>
</div>

<div class="grid">
<div><h2>Sessions/day</h2>${tableHTML(dailyRows(sessions))}</div>
<div><h2>Findings/day</h2>${tableHTML(dailyRows(findingsPerDay(findings)))}</div>
</div>
<div><h2>Ranked/day</h2>${tableHTML(dailyRows(rankedPerDay(findings)))}</div>

<h2>Top 20 findings</h2>
${tableHTML(topRows)}

</body></html>`;
}

const server = Bun.serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/json") {
      const s = getSettings();
      const db = new FindingsDB();
      const findings = db.list();
      const sessions = await sessionsPerDay(s.DATA_DIR);
      const cost = await readCostLog(join(s.DATA_DIR, "cost.jsonl"));
      const summ = summary(findings, sessions, cost);
      db.close();
      return new Response(
        JSON.stringify(
          {
            summary: summ,
            sessions,
            findingsPerDay: findingsPerDay(findings),
            rankedPerDay: rankedPerDay(findings),
            cost,
          },
          null,
          2,
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    const html = await render();
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});

console.log(`Dashboard on http://localhost:${server.port}  (json: /json, health: /healthz)`);
