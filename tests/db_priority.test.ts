import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FindingsDB } from "../src/integrations/db.ts";
import type { RawFinding } from "../src/types.ts";

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slm-db-pri-"));
  dbPath = join(dir, "findings.db");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const raw: RawFinding = {
  kind: "bug",
  severity: 3,
  title: "Export fails",
  evidence: "happened thrice",
};

describe("FindingsDB priority", () => {
  test("freshly inserted finding has null priority", () => {
    const db = new FindingsDB(dbPath);
    const f = db.insert(raw, "s1");
    const got = db.list()[0]!;
    expect(got.priorityRank).toBeNull();
    expect(got.priorityReason).toBeNull();
    expect(got.prioritizedAt).toBeNull();
    expect(f.priorityRank).toBeNull();
    db.close();
  });

  test("setPriority persists rank + reason + timestamp", () => {
    const db = new FindingsDB(dbPath);
    const f = db.insert(raw, "s1");
    db.setPriority(f.id, 2, "moderate impact, easy fix");
    const out = db.list()[0]!;
    expect(out.priorityRank).toBe(2);
    expect(out.priorityReason).toBe("moderate impact, easy fix");
    expect(out.prioritizedAt).toBeTruthy();
    db.close();
  });

  test("unprioritized excludes ranked rows", () => {
    const db = new FindingsDB(dbPath);
    const a = db.insert(raw, "s1");
    const b = db.insert({ ...raw, title: "Other" }, "s2");
    db.setPriority(a.id, 1, "do first");
    const pending = db.unprioritized();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(b.id);
    db.close();
  });

  test("list orders prioritized rows first by rank", () => {
    const db = new FindingsDB(dbPath);
    db.insert({ ...raw, title: "A" }, "s1");
    const b = db.insert({ ...raw, title: "B" }, "s2");
    const c = db.insert({ ...raw, title: "C" }, "s3");
    db.setPriority(b.id, 1, "top");
    db.setPriority(c.id, 2, "second");
    const titles = db.list().map((f) => f.title);
    expect(titles).toEqual(["B", "C", "A"]);
    db.close();
  });

  test("clearPriorities resets all rows", () => {
    const db = new FindingsDB(dbPath);
    const f = db.insert(raw, "s1");
    db.setPriority(f.id, 1, "x");
    db.clearPriorities();
    const out = db.list()[0]!;
    expect(out.priorityRank).toBeNull();
    expect(out.priorityReason).toBeNull();
    db.close();
  });
});
