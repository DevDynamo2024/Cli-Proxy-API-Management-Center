import { useCallback, useRef, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { usageApi, type UsageTargetsDashboardResponse } from '@/services/api';

const EMPTY_STATS: UsageTargetsDashboardResponse = {
  providers: {
    gemini: [],
    codex: [],
    claude: [],
    vertex: [],
    openai: []
  },
  auth_files: {
    by_auth_index: {},
    by_source: {}
  }
};

export const useProviderStats = () => {
  const [stats, setStats] = useState<UsageTargetsDashboardResponse>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(false);
  const loadingRef = useRef(false);

  // 加载 provider/auth-file 聚合统计（API 层已有60秒超时）
  const loadKeyStats = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    try {
      const response = await usageApi.getTargetsDashboard();
      setStats(response ?? EMPTY_STATS);
    } catch {
      // 静默失败
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  // 定时刷新状态数据（每240秒）
  useInterval(loadKeyStats, 240_000);

  return { stats, loadKeyStats, isLoading };
};
