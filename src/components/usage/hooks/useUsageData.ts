import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores';
import { usageApi, type UsageDashboardResponse } from '@/services/api/usage';
import { modelPricesApi, type ModelPriceApiItem } from '@/services/api/modelPrices';
import { loadModelPrices, type ModelPrice, type UsageTimeRange } from '@/utils/usage';

const normalizePriceItem = (item: ModelPriceApiItem): ModelPrice => ({
  prompt:
    Number.isFinite(Number(item.prompt_usd_per_1m)) && Number(item.prompt_usd_per_1m) >= 0
      ? Number(item.prompt_usd_per_1m)
      : 0,
  completion:
    Number.isFinite(Number(item.completion_usd_per_1m)) && Number(item.completion_usd_per_1m) >= 0
      ? Number(item.completion_usd_per_1m)
      : 0,
  cache:
    Number.isFinite(Number(item.cached_usd_per_1m)) && Number(item.cached_usd_per_1m) >= 0
      ? Number(item.cached_usd_per_1m)
      : 0
});

export interface UseUsageDataReturn {
  dashboard: UsageDashboardResponse | null;
  loading: boolean;
  error: string;
  modelPrices: Record<string, ModelPrice>;
  savedModelPrices: Record<string, ModelPrice>;
  setModelPrices: (prices: Record<string, ModelPrice>) => void;
  loadUsage: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleImport: () => void;
  handleImportChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  exporting: boolean;
  importing: boolean;
}

export function useUsageData(range: UsageTimeRange): UseUsageDataReturn {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const [dashboard, setDashboard] = useState<UsageDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>({});
  const [savedModelPrices, setSavedModelPrices] = useState<Record<string, ModelPrice>>({});
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const savedModelPricesRef = useRef<Record<string, ModelPrice>>({});

  const applyModelPrices = useCallback((items: ModelPriceApiItem[] | undefined) => {
    const effective: Record<string, ModelPrice> = {};
    const saved: Record<string, ModelPrice> = {};

    (items || []).forEach((item) => {
      if (!item?.model) return;
      const normalized = normalizePriceItem(item);
      effective[item.model] = normalized;
      if (item.source === 'saved') {
        saved[item.model] = normalized;
      }
    });

    setModelPrices(effective);
    setSavedModelPrices(saved);
    savedModelPricesRef.current = saved;
  }, []);

  const loadModelPricesFromServer = useCallback(async () => {
    const response = await modelPricesApi.getModelPrices();
    const items = Array.isArray(response?.prices) ? response.prices : [];
    applyModelPrices(items);
    return items;
  }, [applyModelPrices]);

  const migrateLegacyModelPrices = useCallback(async () => {
    const legacyPrices = loadModelPrices();
    const entries = Object.entries(legacyPrices);
    if (!entries.length) return false;

    await Promise.all(
      entries.map(([model, price]) =>
        modelPricesApi.putModelPrice({
          model,
          prompt_usd_per_1m: price.prompt,
          completion_usd_per_1m: price.completion,
          cached_usd_per_1m: price.cache
        })
      )
    );

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('cli-proxy-model-prices-v2');
    }
    return true;
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await usageApi.getDashboard(range);
      setDashboard(data ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('usage_stats.loading_error');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [range, t]);

  const loadUsage = useCallback(async () => {
    await Promise.all([loadDashboard(), loadModelPricesFromServer()]);
  }, [loadDashboard, loadModelPricesFromServer]);

  useEffect(() => {
    const initialize = async () => {
      try {
        await loadModelPricesFromServer();
        const migrated = await migrateLegacyModelPrices();
        if (migrated) {
          await loadModelPricesFromServer();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('usage_stats.loading_error');
        showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
      }
    };
    void initialize();
  }, [loadModelPricesFromServer, migrateLegacyModelPrices, showNotification, t]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await usageApi.exportUsage();
      const exportedAt =
        typeof data?.exported_at === 'string' ? new Date(data.exported_at) : new Date();
      const safeTimestamp = Number.isNaN(exportedAt.getTime())
        ? new Date().toISOString()
        : exportedAt.toISOString();
      const filename = `usage-export-${safeTimestamp.replace(/[:.]/g, '-')}.json`;
      const blob = new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(url);
      showNotification(t('usage_stats.export_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        showNotification(t('usage_stats.import_invalid'), 'error');
        return;
      }

      const result = await usageApi.importUsage(payload);
      showNotification(
        t('usage_stats.import_success', {
          added: result?.added ?? 0,
          skipped: result?.skipped ?? 0,
          total: result?.total_requests ?? 0,
          failed: result?.failed_requests ?? 0
        }),
        'success'
      );
      await loadDashboard();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setImporting(false);
    }
  };

  const handleSetModelPrices = useCallback(
    (prices: Record<string, ModelPrice>) => {
      const current = savedModelPricesRef.current;
      const deletedModels = Object.keys(current).filter((model) => !(model in prices));
      const upsertEntries = Object.entries(prices).filter(([model, nextPrice]) => {
        const currentPrice = current[model];
        return (
          !currentPrice ||
          currentPrice.prompt !== nextPrice.prompt ||
          currentPrice.completion !== nextPrice.completion ||
          currentPrice.cache !== nextPrice.cache
        );
      });

      setSavedModelPrices(prices);
      savedModelPricesRef.current = prices;
      setModelPrices((prev) => ({
        ...prev,
        ...prices
      }));
      deletedModels.forEach((model) => {
        setModelPrices((prev) => {
          const next = { ...prev };
          delete next[model];
          return next;
        });
      });

      void (async () => {
        try {
          await Promise.all(
            deletedModels.map((model) => modelPricesApi.deleteModelPrice(model))
          );
          await Promise.all(
            upsertEntries.map(([model, price]) =>
              modelPricesApi.putModelPrice({
                model,
                prompt_usd_per_1m: price.prompt,
                completion_usd_per_1m: price.completion,
                cached_usd_per_1m: price.cache
              })
            )
          );
          await loadModelPricesFromServer();
          await loadDashboard();
          showNotification(t('usage_stats.model_price_saved'), 'success');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('notification.update_failed');
          showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
          await loadModelPricesFromServer();
          await loadDashboard();
        }
      })();
    },
    [loadDashboard, loadModelPricesFromServer, showNotification, t]
  );

  return {
    dashboard,
    loading,
    error,
    modelPrices,
    savedModelPrices,
    setModelPrices: handleSetModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing
  };
}
