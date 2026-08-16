import type { MemoryKind } from "./domain/memory.ts";

export interface RememberInput {
  content: string;
  scope?: string;
  kind?: MemoryKind;
  explicit?: boolean;
  pin?: boolean;
  validUntil?: string;
  sessionId?: string;
  sourceNote?: string;
  structuredValue?: unknown;
}
