import type { MemoryRecord } from "../domain/memory.ts";
import type { ActiveScope } from "../domain/scope.ts";
import { describeScope } from "../domain/scope.ts";
import { scoreMemory, type ScoreBreakdown } from "./scorer.ts";

export interface MemoryExplanation {
  memoryId: string;
  contentPreview: string;
  recalled: boolean;
  reason: string;
  scope: string;
  status: MemoryRecord["status"];
  confidence: number;
  importance: number;
  lastConfirmedAt?: string;
  conflictStatus: string;
  score: ScoreBreakdown;
}

export function explainMemory(
  record: MemoryRecord,
  query: string,
  active: ActiveScope,
  now: Date,
): MemoryExplanation {
  const score = scoreMemory(record, query, { active, now });
  const conflictStatus = record.conflictsWith.length > 0 || record.status === "disputed"
    ? record.status === "disputed" ? "DISPUTED" : `conflicts:${record.conflictsWith.join(",")}`
    : "NONE";
  return {
    memoryId: record.id,
    contentPreview: record.content.slice(0, 240),
    recalled: score.eligible && score.finalScore > 0.02,
    reason: score.excludedReason ?? "selected_by_composite_score",
    scope: describeScope(record.scope),
    status: record.status,
    confidence: record.confidence,
    importance: record.importance,
    lastConfirmedAt: record.lastConfirmedAt,
    conflictStatus,
    score,
  };
}

export function formatExplanation(explanation: MemoryExplanation): string {
  const lines = [
    explanation.memoryId,
    explanation.contentPreview,
    "",
    explanation.recalled ? "Recalled because:" : "Not recalled because:",
    `reason: ${explanation.reason}`,
    `scope: ${explanation.scope}`,
    `status: ${explanation.status}`,
    `confidence: ${explanation.confidence.toFixed(2)}`,
    `importance: ${explanation.importance.toFixed(2)}`,
    `last confirmed: ${explanation.lastConfirmedAt ?? "never"}`,
    `conflict status: ${explanation.conflictStatus}`,
    `lexical: ${explanation.score.lexical.toFixed(3)}`,
    `semantic: ${explanation.score.semantic.toFixed(3)}`,
    `scopeWeight: ${explanation.score.scopeWeight.toFixed(3)}`,
    `freshnessWeight: ${explanation.score.freshnessWeight.toFixed(3)}`,
    `statusWeight: ${explanation.score.statusWeight.toFixed(3)}`,
    `Final recall score: ${explanation.score.finalScore.toFixed(3)}`,
  ];
  return lines.join("\n");
}
