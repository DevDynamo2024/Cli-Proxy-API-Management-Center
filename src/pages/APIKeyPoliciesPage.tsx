/**
 * API key policies management page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconCheck, IconChevronDown, IconKey, IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore } from '@/stores';
import { apiKeysApi, apiKeyPoliciesApi, authFilesApi } from '@/services/api';
import type { ApiKeyPolicy, ModelFailoverRule, ModelRoutingRule } from '@/services/api/apiKeyPolicies';
import styles from './APIKeyPoliciesPage.module.scss';

type ModelDef = { id: string; display_name?: string };
type PolicyTab = 'basic' | 'routing' | 'failover';

const OPUS_46_ID = 'claude-opus-4-6';
const OPUS_46_RULE_PATTERN = 'claude-opus-4-6*';
const SONNET_46_RULE_PATTERN = 'claude-sonnet-4-6*';
const DEFAULT_STICKY_WINDOW_SECONDS = 3600;

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

function parsePositiveInt(text: string): number | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
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
      stickyWindowSeconds: clampInt(r?.stickyWindowSeconds, 1, 3600 * 24 * 30, DEFAULT_STICKY_WINDOW_SECONDS)
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
  const [claudeModels, setClaudeModels] = useState<ModelDef[]>([]);
  const [codexModels, setCodexModels] = useState<ModelDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedKey, setSelectedKey] = useState('');
  const [activeTab, setActiveTab] = useState<PolicyTab>(() => {
    const saved = localStorage.getItem('api-key-policies:tab');
    if (saved === 'basic' || saved === 'routing' || saved === 'failover') return saved;
    return 'basic';
  });
  const [allowOpus46, setAllowOpus46] = useState(true);
  const [opus46DailyLimit, setOpus46DailyLimit] = useState('');
  const [excludedExact, setExcludedExact] = useState<Set<string>>(new Set());
  const [excludedCustom, setExcludedCustom] = useState<string[]>([]);
  const [modelRoutingRules, setModelRoutingRules] = useState<ModelRoutingRule[]>([]);
  const [claudeFailoverEnabled, setClaudeFailoverEnabled] = useState(false);
  const [claudeFailoverTargetModel, setClaudeFailoverTargetModel] = useState('gpt-5.2(high)');
  const [claudeFailoverRules, setClaudeFailoverRules] = useState<ModelFailoverRule[]>([]);

  const claudeModelIdSet = useMemo(() => new Set(claudeModels.map((m) => m.id)), [claudeModels]);

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
      const [keys, policyList, models, codexDefs] = await Promise.all([
        apiKeysApi.list(),
        apiKeyPoliciesApi.list(),
        authFilesApi.getModelDefinitions('claude'),
        authFilesApi.getModelDefinitions('codex')
      ]);
      const normalizedKeys = uniqStrings(keys);
      setApiKeys(normalizedKeys);
      setPolicies(policyList);
      setClaudeModels(
        (models || [])
          .map((m) => ({ id: String(m.id ?? '').trim(), display_name: m.display_name }))
          .filter((m) => m.id)
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
        err instanceof Error ? err.message : t('notification.refresh_failed', { defaultValue: '刷新失败' });
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
        excludedModels: [],
        allowClaudeOpus46: true,
        dailyLimits: {},
        modelRoutingRules: [],
        claudeFailoverEnabled: false,
        claudeFailoverTargetModel: 'gpt-5.2(high)',
        claudeFailoverRules: []
      } as ApiKeyPolicy);

    setAllowOpus46(p.allowClaudeOpus46 ?? true);
    setClaudeFailoverEnabled(Boolean(p.claudeFailoverEnabled));
    setClaudeFailoverTargetModel(String(p.claudeFailoverTargetModel ?? '').trim() || 'gpt-5.2(high)');
    setClaudeFailoverRules(sanitizeFailoverRules(p.claudeFailoverRules ?? []));
    setModelRoutingRules(sanitizeRoutingRules(p.modelRoutingRules ?? []));

    const limit = p.dailyLimits?.[OPUS_46_ID] ?? p.dailyLimits?.[OPUS_46_ID.toLowerCase()];
    setOpus46DailyLimit(limit && Number.isFinite(limit) ? String(limit) : '');

    const excluded = uniqStrings(p.excludedModels || []);
    const custom = excluded.filter((x) => x.includes('*') || !claudeModelIdSet.has(x));
    const exact = excluded.filter((x) => !x.includes('*') && claudeModelIdSet.has(x));

    setExcludedCustom(custom);
    setExcludedExact(new Set(exact));
  }, [claudeModelIdSet, policies, selectedKey]);

  const toggleModelAllowed = useCallback((modelId: string, allowed: boolean) => {
    setExcludedExact((prev) => {
      const next = new Set(prev);
      if (allowed) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
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
      { fromModel: String(rule?.fromModel ?? '').trim(), targetModel: String(rule?.targetModel ?? '').trim() }
    ]);
  }, []);

  const upsertPresetRule = useCallback((fromModel: string, defaultTargetModel: string) => {
    const key = String(fromModel ?? '').trim();
    if (!key) return;
    setClaudeFailoverRules((prev) => {
      const normalized = key.toLowerCase();
      const i = prev.findIndex((r) => String(r?.fromModel ?? '').trim().toLowerCase() === normalized);
      if (i >= 0) {
        const next = prev.slice();
        next[i] = {
          ...next[i],
          targetModel: String(next[i].targetModel ?? '').trim() || String(defaultTargetModel ?? '').trim()
        };
        return next;
      }
      return [
        ...prev,
        {
          fromModel: key,
          targetModel: String(defaultTargetModel ?? '').trim()
        }
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
        stickyWindowSeconds: clampInt(rule?.stickyWindowSeconds, 1, 3600 * 24 * 30, DEFAULT_STICKY_WINDOW_SECONDS)
      }
    ]);
  }, []);

  const upsertPresetRoutingRule = useCallback((fromModel: string, defaultTargetModel: string) => {
    const key = String(fromModel ?? '').trim();
    if (!key) return;
    setModelRoutingRules((prev) => {
      const normalized = key.toLowerCase();
      const i = prev.findIndex((r) => String(r?.fromModel ?? '').trim().toLowerCase() === normalized);
      if (i >= 0) {
        const next = prev.slice();
        next[i] = {
          ...next[i],
          enabled: true,
          targetModel: String(next[i].targetModel ?? '').trim() || String(defaultTargetModel ?? '').trim(),
          stickyWindowSeconds: next[i].stickyWindowSeconds || DEFAULT_STICKY_WINDOW_SECONDS
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
          stickyWindowSeconds: DEFAULT_STICKY_WINDOW_SECONDS
        }
      ];
    });
  }, []);

  const handleSave = useCallback(async () => {
    const apiKey = selectedKey.trim();
    if (!apiKey) return;

    const dailyLimit = parsePositiveInt(opus46DailyLimit);
    const dailyLimits: Record<string, number> = {};
    if (dailyLimit) dailyLimits[OPUS_46_ID] = dailyLimit;

    const excludedModels = uniqStrings([...excludedCustom, ...Array.from(excludedExact)]);
    const rules = sanitizeFailoverRules(claudeFailoverRules);
    const routingRules = sanitizeRoutingRules(modelRoutingRules);

    try {
      await apiKeyPoliciesApi.upsert({
        apiKey,
        allowClaudeOpus46: allowOpus46,
        excludedModels,
        dailyLimits,
        modelRoutingRules: routingRules,
        claudeFailoverEnabled,
        claudeFailoverTargetModel,
        claudeFailoverRules: rules
      });
      await loadAll();
      showNotification(t('notification.save_success', { defaultValue: '保存成功' }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showNotification(`${t('notification.save_failed', { defaultValue: '保存失败' })}: ${message}`, 'error');
    }
  }, [
    allowOpus46,
    claudeFailoverEnabled,
    claudeFailoverRules,
    claudeFailoverTargetModel,
    excludedCustom,
    excludedExact,
    loadAll,
    modelRoutingRules,
    opus46DailyLimit,
    selectedKey,
    showNotification,
    t
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
      showNotification(`${t('notification.delete_failed', { defaultValue: '删除失败' })}: ${message}`, 'error');
    }
  }, [loadAll, selectedKey, showNotification, t]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('api_key_policies.title', { defaultValue: 'API Key 策略' })}</h1>
        <p className={styles.description}>
          {t('api_key_policies.description', {
            defaultValue: '按不同 API Key 限制可用模型、配置模型路由/Failover、Opus 4.6 访问与每日次数上限（UTC+8）'
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
              className={[
                styles.statusPill,
                selectedKey && currentPolicy ? styles.configured : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {!selectedKey
                ? t('api_key_policies.no_keys', { defaultValue: '暂无 API Key' })
                : currentPolicy
                  ? t('api_key_policies.policy_exists', { defaultValue: '该 Key 已配置策略' })
                  : t('api_key_policies.policy_default', { defaultValue: '该 Key 使用默认策略（全允许）' })}
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
                  <option value="">{t('api_key_policies.no_keys', { defaultValue: '暂无 API Key' })}</option>
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
              className={[styles.tabItem, activeTab === 'basic' ? styles.tabActive : ''].filter(Boolean).join(' ')}
              disabled={!selectedKey}
              onClick={() => handleTabChange('basic')}
            >
              {t('api_key_policies.tab_basic', { defaultValue: '基础' })}
            </button>
            <button
              type="button"
              className={[
                styles.tabItem,
                activeTab === 'routing' ? styles.tabActive : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!selectedKey}
              onClick={() => handleTabChange('routing')}
            >
              {t('api_key_policies.tab_routing', { defaultValue: '路由' })}
            </button>
            <button
              type="button"
              className={[
                styles.tabItem,
                activeTab === 'failover' ? styles.tabActive : '',
              ]
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
              <div className={styles.fieldRow}>
                <div className={styles.fieldText}>
                  <div className={styles.fieldLabel}>
                    {t('api_key_policies.allow_opus46', { defaultValue: '允许 claude-opus-4-6' })}
                  </div>
                  <div className={styles.fieldHint}>
                    {t('api_key_policies.allow_opus46_hint', {
                      defaultValue: '关闭后会自动降级到 claude-opus-4-5-20251101*'
                    })}
                  </div>
                </div>
                <ToggleSwitch
                  checked={allowOpus46}
                  onChange={setAllowOpus46}
                  disabled={disableControls || !selectedKey}
                  ariaLabel={t('api_key_policies.allow_opus46', { defaultValue: '允许 claude-opus-4-6' })}
                />
              </div>

              <Input
                label={t('api_key_policies.opus46_daily_limit', { defaultValue: 'Opus 4.6 每日次数上限' })}
                hint={t('api_key_policies.opus46_daily_limit_hint', { defaultValue: '留空=不限（UTC+8）' })}
                value={opus46DailyLimit}
                onChange={(e) => setOpus46DailyLimit(e.target.value)}
                placeholder={t('api_key_policies.unlimited', { defaultValue: '留空=不限' })}
                disabled={disableControls || !selectedKey}
              />

              <div className={styles.hint}>
                {t('api_key_policies.limit_note', {
                  defaultValue: '每日次数按 UTC+8（中国标准时间）统计，服务端使用 SQLite 持久化计数。'
                })}
              </div>
            </div>
          ) : null}

          {activeTab === 'routing' ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  {t('api_key_policies.routing_title', { defaultValue: '模型路由（按时间窗口比例）' })}
                </h3>
                <div className={styles.ruleActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disableControls || !selectedKey}
                    onClick={() => upsertPresetRoutingRule(OPUS_46_RULE_PATTERN, 'gpt-5.2(high)')}
                  >
                    {t('api_key_policies.routing_add_opus46', { defaultValue: 'Opus 4.6' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disableControls || !selectedKey}
                    onClick={() => upsertPresetRoutingRule(SONNET_46_RULE_PATTERN, 'gpt-5.3-codex(high)')}
                  >
                    {t('api_key_policies.routing_add_sonnet46', { defaultValue: 'Sonnet 4.6' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disableControls || !selectedKey}
                    onClick={() =>
                      addRoutingRule({
                        fromModel: 'claude-*',
                        targetModel: 'gpt-5.2(high)',
                        targetPercent: 50,
                        stickyWindowSeconds: DEFAULT_STICKY_WINDOW_SECONDS
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
                    '同一时间窗口内固定使用一个模型；target-percent 表示“窗口占比”。例如 50% + 1h 通常表现为按小时交替。'
                })}
              </div>

              {modelRoutingRules.length === 0 ? (
                <div className={styles.hint}>
                  {t('api_key_policies.routing_empty', { defaultValue: '未配置路由规则；默认不做模型改写。' })}
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
                            disabled={disableControls || !selectedKey}
                            ariaLabel={t('api_key_policies.routing_enabled', { defaultValue: '启用' })}
                          />
                          <div className={styles.hint}>
                            {t('api_key_policies.routing_enabled', { defaultValue: '启用' })}
                          </div>
                        </div>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={disableControls || !selectedKey}
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
                            defaultValue: 'from-model，例如 claude-opus-4-6*'
                          })}
                          disabled={disableControls || !selectedKey}
                        />
                        <Input
                          value={r.targetModel}
                          onChange={(e) => updateRoutingRule(idx, { targetModel: e.target.value })}
                          placeholder={t('api_key_policies.routing_target_placeholder', {
                            defaultValue: 'target-model，例如 gpt-5.2(high)'
                          })}
                          disabled={disableControls || !selectedKey}
                          list="codex-model-definitions"
                        />
                      </div>
                      <div className={styles.quickPick}>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={disableControls || !selectedKey}
                          onClick={() => updateRoutingRule(idx, { targetModel: 'gpt-5.2(high)' })}
                        >
                          gpt-5.2(high)
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={disableControls || !selectedKey}
                          onClick={() => updateRoutingRule(idx, { targetModel: 'gpt-5.3-codex(high)' })}
                        >
                          gpt-5.3-codex(high)
                        </Button>
                      </div>

                      <div className={styles.routeRuleParams}>
                        <div className={styles.routeRuleParam}>
                          <div className={styles.sectionHint}>
                            {t('api_key_policies.routing_percent', { defaultValue: 'target-percent(%)' })}
                          </div>
                          <Input
                            value={String(r.targetPercent ?? 0)}
                            onChange={(e) =>
                              updateRoutingRule(idx, { targetPercent: clampInt(e.target.value, 0, 100, 0) })
                            }
                            disabled={disableControls || !selectedKey}
                          />
                        </div>

                        <div className={styles.routeRuleParam}>
                          <div className={styles.sectionHint}>
                            {t('api_key_policies.routing_window', { defaultValue: 'sticky-window' })}
                          </div>
                          <div className={styles.selectWrap}>
                            <select
                              className={styles.select}
                              value={String(r.stickyWindowSeconds ?? DEFAULT_STICKY_WINDOW_SECONDS)}
                              disabled={disableControls || !selectedKey}
                              onChange={(e) =>
                                updateRoutingRule(idx, {
                                  stickyWindowSeconds: clampInt(
                                    e.target.value,
                                    1,
                                    3600 * 24 * 30,
                                    DEFAULT_STICKY_WINDOW_SECONDS
                                  )
                                })
                              }
                            >
                              <option value="1800">
                                {t('api_key_policies.routing_window_30m', { defaultValue: '30 分钟' })}
                              </option>
                              <option value="3600">
                                {t('api_key_policies.routing_window_1h', { defaultValue: '1 小时' })}
                              </option>
                              <option value="7200">
                                {t('api_key_policies.routing_window_2h', { defaultValue: '2 小时' })}
                              </option>
                              <option value="14400">
                                {t('api_key_policies.routing_window_4h', { defaultValue: '4 小时' })}
                              </option>
                              <option value="28800">
                                {t('api_key_policies.routing_window_8h', { defaultValue: '8 小时' })}
                              </option>
                              <option value="86400">
                                {t('api_key_policies.routing_window_24h', { defaultValue: '24 小时' })}
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
          ) : null}

          {activeTab === 'failover' ? (
            <div className={styles.section}>
              <div className={styles.fieldRow}>
                <div className={styles.fieldText}>
                  <div className={styles.fieldLabel}>
                    {t('api_key_policies.claude_failover', { defaultValue: 'Claude 不可用时自动切换' })}
                  </div>
                  <div className={styles.fieldHint}>
                    {t('api_key_policies.failover_note', {
                      defaultValue: '当 Claude 返回限额/鉴权/账号异常等错误时，会自动重试到目标模型（建议 Codex）。'
                    })}
                  </div>
                </div>
                <ToggleSwitch
                  checked={claudeFailoverEnabled}
                  onChange={setClaudeFailoverEnabled}
                  disabled={disableControls || !selectedKey}
                  ariaLabel={t('api_key_policies.claude_failover', { defaultValue: 'Claude 不可用时自动切换' })}
                />
              </div>

              <Input
                label={t('api_key_policies.failover_target', { defaultValue: '默认目标模型' })}
                hint={t('api_key_policies.failover_target_hint', {
                  defaultValue: '规则未命中时使用；建议选择 Codex 模型。'
                })}
                value={claudeFailoverTargetModel}
                onChange={(e) => setClaudeFailoverTargetModel(e.target.value)}
                placeholder={t('api_key_policies.failover_target_placeholder', { defaultValue: '默认 gpt-5.2(high)' })}
                disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
                list="codex-model-definitions"
              />
              <div className={styles.quickPick}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
                  onClick={() => setClaudeFailoverTargetModel('gpt-5.2(high)')}
                >
                  gpt-5.2(high)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
                  onClick={() => setClaudeFailoverTargetModel('gpt-5.3-codex(high)')}
                >
                  gpt-5.3-codex(high)
                </Button>
              </div>

              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  {t('api_key_policies.failover_rules_title', { defaultValue: '按模型覆盖（可选）' })}
                </h3>
                <div className={styles.ruleActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
                    onClick={() => upsertPresetRule(OPUS_46_RULE_PATTERN, 'gpt-5.2(high)')}
                  >
                    {t('api_key_policies.add_opus46_rule', { defaultValue: '添加 Opus 4.6' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
                    onClick={() => upsertPresetRule(SONNET_46_RULE_PATTERN, 'gpt-5.3-codex(high)')}
                  >
                    {t('api_key_policies.add_sonnet46_rule', { defaultValue: '添加 Sonnet 4.6' })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
                    onClick={() => addFailoverRule({ fromModel: 'claude-*', targetModel: 'gpt-5.2(high)' })}
                  >
                    {t('api_key_policies.add_rule', { defaultValue: '新增规则' })}
                  </Button>
                </div>
              </div>

              {claudeFailoverRules.length === 0 ? (
                <div className={styles.hint}>
                  {t('api_key_policies.failover_rules_empty', {
                    defaultValue: '未配置规则；留空时将使用上面的默认目标模型。'
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
                            defaultValue: 'from-model，例如 claude-opus-4-6*'
                          })}
                          disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
                        />
                        <Input
                          value={r.targetModel}
                          onChange={(e) => updateFailoverRule(idx, { targetModel: e.target.value })}
                          placeholder={t('api_key_policies.failover_rule_target_placeholder', {
                            defaultValue: 'target-model，例如 gpt-5.2(high)'
                          })}
                          disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
                          list="codex-model-definitions"
                        />
                      </div>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
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
            <Button variant="danger" onClick={handleDelete} disabled={disableControls || !selectedKey}>
              <span className={styles.buttonContent}>
                <IconTrash2 size={16} />
                {t('common.delete', { defaultValue: '删除策略' })}
              </span>
            </Button>
          </div>
        </Card>

        <Card
          className={styles.panel}
          title={t('api_key_policies.models_title', { defaultValue: 'Claude 模型访问' })}
          extra={
            claudeModels.length > 0 ? (
              <span className={styles.statusPill}>
                {t('api_key_policies.models_allowed_count', {
                  defaultValue: '已允许 {{allowed}}/{{total}}',
                  allowed: claudeModels.length - excludedExact.size,
                  total: claudeModels.length
                })}
              </span>
            ) : null
          }
        >
          <div className={styles.hint}>
            {t('api_key_policies.models_hint', {
              defaultValue: '默认全允许；取消勾选即加入 excluded-models。通配符排除项会保留但不在此列表展示。'
            })}
          </div>

          <div className={styles.modelList}>
            {claudeModels.length === 0 ? (
              <div className={styles.hint}>{t('api_key_policies.loading_models', { defaultValue: '模型列表为空' })}</div>
            ) : (
              claudeModels.map((m) => {
                const denied = excludedExact.has(m.id);
                const allowed = !denied;
                return (
                  <label key={m.id} className={styles.modelItem}>
                    <input
                      type="checkbox"
                      checked={allowed}
                      disabled={disableControls || !selectedKey}
                      onChange={(e) => toggleModelAllowed(m.id, e.target.checked)}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div className={styles.modelId}>{m.id}</div>
                      {m.display_name ? <div className={styles.hint}>{m.display_name}</div> : null}
                    </div>
                  </label>
                );
              })
            )}
          </div>

          {excludedCustom.length > 0 ? (
            <div className={styles.hint}>
              {t('api_key_policies.custom_excluded', { defaultValue: '已存在通配/未知模型排除项：' })}{' '}
              {excludedCustom.join(', ')}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
