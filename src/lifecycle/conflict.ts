import type { ConflictVerdict } from "../domain/conflict.ts";
import type { MemoryRecord } from "../domain/memory.ts";
import { memoryPrimarySource, sourceAuthority } from "../domain/memory.ts";
import { sameScope } from "../domain/scope.ts";
import { exclusivePeers, isRefinement, mutuallyExclusive } from "./extract.ts";

export interface IncomingFact {
  content: string;
  subject?: string;
  predicate?: string;
  object?: string;
  sourceAuthority: number;
  explicit: boolean;
  temporal: boolean;
  correction: boolean;
  createdAt: string;
}

export function detectConflicts(
  incoming: IncomingFact,
  existing: readonly MemoryRecord[],
): ConflictVerdict[] {
  const verdicts: ConflictVerdict[] = [];
  for (const record of existing) {
    if (record.status === "forgotten" || record.status === "rejected" || record.status === "expired") {
      continue;
    }
    if (record.status === "superseded") continue;
    const verdict = compareOne(incoming, record);
    if (verdict) verdicts.push(verdict);
  }
  return verdicts;
}

function compareOne(incoming: IncomingFact, existing: MemoryRecord): ConflictVerdict | undefined {
  const sameSubject = Boolean(
    incoming.subject
    && existing.subject
    && incoming.subject === existing.subject,
  );
  const similarText = lexicalOverlap(incoming.content, existing.content) >= 0.72;
  const incomingObject = incoming.object?.toLowerCase();
  const existingObject = existing.object?.toLowerCase();
  const sameObject = Boolean(incomingObject && existingObject && incomingObject === existingObject);
  const relatedObjects = Boolean(
    incomingObject
    && existingObject
    && (incomingObject === existingObject
      || mutuallyExclusive(incomingObject, existingObject)
      || exclusivePeers(incomingObject).includes(existingObject)
      || isRefinement(existingObject, incomingObject)
      || isRefinement(existing.content, incoming.content)),
  );

  if (!sameSubject && !similarText && !relatedObjects) return undefined;

  if ((sameSubject || similarText) && (sameObject || nearlyIdentical(incoming.content, existing.content))) {
    return {
      type: "duplicate",
      otherId: existing.id,
      reason: "same_subject_and_value",
      auto: { action: "duplicate", keepId: existing.id },
    };
  }

  if (!sameScope(incomingScope(existing), existing.scope) && sameSubject && incomingObject && existingObject && incomingObject !== existingObject) {
    return {
      type: "scope_difference",
      otherId: existing.id,
      reason: "same_subject_different_scope",
      auto: { action: "ignore" },
    };
  }

  if (
    (sameSubject || similarText)
    && incomingObject
    && existingObject
    && incomingObject !== existingObject
    && isRefinement(existing.content, incoming.content)
    && !mutuallyExclusive(incomingObject, existingObject)
  ) {
    return {
      type: "refinement",
      otherId: existing.id,
      reason: "more_specific_value",
      auto: {
        action: "merge",
        survivingId: existing.id,
        absorbedId: existing.id,
        content: incoming.content,
      },
    };
  }

  const contradictory = Boolean(
    incomingObject
    && existingObject
    && incomingObject !== existingObject
    && (mutuallyExclusive(incomingObject, existingObject) || (sameSubject && !isRefinement(existing.content, incoming.content))),
  );

  if (!contradictory) return undefined;

  if (!sameScope(incomingScope(existing), existing.scope)) {
    return {
      type: "scope_difference",
      otherId: existing.id,
      reason: "contradictory_values_in_different_scopes",
      auto: { action: "ignore" },
    };
  }

  if (incoming.temporal || incoming.correction) {
    return {
      type: incoming.correction ? "direct_contradiction" : "temporal_update",
      otherId: existing.id,
      reason: incoming.correction ? "explicit_correction" : "temporal_update",
      auto: { action: "supersede", oldId: existing.id, reason: incoming.correction ? "user_correction" : "temporal_update" },
    };
  }

  const incomingAuth = incoming.sourceAuthority;
  const existingAuth = sourceAuthority(memoryPrimarySource(existing));
  if (incomingAuth >= existingAuth + 15) {
    return {
      type: "direct_contradiction",
      otherId: existing.id,
      reason: "higher_authority_source",
      auto: { action: "supersede", oldId: existing.id, reason: "higher_authority_source" },
    };
  }
  if (existingAuth >= incomingAuth + 15 && !incoming.explicit) {
    return {
      type: "direct_contradiction",
      otherId: existing.id,
      reason: "existing_source_more_authoritative",
      auto: { action: "ignore" },
    };
  }

  if (incoming.explicit && existing.explicitUserMemory && incomingAuth === existingAuth) {
    return {
      type: "uncertain_conflict",
      otherId: existing.id,
      reason: "equal_authority_unresolved",
      auto: { action: "dispute", reason: "equal_authority_unresolved" },
    };
  }

  if (incoming.explicit && !existing.explicitUserMemory) {
    return {
      type: "direct_contradiction",
      otherId: existing.id,
      reason: "explicit_statement_overrides_inference",
      auto: { action: "supersede", oldId: existing.id, reason: "explicit_overrides_inference" },
    };
  }

  return {
    type: "uncertain_conflict",
    otherId: existing.id,
    reason: "unable_to_decide",
    auto: { action: "dispute", reason: "unable_to_decide" },
  };
}

function incomingScope(existing: MemoryRecord): MemoryRecord["scope"] {
  return existing.scope;
}

/**
 * compareOne uses existing.scope for both sides when the incoming fact's scope
 * is not threaded. The public API below is the one callers should use.
 */
export function detectConflictsForScope(
  incoming: IncomingFact & { scope: MemoryRecord["scope"] },
  existing: readonly MemoryRecord[],
): ConflictVerdict[] {
  const verdicts: ConflictVerdict[] = [];
  for (const record of existing) {
    if (record.status === "forgotten" || record.status === "rejected" || record.status === "expired") {
      continue;
    }
    if (record.status === "superseded") continue;
    const verdict = compareWithScope(incoming, record);
    if (verdict) verdicts.push(verdict);
  }
  return verdicts;
}

function compareWithScope(
  incoming: IncomingFact & { scope: MemoryRecord["scope"] },
  existing: MemoryRecord,
): ConflictVerdict | undefined {
  const scopedIncoming: IncomingFact = incoming;
  const sameSubject = Boolean(
    incoming.subject
    && existing.subject
    && incoming.subject === existing.subject,
  );
  const similarText = lexicalOverlap(incoming.content, existing.content) >= 0.72;
  const incomingObject = incoming.object?.toLowerCase();
  const existingObject = existing.object?.toLowerCase();
  const sameObject = Boolean(incomingObject && existingObject && incomingObject === existingObject);

  if (!sameSubject && !similarText && !(incomingObject && existingObject && exclusiveRelated(incomingObject, existingObject))) {
    return undefined;
  }

  if ((sameSubject || similarText) && (sameObject || nearlyIdentical(incoming.content, existing.content))) {
    return {
      type: "duplicate",
      otherId: existing.id,
      reason: "same_subject_and_value",
      auto: { action: "duplicate", keepId: existing.id },
    };
  }

  if (!sameScope(incoming.scope, existing.scope)) {
    if (sameSubject && incomingObject && existingObject && incomingObject !== existingObject) {
      return {
        type: "scope_difference",
        otherId: existing.id,
        reason: "same_subject_different_scope",
        auto: { action: "ignore" },
      };
    }
    return undefined;
  }

  if (
    (sameSubject || similarText)
    && incomingObject
    && existingObject
    && incomingObject !== existingObject
    && isRefinement(existing.content, incoming.content)
    && !mutuallyExclusive(incomingObject, existingObject)
  ) {
    return {
      type: "refinement",
      otherId: existing.id,
      reason: "more_specific_value",
      auto: {
        action: "merge",
        survivingId: existing.id,
        absorbedId: existing.id,
        content: incoming.content,
      },
    };
  }

  const contradictory = Boolean(
    incomingObject
    && existingObject
    && incomingObject !== existingObject
    && (mutuallyExclusive(incomingObject, existingObject)
      || (sameSubject && !isRefinement(existing.content, incoming.content))),
  );

  if (!contradictory && similarText && incomingObject && existingObject && incomingObject !== existingObject) {
    return {
      type: "uncertain_conflict",
      otherId: existing.id,
      reason: "similar_memories_different_values",
      auto: { action: "dispute", reason: "similar_memories_different_values" },
    };
  }

  if (!contradictory) return undefined;

  if (incoming.temporal || incoming.correction) {
    return {
      type: incoming.correction && !incoming.temporal ? "direct_contradiction" : "temporal_update",
      otherId: existing.id,
      reason: incoming.correction ? "explicit_correction" : "temporal_update",
      auto: {
        action: "supersede",
        oldId: existing.id,
        reason: incoming.correction ? "user_correction" : "temporal_update",
      },
    };
  }

  const incomingAuth = scopedIncoming.sourceAuthority;
  const existingAuth = sourceAuthority(memoryPrimarySource(existing));
  if (incomingAuth >= existingAuth + 15) {
    return {
      type: "direct_contradiction",
      otherId: existing.id,
      reason: "higher_authority_source",
      auto: { action: "supersede", oldId: existing.id, reason: "higher_authority_source" },
    };
  }
  if (existingAuth >= incomingAuth + 15 && !incoming.explicit) {
    return {
      type: "direct_contradiction",
      otherId: existing.id,
      reason: "existing_source_more_authoritative",
      auto: { action: "ignore" },
    };
  }
  if (incoming.explicit && !existing.explicitUserMemory) {
    return {
      type: "direct_contradiction",
      otherId: existing.id,
      reason: "explicit_statement_overrides_inference",
      auto: { action: "supersede", oldId: existing.id, reason: "explicit_overrides_inference" },
    };
  }
  return {
    type: "uncertain_conflict",
    otherId: existing.id,
    reason: "equal_or_unclear_authority",
    auto: { action: "dispute", reason: "equal_or_unclear_authority" },
  };
}

function exclusiveRelated(a: string, b: string): boolean {
  return mutuallyExclusive(a, b) || exclusivePeers(a).includes(b);
}

function nearlyIdentical(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b) || lexicalOverlap(a, b) >= 0.92;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function lexicalOverlap(a: string, b: string): number {
  const left = new Set(normalizeText(a).split(" ").filter(Boolean));
  const right = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let inter = 0;
  for (const token of left) {
    if (right.has(token)) inter += 1;
  }
  return inter / Math.max(left.size, right.size);
}
