import { useState, useMemo } from 'react';
import type { ChartOptions } from 'chart.js';
import type {
  UsageDashboardResponse,
  UsageDashboardSeriesSet
} from '@/services/api/usage';
import type { ChartData } from '@/utils/usage';
import { buildChartOptions } from '@/utils/usage/chartConfig';

export interface UseChartDataOptions {
  charts: UsageDashboardResponse['charts'] | null;
  chartLines: string[];
  isDark: boolean;
  isMobile: boolean;
}

export interface UseChartDataReturn {
  requestsPeriod: 'hour' | 'day';
  setRequestsPeriod: (period: 'hour' | 'day') => void;
  tokensPeriod: 'hour' | 'day';
  setTokensPeriod: (period: 'hour' | 'day') => void;
  requestsChartData: ChartData;
  tokensChartData: ChartData;
  requestsChartOptions: ChartOptions<'line'>;
  tokensChartOptions: ChartOptions<'line'>;
}

export function useChartData({
  charts,
  chartLines,
  isDark,
  isMobile
}: UseChartDataOptions): UseChartDataReturn {
  const [requestsPeriod, setRequestsPeriod] = useState<'hour' | 'day'>('day');
  const [tokensPeriod, setTokensPeriod] = useState<'hour' | 'day'>('day');

  const CHART_COLORS = [
    { borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.15)' },
    { borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.15)' },
    { borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.15)' },
    { borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.15)' },
    { borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.15)' },
    { borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.15)' },
    { borderColor: '#ec4899', backgroundColor: 'rgba(236, 72, 153, 0.15)' },
    { borderColor: '#84cc16', backgroundColor: 'rgba(132, 204, 22, 0.15)' },
    { borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.15)' }
  ];

  const buildChartDataFromSeries = useMemo(
    () => (seriesSet: UsageDashboardSeriesSet | undefined, selectedModels: string[]): ChartData => {
      if (!seriesSet?.labels?.length) {
        return { labels: [], datasets: [] };
      }

      const seriesMap = new Map(
        (seriesSet.series || []).map((series) => [series.key, series.data] as const)
      );
      const modelsToShow = selectedModels.length > 0 ? selectedModels : ['all'];
      const selectedSeries = modelsToShow.map(
        (model) => seriesMap.get(model) || new Array(seriesSet.labels.length).fill(0)
      );

      if (selectedSeries.every((series) => series.every((value) => value === 0))) {
        return { labels: [], datasets: [] };
      }

      return {
        labels: seriesSet.labels,
        datasets: modelsToShow.map((model, index) => {
          const color = CHART_COLORS[index % CHART_COLORS.length];
          return {
            label: model === 'all' ? 'All Models' : model,
            data: selectedSeries[index],
            borderColor: color.borderColor,
            backgroundColor: color.backgroundColor,
            pointBackgroundColor: color.borderColor,
            pointBorderColor: color.borderColor,
            fill: model === 'all' || modelsToShow.length === 1,
            tension: 0.35
          };
        })
      };
    },
    []
  );

  const requestsChartData = useMemo(() => {
    const source = requestsPeriod === 'hour' ? charts?.requests.hour : charts?.requests.day;
    return buildChartDataFromSeries(source, chartLines);
  }, [buildChartDataFromSeries, chartLines, charts, requestsPeriod]);

  const tokensChartData = useMemo(() => {
    const source = tokensPeriod === 'hour' ? charts?.tokens.hour : charts?.tokens.day;
    return buildChartDataFromSeries(source, chartLines);
  }, [buildChartDataFromSeries, chartLines, charts, tokensPeriod]);

  const requestsChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: requestsPeriod,
        labels: requestsChartData.labels,
        isDark,
        isMobile
      }),
    [requestsPeriod, requestsChartData.labels, isDark, isMobile]
  );

  const tokensChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: tokensPeriod,
        labels: tokensChartData.labels,
        isDark,
        isMobile
      }),
    [tokensPeriod, tokensChartData.labels, isDark, isMobile]
  );

  return {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions
  };
}
