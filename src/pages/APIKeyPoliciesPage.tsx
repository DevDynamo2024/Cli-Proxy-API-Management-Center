/**
 * API key policies management page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore } from '@/stores';
import { apiKeysApi, apiKeyPoliciesApi, authFilesApi } from '@/services/api';
import type { ApiKeyPolicy } from '@/services/api/apiKeyPolicies';
import styles from './APIKeyPoliciesPage.module.scss';

type ModelDef = { id: string; display_name?: string };

const OPUS_46_ID = 'claude-opus-4-6';

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
  const [allowOpus46, setAllowOpus46] = useState(true);
  const [opus46DailyLimit, setOpus46DailyLimit] = useState('');
  const [excludedExact, setExcludedExact] = useState<Set<string>>(new Set());
  const [excludedCustom, setExcludedCustom] = useState<string[]>([]);
  const [claudeFailoverEnabled, setClaudeFailoverEnabled] = useState(false);
  const [claudeFailoverTargetModel, setClaudeFailoverTargetModel] = useState('gpt-5.2(high)');

  const claudeModelIdSet = useMemo(() => new Set(claudeModels.map((m) => m.id)), [claudeModels]);

  const currentPolicy = useMemo(() => {
    const key = selectedKey.trim();
    if (!key) return null;
    return policies.find((p) => p.apiKey === key) ?? null;
  }, [policies, selectedKey]);

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
        claudeFailoverEnabled: false,
        claudeFailoverTargetModel: 'gpt-5.2(high)'
      } as ApiKeyPolicy);

    setAllowOpus46(p.allowClaudeOpus46 ?? true);
    setClaudeFailoverEnabled(Boolean(p.claudeFailoverEnabled));
    setClaudeFailoverTargetModel(String(p.claudeFailoverTargetModel ?? '').trim() || 'gpt-5.2(high)');

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

  const handleSave = useCallback(async () => {
    const apiKey = selectedKey.trim();
    if (!apiKey) return;

    const dailyLimit = parsePositiveInt(opus46DailyLimit);
    const dailyLimits: Record<string, number> = {};
    if (dailyLimit) dailyLimits[OPUS_46_ID] = dailyLimit;

    const excludedModels = uniqStrings([...excludedCustom, ...Array.from(excludedExact)]);

    try {
      await apiKeyPoliciesApi.upsert({
        apiKey,
        allowClaudeOpus46: allowOpus46,
        excludedModels,
        dailyLimits,
        claudeFailoverEnabled,
        claudeFailoverTargetModel
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
    claudeFailoverTargetModel,
    excludedCustom,
    excludedExact,
    loadAll,
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
            defaultValue: '按不同 API Key 限制可用模型、Opus 4.6 访问与每日次数上限（UTC+8）'
          })}
        </p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.grid}>
        <Card className={styles.panel}>
          <div className={styles.row}>
            <div>{t('api_key_policies.select_key', { defaultValue: '选择 API Key' })}</div>
          </div>
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

          <div className={styles.hint}>
            {currentPolicy
              ? t('api_key_policies.policy_exists', { defaultValue: '该 Key 已配置策略' })
              : t('api_key_policies.policy_default', { defaultValue: '该 Key 使用默认策略（全允许）' })}
          </div>

          <div className={styles.row}>
            <div>{t('api_key_policies.allow_opus46', { defaultValue: '允许 claude-opus-4-6' })}</div>
            <ToggleSwitch checked={allowOpus46} onChange={setAllowOpus46} disabled={disableControls || !selectedKey} />
          </div>

          <div className={styles.row}>
            <div>{t('api_key_policies.opus46_daily_limit', { defaultValue: 'Opus 4.6 每日次数上限' })}</div>
          </div>
          <Input
            value={opus46DailyLimit}
            onChange={(e) => setOpus46DailyLimit(e.target.value)}
            placeholder={t('api_key_policies.unlimited', { defaultValue: '留空=不限' })}
            disabled={disableControls || !selectedKey}
          />

          <div className={styles.row}>
            <div>{t('api_key_policies.claude_failover', { defaultValue: 'Claude 不可用时自动切换' })}</div>
            <ToggleSwitch
              checked={claudeFailoverEnabled}
              onChange={setClaudeFailoverEnabled}
              disabled={disableControls || !selectedKey}
            />
          </div>
          <Input
            value={claudeFailoverTargetModel}
            onChange={(e) => setClaudeFailoverTargetModel(e.target.value)}
            placeholder={t('api_key_policies.failover_target_placeholder', { defaultValue: '默认 gpt-5.2(high)' })}
            disabled={disableControls || !selectedKey || !claudeFailoverEnabled}
            list="codex-model-definitions"
          />
          <datalist id="codex-model-definitions">
            {codexModels.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
          <div className={styles.hint}>
            {t('api_key_policies.failover_note', {
              defaultValue: '当 Claude 返回限额/鉴权/账号异常等错误时，会自动重试到该模型（建议选择 Codex 模型）。'
            })}
          </div>

          <div className={styles.actions}>
            <Button onClick={handleSave} disabled={disableControls || !selectedKey || loading}>
              {t('common.save', { defaultValue: '保存' })}
            </Button>
            <Button variant="secondary" onClick={loadAll} disabled={disableControls || loading}>
              {t('common.refresh', { defaultValue: '刷新' })}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={disableControls || !selectedKey}>
              {t('common.delete', { defaultValue: '删除策略' })}
            </Button>
          </div>

          <div className={styles.hint}>
            {t('api_key_policies.limit_note', {
              defaultValue: '每日次数按 UTC+8（中国标准时间）统计，服务端使用 SQLite 持久化计数。'
            })}
          </div>
        </Card>

        <Card className={styles.panel}>
          <div className={styles.row}>
            <div>{t('api_key_policies.models_title', { defaultValue: 'Claude 模型访问' })}</div>
          </div>
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
