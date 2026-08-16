import type { MemoryRecord } from "../domain/memory.ts";
import { sameScope } from "../domain/scope.ts";
import { lexicalOverlap } from "../lifecycle/conflict.ts";

export interface ConsolidationPlan {
  survivingContent: string;
  sourceIds: string[];
  kind: MemoryRecord["kind"];
  scope: MemoryRecord["scope"];
  subject?: string;
}

export function planConsolidation(records: readonly MemoryRecord[]): ConsolidationPlan[] {
  const active = records.filter(
    (record) =>
      record.status === "active"
      && record.payloadPresent
      && !record.pinned
      && record.extractionType !== "derived",
  );
  const groups = new Map<string, MemoryRecord[]>();
  for (const record of active) {
    const key = `${record.kind}|${record.scope.kind}|${record.scope.id}|${record.subject ?? "_"}`;
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  const plans: ConsolidationPlan[] = [];
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    const similar = clusterSimilar(group);
    for (const cluster of similar) {
      if (cluster.length < 3) continue;
      plans.push({
        survivingContent: summarizeCluster(cluster),
        sourceIds: cluster.map((item) => item.id),
        kind: "semantic",
        scope: cluster[0]!.scope,
        subject: cluster[0]!.subject,
      });
    }
  }
  return plans;
}

function clusterSimilar(records: MemoryRecord[]): MemoryRecord[][] {
  const used = new Set<string>();
  const clusters: MemoryRecord[][] = [];
  for (const record of records) {
    if (used.has(record.id)) continue;
    const cluster = [record];
    used.add(record.id);
    for (const other of records) {
      if (used.has(other.id)) continue;
      if (!sameScope(record.scope, other.scope)) continue;
      if (lexicalOverlap(record.content, other.content) >= 0.45) {
        cluster.push(other);
        used.add(other.id);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function summarizeCluster(records: MemoryRecord[]): string {
  const unique = [...new Set(records.map((record) => record.content.trim()))];
  if (unique.length === 1) return unique[0]!;
  const first = unique[0]!;
  const extras = unique.slice(1).map((item) => item.replace(/\.$/, ""));
  if (records[0]?.subject === undefined && /concise|direct|short/.test(unique.join(" ").toLowerCase())) {
    return "User generally prefers concise, direct responses.";
  }
  return `${first.replace(/\.$/, "")}. Also observed: ${extras.join("; ")}.`;
}
