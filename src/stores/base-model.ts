import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface BaseModelConfig {
  id: string;
  label: string;
  provider: 'custom-openai-compatible' | 'provider-account';
  baseUrl: string;
  model: string;
  accountId?: string;
}

export const DEFAULT_PROVIDER_BASE_MODEL: BaseModelConfig = {
  id: 'provider-default',
  label: '默认 AI Provider',
  provider: 'provider-account',
  baseUrl: '',
  model: '',
};

const LEGACY_DEFAULT_MODEL_IDS = new Set(['glm-5.1']);

interface BaseModelState {
  selectedModelId: string;
  models: BaseModelConfig[];
  selectedModel: BaseModelConfig;
  setSelectedModel: (model: BaseModelConfig) => void;
}

function normalizePersistedModel(model: BaseModelConfig): BaseModelConfig {
  if (LEGACY_DEFAULT_MODEL_IDS.has(model.id)) {
    return DEFAULT_PROVIDER_BASE_MODEL;
  }
  return model;
}

function resolveModel(modelId: string, models: BaseModelConfig[]): BaseModelConfig {
  return models.find((model) => model.id === modelId) ?? DEFAULT_PROVIDER_BASE_MODEL;
}

export const useBaseModelStore = create<BaseModelState>()(
  persist(
    (set) => ({
      selectedModelId: DEFAULT_PROVIDER_BASE_MODEL.id,
      models: [DEFAULT_PROVIDER_BASE_MODEL],
      selectedModel: DEFAULT_PROVIDER_BASE_MODEL,
      setSelectedModel: (model) => {
        const models = model.id === DEFAULT_PROVIDER_BASE_MODEL.id
          ? [DEFAULT_PROVIDER_BASE_MODEL]
          : [DEFAULT_PROVIDER_BASE_MODEL, model];
        const selectedModel = resolveModel(model.id, models);
        set({
          models,
          selectedModelId: selectedModel.id,
          selectedModel,
        });
      },
    }),
    {
      name: 'investclaw-base-model',
      partialize: (state) => ({
        selectedModelId: state.selectedModelId,
        selectedModel: state.selectedModel,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.selectedModel = normalizePersistedModel(state.selectedModel);
        state.selectedModelId = state.selectedModel.id;
        state.models = state.selectedModel.id === DEFAULT_PROVIDER_BASE_MODEL.id
          ? [DEFAULT_PROVIDER_BASE_MODEL]
          : [DEFAULT_PROVIDER_BASE_MODEL, state.selectedModel];
        state.selectedModel = resolveModel(state.selectedModelId, state.models);
      },
    },
  ),
);
