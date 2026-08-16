import { describe, expect, it } from "vitest";
import { apply, name } from "../src/adapters/harness/plugin.ts";
import type { PluginContext } from "../src/adapters/harness/plugin.ts";

describe("harness plugin", () => {
  it("registers tools, policy section, commands, and pre-step without throwing", () => {
    const tools: string[] = [];
    const events: string[] = [];
    const disposers: Array<() => void> = [];
    const ctx: PluginContext = {
      tools: {
        register(tool: unknown) {
          const named = tool as { name?: string };
          if (named.name) tools.push(named.name);
        },
      },
      systemPrompt: {
        section(section) {
          expect(section.name).toBe("dsh-memory-policy");
          expect(typeof section.text === "string" ? section.text : "").toMatch(/DATA/);
        },
      },
      commands: {
        register(definition) {
          expect(definition.name).toBe("memory");
        },
      },
      on(event, handler) {
        events.push(event);
        void handler;
      },
      effect(disposer) {
        disposers.push(disposer);
      },
    };

    apply(ctx, { databasePath: ":memory:", maxMemories: 4, maxTokens: 200 });
    expect(name).toBe("dsh-memory");
    expect(tools).toEqual(expect.arrayContaining([
      "memory_remember",
      "memory_search",
      "memory_get",
      "memory_forget",
      "memory_pin",
      "memory_explain",
      "memory_list",
    ]));
    expect(events).toContain("agent/pre-step");
    expect(events).toContain("session/event");
    for (const dispose of disposers) dispose();
  });
});
