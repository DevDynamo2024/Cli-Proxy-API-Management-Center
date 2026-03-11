import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import type { UsageDashboardModelStat } from '@/services/api/usage';
import { formatTokensInMillions, formatUsd } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface ModelStatsCardProps {
  modelStats: UsageDashboardModelStat[];
  loading: boolean;
}

export function ModelStatsCard({ modelStats, loading }: ModelStatsCardProps) {
  const { t } = useTranslation();

  return (
    <Card title={t('usage_stats.models')}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : modelStats.length > 0 ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('usage_stats.model_name')}</th>
                <th>{t('usage_stats.requests_count')}</th>
                <th>{t('usage_stats.tokens_count')}</th>
                <th>{t('usage_stats.total_cost')}</th>
              </tr>
            </thead>
            <tbody>
              {modelStats.map((stat) => (
                <tr key={stat.model}>
                  <td className={styles.modelCell}>{stat.model}</td>
                  <td>
                    <span className={styles.requestCountCell}>
                      <span>{stat.requests.toLocaleString()}</span>
                      <span className={styles.requestBreakdown}>
                        (<span className={styles.statSuccess}>{stat.success_count.toLocaleString()}</span>{' '}
                        <span className={styles.statFailure}>{stat.failure_count.toLocaleString()}</span>)
                      </span>
                    </span>
                  </td>
                  <td>{formatTokensInMillions(stat.tokens)}</td>
                  <td>{stat.cost_usd > 0 ? formatUsd(stat.cost_usd) : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
