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

export const GLM_5_1_BASE_MODEL: BaseModelConfig = {
  id: 'glm-5.1',
  label: 'GLM 5.1',
  provider: 'custom-openai-compatible',
  baseUrl: 'http://117.50.195.92:8080/gpt-oss-120b/glm5.1/v1',
  model: 'glm5.1',
};

interface BaseModelState {
  selectedModelId: string;
  models: BaseModelConfig[];
  selectedModel: BaseModelConfig;
  setSelectedModel: (model: BaseModelConfig) => void;
}

function resolveModel(modelId: string, models: BaseModelConfig[]): BaseModelConfig {
  return models.find((model) => model.id === modelId) ?? GLM_5_1_BASE_MODEL;
}

export const useBaseModelStore = create<BaseModelState>()(
  persist(
    (set) => ({
      selectedModelId: GLM_5_1_BASE_MODEL.id,
      models: [GLM_5_1_BASE_MODEL],
      selectedModel: GLM_5_1_BASE_MODEL,
      setSelectedModel: (model) => {
        const models = model.id === GLM_5_1_BASE_MODEL.id
          ? [GLM_5_1_BASE_MODEL]
          : [GLM_5_1_BASE_MODEL, model];
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
        state.models = state.selectedModel.id === GLM_5_1_BASE_MODEL.id
          ? [GLM_5_1_BASE_MODEL]
          : [GLM_5_1_BASE_MODEL, state.selectedModel];
        state.selectedModel = resolveModel(state.selectedModelId, state.models);
      },
    },
  ),
);
