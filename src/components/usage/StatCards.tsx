import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
import { IconDiamond, IconDollarSign, IconSatellite, IconTimer, IconTrendingUp } from '@/components/ui/icons';
import {
  formatTokensInMillions,
  formatPerMinuteValue,
  formatUsd
} from '@/utils/usage';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import type {
  UsageDashboardRates,
  UsageDashboardSummary
} from '@/services/api/usage';
import type { SparklineBundle } from './hooks/useSparklines';
import styles from '@/pages/UsagePage.module.scss';

interface StatCardData {
  key: string;
  label: string;
  icon: ReactNode;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  value: string;
  meta?: ReactNode;
  trend: SparklineBundle | null;
}

export interface StatCardsProps {
  summary: UsageDashboardSummary | null;
  rates: UsageDashboardRates | null;
  loading: boolean;
  sparklines: {
    requests: SparklineBundle | null;
    tokens: SparklineBundle | null;
    rpm: SparklineBundle | null;
    tpm: SparklineBundle | null;
    cost: SparklineBundle | null;
  };
}

export function StatCards({ summary, rates, loading, sparklines }: StatCardsProps) {
  const { t } = useTranslation();

  const statsCards: StatCardData[] = [
    {
      key: 'requests',
      label: t('usage_stats.total_requests'),
      icon: <IconSatellite size={16} />,
      accent: '#3b82f6',
      accentSoft: 'rgba(59, 130, 246, 0.18)',
      accentBorder: 'rgba(59, 130, 246, 0.35)',
      value: loading ? '-' : (summary?.total_requests ?? 0).toLocaleString(),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#10b981' }} />
            {t('usage_stats.success_requests')}: {loading ? '-' : (summary?.success_count ?? 0)}
          </span>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#ef4444' }} />
            {t('usage_stats.failed_requests')}: {loading ? '-' : (summary?.failure_count ?? 0)}
          </span>
        </>
      ),
      trend: sparklines.requests
    },
    {
      key: 'tokens',
      label: t('usage_stats.total_tokens'),
      icon: <IconDiamond size={16} />,
      accent: '#8b5cf6',
      accentSoft: 'rgba(139, 92, 246, 0.18)',
      accentBorder: 'rgba(139, 92, 246, 0.35)',
      value: loading ? '-' : formatTokensInMillions(summary?.total_tokens ?? 0),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cached_tokens')}: {loading ? '-' : formatTokensInMillions(summary?.cached_tokens ?? 0)}
          </span>
          <span className={styles.statMetaItem}>
            {t('usage_stats.reasoning_tokens')}: {loading ? '-' : formatTokensInMillions(summary?.reasoning_tokens ?? 0)}
          </span>
        </>
      ),
      trend: sparklines.tokens
    },
    {
      key: 'rpm',
      label: t('usage_stats.rpm_30m'),
      icon: <IconTimer size={16} />,
      accent: '#22c55e',
      accentSoft: 'rgba(34, 197, 94, 0.18)',
      accentBorder: 'rgba(34, 197, 94, 0.32)',
      value: loading ? '-' : formatPerMinuteValue(rates?.rpm ?? 0),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_requests')}: {loading ? '-' : (rates?.request_count ?? 0).toLocaleString()}
        </span>
      ),
      trend: sparklines.rpm
    },
    {
      key: 'tpm',
      label: t('usage_stats.tpm_30m'),
      icon: <IconTrendingUp size={16} />,
      accent: '#f97316',
      accentSoft: 'rgba(249, 115, 22, 0.18)',
      accentBorder: 'rgba(249, 115, 22, 0.32)',
      value: loading ? '-' : formatPerMinuteValue(rates?.tpm ?? 0),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_tokens')}: {loading ? '-' : formatTokensInMillions(rates?.token_count ?? 0)}
        </span>
      ),
      trend: sparklines.tpm
    },
    {
      key: 'cost',
      label: t('usage_stats.total_cost'),
      icon: <IconDollarSign size={16} />,
      accent: '#f59e0b',
      accentSoft: 'rgba(245, 158, 11, 0.18)',
      accentBorder: 'rgba(245, 158, 11, 0.32)',
      value: loading ? '-' : formatUsd(summary?.total_cost_usd ?? 0),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}: {loading ? '-' : formatTokensInMillions(summary?.total_tokens ?? 0)}
          </span>
        </>
      ),
      trend: sparklines.cost
    }
  ];

  return (
    <div className={styles.statsGrid}>
      {statsCards.map((card) => (
        <div
          key={card.key}
          className={styles.statCard}
          style={
            {
              '--accent': card.accent,
              '--accent-soft': card.accentSoft,
              '--accent-border': card.accentBorder
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            <span className={styles.statIconBadge}>{card.icon}</span>
          </div>
          <div className={styles.statValue}>{card.value}</div>
          {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
          <div className={styles.statTrend}>
            {card.trend ? (
              <Line className={styles.sparkline} data={card.trend.data} options={sparklineOptions} />
            ) : (
              <div className={styles.statTrendPlaceholder}></div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
