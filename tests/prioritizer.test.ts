import { describe, expect, test } from "bun:test";
import {
  buildPrioritizerPrompt,
  PRIORITIZER_SYSTEM,
  toInputItem,
} from "../src/agents/prioritizer.ts";
import { PrioritizerOutputSchema, type StoredFinding } from "../src/types.ts";

function finding(overrides: Partial<StoredFinding> = {}): StoredFinding {
  return {
    id: "id-1",
    kind: "bug",
    severity: 3,
    title: "Export fails",
    evidence: "user clicked export 3 times",
    sessionIds: ["s1"],
    occurrences: 1,
    firstSeen: "2026-06-17T10:00:00Z",
    lastSeen: "2026-06-17T10:00:00Z",
    priorityRank: null,
    priorityReason: null,
    prioritizedAt: null,
    ...overrides,
  };
}

describe("prioritizer", () => {
  test("system prompt enforces JSON-only and id-exact-once", () => {
    expect(PRIORITIZER_SYSTEM).toContain("EXACTLY ONCE");
    expect(PRIORITIZER_SYSTEM).toContain("VALID JSON");
    expect(PRIORITIZER_SYSTEM).toContain("rank=1");
  });

  test("toInputItem strips internal fields", () => {
    const item = toInputItem(finding({ id: "abc" }));
    expect(item).toEqual({
      id: "abc",
      kind: "bug",
      severity: 3,
      occurrences: 1,
      title: "Export fails",
      evidence: "user clicked export 3 times",
    });
    expect("sessionIds" in item).toBe(false);
    expect("firstSeen" in item).toBe(false);
  });

  test("prompt includes every input id", () => {
    const items = [
      toInputItem(finding({ id: "x" })),
      toInputItem(finding({ id: "y" })),
      toInputItem(finding({ id: "z" })),
    ];
    const p = buildPrioritizerPrompt(items);
    expect(p).toContain("x");
    expect(p).toContain("y");
    expect(p).toContain("z");
    expect(p).toContain("3"); // count
  });

  test("zod accepts well-formed output", () => {
    const ok = PrioritizerOutputSchema.safeParse({
      ranked: [
        { id: "a", rank: 1, reason: "highest impact, hits 7 users" },
        { id: "b", rank: 2, reason: "cosmetic only" },
      ],
    });
    expect(ok.success).toBe(true);
  });

  test("zod rejects rank=0", () => {
    const bad = PrioritizerOutputSchema.safeParse({
      ranked: [{ id: "a", rank: 0, reason: "x" }],
    });
    expect(bad.success).toBe(false);
  });

  test("zod rejects missing reason", () => {
    const bad = PrioritizerOutputSchema.safeParse({
      ranked: [{ id: "a", rank: 1 }],
    });
    expect(bad.success).toBe(false);
  });
});
