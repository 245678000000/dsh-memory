import { planConsolidation } from "./agents/consolidator.ts";
import { curateObservation, detectExplicitForgetQuery } from "./agents/curator.ts";
import type { Clock } from "./clock.ts";
import { iso, systemClock } from "./clock.ts";
import type { ConflictRecord, ConflictResolution } from "./domain/conflict.ts";
import type { CandidateCreatedData, MemoryEvent } from "./domain/event.ts";
import { foldMemoryEvents } from "./domain/fold.ts";
import {
  clamp01,
  defaultDecayPolicy,
  defaultRetentionPolicy,
  type MemoryKind,
  type MemoryRecord,
  type MemoryScope,
  sourceAuthority,
} from "./domain/memory.ts";
import { decideRememberPolicy } from "./domain/policy.ts";
import {
  type ActiveScope,
  defaultGlobalScope,
  inferScopeFromText,
  resolveNamedScope,
} from "./domain/scope.ts";
import { cosineSimilarity, type EmbeddingProvider } from "./embeddings/interface.ts";
import { createConflictId, createEventId, createMemoryId } from "./ids.ts";
import { classifyMemory, looksLikeGuess } from "./lifecycle/classifier.ts";
import { detectConflictsForScope } from "./lifecycle/conflict.ts";
import { evaluateEligibility } from "./lifecycle/eligibility.ts";
import { extractFact } from "./lifecycle/extract.ts";
import { shouldMarkExpired } from "./lifecycle/expiration.ts";
import { applyForget } from "./lifecycle/forgetting.ts";
import { DEFAULT_GC_POLICY, shouldGarbageCollect } from "./lifecycle/gc.ts";
import { inspectSensitivity } from "./lifecycle/sensitivity.ts";
import { applyBudget, type Budget, DEFAULT_BUDGET } from "./retrieval/budget.ts";
import { explainMemory, formatExplanation, type MemoryExplanation } from "./retrieval/explain.ts";
import { rankMemories, type RankedMemory } from "./retrieval/search.ts";
import { searchableText } from "./retrieval/scorer.ts";
import { FORGET_BOUNDARY_NOTICE, renderRecalledMemory, renderRecallBlock } from "./render.ts";
import type { MemoryStore } from "./storage/interface.ts";
import { InMemoryMemoryStore } from "./storage/memory-store.ts";
import type { RememberInput } from "./types.ts";

export type { RememberInput } from "./types.ts";

export interface RememberResult {
  accepted: boolean;
  decision: string;
  reason: string;
  memory?: MemoryRecord;
  forgottenNotice?: string;
  rejectedAsSecret?: boolean;
}

export interface ForgetSpec {
  id?: string;
  query?: string;
  subject?: string;
  scope?: string;
  all?: boolean;
  confirmAll?: boolean;
}

export interface ForgetResult {
  forgottenIds: string[];
  notice: string;
  confirmationRequired?: boolean;
}

export interface RecallResult {
  selected: RankedMemory[];
  dropped: RankedMemory[];
  tokens: number;
  promptBlock: string;
}

export interface ExportDocument {
  version: 1;
  exportedAt: string;
  memories: MemoryRecord[];
  conflicts: ConflictRecord[];
}

export interface MemoryServiceOptions {
  store?: MemoryStore;
  clock?: Clock;
  embeddings?: EmbeddingProvider;
  budget?: Budget;
  now?: Date;
}

export class MemoryService {
  public readonly store: MemoryStore;
  private readonly clock: Clock;
  private readonly embeddings?: EmbeddingProvider;
  private readonly budget: Budget;

  public constructor(options: MemoryServiceOptions = {}) {
    this.store = options.store ?? new InMemoryMemoryStore();
    this.clock = options.clock ?? systemClock;
    this.embeddings = options.embeddings;
    this.budget = options.budget ?? DEFAULT_BUDGET;
  }

  public remember(input: RememberInput, active: ActiveScope): RememberResult {
    const content = input.content.trim();
    if (!content) {
      return { accepted: false, decision: "reject", reason: "empty_content" };
    }

    const sensitivity = inspectSensitivity(content);
    if (sensitivity.reject) {
      return {
        accepted: false,
        decision: "reject",
        reason: sensitivity.reason,
        rejectedAsSecret: true,
      };
    }

    const explicit = Boolean(input.explicit);
    if (looksLikeGuess(content) && !explicit) {
      return { accepted: false, decision: "reject", reason: "ungrounded_inference" };
    }

    const eligibility = evaluateEligibility(content, {
      explicit,
      sensitive: sensitivity.sensitivity === "sensitive" || sensitivity.sensitivity === "secret",
    });
    const classification = classifyMemory(content, {
      explicit,
      requestedKind: input.kind,
    });
    const fact = extractFact(content);
    const scope = input.scope
      ? resolveNamedScope(input.scope, active)
      : inferScopeFromText(content, active);

    const incomingAuthority = explicit
      ? (fact?.correction ? sourceAuthority("user_correction") : sourceAuthority("explicit_user"))
      : sourceAuthority("inferred");

    return this.store.transaction(() => {
      this.tickLocked(active);
      const existing = this.visibleForConflict(scope);
      const conflicts = detectConflictsForScope(
        {
          content,
          subject: classification.subject ?? fact?.subject,
          predicate: classification.predicate ?? fact?.predicate,
          object: classification.object ?? fact?.canonicalObject,
          sourceAuthority: incomingAuthority,
          explicit,
          temporal: Boolean(fact?.temporal),
          correction: Boolean(fact?.correction) || classification.kind === "correction",
          createdAt: iso(this.clock.now()),
          scope,
        },
        existing,
      );
      const policy = decideRememberPolicy({
        explicit,
        sensitivity: sensitivity.sensitivity,
        eligibility,
        conflicts,
      });

      if (policy.kind === "reject") {
        return { accepted: false, decision: policy.kind, reason: policy.reason };
      }

      if (policy.kind === "merge" && policy.mergeIntoId) {
        const target = this.require(policy.mergeIntoId);
        this.append(target.id, "memory/confirmed", { confidence: Math.min(0.99, target.confidence + 0.03) });
        if (policy.mergedContent) {
          this.append(target.id, "memory/merged", {
            fromIds: [target.id],
            content: policy.mergedContent,
            subject: classification.subject,
            predicate: classification.predicate,
            object: classification.object,
          });
        }
        const updated = this.project(target.id);
        return { accepted: true, decision: "merge", reason: policy.reason, memory: updated };
      }

      const id = createMemoryId();
      const now = iso(this.clock.now());
      const created: CandidateCreatedData = {
        kind: classification.kind,
        scope,
        content,
        subject: classification.subject ?? fact?.subject,
        predicate: classification.predicate ?? fact?.predicate,
        object: classification.object ?? fact?.canonicalObject,
        structuredValue: input.structuredValue,
        confidence: explicit ? Math.max(0.9, classification.confidence) : classification.confidence,
        importance: explicit ? 0.9 : clamp01(eligibility.likelyToMatterLater ? 0.62 : 0.4),
        sensitivity: sensitivity.sensitivity,
        sourceKind: explicit ? (fact?.correction ? "user_correction" : "explicit_user") : "inferred",
        sourceRefs: [
          {
            kind: explicit ? (fact?.correction ? "user_correction" : "explicit_user") : "inferred",
            sessionId: input.sessionId,
            note: input.sourceNote,
          },
        ],
        explicitUserMemory: explicit,
        pinned: input.pin,
        validUntil: input.validUntil,
        extractionType: explicit ? "explicit" : "inferred",
        supersedes: policy.supersedeIds,
      };
      this.append(id, "memory/candidate-created", created as unknown as Record<string, unknown>, now);

      if (policy.kind === "dispute") {
        this.append(id, "memory/accepted", {});
        this.append(id, "memory/disputed", {
          conflictId: "pending",
          otherMemoryId: policy.disputeWithIds?.[0] ?? "",
        });
        for (const otherId of policy.disputeWithIds ?? []) {
          const conflictId = createConflictId();
          this.append(id, "memory/conflict-detected", {
            conflictId,
            otherMemoryId: otherId,
            conflictType: "uncertain_conflict",
          });
          this.append(otherId, "memory/conflict-detected", {
            conflictId,
            otherMemoryId: id,
            conflictType: "uncertain_conflict",
          });
          this.append(otherId, "memory/disputed", { conflictId, otherMemoryId: id });
          this.project(otherId);
          this.store.putConflict({
            id: conflictId,
            type: "uncertain_conflict",
            leftId: otherId,
            rightId: id,
            status: "disputed",
            reason: policy.reason,
            createdAt: now,
          });
        }
        const memory = this.project(id);
        return { accepted: true, decision: "dispute", reason: policy.reason, memory };
      }

      this.append(id, "memory/accepted", {});
      if (input.pin) this.append(id, "memory/pinned", {});

      if (policy.kind === "supersede") {
        for (const oldId of policy.supersedeIds ?? []) {
          const conflictId = createConflictId();
          this.append(oldId, "memory/superseded", {
            supersededBy: id,
            reason: policy.reason,
          });
          this.project(oldId);
          this.append(id, "memory/conflict-detected", {
            conflictId,
            otherMemoryId: oldId,
            conflictType: fact?.temporal ? "temporal_update" : "direct_contradiction",
          });
          this.store.putConflict({
            id: conflictId,
            type: fact?.temporal ? "temporal_update" : "direct_contradiction",
            leftId: oldId,
            rightId: id,
            status: "resolved",
            resolution: "supersede_old",
            reason: policy.reason,
            createdAt: now,
            resolvedAt: now,
          });
        }
      }

      const memory = this.project(id);
      return { accepted: true, decision: policy.kind, reason: policy.reason, memory };
    });
  }

  public search(query: string, active: ActiveScope, limit = 12): RankedMemory[] {
    this.tick(active);
    return rankMemories(this.store.listProjections(), query, {
      active,
      now: this.clock.now(),
      limit,
    });
  }

  public recall(query: string, active: ActiveScope, budget = this.budget): RecallResult {
    this.tick(active);
    const ranked = this.search(query, active, 50);
    const budgeted = applyBudget(ranked, budget, renderRecalledMemory);
    for (const item of budgeted.selected) {
      this.append(item.record.id, "memory/recalled", {
        query,
        score: item.score.finalScore,
      });
    }
    const selected = budgeted.selected.map((item) => ({
      ...item,
      record: this.require(item.record.id),
    }));
    return {
      selected,
      dropped: budgeted.dropped,
      tokens: budgeted.tokens,
      promptBlock: renderRecallBlock(selected),
    };
  }

  public get(id: string): MemoryRecord | undefined {
    return this.store.getProjection(id);
  }

  public list(filter: {
    status?: MemoryRecord["status"];
    scope?: string;
    kind?: MemoryKind;
    includeForgotten?: boolean;
  } = {}): MemoryRecord[] {
    return this.store.listProjections().filter((record) => {
      if (!filter.includeForgotten && record.status === "forgotten") return false;
      if (filter.status && record.status !== filter.status) return false;
      if (filter.kind && record.kind !== filter.kind) return false;
      if (filter.scope && record.scope.kind !== filter.scope && record.scope.id !== filter.scope) {
        return false;
      }
      return true;
    });
  }

  public forget(spec: ForgetSpec, active: ActiveScope): ForgetResult {
    if (spec.all && !spec.confirmAll) {
      return {
        forgottenIds: [],
        notice: "Refusing to forget all memories without confirmAll=true.",
        confirmationRequired: true,
      };
    }
    return this.store.transaction(() => {
      const targets = this.resolveForgetTargets(spec, active);
      const forgottenIds: string[] = [];
      for (const record of targets) {
        if (record.status === "forgotten") continue;
        this.append(record.id, "memory/forgotten", {
          reason: "explicit_forget",
          query: spec.query,
        });
        this.append(record.id, "memory/payload-purged", {});
        this.store.deletePayload(record.id);
        const folded = foldMemoryEvents(this.store.listEvents(record.id)).get(record.id);
        if (folded) this.store.putProjection(applyForget(folded, iso(this.clock.now())));
        this.store.deleteFts(record.id);
        this.store.deleteEmbedding(record.id);
        forgottenIds.push(record.id);
      }
      return { forgottenIds, notice: FORGET_BOUNDARY_NOTICE };
    });
  }

  public pin(id: string, pinned: boolean): MemoryRecord {
    return this.store.transaction(() => {
      const record = this.require(id);
      if (record.status === "forgotten") {
        throw new Error(`Cannot pin forgotten memory ${id}`);
      }
      this.append(id, pinned ? "memory/pinned" : "memory/unpinned", {});
      return this.project(id);
    });
  }

  public conflicts(): ConflictRecord[] {
    return this.store.listConflicts();
  }

  public resolveConflict(
    conflictId: string,
    resolution: ConflictResolution,
  ): ConflictRecord {
    return this.store.transaction(() => {
      const conflict = this.store.getConflict(conflictId);
      if (!conflict) throw new Error(`Unknown conflict ${conflictId}`);
      const now = iso(this.clock.now());
      if (resolution === "remain_disputed") {
        const next = { ...conflict, status: "disputed" as const, resolution, resolvedAt: now };
        this.store.putConflict(next);
        return next;
      }
      if (resolution === "keep_a" || resolution === "supersede_old") {
        this.append(conflict.rightId, "memory/superseded", {
          supersededBy: conflict.leftId,
          reason: resolution,
        });
      } else if (resolution === "keep_b" || resolution === "mark_newer") {
        const newer = newerId(this.require(conflict.leftId), this.require(conflict.rightId));
        const older = newer === conflict.leftId ? conflict.rightId : conflict.leftId;
        this.append(older, "memory/superseded", { supersededBy: newer, reason: resolution });
        if (this.require(newer).status === "disputed") {
          this.append(newer, "memory/accepted", {});
        }
      } else if (resolution === "both_valid_by_scope") {
        this.append(conflict.leftId, "memory/accepted", {});
        this.append(conflict.rightId, "memory/accepted", {});
      } else if (resolution === "merge") {
        const left = this.require(conflict.leftId);
        const right = this.require(conflict.rightId);
        this.append(left.id, "memory/merged", {
          fromIds: [right.id],
          content: `${left.content} / ${right.content}`,
        });
        this.append(right.id, "memory/superseded", {
          supersededBy: left.id,
          reason: "merge",
        });
      }
      const next = { ...conflict, status: "resolved" as const, resolution, resolvedAt: now };
      this.store.putConflict(next);
      this.project(conflict.leftId);
      this.project(conflict.rightId);
      return next;
    });
  }

  public explain(id: string, query: string, active: ActiveScope): MemoryExplanation {
    const record = this.require(id);
    return explainMemory(record, query, active, this.clock.now());
  }

  public explainText(id: string, query: string, active: ActiveScope): string {
    return formatExplanation(this.explain(id, query, active));
  }

  public observe(text: string, active: ActiveScope, sessionId?: string): RememberResult | ForgetResult | undefined {
    const forgetQuery = detectExplicitForgetQuery(text);
    if (forgetQuery) {
      return this.forget({ query: forgetQuery }, active);
    }
    const draft = curateObservation({ text, sessionId }, active);
    if (!draft) return undefined;
    return this.remember(draft, active);
  }

  public consolidate(active: ActiveScope): MemoryRecord[] {
    return this.store.transaction(() => {
      const plans = planConsolidation(this.store.listProjections());
      const created: MemoryRecord[] = [];
      for (const plan of plans) {
        const result = this.remember(
          {
            content: plan.survivingContent,
            kind: plan.kind,
            explicit: false,
            sourceNote: `derived from ${plan.sourceIds.join(",")}`,
          },
          active,
        );
        if (!result.memory) continue;
        this.append(result.memory.id, "memory/updated", {
          kind: "semantic",
        });
        for (const sourceId of plan.sourceIds) {
          if (sourceId === result.memory.id) continue;
          this.append(sourceId, "memory/superseded", {
            supersededBy: result.memory.id,
            reason: "consolidation",
          });
          this.project(sourceId);
        }
        const events = this.store.listEvents(result.memory.id);
        const folded = foldMemoryEvents(events).get(result.memory.id);
        if (folded) {
          const derived: MemoryRecord = {
            ...folded,
            extractionType: "derived",
            derivedFrom: plan.sourceIds,
            kind: "semantic",
            scope: plan.scope,
            subject: plan.subject,
          };
          this.store.putProjection(derived);
          created.push(derived);
        }
      }
      return created;
    });
  }

  public tick(active: ActiveScope = { globalId: "user" }): void {
    this.store.transaction(() => this.tickLocked(active));
  }

  public exportMemories(): ExportDocument {
    return {
      version: 1,
      exportedAt: iso(this.clock.now()),
      memories: this.store.listProjections().filter((record) => {
        if (record.status === "forgotten") return false;
        if (record.sensitivity === "secret") return false;
        return record.payloadPresent;
      }),
      conflicts: this.store.listConflicts(),
    };
  }

  public importMemories(document: ExportDocument, active: ActiveScope): MemoryRecord[] {
    const imported: MemoryRecord[] = [];
    for (const record of document.memories) {
      if (record.sensitivity === "secret") continue;
      const result = this.remember(
        {
          content: record.content,
          kind: record.kind,
          explicit: false,
          validUntil: record.validUntil,
          sourceNote: "origin=import",
        },
        record.scope.kind === "project" || record.scope.kind === "task"
          ? { ...active, projectId: record.scope.kind === "project" ? record.scope.id : active.projectId }
          : active,
      );
      if (result.memory) imported.push(result.memory);
    }
    return imported;
  }

  public timeline(id: string): MemoryEvent[] {
    return this.store.listEvents(id);
  }

  public close(): void {
    this.store.close();
  }

  private tickLocked(_active: ActiveScope): void {
    const now = this.clock.now();
    for (const record of this.store.listProjections()) {
      if (shouldMarkExpired(record, now)) {
        this.append(record.id, "memory/expired", {});
        this.project(record.id);
      }
    }
    for (const record of this.store.listProjections()) {
      if (shouldGarbageCollect(record, now, DEFAULT_GC_POLICY) && record.payloadPresent) {
        this.append(record.id, "memory/payload-purged", { reason: "gc" });
        this.store.deletePayload(record.id);
        this.project(record.id);
      }
    }
  }

  private resolveForgetTargets(spec: ForgetSpec, active: ActiveScope): MemoryRecord[] {
    const records = this.store.listProjections();
    if (spec.all) return records.filter((record) => record.status !== "forgotten");
    if (spec.id) {
      const record = this.store.getProjection(spec.id);
      return record ? [record] : [];
    }
    if (spec.subject) {
      return records.filter(
        (record) => record.subject === spec.subject && record.status !== "forgotten",
      );
    }
    if (spec.scope) {
      const scope = resolveNamedScope(spec.scope, active);
      return records.filter(
        (record) => record.scope.kind === scope.kind && record.scope.id === scope.id && record.status !== "forgotten",
      );
    }
    if (spec.query) {
      return rankMemories(records, spec.query, {
        active,
        now: this.clock.now(),
        limit: 5,
        minScore: 0.08,
      }).map((item) => item.record);
    }
    return [];
  }

  private visibleForConflict(scope: MemoryScope): MemoryRecord[] {
    return this.store.listProjections().filter((record) => {
      if (record.status === "forgotten" || record.status === "rejected") return false;
      if (record.scope.kind !== scope.kind) return true;
      return true;
    });
  }

  private append(
    memoryId: string,
    type: MemoryEvent["type"],
    data: Record<string, unknown>,
    at = iso(this.clock.now()),
  ): MemoryEvent {
    return this.store.appendEvent({
      id: createEventId(),
      type,
      memoryId,
      at,
      data,
    });
  }

  private project(id: string): MemoryRecord {
    const events = this.store.listEvents(id);
    const folded = foldMemoryEvents(events).get(id);
    if (!folded) throw new Error(`Failed to project ${id}`);
    const decay = folded.decayPolicy.mode
      ? folded.decayPolicy
      : defaultDecayPolicy({
          explicit: folded.explicitUserMemory,
          kind: folded.kind,
          inferred: folded.extractionType === "inferred",
        });
    const record: MemoryRecord = {
      ...folded,
      decayPolicy: decay,
      retentionPolicy: folded.retentionPolicy.mode
        ? folded.retentionPolicy
        : defaultRetentionPolicy({
            explicit: folded.explicitUserMemory,
            validUntil: folded.validUntil,
          }),
    };
    this.store.putProjection(record);
    if (record.payloadPresent && record.status !== "forgotten") {
      this.store.upsertFts(id, searchableText(record));
    } else {
      this.store.deleteFts(id);
    }
    return record;
  }

  private require(id: string): MemoryRecord {
    const record = this.store.getProjection(id) ?? this.project(id);
    if (!record) throw new Error(`Unknown memory ${id}`);
    return record;
  }
}

function newerId(left: MemoryRecord, right: MemoryRecord): string {
  return left.createdAt >= right.createdAt ? left.id : right.id;
}

export function createMemoryService(options?: MemoryServiceOptions): MemoryService {
  return new MemoryService(options);
}

export function emptyActiveScope(overrides: Partial<ActiveScope> = {}): ActiveScope {
  return {
    globalId: "user",
    ...overrides,
  };
}

export { defaultGlobalScope };
