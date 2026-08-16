import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FrozenClock } from "../src/clock.ts";
import { foldMemoryEvents } from "../src/domain/fold.ts";
import type { MemoryEvent } from "../src/domain/event.ts";
import { evaluateEligibility } from "../src/lifecycle/eligibility.ts";
import { inspectSensitivity } from "../src/lifecycle/sensitivity.ts";
import { decayMultiplier } from "../src/lifecycle/decay.ts";
import { detectConflictsForScope } from "../src/lifecycle/conflict.ts";
import { MemoryService } from "../src/service.ts";
import { SqliteMemoryStore } from "../src/storage/sqlite.ts";
import { createService, globalScope, project } from "./helpers.ts";

describe("ledger fold", () => {
  it("reconstructs status from events without losing history", () => {
    const events: MemoryEvent[] = [
      {
        id: "E-1",
        seq: 1,
        type: "memory/candidate-created",
        memoryId: "M-1",
        at: "2026-08-01T00:00:00.000Z",
        data: {
          kind: "preference",
          scope: { kind: "global", id: "user" },
          content: "prefers pnpm",
          confidence: 0.9,
          importance: 0.9,
          sensitivity: "normal",
          sourceKind: "explicit_user",
          explicitUserMemory: true,
          extractionType: "explicit",
        },
      },
      {
        id: "E-2",
        seq: 2,
        type: "memory/accepted",
        memoryId: "M-1",
        at: "2026-08-01T00:00:01.000Z",
        data: {},
      },
      {
        id: "E-3",
        seq: 3,
        type: "memory/superseded",
        memoryId: "M-1",
        at: "2026-08-02T00:00:00.000Z",
        data: { supersededBy: "M-2", reason: "update" },
      },
    ];
    const folded = foldMemoryEvents(events).get("M-1");
    expect(folded?.status).toBe("superseded");
    expect(folded?.supersededBy).toBe("M-2");
    expect(folded?.content).toBe("prefers pnpm");
  });
});

describe("eligibility and sensitivity", () => {
  it("drops transient observations", () => {
    expect(evaluateEligibility("It is 3:00 pm").eligible).toBe(false);
    expect(evaluateEligibility("just opened the file").eligible).toBe(false);
  });

  it("rejects secrets", () => {
    const verdict = inspectSensitivity("password: hunter2-secret");
    expect(verdict.sensitivity).toBe("secret");
    expect(verdict.reject).toBe(true);
  });
});

describe("conflict engine", () => {
  it("treats different scopes as not conflicting", () => {
    const service = createService();
    const global = service.remember({ content: "I generally use pnpm.", explicit: true }, globalScope());
    const local = service.remember(
      { content: "For this project we use bun.", explicit: true },
      project("alpha"),
    );
    expect(global.memory?.status).toBe("active");
    expect(local.memory?.status).toBe("active");
    expect(local.decision).not.toBe("dispute");
    service.close();
  });

  it("detects direct contradiction inside one scope", () => {
    const existing = createService().remember(
      { content: "Project database is PostgreSQL.", explicit: true, scope: "project" },
      project("alpha"),
    );
    const verdicts = detectConflictsForScope(
      {
        content: "Project database is MySQL.",
        subject: "database",
        predicate: "uses",
        object: "mysql",
        sourceAuthority: 80,
        explicit: true,
        temporal: false,
        correction: false,
        createdAt: "2026-08-16T00:00:00.000Z",
        scope: existing.memory!.scope,
      },
      [existing.memory!],
    );
    expect(verdicts[0]?.auto.action).toBe("dispute");
  });
});

describe("decay and expiration", () => {
  it("lowers retrieval weight over time but does not delete", () => {
    const clock = new FrozenClock(new Date("2026-01-01T00:00:00.000Z"));
    const service = createService(clock);
    const stored = service.remember(
      { content: "This project uses a local cache directory named .cache-tmp.", explicit: false },
      project("alpha"),
    );
    const fresh = decayMultiplier(stored.memory!, clock.now());
    clock.advanceDays(200);
    const old = decayMultiplier(service.get(stored.memory!.id)!, clock.now());
    expect(old).toBeLessThan(fresh);
    expect(service.get(stored.memory!.id)?.status).toBe("active");
    service.close();
  });
});

describe("sqlite file persistence", () => {
  it("reopens the same file and still recalls", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-memory-"));
    const path = join(dir, "memory.sqlite");
    const first = new MemoryService({ store: new SqliteMemoryStore(path) });
    first.remember({ content: "Remember that I prefer pnpm.", explicit: true }, globalScope());
    first.close();
    const second = new MemoryService({ store: new SqliteMemoryStore(path) });
    const hits = second.recall("package manager", globalScope());
    expect(hits.selected.some((item) => /pnpm/i.test(item.record.content))).toBe(true);
    second.close();
  });
});
