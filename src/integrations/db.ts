import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Candidate } from "../orchestrator/dedupe.ts";
import type { FindingKind, RawFinding, StoredFinding } from "../types.ts";
import { getSettings } from "../util/config.ts";

interface FindingRow {
  id: string;
  kind: string;
  severity: number;
  title: string;
  evidence: string;
  session_ids: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  embedding: string | null;
  priority_rank: number | null;
  priority_reason: string | null;
  prioritized_at: string | null;
}

export class FindingsDB {
  readonly path: string;
  private db: Database;

  constructor(path?: string) {
    const s = getSettings();
    this.path = path ?? join(s.DATA_DIR, "findings.db");
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        severity INTEGER NOT NULL,
        title TEXT NOT NULL,
        evidence TEXT NOT NULL,
        session_ids TEXT NOT NULL,
        occurrences INTEGER NOT NULL DEFAULT 1,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        embedding TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_findings_kind ON findings(kind);
      CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity DESC);
    `);

    const cols = (this.db.prepare(`PRAGMA table_info(findings)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    if (!cols.includes("priority_rank")) {
      this.db.exec(`ALTER TABLE findings ADD COLUMN priority_rank INTEGER`);
    }
    if (!cols.includes("priority_reason")) {
      this.db.exec(`ALTER TABLE findings ADD COLUMN priority_reason TEXT`);
    }
    if (!cols.includes("prioritized_at")) {
      this.db.exec(`ALTER TABLE findings ADD COLUMN prioritized_at TEXT`);
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_findings_priority ON findings(priority_rank ASC)`);
  }

  close(): void {
    this.db.close();
  }

  private rowToFinding(r: FindingRow): StoredFinding {
    return {
      id: r.id,
      kind: r.kind as FindingKind,
      severity: r.severity,
      title: r.title,
      evidence: r.evidence,
      sessionIds: JSON.parse(r.session_ids) as string[],
      occurrences: r.occurrences,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      priorityRank: r.priority_rank,
      priorityReason: r.priority_reason,
      prioritizedAt: r.prioritized_at,
    };
  }

  insert(finding: RawFinding, sessionId: string, embedding?: number[]): StoredFinding {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO findings
          (id, kind, severity, title, evidence, session_ids, occurrences, first_seen, last_seen, embedding)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        id,
        finding.kind,
        finding.severity,
        finding.title,
        finding.evidence,
        JSON.stringify([sessionId]),
        now,
        now,
        embedding ? JSON.stringify(embedding) : null,
      );
    return {
      id,
      kind: finding.kind,
      severity: finding.severity,
      title: finding.title,
      evidence: finding.evidence,
      sessionIds: [sessionId],
      occurrences: 1,
      firstSeen: now,
      lastSeen: now,
      priorityRank: null,
      priorityReason: null,
      prioritizedAt: null,
    };
  }

  mergeOccurrence(id: string, sessionId: string, severity?: number): void {
    const row = this.db.prepare(`SELECT session_ids, occurrences, severity FROM findings WHERE id = ?`).get(id) as
      | { session_ids: string; occurrences: number; severity: number }
      | null;
    if (!row) return;
    const ids = new Set(JSON.parse(row.session_ids) as string[]);
    const wasNew = !ids.has(sessionId);
    ids.add(sessionId);
    const newSeverity = severity != null ? Math.max(row.severity, severity) : row.severity;
    this.db
      .prepare(
        `UPDATE findings SET
          session_ids = ?,
          occurrences = occurrences + ?,
          severity = ?,
          last_seen = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify([...ids]), wasNew ? 1 : 0, newSeverity, new Date().toISOString(), id);
  }

  candidates(): Candidate[] {
    const rows = this.db
      .prepare(`SELECT id, embedding FROM findings WHERE embedding IS NOT NULL`)
      .all() as { id: string; embedding: string }[];
    return rows.map((r) => ({ id: r.id, embedding: JSON.parse(r.embedding) as number[] }));
  }

  list(): StoredFinding[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM findings
         ORDER BY
           CASE WHEN priority_rank IS NULL THEN 1 ELSE 0 END,
           priority_rank ASC,
           severity DESC,
           occurrences DESC`,
      )
      .all() as FindingRow[];
    return rows.map((r) => this.rowToFinding(r));
  }

  unprioritized(limit?: number): StoredFinding[] {
    const sql = `SELECT * FROM findings
                 WHERE priority_rank IS NULL
                 ORDER BY severity DESC, occurrences DESC${limit ? ` LIMIT ${Number(limit) | 0}` : ""}`;
    const rows = this.db.prepare(sql).all() as FindingRow[];
    return rows.map((r) => this.rowToFinding(r));
  }

  setPriority(id: string, rank: number, reason: string): void {
    this.db
      .prepare(
        `UPDATE findings SET priority_rank = ?, priority_reason = ?, prioritized_at = ? WHERE id = ?`,
      )
      .run(rank, reason, new Date().toISOString(), id);
  }

  clearPriorities(): void {
    this.db.exec(
      `UPDATE findings SET priority_rank = NULL, priority_reason = NULL, prioritized_at = NULL`,
    );
  }

  size(): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM findings`).get() as { n: number };
    return r.n;
  }
}
