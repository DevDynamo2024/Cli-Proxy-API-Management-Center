/**
 * API key policies management page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCheck,
  IconChevronDown,
  IconKey,
  IconRefreshCw,
  IconTrash2,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { apiKeysApi, apiKeyPoliciesApi, authFilesApi } from '@/services/api';
import type {
  ApiKeyPolicy as StoredApiKeyPolicy,
  ModelFailoverRule,
  ModelRoutingRule,
} from '@/services/api/apiKeyPolicies';
import { toModelFailoverRuleDTOs, toModelRoutingRuleDTOs } from '@/services/api/apiKeyPolicies';
import styles from './APIKeyPoliciesPage.module.scss';

type ModelDef = { id: string; display_name?: string };
type ApiKeyPolicy = StoredApiKeyPolicy & { enableClaudeModels?: boolean };
type PolicyTab = 'basic' | 'routing' | 'failover';
type AccessCategory = 'claude' | 'chatgpt';

const OPUS_46_ID = 'claude-opus-4-6';
const OPUS_46_RULE_PATTERN = 'claude-opus-4-6*';
const SONNET_46_RULE_PATTERN = 'claude-sonnet-4-6*';
const DEFAULT_STICKY_WINDOW_SECONDS = 3600;
const DEFAULT_GPT54_TARGET = 'gpt-5.4(medium)';
const GPT54_HIGH_TARGET = 'gpt-5.4(high)';
const CLAUDE_CATEGORY_PATTERNS = ['claude-*'] as const;
const CHATGPT_CATEGORY_PATTERNS = ['gpt-*', 'chatgpt-*', 'o1*', 'o3*', 'o4*'] as const;

function uniqStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const t = String(v ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normalizeModelPattern(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function hasManagedCategoryPattern(list: string[], patterns: readonly string[]): boolean {
  const normalized = new Set(list.map(normalizeModelPattern).filter(Boolean));
  return patterns.some((pattern) => normalized.has(pattern));
}

function stripManagedCategoryPatterns(list: string[]): string[] {
  const managed = new Set<string>([...CLAUDE_CATEGORY_PATTERNS, ...CHATGPT_CATEGORY_PATTERNS]);
  return list.filter((item) => {
    const normalized = normalizeModelPattern(item);
    return normalized !== '' && !managed.has(normalized);
  });
}

function parsePositiveInt(text: string): number | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function parsePositiveNumber(text: string): number | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getLocalHourInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:00`;
}

function getCurrentHourInputValue(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return getLocalHourInputValue(now);
}

function normalizeHourInputValue(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setMinutes(0, 0, 0);
  return getLocalHourInputValue(parsed);
}

function formatRFC3339WithLocalOffset(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad2(Math.floor(absOffset / 60));
  const offsetRemainder = pad2(absOffset % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

function toHourlyRFC3339(raw: string): string | null {
  const normalized = normalizeHourInputValue(raw);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setMinutes(0, 0, 0);
  return formatRFC3339WithLocalOffset(parsed);
}

function buildWeeklyBudgetWindowLabel(raw: string): string {
  const normalized = normalizeHourInputValue(raw);
  if (!normalized) return '';
  const anchor = new Date(normalized);
  if (Number.isNaN(anchor.getTime())) return '';
  const durationMs = 7 * 24 * 60 * 60 * 1000;
  const now = new Date();
  let start = anchor;
  if (now.getTime() > anchor.getTime()) {
    const elapsed = now.getTime() - anchor.getTime();
    const windows = Math.floor(elapsed / durationMs);
    start = new Date(anchor.getTime() + windows * durationMs);
  }
  const end = new Date(start.getTime() + durationMs);
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatBudgetValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return Number.isInteger(value) ? String(value) : String(value);
}

function sanitizeFailoverRules(raw: ModelFailoverRule[]): ModelFailoverRule[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: ModelFailoverRule[] = [];
  for (const r of raw) {
    const fromModel = String(r?.fromModel ?? '').trim();
    const targetModel = String(r?.targetModel ?? '').trim();
    if (!fromModel || !targetModel) continue;
    out.push({ fromModel, targetModel });
  }
  return out;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(String(value ?? ''));
  if (!Number.isFinite(num)) return fallback;
  const i = Math.floor(num);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function sanitizeRoutingRules(raw: ModelRoutingRule[]): ModelRoutingRule[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: ModelRoutingRule[] = [];
  for (const r of raw) {
    const fromModel = String(r?.fromModel ?? '').trim();
    const targetModel = String(r?.targetModel ?? '').trim();
    if (!fromModel || !targetModel) continue;
    out.push({
      enabled: Boolean(r?.enabled ?? true),
      fromModel,
      targetModel,
      targetPercent: clampInt(r?.targetPercent, 0, 100, 0),
      stickyWindowSeconds: clampInt(
        r?.stickyWindowSeconds,
        1,
        3600 * 24 * 30,
        DEFAULT_STICKY_WINDOW_SECONDS
      ),
    });
  }
  return out;
}

export function APIKeyPoliciesPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const { showNotification } = useNotificationStore();

  const disableControls = connectionStatus !== 'connected';

  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [policies, setPolicies] = useState<ApiKeyPolicy[]>([]);
  const [codexModels, setCodexModels] = useState<ModelDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedKey, setSelectedKey] = useState('');
  const [activeTab, setActiveTab] = useState<PolicyTab>(() => {
    const saved = localStorage.getItem('api-key-policies:tab');
    if (saved === 'basic' || saved === 'routing' || saved === 'failover') return saved;
    return 'basic';
  });
  const [enableClaudeModels, setEnableClaudeModels] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [enableClaudeOpus1M, setEnableClaudeOpus1M] = useState(false);
  const [allowOpus46, setAllowOpus46] = useState(true);
  const [opus46DailyLimit, setOpus46DailyLimit] = useState('');
  const [dailyBudgetEnabled, setDailyBudgetEnabled] = useState(false);
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState('');
  const [weeklyBudgetEnabled, setWeeklyBudgetEnabled] = useState(false);
  const [weeklyBudgetUsd, setWeeklyBudgetUsd] = useState('');
  const [weeklyBudgetAnchorAt, setWeeklyBudgetAnchorAt] = useState('');
  const [allowClaudeCategory, setAllowClaudeCategory] = useState(true);
  const [allowChatGPTCategory, setAllowChatGPTCategory] = useState(true);
  const [excludedCustom, setExcludedCustom] = useState<string[]>([]);
  const [upstreamProxyEnabled, setUpstreamProxyEnabled] = useState(false);
  const [upstreamBaseUrl, setUpstreamBaseUrl] = useState('');
  const [modelRoutingRules, setModelRoutingRules] = useState<ModelRoutingRule[]>([]);
  const [claudeFailoverEnabled, setClaudeFailoverEnabled] = useState(false);
  const [claudeFailoverTargetModel, setClaudeFailoverTargetModel] = useState(DEFAULT_GPT54_TARGET);
  const [claudeFailoverRules, setClaudeFailoverRules] = useState<ModelFailoverRule[]>([]);

  const upstreamBaseUrlTrimmed = upstreamBaseUrl.trim();
  const upstreamProxyActive = upstreamProxyEnabled && upstreamBaseUrlTrimmed !== '';
  const routingControlsDisabled = disableControls || !selectedKey;
  const failoverControlsDisabled = disableControls || !selectedKey;
  const allowedCategoryCount = Number(allowClaudeCategory) + Number(allowChatGPTCategory);

  const currentPolicy = useMemo(() => {
    const key = selectedKey.trim();
    if (!key) return null;
    return policies.find((p) => p.apiKey === key) ?? null;
  }, [policies, selectedKey]);

  const handleTabChange = useCallback(
    (tab: PolicyTab) => {
      if (tab === activeTab) return;
      setActiveTab(tab);
      localStorage.setItem('api-key-policies:tab', tab);
    },
    [activeTab]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [keys, policyList, rawPolicyResp, codexDefs] = await Promise.all([
        apiKeysApi.list(),
        apiKeyPoliciesApi.list(),
        apiClient.get<Record<string, unknown>>('/api-key-policies'),
        authFilesApi.getModelDefinitions('codex'),
      ]);
      const normalizedKeys = uniqStrings([
        ...keys,
        ...policyList.map((policy) => String(policy.apiKey ?? '').trim()),
      ]);
      const enableClaudeModelsByKey = new Map<string, boolean>();
      const rawPolicies = rawPolicyResp['api-key-policies'];
      if (Array.isArray(rawPolicies)) {
        rawPolicies.forEach((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return;
          const record = item as Record<string, unknown>;
          const apiKey = String(record['api-key'] ?? '').trim();
          if (!apiKey) return;
          const rawValue = record['enable-claude-models'];
          enableClaudeModelsByKey.set(
            apiKey,
            typeof rawValue === 'boolean' ? rawValue : Boolean(rawValue)
          );
        });
      }

      setApiKeys(normalizedKeys);
      setPolicies(
        policyList.map((policy) => ({
          ...policy,
          enableClaudeModels: enableClaudeModelsByKey.get(policy.apiKey) ?? false,
        }))
      );
      setCodexModels(
        (codexDefs || [])
          .map((m) => ({ id: String(m.id ?? '').trim(), display_name: m.display_name }))
          .filter((m) => m.id)
      );

      setSelectedKey((prev) => {
        if (prev && normalizedKeys.includes(prev)) return prev;
        return normalizedKeys[0] ?? prev;
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : t('notification.refresh_failed', { defaultValue: '刷新失败' });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useHeaderRefresh(loadAll);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const key = selectedKey.trim();
    if (!key) return;

    const p =
      policies.find((x) => x.apiKey === key) ??
      ({
        apiKey: key,
        fastMode: false,
        enableClaudeModels: false,
        enableClaudeOpus1M: false,
        upstreamBaseUrl: '',
        excludedModels: [],
        allowClaudeOpus46: true,
        dailyLimits: {},
        dailyBudgetUsd: 0,
        weeklyBudgetUsd: 0,
        weeklyBudgetAnchorAt: '',
        modelRoutingRules: [],
        claudeFailoverEnabled: false,
        claudeFailoverTargetModel: DEFAULT_GPT54_TARGET,
        claudeFailoverRules: [],
      } as ApiKeyPolicy);

    setFastMode(Boolean(p.fastMode));
    setEnableClaudeModels(Boolean(p.enableClaudeModels));
    setEnableClaudeOpus1M(Boolean(p.enableClaudeOpus1M));
    setAllowOpus46(p.allowClaudeOpus46 ?? true);
    setClaudeFailoverEnabled(Boolean(p.claudeFailoverEnabled));
    setClaudeFailoverTargetModel(
      String(p.claudeFailoverTargetModel ?? '').trim() || DEFAULT_GPT54_TARGET
    );
    setClaudeFailoverRules(sanitizeFailoverRules(p.claudeFailoverRules ?? []));
    setModelRoutingRules(sanitizeRoutingRules(p.modelRoutingRules ?? []));

    const limit = p.dailyLimits?.[OPUS_46_ID] ?? p.dailyLimits?.[OPUS_46_ID.toLowerCase()];
    setOpus46DailyLimit(limit && Number.isFinite(limit) ? String(limit) : '');
    setDailyBudgetEnabled(Number(p.dailyBudgetUsd ?? 0) > 0);
    setDailyBudgetUsd(formatBudgetValue(Number(p.dailyBudgetUsd ?? 0)));
    setWeeklyBudgetEnabled(Number(p.weeklyBudgetUsd ?? 0) > 0);
    setWeeklyBudgetUsd(formatBudgetValue(Number(p.weeklyBudgetUsd ?? 0)));
    setWeeklyBudgetAnchorAt(
      normalizeHourInputValue(p.weeklyBudgetAnchorAt) || getCurrentHourInputValue()
    );

    const excluded = uniqStrings(p.excludedModels || []);
    setAllowClaudeCategory(!hasManagedCategoryPattern(excluded, CLAUDE_CATEGORY_PATTERNS));
    setAllowChatGPTCategory(!hasManagedCategoryPattern(excluded, CHATGPT_CATEGORY_PATTERNS));
    setExcludedCustom(stripManagedCategoryPatterns(excluded));

    const upstream = String(p.upstreamBaseUrl ?? '').trim();
    setUpstreamBaseUrl(upstream);
    setUpstreamProxyEnabled(Boolean(upstream));
  }, [policies, selectedKey]);

  useEffect(() => {
    if (!weeklyBudgetEnabled) return;
    setWeeklyBudgetAnchorAt((prev) => normalizeHourInputValue(prev) || getCurrentHourInputValue());
  }, [weeklyBudgetEnabled]);

  const toggleCategoryAllowed = useCallback((category: AccessCategory, allowed: boolean) => {
    if (category === 'claude') {
      setAllowClaudeCategory(allowed);
      return;
    }
    setAllowChatGPTCategory(allowed);
  }, []);

  const updateFailoverRule = useCallback((idx: number, patch: Partial<ModelFailoverRule>) => {
    setClaudeFailoverRules((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  const removeFailoverRule = useCallback((idx: number) => {
    setClaudeFailoverRules((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addFailoverRule = useCallback((rule?: Partial<ModelFailoverRule>) => {
    setClaudeFailoverRules((prev) => [
      ...prev,
      {
        fromModel: String(rule?.fromModel ?? '').trim(),
        targetModel: String(rule?.targetModel ?? '').trim(),
      },
    ]);
  }, []);

  const upsertPresetRule = useCallback((fromModel: string, defaultTargetModel: string) => {
    const key = String(fromModel ?? '').trim();
    if (!key) return;
    setClaudeFailoverRules((prev) => {
      const normalized = key.toLowerCase();
      const i = prev.findIndex(
        (r) =>
          String(r?.fromModel ?? '')
            .trim()
            .toLowerCase() === normalized
      );
      if (i >= 0) {
        const next = prev.slice();
        next[i] = {
          ...next[i],
          targetModel: String(defaultTargetModel ?? '').trim(),
        };
        return next;
      }
      return [
        ...prev,
        {
          fromModel: key,
          targetModel: String(defaultTargetModel ?? '').trim(),
        },
      ];
    });
  }, []);

  const updateRoutingRule = useCallback((idx: number, patch: Partial<ModelRoutingRule>) => {
    setModelRoutingRules((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  const removeRoutingRule = useCallback((idx: number) => {
    setModelRoutingRules((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addRoutingRule = useCallback((rule?: Partial<ModelRoutingRule>) => {
    setModelRoutingRules((prev) => [
      ...prev,
      {
        enabled: Boolean(rule?.enabled ?? true),
        fromModel: String(rule?.fromModel ?? '').trim(),
        targetModel: String(rule?.targetModel ?? '').trim(),
        targetPercent: clampInt(rule?.targetPercent, 0, 100, 50),
        stickyWindowSeconds: clampInt(
          rule?.stickyWindowSeconds,
          1,
          3600 * 24 * 30,
          DEFAULT_STICKY_WINDOW_SECONDS
        ),
      },
    ]);
  }, []);

  const upsertPresetRoutingRule = useCallback((fromModel: string, defaultTargetModel: string) => {
    const key = String(fromModel ?? '').trim();
    if (!key) return;
    setModelRoutingRules((prev) => {
      const normalized = key.toLowerCase();
      const i = prev.findIndex(
        (r) =>
          String(r?.fromModel ?? '')
            .trim()
            .toLowerCase() === normalized
      );
      if (i >= 0) {
        const next = prev.slice();
        next[i] = {
          ...next[i],
          enabled: true,
          targetModel: String(defaultTargetModel ?? '').trim(),
          stickyWindowSeconds: next[i].stickyWindowSeconds || DEFAULT_STICKY_WINDOW_SECONDS,
        };
        return next;
      }
      return [
        ...prev,
        {
          enabled: true,
          fromModel: key,
          targetModel: String(defaultTargetModel ?? '').trim(),
          targetPercent: 50,
          stickyWindowSeconds: DEFAULT_STICKY_WINDOW_SECONDS,
        },
      ];
    });
  }, []);

  const handleSave = useCallback(async () => {
    const apiKey = selectedKey.trim();
    if (!apiKey) return;

    const upstreamValue = upstreamProxyEnabled ? upstreamBaseUrl.trim() : '';
    if (upstreamProxyEnabled && !upstreamValue) {
      showNotification(
        t('api_key_policies.upstream_proxy_missing', { defaultValue: '请填写上游 base-url' }),
        'error'
      );
      return;
    }

    const dailyLimit = parsePositiveInt(opus46DailyLimit);
    const parsedDailyBudgetUsd = dailyBudgetEnabled ? parsePositiveNumber(dailyBudgetUsd) : null;
    const parsedWeeklyBudgetUsd = weeklyBudgetEnabled ? parsePositiveNumber(weeklyBudgetUsd) : null;
    const parsedWeeklyBudgetAnchorAt = weeklyBudgetEnabled
      ? toHourlyRFC3339(weeklyBudgetAnchorAt)
      : '';
    const dailyLimits: Record<string, number> = {};
    if (dailyLimit) dailyLimits[OPUS_46_ID] = dailyLimit;

    if (dailyBudgetEnabled && parsedDailyBudgetUsd == null) {
      showNotification(
        t('api_key_policies.daily_budget_invalid', { defaultValue: '请填写有效的每日额度（USD）' }),
        'error'
      );
      return;
    }
    if (weeklyBudgetEnabled && parsedWeeklyBudgetUsd == null) {
      showNotification(
        t('api_key_policies.weekly_budget_invalid', {
          defaultValue: '请填写有效的每周额度（USD）',
        }),
        'error'
      );
      return;
    }
    if (weeklyBudgetEnabled && !parsedWeeklyBudgetAnchorAt) {
      showNotification(
        t('api_key_policies.weekly_budget_anchor_invalid', {
          defaultValue: '请填写有效的每周预算开始时间（精确到小时）',
        }),
        'error'
      );
      return;
    }

    const excludedModels = uniqStrings([
      ...excludedCustom,
      ...(allowClaudeCategory ? [] : CLAUDE_CATEGORY_PATTERNS),
      ...(allowChatGPTCategory ? [] : CHATGPT_CATEGORY_PATTERNS),
    ]);
    const rules = sanitizeFailoverRules(claudeFailoverRules);
    const routingRules = sanitizeRoutingRules(modelRoutingRules);
    const failoverRuleDTOs = toModelFailoverRuleDTOs(rules);
    const routingRuleDTOs = toModelRoutingRuleDTOs(routingRules);
    const weeklyBudgetAnchorValue = parsedWeeklyBudgetAnchorAt ?? '';

    try {
      await apiClient.patch('/api-key-policies', {
        'api-key': apiKey,
        value: {
          'fast-mode': fastMode,
          'enable-claude-models': enableClaudeModels,
          'enable-claude-opus-1m': enableClaudeOpus1M,
          'upstream-base-url': upstreamValue,
          'allow-claude-opus-4-6': allowOpus46,
          'excluded-models': excludedModels,
          'daily-limits': dailyLimits,
          'daily-budget-usd': parsedDailyBudgetUsd ?? 0,
          'weekly-budget-usd': parsedWeeklyBudgetUsd ?? 0,
          'weekly-budget-anchor-at': weeklyBudgetAnchorValue,
          'model-routing': { rules: routingRuleDTOs },
          failover: {
            claude: {
              enabled: claudeFailoverEnabled,
              'target-model': claudeFailoverTargetModel,
              rules: failoverRuleDTOs,
            },
          },
        },
      });
      await loadAll();
      showNotification(t('notification.save_success', { defaultValue: '保存成功' }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t('notification.save_failed', { defaultValue: '保存失败' })}: ${message}`,
        'error'
      );
    }
  }, [
    allowOpus46,
    dailyBudgetEnabled,
    dailyBudgetUsd,
    claudeFailoverEnabled,
    claudeFailoverRules,
    claudeFailoverTargetModel,
    enableClaudeModels,
    fastMode,
    enableClaudeOpus1M,
    allowClaudeCategory,
    allowChatGPTCategory,
    excludedCustom,
    loadAll,
    modelRoutingRules,
    opus46DailyLimit,
    selectedKey,
    showNotification,
    t,
    upstreamBaseUrl,
    upstreamProxyEnabled,
    weeklyBudgetAnchorAt,
    weeklyBudgetEnabled,
    weeklyBudgetUsd,
  ]);

  const handleDelete = useCallback(async () => {
    const apiKey = selectedKey.trim();
    if (!apiKey) return;
    try {
      await apiKeyPoliciesApi.remove(apiKey);
      await loadAll();
      showNotification(t('notification.delete_success', { defaultValue: '删除成功' }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t('notification.delete_failed', { defaultValue: '删除失败' })}: ${message}`,
        'error'
      );
    }
  }, [loadAll, selectedKey, showNotification, t]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>
          {t('api_key_policies.title', { defaultValue: 'API Key 策略' })}
        </h1>
        <p className={styles.description}>
          {t('api_key_policies.description', {
            defaultValue:
              '面向中转站运营的 API Key 精细化控制台：集中管理模型访问、成本额度、上游转发、模型路由与故障切换。',
          })}
        </p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.grid}>
        <Card
          className={styles.panel}
          title={
            <div className={styles.cardTitle}>
              <IconKey size={18} />
              <span>{t('api_key_policies.policy_settings', { defaultValue: '策略设置' })}</span>
            </div>
          }
          extra={
            <span
              className={[styles.statusPill, selectedKey && currentPolicy ? styles.configured : '']
                .filter(Boolean)
                .join(' ')}
            >
              {!selectedKey
                ? t('api_key_policies.no_keys', { defaultValue: '暂无 API Key' })
                : currentPolicy
                  ? t('api_key_policies.policy_exists', { defaultValue: '该 Key 已配置策略' })
                  : t('api_key_policies.policy_default', {
                      defaultValue: '该 Key 使用默认策略（全允许）',
                    })}
            </span>
          }
        >
          <div className="form-group">
            <label>{t('api_key_policies.select_key', { defaultValue: '选择 API Key' })}</label>
            <div className={styles.selectWrap}>
              <select
                className={styles.select}
                value={selectedKey}
                disabled={disableControls || loading}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
                {apiKeys.length === 0 ? (
                  <option value="">
                    {t('api_key_policies.no_keys', { defaultValue: '暂无 API Key' })}
                  </option>
                ) : null}
                {apiKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <span className={styles.selectIcon}>
                <IconChevronDown size={16} />
              </span>
            </div>
          </div>

          <datalist id="codex-model-definitions">
            {codexModels.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>

          <div className={styles.tabBar}>
            <button
              type="button"
              className={[styles.tabItem, activeTab === 'basic' ? styles.tabActive : '']
                .filter(Boolean)
                .join(' ')}
              disabled={!selectedKey}
              onClick={() => handleTabChange('basic')}
            >
              {t('api_key_policies.tab_basic', { defaultValue: '基础' })}
            </button>
            <button
              type="button"
              className={[styles.tabItem, activeTab === 'routing' ? styles.tabActive : '']
                .filter(Boolean)
                .join(' ')}
              disabled={!selectedKey}
              onClick={() => handleTabChange('routing')}
            >
              {t('api_key_policies.tab_routing', { defaultValue: '路由' })}
            </button>
            <button
              type="button"
              className={[styles.tabItem, activeTab === 'failover' ? styles.tabActive : '']
                .filter(Boolean)
                .join(' ')}
              disabled={!selectedKey}
              onClick={() => handleTabChange('failover')}
            >
              {t('api_key_policies.tab_failover', { defaultValue: 'Failover' })}
            </button>
          </div>

          {activeTab === 'basic' ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  {t('api_key_policies.guardrails_title', { defaultValue: '访问与额度守卫' })}
                </h3>
              </div>
              <div className={styles.sectionHint}>
                {t('api_key_policies.guardrails_hint', {
                  defaultValue:
                    '建议先定义这个 API Key 的访问边界，再决定是否开放高成本模型与预算。次数限制与费用额度均由服务端持久化统计。',
                })}
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldText}>
                  <div className={styles.fieldLabel}>
                    {t('api_key_policies.fast_mode', {
                      defaultValue: 'Fast 模式（OpenAI / GPT 优先级）',
                    })}
                  </div>
                  <div className={styles.fieldHint}>
                    {t('api_key_policies.fast_mode_hint', {
                      defaultValue:
                        '开启后，当前客户端 API Key 命中的 OpenAI / GPT 请求会自动附带 service_tier=priority。适用于 gpt-5.4 等 OpenAI 侧优先级处理场景。',
                    })}
                  </div>
                </div>
                <ToggleSwitch
                  checked={fastMode}
                  onChange={setFastMode}
                  disabled={disableControls || !selectedKey}
                  ariaLabel={t('api_key_policies.fast_mode', {
                    defaultValue: 'Fast 模式（OpenAI / GPT 优先级）',
                  })}
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldText}>
                  <div className={styles.fieldLabel}>
                    {t('api_key_policies.enable_claude_models', {
                      defaultValue: '启用 Claude 模型',
                    })}
                  </div>
                  <div className={styles.fieldHint}>
                    {t('api_key_policies.enable_claude_models_hint', {
                      defaultValue:
                        '当系统页已开启“Claude 请求全局转 GPT”时，打开这里可让当前 API Key 继续使用 Claude 原模型。',
                    })}
                  </div>
                </div>
                <ToggleSwitch
                  checked={enableClaudeModels}
                  onChange={setEnableClaudeModels}
                  disabled={disableControls || !selectedKey}
                  ariaLabel={t('api_key_policies.enable_claude_models', {
                    defaultValue: '启用 Claude 模型',
                  })}
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldText}>
                  <div className={styles.fieldLabel}>
                    {t('api_key_policies.enable_claude_opus_1m', {
                      defaultValue: '允许 Opus 1M（覆盖全局）',
                    })}
                  </div>
                  <div className={styles.fieldHint}>
                    {t('api_key_policies.enable_claude_opus_1m_hint', {
                      defaultValue:
                        '当系统页已开启“默认禁用 Claude Opus 1M”时，打开这里可让当前 API Key 继续携带 Opus 1M 能力。',
                    })}
                  </div>
                </div>
                <ToggleSwitch
                  checked={enableClaudeOpus1M}
                  onChange={setEnableClaudeOpus1M}
                  disabled={disableControls || !selectedKey}
                  ariaLabel={t('api_key_policies.enable_claude_opus_1m', {
                    defaultValue: '允许 Opus 1M（覆盖全局）',
                  })}
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldText}>
                  <div className={styles.fieldLabel}>
                    {t('api_key_policies.allow_opus46', { defaultValue: '允许 claude-opus-4-6' })}
                  </div>
                  <div className={styles.fieldHint}>
                    {t('api_key_policies.allow_opus46_hint', {
                      defaultValue: '关闭后会自动降级到 claude-opus-4-5-20251101*',
                    })}
                  </div>
                </div>
                <ToggleSwitch
                  checked={allowOpus46}
                  onChange={setAllowOpus46}
                  disabled={disableControls || !selectedKey}
                  ariaLabel={t('api_key_policies.allow_opus46', {
                    defaultValue: '允许 claude-opus-4-6',
                  })}
                />
              </div>

              <Input
                label={t('api_key_policies.opus46_daily_limit', {
                  defaultValue: 'Opus 4.6 每日次数上限',
                })}
                hint={t('api_key_policies.opus46_daily_limit_hint', {
                  defaultValue: '留空=不限（UTC+8）',
                })}
                value={opus46DailyLimit}
                onChange={(e) => setOpus46DailyLimit(e.target.value)}
                placeholder={t('api_key_policies.unlimited', { defaultValue: '留空=不限' })}
                disabled={disableControls || !selectedKey}
              />

              <div className={styles.hint}>
                {t('api_key_policies.limit_note', {
                  defaultValue:
                    '每日次数按 UTC+8（中国标准时间）统计，服务端使用 SQLite 持久化计数。',
                })}
              </div>

              <div className={styles.budgetGrid}>
                <div className={styles.budgetCard}>
                  <div className={styles.budgetCardHeader}>
                    <div>
                      <div className={styles.budgetTitle}>
                        {t('api_key_policies.daily_budget_title', { defaultValue: '每日成本上限' })}
                      </div>
                      <div className={styles.budgetHint}>
                        {t('api_key_policies.daily_budget_hint', {
                          defaultValue: '按 UTC+8 自然日统计，达到上限后立即拒绝新请求。',
                        })}
                      </div>
                    </div>
                    <ToggleSwitch
                      checked={dailyBudgetEnabled}
                      onChange={setDailyBudgetEnabled}
                      disabled={disableControls || !selectedKey}
                      ariaLabel={t('api_key_policies.daily_budget_toggle', {
                        defaultValue: '启用每日成本上限',
                      })}
                    />
                  </div>
                  <Input
                    label={t('api_key_policies.daily_budget_input', {
                      defaultValue: '每日额度（USD）',
                    })}
                    hint={t('api_key_policies.daily_budget_input_hint', {
                      defaultValue: '支持整数或两位小数；留空或关闭即不限。',
                    })}
                    value={dailyBudgetUsd}
                    onChange={(e) => setDailyBudgetUsd(e.target.value)}
                    placeholder="100"
                    disabled={disableControls || !selectedKey || !dailyBudgetEnabled}
                  />
                </div>

                <div className={[styles.budgetCard, styles.budgetCardEmphasis].join(' ')}>
                  <div className={styles.budgetCardHeader}>
                    <div>
                      <div className={styles.budgetTitle}>
                        {t('api_key_policies.weekly_budget_title', {
                          defaultValue: '每周成本上限',
                        })}
                      </div>
                      <div className={styles.budgetHint}>
                        {t('api_key_policies.weekly_budget_hint', {
                          defaultValue: '按开始时间起算，连续 168 小时为一个预算窗口。',
                        })}
                      </div>
                    </div>
                    <ToggleSwitch
                      checked={weeklyBudgetEnabled}
                      onChange={setWeeklyBudgetEnabled}
                      disabled={disableControls || !selectedKey}
                      ariaLabel={t('api_key_policies.weekly_budget_toggle', {
                        defaultValue: '启用每周成本上限',
                      })}
                    />
                  </div>
                  <Input
                    label={t('api_key_policies.weekly_budget_input', {
                      defaultValue: '每周额度（USD）',
                    })}
                    hint={t('api_key_policies.weekly_budget_input_hint', {
                      defaultValue: '例如 400；按开始时间起算，持续 7 天。',
                    })}
                    value={weeklyBudgetUsd}
                    onChange={(e) => setWeeklyBudgetUsd(e.target.value)}
                    placeholder="400"
                    disabled={disableControls || !selectedKey || !weeklyBudgetEnabled}
                  />
                  <Input
                    type="datetime-local"
                    step={3600}
                    label={t('api_key_policies.weekly_budget_anchor_label', {
                      defaultValue: '开始时间',
                    })}
                    hint={t('api_key_policies.weekly_budget_anchor_hint', {
                      defaultValue: '默认取当前小时；可自定义到整点，窗口固定为 168 小时滚动。',
                    })}
                    value={weeklyBudgetAnchorAt}
                    onChange={(e) =>
                      setWeeklyBudgetAnchorAt(normalizeHourInputValue(e.target.value))
                    }
                    disabled={disableControls || !selectedKey || !weeklyBudgetEnabled}
                  />
                  {weeklyBudgetEnabled ? (
                    <div className={styles.budgetFootnote}>
                      {t('api_key_policies.weekly_budget_window', {
                        defaultValue: '当前窗口：{{window}}',
                        window:
                          buildWeeklyBudgetWindowLabel(weeklyBudgetAnchorAt) ||
                          t('api_key_policies.weekly_budget_window_pending', {
                            defaultValue: '等待选择开始时间',
                          }),
                      })}
                    </div>
                  ) : null}
                  <div className={styles.budgetFootnote}>
                    {t('api_key_policies.weekly_budget_note', {
                      defaultValue:
                        '系统会基于后端持久化 billing 数据判断是否超额，容器重启后不会丢失历史周用量。',
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'routing' ? (
            <>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h3 className={styles.sectionTitle}>
                    {t('api_key_policies.upstream_proxy_title', {
                      defaultValue: '上游代理（按 API Key）',
                    })}
                  </h3>
                </div>
                <div className={styles.sectionHint}>
                  {t('api_key_policies.upstream_proxy_hint', {
                    defaultValue:
                      '启用后，该 Key 的 /v1/* 请求会直接转发到此 base-url（把它当成服务商地址）。示例：/v1/models → <base>/v1/models',
                  })}
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.fieldText}>
                    <div className={styles.fieldLabel}>
                      {t('api_key_policies.upstream_proxy_enabled', {
                        defaultValue: '启用上游代理转发',
                      })}
                    </div>
                    <div className={styles.fieldHint}>
                      {t('api_key_policies.upstream_proxy_enabled_hint', {
                        defaultValue:
                          '启用后将跳过本机的模型路由/Failover 执行逻辑；如需这些能力请在目标代理上配置。',
                      })}
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={upstreamProxyEnabled}
                    onChange={setUpstreamProxyEnabled}
                    disabled={disableControls || !selectedKey}
                    ariaLabel={t('api_key_policies.upstream_proxy_enabled', {
                      defaultValue: '启用上游代理转发',
                    })}
                  />
                </div>

                <Input
                  label={t('api_key_policies.upstream_proxy_base_url', {
                    defaultValue: 'upstream base-url',
                  })}
                  hint={t('api_key_policies.upstream_proxy_base_url_hint', {
                    defaultValue: '例如 http://IP:8001 或 http://IP:8001/v1',
                  })}
                  value={upstreamBaseUrl}
                  onChange={(e) => setUpstreamBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8001/v1"
                  disabled={disableControls || !selectedKey || !upstreamProxyEnabled}
                />
              </div>

              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h3 className={styles.sectionTitle}>
                    {t('api_key_policies.routing_title', {
                      defaultValue: '模型路由（按时间窗口比例）',
                    })}
                  </h3>
                  <div className={styles.ruleActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={routingControlsDisabled}
                      onClick={() =>
                        upsertPresetRoutingRule(OPUS_46_RULE_PATTERN, GPT54_HIGH_TARGET)
                      }
                    >
                      {t('api_key_policies.routing_add_opus46', { defaultValue: 'Opus 4.6' })}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={routingControlsDisabled}
                      onClick={() =>
                        upsertPresetRoutingRule(SONNET_46_RULE_PATTERN, DEFAULT_GPT54_TARGET)
                      }
                    >
                      {t('api_key_policies.routing_add_sonnet46', { defaultValue: 'Sonnet 4.6' })}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={routingControlsDisabled}
                      onClick={() =>
                        addRoutingRule({
                          fromModel: 'claude-*',
                          targetModel: DEFAULT_GPT54_TARGET,
                          targetPercent: 50,
                          stickyWindowSeconds: DEFAULT_STICKY_WINDOW_SECONDS,
                        })
                      }
                    >
                      {t('api_key_policies.routing_add_rule', { defaultValue: '新增规则' })}
                    </Button>
                  </div>
                </div>
                <div className={styles.sectionHint}>
                  {t('api_key_policies.routing_hint', {
                    defaultValue:
                      '同一时间窗口内固定使用一个模型；target-percent 表示“窗口占比”。例如 50% + 1h 通常表现为按小时交替。',
                  })}
                </div>

                {upstreamProxyActive ? (
                  <div className={styles.hint}>
                    {t('api_key_policies.upstream_proxy_conflict_note', {
                      defaultValue:
                        '已启用上游代理转发，本机模型路由不会执行；请在目标代理上配置路由规则。',
                    })}
                  </div>
                ) : null}

                {modelRoutingRules.length === 0 ? (
                  <div className={styles.hint}>
                    {t('api_key_policies.routing_empty', {
                      defaultValue: '未配置路由规则；默认不做模型改写。',
                    })}
                  </div>
                ) : (
                  <div className={styles.routeRuleList}>
                    {modelRoutingRules.map((r, idx) => (
                      <div key={`${r.fromModel}-${idx}`} className={styles.routeRuleRow}>
                        <div className={styles.routeRuleHeader}>
                          <div className={styles.routeRuleToggle}>
                            <ToggleSwitch
                              checked={Boolean(r.enabled)}
                              onChange={(enabled) => updateRoutingRule(idx, { enabled })}
                              disabled={routingControlsDisabled}
                              ariaLabel={t('api_key_policies.routing_enabled', {
                                defaultValue: '启用',
                              })}
                            />
                            <div className={styles.hint}>
                              {t('api_key_policies.routing_enabled', { defaultValue: '启用' })}
                            </div>
                          </div>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={routingControlsDisabled}
                            onClick={() => removeRoutingRule(idx)}
                          >
                            {t('common.delete', { defaultValue: '删除' })}
                          </Button>
                        </div>

                        <div className={styles.routeRuleInputs}>
                          <Input
                            value={r.fromModel}
                            onChange={(e) => updateRoutingRule(idx, { fromModel: e.target.value })}
                            placeholder={t('api_key_policies.routing_from_placeholder', {
                              defaultValue: 'from-model，例如 claude-opus-4-6*',
                            })}
                            disabled={routingControlsDisabled}
                          />
                          <Input
                            value={r.targetModel}
                            onChange={(e) =>
                              updateRoutingRule(idx, { targetModel: e.target.value })
                            }
                            placeholder={t('api_key_policies.routing_target_placeholder', {
                              defaultValue: 'target-model，例如 gpt-5.4(medium)',
                            })}
                            disabled={routingControlsDisabled}
                            list="codex-model-definitions"
                          />
                        </div>
                        <div className={styles.quickPick}>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={routingControlsDisabled}
                            onClick={() =>
                              updateRoutingRule(idx, { targetModel: DEFAULT_GPT54_TARGET })
                            }
                          >
                            gpt-5.4(medium)
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={routingControlsDisabled}
                            onClick={() =>
                              updateRoutingRule(idx, { targetModel: GPT54_HIGH_TARGET })
                            }
                          >
                            gpt-5.4(high)
                          </Button>
                        </div>

                        <div className={styles.routeRuleParams}>
                          <div className={styles.routeRuleParam}>
                            <div className={styles.sectionHint}>
                              {t('api_key_policies.routing_percent', {
                                defaultValue: 'target-percent(%)',
                              })}
                            </div>
                            <Input
                              value={String(r.targetPercent ?? 0)}
                              onChange={(e) =>
                                updateRoutingRule(idx, {
                                  targetPercent: clampInt(e.target.value, 0, 100, 0),
                                })
                              }
                              disabled={routingControlsDisabled}
                            />
                          </div>

                          <div className={styles.routeRuleParam}>
                            <div className={styles.sectionHint}>
                              {t('api_key_policies.routing_window', {
                                defaultValue: 'sticky-window',
                              })}
                            </div>
                            <div className={styles.selectWrap}>
                              <select
                                className={styles.select}
                                value={String(
                                  r.stickyWindowSeconds ?? DEFAULT_STICKY_WINDOW_SECONDS
                                )}
                                disabled={routingControlsDisabled}
                                onChange={(e) =>
                                  updateRoutingRule(idx, {
                                    stickyWindowSeconds: clampInt(
                                      e.target.value,
                                      1,
                                      3600 * 24 * 30,
                                      DEFAULT_STICKY_WINDOW_SECONDS
                                    ),
                                  })
                                }
                              >
                                <option value="1800">
                                  {t('api_key_policies.routing_window_30m', {
                                    defaultValue: '30 分钟',
                                  })}
                                </option>
                                <option value="3600">
                                  {t('api_key_policies.routing_window_1h', {
                                    defaultValue: '1 小时',
                                  })}
                                </option>
                                <option value="7200">
                                  {t('api_key_policies.routing_window_2h', {
                                    defaultValue: '2 小时',
                                  })}
                                </option>
                                <option value="14400">
                                  {t('api_key_policies.routing_window_4h', {
                                    defaultValue: '4 小时',
                                  })}
                                </option>
                                <option value="28800">
                                  {t('api_key_policies.routing_window_8h', {
                                    defaultValue: '8 小时',
                                  })}
                                </option>
                                <option value="86400">
                                  {t('api_key_policies.routing_window_24h', {
                                    defaultValue: '24 小时',
                                  })}
                                </option>
                              </select>
                              <span className={styles.selectIcon}>
                                <IconChevronDown size={16} />
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}

          {activeTab === 'failover' ? (
            <div className={styles.section}>
              <div className={styles.fieldRow}>
                <div className={styles.fieldText}>
                  <div className={styles.fieldLabel}>
                    {t('api_key_policies.claude_failover', {
                      defaultValue: 'Claude 不可用时自动切换',
                    })}
                  </div>
                  <div className={styles.fieldHint}>
                    {t('api_key_policies.failover_note', {
                      defaultValue:
                        '当 Claude 返回限额/鉴权/账号异常等错误时，会自动重试到目标模型（建议 Codex）。',
                    })}
                  </div>
                </div>
                <ToggleSwitch
                  checked={claudeFailoverEnabled}
                  onChange={setClaudeFailoverEnabled}
                  disabled={failoverControlsDisabled}
                  ariaLabel={t('api_key_policies.claude_failover', {
                    defaultValue: 'Claude 不可用时自动切换',
                  })}
                />
              </div>

              {upstreamProxyActive ? (
                <div className={styles.hint}>
                  {t('api_key_policies.upstream_proxy_failover_note', {
                    defaultValue:
                      '已启用上游代理转发，本机 Failover 不会执行；请在目标代理上配置 Failover。',
                  })}
                </div>
              ) : null}

              <Input
                label={t('api_key_policies.failover_target', { defaultValue: '默认目标模型' })}
                hint={t('api_key_policies.failover_target_hint', {
                  defaultValue: '规则未命中时使用；建议选择 Codex 模型。',
                })}
                value={claudeFailoverTargetModel}
                onChange={(e) => setClaudeFailoverTargetModel(e.target.value)}
                placeholder={t('api_key_policies.failover_target_placeholder', {
                  defaultValue: '默认 gpt-5.4(medium)',
                })}
                disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                list="codex-model-definitions"
              />
              <div className={styles.quickPick}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                  onClick={() => setClaudeFailoverTargetModel(DEFAULT_GPT54_TARGET)}
                >
                  gpt-5.4(medium)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                  onClick={() => setClaudeFailoverTargetModel(GPT54_HIGH_TARGET)}
                >
                  gpt-5.4(high)
                </Button>
              </div>

              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  {t('api_key_policies.failover_rules_title', {
                    defaultValue: '按模型覆盖（可选）',
                  })}
                </h3>
                <div className={styles.ruleActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                    onClick={() => upsertPresetRule(OPUS_46_RULE_PATTERN, GPT54_HIGH_TARGET)}
                  >
                    {t('api_key_policies.add_opus46_rule', { defaultValue: '添加 Opus 4.6' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                    onClick={() => upsertPresetRule(SONNET_46_RULE_PATTERN, DEFAULT_GPT54_TARGET)}
                  >
                    {t('api_key_policies.add_sonnet46_rule', { defaultValue: '添加 Sonnet 4.6' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                    onClick={() =>
                      addFailoverRule({ fromModel: 'claude-*', targetModel: DEFAULT_GPT54_TARGET })
                    }
                  >
                    {t('api_key_policies.add_rule', { defaultValue: '新增规则' })}
                  </Button>
                </div>
              </div>

              {claudeFailoverRules.length === 0 ? (
                <div className={styles.hint}>
                  {t('api_key_policies.failover_rules_empty', {
                    defaultValue: '未配置规则；留空时将使用上面的默认目标模型。',
                  })}
                </div>
              ) : (
                <div className={styles.ruleList}>
                  {claudeFailoverRules.map((r, idx) => (
                    <div key={`${r.fromModel}-${idx}`} className={styles.ruleRow}>
                      <div className={styles.ruleInputs}>
                        <Input
                          value={r.fromModel}
                          onChange={(e) => updateFailoverRule(idx, { fromModel: e.target.value })}
                          placeholder={t('api_key_policies.failover_rule_from_placeholder', {
                            defaultValue: 'from-model，例如 claude-opus-4-6*',
                          })}
                          disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                        />
                        <Input
                          value={r.targetModel}
                          onChange={(e) => updateFailoverRule(idx, { targetModel: e.target.value })}
                          placeholder={t('api_key_policies.failover_rule_target_placeholder', {
                            defaultValue: 'target-model，例如 gpt-5.4(medium)',
                          })}
                          disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                          list="codex-model-definitions"
                        />
                      </div>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={failoverControlsDisabled || !claudeFailoverEnabled}
                        onClick={() => removeFailoverRule(idx)}
                      >
                        {t('common.delete', { defaultValue: '删除' })}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button onClick={handleSave} disabled={disableControls || !selectedKey || loading}>
              <span className={styles.buttonContent}>
                <IconCheck size={16} />
                {t('common.save', { defaultValue: '保存' })}
              </span>
            </Button>
            <Button variant="secondary" onClick={loadAll} disabled={disableControls || loading}>
              <span className={styles.buttonContent}>
                <IconRefreshCw size={16} />
                {t('common.refresh', { defaultValue: '刷新' })}
              </span>
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={disableControls || !selectedKey}
            >
              <span className={styles.buttonContent}>
                <IconTrash2 size={16} />
                {t('common.delete', { defaultValue: '删除策略' })}
              </span>
            </Button>
          </div>
        </Card>

        <Card
          className={styles.panel}
          title={t('api_key_policies.models_title', { defaultValue: '模型访问分类' })}
          extra={
            <span className={styles.statusPill}>
              {t('api_key_policies.models_allowed_count', {
                defaultValue: '已允许 {{allowed}}/{{total}} 类',
                allowed: allowedCategoryCount,
                total: 2,
              })}
            </span>
          }
        >
          <div className={styles.hint}>
            {t('api_key_policies.models_hint', {
              defaultValue:
                '默认两类都允许；关闭某一类后会自动写入对应的 excluded-models 通配规则。这里只限制客户端传入的模型名，不影响后续路由与 failover 目标；额外自定义排除项会继续保留。',
            })}
          </div>

          <div className={styles.section}>
            <div className={styles.fieldRow}>
              <div className={styles.fieldText}>
                <div className={styles.fieldLabel}>
                  {t('api_key_policies.category_claude', { defaultValue: 'Claude 系列' })}
                </div>
                <div className={styles.fieldHint}>
                  {t('api_key_policies.category_claude_hint', {
                    defaultValue: '对应 excluded-models: claude-*',
                  })}
                </div>
              </div>
              <ToggleSwitch
                checked={allowClaudeCategory}
                onChange={(value) => toggleCategoryAllowed('claude', value)}
                disabled={disableControls || !selectedKey}
                ariaLabel={t('api_key_policies.category_claude', {
                  defaultValue: 'Claude 系列',
                })}
              />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.fieldText}>
                <div className={styles.fieldLabel}>
                  {t('api_key_policies.category_chatgpt', { defaultValue: 'ChatGPT / GPT 系列' })}
                </div>
                <div className={styles.fieldHint}>
                  {t('api_key_policies.category_chatgpt_hint', {
                    defaultValue: '对应 excluded-models: gpt-*, chatgpt-*, o1*, o3*, o4*',
                  })}
                </div>
              </div>
              <ToggleSwitch
                checked={allowChatGPTCategory}
                onChange={(value) => toggleCategoryAllowed('chatgpt', value)}
                disabled={disableControls || !selectedKey}
                ariaLabel={t('api_key_policies.category_chatgpt', {
                  defaultValue: 'ChatGPT / GPT 系列',
                })}
              />
            </div>
          </div>

          {excludedCustom.length > 0 ? (
            <div className={styles.hint}>
              {t('api_key_policies.custom_excluded', {
                defaultValue: '仍保留其他 excluded-models 项：',
              })}{' '}
              {excludedCustom.join(', ')}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
