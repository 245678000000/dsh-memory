import type { MemoryRecord } from "../domain/memory.ts";
import type { ActiveScope } from "../domain/scope.ts";
import { scoreMemory, type ScoreBreakdown, type ScoreOptions } from "./scorer.ts";
import { isHistoricalQuery } from "./tokenize.ts";

export interface RankedMemory {
  record: MemoryRecord;
  score: ScoreBreakdown;
}

export interface SearchOptions extends Omit<ScoreOptions, "includeHistorical"> {
  includeHistorical?: boolean;
  minScore?: number;
  limit?: number;
  includeIneligible?: boolean;
}

export function rankMemories(
  records: readonly MemoryRecord[],
  query: string,
  options: SearchOptions,
): RankedMemory[] {
  const historical = options.includeHistorical ?? isHistoricalQuery(query);
  const ranked = records.map((record) => ({
    record,
    score: scoreMemory(record, query, { ...options, includeHistorical: historical }),
  }));
  ranked.sort((a, b) => b.score.finalScore - a.score.finalScore);
  const filtered = options.includeIneligible
    ? ranked
    : ranked.filter((item) => item.score.eligible && item.score.finalScore > (options.minScore ?? 0.02));
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}

export function findById(
  records: readonly MemoryRecord[],
  id: string,
): MemoryRecord | undefined {
  return records.find((record) => record.id === id);
}

export function currentFactsPreferSpecific(
  ranked: readonly RankedMemory[],
  active: ActiveScope,
): RankedMemory[] {
  const seen = new Set<string>();
  const result: RankedMemory[] = [];
  for (const item of ranked) {
    const key = item.record.subject ?? item.record.id;
    if (item.record.subject && seen.has(key)) {
      if (item.record.scope.kind === "global" && active.projectId) continue;
    }
    if (item.record.subject) seen.add(key);
    result.push(item);
  }
  return result;
}
