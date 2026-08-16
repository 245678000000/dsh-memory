import {
  eventData,
  type CandidateCreatedData,
  type ConfirmedData,
  type ForgottenData,
  type MemoryEvent,
  type MergedData,
  type ScopeChangedData,
  type SupersededData,
  type UpdatedData,
} from "./event.ts";
import {
  FORGOTTEN_PLACEHOLDER,
  type MemoryRecord,
  type MemorySourceRef,
  type SourceKind,
  defaultDecayPolicy,
  defaultRetentionPolicy,
} from "./memory.ts";
import type { MemoryScope } from "./memory.ts";

function asSourceRefs(value: unknown, fallbackKind: SourceKind): MemorySourceRef[] {
  if (Array.isArray(value)) {
    return value.filter(isSourceRef);
  }
  return [{ kind: fallbackKind }];
}

function isSourceRef(value: unknown): value is MemorySourceRef {
  if (typeof value !== "object" || value === null) return false;
  return "kind" in value && typeof value.kind === "string";
}

function touch(record: MemoryRecord, at: string): MemoryRecord {
  return { ...record, updatedAt: at };
}

export function foldMemoryEvents(events: readonly MemoryEvent[]): Map<string, MemoryRecord> {
  const records = new Map<string, MemoryRecord>();
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  for (const event of ordered) {
    const existing = records.get(event.memoryId);

    switch (event.type) {
      case "memory/candidate-created": {
        const data = eventData<CandidateCreatedData>(event);
        const explicit = data.explicitUserMemory;
        records.set(event.memoryId, {
          id: event.memoryId,
          kind: data.kind,
          scope: data.scope,
          subject: data.subject,
          predicate: data.predicate,
          object: data.object,
          content: data.content,
          structuredValue: data.structuredValue,
          status: "candidate",
          confidence: data.confidence,
          importance: data.importance,
          sensitivity: data.sensitivity,
          sourceRefs: asSourceRefs(data.sourceRefs, data.sourceKind),
          createdAt: event.at,
          updatedAt: event.at,
          validFrom: data.validFrom,
          validUntil: data.validUntil,
          accessCount: 0,
          confirmCount: 0,
          explicitUserMemory: explicit,
          pinned: Boolean(data.pinned),
          supersedes: data.supersedes ?? [],
          conflictsWith: [],
          derivedFrom: data.derivedFrom ?? [],
          extractionType: data.extractionType,
          retentionPolicy: defaultRetentionPolicy({
            explicit,
            validUntil: data.validUntil,
          }),
          decayPolicy: defaultDecayPolicy({
            explicit,
            kind: data.kind,
            inferred: data.extractionType === "inferred",
          }),
          payloadPresent: true,
        });
        break;
      }
      case "memory/accepted": {
        if (!existing) break;
        records.set(event.memoryId, touch({ ...existing, status: "active" }, event.at));
        break;
      }
      case "memory/rejected": {
        if (!existing) break;
        records.set(event.memoryId, touch({ ...existing, status: "rejected" }, event.at));
        break;
      }
      case "memory/confirmed": {
        if (!existing || existing.status === "forgotten") break;
        const data = eventData<ConfirmedData>(event);
        const nextConfidence = Math.min(0.99, data.confidence ?? existing.confidence + 0.04);
        records.set(
          event.memoryId,
          touch(
            {
              ...existing,
              lastConfirmedAt: event.at,
              confirmCount: existing.confirmCount + 1,
              confidence: nextConfidence,
            },
            event.at,
          ),
        );
        break;
      }
      case "memory/recalled": {
        if (!existing || existing.status === "forgotten") break;
        records.set(
          event.memoryId,
          touch(
            {
              ...existing,
              lastAccessedAt: event.at,
              accessCount: existing.accessCount + 1,
            },
            event.at,
          ),
        );
        break;
      }
      case "memory/merged": {
        if (!existing || existing.status === "forgotten") break;
        const data = eventData<MergedData>(event);
        records.set(
          event.memoryId,
          touch(
            {
              ...existing,
              content: data.content,
              subject: data.subject ?? existing.subject,
              predicate: data.predicate ?? existing.predicate,
              object: data.object ?? existing.object,
              derivedFrom: unique([...existing.derivedFrom, ...data.fromIds]),
              lastConfirmedAt: event.at,
              confirmCount: existing.confirmCount + 1,
            },
            event.at,
          ),
        );
        break;
      }
      case "memory/conflict-detected": {
        if (!existing) break;
        const otherId = String(event.data.otherMemoryId ?? "");
        records.set(
          event.memoryId,
          touch(
            {
              ...existing,
              conflictsWith: unique([...existing.conflictsWith, otherId].filter(Boolean)),
            },
            event.at,
          ),
        );
        break;
      }
      case "memory/disputed": {
        if (!existing || existing.status === "forgotten") break;
        const otherId = String(event.data.otherMemoryId ?? "");
        records.set(
          event.memoryId,
          touch(
            {
              ...existing,
              status: existing.status === "superseded" ? existing.status : "disputed",
              conflictsWith: unique([...existing.conflictsWith, otherId].filter(Boolean)),
            },
            event.at,
          ),
        );
        break;
      }
      case "memory/superseded": {
        if (!existing || existing.status === "forgotten") break;
        const data = eventData<SupersededData>(event);
        records.set(
          event.memoryId,
          touch(
            {
              ...existing,
              status: "superseded",
              supersededBy: data.supersededBy,
            },
            event.at,
          ),
        );
        break;
      }
      case "memory/expired": {
        if (!existing || existing.status === "forgotten") break;
        records.set(event.memoryId, touch({ ...existing, status: "expired" }, event.at));
        break;
      }
      case "memory/forgotten": {
        const data = eventData<ForgottenData>(event);
        const base: MemoryRecord =
          existing ??
          emptyForgotten(event.memoryId, event.at, data.reason);
        records.set(
          event.memoryId,
          touch(
            {
              ...base,
              status: "forgotten",
              content: FORGOTTEN_PLACEHOLDER,
              structuredValue: undefined,
              subject: undefined,
              predicate: undefined,
              object: undefined,
              payloadPresent: false,
              pinned: false,
            },
            event.at,
          ),
        );
        break;
      }
      case "memory/payload-purged": {
        if (!existing) break;
        records.set(
          event.memoryId,
          touch(
            {
              ...existing,
              content: existing.status === "forgotten" ? FORGOTTEN_PLACEHOLDER : existing.content,
              structuredValue: undefined,
              payloadPresent: false,
            },
            event.at,
          ),
        );
        break;
      }
      case "memory/pinned": {
        if (!existing || existing.status === "forgotten") break;
        records.set(event.memoryId, touch({ ...existing, pinned: true }, event.at));
        break;
      }
      case "memory/unpinned": {
        if (!existing || existing.status === "forgotten") break;
        records.set(event.memoryId, touch({ ...existing, pinned: false }, event.at));
        break;
      }
      case "memory/scope-changed": {
        if (!existing || existing.status === "forgotten") break;
        const data = eventData<ScopeChangedData>(event);
        records.set(event.memoryId, touch({ ...existing, scope: data.scope }, event.at));
        break;
      }
      case "memory/updated": {
        if (!existing || existing.status === "forgotten") break;
        const data = eventData<UpdatedData>(event);
        records.set(
          event.memoryId,
          touch(
            {
              ...existing,
              content: data.content ?? existing.content,
              kind: data.kind ?? existing.kind,
              importance: data.importance ?? existing.importance,
              confidence: data.confidence ?? existing.confidence,
              validUntil:
                data.validUntil === null ? undefined : (data.validUntil ?? existing.validUntil),
              structuredValue: data.structuredValue ?? existing.structuredValue,
            },
            event.at,
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  return records;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function emptyForgotten(id: string, at: string, _reason: string): MemoryRecord {
  const scope: MemoryScope = { kind: "global", id: "user" };
  return {
    id,
    kind: "semantic",
    scope,
    content: FORGOTTEN_PLACEHOLDER,
    status: "forgotten",
    confidence: 0,
    importance: 0,
    sensitivity: "normal",
    sourceRefs: [],
    createdAt: at,
    updatedAt: at,
    accessCount: 0,
    confirmCount: 0,
    explicitUserMemory: false,
    pinned: false,
    supersedes: [],
    conflictsWith: [],
    derivedFrom: [],
    extractionType: "inferred",
    retentionPolicy: { mode: "eventual-gc" },
    decayPolicy: { mode: "none" },
    payloadPresent: false,
  };
}
