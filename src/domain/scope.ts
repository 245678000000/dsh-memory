import type { MemoryRecord, MemoryScope, ScopeKind } from "./memory.ts";

export interface ActiveScope {
  globalId: string;
  workspaceId?: string;
  workspacePath?: string;
  projectId?: string;
  projectPath?: string;
  projectLabel?: string;
  taskId?: string;
  taskLabel?: string;
  sessionId?: string;
}

export const SCOPE_WEIGHT: Record<ScopeKind, number> = {
  task: 1,
  project: 0.92,
  workspace: 0.84,
  session: 0.8,
  global: 0.76,
};

const SCOPE_RANK: Record<ScopeKind, number> = {
  task: 4,
  project: 3,
  workspace: 2,
  session: 1,
  global: 0,
};

export function scopeKey(scope: MemoryScope): string {
  return `${scope.kind}:${scope.id}`;
}

export function sameScope(a: MemoryScope, b: MemoryScope): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function scopeRank(kind: ScopeKind): number {
  return SCOPE_RANK[kind];
}

export function moreSpecificScope(a: MemoryScope, b: MemoryScope): MemoryScope {
  return scopeRank(a.kind) >= scopeRank(b.kind) ? a : b;
}

export function scopeVisibleIn(scope: MemoryScope, active: ActiveScope): boolean {
  switch (scope.kind) {
    case "global":
      return scope.id === active.globalId || scope.id === "user";
    case "workspace":
      return Boolean(active.workspaceId && scope.id === active.workspaceId);
    case "project":
      return Boolean(active.projectId && scope.id === active.projectId);
    case "task":
      return Boolean(active.taskId && scope.id === active.taskId);
    case "session":
      return Boolean(active.sessionId && scope.id === active.sessionId);
    default:
      return false;
  }
}

/**
 * A memory is eligible for ordinary recall when its scope is visible in the
 * current work context. Global memories are always visible; more specific
 * memories only apply inside their own scope.
 */
export function inRecallScope(record: MemoryRecord, active: ActiveScope): boolean {
  return scopeVisibleIn(record.scope, active);
}

/**
 * Specificity bonus used by retrieval. Matching the current project/task beats
 * a global preference without deleting the global fact.
 */
export function scopeMatchWeight(scope: MemoryScope, active: ActiveScope): number {
  if (!scopeVisibleIn(scope, active)) return 0;
  const base = SCOPE_WEIGHT[scope.kind];
  if (scope.kind === "task" && active.taskId === scope.id) return base;
  if (scope.kind === "project" && active.projectId === scope.id) return base;
  if (scope.kind === "workspace" && active.workspaceId === scope.id) return base;
  if (scope.kind === "session" && active.sessionId === scope.id) return base;
  if (scope.kind === "global") return base;
  return base * 0.5;
}

export function describeScope(scope: MemoryScope): string {
  return scope.label ? `${scope.kind}:${scope.label}` : `${scope.kind}:${scope.id}`;
}

export function defaultGlobalScope(): MemoryScope {
  return { kind: "global", id: "user", label: "user" };
}

export function projectScopeFromPath(projectPath: string, label?: string): MemoryScope {
  return {
    kind: "project",
    id: projectPath,
    label: label ?? projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath,
  };
}

export function resolveNamedScope(
  name: string | undefined,
  active: ActiveScope,
): MemoryScope {
  const requested = (name ?? "").trim().toLowerCase();
  if (requested === "workspace" && active.workspaceId) {
    return {
      kind: "workspace",
      id: active.workspaceId,
      label: active.workspacePath,
    };
  }
  if (requested === "project" && active.projectId) {
    return {
      kind: "project",
      id: active.projectId,
      label: active.projectLabel ?? active.projectPath,
    };
  }
  if (requested === "task" && active.taskId) {
    return { kind: "task", id: active.taskId, label: active.taskLabel };
  }
  if (requested === "session" && active.sessionId) {
    return { kind: "session", id: active.sessionId };
  }
  if (requested === "global" || requested === "user" || requested === "") {
    return defaultGlobalScope();
  }
  return defaultGlobalScope();
}

export function inferScopeFromText(text: string, active: ActiveScope): MemoryScope {
  const lower = text.toLowerCase();
  const mentionsProject =
    /\b(this project|this repo|this repository|in this codebase|for this project|this package)\b/.test(
      lower,
    );
  const mentionsTask = /\b(this task|this matter|for this ticket|this issue)\b/.test(lower);
  const mentionsGeneral = /\b(generally|in general|always|usually|by default|i prefer)\b/.test(
    lower,
  );
  if (mentionsTask && active.taskId) {
    return { kind: "task", id: active.taskId, label: active.taskLabel };
  }
  if (mentionsProject && active.projectId) {
    return {
      kind: "project",
      id: active.projectId,
      label: active.projectLabel ?? active.projectPath,
    };
  }
  if (mentionsGeneral) return defaultGlobalScope();
  if (active.projectId && /\b(uses|use|using|must|should)\b/.test(lower)) {
    return {
      kind: "project",
      id: active.projectId,
      label: active.projectLabel ?? active.projectPath,
    };
  }
  return defaultGlobalScope();
}

export function activeScopeFromPaths(input: {
  cwd?: string;
  workspacePath?: string;
  workspaceId?: string;
  sessionId?: string;
  taskId?: string;
  taskLabel?: string;
  projectLabel?: string;
}): ActiveScope {
  const cwd = input.cwd?.trim();
  const workspacePath = input.workspacePath?.trim() || cwd;
  return {
    globalId: "user",
    workspaceId: input.workspaceId ?? workspacePath,
    workspacePath,
    projectId: cwd,
    projectPath: cwd,
    projectLabel: input.projectLabel ?? cwd?.split(/[\\/]/).filter(Boolean).at(-1),
    taskId: input.taskId,
    taskLabel: input.taskLabel,
    sessionId: input.sessionId,
  };
}
