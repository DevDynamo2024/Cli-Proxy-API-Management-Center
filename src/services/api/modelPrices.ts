import { apiClient } from './client';

const MODEL_PRICES_TIMEOUT_MS = 60 * 1000;

export interface ModelPriceApiItem {
  model: string;
  prompt_usd_per_1m: number;
  completion_usd_per_1m: number;
  cached_usd_per_1m: number;
  source?: 'saved' | 'default' | string;
  updated_at?: number;
}

export interface ModelPricesResponse {
  prices?: ModelPriceApiItem[];
}

export const modelPricesApi = {
  getModelPrices: () =>
    apiClient.get<ModelPricesResponse>('/model-prices', { timeout: MODEL_PRICES_TIMEOUT_MS }),

  putModelPrice: (payload: {
    model: string;
    prompt_usd_per_1m: number;
    completion_usd_per_1m: number;
    cached_usd_per_1m: number;
  }) => apiClient.put('/model-prices', payload, { timeout: MODEL_PRICES_TIMEOUT_MS }),

  deleteModelPrice: (model: string) =>
    apiClient.delete(`/model-prices?model=${encodeURIComponent(model)}`, {
      timeout: MODEL_PRICES_TIMEOUT_MS
    })
};
