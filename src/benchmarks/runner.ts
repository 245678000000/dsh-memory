import { pathToFileURL } from "node:url";
import { FrozenClock } from "../clock.ts";
import { activeScopeFromPaths } from "../domain/scope.ts";
import { estimateTokens } from "../retrieval/tokenize.ts";
import { MemoryService } from "../service.ts";
import { InMemoryMemoryStore } from "../storage/memory-store.ts";

export interface BenchMetrics {
  recallPrecision: number;
  recallCoverage: number;
  conflictDetectionAccuracy: number;
  scopeAccuracy: number;
  staleMemoryErrorRate: number;
  forgetCompliance: number;
  contextTokensInjected: number;
  cases: number;
}

export function runBenchmark(): BenchMetrics {
  const clock = new FrozenClock(new Date("2026-08-16T00:00:00.000Z"));
  const service = new MemoryService({ store: new InMemoryMemoryStore(), clock });
  const projectA = activeScopeFromPaths({ cwd: "/tmp/alpha", projectLabel: "Alpha", sessionId: "b1" });
  const projectB = activeScopeFromPaths({ cwd: "/tmp/beta", projectLabel: "Beta", sessionId: "b2" });
  const global = activeScopeFromPaths({ sessionId: "b0" });

  let truePos = 0;
  let falsePos = 0;
  let expectedHits = 0;
  let conflictCorrect = 0;
  let conflictTotal = 0;
  let scopeCorrect = 0;
  let scopeTotal = 0;
  let staleErrors = 0;
  let staleTotal = 0;
  let forgetOk = 0;
  let forgetTotal = 0;
  let tokens = 0;
  let cases = 0;

  service.remember({ content: "I generally use pnpm.", explicit: true }, global);
  service.remember({ content: "For this project we use npm.", explicit: true, scope: "project" }, projectA);
  cases += 1;
  const aHits = service.recall("What package manager should I use here?", projectA);
  tokens += aHits.tokens;
  expectedHits += 1;
  const aWinner = aHits.selected[0];
  if (aWinner && /npm/i.test(aWinner.record.content) && aWinner.record.scope.kind === "project") {
    truePos += 1;
    scopeCorrect += 1;
  } else {
    falsePos += 1;
  }
  scopeTotal += 1;

  const bHits = service.recall("What package manager should I use here?", projectB);
  tokens += bHits.tokens;
  expectedHits += 1;
  const bWinner = bHits.selected[0];
  if (bWinner && /pnpm/i.test(bWinner.record.content)) {
    truePos += 1;
    scopeCorrect += 1;
  } else {
    falsePos += 1;
  }
  scopeTotal += 1;
  cases += 1;

  service.remember({ content: "Preferred editor is VS Code.", explicit: true }, global);
  const cursor = service.remember({ content: "I switched from VS Code to Cursor.", explicit: true }, global);
  cases += 1;
  conflictTotal += 1;
  const vscode = service.list({ status: "superseded" }).find((item) => /vs code/i.test(item.content));
  if (vscode && cursor.memory?.status === "active") conflictCorrect += 1;
  staleTotal += 1;
  const editorNow = service.recall("Which editor do I use?", global);
  tokens += editorNow.tokens;
  if (
    editorNow.selected.some(
      (item) => item.record.object === "vscode" || item.record.status === "superseded",
    )
  ) {
    staleErrors += 1;
  }

  service.remember({ content: "Project database is PostgreSQL.", explicit: true, scope: "project" }, projectA);
  const mysql = service.remember({ content: "Project database is MySQL.", explicit: true, scope: "project" }, projectA);
  cases += 1;
  conflictTotal += 1;
  if (mysql.decision === "dispute" || mysql.memory?.status === "disputed") conflictCorrect += 1;

  const secret = service.remember({ content: "My API key is sk-thisisnotarealkeyvalue123456", explicit: true }, global);
  cases += 1;
  if (!secret.accepted && secret.rejectedAsSecret) truePos += 1;
  else falsePos += 1;
  expectedHits += 1;

  if (cursor.memory) {
    service.forget({ id: cursor.memory.id }, global);
    forgetTotal += 1;
    const after = service.recall("Which editor do I use?", global);
    tokens += after.tokens;
    if (!after.selected.some((item) => item.record.id === cursor.memory?.id || /cursor/i.test(item.record.content))) {
      forgetOk += 1;
    }
  }

  const coffee = service.remember({ content: "User likes coffee.", explicit: true }, global);
  const roast = service.remember({ content: "User likes light-roast Ethiopian coffee.", explicit: true }, global);
  cases += 1;
  conflictTotal += 1;
  if (roast.decision !== "dispute" && coffee.memory && service.get(coffee.memory.id)?.status !== "disputed") {
    conflictCorrect += 1;
  }

  for (let i = 0; i < 40; i += 1) {
    service.remember(
      { content: `Remember project note number ${i} about build step ${i}.`, explicit: true, scope: "project" },
      projectA,
    );
  }
  const bounded = service.recall("build step", projectA, { maxMemories: 6, maxTokens: 400 });
  tokens += bounded.tokens;
  cases += 1;
  if (bounded.selected.length <= 6 && bounded.tokens <= 400 + estimateTokens("overhead")) {
    truePos += 1;
  } else {
    falsePos += 1;
  }
  expectedHits += 1;

  const metrics: BenchMetrics = {
    recallPrecision: truePos + falsePos === 0 ? 0 : truePos / (truePos + falsePos),
    recallCoverage: expectedHits === 0 ? 0 : truePos / expectedHits,
    conflictDetectionAccuracy: conflictTotal === 0 ? 0 : conflictCorrect / conflictTotal,
    scopeAccuracy: scopeTotal === 0 ? 0 : scopeCorrect / scopeTotal,
    staleMemoryErrorRate: staleTotal === 0 ? 0 : staleErrors / staleTotal,
    forgetCompliance: forgetTotal === 0 ? 0 : forgetOk / forgetTotal,
    contextTokensInjected: tokens,
    cases,
  };

  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
  service.close();
  return metrics;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runBenchmark();
}
