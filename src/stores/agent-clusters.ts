import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import type {
  AgentCluster,
  AgentClusterCreationStatus,
  AgentClusterExecutionGraph,
  CreateAgentClusterRequest,
  SendAgentClusterManagerMessageRequest,
  SendAgentClusterMessageRequest,
} from '@/types/agent-cluster';

type AgentClusterResponse = {
  success: boolean;
  cluster: AgentCluster;
  error?: string;
};

type AgentClusterListResponse = {
  success: boolean;
  clusters: AgentCluster[];
  error?: string;
};

type AgentClusterCreationStatusResponse = {
  success: boolean;
  status: AgentClusterCreationStatus;
  error?: string;
};

type AgentClusterDeleteResponse = {
  success: boolean;
  error?: string;
};

interface AgentClusterState {
  clusters: AgentCluster[];
  selectedClusterId: string | null;
  selectedAgentId: string | null;
  loading: boolean;
  creating: boolean;
  sending: boolean;
  creationStatus: AgentClusterCreationStatus | null;
  error: string | null;
  loadClusters: () => Promise<void>;
  loadCluster: (clusterId: string) => Promise<AgentCluster | null>;
  createCluster: (input: CreateAgentClusterRequest) => Promise<AgentCluster | null>;
  renameCluster: (clusterId: string, clusterName: string) => Promise<void>;
  deleteCluster: (clusterId: string) => Promise<void>;
  saveExecutionGraph: (clusterId: string, graph: Partial<AgentClusterExecutionGraph>) => Promise<void>;
  confirmExecutionGraph: (clusterId: string) => Promise<void>;
  startRun: (clusterId: string) => Promise<void>;
  refreshRunEvents: (clusterId: string, runId: string) => Promise<void>;
  resetRun: (clusterId: string, runId: string) => Promise<void>;
  resumeRunFromAgent: (clusterId: string, runId: string, agentId: string) => Promise<void>;
  retryRunAgent: (clusterId: string, runId: string, agentId: string) => Promise<void>;
  skipRunAgent: (clusterId: string, runId: string, agentId: string) => Promise<void>;
  sendManagerMessage: (clusterId: string, input: SendAgentClusterManagerMessageRequest) => Promise<void>;
  applyManagerProposal: (clusterId: string, proposalId: string) => Promise<void>;
  dismissManagerProposal: (clusterId: string, proposalId: string) => Promise<void>;
  sendMessage: (clusterId: string, input: SendAgentClusterMessageRequest) => Promise<void>;
  applyClusterUpdate: (cluster: AgentCluster) => void;
  applyCreationStatus: (status: AgentClusterCreationStatus) => void;
  selectCluster: (clusterId: string | null) => void;
  selectAgent: (agentId: string | null) => void;
  clearError: () => void;
}

function upsertCluster(clusters: AgentCluster[], cluster: AgentCluster): AgentCluster[] {
  const next = clusters.filter((item) => item.clusterId !== cluster.clusterId);
  next.unshift(cluster);
  return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function isAgentCluster(value: unknown): value is AgentCluster {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { clusterId?: unknown }).clusterId === 'string'
    && typeof (value as { clusterName?: unknown }).clusterName === 'string',
  );
}

function requireCluster(response: AgentClusterResponse, action: string): AgentCluster {
  if (!response.success) {
    throw new Error(response.error || `${action}失败`);
  }
  if (!isAgentCluster(response.cluster)) {
    throw new Error(`${action} 返回了无效的 Agent Cluster 数据`);
  }
  return response.cluster;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useAgentClusterStore = create<AgentClusterState>((set) => ({
  clusters: [],
  selectedClusterId: null,
  selectedAgentId: null,
  loading: false,
  creating: false,
  sending: false,
  creationStatus: null,
  error: null,

  loadClusters: async () => {
    set({ loading: true, error: null });
    try {
      const response = await hostApiFetch<AgentClusterListResponse>('/api/agent-clusters');
      set({
        clusters: Array.isArray(response.clusters) ? response.clusters.filter(isAgentCluster) : [],
        loading: false,
      });
    } catch (error) {
      set({ error: getErrorMessage(error), loading: false });
    }
  },

  loadCluster: async (clusterId) => {
    set({ loading: true, error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(`/api/agent-clusters/${encodeURIComponent(clusterId)}`);
      const cluster = requireCluster(response, '加载集群');
      set((state) => ({
        clusters: upsertCluster(state.clusters, cluster),
        selectedClusterId: cluster.clusterId,
        loading: false,
      }));
      return cluster;
    } catch (error) {
      set({ error: getErrorMessage(error), loading: false });
      return null;
    }
  },

  createCluster: async (input) => {
    const requestId = input.requestId || crypto.randomUUID();
    set({ creating: true, error: null, creationStatus: null });
    const pollCreationStatus = async () => {
      try {
        const response = await hostApiFetch<AgentClusterCreationStatusResponse>(
          `/api/agent-clusters/creation-status/${encodeURIComponent(requestId)}`,
        );
        if (response.status) set({ creationStatus: response.status });
      } catch {
        // Status may not exist during the first few milliseconds of the request.
      }
    };
    const pollTimer = window.setInterval(() => {
      void pollCreationStatus();
    }, 800);
    try {
      const response = await hostApiFetch<AgentClusterResponse>('/api/agent-clusters', {
        method: 'POST',
        body: JSON.stringify({ ...input, requestId }),
      });
      const cluster = requireCluster(response, '创建集群');
      if (pollTimer) window.clearInterval(pollTimer);
      set((state) => ({
        clusters: upsertCluster(state.clusters, cluster),
        selectedClusterId: cluster.clusterId,
        selectedAgentId: null,
        creating: false,
      }));
      return cluster;
    } catch (error) {
      if (pollTimer) window.clearInterval(pollTimer);
      set({ error: getErrorMessage(error), creating: false });
      return null;
    }
  },

  renameCluster: async (clusterId, clusterName) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ clusterName }),
        },
      );
      const cluster = requireCluster(response, '重命名集群');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  deleteCluster: async (clusterId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterDeleteResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}`,
        { method: 'DELETE' },
      );
      if (!response.success) throw new Error(response.error || '删除集群失败');
      set((state) => ({
        clusters: state.clusters.filter((cluster) => cluster.clusterId !== clusterId),
        selectedClusterId: state.selectedClusterId === clusterId ? null : state.selectedClusterId,
        selectedAgentId: state.selectedClusterId === clusterId ? null : state.selectedAgentId,
      }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  saveExecutionGraph: async (clusterId, graph) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/execution-graph`,
        {
          method: 'PATCH',
          body: JSON.stringify(graph),
        },
      );
      const cluster = requireCluster(response, '保存编排图');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  confirmExecutionGraph: async (clusterId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/execution-graph/confirm`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '确认编排图');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  startRun: async (clusterId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '启动运行');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  refreshRunEvents: async (clusterId, runId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/refresh-events`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '刷新运行事件');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  resetRun: async (clusterId, runId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/reset`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '重置运行');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  resumeRunFromAgent: async (clusterId, runId, agentId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/resume-from-agent`,
        {
          method: 'POST',
          body: JSON.stringify({ agentId }),
        },
      );
      const cluster = requireCluster(response, '从指定 Agent 继续运行');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  retryRunAgent: async (clusterId, runId, agentId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/retry-agent`,
        {
          method: 'POST',
          body: JSON.stringify({ agentId }),
        },
      );
      const cluster = requireCluster(response, '重试 Agent');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  skipRunAgent: async (clusterId, runId, agentId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/skip-agent`,
        {
          method: 'POST',
          body: JSON.stringify({ agentId }),
        },
      );
      const cluster = requireCluster(response, '跳过 Agent');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  sendManagerMessage: async (clusterId, input) => {
    set({ sending: true, error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/manager/messages`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      const cluster = requireCluster(response, '发送 Manager 指令');
      set((state) => ({
        clusters: upsertCluster(state.clusters, cluster),
        sending: false,
      }));
    } catch (error) {
      set({ error: getErrorMessage(error), sending: false });
    }
  },

  applyManagerProposal: async (clusterId, proposalId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/manager/proposals/${encodeURIComponent(proposalId)}/apply`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '应用 Manager 提案');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  dismissManagerProposal: async (clusterId, proposalId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/manager/proposals/${encodeURIComponent(proposalId)}/dismiss`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '放弃 Manager 提案');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  sendMessage: async (clusterId, input) => {
    set({ sending: true, error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      const cluster = requireCluster(response, '发送消息');
      set((state) => ({
        clusters: upsertCluster(state.clusters, cluster),
        sending: false,
      }));
    } catch (error) {
      set({ error: getErrorMessage(error), sending: false });
    }
  },

  selectCluster: (clusterId) => {
    set({ selectedClusterId: clusterId });
  },

  selectAgent: (agentId) => {
    set({ selectedAgentId: agentId });
  },

  applyClusterUpdate: (cluster) => {
    if (!isAgentCluster(cluster)) return;
    set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
  },

  applyCreationStatus: (status) => {
    set({ creationStatus: status });
  },

  clearError: () => {
    set({ error: null });
  },
}));

if (typeof window !== 'undefined') {
  subscribeHostEvent<{ cluster?: AgentCluster }>('agent-cluster:updated', (payload) => {
    if (payload.cluster) {
      useAgentClusterStore.getState().applyClusterUpdate(payload.cluster);
    }
  });
  subscribeHostEvent<{ status?: AgentClusterCreationStatus }>('agent-cluster:creation-updated', (payload) => {
    if (payload.status) {
      useAgentClusterStore.getState().applyCreationStatus(payload.status);
    }
  });
}

export function getSelectedAgentNameFromInput(content: string, cluster: AgentCluster): string | null {
  const mention = content.match(/@([\p{L}\p{N}_\-\s]+?)(?:\s|$)/u)?.[1]?.trim();
  if (!mention) return null;
  const normalized = mention.toLowerCase();
  return cluster.agents.find((agent) =>
    agent.name.toLowerCase() === normalized
    || agent.name.toLowerCase().includes(normalized)
  )?.agentId ?? null;
}
