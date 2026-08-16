export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  canonicalObject: string;
  temporal: boolean;
  correction: boolean;
  refinementHint: boolean;
}

interface LexiconEntry {
  subject: string;
  aliases: readonly string[];
}

const LEXICON: readonly LexiconEntry[] = [
  {
    subject: "package_manager",
    aliases: ["pnpm", "npm", "yarn", "bun"],
  },
  {
    subject: "editor",
    aliases: [
      "visual studio code",
      "vs code",
      "vscode",
      "cursor",
      "neovim",
      "nvim",
      "vim",
      "zed",
      "sublime",
      "webstorm",
      "jetbrains",
      "intellij",
    ],
  },
  {
    subject: "database",
    aliases: ["postgresql", "postgres", "mysql", "mariadb", "sqlite", "mongodb", "mongo", "redis"],
  },
  {
    subject: "runtime",
    aliases: ["node.js", "nodejs", "node", "bun", "deno"],
  },
  {
    subject: "language",
    aliases: ["typescript", "javascript", "python", "golang", "go", "rust", "java"],
  },
  {
    subject: "os",
    aliases: ["macos", "mac os", "mac", "linux", "windows"],
  },
];

const CANONICAL: Record<string, string> = {
  "vs code": "vscode",
  "visual studio code": "vscode",
  postgres: "postgresql",
  mongo: "mongodb",
  nvim: "neovim",
  "node.js": "node",
  nodejs: "node",
  "mac os": "macos",
  mac: "macos",
  golang: "go",
};

const EXCLUSIVE_SETS: readonly (readonly string[])[] = [
  ["pnpm", "npm", "yarn", "bun"],
  ["vscode", "cursor", "neovim", "vim", "zed", "sublime", "webstorm", "jetbrains", "intellij"],
  ["postgresql", "mysql", "mariadb", "sqlite", "mongodb"],
  ["node", "deno"],
  ["macos", "linux", "windows"],
];

export function canonicalize(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return CANONICAL[trimmed] ?? trimmed;
}

export function exclusivePeers(value: string): string[] {
  const canonical = canonicalize(value);
  for (const group of EXCLUSIVE_SETS) {
    if (group.includes(canonical)) return [...group];
  }
  return [];
}

export function mutuallyExclusive(a: string, b: string): boolean {
  if (a === b) return false;
  const group = exclusivePeers(a);
  return group.includes(b);
}

export function extractFact(content: string): ExtractedFact | undefined {
  const text = content.trim();
  if (!text) return undefined;
  const lower = text.toLowerCase();
  const temporal = /\b(switched|no longer|not anymore|used to|previously|now|from now on|instead)\b/i.test(
    text,
  );
  const correction = /\b(actually|correction|wrong|not\b.+\banymore|don't .+ anymore|do not .+ anymore)\b/i.test(
    text,
  );

  const lexiconHit = extractFromLexicon(lower);
  if (lexiconHit) {
    return { ...lexiconHit, temporal, correction, refinementHint: false };
  }

  const switched = text.match(/\bswitched(?:\s+from\s+(.+?))?\s+to\s+([^.,;]+)/i);
  if (switched?.[2]) {
    const next = switched[2].trim();
    const subject = inferSubjectFromValue(next) ?? "preference";
    return {
      subject,
      predicate: "uses",
      object: next,
      canonicalObject: canonicalize(next),
      temporal: true,
      correction,
      refinementHint: false,
    };
  }

  const preferred = text.match(
    /\b(?:preferred|prefer|likes?|love)\s+(?:to\s+use\s+)?([^.,;]+)/i,
  );
  if (preferred?.[1] && !/\b(concise|short|direct|verbose)\b/i.test(preferred[1])) {
    const object = stripLeadingArticle(preferred[1]);
    return {
      subject: inferSubjectFromValue(object) ?? "preference",
      predicate: "prefers",
      object,
      canonicalObject: canonicalize(object),
      temporal,
      correction,
      refinementHint: false,
    };
  }

  const uses = text.match(
    /\b(?:this project|this repo|this repository|the project|we)\s+(?:now\s+)?(?:uses?|is using|must use)\s+([^.,;]+)/i,
  );
  if (uses?.[1]) {
    const object = stripLeadingArticle(uses[1]);
    return {
      subject: inferSubjectFromValue(object) ?? "project_tooling",
      predicate: "uses",
      object,
      canonicalObject: canonicalize(object),
      temporal,
      correction,
      refinementHint: false,
    };
  }

  const isPattern = text.match(/\b(?:the\s+)?([a-z][a-z0-9 _-]{2,40})\s+(?:is|are)\s+([^.,;]+)/i);
  if (isPattern?.[1] && isPattern[2] && !/^(it|this|that|there)$/i.test(isPattern[1])) {
    const subject = normalizeSubject(isPattern[1]);
    const object = stripLeadingArticle(isPattern[2]);
    return {
      subject,
      predicate: "is",
      object,
      canonicalObject: canonicalize(object),
      temporal,
      correction,
      refinementHint: false,
    };
  }

  return undefined;
}

function extractFromLexicon(lower: string): Omit<ExtractedFact, "temporal" | "correction" | "refinementHint"> | undefined {
  for (const entry of LEXICON) {
    const hits = entry.aliases
      .filter((alias) => includesWord(lower, alias))
      .map((alias) => canonicalize(alias));
    const uniqueHits = [...new Set(hits)];
    if (uniqueHits.length === 0) continue;
    const object = uniqueHits[uniqueHits.length - 1]!;
    const predicate = /\bprefer|preferred|like/.test(lower) ? "prefers" : "uses";
    return {
      subject: entry.subject,
      predicate,
      object,
      canonicalObject: object,
    };
  }
  return undefined;
}

function inferSubjectFromValue(value: string): string | undefined {
  const canonical = canonicalize(value);
  for (const entry of LEXICON) {
    if (entry.aliases.some((alias) => canonicalize(alias) === canonical)) {
      return entry.subject;
    }
  }
  return undefined;
}

function includesWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

function stripLeadingArticle(value: string): string {
  return value.replace(/^(the|a|an)\s+/i, "").trim();
}

function normalizeSubject(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1),
  );
}

export function isRefinement(older: string, newer: string): boolean {
  const oldTokens = tokenSet(older);
  const newTokens = tokenSet(newer);
  if (oldTokens.size === 0 || newTokens.size === 0) return false;
  if (oldTokens.size === newTokens.size) return false;
  const smaller = oldTokens.size < newTokens.size ? oldTokens : newTokens;
  const larger = oldTokens.size < newTokens.size ? newTokens : oldTokens;
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}
