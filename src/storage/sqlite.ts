import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConflictRecord } from "../domain/conflict.ts";
import type { MemoryEvent } from "../domain/event.ts";
import { FORGOTTEN_PLACEHOLDER, type MemoryRecord } from "../domain/memory.ts";
import { lexicalScore } from "../retrieval/tokenize.ts";
import type { EmbeddingRow, MemoryStore } from "./interface.ts";

interface EventRow {
  seq: number;
  id: string;
  type: string;
  memory_id: string;
  at: string;
  payload_json: string;
}

interface MemoryRow {
  id: string;
  record_json: string;
}

interface ConflictRow {
  id: string;
  record_json: string;
}

interface EmbeddingSqlRow {
  memory_id: string;
  vector_json: string;
  provider: string;
  model: string;
}

export class SqliteMemoryStore implements MemoryStore {
  private readonly db: DatabaseSync;
  private ftsReady = false;

  public constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_memory_id ON events(memory_id);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope_kind TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        subject TEXT,
        content TEXT,
        created_at TEXT NOT NULL,
        valid_until TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        explicit INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS embeddings (
        memory_id TEXT PRIMARY KEY,
        vector_json TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL
      );
    `);
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          id UNINDEXED,
          content,
          tokenize = 'porter unicode61'
        );
      `);
      this.ftsReady = true;
    } catch {
      this.ftsReady = false;
    }
  }

  public appendEvent(event: Omit<MemoryEvent, "seq">): MemoryEvent {
    this.db
      .prepare(
        "INSERT INTO events (id, type, memory_id, at, payload_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(event.id, event.type, event.memoryId, event.at, JSON.stringify(event.data));
    const row = this.db
      .prepare("SELECT seq FROM events WHERE id = ?")
      .get(event.id) as unknown as { seq: number } | undefined;
    return { ...event, seq: row?.seq ?? 0 };
  }

  public listEvents(memoryId?: string): MemoryEvent[] {
    const rows = (
      memoryId
        ? this.db.prepare("SELECT * FROM events WHERE memory_id = ? ORDER BY seq ASC").all(memoryId)
        : this.db.prepare("SELECT * FROM events ORDER BY seq ASC").all()
    ) as unknown as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      type: row.type as MemoryEvent["type"],
      memoryId: row.memory_id,
      at: row.at,
      data: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }

  public putProjection(record: MemoryRecord): void {
    this.db
      .prepare(
        `INSERT INTO memories (
          id, record_json, status, kind, scope_kind, scope_id, subject, content,
          created_at, valid_until, pinned, explicit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          record_json = excluded.record_json,
          status = excluded.status,
          kind = excluded.kind,
          scope_kind = excluded.scope_kind,
          scope_id = excluded.scope_id,
          subject = excluded.subject,
          content = excluded.content,
          created_at = excluded.created_at,
          valid_until = excluded.valid_until,
          pinned = excluded.pinned,
          explicit = excluded.explicit`,
      )
      .run(
        record.id,
        JSON.stringify(record),
        record.status,
        record.kind,
        record.scope.kind,
        record.scope.id,
        record.subject ?? null,
        record.payloadPresent ? record.content : "",
        record.createdAt,
        record.validUntil ?? null,
        record.pinned ? 1 : 0,
        record.explicitUserMemory ? 1 : 0,
      );
  }

  public getProjection(id: string): MemoryRecord | undefined {
    const row = this.db.prepare("SELECT record_json FROM memories WHERE id = ?").get(id) as unknown as
      | MemoryRow
      | undefined;
    return row ? (JSON.parse(row.record_json) as MemoryRecord) : undefined;
  }

  public listProjections(): MemoryRecord[] {
    const rows = this.db.prepare("SELECT record_json FROM memories").all() as unknown as MemoryRow[];
    return rows.map((row) => JSON.parse(row.record_json) as MemoryRecord);
  }

  public deletePayload(id: string): void {
    const record = this.getProjection(id);
    if (!record) return;
    const redacted: MemoryRecord = {
      ...record,
      content: FORGOTTEN_PLACEHOLDER,
      structuredValue: undefined,
      subject: undefined,
      predicate: undefined,
      object: undefined,
      payloadPresent: false,
    };
    this.putProjection(redacted);
    this.deleteFts(id);
    this.deleteEmbedding(id);
  }

  public upsertFts(id: string, text: string): void {
    if (!this.ftsReady) return;
    this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
    this.db.prepare("INSERT INTO memories_fts (id, content) VALUES (?, ?)").run(id, text);
  }

  public deleteFts(id: string): void {
    if (!this.ftsReady) return;
    this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
  }

  public lexicalSearch(query: string, limit: number): Array<{ id: string; rank: number }> {
    if (this.ftsReady) {
      try {
        const rows = this.db
          .prepare(
            "SELECT id, bm25(memories_fts) AS rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
          )
          .all(sanitizeFts(query), limit) as unknown as Array<{ id: string; rank: number }>;
        if (rows.length > 0) {
          return rows.map((row) => ({ id: row.id, rank: 1 / (1 + Math.max(0, row.rank)) }));
        }
      } catch {
        // Fall through to lexical scan.
      }
    }
    const rows = this.db.prepare("SELECT id, content FROM memories WHERE content != ''").all() as unknown as Array<{
      id: string;
      content: string;
    }>;
    return rows
      .map((row) => ({ id: row.id, rank: lexicalScore(query, row.content ?? "") }))
      .filter((row) => row.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);
  }

  public putConflict(conflict: ConflictRecord): void {
    this.db
      .prepare(
        "INSERT INTO conflicts (id, record_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json",
      )
      .run(conflict.id, JSON.stringify(conflict));
  }

  public getConflict(id: string): ConflictRecord | undefined {
    const row = this.db.prepare("SELECT record_json FROM conflicts WHERE id = ?").get(id) as unknown as
      | ConflictRow
      | undefined;
    return row ? (JSON.parse(row.record_json) as ConflictRecord) : undefined;
  }

  public listConflicts(): ConflictRecord[] {
    const rows = this.db.prepare("SELECT record_json FROM conflicts").all() as unknown as ConflictRow[];
    return rows.map((row) => JSON.parse(row.record_json) as ConflictRecord);
  }

  public putEmbedding(row: EmbeddingRow): void {
    this.db
      .prepare(
        `INSERT INTO embeddings (memory_id, vector_json, provider, model)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(memory_id) DO UPDATE SET
           vector_json = excluded.vector_json,
           provider = excluded.provider,
           model = excluded.model`,
      )
      .run(row.memoryId, JSON.stringify(row.vector), row.provider, row.model);
  }

  public getEmbedding(id: string): EmbeddingRow | undefined {
    const row = this.db
      .prepare("SELECT memory_id, vector_json, provider, model FROM embeddings WHERE memory_id = ?")
      .get(id) as unknown as EmbeddingSqlRow | undefined;
    if (!row) return undefined;
    return {
      memoryId: row.memory_id,
      vector: JSON.parse(row.vector_json) as number[],
      provider: row.provider,
      model: row.model,
    };
  }

  public deleteEmbedding(id: string): void {
    this.db.prepare("DELETE FROM embeddings WHERE memory_id = ?").run(id);
  }

  public transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public close(): void {
    this.db.close();
  }
}

function sanitizeFts(query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
    .slice(0, 12);
  return tokens.map((token) => `"${token}"`).join(" OR ") || '""';
}

export function openStore(path = ":memory:"): MemoryStore {
  return new SqliteMemoryStore(path);
}
