export type ConflictType =
  | "direct_contradiction"
  | "temporal_update"
  | "scope_difference"
  | "uncertain_conflict"
  | "duplicate"
  | "refinement";

export type ConflictResolution =
  | "keep_a"
  | "keep_b"
  | "both_valid_by_scope"
  | "mark_newer"
  | "merge"
  | "remain_disputed"
  | "supersede_old";

export type ConflictStatus = "open" | "resolved" | "disputed";

export interface ConflictRecord {
  id: string;
  type: ConflictType;
  leftId: string;
  rightId: string;
  status: ConflictStatus;
  resolution?: ConflictResolution;
  reason: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ConflictVerdict {
  type: ConflictType;
  otherId: string;
  reason: string;
  auto:
    | { action: "ignore" }
    | { action: "duplicate"; keepId: string }
    | { action: "merge"; survivingId: string; absorbedId: string; content: string }
    | { action: "supersede"; oldId: string; reason: string }
    | { action: "dispute"; reason: string };
}
