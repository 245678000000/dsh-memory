export function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractTextFromUnknown(item)).filter(Boolean).join("\n");
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (record.content !== undefined) return extractTextFromUnknown(record.content);
  if (record.data !== undefined) return extractTextFromUnknown(record.data);
  if (record.messages !== undefined) return extractTextFromUnknown(record.messages);
  return "";
}

export function extractUserQuery(payload: unknown, decision: unknown): string {
  const fromDecision = extractTextFromUnknown(decision);
  if (fromDecision.trim()) return fromDecision;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (record.messages) return extractTextFromUnknown(record.messages);
    if (record.agent) return latestUserText(record.agent);
  }
  return "";
}

export function latestUserText(agent: unknown): string {
  if (!agent || typeof agent !== "object") return "";
  const session = (agent as { session?: { events?: unknown[]; cwd?: string } }).session;
  const events = session?.events;
  if (!Array.isArray(events)) return "";
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || typeof event !== "object") continue;
    const typed = event as { type?: string; data?: { source?: { kind?: string }; content?: unknown } };
    if (typed.type !== "user/message") continue;
    if (typed.data?.source?.kind === "plugin") continue;
    return extractTextFromUnknown(typed.data?.content ?? typed.data);
  }
  return "";
}

export function sessionCwd(agent: unknown): string | undefined {
  if (!agent || typeof agent !== "object") return undefined;
  const record = agent as {
    session?: { cwd?: string; header?: { cwd?: string } };
    cwd?: string;
  };
  return record.session?.cwd ?? record.session?.header?.cwd ?? record.cwd;
}

export function sessionIdOf(agent: unknown): string | undefined {
  if (!agent || typeof agent !== "object") return undefined;
  const record = agent as {
    session?: { id?: string };
    sessionId?: string;
    id?: string;
  };
  const value = record.session?.id ?? record.sessionId ?? record.id;
  return typeof value === "string" ? value : undefined;
}

export function isUserSourcedEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const typed = event as { type?: string; data?: { source?: { kind?: string } } };
  return typed.type === "user/message" && typed.data?.source?.kind === "user";
}
