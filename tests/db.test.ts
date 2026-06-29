import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FindingsDB } from "../src/integrations/db.ts";
import type { RawFinding } from "../src/types.ts";

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slm-db-"));
  dbPath = join(dir, "findings.db");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sample: RawFinding = {
  kind: "bug",
  severity: 3,
  title: "Export CSV fails",
  evidence: "User clicked export three times and got nothing.",
};

describe("FindingsDB", () => {
  test("insert + list round-trip", () => {
    const db = new FindingsDB(dbPath);
    const f = db.insert(sample, "sess-1", [0.1, 0.2, 0.3]);
    expect(f.id).toBeTruthy();
    expect(db.size()).toBe(1);
    const list = db.list();
    expect(list[0]!.title).toBe(sample.title);
    expect(list[0]!.sessionIds).toEqual(["sess-1"]);
    db.close();
  });

  test("mergeOccurrence adds session + bumps count", () => {
    const db = new FindingsDB(dbPath);
    const f = db.insert(sample, "sess-1", [0.1, 0.2]);
    db.mergeOccurrence(f.id, "sess-2", 4);
    const out = db.list()[0]!;
    expect(out.sessionIds.sort()).toEqual(["sess-1", "sess-2"]);
    expect(out.occurrences).toBe(2);
    expect(out.severity).toBe(4);
    db.close();
  });

  test("mergeOccurrence with same session does not double-count", () => {
    const db = new FindingsDB(dbPath);
    const f = db.insert(sample, "sess-1");
    db.mergeOccurrence(f.id, "sess-1");
    const out = db.list()[0]!;
    expect(out.sessionIds).toEqual(["sess-1"]);
    expect(out.occurrences).toBe(1);
    db.close();
  });

  test("candidates returns only rows with embeddings", () => {
    const db = new FindingsDB(dbPath);
    db.insert(sample, "sess-1", [1, 2, 3]);
    db.insert({ ...sample, title: "No embedding" }, "sess-2");
    const cands = db.candidates();
    expect(cands).toHaveLength(1);
    expect(cands[0]!.embedding).toEqual([1, 2, 3]);
    db.close();
  });

  test("list orders by severity desc then occurrences", () => {
    const db = new FindingsDB(dbPath);
    db.insert({ ...sample, severity: 2, title: "low" }, "s1");
    db.insert({ ...sample, severity: 5, title: "high" }, "s2");
    db.insert({ ...sample, severity: 3, title: "mid" }, "s3");
    const titles = db.list().map((f) => f.title);
    expect(titles[0]).toBe("high");
    expect(titles[2]).toBe("low");
    db.close();
  });
});
