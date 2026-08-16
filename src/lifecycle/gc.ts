import { daysBetween, parseIso } from "../clock.ts";
import type { MemoryRecord } from "../domain/memory.ts";

export interface GcPolicy {
  unusedDays: number;
  maxImportance: number;
}

export const DEFAULT_GC_POLICY: GcPolicy = {
  unusedDays: 30,
  maxImportance: 0.35,
};

export function shouldGarbageCollect(
  record: MemoryRecord,
  now: Date,
  policy: GcPolicy = DEFAULT_GC_POLICY,
): boolean {
  if (record.pinned) return false;
  if (record.explicitUserMemory) return false;
  if (record.status !== "expired" && record.status !== "rejected") return false;
  if (record.importance > policy.maxImportance) return false;
  const lastTouch = record.lastAccessedAt ?? record.updatedAt ?? record.createdAt;
  return daysBetween(now, parseIso(lastTouch)) >= policy.unusedDays;
}
