export type MemoryKind =
  | "preference"
  | "constraint"
  | "project_fact"
  | "decision"
  | "procedure"
  | "correction"
  | "entity"
  | "relationship"
  | "episodic"
  | "semantic";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "preference",
  "constraint",
  "project_fact",
  "decision",
  "procedure",
  "correction",
  "entity",
  "relationship",
  "episodic",
  "semantic",
] as const;

export type MemoryStatus =
  | "candidate"
  | "active"
  | "disputed"
  | "superseded"
  | "expired"
  | "forgotten"
  | "rejected";

export const RECALLABLE_STATUSES: readonly MemoryStatus[] = ["active", "disputed"] as const;

export type Sensitivity = "public" | "normal" | "private" | "sensitive" | "secret";

export type ScopeKind = "global" | "workspace" | "project" | "task" | "session";

export const SCOPE_PRECEDENCE: readonly ScopeKind[] = [
  "task",
  "project",
  "workspace",
  "global",
  "session",
] as const;

export interface MemoryScope {
  kind: ScopeKind;
  id: string;
  label?: string;
}

export type SourceKind =
  | "explicit_user"
  | "user_correction"
  | "inferred"
  | "structured"
  | "import"
  | "derived"
  | "tool";

export interface MemorySourceRef {
  kind: SourceKind;
  sessionId?: string;
  eventId?: string;
  toolName?: string;
  importedFrom?: string;
  note?: string;
}

export interface RetentionPolicy {
  mode: "permanent" | "ttl" | "eventual-gc";
  ttlDays?: number;
}

export interface DecayPolicy {
  mode: "none" | "time" | "access" | "confirmation";
  halfLifeDays?: number;
  minimumScore?: number;
}

export type ExtractionType = "explicit" | "inferred" | "derived" | "imported";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  subject?: string;
  predicate?: string;
  object?: string;
  content: string;
  structuredValue?: unknown;
  status: MemoryStatus;
  confidence: number;
  importance: number;
  sensitivity: Sensitivity;
  sourceRefs: MemorySourceRef[];
  createdAt: string;
  updatedAt: string;
  validFrom?: string;
  validUntil?: string;
  lastConfirmedAt?: string;
  lastAccessedAt?: string;
  accessCount: number;
  confirmCount: number;
  explicitUserMemory: boolean;
  pinned: boolean;
  supersedes: string[];
  supersededBy?: string;
  conflictsWith: string[];
  derivedFrom: string[];
  extractionType: ExtractionType;
  retentionPolicy: RetentionPolicy;
  decayPolicy: DecayPolicy;
  payloadPresent: boolean;
}

export const FORGOTTEN_PLACEHOLDER = "[forgotten]";

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function isRecallableStatus(status: MemoryStatus): boolean {
  return status === "active" || status === "disputed";
}

export function defaultDecayPolicy(input: {
  explicit: boolean;
  kind: MemoryKind;
  inferred: boolean;
}): DecayPolicy {
  if (input.explicit) {
    return { mode: "none", halfLifeDays: 3650, minimumScore: 0.85 };
  }
  if (input.kind === "episodic" || input.inferred) {
    return { mode: "time", halfLifeDays: 21, minimumScore: 0.12 };
  }
  if (input.kind === "project_fact" || input.kind === "decision" || input.kind === "procedure") {
    return { mode: "time", halfLifeDays: 90, minimumScore: 0.2 };
  }
  return { mode: "time", halfLifeDays: 60, minimumScore: 0.18 };
}

export function defaultRetentionPolicy(input: {
  explicit: boolean;
  validUntil?: string;
}): RetentionPolicy {
  if (input.validUntil) return { mode: "ttl" };
  if (input.explicit) return { mode: "permanent" };
  return { mode: "eventual-gc" };
}

export function sourceAuthority(kind: SourceKind): number {
  switch (kind) {
    case "user_correction":
      return 100;
    case "explicit_user":
      return 80;
    case "structured":
      return 70;
    case "derived":
      return 50;
    case "tool":
      return 40;
    case "inferred":
      return 30;
    case "import":
      return 25;
    default:
      return 20;
  }
}

export function strongestSource(refs: readonly MemorySourceRef[]): SourceKind {
  if (refs.length === 0) return "inferred";
  let best: SourceKind = refs[0]!.kind;
  let score = sourceAuthority(best);
  for (const ref of refs) {
    const next = sourceAuthority(ref.kind);
    if (next > score) {
      best = ref.kind;
      score = next;
    }
  }
  return best;
}

export function memoryPrimarySource(record: MemoryRecord): SourceKind {
  if (record.explicitUserMemory) {
    return record.kind === "correction" ? "user_correction" : "explicit_user";
  }
  return strongestSource(record.sourceRefs);
}
