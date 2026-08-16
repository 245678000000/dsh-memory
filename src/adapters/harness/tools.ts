import type { ActiveScope } from "../../domain/scope.ts";
import type { MemoryKind, MemoryRecord, MemoryStatus } from "../../domain/memory.ts";
import { MEMORY_KINDS } from "../../domain/memory.ts";
import { formatExplanation } from "../../retrieval/explain.ts";
import { FORGET_BOUNDARY_NOTICE } from "../../render.ts";
import type { MemoryService } from "../../service.ts";
import type { ConflictResolution } from "../../domain/conflict.ts";
import type { PluginContext } from "./plugin.ts";

const KINDS = new Set<string>(MEMORY_KINDS);
const RESOLUTIONS = new Set<string>([
  "keep_a",
  "keep_b",
  "both_valid_by_scope",
  "mark_newer",
  "merge",
  "remain_disputed",
  "supersede_old",
]);

export function registerMemoryTools(
  ctx: PluginContext,
  service: MemoryService,
  active: () => ActiveScope,
): void {
  if (!ctx.tools) return;

  register(ctx, {
    name: "memory_remember",
    description:
      "Store a durable memory after policy checks. Use when the user asks to remember something, or when a reusable project/user fact should persist across sessions. Secrets are rejected.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["content"],
      properties: {
        content: { type: "string", description: "The fact to remember." },
        scope: {
          type: "string",
          description: "global | workspace | project | task | session",
        },
        kind: { type: "string", description: `One of ${MEMORY_KINDS.join(", ")}` },
        pin: { type: "boolean" },
        validUntil: { type: "string", description: "ISO-8601 expiration." },
        explicit: { type: "boolean", description: "True when the user asked to remember this." },
      },
    },
    async execute(args) {
      const content = String(args.content ?? "");
      const kind = parseKind(args.kind);
      const result = service.remember(
        {
          content,
          scope: optionalString(args.scope),
          kind,
          pin: args.pin === true,
          validUntil: optionalString(args.validUntil),
          explicit: args.explicit !== false,
          sourceNote: "tool:memory_remember",
        },
        active(),
      );
      return {
        accepted: result.accepted,
        decision: result.decision,
        reason: result.reason,
        id: result.memory?.id,
        status: result.memory?.status,
        scope: result.memory?.scope,
        rejectedAsSecret: result.rejectedAsSecret ?? false,
      };
    },
  });

  register(ctx, {
    name: "memory_search",
    description: "Search stored memories with explainable scores. Forgotten and expired memories are omitted.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
    },
    async execute(args) {
      const query = String(args.query ?? "");
      const limit = typeof args.limit === "number" ? args.limit : 8;
      const hits = service.search(query, active(), limit);
      return {
        matches: hits.map((hit) => ({
          id: hit.record.id,
          content: hit.record.content,
          scope: hit.record.scope,
          status: hit.record.status,
          score: Number(hit.score.finalScore.toFixed(4)),
          why: hit.score.excludedReason ?? "composite_score",
        })),
      };
    },
  });

  register(ctx, {
    name: "memory_get",
    description: "Fetch one memory by id, including status and lineage metadata.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "string" } },
    },
    async execute(args) {
      const record = service.get(String(args.id ?? ""));
      if (!record) return { found: false };
      return { found: true, memory: publicMemory(record) };
    },
  });

  register(ctx, {
    name: "memory_forget",
    description:
      "Forget memories by id, query, subject, or scope. This stops recall immediately and deletes the stored payload. It does not erase Harness session history. Forgetting everything requires confirmAll=true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        query: { type: "string" },
        subject: { type: "string" },
        scope: { type: "string" },
        all: { type: "boolean" },
        confirmAll: { type: "boolean" },
      },
    },
    async execute(args) {
      const result = service.forget(
        {
          id: optionalString(args.id),
          query: optionalString(args.query),
          subject: optionalString(args.subject),
          scope: optionalString(args.scope),
          all: args.all === true,
          confirmAll: args.confirmAll === true,
        },
        active(),
      );
      return { ...result, notice: FORGET_BOUNDARY_NOTICE };
    },
  });

  register(ctx, {
    name: "memory_pin",
    description: "Pin a memory so it skips automatic decay and garbage collection. Explicit forget still works.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "string" } },
    },
    async execute(args) {
      const record = service.pin(String(args.id ?? ""), true);
      return { id: record.id, pinned: record.pinned };
    },
  });

  register(ctx, {
    name: "memory_unpin",
    description: "Remove the pin from a memory.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "string" } },
    },
    async execute(args) {
      const record = service.pin(String(args.id ?? ""), false);
      return { id: record.id, pinned: record.pinned };
    },
  });

  register(ctx, {
    name: "memory_conflicts",
    description: "List detected memory conflicts, including unresolved disputes.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async execute() {
      return {
        conflicts: service.conflicts().map((conflict) => ({
          id: conflict.id,
          type: conflict.type,
          left: conflict.leftId,
          right: conflict.rightId,
          status: conflict.status,
          resolution: conflict.resolution,
          reason: conflict.reason,
        })),
      };
    },
  });

  register(ctx, {
    name: "memory_resolve_conflict",
    description:
      "Resolve a conflict without silently deleting history. Options: keep_a, keep_b, both_valid_by_scope, mark_newer, merge, remain_disputed, supersede_old.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["conflictId", "resolution"],
      properties: {
        conflictId: { type: "string" },
        resolution: { type: "string" },
      },
    },
    async execute(args) {
      const resolution = String(args.resolution ?? "");
      if (!RESOLUTIONS.has(resolution)) {
        return { error: `unsupported resolution: ${resolution}` };
      }
      const conflict = service.resolveConflict(
        String(args.conflictId ?? ""),
        resolution as ConflictResolution,
      );
      return conflict;
    },
  });

  register(ctx, {
    name: "memory_explain",
    description: "Explain why a memory would or would not be recalled for a query.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" },
        query: { type: "string" },
      },
    },
    async execute(args) {
      const id = String(args.id ?? "");
      const query = optionalString(args.query) ?? "";
      const explanation = service.explain(id, query, active());
      return { ...explanation, text: formatExplanation(explanation) };
    },
  });

  register(ctx, {
    name: "memory_list",
    description: "List memories by status, scope, or kind. Forgotten items are hidden unless includeForgotten is true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        scope: { type: "string" },
        kind: { type: "string" },
        includeForgotten: { type: "boolean" },
      },
    },
    async execute(args) {
      const records = service.list({
        status: parseStatus(args.status),
        scope: optionalString(args.scope),
        kind: parseKind(args.kind),
        includeForgotten: args.includeForgotten === true,
      });
      return { memories: records.map(publicMemory) };
    },
  });
}

function publicMemory(record: MemoryRecord) {
  return {
    id: record.id,
    content: record.content,
    kind: record.kind,
    scope: record.scope,
    status: record.status,
    confidence: record.confidence,
    importance: record.importance,
    pinned: record.pinned,
    explicit: record.explicitUserMemory,
    subject: record.subject,
    object: record.object,
    supersedes: record.supersedes,
    supersededBy: record.supersededBy,
    conflictsWith: record.conflictsWith,
    derivedFrom: record.derivedFrom,
    createdAt: record.createdAt,
    validUntil: record.validUntil,
  };
}

interface ToolDraft {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

function register(ctx: PluginContext, draft: ToolDraft): void {
  ctx.tools?.register({
    name: draft.name,
    description: draft.description,
    parameters: draft.parameters,
    output: {
      schema: { type: "object" },
      render: (_args: unknown, value: unknown) => [
        { type: "text", text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args: Record<string, unknown>) {
      return draft.execute(args ?? {});
    },
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseKind(value: unknown): MemoryKind | undefined {
  if (typeof value !== "string") return undefined;
  return KINDS.has(value) ? (value as MemoryKind) : undefined;
}

const STATUSES = new Set<string>([
  "candidate",
  "active",
  "disputed",
  "superseded",
  "expired",
  "forgotten",
  "rejected",
]);

function parseStatus(value: unknown): MemoryStatus | undefined {
  if (typeof value !== "string") return undefined;
  return STATUSES.has(value) ? (value as MemoryStatus) : undefined;
}
