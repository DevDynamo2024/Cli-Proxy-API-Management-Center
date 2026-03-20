/**
 * API Key policy management
 */

import { apiClient } from './client';

const DEFAULT_CLAUDE_FAILOVER_TARGET_MODEL = 'gpt-5.4(medium)';

export interface ModelFailoverRule {
  fromModel: string;
  targetModel: string;
}

export interface ModelRoutingRule {
  enabled: boolean;
  fromModel: string;
  targetModel: string;
  targetPercent: number;
  stickyWindowSeconds: number;
}

export interface ApiKeyPolicy {
  apiKey: string;
  fastMode: boolean;
  enableClaudeModels: boolean;
  claudeGptTargetFamily: string;
  upstreamBaseUrl: string;
  excludedModels: string[];
  enableClaudeOpus1M: boolean;
  allowClaudeOpus46: boolean;
  dailyLimits: Record<string, number>;
  dailyBudgetUsd: number;
  weeklyBudgetUsd: number;
  weeklyBudgetAnchorAt: string;
  modelRoutingRules: ModelRoutingRule[];
  claudeFailoverEnabled: boolean;
  claudeFailoverTargetModel: string;
  claudeFailoverRules: ModelFailoverRule[];
}

export type ApiKeyPolicyDTO = {
  'api-key': string;
  'fast-mode'?: unknown;
  'enable-claude-models'?: unknown;
  'claude-gpt-target-family'?: unknown;
  'upstream-base-url'?: unknown;
  'excluded-models'?: unknown;
  'enable-claude-opus-1m'?: unknown;
  'allow-claude-opus-4-6'?: unknown;
  'daily-limits'?: unknown;
  'daily-budget-usd'?: unknown;
  'weekly-budget-usd'?: unknown;
  'weekly-budget-anchor-at'?: unknown;
  'model-routing'?: unknown;
  failover?: unknown;
};

export type ModelFailoverRuleDTO = {
  'from-model'?: unknown;
  'target-model'?: unknown;
};

export type ModelRoutingRuleDTO = {
  enabled?: unknown;
  'from-model'?: unknown;
  'target-model'?: unknown;
  'target-percent'?: unknown;
  'sticky-window-seconds'?: unknown;
};

export function toModelRoutingRuleDTOs(rules: ModelRoutingRule[]): ModelRoutingRuleDTO[] {
  return Array.isArray(rules)
    ? rules
        .map((r) => ({
          enabled: Boolean(r?.enabled ?? true),
          'from-model': String(r?.fromModel ?? '').trim(),
          'target-model': String(r?.targetModel ?? '').trim(),
          'target-percent':
            typeof r?.targetPercent === 'number'
              ? Math.max(0, Math.min(100, Math.floor(r.targetPercent)))
              : Number(String(r?.targetPercent ?? 0)) || 0,
          'sticky-window-seconds':
            typeof r?.stickyWindowSeconds === 'number'
              ? Math.max(1, Math.floor(r.stickyWindowSeconds))
              : Number(String(r?.stickyWindowSeconds ?? 3600)) || 3600,
        }))
        .filter((r) => r['from-model'] && r['target-model'])
    : [];
}

export function toModelFailoverRuleDTOs(rules: ModelFailoverRule[]): ModelFailoverRuleDTO[] {
  return Array.isArray(rules)
    ? rules
        .map((r) => ({
          'from-model': String(r?.fromModel ?? '').trim(),
          'target-model': String(r?.targetModel ?? '').trim(),
        }))
        .filter((r) => r['from-model'] && r['target-model'])
    : [];
}

function normalizePolicy(raw: unknown): ApiKeyPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const dto = raw as Partial<ApiKeyPolicyDTO> & Record<string, unknown>;
  const apiKey = String(dto['api-key'] ?? '').trim();
  if (!apiKey) return null;
  const fastModeRaw = dto['fast-mode'];
  const fastMode = typeof fastModeRaw === 'boolean' ? fastModeRaw : Boolean(fastModeRaw);
  const enableClaudeModelsRaw = dto['enable-claude-models'];
  const enableClaudeModels =
    typeof enableClaudeModelsRaw === 'boolean'
      ? enableClaudeModelsRaw
      : enableClaudeModelsRaw == null
        ? false
        : Boolean(enableClaudeModelsRaw);
  const claudeGptTargetFamily = String(dto['claude-gpt-target-family'] ?? '').trim();

  const upstreamRaw = dto['upstream-base-url'];
  const upstreamBaseUrl = upstreamRaw == null ? '' : String(upstreamRaw).trim();

  const excluded = dto['excluded-models'];
  const excludedModels = Array.isArray(excluded)
    ? excluded.map((m) => String(m).trim()).filter(Boolean)
    : [];

  const allowRaw = dto['allow-claude-opus-4-6'];
  const allowClaudeOpus46 =
    typeof allowRaw === 'boolean' ? allowRaw : allowRaw == null ? true : Boolean(allowRaw);
  const enableClaudeOpus1MRaw = dto['enable-claude-opus-1m'];
  const enableClaudeOpus1M =
    typeof enableClaudeOpus1MRaw === 'boolean'
      ? enableClaudeOpus1MRaw
      : enableClaudeOpus1MRaw == null
        ? false
        : Boolean(enableClaudeOpus1MRaw);

  const limitsRaw = dto['daily-limits'];
  const dailyLimits: Record<string, number> = {};
  if (limitsRaw && typeof limitsRaw === 'object' && !Array.isArray(limitsRaw)) {
    for (const [k, v] of Object.entries(limitsRaw as Record<string, unknown>)) {
      const key = String(k).trim().toLowerCase();
      const num = typeof v === 'number' ? v : Number(String(v));
      if (key && Number.isFinite(num) && num > 0) dailyLimits[key] = Math.floor(num);
    }
  }

  const dailyBudgetRaw = dto['daily-budget-usd'];
  const dailyBudgetUsd =
    typeof dailyBudgetRaw === 'number'
      ? dailyBudgetRaw > 0
        ? dailyBudgetRaw
        : 0
      : Math.max(0, Number(String(dailyBudgetRaw ?? '')) || 0);

  const weeklyBudgetRaw = dto['weekly-budget-usd'];
  const weeklyBudgetUsd =
    typeof weeklyBudgetRaw === 'number'
      ? weeklyBudgetRaw > 0
        ? weeklyBudgetRaw
        : 0
      : Math.max(0, Number(String(weeklyBudgetRaw ?? '')) || 0);
  const weeklyBudgetAnchorAt = String(dto['weekly-budget-anchor-at'] ?? '').trim();

  const failoverRaw = dto.failover;
  let claudeFailoverEnabled = false;
  let claudeFailoverTargetModel = '';
  let claudeFailoverRules: ModelFailoverRule[] = [];
  if (failoverRaw && typeof failoverRaw === 'object' && !Array.isArray(failoverRaw)) {
    const claudeRaw = (failoverRaw as Record<string, unknown>).claude;
    if (claudeRaw && typeof claudeRaw === 'object' && !Array.isArray(claudeRaw)) {
      const enabledRaw = (claudeRaw as Record<string, unknown>).enabled;
      claudeFailoverEnabled = typeof enabledRaw === 'boolean' ? enabledRaw : Boolean(enabledRaw);
      const targetRaw = (claudeRaw as Record<string, unknown>)['target-model'];
      claudeFailoverTargetModel = String(targetRaw ?? '').trim();

      const rulesRaw = (claudeRaw as Record<string, unknown>).rules;
      if (Array.isArray(rulesRaw)) {
        claudeFailoverRules = rulesRaw
          .map((r) => {
            if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
            const rule = r as Partial<ModelFailoverRuleDTO> & Record<string, unknown>;
            const fromModel = String(rule['from-model'] ?? '').trim();
            const targetModel = String(rule['target-model'] ?? '').trim();
            if (!fromModel || !targetModel) return null;
            return { fromModel, targetModel };
          })
          .filter(Boolean) as ModelFailoverRule[];
      }
    }
  }
  if (claudeFailoverEnabled && !claudeFailoverTargetModel) {
    claudeFailoverTargetModel = DEFAULT_CLAUDE_FAILOVER_TARGET_MODEL;
  }

  let modelRoutingRules: ModelRoutingRule[] = [];
  const routingRaw = dto['model-routing'];
  if (routingRaw && typeof routingRaw === 'object' && !Array.isArray(routingRaw)) {
    const rulesRaw = (routingRaw as Record<string, unknown>).rules;
    if (Array.isArray(rulesRaw)) {
      modelRoutingRules = rulesRaw
        .map((r) => {
          if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
          const rule = r as Partial<ModelRoutingRuleDTO> & Record<string, unknown>;
          const enabledRaw = rule.enabled;
          const enabled =
            typeof enabledRaw === 'boolean'
              ? enabledRaw
              : enabledRaw == null
                ? true
                : Boolean(enabledRaw);

          const fromModel = String(rule['from-model'] ?? '').trim();
          const targetModel = String(rule['target-model'] ?? '').trim();

          const percentRaw = rule['target-percent'];
          const percentNum =
            typeof percentRaw === 'number' ? percentRaw : Number(String(percentRaw ?? ''));
          const targetPercent = Number.isFinite(percentNum)
            ? Math.max(0, Math.min(100, Math.floor(percentNum)))
            : 0;

          const windowRaw = rule['sticky-window-seconds'];
          const windowNum =
            typeof windowRaw === 'number' ? windowRaw : Number(String(windowRaw ?? ''));
          const stickyWindowSeconds =
            Number.isFinite(windowNum) && windowNum > 0 ? Math.floor(windowNum) : 3600;

          if (!fromModel || !targetModel) return null;
          return { enabled, fromModel, targetModel, targetPercent, stickyWindowSeconds };
        })
        .filter(Boolean) as ModelRoutingRule[];
    }
  }

  return {
    apiKey,
    fastMode,
    enableClaudeModels,
    claudeGptTargetFamily,
    upstreamBaseUrl,
    excludedModels,
    enableClaudeOpus1M,
    allowClaudeOpus46,
    dailyLimits,
    dailyBudgetUsd,
    weeklyBudgetUsd,
    weeklyBudgetAnchorAt,
    modelRoutingRules,
    claudeFailoverEnabled,
    claudeFailoverTargetModel,
    claudeFailoverRules,
  };
}

function toDTO(policy: ApiKeyPolicy): ApiKeyPolicyDTO {
  const routingRules = toModelRoutingRuleDTOs(policy.modelRoutingRules);
  const rules = toModelFailoverRuleDTOs(policy.claudeFailoverRules);

  return {
    'api-key': policy.apiKey,
    'fast-mode': Boolean(policy.fastMode),
    'enable-claude-models': Boolean(policy.enableClaudeModels),
    'claude-gpt-target-family': String(policy.claudeGptTargetFamily ?? '').trim(),
    'upstream-base-url': String(policy.upstreamBaseUrl ?? '').trim(),
    'excluded-models': policy.excludedModels,
    'enable-claude-opus-1m': policy.enableClaudeOpus1M,
    'allow-claude-opus-4-6': policy.allowClaudeOpus46,
    'daily-limits': policy.dailyLimits,
    'daily-budget-usd': policy.dailyBudgetUsd,
    'weekly-budget-usd': policy.weeklyBudgetUsd,
    'weekly-budget-anchor-at': String(policy.weeklyBudgetAnchorAt ?? '').trim(),
    'model-routing': { rules: routingRules },
    failover: {
      claude: {
        enabled: Boolean(policy.claudeFailoverEnabled),
        'target-model': String(policy.claudeFailoverTargetModel ?? '').trim(),
        rules,
      },
    },
  };
}

export const apiKeyPoliciesApi = {
  async list(): Promise<ApiKeyPolicy[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-key-policies');
    const raw = data['api-key-policies'];
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizePolicy).filter(Boolean) as ApiKeyPolicy[];
  },

  async replace(policies: ApiKeyPolicy[]): Promise<void> {
    await apiClient.put('/api-key-policies', policies.map(toDTO));
  },

  async upsert(policy: ApiKeyPolicy): Promise<void> {
    const dto = toDTO(policy);
    await apiClient.patch('/api-key-policies', { 'api-key': dto['api-key'], value: dto });
  },

  async remove(apiKey: string): Promise<void> {
    const key = String(apiKey ?? '').trim();
    if (!key) return;
    await apiClient.delete(`/api-key-policies?api-key=${encodeURIComponent(key)}`);
  },
};
