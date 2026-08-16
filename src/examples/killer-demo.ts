import { pathToFileURL } from "node:url";
import { FrozenClock } from "../clock.ts";
import { activeScopeFromPaths } from "../domain/scope.ts";
import { MemoryService } from "../service.ts";
import { InMemoryMemoryStore } from "../storage/memory-store.ts";

export function runKillerDemo(): void {
  const clock = new FrozenClock(new Date("2026-08-16T12:00:00.000Z"));
  const service = new MemoryService({ store: new InMemoryMemoryStore(), clock });
  const global = activeScopeFromPaths({ sessionId: "s1" });
  const alpha = activeScopeFromPaths({
    cwd: "/tmp/project-alpha",
    projectLabel: "Alpha",
    sessionId: "s2",
  });
  const other = activeScopeFromPaths({
    cwd: "/tmp/project-beta",
    projectLabel: "Beta",
    sessionId: "s3",
  });

  log("Session 1 — explicit global preference");
  const m1 = service.remember(
    { content: "Remember: I generally use pnpm.", explicit: true },
    global,
  );
  log(`  ${m1.memory?.id} ${m1.memory?.scope.kind} ${m1.memory?.status} ${m1.memory?.content}`);

  log("\nSession 2 / Project Alpha — project-specific fact");
  const m2 = service.remember(
    { content: "For this project we use npm.", explicit: true },
    alpha,
  );
  log(`  ${m2.memory?.id} ${m2.memory?.scope.kind} ${m2.memory?.status} ${m2.memory?.content}`);

  const here = service.recall("What package manager should I use here?", alpha);
  log("\nRecall in Project Alpha:");
  for (const item of here.selected) {
    log(`  ${item.record.id} score=${item.score.finalScore.toFixed(3)} scope=${item.record.scope.kind} ${item.record.content}`);
  }
  log(`  winner: ${here.selected[0]?.record.object ?? here.selected[0]?.record.content}`);

  const elsewhere = service.recall("What package manager should I use here?", other);
  log("\nRecall in another project:");
  for (const item of elsewhere.selected) {
    log(`  ${item.record.id} score=${item.score.finalScore.toFixed(3)} scope=${item.record.scope.kind} ${item.record.content}`);
  }

  log("\nSession 3 — temporal update");
  const vscode = service.remember(
    { content: "My preferred editor is VS Code.", explicit: true },
    global,
  );
  const cursor = service.remember(
    { content: "I switched from VS Code to Cursor.", explicit: true },
    global,
  );
  log(`  ${vscode.memory?.id} now ${service.get(vscode.memory!.id)?.status}`);
  log(`  ${cursor.memory?.id} now ${cursor.memory?.status} ${cursor.memory?.content}`);

  log("\nSession 4 — explicit forget");
  const forgotten = service.forget({ query: "Cursor editor" }, global);
  log(`  forgotten: ${forgotten.forgottenIds.join(", ")}`);
  log(`  ${forgotten.notice}`);
  const after = service.recall("Which editor do I use?", global);
  log(`  recall after forget: ${after.selected.map((item) => item.record.content).join(" | ") || "(none)"}`);

  service.close();
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runKillerDemo();
}
