/**
 * API Key policy management
 */

import { apiClient } from './client';

export interface ApiKeyPolicy {
  apiKey: string;
  excludedModels: string[];
  allowClaudeOpus46: boolean;
  dailyLimits: Record<string, number>;
  claudeFailoverEnabled: boolean;
  claudeFailoverTargetModel: string;
}

type ApiKeyPolicyDTO = {
  'api-key': string;
  'excluded-models'?: unknown;
  'allow-claude-opus-4-6'?: unknown;
  'daily-limits'?: unknown;
  failover?: unknown;
};

function normalizePolicy(raw: unknown): ApiKeyPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const dto = raw as Partial<ApiKeyPolicyDTO> & Record<string, unknown>;
  const apiKey = String(dto['api-key'] ?? '').trim();
  if (!apiKey) return null;

  const excluded = dto['excluded-models'];
  const excludedModels = Array.isArray(excluded)
    ? excluded.map((m) => String(m).trim()).filter(Boolean)
    : [];

  const allowRaw = dto['allow-claude-opus-4-6'];
  const allowClaudeOpus46 =
    typeof allowRaw === 'boolean' ? allowRaw : allowRaw == null ? true : Boolean(allowRaw);

  const limitsRaw = dto['daily-limits'];
  const dailyLimits: Record<string, number> = {};
  if (limitsRaw && typeof limitsRaw === 'object' && !Array.isArray(limitsRaw)) {
    for (const [k, v] of Object.entries(limitsRaw as Record<string, unknown>)) {
      const key = String(k).trim().toLowerCase();
      const num = typeof v === 'number' ? v : Number(String(v));
      if (key && Number.isFinite(num) && num > 0) dailyLimits[key] = Math.floor(num);
    }
  }

  const failoverRaw = dto.failover;
  let claudeFailoverEnabled = false;
  let claudeFailoverTargetModel = '';
  if (failoverRaw && typeof failoverRaw === 'object' && !Array.isArray(failoverRaw)) {
    const claudeRaw = (failoverRaw as Record<string, unknown>).claude;
    if (claudeRaw && typeof claudeRaw === 'object' && !Array.isArray(claudeRaw)) {
      const enabledRaw = (claudeRaw as Record<string, unknown>).enabled;
      claudeFailoverEnabled = typeof enabledRaw === 'boolean' ? enabledRaw : Boolean(enabledRaw);
      const targetRaw = (claudeRaw as Record<string, unknown>)['target-model'];
      claudeFailoverTargetModel = String(targetRaw ?? '').trim();
    }
  }
  if (claudeFailoverEnabled && !claudeFailoverTargetModel) {
    claudeFailoverTargetModel = 'gpt-5.2(high)';
  }

  return {
    apiKey,
    excludedModels,
    allowClaudeOpus46,
    dailyLimits,
    claudeFailoverEnabled,
    claudeFailoverTargetModel
  };
}

function toDTO(policy: ApiKeyPolicy): ApiKeyPolicyDTO {
  return {
    'api-key': policy.apiKey,
    'excluded-models': policy.excludedModels,
    'allow-claude-opus-4-6': policy.allowClaudeOpus46,
    'daily-limits': policy.dailyLimits,
    failover: {
      claude: {
        enabled: Boolean(policy.claudeFailoverEnabled),
        'target-model': String(policy.claudeFailoverTargetModel ?? '').trim()
      }
    }
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
  }
};
