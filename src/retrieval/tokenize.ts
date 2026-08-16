const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "be",
  "this",
  "that",
  "it",
  "my",
  "i",
  "we",
  "you",
  "me",
  "do",
  "did",
  "does",
  "should",
  "use",
  "used",
  "using",
  "with",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => stem(token))
    .filter((token) => token.length > 1 && !STOP.has(token));
}

export function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function lexicalScore(query: string, document: string): number {
  const q = tokenize(query);
  const d = new Set(tokenize(document));
  if (q.length === 0 || d.size === 0) return 0;
  let hits = 0;
  for (const token of q) {
    if (d.has(token)) hits += 1;
  }
  const coverage = hits / q.length;
  const exact = document.toLowerCase().includes(query.trim().toLowerCase()) ? 0.18 : 0;
  return Math.min(1, coverage * 0.9 + exact);
}

export function isHistoricalQuery(query: string): boolean {
  return /\b(before|previously|used to|old|former|was|were|history|earlier|used before)\b/i.test(
    query,
  );
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
