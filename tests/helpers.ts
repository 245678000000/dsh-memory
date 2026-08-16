import { FrozenClock } from "../src/clock.ts";
import { activeScopeFromPaths, type ActiveScope } from "../src/domain/scope.ts";
import { MemoryService } from "../src/service.ts";
import { InMemoryMemoryStore } from "../src/storage/memory-store.ts";
import { SqliteMemoryStore } from "../src/storage/sqlite.ts";

export function project(name: string, sessionId = "s"): ActiveScope {
  return activeScopeFromPaths({
    cwd: `/tmp/${name}`,
    projectLabel: name,
    sessionId,
  });
}

export function globalScope(sessionId = "g"): ActiveScope {
  return activeScopeFromPaths({ sessionId });
}

export function createService(clock?: FrozenClock): MemoryService {
  return new MemoryService({
    store: new InMemoryMemoryStore(),
    clock: clock ?? new FrozenClock(new Date("2026-08-16T00:00:00.000Z")),
  });
}

export function createSqliteService(): MemoryService {
  return new MemoryService({
    store: new SqliteMemoryStore(":memory:"),
  });
}
