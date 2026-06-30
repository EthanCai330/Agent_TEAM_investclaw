import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import type {
  AgentCluster,
  AgentClusterCreationStatus,
  AgentClusterExecutionGraph,
  AgentClusterWorkflow,
  CreateAgentClusterAgentRequest,
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

type AgentClusterFreezeSelectResponse = {
  success: boolean;
  canceled?: boolean;
  folderPath?: string | null;
  error?: string;
};

type AgentClusterFreezeResponse = {
  success: boolean;
  targetDirectory?: string;
  error?: string;
};

type AgentClusterUpdate = Pick<AgentCluster, 'clusterId' | 'clusterName'> & Partial<AgentCluster>;

interface AgentClusterState {
  clusters: AgentCluster[];
  selectedClusterId: string | null;
  selectedAgentId: string | null;
  loading: boolean;
  creating: boolean;
  sending: boolean;
  creationStatus: AgentClusterCreationStatus | null;
  creationRequestId: string | null;
  managerRequestId: string | null;
  error: string | null;
  loadClusters: () => Promise<void>;
  loadCluster: (clusterId: string) => Promise<AgentCluster | null>;
  createCluster: (input: CreateAgentClusterRequest) => Promise<AgentCluster | null>;
  abortCreation: () => Promise<void>;
  renameCluster: (clusterId: string, clusterName: string) => Promise<void>;
  deleteCluster: (clusterId: string) => Promise<void>;
  saveExecutionGraph: (clusterId: string, graph: Partial<AgentClusterExecutionGraph>) => Promise<void>;
  confirmExecutionGraph: (clusterId: string) => Promise<void>;
  saveWorkflow: (clusterId: string, workflow: Partial<AgentClusterWorkflow>) => Promise<void>;
  confirmWorkflow: (clusterId: string, workflowId?: string) => Promise<void>;
  rollbackWorkflow: (clusterId: string, workflowId: string) => Promise<void>;
  saveWorkflowTemplate: (clusterId: string, input?: { name?: string; description?: string; defaultArgs?: Record<string, unknown>; argsSchema?: Record<string, unknown> }) => Promise<void>;
  saveWorkflowScript: (clusterId: string, input: { source: string; argsSchema?: Record<string, unknown> }) => Promise<void>;
  confirmWorkflowScript: (clusterId: string) => Promise<void>;
  selectFreezeFolder: (clusterId: string) => Promise<string | null>;
  freezeCluster: (clusterId: string, targetDirectory: string) => Promise<string | null>;
  createAgent: (clusterId: string, input: CreateAgentClusterAgentRequest) => Promise<AgentCluster | null>;
  startRun: (clusterId: string, args?: Record<string, unknown>) => Promise<void>;
  pauseRun: (clusterId: string, runId: string) => Promise<void>;
  resumeRun: (clusterId: string, runId: string) => Promise<void>;
  stopRun: (clusterId: string, runId: string) => Promise<void>;
  decideHumanGate: (clusterId: string, runId: string, nodeId: string, decision: 'approve' | 'reject') => Promise<void>;
  refreshRunEvents: (clusterId: string, runId: string) => Promise<void>;
  resetRun: (clusterId: string, runId: string) => Promise<void>;
  resumeRunFromAgent: (clusterId: string, runId: string, agentId: string) => Promise<void>;
  retryRunAgent: (clusterId: string, runId: string, agentId: string) => Promise<void>;
  skipRunAgent: (clusterId: string, runId: string, agentId: string) => Promise<void>;
  sendManagerMessage: (clusterId: string, input: SendAgentClusterManagerMessageRequest) => Promise<void>;
  abortManagerMessage: (clusterId: string) => Promise<void>;
  resetCurrentTaskContext: (clusterId: string) => Promise<void>;
  syncProjectPrompts: (clusterId: string) => Promise<void>;
  applyManagerProposal: (clusterId: string, proposalId: string) => Promise<void>;
  dismissManagerProposal: (clusterId: string, proposalId: string) => Promise<void>;
  sendMessage: (clusterId: string, input: SendAgentClusterMessageRequest) => Promise<void>;
  applyClusterUpdate: (cluster: AgentClusterUpdate) => void;
  applyCreationStatus: (status: AgentClusterCreationStatus) => void;
  selectCluster: (clusterId: string | null) => void;
  selectAgent: (agentId: string | null) => void;
  clearError: () => void;
}

function upsertCluster(clusters: AgentCluster[], cluster: AgentCluster): AgentCluster[] {
  const existingIndex = clusters.findIndex((item) => item.clusterId === cluster.clusterId);
  if (existingIndex >= 0) {
    return clusters.map((item, index) => index === existingIndex ? cluster : item);
  }
  return [cluster, ...clusters].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

function isAgentCluster(value: unknown): value is AgentCluster {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { clusterId?: unknown }).clusterId === 'string'
    && typeof (value as { clusterName?: unknown }).clusterName === 'string',
  );
}

function mergeAgentClusterUpdate(existing: AgentCluster | undefined, update: AgentClusterUpdate): AgentCluster {
  if (!existing) return update as AgentCluster;
  const existingAgents = new Map(existing.agents.map((agent) => [agent.agentId, agent]));
  const agents = update.agents?.map((agent) => {
    const current = existingAgents.get(agent.agentId);
    if (!current) return agent;
    return {
      ...current,
      ...agent,
      localContext: {
        ...current.localContext,
        ...agent.localContext,
      },
    };
  }) ?? existing.agents;
  return {
    ...existing,
    ...update,
    agents,
    sharedContext: {
      ...existing.sharedContext,
      ...(update.sharedContext ?? {}),
    },
  };
}

function visibleClusterSignature(cluster: AgentCluster): string {
  const latestRun = cluster.runs?.[0];
  return JSON.stringify({
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    activeRunId: cluster.activeRunId,
    agents: cluster.agents.map((agent) => [
      agent.agentId,
      agent.status,
      agent.currentTask,
      agent.runtimeStatusReason,
      agent.localContext.outputs?.length ?? 0,
    ]),
    events: cluster.events?.slice(0, 40).map((event) => event.eventId) ?? [],
    latestRun: latestRun ? [
      latestRun.runId,
      latestRun.status,
      latestRun.harnessStatus,
      latestRun.submittedChildCount,
      latestRun.completedChildCount,
      latestRun.failedChildCount,
      latestRun.childRuns.map((child) => [
        child.agentId,
        child.status,
        child.submitStatus,
        child.runtimeWaitReason,
      ]),
    ] : null,
  });
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
  creationRequestId: null,
  managerRequestId: null,
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
    set({ creating: true, error: null, creationStatus: null, creationRequestId: requestId });
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
        creationRequestId: null,
      }));
      return cluster;
    } catch (error) {
      if (pollTimer) window.clearInterval(pollTimer);
      const message = getErrorMessage(error);
      set({
        error: message.includes('终止') ? null : message,
        creating: false,
        creationRequestId: null,
      });
      return null;
    }
  },

  abortCreation: async () => {
    const requestId = useAgentClusterStore.getState().creationRequestId;
    if (!requestId) return;
    try {
      const response = await hostApiFetch<AgentClusterCreationStatusResponse>(
        `/api/agent-clusters/creation-status/${encodeURIComponent(requestId)}/abort`,
        { method: 'POST' },
      );
      set({
        creationStatus: response.status ?? null,
        creating: false,
        creationRequestId: null,
        error: null,
      });
    } catch (error) {
      set({ error: getErrorMessage(error), creating: false, creationRequestId: null });
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

  saveWorkflow: async (clusterId, workflow) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/workflow`,
        {
          method: 'PATCH',
          body: JSON.stringify(workflow),
        },
      );
      const cluster = requireCluster(response, '保存 Workflow');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  confirmWorkflow: async (clusterId, workflowId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/workflow/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ workflowId }),
        },
      );
      const cluster = requireCluster(response, '确认 Workflow');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  rollbackWorkflow: async (clusterId, workflowId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/workflow/rollback`,
        {
          method: 'POST',
          body: JSON.stringify({ workflowId }),
        },
      );
      const cluster = requireCluster(response, '回退 Workflow');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  saveWorkflowTemplate: async (clusterId, input = {}) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/workflow-templates`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      const cluster = requireCluster(response, '保存 Workflow 模板');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  saveWorkflowScript: async (clusterId, input) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/workflow-script`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      const cluster = requireCluster(response, '保存 JS Workflow');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  confirmWorkflowScript: async (clusterId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/workflow-script/confirm`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '确认 JS Workflow');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  selectFreezeFolder: async (clusterId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterFreezeSelectResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/freeze/select-folder`,
        { method: 'POST' },
      );
      if (!response.success) throw new Error(response.error || '选择导出目录失败');
      return response.canceled ? null : response.folderPath ?? null;
    } catch (error) {
      set({ error: getErrorMessage(error) });
      return null;
    }
  },

  freezeCluster: async (clusterId, targetDirectory) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterFreezeResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/freeze`,
        {
          method: 'POST',
          body: JSON.stringify({ targetDirectory }),
        },
      );
      if (!response.success) throw new Error(response.error || '固化集群失败');
      return response.targetDirectory ?? null;
    } catch (error) {
      set({ error: getErrorMessage(error) });
      return null;
    }
  },

  createAgent: async (clusterId, input) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/agents`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      const cluster = requireCluster(response, '新增 Agent');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
      return cluster;
    } catch (error) {
      set({ error: getErrorMessage(error) });
      return null;
    }
  },

  startRun: async (clusterId, args) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs`,
        {
          method: 'POST',
          body: JSON.stringify({ args: args ?? {} }),
        },
      );
      const cluster = requireCluster(response, '启动运行');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  pauseRun: async (clusterId, runId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/pause`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '暂停运行');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  resumeRun: async (clusterId, runId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/resume`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '恢复运行');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  stopRun: async (clusterId, runId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/stop`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '停止运行');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  decideHumanGate: async (clusterId, runId, nodeId, decision) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/runs/${encodeURIComponent(runId)}/human-gate`,
        {
          method: 'POST',
          body: JSON.stringify({ nodeId, decision }),
        },
      );
      const cluster = requireCluster(response, '提交人工门禁');
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
    const requestId = input.requestId || crypto.randomUUID();
    set({ sending: true, error: null, managerRequestId: requestId });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/manager/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ ...input, requestId }),
        },
      );
      const cluster = requireCluster(response, '发送 Manager 指令');
      set((state) => ({
        clusters: upsertCluster(state.clusters, cluster),
        sending: false,
        managerRequestId: state.managerRequestId === requestId ? null : state.managerRequestId,
      }));
    } catch (error) {
      const message = getErrorMessage(error);
      set((state) => ({
        error: message.includes('终止') ? null : message,
        sending: false,
        managerRequestId: state.managerRequestId === requestId ? null : state.managerRequestId,
      }));
      if (message.includes('终止')) throw error;
    }
  },

  abortManagerMessage: async (clusterId) => {
    const requestId = useAgentClusterStore.getState().managerRequestId;
    if (!requestId) return;
    try {
      await hostApiFetch<{ success: boolean; aborted: boolean; error?: string }>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/manager/messages/${encodeURIComponent(requestId)}/abort`,
        { method: 'POST' },
      );
      set({ sending: false, managerRequestId: null, error: null });
    } catch (error) {
      set({ error: getErrorMessage(error), sending: false, managerRequestId: null });
    }
  },

  resetCurrentTaskContext: async (clusterId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/context/reset-current-task`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '清理本轮上下文');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster), selectedAgentId: null }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  syncProjectPrompts: async (clusterId) => {
    set({ error: null });
    try {
      const response = await hostApiFetch<AgentClusterResponse>(
        `/api/agent-clusters/${encodeURIComponent(clusterId)}/sync-project-prompts`,
        { method: 'POST' },
      );
      const cluster = requireCluster(response, '同步项目 prompt');
      set((state) => ({ clusters: upsertCluster(state.clusters, cluster) }));
    } catch (error) {
      set({ error: getErrorMessage(error) });
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
    set((state) => {
      const existing = state.clusters.find((item) => item.clusterId === cluster.clusterId);
      const merged = mergeAgentClusterUpdate(existing, cluster);
      if (existing && visibleClusterSignature(existing) === visibleClusterSignature(merged)) {
        return state;
      }
      return { clusters: upsertCluster(state.clusters, merged) };
    });
  },

  applyCreationStatus: (status) => {
    set({
      creationStatus: status,
      creating: status.status === 'running' ? useAgentClusterStore.getState().creating : false,
      creationRequestId: status.status === 'running' ? useAgentClusterStore.getState().creationRequestId : null,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));

if (typeof window !== 'undefined') {
  subscribeHostEvent<{ cluster?: AgentClusterUpdate }>('agent-cluster:updated', (payload) => {
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
