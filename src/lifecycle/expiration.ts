import { parseIso } from "../clock.ts";
import type { MemoryRecord } from "../domain/memory.ts";

export function isExpired(record: MemoryRecord, now: Date): boolean {
  if (!record.validUntil) return false;
  return parseIso(record.validUntil).getTime() <= now.getTime();
}

export function shouldMarkExpired(record: MemoryRecord, now: Date): boolean {
  if (record.status === "forgotten" || record.status === "expired" || record.status === "rejected") {
    return false;
  }
  return isExpired(record, now);
}
