import type { MemoryRecord } from "../domain/memory.ts";
import type { ActiveScope } from "../domain/scope.ts";
import { inRecallScope, scopeMatchWeight } from "../domain/scope.ts";
import { decayMultiplier } from "../lifecycle/decay.ts";
import { isExpired } from "../lifecycle/expiration.ts";
import { isHistoricalQuery, lexicalScore } from "./tokenize.ts";

export interface ScoreBreakdown {
  memoryId: string;
  relevance: number;
  lexical: number;
  semantic: number;
  scopeWeight: number;
  confidenceWeight: number;
  freshnessWeight: number;
  importanceWeight: number;
  statusWeight: number;
  explicitBoost: number;
  pinnedBoost: number;
  confirmationWeight: number;
  accessWeight: number;
  finalScore: number;
  eligible: boolean;
  excludedReason?: string;
}

export interface ScoreOptions {
  now: Date;
  active: ActiveScope;
  semanticScore?: number;
  includeHistorical?: boolean;
}

export function statusWeight(record: MemoryRecord, historical: boolean): number {
  switch (record.status) {
    case "active":
      return 1;
    case "disputed":
      return 0.55;
    case "superseded":
      return historical ? 0.42 : 0;
    case "candidate":
      return 0.15;
    default:
      return 0;
  }
}

export function scoreMemory(
  record: MemoryRecord,
  query: string,
  options: ScoreOptions,
): ScoreBreakdown {
  const historical = options.includeHistorical ?? isHistoricalQuery(query);
  const excluded = excludeReason(record, options.active, options.now, historical);
  const lexical = lexicalScore(query, searchableText(record));
  const semantic = options.semanticScore ?? 0;
  const relevance = semantic > 0 ? lexical * 0.55 + semantic * 0.45 : lexical;
  const scopeWeight = scopeMatchWeight(record.scope, options.active);
  const confidenceWeight = 0.5 + 0.5 * record.confidence;
  const freshnessWeight = decayMultiplier(record, options.now);
  const importanceWeight = 0.4 + 0.6 * record.importance;
  const stat = statusWeight(record, historical);
  const explicitBoost = record.explicitUserMemory ? 1.12 : 1;
  const pinnedBoost = record.pinned ? 1.08 : 1;
  const confirmationWeight = 1 + Math.min(0.15, record.confirmCount * 0.03);
  const accessWeight = 1 + Math.min(0.08, Math.log1p(record.accessCount) * 0.02);
  const finalScore =
    relevance
    * scopeWeight
    * confidenceWeight
    * freshnessWeight
    * importanceWeight
    * stat
    * explicitBoost
    * pinnedBoost
    * confirmationWeight
    * accessWeight;

  return {
    memoryId: record.id,
    relevance,
    lexical,
    semantic,
    scopeWeight,
    confidenceWeight,
    freshnessWeight,
    importanceWeight,
    statusWeight: stat,
    explicitBoost,
    pinnedBoost,
    confirmationWeight,
    accessWeight,
    finalScore: excluded ? 0 : finalScore,
    eligible: !excluded,
    excludedReason: excluded,
  };
}

function excludeReason(
  record: MemoryRecord,
  active: ActiveScope,
  now: Date,
  historical: boolean,
): string | undefined {
  if (record.status === "forgotten" || !record.payloadPresent) return "forgotten";
  if (record.status === "rejected") return "rejected";
  if (record.status === "expired" || isExpired(record, now)) return "expired";
  if (record.status === "superseded" && !historical) return "superseded";
  if (!inRecallScope(record, active)) return "scope_mismatch";
  return undefined;
}

export function searchableText(record: MemoryRecord): string {
  return [record.content, record.subject, record.predicate, record.object, record.kind]
    .filter(Boolean)
    .join(" ");
}
