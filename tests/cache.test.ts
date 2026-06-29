import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionCache } from "../src/util/cache.ts";

async function withTmp<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "slm-cache-"));
  try {
    return await fn(join(dir, "narrations.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("SessionCache", () => {
  test("empty cache reports nothing seen", async () => {
    await withTmp(async (path) => {
      const c = new SessionCache(path);
      await c.load();
      expect(c.size()).toBe(0);
      expect(c.has("foo")).toBe(false);
    });
  });

  test("mark + reload preserves seen set", async () => {
    await withTmp(async (path) => {
      const a = new SessionCache(path);
      await a.load();
      await a.mark({ sessionId: "s1", narration: "did stuff" });
      await a.mark({ sessionId: "s2", narration: "did more" });

      const b = new SessionCache(path);
      await b.load();
      expect(b.size()).toBe(2);
      expect(b.has("s1")).toBe(true);
      expect(b.has("s2")).toBe(true);
      expect(b.has("s3")).toBe(false);
    });
  });

  test("corrupt lines are skipped", async () => {
    await withTmp(async (path) => {
      const c = new SessionCache(path);
      await c.mark({ sessionId: "ok", narration: "fine" });
      const { appendFile } = await import("node:fs/promises");
      await appendFile(path, "this is not json\n");
      const d = new SessionCache(path);
      await d.load();
      expect(d.size()).toBe(1);
      expect(d.has("ok")).toBe(true);
    });
  });
});
