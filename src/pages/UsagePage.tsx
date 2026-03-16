import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconChevronDown } from '@/components/ui/icons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore } from '@/stores';
import {
  StatCards,
  UsageChart,
  ChartLineSelector,
  ApiDetailsCard,
  ModelStatsCard,
  PriceSettingsCard,
  useUsageData,
  useSparklines,
  useChartData
} from '@/components/usage';
import {
  type UsageTimeRange
} from '@/utils/usage';
import styles from './UsagePage.module.scss';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const CHART_LINES_STORAGE_KEY = 'cli-proxy-usage-chart-lines-v1';
const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const DEFAULT_CHART_LINES = ['all'];
const DEFAULT_TIME_RANGE: UsageTimeRange = '24h';
const MAX_CHART_LINES = 9;

function getRangeDurationMs(range: UsageTimeRange): number | null {
  if (range === '7h') return 7 * 60 * 60 * 1000;
  if (range === '24h') return 24 * 60 * 60 * 1000;
  if (range === '7d') return 7 * 24 * 60 * 60 * 1000;
  return null;
}

function formatWindowLabel(range: UsageTimeRange, generatedAt?: string): string {
  const durationMs = getRangeDurationMs(range);
  if (!durationMs || !generatedAt) return '';
  const end = new Date(generatedAt);
  if (Number.isNaN(end.getTime())) return '';
  const start = new Date(end.getTime() - durationMs);
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '7h' || value === '24h' || value === '7d' || value === 'all';

const normalizeChartLines = (value: unknown, maxLines = MAX_CHART_LINES): string[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_CHART_LINES;
  }

  const filtered = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  return filtered.length ? filtered : DEFAULT_CHART_LINES;
};

const loadChartLines = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_CHART_LINES;
    }
    const raw = localStorage.getItem(CHART_LINES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHART_LINES;
    }
    return normalizeChartLines(JSON.parse(raw));
  } catch {
    return DEFAULT_CHART_LINES;
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

export function UsagePage() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const [chartLines, setChartLines] = useState<string[]>(loadChartLines);
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);

  // Data hook
  const {
    dashboard,
    loading,
    error,
    modelPrices,
    savedModelPrices,
    setModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    handleModelPricesExport,
    handleModelPricesImport,
    handleModelPricesImportChange,
    modelPricesImportInputRef,
    exporting,
    importing,
    modelPricesExporting,
    modelPricesImporting
  } = useUsageData(timeRange);

  useHeaderRefresh(loadUsage);

  const handleChartLinesChange = useCallback((lines: string[]) => {
    setChartLines(normalizeChartLines(lines));
  }, []);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CHART_LINES_STORAGE_KEY, JSON.stringify(chartLines));
    } catch {
      // Ignore storage errors.
    }
  }, [chartLines]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  // Sparklines hook
  const {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline
  } = useSparklines({ sparklines: dashboard?.sparklines ?? null, loading });

  // Chart data hook
  const {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions
  } = useChartData({ charts: dashboard?.charts ?? null, chartLines, isDark, isMobile });

  // Derived data
  const modelNames = useMemo(
    () =>
      Array.from(
        new Set([...(dashboard?.model_names || []), ...Object.keys(modelPrices)])
      ).sort((a, b) => a.localeCompare(b)),
    [dashboard?.model_names, modelPrices]
  );
  const apiStats = dashboard?.api_stats || [];
  const modelStats = dashboard?.model_stats || [];
  const activeWindowLabel = useMemo(
    () => formatWindowLabel(timeRange, dashboard?.generated_at),
    [dashboard?.generated_at, timeRange]
  );

  return (
    <div className={styles.container}>
      {loading && !dashboard && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
            <div className={styles.timeRangeSelectWrap}>
              <select
                value={timeRange}
                onChange={(event) => setTimeRange(event.target.value as UsageTimeRange)}
                className={`${styles.select} ${styles.timeRangeSelect}`}
              >
                <option value="all">{t('usage_stats.range_all')}</option>
                <option value="7h">{t('usage_stats.range_7h')}</option>
                <option value="24h">{t('usage_stats.range_24h')}</option>
                <option value="7d">{t('usage_stats.range_7d')}</option>
              </select>
              <span className={styles.timeRangeSelectIcon} aria-hidden="true">
                <IconChevronDown size={14} />
              </span>
            </div>
            {activeWindowLabel ? (
              <span className={styles.timeRangeWindow}>
                {t('usage_stats.active_window', {
                  defaultValue: '当前滚动窗口：{{window}}',
                  window: activeWindowLabel
                })}
              </span>
            ) : null}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadUsage}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {/* Stats Overview Cards */}
      <StatCards
        summary={dashboard?.summary ?? null}
        rates={dashboard?.rates ?? null}
        loading={loading}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline
        }}
      />

      {/* Chart Line Selection */}
      <ChartLineSelector
        chartLines={chartLines}
        modelNames={modelNames}
        maxLines={MAX_CHART_LINES}
        onChange={handleChartLinesChange}
      />

      {/* Charts Grid */}
      <div className={styles.chartsGrid}>
        <UsageChart
          title={t('usage_stats.requests_trend')}
          period={requestsPeriod}
          onPeriodChange={setRequestsPeriod}
          chartData={requestsChartData}
          chartOptions={requestsChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
        <UsageChart
          title={t('usage_stats.tokens_trend')}
          period={tokensPeriod}
          onPeriodChange={setTokensPeriod}
          chartData={tokensChartData}
          chartOptions={tokensChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
      </div>

      {/* Details Grid */}
      <div className={styles.detailsGrid}>
        <ApiDetailsCard apiStats={apiStats} loading={loading} />
        <ModelStatsCard modelStats={modelStats} loading={loading} />
      </div>

      {/* Price Settings */}
      <PriceSettingsCard
        modelNames={modelNames}
        modelPrices={modelPrices}
        savedModelPrices={savedModelPrices}
        onPricesChange={setModelPrices}
        onExport={handleModelPricesExport}
        onImport={handleModelPricesImport}
        onImportChange={handleModelPricesImportChange}
        importInputRef={modelPricesImportInputRef}
        exporting={modelPricesExporting}
        importing={modelPricesImporting}
      />
    </div>
  );
}
