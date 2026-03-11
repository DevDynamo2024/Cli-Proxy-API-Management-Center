import { useCallback, useMemo } from 'react';
import type { UsageDashboardResponse } from '@/services/api/usage';

export interface SparklineData {
  labels: string[];
  datasets: [
    {
      data: number[];
      borderColor: string;
      backgroundColor: string;
      fill: boolean;
      tension: number;
      pointRadius: number;
      borderWidth: number;
    }
  ];
}

export interface SparklineBundle {
  data: SparklineData;
}

export interface UseSparklinesOptions {
  sparklines: UsageDashboardResponse['sparklines'] | null;
  loading: boolean;
}

export interface UseSparklinesReturn {
  requestsSparkline: SparklineBundle | null;
  tokensSparkline: SparklineBundle | null;
  rpmSparkline: SparklineBundle | null;
  tpmSparkline: SparklineBundle | null;
  costSparkline: SparklineBundle | null;
}

export function useSparklines({ sparklines, loading }: UseSparklinesOptions): UseSparklinesReturn {
  const buildSeries = useCallback(
    (series: { labels?: string[]; data?: number[] } | null | undefined) => ({
      labels: series?.labels || [],
      data: series?.data || []
    }),
    []
  );

  const buildSparkline = useCallback(
    (
      series: { labels: string[]; data: number[] },
      color: string,
      backgroundColor: string
    ): SparklineBundle | null => {
      if (loading || !series?.data?.length || series.data.every((value) => value === 0)) {
        return null;
      }
      const sliceStart = Math.max(series.data.length - 60, 0);
      const labels = series.labels.slice(sliceStart);
      const points = series.data.slice(sliceStart);
      return {
        data: {
          labels,
          datasets: [
            {
              data: points,
              borderColor: color,
              backgroundColor,
              fill: true,
              tension: 0.45,
              pointRadius: 0,
              borderWidth: 2
            }
          ]
        }
      };
    },
    [loading]
  );

  const requestsSparkline = useMemo(
    () => buildSparkline(buildSeries(sparklines?.requests), '#3b82f6', 'rgba(59, 130, 246, 0.18)'),
    [buildSeries, buildSparkline, sparklines?.requests]
  );

  const tokensSparkline = useMemo(
    () => buildSparkline(buildSeries(sparklines?.tokens), '#8b5cf6', 'rgba(139, 92, 246, 0.18)'),
    [buildSeries, buildSparkline, sparklines?.tokens]
  );

  const rpmSparkline = useMemo(
    () => buildSparkline(buildSeries(sparklines?.rpm), '#22c55e', 'rgba(34, 197, 94, 0.18)'),
    [buildSeries, buildSparkline, sparklines?.rpm]
  );

  const tpmSparkline = useMemo(
    () => buildSparkline(buildSeries(sparklines?.tpm), '#f97316', 'rgba(249, 115, 22, 0.18)'),
    [buildSeries, buildSparkline, sparklines?.tpm]
  );

  const costSparkline = useMemo(
    () => buildSparkline(buildSeries(sparklines?.cost), '#f59e0b', 'rgba(245, 158, 11, 0.18)'),
    [buildSeries, buildSparkline, sparklines?.cost]
  );

  return {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline
  };
}
