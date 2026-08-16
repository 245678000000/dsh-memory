export { foldMemoryEvents } from "./domain/fold.ts";
export type {
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MemoryStatus,
  Sensitivity,
  DecayPolicy,
  RetentionPolicy,
} from "./domain/memory.ts";
export type { MemoryEvent, MemoryEventType } from "./domain/event.ts";
export type { ConflictRecord, ConflictType, ConflictResolution } from "./domain/conflict.ts";
export {
  activeScopeFromPaths,
  defaultGlobalScope,
  inRecallScope,
  scopeMatchWeight,
  type ActiveScope,
} from "./domain/scope.ts";
export { evaluateEligibility } from "./lifecycle/eligibility.ts";
export { inspectSensitivity } from "./lifecycle/sensitivity.ts";
export { classifyMemory } from "./lifecycle/classifier.ts";
export { detectConflictsForScope } from "./lifecycle/conflict.ts";
export { decayMultiplier } from "./lifecycle/decay.ts";
export { isExpired } from "./lifecycle/expiration.ts";
export { shouldGarbageCollect } from "./lifecycle/gc.ts";
export { scoreMemory } from "./retrieval/scorer.ts";
export { rankMemories } from "./retrieval/search.ts";
export { applyBudget, DEFAULT_BUDGET } from "./retrieval/budget.ts";
export { explainMemory, formatExplanation } from "./retrieval/explain.ts";
export { MemoryService, createMemoryService, emptyActiveScope } from "./service.ts";
export type {
  RememberResult,
  ForgetResult,
  RecallResult,
  ExportDocument,
} from "./service.ts";
export type { RememberInput } from "./types.ts";
export { InMemoryMemoryStore } from "./storage/memory-store.ts";
export { SqliteMemoryStore, openStore } from "./storage/sqlite.ts";
export { MEMORY_POLICY_SECTION, renderRecallBlock, FORGET_BOUNDARY_NOTICE } from "./render.ts";
export { curateObservation } from "./agents/curator.ts";
export { planConsolidation } from "./agents/consolidator.ts";
