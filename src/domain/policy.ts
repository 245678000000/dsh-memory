import type { MemoryEligibility } from "../lifecycle/eligibility.ts";
import type { ConflictVerdict } from "./conflict.ts";
import type { MemoryRecord, Sensitivity } from "./memory.ts";

export type PolicyDecisionKind = "store" | "merge" | "reject" | "dispute" | "supersede";

export interface PolicyDecision {
  kind: PolicyDecisionKind;
  reason: string;
  mergeIntoId?: string;
  supersedeIds?: string[];
  disputeWithIds?: string[];
  mergedContent?: string;
}

export interface RememberPolicyInput {
  explicit: boolean;
  sensitivity: Sensitivity;
  eligibility: MemoryEligibility;
  conflicts: ConflictVerdict[];
  duplicateOf?: MemoryRecord;
}

export function decideRememberPolicy(input: RememberPolicyInput): PolicyDecision {
  if (input.sensitivity === "secret") {
    return { kind: "reject", reason: "secret_content_rejected" };
  }
  if (!input.explicit && input.sensitivity === "sensitive") {
    return { kind: "reject", reason: "sensitive_content_requires_explicit_remember" };
  }
  if (!input.explicit && !input.eligibility.eligible) {
    return { kind: "reject", reason: input.eligibility.reason };
  }

  const duplicate = input.conflicts.find((item) => item.type === "duplicate");
  if (duplicate && duplicate.auto.action === "duplicate") {
    return {
      kind: "merge",
      reason: "duplicate_observation",
      mergeIntoId: duplicate.auto.keepId,
    };
  }

  const merge = input.conflicts.find((item) => item.auto.action === "merge");
  if (merge && merge.auto.action === "merge") {
    return {
      kind: "merge",
      reason: merge.reason,
      mergeIntoId: merge.auto.survivingId,
      mergedContent: merge.auto.content,
    };
  }

  const supersede = input.conflicts.filter((item) => item.auto.action === "supersede");
  if (supersede.length > 0) {
    return {
      kind: "supersede",
      reason: supersede.map((item) => item.reason).join("; "),
      supersedeIds: supersede.flatMap((item) =>
        item.auto.action === "supersede" ? [item.auto.oldId] : [],
      ),
    };
  }

  const disputes = input.conflicts.filter((item) => item.auto.action === "dispute");
  if (disputes.length > 0) {
    return {
      kind: "dispute",
      reason: disputes.map((item) => item.reason).join("; "),
      disputeWithIds: disputes.map((item) => item.otherId),
    };
  }

  return { kind: "store", reason: input.explicit ? "explicit_user_memory" : "eligible_observation" };
}
