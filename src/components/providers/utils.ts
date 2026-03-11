import type {
  UsageTargetsCredentialStat,
  UsageTargetsKeyStat,
  UsageTargetsOpenAIProviderStat,
} from '@/services/api';
import type { AmpcodeConfig, AmpcodeModelMapping, ApiKeyEntry } from '@/types';
import type { AmpcodeFormState, ModelEntry } from './types';

export const DISABLE_ALL_MODELS_RULE = '*';

export const hasDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models) &&
  models.some((model) => String(model ?? '').trim() === DISABLE_ALL_MODELS_RULE);

export const stripDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models)
    ? models.filter((model) => String(model ?? '').trim() !== DISABLE_ALL_MODELS_RULE)
    : [];

export const withDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return [...base, DISABLE_ALL_MODELS_RULE];
};

export const withoutDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return base;
};

export const parseExcludedModels = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const excludedModelsToText = (models?: string[]) =>
  Array.isArray(models) ? models.join('\n') : '';

export const normalizeOpenAIBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const buildOpenAIModelsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  return `${trimmed}/models`;
};

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
};

export const EMPTY_USAGE_TARGET_STAT: UsageTargetsKeyStat = {
  success_count: 0,
  failure_count: 0,
  status_bar: {
    blocks: Array.from({ length: 20 }, () => 'idle' as const),
    success_rate: 100,
    total_success: 0,
    total_failure: 0,
  },
};

export const findCredentialUsageStat = (
  stats: UsageTargetsCredentialStat[],
  apiKey: string,
  prefix?: string
): UsageTargetsKeyStat => {
  const targetApiKey = apiKey.trim();
  const targetPrefix = String(prefix || '').trim();
  return (
    stats.find(
      (item) =>
        String(item.api_key || '').trim() === targetApiKey &&
        String(item.prefix || '').trim() === targetPrefix
    ) || EMPTY_USAGE_TARGET_STAT
  );
};

export const findOpenAIProviderUsageStat = (
  stats: UsageTargetsOpenAIProviderStat[],
  input: { name: string; prefix?: string; baseUrl?: string }
): UsageTargetsOpenAIProviderStat | null =>
  stats.find(
    (item) =>
      item.name === input.name &&
      String(item.prefix || '').trim() === String(input.prefix || '').trim() &&
      String(item.base_url || '').trim() === String(input.baseUrl || '').trim()
  ) || null;

export const findOpenAIEntryUsageStat = (
  stats: UsageTargetsCredentialStat[] | undefined,
  apiKey: string
): UsageTargetsKeyStat =>
  stats?.find((item) => String(item.api_key || '').trim() === apiKey.trim()) ||
  EMPTY_USAGE_TARGET_STAT;

export const buildApiKeyEntry = (input?: Partial<ApiKeyEntry>): ApiKeyEntry => ({
  apiKey: input?.apiKey ?? '',
  proxyUrl: input?.proxyUrl ?? '',
  headers: input?.headers ?? {},
});

export const ampcodeMappingsToEntries = (mappings?: AmpcodeModelMapping[]): ModelEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return mappings.map((mapping) => ({
    name: mapping.from ?? '',
    alias: mapping.to ?? '',
  }));
};

export const entriesToAmpcodeMappings = (entries: ModelEntry[]): AmpcodeModelMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeModelMapping[] = [];

  entries.forEach((entry) => {
    const from = entry.name.trim();
    const to = entry.alias.trim();
    if (!from || !to) return;
    const key = from.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mappings.push({ from, to });
  });

  return mappings;
};

export const buildAmpcodeFormState = (ampcode?: AmpcodeConfig | null): AmpcodeFormState => ({
  upstreamUrl: ampcode?.upstreamUrl ?? '',
  upstreamApiKey: '',
  forceModelMappings: ampcode?.forceModelMappings ?? false,
  mappingEntries: ampcodeMappingsToEntries(ampcode?.modelMappings),
});
