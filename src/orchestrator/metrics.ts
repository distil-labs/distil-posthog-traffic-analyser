import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { StoredFinding } from "../types.ts";
import type { Usage } from "../util/cost.ts";

export interface DailyCount {
  date: string;
  count: number;
}

export interface AgentRollup {
  agent: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  calls: number;
}

export interface ModelRollup {
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  calls: number;
}

export interface CostReport {
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byAgent: AgentRollup[];
  byModel: ModelRollup[];
}

export interface PipelineSummary {
  totalSessions: number;
  totalFindings: number;
  totalBugs: number;
  totalGaps: number;
  totalRanked: number;
  totalUsd: number;
  usdPerFinding: number;
  bugRatio: number;
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function bucketByDay(timestamps: (string | null)[]): DailyCount[] {
  const counts = new Map<string, number>();
  for (const t of timestamps) {
    if (!t) continue;
    const d = dayOf(t);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function findingsPerDay(findings: StoredFinding[]): DailyCount[] {
  return bucketByDay(findings.map((f) => f.firstSeen));
}

export function rankedPerDay(findings: StoredFinding[]): DailyCount[] {
  return bucketByDay(findings.map((f) => f.prioritizedAt));
}

export async function sessionsPerDay(dataDir: string): Promise<DailyCount[]> {
  const dir = join(dataDir, "sessions");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: DailyCount[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    let count = 0;
    const body = await readFile(path, "utf8");
    for (const line of body.split("\n")) if (line.trim()) count++;
    const m = name.match(/(\d{4}-\d{2}-\d{2})/);
    const date = m?.[1] ?? (await stat(path)).mtime.toISOString().slice(0, 10);
    out.push({ date, count });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export async function readCostLog(path: string): Promise<CostReport> {
  if (!existsSync(path)) {
    return {
      totalUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byAgent: [],
      byModel: [],
    };
  }
  const body = await readFile(path, "utf8");
  const entries: Usage[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t) as Usage);
    } catch {
      // skip
    }
  }
  return rollupCost(entries);
}

export function rollupCost(entries: Usage[]): CostReport {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalUsd = 0;
  const agents = new Map<string, AgentRollup>();
  const models = new Map<string, ModelRollup>();
  for (const u of entries) {
    totalInputTokens += u.inputTokens;
    totalOutputTokens += u.outputTokens;
    totalUsd += u.usd;
    const a = agents.get(u.agent) ?? {
      agent: u.agent,
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
      calls: 0,
    };
    a.inputTokens += u.inputTokens;
    a.outputTokens += u.outputTokens;
    a.usd += u.usd;
    a.calls += 1;
    agents.set(u.agent, a);

    const m = models.get(u.model) ?? {
      model: u.model,
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
      calls: 0,
    };
    m.inputTokens += u.inputTokens;
    m.outputTokens += u.outputTokens;
    m.usd += u.usd;
    m.calls += 1;
    models.set(u.model, m);
  }
  return {
    totalUsd,
    totalInputTokens,
    totalOutputTokens,
    byAgent: [...agents.values()].sort((a, b) => b.usd - a.usd),
    byModel: [...models.values()].sort((a, b) => b.usd - a.usd),
  };
}

export function summary(
  findings: StoredFinding[],
  sessions: DailyCount[],
  cost: CostReport,
): PipelineSummary {
  const totalFindings = findings.length;
  const totalBugs = findings.filter((f) => f.kind === "bug").length;
  const totalGaps = findings.filter((f) => f.kind === "gap").length;
  const totalRanked = findings.filter((f) => f.priorityRank !== null).length;
  const totalSessions = sessions.reduce((a, b) => a + b.count, 0);
  const bugRatio = totalFindings > 0 ? totalBugs / totalFindings : 0;
  const usdPerFinding = totalFindings > 0 ? cost.totalUsd / totalFindings : 0;
  return {
    totalSessions,
    totalFindings,
    totalBugs,
    totalGaps,
    totalRanked,
    totalUsd: cost.totalUsd,
    usdPerFinding,
    bugRatio,
  };
}
