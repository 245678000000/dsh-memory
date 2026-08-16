import { daysBetween, parseIso } from "../clock.ts";
import type { MemoryRecord } from "../domain/memory.ts";

export function decayMultiplier(record: MemoryRecord, now: Date): number {
  if (record.pinned || record.decayPolicy.mode === "none") return 1;
  const halfLife = record.decayPolicy.halfLifeDays ?? 60;
  const floor = record.decayPolicy.minimumScore ?? 0.15;
  const anchor = record.lastConfirmedAt ?? record.createdAt;
  const age = Math.max(0, daysBetween(now, parseIso(anchor)));
  if (record.decayPolicy.mode === "confirmation") {
    const confirmedBoost = Math.min(0.2, record.confirmCount * 0.04);
    const raw = Math.pow(2, -age / Math.max(1, halfLife)) + confirmedBoost;
    return clamp(raw, floor, 1);
  }
  if (record.decayPolicy.mode === "access") {
    const accessBoost = Math.min(0.08, Math.log1p(record.accessCount) * 0.02);
    return clamp(Math.pow(2, -age / Math.max(1, halfLife)) + accessBoost, floor, 1);
  }
  return clamp(Math.pow(2, -age / Math.max(1, halfLife)), floor, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
