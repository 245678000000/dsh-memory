import type { ActiveScope } from "../domain/scope.ts";
import { inferScopeFromText } from "../domain/scope.ts";
import { classifyMemory, looksLikeGuess } from "../lifecycle/classifier.ts";
import { evaluateEligibility } from "../lifecycle/eligibility.ts";
import { extractFact } from "../lifecycle/extract.ts";
import { inspectSensitivity } from "../lifecycle/sensitivity.ts";
import type { RememberInput } from "../types.ts";

export interface Observation {
  text: string;
  sessionId?: string;
  sourceEventId?: string;
  explicitHint?: boolean;
}

export function curateObservation(
  observation: Observation,
  active: ActiveScope,
): RememberInput | undefined {
  const text = observation.text.trim();
  if (!text) return undefined;

  const forgetMatch = text.match(/^\s*forget(?:\s+that)?\s+(.+)$/i);
  if (forgetMatch) return undefined;

  const rememberMatch = text.match(/^\s*remember(?:\s+that)?\s*:?\s*(.+)$/i);
  const explicit = Boolean(observation.explicitHint || rememberMatch);
  const content = (rememberMatch?.[1] ?? text).trim();
  const sensitivity = inspectSensitivity(content);
  if (sensitivity.reject) return undefined;
  if (looksLikeGuess(content) && !explicit) return undefined;

  const eligibility = evaluateEligibility(content, {
    explicit,
    sensitive: sensitivity.sensitivity === "sensitive" || sensitivity.sensitivity === "secret",
  });
  if (!eligibility.eligible) return undefined;

  const classification = classifyMemory(content, { explicit });
  const fact = extractFact(content);
  const scope = inferScopeFromText(content, active);

  return {
    content,
    scope: scope.kind,
    kind: classification.kind,
    explicit,
    sourceNote: explicit ? "curator:explicit-phrase" : "curator:eligible-observation",
    sessionId: observation.sessionId,
  };
}

export function detectExplicitForgetQuery(text: string): string | undefined {
  const match = text.match(/^\s*forget(?:\s+that)?\s+(.+)$/i);
  return match?.[1]?.trim();
}

export function detectCorrection(text: string): boolean {
  return Boolean(extractFact(text)?.correction) || /\b(switched|no longer|not anymore)\b/i.test(text);
}
