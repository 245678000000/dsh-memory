#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { activeScopeFromPaths } from "./domain/scope.ts";
import { formatExplanation } from "./retrieval/explain.ts";
import { FORGET_BOUNDARY_NOTICE, renderRecord } from "./render.ts";
import { MemoryService } from "./service.ts";
import { SqliteMemoryStore } from "./storage/sqlite.ts";
import { InMemoryMemoryStore } from "./storage/memory-store.ts";
import { runKillerDemo } from "./examples/killer-demo.ts";
import { runConflictDemo } from "./examples/conflict-demo.ts";
import { runBenchmark } from "./benchmarks/runner.ts";

function help(): string {
  return `dsh-memory — Intelligent long-term memory for DeepSeek Harness

Usage:
  dsh-memory remember <text>
  dsh-memory search <query>
  dsh-memory list
  dsh-memory get <id>
  dsh-memory forget <id-or-query>
  dsh-memory pin <id>
  dsh-memory unpin <id>
  dsh-memory conflicts
  dsh-memory explain <id> [query]
  dsh-memory export
  dsh-memory demo
  dsh-memory demo conflict
  dsh-memory bench
  dsh-memory help

Environment:
  DSH_MEMORY_PATH   SQLite file (default: ~/.dsh/dsh-memory/memory.sqlite)
  DSH_HOME          Harness home used to derive the default path
`;
}

function openService(ephemeral = false): MemoryService {
  if (ephemeral) return new MemoryService({ store: new InMemoryMemoryStore() });
  const path =
    process.env.DSH_MEMORY_PATH?.trim()
    || join(process.env.DSH_HOME?.trim() || join(homedir(), ".dsh"), "dsh-memory", "memory.sqlite");
  mkdirSync(join(path, ".."), { recursive: true });
  return new MemoryService({ store: new SqliteMemoryStore(path) });
}

function scope() {
  return activeScopeFromPaths({ cwd: process.cwd(), sessionId: "cli" });
}

async function main(argv: string[]): Promise<number> {
  const [cmd = "help", ...rest] = argv;
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(help());
    return 0;
  }
  if (cmd === "demo") {
    if (rest[0] === "conflict") runConflictDemo();
    else runKillerDemo();
    return 0;
  }
  if (cmd === "bench") {
    runBenchmark();
    return 0;
  }

  const service = openService();
  try {
    if (cmd === "remember") {
      const result = service.remember({ content: rest.join(" "), explicit: true }, scope());
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.accepted ? 0 : 2;
    }
    if (cmd === "search") {
      const hits = service.search(rest.join(" "), scope());
      process.stdout.write(
        hits.map((hit) => `${hit.record.id}\t${hit.score.finalScore.toFixed(3)}\t${hit.record.content}`).join("\n") + "\n",
      );
      return 0;
    }
    if (cmd === "list") {
      for (const record of service.list({})) {
        process.stdout.write(`${record.id}\t${record.status}\t${record.scope.kind}\t${record.content}\n`);
      }
      return 0;
    }
    if (cmd === "get") {
      const record = service.get(rest[0] ?? "");
      if (!record) {
        process.stderr.write("not found\n");
        return 1;
      }
      process.stdout.write(`${renderRecord(record)}\n`);
      return 0;
    }
    if (cmd === "forget") {
      const token = rest.join(" ");
      const result = service.forget(
        token.startsWith("M-") ? { id: token } : { query: token },
        scope(),
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n${FORGET_BOUNDARY_NOTICE}\n`);
      return 0;
    }
    if (cmd === "pin" || cmd === "unpin") {
      const record = service.pin(rest[0] ?? "", cmd === "pin");
      process.stdout.write(`${record.id} pinned=${record.pinned}\n`);
      return 0;
    }
    if (cmd === "conflicts") {
      process.stdout.write(`${JSON.stringify(service.conflicts(), null, 2)}\n`);
      return 0;
    }
    if (cmd === "explain") {
      const id = rest[0] ?? "";
      const query = rest.slice(1).join(" ");
      process.stdout.write(`${formatExplanation(service.explain(id, query, scope()))}\n`);
      return 0;
    }
    if (cmd === "export") {
      process.stdout.write(`${JSON.stringify(service.exportMemories(), null, 2)}\n`);
      return 0;
    }
    process.stderr.write(help());
    return 1;
  } finally {
    service.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
