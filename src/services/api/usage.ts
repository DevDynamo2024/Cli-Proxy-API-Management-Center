/**
 * 使用统计相关 API
 */

import { apiClient } from './client';

const USAGE_TIMEOUT_MS = 60 * 1000;

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

export interface UsageDashboardSummary {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  total_cost_usd: number;
  cached_tokens: number;
  reasoning_tokens: number;
}

export interface UsageDashboardRates {
  rpm: number;
  tpm: number;
  window_minutes: number;
  request_count: number;
  token_count: number;
}

export interface UsageDashboardSeriesEntry {
  key: string;
  data: number[];
}

export interface UsageDashboardSeriesSet {
  labels: string[];
  series: UsageDashboardSeriesEntry[];
}

export interface UsageDashboardSparkline {
  labels: string[];
  data: number[];
}

export interface UsageDashboardApiModelStat {
  model: string;
  requests: number;
  success_count: number;
  failure_count: number;
  tokens: number;
  cost_usd: number;
}

export interface UsageDashboardApiStat {
  endpoint: string;
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  total_cost_usd: number;
  models: UsageDashboardApiModelStat[];
}

export interface UsageDashboardModelStat {
  model: string;
  requests: number;
  success_count: number;
  failure_count: number;
  tokens: number;
  cost_usd: number;
}

export interface UsageDashboardResponse {
  range: string;
  generated_at?: string;
  summary: UsageDashboardSummary;
  rates: UsageDashboardRates;
  model_names: string[];
  api_stats: UsageDashboardApiStat[];
  model_stats: UsageDashboardModelStat[];
  charts: {
    requests: {
      hour: UsageDashboardSeriesSet;
      day: UsageDashboardSeriesSet;
    };
    tokens: {
      hour: UsageDashboardSeriesSet;
      day: UsageDashboardSeriesSet;
    };
  };
  sparklines: {
    requests: UsageDashboardSparkline;
    tokens: UsageDashboardSparkline;
    rpm: UsageDashboardSparkline;
    tpm: UsageDashboardSparkline;
    cost: UsageDashboardSparkline;
  };
}

export type UsageTargetsStatusBlock = 'success' | 'failure' | 'mixed' | 'idle';

export interface UsageTargetsStatusBar {
  blocks: UsageTargetsStatusBlock[];
  success_rate: number;
  total_success: number;
  total_failure: number;
}

export interface UsageTargetsKeyStat {
  success_count: number;
  failure_count: number;
  status_bar: UsageTargetsStatusBar;
}

export interface UsageTargetsCredentialStat extends UsageTargetsKeyStat {
  api_key?: string;
  prefix?: string;
}

export interface UsageTargetsOpenAIProviderStat extends UsageTargetsKeyStat {
  name: string;
  prefix?: string;
  base_url?: string;
  api_key_entries: UsageTargetsCredentialStat[];
}

export interface UsageTargetsDashboardResponse {
  generated_at?: string;
  providers: {
    gemini: UsageTargetsCredentialStat[];
    codex: UsageTargetsCredentialStat[];
    claude: UsageTargetsCredentialStat[];
    vertex: UsageTargetsCredentialStat[];
    openai: UsageTargetsOpenAIProviderStat[];
  };
  auth_files: {
    by_auth_index: Record<string, UsageTargetsKeyStat>;
    by_source: Record<string, UsageTargetsKeyStat>;
  };
}

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: () => apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 获取后端聚合后的统计面板数据
   */
  getDashboard: (range: string) =>
    apiClient.get<UsageDashboardResponse>(`/usage/dashboard?range=${encodeURIComponent(range)}`, {
      timeout: USAGE_TIMEOUT_MS
    }),

  /**
   * 获取 AI providers / auth files 使用统计
   */
  getTargetsDashboard: () =>
    apiClient.get<UsageTargetsDashboardResponse>('/usage/targets-dashboard', {
      timeout: USAGE_TIMEOUT_MS
    }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS })
};
