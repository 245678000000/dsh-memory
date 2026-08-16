export interface PluginConfig {
  databasePath: string;
  automaticRecall: boolean;
  automaticObserve: boolean;
  recallEveryStep: boolean;
  maxMemories: number;
  maxTokens: number;
  minRecallScore: number;
}

export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  databasePath: "",
  automaticRecall: true,
  automaticObserve: true,
  recallEveryStep: false,
  maxMemories: 8,
  maxTokens: 800,
  minRecallScore: 0.05,
};

export function normalizeConfig(value: unknown): PluginConfig {
  const input = isObject(value) ? value : {};
  const databasePath = optionalString(input.databasePath) ?? DEFAULT_PLUGIN_CONFIG.databasePath;
  const maxMemories = optionalNumber(input.maxMemories) ?? DEFAULT_PLUGIN_CONFIG.maxMemories;
  const maxTokens = optionalNumber(input.maxTokens) ?? DEFAULT_PLUGIN_CONFIG.maxTokens;
  const minRecallScore = optionalNumber(input.minRecallScore) ?? DEFAULT_PLUGIN_CONFIG.minRecallScore;
  if (!Number.isFinite(maxMemories) || maxMemories < 1 || maxMemories > 50) {
    throw new Error("dsh-memory: maxMemories must be between 1 and 50");
  }
  if (!Number.isFinite(maxTokens) || maxTokens < 64 || maxTokens > 8000) {
    throw new Error("dsh-memory: maxTokens must be between 64 and 8000");
  }
  if (!Number.isFinite(minRecallScore) || minRecallScore < 0 || minRecallScore > 1) {
    throw new Error("dsh-memory: minRecallScore must be between 0 and 1");
  }
  return {
    databasePath,
    automaticRecall: optionalBoolean(input.automaticRecall) ?? true,
    automaticObserve: optionalBoolean(input.automaticObserve) ?? true,
    recallEveryStep: optionalBoolean(input.recallEveryStep) ?? false,
    maxMemories: Math.floor(maxMemories),
    maxTokens: Math.floor(maxTokens),
    minRecallScore,
  };
}

export const Config = {
  "~standard": {
    version: 1 as const,
    vendor: "dsh-memory",
    validate(value: unknown) {
      try {
        return { value: normalizeConfig(value) };
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] };
      }
    },
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
