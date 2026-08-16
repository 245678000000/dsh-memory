import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { activeScopeFromPaths, type ActiveScope } from "../../domain/scope.ts";
import { MEMORY_POLICY_SECTION } from "../../render.ts";
import { MemoryService } from "../../service.ts";
import { SqliteMemoryStore } from "../../storage/sqlite.ts";
import { type PluginConfig, normalizeConfig } from "../../config.ts";
import { registerMemoryTools } from "./tools.ts";
import { registerMemoryCommands } from "./commands.ts";
import {
  extractTextFromUnknown,
  extractUserQuery,
  isUserSourcedEvent,
  latestUserText,
  sessionCwd,
  sessionIdOf,
} from "./text.ts";

export const name = "dsh-memory";
export const inject = ["tools"];

export { Config } from "../../config.ts";
export type { PluginConfig } from "../../config.ts";

export interface PluginContext {
  tools?: { register(tool: unknown): unknown };
  systemPrompt?: {
    section(section: {
      name: string;
      order: number;
      text: string | ((context: unknown) => string);
    }): unknown;
    context?(context: {
      name: string;
      order: number;
      text: string | ((context: unknown) => string);
    }): unknown;
  };
  commands?: {
    register(definition: {
      name: string;
      description: string;
      input?: { hint: string };
      handler: (invocation: {
        rawInput: string;
        signal: AbortSignal;
      }) => { kind: "success" | "error"; text?: string } | Promise<{ kind: "success" | "error"; text?: string }>;
    }): unknown;
  };
  on(event: string, handler: (...args: unknown[]) => unknown, opts?: { prepend?: boolean }): unknown;
  effect(disposer: () => void): void;
}

interface PreStepDecision {
  kind: string;
  messages?: unknown[];
}

export function apply(ctx: PluginContext, rawConfig: unknown): void {
  const config = normalizeConfig(rawConfig);
  const databasePath = config.databasePath || defaultDatabasePath();
  const store = new SqliteMemoryStore(databasePath);
  const service = new MemoryService({
    store,
    budget: { maxMemories: config.maxMemories, maxTokens: config.maxTokens },
  });

  const lastQuery = new Map<string, string>();

  ctx.effect(() => {
    service.close();
  });

  if (ctx.systemPrompt) {
    ctx.systemPrompt.section({
      name: "dsh-memory-policy",
      order: 40,
      text: MEMORY_POLICY_SECTION,
    });
  }

  registerMemoryTools(ctx, service, () => currentScope(undefined, lastQuery));
  if (ctx.commands) registerMemoryCommands(ctx, service, () => currentScope(undefined, lastQuery));

  ctx.on(
    "agent/pre-step",
    async (payload: unknown, next: unknown) => {
      const nxt = next as () => Promise<PreStepDecision>;
      const decision = await nxt();
      const input = (payload ?? {}) as {
        agent?: unknown;
        turn?: number;
        step?: number;
        signal?: AbortSignal;
      };
      if (decision.kind !== "enter") return decision;
      if (input.signal?.aborted) return decision;

      const scope = scopeFromAgent(input.agent);
      const query = extractUserQuery(payload, { messages: decision.messages }) || latestUserText(input.agent);
      const sid = scope.sessionId ?? "default";
      if (query.trim()) lastQuery.set(sid, query);

      if (!config.automaticRecall) return decision;
      if (!config.recallEveryStep && input.step !== undefined && input.step !== 1) return decision;
      if (!query.trim()) return decision;

      const recalled = service.recall(query, scope);
      if (recalled.selected.length === 0) return decision;

      const message = createPluginMessage(recalled.promptBlock);
      return {
        kind: "enter",
        messages: [...(decision.messages ?? []), message],
      };
    },
    { prepend: true },
  );

  if (config.automaticObserve) {
    ctx.on("session/event", (session: unknown, event: unknown) => {
      if (!isUserSourcedEvent(event)) return;
      const text = extractTextFromUnknown(event);
      if (!text.trim()) return;
      const sid =
        session && typeof session === "object" && "id" in session
          ? String((session as { id?: string }).id ?? "default")
          : "default";
      const cwd =
        session && typeof session === "object" && "cwd" in session
          ? String((session as { cwd?: string }).cwd ?? "")
          : process.cwd();
      const scope = activeScopeFromPaths({ cwd, sessionId: sid });
      try {
        service.observe(text, scope, sid);
      } catch {
        // Observation is best-effort and must never break the turn.
      }
    });
  }
}

function currentScope(agent: unknown, lastQuery: Map<string, string>): ActiveScope {
  void lastQuery;
  return scopeFromAgent(agent);
}

function scopeFromAgent(agent: unknown): ActiveScope {
  return activeScopeFromPaths({
    cwd: sessionCwd(agent) ?? process.cwd(),
    sessionId: sessionIdOf(agent),
  });
}

function defaultDatabasePath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  return join(home, "dsh-memory", "memory.sqlite");
}

function createPluginMessage(text: string): unknown {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("@deepseek-ai/dsh-llm") as {
      createUserMessage?: (input: {
        content: Array<{ type: "text"; text: string }>;
        source: {
          kind: "plugin";
          plugin: string;
          form: "snapshot";
          sections: Array<{ name: string; text: string }>;
        };
      }) => unknown;
    };
    if (mod.createUserMessage) {
      return mod.createUserMessage({
        content: [{ type: "text", text }],
        source: {
          kind: "plugin",
          plugin: name,
          form: "snapshot",
          sections: [{ name, text }],
        },
      });
    }
  } catch {
    // Fall through to a structural user message.
  }
  return {
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: "plugin",
      plugin: name,
      form: "snapshot",
      sections: [{ name, text }],
    },
  };
}
