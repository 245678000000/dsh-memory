import type { ConflictRecord } from "../domain/conflict.ts";
import type { MemoryEvent } from "../domain/event.ts";
import { FORGOTTEN_PLACEHOLDER, type MemoryRecord } from "../domain/memory.ts";
import { lexicalScore } from "../retrieval/tokenize.ts";
import type { EmbeddingRow, MemoryStore } from "./interface.ts";

export class InMemoryMemoryStore implements MemoryStore {
  private seq = 0;
  private readonly events: MemoryEvent[] = [];
  private readonly projections = new Map<string, MemoryRecord>();
  private readonly fts = new Map<string, string>();
  private readonly conflicts = new Map<string, ConflictRecord>();
  private readonly embeddings = new Map<string, EmbeddingRow>();

  public appendEvent(event: Omit<MemoryEvent, "seq">): MemoryEvent {
    this.seq += 1;
    const stored: MemoryEvent = { ...event, seq: this.seq };
    this.events.push(stored);
    return stored;
  }

  public listEvents(memoryId?: string): MemoryEvent[] {
    return memoryId
      ? this.events.filter((event) => event.memoryId === memoryId)
      : [...this.events];
  }

  public putProjection(record: MemoryRecord): void {
    this.projections.set(record.id, structuredClone(record));
  }

  public getProjection(id: string): MemoryRecord | undefined {
    const record = this.projections.get(id);
    return record ? structuredClone(record) : undefined;
  }

  public listProjections(): MemoryRecord[] {
    return [...this.projections.values()].map((record) => structuredClone(record));
  }

  public deletePayload(id: string): void {
    const record = this.projections.get(id);
    if (!record) return;
    this.projections.set(id, {
      ...record,
      content: FORGOTTEN_PLACEHOLDER,
      structuredValue: undefined,
      subject: undefined,
      predicate: undefined,
      object: undefined,
      payloadPresent: false,
    });
    this.fts.delete(id);
    this.embeddings.delete(id);
  }

  public upsertFts(id: string, text: string): void {
    this.fts.set(id, text);
  }

  public deleteFts(id: string): void {
    this.fts.delete(id);
  }

  public lexicalSearch(query: string, limit: number): Array<{ id: string; rank: number }> {
    const ranked = [...this.fts.entries()]
      .map(([id, text]) => ({ id, rank: lexicalScore(query, text) }))
      .filter((row) => row.rank > 0)
      .sort((a, b) => b.rank - a.rank);
    return ranked.slice(0, limit);
  }

  public putConflict(conflict: ConflictRecord): void {
    this.conflicts.set(conflict.id, structuredClone(conflict));
  }

  public getConflict(id: string): ConflictRecord | undefined {
    const row = this.conflicts.get(id);
    return row ? structuredClone(row) : undefined;
  }

  public listConflicts(): ConflictRecord[] {
    return [...this.conflicts.values()].map((row) => structuredClone(row));
  }

  public putEmbedding(row: EmbeddingRow): void {
    this.embeddings.set(row.memoryId, { ...row, vector: [...row.vector] });
  }

  public getEmbedding(id: string): EmbeddingRow | undefined {
    const row = this.embeddings.get(id);
    return row ? { ...row, vector: [...row.vector] } : undefined;
  }

  public deleteEmbedding(id: string): void {
    this.embeddings.delete(id);
  }

  public transaction<T>(fn: () => T): T {
    return fn();
  }

  public close(): void {
    this.events.length = 0;
    this.projections.clear();
    this.fts.clear();
    this.conflicts.clear();
    this.embeddings.clear();
  }
}
