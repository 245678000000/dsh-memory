import type { ActiveScope } from "../../domain/scope.ts";
import { formatExplanation } from "../../retrieval/explain.ts";
import { FORGET_BOUNDARY_NOTICE, renderRecord } from "../../render.ts";
import type { MemoryService } from "../../service.ts";
import type { PluginContext } from "./plugin.ts";

export function registerMemoryCommands(
  ctx: PluginContext,
  service: MemoryService,
  active: () => ActiveScope,
): void {
  if (!ctx.commands) return;
  ctx.commands.register({
    name: "memory",
    description: "Inspect, search, pin, forget, or list dsh-memory records.",
    input: { hint: "search <q> | conflicts | inspect <id> | forget <id> | pin <id> | unpin <id>" },
    async handler(invocation) {
      const raw = invocation.rawInput.trim();
      const [verb, ...rest] = raw.split(/\s+/);
      const arg = rest.join(" ").trim();
      try {
        if (!verb || verb === "list") {
          const rows = service.list({}).slice(0, 30);
          return {
            kind: "success",
            text: rows.length === 0
              ? "No active memories."
              : rows.map((row) => `${row.id} [${row.status}/${row.scope.kind}] ${row.content}`).join("\n"),
          };
        }
        if (verb === "search") {
          const hits = service.search(arg || "*", active(), 10);
          return {
            kind: "success",
            text: hits.length === 0
              ? "No matches."
              : hits
                .map((hit) => `${hit.record.id} (${hit.score.finalScore.toFixed(3)}) ${hit.record.content}`)
                .join("\n"),
          };
        }
        if (verb === "conflicts") {
          const conflicts = service.conflicts();
          return {
            kind: "success",
            text: conflicts.length === 0
              ? "No conflicts."
              : conflicts
                .map((item) => `${item.id} ${item.type} ${item.leftId} vs ${item.rightId} [${item.status}] ${item.reason}`)
                .join("\n"),
          };
        }
        if (verb === "inspect" || verb === "explain") {
          const record = service.get(arg);
          if (!record) return { kind: "error", text: `Unknown memory ${arg}` };
          const explanation = formatExplanation(service.explain(arg, "", active()));
          return { kind: "success", text: `${renderRecord(record)}\n\n${explanation}` };
        }
        if (verb === "forget") {
          const result = service.forget({ id: arg.startsWith("M-") ? arg : undefined, query: arg.startsWith("M-") ? undefined : arg }, active());
          return {
            kind: "success",
            text: `Forgotten: ${result.forgottenIds.join(", ") || "(none)"}\n${FORGET_BOUNDARY_NOTICE}`,
          };
        }
        if (verb === "pin" || verb === "unpin") {
          const record = service.pin(arg, verb === "pin");
          return { kind: "success", text: `${record.id} pinned=${record.pinned}` };
        }
        return { kind: "error", text: `Unknown /memory subcommand: ${verb}` };
      } catch (error) {
        return { kind: "error", text: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
