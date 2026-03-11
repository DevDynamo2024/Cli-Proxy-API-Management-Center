import type { UsageTargetsStatusBar } from '@/services/api';
import styles from '@/pages/AiProvidersPage.module.scss';

interface ProviderStatusBarProps {
  statusData: UsageTargetsStatusBar;
}

export function ProviderStatusBar({ statusData }: ProviderStatusBarProps) {
  const hasData = statusData.total_success + statusData.total_failure > 0;
  const rateClass = !hasData
    ? ''
    : statusData.success_rate >= 90
      ? styles.statusRateHigh
      : statusData.success_rate >= 50
        ? styles.statusRateMedium
        : styles.statusRateLow;

  return (
    <div className={styles.statusBar}>
      <div className={styles.statusBlocks}>
        {statusData.blocks.map((state, idx) => {
          const blockClass =
            state === 'success'
              ? styles.statusBlockSuccess
              : state === 'failure'
                ? styles.statusBlockFailure
                : state === 'mixed'
                  ? styles.statusBlockMixed
                  : styles.statusBlockIdle;
          return <div key={idx} className={`${styles.statusBlock} ${blockClass}`} />;
        })}
      </div>
      <span className={`${styles.statusRate} ${rateClass}`}>
        {hasData ? `${statusData.success_rate.toFixed(1)}%` : '--'}
      </span>
    </div>
  );
}
