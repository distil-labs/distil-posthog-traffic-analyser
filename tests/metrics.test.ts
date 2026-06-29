import { describe, expect, test } from "bun:test";
import {
  findingsPerDay,
  rankedPerDay,
  rollupCost,
  summary,
} from "../src/orchestrator/metrics.ts";
import type { StoredFinding } from "../src/types.ts";
import type { Usage } from "../src/util/cost.ts";

function f(over: Partial<StoredFinding> = {}): StoredFinding {
  return {
    id: "fid",
    kind: "bug",
    severity: 3,
    title: "x",
    evidence: "y",
    sessionIds: ["s1"],
    occurrences: 1,
    firstSeen: "2026-06-17T10:00:00Z",
    lastSeen: "2026-06-17T10:00:00Z",
    priorityRank: null,
    priorityReason: null,
    prioritizedAt: null,
    ...over,
  };
}

describe("daily buckets", () => {
  test("findingsPerDay groups by date, sorted", () => {
    const out = findingsPerDay([
      f({ firstSeen: "2026-06-17T10:00:00Z" }),
      f({ firstSeen: "2026-06-17T22:00:00Z" }),
      f({ firstSeen: "2026-06-15T10:00:00Z" }),
    ]);
    expect(out).toEqual([
      { date: "2026-06-15", count: 1 },
      { date: "2026-06-17", count: 2 },
    ]);
  });

  test("rankedPerDay ignores rows without prioritizedAt", () => {
    const out = rankedPerDay([
      f({ prioritizedAt: "2026-06-17T10:00:00Z" }),
      f({ prioritizedAt: null }),
    ]);
    expect(out).toEqual([{ date: "2026-06-17", count: 1 }]);
  });
});

describe("rollupCost", () => {
  const entries: Usage[] = [
    { agent: "narrator", model: "qwen2.5:7b", inputTokens: 100, outputTokens: 50, usd: 0 },
    { agent: "narrator", model: "qwen2.5:7b", inputTokens: 200, outputTokens: 80, usd: 0 },
    { agent: "prioritizer", model: "claude-opus-4-7", inputTokens: 500, outputTokens: 300, usd: 0.03 },
  ];

  test("sums total tokens + usd", () => {
    const r = rollupCost(entries);
    expect(r.totalInputTokens).toBe(800);
    expect(r.totalOutputTokens).toBe(430);
    expect(r.totalUsd).toBeCloseTo(0.03, 6);
  });

  test("byAgent collapses duplicates + sorts by usd desc", () => {
    const r = rollupCost(entries);
    expect(r.byAgent[0]!.agent).toBe("prioritizer");
    const narrator = r.byAgent.find((a) => a.agent === "narrator")!;
    expect(narrator.calls).toBe(2);
    expect(narrator.inputTokens).toBe(300);
  });

  test("byModel groups across agents", () => {
    const r = rollupCost(entries);
    const qwen = r.byModel.find((m) => m.model === "qwen2.5:7b")!;
    expect(qwen.calls).toBe(2);
    const opus = r.byModel.find((m) => m.model === "claude-opus-4-7")!;
    expect(opus.calls).toBe(1);
  });

  test("empty input -> zero report", () => {
    const r = rollupCost([]);
    expect(r.totalUsd).toBe(0);
    expect(r.byAgent).toEqual([]);
    expect(r.byModel).toEqual([]);
  });
});

describe("summary", () => {
  test("counts bug/gap/ranked + $/finding", () => {
    const findings = [
      f({ kind: "bug" }),
      f({ kind: "bug", priorityRank: 1 }),
      f({ kind: "gap", priorityRank: 2 }),
      f({ kind: "gap", priorityRank: 3 }),
      f({ kind: "bug", priorityRank: 4 }),
    ];
    const cost = rollupCost([
      { agent: "x", model: "claude-opus-4-7", inputTokens: 10, outputTokens: 10, usd: 0.5 },
    ]);
    const s = summary(findings, [{ date: "2026-06-17", count: 99 }], cost);
    expect(s.totalSessions).toBe(99);
    expect(s.totalFindings).toBe(5);
    expect(s.totalBugs).toBe(3);
    expect(s.totalGaps).toBe(2);
    expect(s.totalRanked).toBe(4);
    expect(s.totalUsd).toBe(0.5);
    expect(s.usdPerFinding).toBe(0.1);
    expect(s.bugRatio).toBe(0.6);
  });

  test("zero findings -> usdPerFinding=0 (not NaN)", () => {
    const s = summary([], [], rollupCost([]));
    expect(s.usdPerFinding).toBe(0);
    expect(s.bugRatio).toBe(0);
  });
});
