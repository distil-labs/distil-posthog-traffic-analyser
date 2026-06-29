import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CacheEntry {
  sessionId: string;
  narration: string;
  narratedAt: string;
}

export class SessionCache {
  readonly path: string;
  private seen = new Set<string>();
  private loaded = false;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    const body = await readFile(this.path, "utf8");
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t) as { sessionId?: string };
        if (o.sessionId) this.seen.add(o.sessionId);
      } catch {
        // ignore corrupt lines
      }
    }
  }

  has(sessionId: string): boolean {
    return this.seen.has(sessionId);
  }

  size(): number {
    return this.seen.size;
  }

  async mark(entry: Omit<CacheEntry, "narratedAt"> & { narratedAt?: string }): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const rec: CacheEntry = {
      sessionId: entry.sessionId,
      narration: entry.narration,
      narratedAt: entry.narratedAt ?? new Date().toISOString(),
    };
    await appendFile(this.path, JSON.stringify(rec) + "\n");
    this.seen.add(rec.sessionId);
  }
}
