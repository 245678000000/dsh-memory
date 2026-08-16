import type { MemoryKind, MemoryScope, MemoryStatus, Sensitivity, SourceKind } from "./memory.ts";
import type { ConflictType } from "./conflict.ts";

export type MemoryEventType =
  | "memory/candidate-created"
  | "memory/accepted"
  | "memory/rejected"
  | "memory/confirmed"
  | "memory/recalled"
  | "memory/merged"
  | "memory/conflict-detected"
  | "memory/disputed"
  | "memory/superseded"
  | "memory/expired"
  | "memory/forgotten"
  | "memory/pinned"
  | "memory/unpinned"
  | "memory/scope-changed"
  | "memory/updated"
  | "memory/payload-purged";

export interface MemoryEventBase {
  id: string;
  seq: number;
  type: MemoryEventType;
  memoryId: string;
  at: string;
}

export interface CandidateCreatedData {
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  subject?: string;
  predicate?: string;
  object?: string;
  structuredValue?: unknown;
  confidence: number;
  importance: number;
  sensitivity: Sensitivity;
  sourceKind: SourceKind;
  sourceRefs?: unknown;
  explicitUserMemory: boolean;
  pinned?: boolean;
  validFrom?: string;
  validUntil?: string;
  extractionType: "explicit" | "inferred" | "derived" | "imported";
  derivedFrom?: string[];
  supersedes?: string[];
}

export interface RejectedData {
  reason: string;
}

export interface ConfirmedData {
  confidence?: number;
}

export interface RecalledData {
  query?: string;
  score?: number;
}

export interface MergedData {
  fromIds: string[];
  content: string;
  subject?: string;
  predicate?: string;
  object?: string;
}

export interface ConflictDetectedData {
  conflictId: string;
  otherMemoryId: string;
  conflictType: ConflictType;
}

export interface DisputedData {
  conflictId: string;
  otherMemoryId: string;
}

export interface SupersededData {
  supersededBy: string;
  reason: string;
}

export interface ForgottenData {
  reason: string;
  query?: string;
}

export interface ScopeChangedData {
  scope: MemoryScope;
}

export interface UpdatedData {
  content?: string;
  kind?: MemoryKind;
  importance?: number;
  confidence?: number;
  validUntil?: string | null;
  structuredValue?: unknown;
}

export interface MemoryEvent extends MemoryEventBase {
  data: Record<string, unknown>;
}

export function eventData<T>(event: MemoryEvent): T {
  return event.data as T;
}
