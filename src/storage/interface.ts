import type { ConflictRecord } from "../domain/conflict.ts";
import type { MemoryEvent } from "../domain/event.ts";
import type { MemoryRecord } from "../domain/memory.ts";

export interface EmbeddingRow {
  memoryId: string;
  vector: number[];
  provider: string;
  model: string;
}

export interface MemoryStore {
  appendEvent(event: Omit<MemoryEvent, "seq">): MemoryEvent;
  listEvents(memoryId?: string): MemoryEvent[];
  putProjection(record: MemoryRecord): void;
  getProjection(id: string): MemoryRecord | undefined;
  listProjections(): MemoryRecord[];
  deletePayload(id: string): void;
  upsertFts(id: string, text: string): void;
  deleteFts(id: string): void;
  lexicalSearch(query: string, limit: number): Array<{ id: string; rank: number }>;
  putConflict(conflict: ConflictRecord): void;
  getConflict(id: string): ConflictRecord | undefined;
  listConflicts(): ConflictRecord[];
  putEmbedding(row: EmbeddingRow): void;
  getEmbedding(id: string): EmbeddingRow | undefined;
  deleteEmbedding(id: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}
