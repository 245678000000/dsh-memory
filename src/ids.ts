import { randomBytes } from "node:crypto";

function token(bytes = 3): string {
  return randomBytes(bytes).toString("hex").toUpperCase();
}

export function createMemoryId(): string {
  return `M-${token(3)}`;
}

export function createEventId(): string {
  return `E-${token(4)}`;
}

export function createConflictId(): string {
  return `C-${token(3)}`;
}
