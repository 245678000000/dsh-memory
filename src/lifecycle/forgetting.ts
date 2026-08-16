import { FORGOTTEN_PLACEHOLDER, type MemoryRecord } from "../domain/memory.ts";

export function applyForget(record: MemoryRecord, at: string): MemoryRecord {
  return {
    ...record,
    status: "forgotten",
    content: FORGOTTEN_PLACEHOLDER,
    structuredValue: undefined,
    subject: undefined,
    predicate: undefined,
    object: undefined,
    payloadPresent: false,
    pinned: false,
    updatedAt: at,
  };
}

export function forgottenNotRecalled(record: MemoryRecord): boolean {
  return record.status === "forgotten" || !record.payloadPresent;
}
