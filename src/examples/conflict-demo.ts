import { pathToFileURL } from "node:url";
import { activeScopeFromPaths } from "../domain/scope.ts";
import { MemoryService } from "../service.ts";
import { InMemoryMemoryStore } from "../storage/memory-store.ts";

export function runConflictDemo(): void {
  const service = new MemoryService({ store: new InMemoryMemoryStore() });
  const project = activeScopeFromPaths({
    cwd: "/tmp/project-alpha",
    projectLabel: "Alpha",
    sessionId: "conflict",
  });

  const a = service.remember(
    { content: "Document A: Project database is PostgreSQL.", explicit: true, scope: "project" },
    project,
  );
  const b = service.remember(
    { content: "Document B: Project database is MySQL.", explicit: true, scope: "project" },
    project,
  );

  process.stdout.write("MEMORY CONFLICT\n\n");
  process.stdout.write(`${a.memory?.id} ${a.memory?.content} [${service.get(a.memory!.id)?.status}]\n`);
  process.stdout.write(`${b.memory?.id} ${b.memory?.content} [${b.memory?.status}]\n\n`);
  process.stdout.write(`decision: ${b.decision}\nreason: ${b.reason}\n\n`);
  for (const conflict of service.conflicts()) {
    process.stdout.write(
      `${conflict.id}\n${conflict.leftId} vs ${conflict.rightId}\nscope: same project\nresolution: ${conflict.status.toUpperCase()}\n${conflict.reason}\nNo automatic overwrite performed.\n`,
    );
  }
  service.close();
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runConflictDemo();
}
