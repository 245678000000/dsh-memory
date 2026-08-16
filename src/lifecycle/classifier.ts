import type { MemoryKind } from "../domain/memory.ts";
import { extractFact } from "./extract.ts";

export interface Classification {
  kind: MemoryKind;
  subject?: string;
  predicate?: string;
  object?: string;
  confidence: number;
}

export function classifyMemory(
  content: string,
  options: { explicit?: boolean; requestedKind?: MemoryKind } = {},
): Classification {
  if (options.requestedKind) {
    const fact = extractFact(content);
    return {
      kind: options.requestedKind,
      subject: fact?.subject,
      predicate: fact?.predicate,
      object: fact?.canonicalObject ?? fact?.object,
      confidence: options.explicit ? 0.93 : 0.8,
    };
  }

  const lower = content.toLowerCase();
  const fact = extractFact(content);

  if (/\b(actually|correction|was wrong|not .+, .+ is)\b/.test(lower) || fact?.correction) {
    return finish("correction", fact, options.explicit ? 0.94 : 0.78);
  }
  if (/\b(must|cannot|can't|do not|don't|required|constraint|never)\b/.test(lower)) {
    return finish("constraint", fact, 0.82);
  }
  if (/\b(we decided|decision|chose to|going with)\b/.test(lower)) {
    return finish("decision", fact, 0.8);
  }
  if (/\b(before (release|deploy)|procedure|run .+ then|workflow|checklist)\b/.test(lower)) {
    return finish("procedure", fact, 0.8);
  }
  if (/\b(this project|this repo|this repository|this codebase)\b/.test(lower) || fact?.subject === "package_manager" && /\bproject\b/.test(lower)) {
    return finish("project_fact", fact, 0.86);
  }
  if (/\b(prefer|preferred|likes?|please (be|keep)|concise|verbose)\b/.test(lower)) {
    return finish("preference", fact, 0.88);
  }
  if (/\b(related to|depends on|owns|reports to)\b/.test(lower)) {
    return finish("relationship", fact, 0.7);
  }
  if (/\b(on \w+ \d+|yesterday|last week|we discussed|we talked)\b/.test(lower)) {
    return finish("episodic", fact, 0.68);
  }
  if (fact?.subject === "package_manager" || fact?.subject === "database" || fact?.subject === "runtime") {
    return finish("project_fact", fact, 0.8);
  }
  if (fact?.subject === "editor") {
    return finish("preference", fact, 0.86);
  }
  if (options.explicit) {
    return finish("semantic", fact, 0.84);
  }
  return finish("semantic", fact, 0.62);
}

function finish(
  kind: MemoryKind,
  fact: ReturnType<typeof extractFact>,
  confidence: number,
): Classification {
  return {
    kind,
    subject: fact?.subject,
    predicate: fact?.predicate,
    object: fact?.canonicalObject ?? fact?.object,
    confidence,
  };
}

export function looksLikeGuess(content: string): boolean {
  return /\b(probably|maybe|might|i (guess|assume|think they)|perhaps)\b/i.test(content);
}
