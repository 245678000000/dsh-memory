import { estimateTokens } from "./tokenize.ts";
import type { RankedMemory } from "./search.ts";

export interface Budget {
  maxMemories: number;
  maxTokens: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxMemories: 8,
  maxTokens: 800,
};

export function applyBudget(
  ranked: readonly RankedMemory[],
  budget: Budget,
  render: (item: RankedMemory) => string,
): { selected: RankedMemory[]; dropped: RankedMemory[]; tokens: number } {
  const selected: RankedMemory[] = [];
  const dropped: RankedMemory[] = [];
  let tokens = 0;
  for (const item of ranked) {
    if (selected.length >= budget.maxMemories) {
      dropped.push({
        ...item,
        score: {
          ...item.score,
          eligible: false,
          excludedReason: item.score.excludedReason ?? "below_context_budget_cutoff",
        },
      });
      continue;
    }
    const cost = estimateTokens(render(item));
    if (selected.length > 0 && tokens + cost > budget.maxTokens) {
      dropped.push({
        ...item,
        score: {
          ...item.score,
          eligible: false,
          excludedReason: item.score.excludedReason ?? "below_context_budget_cutoff",
        },
      });
      continue;
    }
    selected.push(item);
    tokens += cost;
  }
  return { selected, dropped, tokens };
}
