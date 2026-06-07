import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import type { HostEventBus } from '../api/event-bus';
import { getProviderService } from '../services/providers/provider-service';
import { getProviderConfig } from './provider-registry';

type AgentClusterSourceType = 'new_task' | 'existing_task';
type AgentClusterStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error';
type AgentClusterRelationType =
  | 'depends_on'
  | 'reviews'
  | 'delegates_to'
  | 'reports_to'
  | 'collaborates_with';
type AgentClusterExecutionType =
  | 'blocks'
  | 'informs'
  | 'reviews'
  | 'reports_to'
  | 'writes_to_memory';
type AgentClusterSenderType = 'user' | 'system' | 'orchestrator' | 'agent';
type AgentClusterTargetType = 'cluster' | 'agent';
type AgentClusterMessageType =
  | 'instruction'
  | 'question'
  | 'answer'
  | 'update'
  | 'result'
  | 'critique'
  | 'summary'
  | 'error';
type AgentClusterMessageVisibility = 'public' | 'targeted' | 'private';
type AgentClusterRunStatus = 'starting' | 'running' | 'blocked' | 'completed' | 'error' | 'aborted' | 'timeout';
type AgentClusterRunMode = 'single_chat' | 'subagent_swarm';
type AgentClusterChildSubmitStatus = 'pending' | 'submitted' | 'failed';
type AgentClusterCompletionSource = 'structured' | 'fallback' | 'runtime_final' | 'manual';
type AgentClusterArtifactValidationStatus = 'pending' | 'passed' | 'failed' | 'skipped';
export type AgentClusterInferredKind = 'data' | 'factor' | 'evaluation' | 'memory' | 'other';
type AgentClusterCreationStageStatus = 'pending' | 'running' | 'completed' | 'error';
type AgentClusterCreationStatusValue = 'running' | 'completed' | 'error';
type AgentClusterManagerProposalStatus = 'pending' | 'applied' | 'dismissed';
type AgentClusterCreationStageId =
  | 'read_source'
  | 'prepare_context'
  | 'call_model'
  | 'parse_plan'
  | 'build_agents'
  | 'save_cluster';

interface AgentClusterBaseModelInput {
  id?: string;
  label?: string;
  provider?: 'custom-openai-compatible' | 'provider-account';
  baseUrl?: string;
  model?: string;
  accountId?: string;
}

interface AgentClusterCreationStage {
  stageId: AgentClusterCreationStageId;
  label: string;
  status: AgentClusterCreationStageStatus;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface AgentClusterCreationStatus {
  requestId: string;
  status: AgentClusterCreationStatusValue;
  currentStageId: AgentClusterCreationStageId;
  stages: AgentClusterCreationStage[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  clusterId?: string;
  error?: string;
}

interface AgentClusterEvent {
  eventId: string;
  clusterId: string;
  runId?: string;
  agentId?: string | null;
  title: string;
  content: string;
  level: 'info' | 'success' | 'warning' | 'error';
  raw?: unknown;
  createdAt: string;
}

interface AgentClusterChildRun {
  agentId: string;
  sessionKey: string;
  runId: string;
  status: AgentClusterRunStatus;
  submitStatus?: AgentClusterChildSubmitStatus;
  completionSignal?: string;
  completionSource?: AgentClusterCompletionSource;
  unblockedAgentIds?: string[];
  artifacts?: string[];
  expectedArtifacts?: string[];
  artifactValidationStatus?: AgentClusterArtifactValidationStatus;
  artifactValidationError?: string;
  targetCandidateCount?: number;
  minAcceptedCandidateCount?: number;
  actualCandidateCount?: number;
  runtimeWaitReason?: string;
  iteration?: number;
  outputRoot?: string;
  lastTranscriptMessageId?: string;
  lastEventAt?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

interface AgentClusterRunLoopState {
  loopId: string;
  currentIteration: number;
  repeatCount: number;
  status: 'idle' | 'running' | 'completed';
  updatedAt: string;
}

interface AgentClusterRun {
  runId: string;
  mode: AgentClusterRunMode;
  status: AgentClusterRunStatus;
  sessionKey: string;
  childRuns: AgentClusterChildRun[];
  loopStates?: AgentClusterRunLoopState[];
  roundStart?: number;
  outputVersion?: string;
  outputRoot?: string;
  outputCreatedAt?: string;
  lastHeartbeatAt?: string;
  watchdogStatus?: string;
  submittedChildCount?: number;
  completedChildCount?: number;
  failedChildCount?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  timeoutAt?: string;
}

interface AgentMessage {
  messageId: string;
  clusterId: string;
  senderType: AgentClusterSenderType;
  senderAgentId: string | null;
  targetType: AgentClusterTargetType;
  targetAgentId: string | null;
  messageType: AgentClusterMessageType;
  content: string;
  visibility: AgentClusterMessageVisibility;
  createdAt: string;
}

interface AgentOutput {
  outputId: string;
  agentId: string;
  content: string;
  createdAt: string;
}

interface AgentLocalContext {
  agentId: string;
  systemPrompt: string;
  role: string;
  responsibilities: string[];
  assignedTasks: string[];
  privateMessages: AgentMessage[];
  receivedMessages: AgentMessage[];
  workingMemory: string | Record<string, unknown>;
  outputs: AgentOutput[];
  status: AgentClusterStatus;
}

interface ClusterAgent {
  agentId: string;
  name: string;
  role: string;
  description: string;
  responsibilities: string[];
  status: AgentClusterStatus;
  systemPrompt: string;
  tools: string[];
  capabilities: string[];
  lastActivityAt?: string;
  currentTask?: string;
  runtimeStatusReason?: string;
  runtimeSessionKey?: string;
  runtimeRunId?: string;
  localContext: AgentLocalContext;
}

interface AgentEdge {
  edgeId: string;
  fromAgentId: string;
  toAgentId: string;
  relationType: AgentClusterRelationType;
  label: string;
  executionType?: AgentClusterExecutionType;
  isBlocking?: boolean;
  reason?: string;
}

interface AgentClusterExecutionGraphNode {
  agentId: string;
  x?: number;
  y?: number;
}

interface AgentClusterExecutionLoop {
  loopId: string;
  startAgentId: string;
  endAgentId: string;
  repeatCount: number;
  currentIteration?: number;
  status?: 'idle' | 'running' | 'completed';
}

interface AgentClusterExecutionGraph {
  nodes: AgentClusterExecutionGraphNode[];
  edges: AgentEdge[];
  loops?: AgentClusterExecutionLoop[];
  confirmed: boolean;
  updatedAt: string;
}

interface AgentClusterManagerPromptPatchDraft {
  targetAgentId?: string | null;
  targetAgentName?: string | null;
  instruction: string;
}

interface AgentClusterManagerAgentDraft {
  name: string;
  role: string;
  description: string;
  responsibilities: string[];
  systemPrompt?: string;
  tools: string[];
  capabilities: string[];
}

interface AgentClusterManagerEdgeDraft {
  fromAgentId?: string | null;
  fromAgentName?: string | null;
  toAgentId?: string | null;
  toAgentName?: string | null;
  relationType?: AgentClusterRelationType;
  executionType?: AgentClusterExecutionType;
  isBlocking?: boolean;
  label?: string;
  reason?: string;
}

interface AgentClusterManagerProposal {
  proposalId: string;
  reply: string;
  sourceInstruction: string;
  promptPatches: AgentClusterManagerPromptPatchDraft[];
  agentDrafts: AgentClusterManagerAgentDraft[];
  edgeDrafts: AgentClusterManagerEdgeDraft[];
  sharedContextSummary?: string;
  recommendedResumeFromAgentId?: string | null;
  recommendedResumeFromAgentName?: string | null;
  runDecision?: string;
  status: AgentClusterManagerProposalStatus;
  createdAt: string;
  appliedAt?: string;
  dismissedAt?: string;
}

interface ClusterContext {
  globalGoal: string;
  originalInput: string;
  decompositionPlan: string | Record<string, unknown>;
  constraints: string[];
  facts: string[];
  decisions: string[];
  managerInstructions?: string[];
  promptPatches?: Array<{
    patchId: string;
    targetAgentId?: string | null;
    instruction: string;
    createdAt: string;
  }>;
  runDecisions?: Array<{
    decisionId: string;
    title: string;
    content: string;
    createdAt: string;
  }>;
  latestArtifacts?: Array<{
    agentId: string;
    artifact: string;
    createdAt: string;
  }>;
  managerProposals?: AgentClusterManagerProposal[];
  openQuestions: string[];
  artifacts: Array<{
    artifactId: string;
    title: string;
    kind: string;
    content: string;
    createdAt: string;
  }>;
  agentSummaries: Array<{
    agentId: string;
    name: string;
    summary: string;
    updatedAt: string;
  }>;
  finalSummary: string;
}

export interface AgentCluster {
  clusterId: string;
  clusterName: string;
  sourceType: AgentClusterSourceType;
  sourceContent: string;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
  projectRoot?: string | null;
  projectName?: string;
  projectKey?: string;
  sharedContext: ClusterContext;
  agents: ClusterAgent[];
  edges: AgentEdge[];
  executionGraph?: AgentClusterExecutionGraph;
  orchestrationConfirmedAt?: string | null;
  messages: AgentMessage[];
  runs?: AgentClusterRun[];
  activeRunId?: string | null;
  runtimeSessionKey?: string | null;
  events?: AgentClusterEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentClusterInput {
  sourceType: AgentClusterSourceType;
  taskGoal?: string;
  markdown?: string;
  filePath?: string;
  folderPath?: string;
  baseModel?: AgentClusterBaseModelInput;
  baseProviderAccountId?: string;
  requestId?: string;
}

export interface SendAgentClusterMessageInput {
  content: string;
  targetAgentId?: string | null;
}

export interface SendAgentClusterManagerMessageInput {
  content: string;
  baseModel?: AgentClusterBaseModelInput;
  baseProviderAccountId?: string;
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FOLDER_FILE_BYTES = 512 * 1024;
const RUN_TIMEOUT_MS = 45 * 60 * 1000;
const LLM_PLANNING_TIMEOUT_MS = 4 * 60 * 1000;
const LLM_MANAGER_TIMEOUT_MS = 2 * 60 * 1000;
const RUN_WATCHDOG_INTERVAL_MS = 5 * 1000;
const CHILD_NO_EVENT_TIMEOUT_MS = 5 * 60 * 1000;

function getStorePath(): string {
  return join(app.getPath('userData'), 'agent-clusters.json');
}

let storeQueue: Promise<unknown> = Promise.resolve();
const creationStatuses = new Map<string, AgentClusterCreationStatus>();
const runWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();
const creationStageDefinitions: Array<Pick<AgentClusterCreationStage, 'stageId' | 'label'>> = [
  { stageId: 'read_source', label: '读取资料' },
  { stageId: 'prepare_context', label: '整理上下文' },
  { stageId: 'call_model', label: '调用基模' },
  { stageId: 'parse_plan', label: '解析规划' },
  { stageId: 'build_agents', label: '生成 Agent' },
  { stageId: 'save_cluster', label: '保存集群' },
];

type CreationStatusListener = (status: AgentClusterCreationStatus) => void;

async function withStoreQueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = storeQueue.then(operation, operation);
  storeQueue = run.catch(() => undefined);
  return run;
}

function createCreationStatus(requestId: string): AgentClusterCreationStatus {
  const now = new Date().toISOString();
  const status: AgentClusterCreationStatus = {
    requestId,
    status: 'running',
    currentStageId: 'read_source',
    stages: creationStageDefinitions.map((stage) => ({ ...stage, status: 'pending' })),
    startedAt: now,
    updatedAt: now,
  };
  creationStatuses.set(requestId, status);
  return status;
}

function updateCreationStatus(
  requestId: string,
  stageId: AgentClusterCreationStageId,
  stageStatus: AgentClusterCreationStageStatus,
  detail: string,
  listener?: CreationStatusListener,
  error?: string,
): AgentClusterCreationStatus {
  const now = new Date().toISOString();
  const status = creationStatuses.get(requestId) ?? createCreationStatus(requestId);
  status.currentStageId = stageId;
  status.updatedAt = now;
  status.status = error || stageStatus === 'error' ? 'error' : status.status;
  status.error = error ?? status.error;
  status.stages = status.stages.map((stage) => {
    if (stage.stageId !== stageId) return stage;
    return {
      ...stage,
      status: stageStatus,
      detail,
      startedAt: stage.startedAt ?? (stageStatus === 'running' ? now : undefined),
      completedAt: stageStatus === 'completed' || stageStatus === 'error' ? now : stage.completedAt,
      error: stageStatus === 'error' ? error ?? detail : stage.error,
    };
  });
  creationStatuses.set(requestId, status);
  listener?.(status);
  return status;
}

function completeCreationStatus(
  requestId: string,
  clusterId: string,
  listener?: CreationStatusListener,
): AgentClusterCreationStatus {
  const now = new Date().toISOString();
  const status = creationStatuses.get(requestId) ?? createCreationStatus(requestId);
  status.status = 'completed';
  status.clusterId = clusterId;
  status.completedAt = now;
  status.updatedAt = now;
  status.stages = status.stages.map((stage) => ({
    ...stage,
    status: stage.status === 'pending' || stage.status === 'running' ? 'completed' : stage.status,
    completedAt: stage.completedAt ?? now,
  }));
  creationStatuses.set(requestId, status);
  listener?.(status);
  setTimeout(() => creationStatuses.delete(requestId), 10 * 60 * 1000).unref?.();
  return status;
}

export function getAgentClusterCreationStatus(requestId: string): AgentClusterCreationStatus | null {
  return creationStatuses.get(requestId) ?? null;
}

function isRawAgentCluster(value: unknown): value is AgentCluster {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { clusterId?: unknown }).clusterId === 'string'
    && typeof (value as { clusterName?: unknown }).clusterName === 'string',
  );
}

function normalizeRelationType(value: unknown): AgentClusterRelationType {
  if (
    value === 'depends_on'
    || value === 'reviews'
    || value === 'delegates_to'
    || value === 'reports_to'
    || value === 'collaborates_with'
  ) {
    return value;
  }
  return 'collaborates_with';
}

function normalizeExecutionType(edge: Partial<AgentEdge> | { relationType?: unknown; executionType?: unknown }): AgentClusterExecutionType {
  const executionType = edge.executionType;
  if (
    executionType === 'blocks'
    || executionType === 'informs'
    || executionType === 'reviews'
    || executionType === 'reports_to'
    || executionType === 'writes_to_memory'
  ) {
    return executionType;
  }
  if (edge.relationType === 'depends_on') return 'blocks';
  if (edge.relationType === 'reviews') return 'reviews';
  if (edge.relationType === 'reports_to') return 'reports_to';
  return 'informs';
}

function executionTypeLabelForManager(value: AgentClusterExecutionType): string {
  switch (value) {
    case 'blocks':
      return '先后依赖';
    case 'reviews':
      return '审查后继续';
    case 'reports_to':
      return '汇报';
    case 'writes_to_memory':
      return '写入记忆';
    default:
      return '参考信息';
  }
}

function isBlockingExecutionEdge(edge: Partial<AgentEdge>): boolean {
  const executionType = normalizeExecutionType(edge);
  return edge.isBlocking === true || executionType === 'blocks' || executionType === 'reviews';
}

function normalizeEdge(edge: AgentEdge): AgentEdge {
  const executionType = normalizeExecutionType(edge);
  return {
    ...edge,
    relationType: normalizeRelationType(edge.relationType),
    executionType,
    isBlocking: edge.isBlocking ?? (executionType === 'blocks' || executionType === 'reviews'),
    reason: edge.reason?.trim() || undefined,
  };
}

function buildExecutionGraph(agents: ClusterAgent[], edges: AgentEdge[], confirmed = false, updatedAt = new Date().toISOString()): AgentClusterExecutionGraph {
  return {
    nodes: agents.map((agent, index) => ({
      agentId: agent.agentId,
      x: (index % 3) * 320,
      y: Math.floor(index / 3) * 180,
    })),
    edges: edges.map(normalizeEdge),
    loops: [],
    confirmed,
    updatedAt,
  };
}

function normalizeExecutionLoops(cluster: AgentCluster, loops: unknown): AgentClusterExecutionLoop[] {
  if (!Array.isArray(loops)) return [];
  const agentIds = new Set(cluster.agents.map((agent) => agent.agentId));
  const seen = new Set<string>();
  return loops
    .map((loop, index) => {
      if (!loop || typeof loop !== 'object') return null;
      const input = loop as Partial<AgentClusterExecutionLoop>;
      const startAgentId = typeof input.startAgentId === 'string' ? input.startAgentId : '';
      const endAgentId = typeof input.endAgentId === 'string' ? input.endAgentId : '';
      if (!agentIds.has(startAgentId) || !agentIds.has(endAgentId) || startAgentId === endAgentId) return null;
      const key = `${startAgentId}:${endAgentId}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const repeatCount = Math.max(1, Math.min(20, Math.floor(Number(input.repeatCount) || 1)));
      return {
        loopId: typeof input.loopId === 'string' && input.loopId ? input.loopId : `loop-${index}-${randomUUID()}`,
        startAgentId,
        endAgentId,
        repeatCount,
        currentIteration: typeof input.currentIteration === 'number' ? input.currentIteration : undefined,
        status: input.status === 'running' || input.status === 'completed' ? input.status : 'idle',
      } satisfies AgentClusterExecutionLoop;
    })
    .filter((loop): loop is AgentClusterExecutionLoop => Boolean(loop));
}

function normalizeExecutionGraph(cluster: AgentCluster): AgentClusterExecutionGraph {
  const now = cluster.updatedAt ?? new Date().toISOString();
  const graph = cluster.executionGraph;
  const agents = cluster.agents ?? [];
  const edges = Array.isArray(graph?.edges)
    ? graph.edges.map(normalizeEdge)
    : (cluster.edges ?? []).map(normalizeEdge);
  const nodeIds = new Set(agents.map((agent) => agent.agentId));
  const existingNodes = Array.isArray(graph?.nodes)
    ? graph.nodes.filter((node) => nodeIds.has(node.agentId))
    : [];
  const seen = new Set(existingNodes.map((node) => node.agentId));
  const missingNodes = agents
    .filter((agent) => !seen.has(agent.agentId))
    .map((agent, index) => ({
      agentId: agent.agentId,
      x: ((existingNodes.length + index) % 3) * 320,
      y: Math.floor((existingNodes.length + index) / 3) * 180,
    }));
  return {
    nodes: [...existingNodes, ...missingNodes],
    edges,
    loops: normalizeExecutionLoops(cluster, graph?.loops),
    confirmed: Boolean(graph?.confirmed),
    updatedAt: graph?.updatedAt ?? now,
  };
}

function assertBlockingDag(cluster: AgentCluster, graph: AgentClusterExecutionGraph): void {
  const nodeIds = new Set(cluster.agents.map((agent) => agent.agentId));
  const adjacency = new Map<string, string[]>();
  for (const agentId of nodeIds) adjacency.set(agentId, []);
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.fromAgentId) || !nodeIds.has(edge.toAgentId)) continue;
    if (isBlockingExecutionEdge(edge)) adjacency.get(edge.fromAgentId)?.push(edge.toAgentId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (agentId: string): boolean => {
    if (visiting.has(agentId)) return false;
    if (visited.has(agentId)) return true;
    visiting.add(agentId);
    for (const next of adjacency.get(agentId) ?? []) {
      if (!visit(next)) return false;
    }
    visiting.delete(agentId);
    visited.add(agentId);
    return true;
  };

  for (const agentId of nodeIds) {
    if (!visit(agentId)) {
      throw new Error('编排图存在阻塞环路，请删除循环依赖后再确认流水线');
    }
  }

  for (const loop of graph.loops ?? []) {
    const path = getBlockingPathAgentIds({ ...cluster, executionGraph: graph }, loop.startAgentId, loop.endAgentId);
    if (path.length === 0) {
      throw new Error('循环组件必须落在一条有效的阻塞顺序链路上，请先添加 blocks/reviews 边');
    }
  }
}

function normalizeCluster(cluster: AgentCluster): AgentCluster {
  const normalizedEdges = (cluster.edges ?? []).map(normalizeEdge);
  const normalizedGraph = normalizeExecutionGraph({ ...cluster, edges: normalizedEdges });
  const projectRoot = cluster.projectRoot
    ?? cluster.sourceFolderPath
    ?? (cluster.sourcePath ? dirname(cluster.sourcePath) : null);
  return {
    ...cluster,
    sourcePath: cluster.sourcePath ?? null,
    sourceFolderPath: cluster.sourceFolderPath ?? null,
    projectRoot,
    projectName: cluster.projectName ?? inferProjectName(projectRoot),
    projectKey: cluster.projectKey ?? inferProjectKey(projectRoot),
    activeRunId: cluster.activeRunId ?? null,
    runtimeSessionKey: cluster.runtimeSessionKey ?? null,
    events: Array.isArray(cluster.events) ? cluster.events : [],
    edges: normalizedEdges,
    executionGraph: normalizedGraph,
    orchestrationConfirmedAt: cluster.orchestrationConfirmedAt ?? null,
    runs: Array.isArray(cluster.runs)
      ? cluster.runs.map((run) => ({
        ...run,
        loopStates: Array.isArray(run.loopStates) ? run.loopStates.map((state) => ({
          loopId: state.loopId,
          currentIteration: Math.max(1, Math.floor(Number(state.currentIteration) || 1)),
          repeatCount: Math.max(1, Math.min(20, Math.floor(Number(state.repeatCount) || 1))),
          status: state.status === 'running' || state.status === 'completed' ? state.status : 'idle',
          updatedAt: state.updatedAt ?? run.updatedAt,
        })) : [],
        roundStart: typeof run.roundStart === 'number' ? Math.max(1, Math.floor(run.roundStart)) : undefined,
        outputVersion: run.outputVersion,
        outputRoot: run.outputRoot,
        outputCreatedAt: run.outputCreatedAt,
        childRuns: (run.childRuns ?? []).map((child) => ({
          ...child,
          iteration: typeof child.iteration === 'number' ? child.iteration : undefined,
          outputRoot: run.outputRoot ?? child.outputRoot,
          submitStatus: child.submitStatus ?? (child.runId ? 'submitted' : 'pending'),
          unblockedAgentIds: Array.isArray(child.unblockedAgentIds) ? child.unblockedAgentIds : [],
          artifacts: Array.isArray(child.artifacts) ? child.artifacts : [],
          expectedArtifacts: Array.isArray(child.expectedArtifacts) ? child.expectedArtifacts : [],
        })),
        submittedChildCount: run.submittedChildCount ?? (run.childRuns ?? []).filter((child) => child.submitStatus === 'submitted' || child.runId).length,
        completedChildCount: run.completedChildCount ?? (run.childRuns ?? []).filter((child) => child.status === 'completed').length,
        failedChildCount: run.failedChildCount ?? (run.childRuns ?? []).filter((child) => child.status === 'error' || child.status === 'timeout').length,
      }))
      : [],
    agents: (cluster.agents ?? []).map((agent) => ({
      ...agent,
      lastActivityAt: agent.lastActivityAt,
      currentTask: agent.currentTask,
      runtimeStatusReason: agent.runtimeStatusReason,
      runtimeSessionKey: agent.runtimeSessionKey,
      runtimeRunId: agent.runtimeRunId,
      localContext: {
        ...agent.localContext,
        status: agent.localContext.status ?? agent.status ?? 'idle',
      },
    })),
    sharedContext: {
      ...cluster.sharedContext,
      managerInstructions: Array.isArray(cluster.sharedContext.managerInstructions) ? cluster.sharedContext.managerInstructions : [],
      promptPatches: Array.isArray(cluster.sharedContext.promptPatches) ? cluster.sharedContext.promptPatches : [],
      runDecisions: Array.isArray(cluster.sharedContext.runDecisions) ? cluster.sharedContext.runDecisions : [],
      latestArtifacts: Array.isArray(cluster.sharedContext.latestArtifacts) ? cluster.sharedContext.latestArtifacts : [],
      managerProposals: Array.isArray(cluster.sharedContext.managerProposals) ? cluster.sharedContext.managerProposals : [],
    },
  };
}

async function readClusters(): Promise<AgentCluster[]> {
  try {
    const raw = await readFile(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as { clusters?: AgentCluster[] } | AgentCluster[];
    const clusters = Array.isArray(parsed) ? parsed : Array.isArray(parsed.clusters) ? parsed.clusters : [];
    return clusters.filter(isRawAgentCluster).map(normalizeCluster);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const storePath = getStorePath();
      try {
        await rename(storePath, `${storePath}.corrupt.${Date.now()}`);
      } catch {
        // Ignore backup failures and recover with an empty list.
      }
    }
    return [];
  }
}

async function writeClusters(clusters: AgentCluster[]): Promise<void> {
  const storePath = getStorePath();
  await mkdir(dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tempPath, JSON.stringify({ clusters }, null, 2), 'utf8');
  await rename(tempPath, storePath);
}

function compactText(text: string, max = 360): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function inferProjectName(pathValue: string | null): string {
  if (!pathValue) return '未归档任务';
  return basename(pathValue) || basename(dirname(pathValue)) || '未命名项目';
}

function inferProjectKey(pathValue: string | null): string {
  return pathValue?.trim() || 'unfiled';
}

function summarizeSourceLocation(input: CreateAgentClusterInput): Pick<AgentCluster, 'sourcePath' | 'sourceFolderPath' | 'projectRoot' | 'projectName' | 'projectKey'> {
  const folderPath = input.folderPath?.trim() || '';
  if (folderPath) {
    return {
      sourcePath: null,
      sourceFolderPath: folderPath,
      projectRoot: folderPath,
      projectName: inferProjectName(folderPath),
      projectKey: inferProjectKey(folderPath),
    };
  }
  const filePath = input.filePath?.trim() || '';
  if (filePath) {
    const parent = dirname(filePath);
    return {
      sourcePath: filePath,
      sourceFolderPath: null,
      projectRoot: parent,
      projectName: inferProjectName(parent),
      projectKey: inferProjectKey(parent),
    };
  }
  return {
    sourcePath: null,
    sourceFolderPath: null,
    projectRoot: null,
    projectName: '未归档任务',
    projectKey: 'unfiled',
  };
}

function extractListCandidates(input: string, keywords: string[]): string[] {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines
    .filter((line) => keywords.some((keyword) => line.toLowerCase().includes(keyword)))
    .map((line) => line.replace(/^[-*#\d.\s]+/, '').trim())
    .slice(0, 6);
}

function makeMessage(
  clusterId: string,
  input: Omit<AgentMessage, 'messageId' | 'clusterId' | 'createdAt'>,
  createdAt = new Date().toISOString(),
): AgentMessage {
  return {
    messageId: randomUUID(),
    clusterId,
    createdAt,
    ...input,
  };
}

function agentBlueprints(taskText: string): Array<{
  name: string;
  role: string;
  description: string;
  responsibilities: string[];
  tools: string[];
  capabilities: string[];
}> {
  const lower = taskText.toLowerCase();
  const wantsReview = /review|审查|验证|评估|test|测试|风险/.test(lower);
  const wantsData = /data|数据|因子|研究|analysis|分析|market|市场/.test(lower);
  const wantsBuild = /implement|实现|build|创建|执行|落地|开发/.test(lower);

  const base = [
    {
      name: '任务规划 Agent',
      role: 'Orchestrator',
      description: '拆解目标、维护共享上下文，并协调其他 Agent 的工作边界。',
      responsibilities: ['明确全局目标', '拆分阶段任务', '维护决策与开放问题', '同步关键输出'],
      tools: ['planning', 'context-sync'],
      capabilities: ['任务拆解', '依赖编排', '上下文压缩'],
    },
    {
      name: wantsData ? '研究分析 Agent' : '需求分析 Agent',
      role: wantsData ? 'Research Analyst' : 'Requirement Analyst',
      description: '抽取事实、约束与背景，形成可执行的分析材料。',
      responsibilities: ['提取关键事实', '整理约束条件', '识别未知问题', '输出分析摘要'],
      tools: ['research-notes', 'file-context'],
      capabilities: ['资料整理', '事实抽取', '问题建模'],
    },
    {
      name: wantsBuild ? '执行 Agent' : '方案设计 Agent',
      role: wantsBuild ? 'Executor' : 'Solution Designer',
      description: '把拆解后的任务转为具体执行方案与交付物。',
      responsibilities: ['制定执行步骤', '产出初版结果', '记录实现假设', '反馈阻塞点'],
      tools: ['workspace', 'artifact-draft'],
      capabilities: ['方案落地', '交付物生成', '状态汇报'],
    },
    {
      name: wantsReview ? '审查 Agent' : '质量控制 Agent',
      role: 'Reviewer',
      description: '检查方案的一致性、风险和遗漏，给出修改建议。',
      responsibilities: ['审查结果质量', '发现风险', '验证约束满足情况', '提出改进建议'],
      tools: ['review-checklist'],
      capabilities: ['质量评估', '风险识别', '一致性检查'],
    },
    {
      name: '汇总 Agent',
      role: 'Synthesizer',
      description: '整合多 Agent 输出，形成最终摘要和下一步建议。',
      responsibilities: ['汇总各方结论', '沉淀关键决策', '整理最终输出', '更新共享上下文'],
      tools: ['summary', 'memory-draft'],
      capabilities: ['综合归纳', '报告生成', '记忆沉淀'],
    },
  ];

  if (taskText.length > 900 || /多源|跨市场|pipeline|workflow|自动化|回测|backtest/.test(lower)) {
    base.splice(3, 0, {
      name: '系统集成 Agent',
      role: 'Integration Engineer',
      description: '关注工具、数据流与执行接口之间的衔接。',
      responsibilities: ['定义接口边界', '检查数据流', '规划集成顺序', '识别兼容性问题'],
      tools: ['integration-plan', 'api-boundary'],
      capabilities: ['系统集成', '接口设计', '流程编排'],
    });
  }

  return base.slice(0, 6);
}

function buildAgent(
  clusterId: string,
  blueprint: ReturnType<typeof agentBlueprints>[number],
  index: number,
  taskText: string,
): ClusterAgent {
  const agentId = `agent-${index + 1}-${randomUUID().slice(0, 8)}`;
  const assignedTasks = blueprint.responsibilities.map((item) => `${item}：围绕「${compactText(taskText, 80)}」执行。`);
  const systemPrompt = [
    `你是 ${blueprint.name}，角色是 ${blueprint.role}。`,
    '你只维护自己的本地上下文，不读取其他 Agent 的完整私有历史。',
    '需要共享的信息应输出为简短、可同步的结论，由 orchestrator 写入 ClusterContext。',
  ].join('\n');

  return {
    agentId,
    name: blueprint.name,
    role: blueprint.role,
    description: blueprint.description,
    responsibilities: blueprint.responsibilities,
    status: 'idle',
    systemPrompt,
    tools: blueprint.tools,
    capabilities: blueprint.capabilities,
    localContext: {
      agentId,
      systemPrompt,
      role: blueprint.role,
      responsibilities: blueprint.responsibilities,
      assignedTasks,
      privateMessages: [],
      receivedMessages: [],
      workingMemory: {
        focus: blueprint.description,
        sourceDigest: compactText(taskText, 260),
      },
      outputs: [],
      status: 'idle',
    },
  };
}

function createEdges(agents: ClusterAgent[]): AgentEdge[] {
  const orchestrator = agents[0];
  const synthesizer = agents[agents.length - 1];
  const edges: AgentEdge[] = [];

  for (const agent of agents.slice(1)) {
    edges.push({
      edgeId: randomUUID(),
      fromAgentId: orchestrator.agentId,
      toAgentId: agent.agentId,
      relationType: 'delegates_to',
      executionType: agent === agents[1] ? 'blocks' : 'informs',
      isBlocking: agent === agents[1],
      label: '分派任务',
      reason: agent === agents[1] ? '启动流水线入口 Agent' : '编排器提供任务上下文',
    });
  }

  for (const agent of agents.slice(1, -1)) {
    const executionType = agent.name.includes('审查') || agent.name.includes('质量') ? 'reviews' : 'reports_to';
    edges.push({
      edgeId: randomUUID(),
      fromAgentId: agent.agentId,
      toAgentId: synthesizer.agentId,
      relationType: agent.name.includes('审查') || agent.name.includes('质量') ? 'reviews' : 'reports_to',
      executionType,
      isBlocking: executionType === 'reviews',
      label: agent.name.includes('审查') || agent.name.includes('质量') ? '审查反馈' : '汇报结果',
      reason: executionType === 'reviews' ? '审查结果会影响汇总输出' : '向汇总 Agent 提交产物',
    });
  }

  return edges;
}

interface LlmClusterPlan {
  globalGoal?: string;
  decompositionPlan?: string | Record<string, unknown>;
  constraints?: string[];
  facts?: string[];
  openQuestions?: string[];
  agents?: Array<{
    name?: string;
    role?: string;
    description?: string;
    responsibilities?: string[];
    systemPrompt?: string;
    tools?: string[];
    capabilities?: string[];
  }>;
  edges?: Array<{
    fromAgentName?: string;
    toAgentName?: string;
    relationType?: AgentClusterRelationType;
    executionType?: AgentClusterExecutionType;
    isBlocking?: boolean;
    label?: string;
    reason?: string;
  }>;
}

interface SourceSection {
  path: string;
  content: string;
}

interface SourceAgentDefinition {
  name: string;
  role: string;
  description: string;
  responsibilities: string[];
  systemPrompt: string;
  tools: string[];
  capabilities: string[];
}

interface LlmManagerDecision {
  reply?: string;
  targetAgentIds?: string[];
  targetAgentNames?: string[];
  promptPatches?: AgentClusterManagerPromptPatchDraft[];
  agentDrafts?: AgentClusterManagerAgentDraft[];
  edgeDrafts?: AgentClusterManagerEdgeDraft[];
  sharedContextUpdates?: {
    facts?: string[];
    decisions?: string[];
    openQuestions?: string[];
    latestArtifacts?: string[];
    summary?: string;
  };
  sharedContextSummary?: string;
  recommendedResumeFromAgentId?: string | null;
  recommendedResumeFromAgentName?: string | null;
  runDecision?: string;
}

function coerceStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
    : fallback;
}

function extractJsonObject(text: string): LlmClusterPlan {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('基模没有返回可解析的 Agent 集群 JSON');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as LlmClusterPlan;
}

function extractJsonObjectAs<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('基模没有返回可解析的 JSON');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

function parseSourceSections(sourceContent: string): SourceSection[] {
  return sourceContent
    .split(/\n\n---\n\n/g)
    .map((section) => {
      const match = section.match(/^# Source:\s*(.+?)\n\n([\s\S]*)$/);
      if (!match) return null;
      return { path: match[1].trim(), content: match[2].trim() };
    })
    .filter((section): section is SourceSection => Boolean(section));
}

function extractFrontMatterValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() || null;
}

function splitCsvMeta(value: string | null): string[] {
  return value
    ? value.split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 12)
    : [];
}

function extractMarkdownSection(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return '';
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    collected.push(line);
  }
  return collected.join('\n').trim();
}

function extractListFromMarkdownSection(section: string, maxItems = 12): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]|\d+[.)、]/.test(line))
    .map((line) => line
      .replace(/^[-*]\s*/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .replace(/\*\*/g, '')
      .trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function humanizeAgentFileName(filePath: string): string {
  return basename(filePath, '.md')
    .replace(/^agent[_-]?/i, 'Agent_')
    .replace(/[-\s]+/g, '_')
    .replace(/__+/g, '_');
}

function extractSourceAgentDefinitions(sourceContent: string): SourceAgentDefinition[] {
  const sections = parseSourceSections(sourceContent)
    .filter((section) => /^agents\/[^/]+\.md$/i.test(section.path));
  return sections.map((section, index) => {
    const title = section.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const identity = extractMarkdownSection(section.content, '身份');
    const role = extractFrontMatterValue(section.content, 'agent_role')
      ?? title?.split(/[—-]/)[1]?.trim()
      ?? `Agent ${index + 1}`;
    const name = extractFrontMatterValue(section.content, 'agent_name')
      ?? title?.split(/[—-]/)[0]?.trim().replace(/\s+/g, '_')
      ?? humanizeAgentFileName(section.path);
    const description = extractFrontMatterValue(section.content, 'agent_description')
      ?? identity.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('#'))?.replace(/\*\*/g, '').trim()
      ?? `${name} 负责 ${role}`;
    const responsibilities = extractListFromMarkdownSection(extractMarkdownSection(section.content, '职责'));
    const tools = splitCsvMeta(extractFrontMatterValue(section.content, 'agent_tools'));
    const capabilities = splitCsvMeta(extractFrontMatterValue(section.content, 'agent_capabilities'));
    return {
      name,
      role,
      description,
      responsibilities: responsibilities.length > 0 ? responsibilities : [description],
      systemPrompt: section.content,
      tools,
      capabilities,
    };
  }).slice(0, 12);
}

function extractSourceAgentToolSummary(sourceContent: string): string {
  const sections = parseSourceSections(sourceContent)
    .filter((section) => /^agents\/tools\/[^/]+\.(?:py|md)$/i.test(section.path));
  if (sections.length === 0) return '未检测到 agents/tools 稳定工具入口。';
  return sections
    .map((section) => {
      const docstring = section.content.match(/^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/m)?.[1]?.trim();
      const description = docstring ? `：${compactText(docstring, 120)}` : '';
      return `- ${section.path}${description}`;
    })
    .join('\n');
}

function normalizeAgentNameForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function requirePlanningEndpoint(
  accountLabel: string,
  baseUrl: string | undefined,
  model: string | undefined,
): { baseUrl: string; model: string } {
  const normalizedBaseUrl = baseUrl?.trim();
  const normalizedModel = model?.trim();
  if (!normalizedBaseUrl || !normalizedModel) {
    throw new Error(`AI Provider“${accountLabel}”缺少 Base URL 或模型配置，请先在“设置 → AI Providers”中补全。`);
  }
  return { baseUrl: normalizedBaseUrl, model: normalizedModel };
}

async function resolvePlanningModel(input: CreateAgentClusterInput): Promise<{
  baseUrl: string;
  model: string;
  apiKey: string;
  headers: Record<string, string>;
}> {
  const providerService = getProviderService();
  const baseModel = input.baseModel;
  if (baseModel?.provider === 'custom-openai-compatible') {
    const baseUrl = baseModel.baseUrl?.trim();
    const model = baseModel.model?.trim();
    if (baseUrl && model) {
      return { baseUrl, model, apiKey: 'investclaw-local', headers: {} };
    }
  }
  if (baseModel?.provider === 'provider-account' && baseModel.accountId) {
    const account = await providerService.getAccount(baseModel.accountId);
    if (account?.enabled) {
      const vendorConfig = getProviderConfig(account.vendorId);
      const apiKey = await providerService.getLegacyProviderApiKey(account.id);
      const endpoint = requirePlanningEndpoint(
        account.label,
        baseModel.baseUrl || account.baseUrl || vendorConfig?.baseUrl,
        baseModel.model || account.model || vendorConfig?.models?.[0]?.id,
      );
      return {
        ...endpoint,
        apiKey: apiKey || 'investclaw-local',
        headers: account.headers ?? {},
      };
    }
    throw new Error('选择的 AI Provider 不存在或已停用，请重新选择基模。');
  }
  const accountId = input.baseProviderAccountId || await providerService.getDefaultAccountId();
  if (!accountId) {
    throw new Error('尚未配置默认 AI Provider，请先前往“设置 → AI Providers”添加并启用一个账号。');
  }

  const account = await providerService.getAccount(accountId);
  if (!account || !account.enabled) {
    throw new Error('默认 AI Provider 不存在或已停用，请在“设置 → AI Providers”中重新选择。');
  }

  const vendorConfig = getProviderConfig(account.vendorId);
  const apiKey = await providerService.getLegacyProviderApiKey(account.id);
  const endpoint = requirePlanningEndpoint(
    account.label,
    account.baseUrl || vendorConfig?.baseUrl,
    account.model || vendorConfig?.models?.[0]?.id,
  );
  return {
    ...endpoint,
    apiKey: apiKey || 'investclaw-local',
    headers: account.headers ?? {},
  };
}

function buildPlanningPrompt(sourceContent: string): string {
  const sourceAgents = extractSourceAgentDefinitions(sourceContent);
  const sourceAgentToolSummary = extractSourceAgentToolSummary(sourceContent);
  const sourceAgentSummary = sourceAgents.length > 0
    ? sourceAgents.map((agent) => `${agent.name} (${agent.role})`).join('、')
    : '无';
  return [
    '你是 InvestClaw 的 Agent 集群规划器。请根据用户给定的任务资料，拆解出一个可运行的多 Agent 集群。',
    '只返回 JSON，不要 Markdown，不要解释。',
    'JSON 字段：globalGoal, decompositionPlan, constraints, facts, openQuestions, agents, edges。',
    'agents 每项包含 name, role, description, responsibilities, systemPrompt, tools, capabilities。',
    'edges 每项包含 fromAgentName, toAgentName, relationType(depends_on/reviews/delegates_to/reports_to/collaborates_with), executionType(blocks/informs/reviews/reports_to/writes_to_memory), isBlocking, label, reason。',
    '只有 executionType=blocks 或 reviews 表示执行顺序依赖；informs/reports_to/writes_to_memory 只表示上下文传递或图谱展示。',
    sourceAgents.length > 0
      ? `检测到目录内已有 agents/*.md 权威 Agent 定义：${sourceAgentSummary}。agents 字段必须使用这些现成 Agent，不要新增、改名或重写 systemPrompt；systemPrompt 可留空，系统会使用 agents/*.md 原文。`
      : '如果没有现成 agents/*.md，请根据任务资料生成合理 Agent。',
    '目录内稳定工具入口如下；如果存在 agents/tools/*.py，规划时应把它们视为 Agent 执行入口，而不是要求 Agent 临时生成 run_agent_*.py 脚本：',
    sourceAgentToolSummary,
    '如果资料提到 Agent A/B/C/D 或 6-step pipeline，必须优先保留这些现成角色和流程；流水线类任务请用 blocks 表达 A 完成后再 B、B 完成后再 C 的顺序，不要泛化成全员互相协作。',
    '不要输出阻塞环路；如果存在反馈关系，优先用 informs 或 reports_to 表达非阻塞反馈。',
    '',
    '任务资料：',
    sourceContent,
  ].join('\n');
}

async function requestClusterPlanFromLlm(
  sourceContent: string,
  input: CreateAgentClusterInput,
  onStage?: (stageId: AgentClusterCreationStageId, status: AgentClusterCreationStageStatus, detail: string, error?: string) => void,
): Promise<LlmClusterPlan | null> {
  if (process.env.INVESTCLAW_E2E === '1' || process.env.VITEST === 'true') {
    return null;
  }

  const model = await resolvePlanningModel(input);
  const baseUrl = model.baseUrl.replace(/\/$/, '');
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutMs = LLM_PLANNING_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
        ...model.headers,
      },
      body: JSON.stringify({
        model: model.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: '你只输出严格 JSON。' },
          { role: 'user', content: buildPlanningPrompt(sourceContent) },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`基模调用超时：${Math.round(timeoutMs / 1000)} 秒内没有返回任务拆解结果`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`基模拆解任务失败 (${response.status})${text ? `: ${compactText(text, 240)}` : ''}`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('基模没有返回 Agent 集群规划内容');
  onStage?.('parse_plan', 'running', '基模已返回，正在解析 Agent 集群 JSON');
  try {
    const plan = extractJsonObject(content);
    onStage?.('parse_plan', 'completed', 'Agent 集群 JSON 解析完成');
    return plan;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onStage?.('parse_plan', 'error', message, message);
    throw new Error(`基模返回内容无法解析：${message}`, { cause: error });
  }
}

function buildManagerPrompt(cluster: AgentCluster, content: string): string {
  const latestRun = cluster.runs?.[0] ?? null;
  const runState = latestRun
    ? {
      runId: latestRun.runId,
      status: latestRun.status,
      childRuns: latestRun.childRuns.map((child) => ({
        agentId: child.agentId,
        agentName: cluster.agents.find((agent) => agent.agentId === child.agentId)?.name,
        status: child.status,
        completionSource: child.completionSource,
        error: child.error,
      })),
    }
    : null;

  return [
    '你是 InvestClaw Agent 集群的 LLM Cluster Manager。',
    '你的职责：理解用户自然语言改动，生成“待确认提案”。用户确认前，任何 prompt、Agent、边或运行状态都不会被正式修改。',
    '你不是底层调度器；blocks/reviews 的硬调度由系统 Run Manager 执行。不要伪造已完成状态。',
    '只返回 JSON，不要 Markdown，不要解释。',
    'JSON 字段：reply, targetAgentIds, targetAgentNames, promptPatches, agentDrafts, edgeDrafts, sharedContextUpdates, sharedContextSummary, recommendedResumeFromAgentId, recommendedResumeFromAgentName, runDecision。',
    'promptPatches 每项包含 targetAgentId 或 targetAgentName，以及 instruction。',
    'agentDrafts 用于用户要求新增 Agent；每项包含 name, role, description, responsibilities, systemPrompt, tools, capabilities。',
    'edgeDrafts 用于新增/修改协作关系；每项包含 fromAgentName/fromAgentId, toAgentName/toAgentId, relationType, executionType, isBlocking, label, reason。',
    '如果用户要求“加一个 Agent / 新增 Agent / 插入一个步骤”，请生成 agentDrafts 和必要 edgeDrafts，而不是只写一段全局说明。',
    '如果用户是在修正路径、参数、格式、评估规则、产物位置，请优先定向到最相关 Agent，而不是泛化为全局。',
    '如果集群来自目录模式且 Agent prompt 源自 agents/*.md，不要重写 Agent 的完整职责；应生成精简、定向的 prompt patch。',
    '如果项目内存在 agents/tools/*.py，prompt patch 应要求目标 Agent 优先调用 agents/tools/ 下的稳定入口；不要使用旧路径 agent_tools/，也不要要求临时生成 run_agent_*.py。',
    '如果用户修正产物保存路径，请在 prompt patch 中要求目标 Agent 汇报：旧输出位置、将写入的新位置、参考目录格式、以及是否需要迁移/重写已有产物。',
    '如果用户明确要求不要重跑上游、从某个阶段继续，请设置 recommendedResumeFromAgentId 或 recommendedResumeFromAgentName。',
    'sharedContextUpdates.decisions 只写短摘要，不要把用户长指令原文整段塞进去；详细要求放在对应 Agent 的 promptPatches。',
    '',
    '集群：',
    safeStringify({
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      projectName: cluster.projectName,
      projectRoot: cluster.projectRoot,
      sourceFolderPath: cluster.sourceFolderPath,
      globalGoal: cluster.sharedContext.globalGoal,
      agents: cluster.agents.map((agent) => ({
        agentId: agent.agentId,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        responsibilities: agent.responsibilities,
        status: agent.status,
        currentTask: agent.currentTask,
      })),
      edges: normalizeExecutionGraph(cluster).edges.map((edge) => ({
        fromAgentId: edge.fromAgentId,
        toAgentId: edge.toAgentId,
        executionType: edge.executionType,
        isBlocking: edge.isBlocking,
        reason: edge.reason,
      })),
      latestArtifacts: cluster.sharedContext.latestArtifacts ?? [],
      recentDecisions: (cluster.sharedContext.decisions ?? []).slice(-8),
      runState,
    }),
    '',
    '用户最新指令：',
    content,
  ].join('\n');
}

function buildFallbackManagerDecision(cluster: AgentCluster, content: string): LlmManagerDecision {
  const targetAgentIds = inferInstructionTargetAgentIds(content, cluster);
  const wantsAgentDraft = /新增|增加|加一个|加个|插入|new\s+agent|add\s+agent/i.test(content)
    && /agent|Agent|代理|智能体/.test(content);
  if (wantsAgentDraft) {
    const lastAgent = cluster.agents[cluster.agents.length - 1];
    return {
      reply: '我会先生成一个新增 Agent 的提案。你确认后，它才会加入图谱，并需要重新确认流水线。',
      agentDrafts: [{
        name: '新增 Agent',
        role: '自定义协作者',
        description: compactText(content, 160),
        responsibilities: [compactText(content, 120)],
        systemPrompt: `你是用户新增的 Agent。请按这条定义工作：${compactText(content, 500)}`,
        tools: [],
        capabilities: ['按用户定义执行'],
      }],
      edgeDrafts: lastAgent ? [{
        fromAgentId: lastAgent.agentId,
        toAgentName: '新增 Agent',
        relationType: 'collaborates_with',
        executionType: 'informs',
        isBlocking: false,
        label: '参考信息',
        reason: 'fallback 提案：用户要求新增 Agent，默认接在现有流程末尾作为非阻塞协作者。',
      }] : [],
      sharedContextSummary: compactText(content, 180),
      runDecision: '待用户确认后加入 Agent；如改变流水线，需要重新确认编排。',
    };
  }
  return {
    reply: targetAgentIds.length > 0
      ? `我会生成一个定向修改提案，目标是 ${targetAgentIds.map((agentId) => cluster.agents.find((agent) => agent.agentId === agentId)?.name ?? agentId).join('、')}。确认后才会写入 prompt patch。`
      : '我会生成一个全局修改提案。确认后才会写入后续运行上下文。',
    targetAgentIds,
    promptPatches: targetAgentIds.length > 0
      ? targetAgentIds.map((targetAgentId) => ({ targetAgentId, instruction: content }))
      : [{ targetAgentId: null, instruction: content }],
    sharedContextUpdates: {
      decisions: [compactText(content, 180)],
      summary: compactText(content, 180),
    },
    sharedContextSummary: compactText(content, 180),
    runDecision: targetAgentIds.length > 0 ? '规则 fallback：识别到目标 Agent。' : '规则 fallback：未识别到具体 Agent。',
  };
}

async function requestManagerDecisionFromLlm(
  cluster: AgentCluster,
  content: string,
  input: SendAgentClusterManagerMessageInput,
): Promise<LlmManagerDecision> {
  if (process.env.INVESTCLAW_E2E === '1' || process.env.VITEST === 'true') {
    return buildFallbackManagerDecision(cluster, content);
  }

  const model = await resolvePlanningModel({
    sourceType: 'new_task',
    taskGoal: content,
    baseModel: input.baseModel,
    baseProviderAccountId: input.baseProviderAccountId,
  });
  const baseUrl = model.baseUrl.replace(/\/$/, '');
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutMs = LLM_MANAGER_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
        ...model.headers,
      },
      body: JSON.stringify({
        model: model.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: '你是 Agent 集群 Manager，只输出严格 JSON。' },
          { role: 'user', content: buildManagerPrompt(cluster, content) },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Cluster Manager 基模调用超时：${Math.round(timeoutMs / 1000)} 秒内没有返回决策`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Cluster Manager 调用基模失败 (${response.status})${text ? `: ${compactText(text, 240)}` : ''}`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const decisionContent = data.choices?.[0]?.message?.content;
  if (!decisionContent) throw new Error('Cluster Manager 基模没有返回决策内容');
  return extractJsonObjectAs<LlmManagerDecision>(decisionContent);
}

function buildAgentsFromPlan(clusterId: string, plan: LlmClusterPlan, taskText: string): ClusterAgent[] {
  const plannedAgents = Array.isArray(plan.agents) ? plan.agents.filter((agent) => agent?.name) : [];
  if (plannedAgents.length === 0) {
    return agentBlueprints(taskText).map((blueprint, index) => buildAgent(clusterId, blueprint, index, taskText));
  }
  return plannedAgents.slice(0, 8).map((planned, index) => {
    const fallback = agentBlueprints(taskText)[Math.min(index, agentBlueprints(taskText).length - 1)];
    const blueprint = {
      name: planned.name?.trim() || fallback.name,
      role: planned.role?.trim() || fallback.role,
      description: planned.description?.trim() || fallback.description,
      responsibilities: coerceStringArray(planned.responsibilities, fallback.responsibilities),
      tools: coerceStringArray(planned.tools, fallback.tools),
      capabilities: coerceStringArray(planned.capabilities, fallback.capabilities),
    };
    const agent = buildAgent(clusterId, blueprint, index, taskText);
    if (planned.systemPrompt?.trim()) {
      agent.systemPrompt = planned.systemPrompt.trim();
      agent.localContext.systemPrompt = agent.systemPrompt;
    }
    return agent;
  });
}

function buildAgentsFromSourceDefinitions(
  clusterId: string,
  definitions: SourceAgentDefinition[],
  taskText: string,
): ClusterAgent[] {
  return definitions.map((definition, index) => {
    const blueprint = {
      name: definition.name,
      role: definition.role,
      description: definition.description,
      responsibilities: definition.responsibilities,
      tools: definition.tools,
      capabilities: definition.capabilities,
    };
    const agent = buildAgent(clusterId, blueprint, index, taskText);
    agent.systemPrompt = definition.systemPrompt;
    agent.localContext.systemPrompt = definition.systemPrompt;
    agent.localContext.assignedTasks = definition.responsibilities.map((item) => `${item}：按目录 agents/*.md 权威定义执行。`);
    agent.localContext.workingMemory = {
      focus: definition.description,
      source: 'agents/*.md',
      sourceDigest: compactText(definition.systemPrompt, 260),
    };
    return agent;
  });
}

function findAgentByPlanName(name: string | undefined, agents: ClusterAgent[]): ClusterAgent | null {
  if (!name) return null;
  const normalized = normalizeAgentNameForMatch(name);
  return agents.find((agent) => agent.name.toLowerCase() === name.toLowerCase())
    ?? agents.find((agent) => normalizeAgentNameForMatch(agent.name) === normalized)
    ?? agents.find((agent) => {
      const agentName = normalizeAgentNameForMatch(agent.name);
      return agentName.includes(normalized) || normalized.includes(agentName);
    })
    ?? null;
}

function buildEdgesFromPlan(plan: LlmClusterPlan, agents: ClusterAgent[]): AgentEdge[] {
  const plannedEdges = Array.isArray(plan.edges) ? plan.edges : [];
  const seen = new Set<string>();
  const edges = plannedEdges
    .map((edge) => {
      const from = findAgentByPlanName(edge.fromAgentName, agents);
      const to = findAgentByPlanName(edge.toAgentName, agents);
      if (!from || !to || from.agentId === to.agentId) return null;
      const key = `${from.agentId}:${to.agentId}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const relationType = normalizeRelationType(edge.relationType);
      const executionType = normalizeExecutionType({ relationType, executionType: edge.executionType });
      return {
        edgeId: randomUUID(),
        fromAgentId: from.agentId,
        toAgentId: to.agentId,
        relationType,
        executionType,
        isBlocking: edge.isBlocking ?? (executionType === 'blocks' || executionType === 'reviews'),
        label: edge.label?.trim() || (executionType === 'blocks' ? '阻塞依赖' : executionType === 'reviews' ? '审查门禁' : '协作'),
        reason: edge.reason?.trim() || undefined,
      } satisfies AgentEdge;
    })
    .filter((edge): edge is AgentEdge => Boolean(edge));
  return edges.length > 0 ? edges : createEdges(agents);
}

async function buildClusterFromSource(
  sourceType: AgentClusterSourceType,
  sourceContent: string,
  clusterName: string,
  input: CreateAgentClusterInput,
  onStage?: (stageId: AgentClusterCreationStageId, status: AgentClusterCreationStageStatus, detail: string, error?: string) => void,
): Promise<AgentCluster> {
  const now = new Date().toISOString();
  const clusterId = `cluster-${randomUUID()}`;
  onStage?.('prepare_context', 'running', '正在压缩资料并准备集群规划提示词');
  onStage?.('prepare_context', 'completed', `上下文准备完成，输入约 ${sourceContent.length} 字符`);
  onStage?.('call_model', 'running', '正在调用基模拆解任务并生成 Agent 规划');
  const sourceAgentDefinitions = extractSourceAgentDefinitions(sourceContent);
  let plan: LlmClusterPlan | null = null;
  let usedPlanningFallback = false;
  try {
    plan = await requestClusterPlanFromLlm(sourceContent, input, onStage);
    onStage?.('call_model', 'completed', plan ? '基模已返回 Agent 规划' : '测试环境使用确定性 Agent 规划');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const canUseDirectoryFallback = sourceAgentDefinitions.length > 0 && /超时|timeout|AbortError/i.test(message);
    if (!canUseDirectoryFallback) {
      throw error;
    }
    usedPlanningFallback = true;
    onStage?.(
      'call_model',
      'completed',
      `基模规划超时，已使用目录内 ${sourceAgentDefinitions.length} 个 agents/*.md 权威 Agent 定义继续创建`,
    );
    onStage?.('parse_plan', 'completed', '已跳过基模 JSON，使用本地默认调度图');
  }
  if (!plan) {
    onStage?.('parse_plan', 'completed', usedPlanningFallback ? '目录模式使用本地默认规划' : '测试环境跳过基模 JSON 解析');
  }
  onStage?.('build_agents', 'running', '正在生成 Agent、本地上下文和协作关系');
  const agents = sourceAgentDefinitions.length > 0
    ? buildAgentsFromSourceDefinitions(clusterId, sourceAgentDefinitions, sourceContent)
    : buildAgentsFromPlan(clusterId, plan ?? {}, sourceContent);
  const constraints = coerceStringArray(plan?.constraints, extractListCandidates(sourceContent, ['constraint', '约束', '必须', '不要', '不允许', 'requirement']));
  const facts = coerceStringArray(plan?.facts, extractListCandidates(sourceContent, ['fact', '事实', '数据', '背景', '目标', 'source']));
  const openQuestions = coerceStringArray(plan?.openQuestions, extractListCandidates(sourceContent, ['question', '问题', 'unknown', '待确认', '开放']));
  const decompositionPlan = plan?.decompositionPlan ?? agents
    .map((agent, index) => `${index + 1}. ${agent.name}：${agent.description}`)
    .join('\n');
  const edges = buildEdgesFromPlan(plan ?? {}, agents);
  onStage?.('build_agents', 'completed', `已生成 ${agents.length} 个 Agent`);
  const messages = [
    makeMessage(clusterId, {
      senderType: 'orchestrator',
      senderAgentId: agents[0]?.agentId ?? null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'summary',
      content: sourceAgentDefinitions.length > 0
        ? usedPlanningFallback
          ? `已读取目录 agents/*.md 并创建 ${agents.length} 个权威子 Agent；基模规划超时，本次使用本地默认调度图。`
          : `已读取目录 agents/*.md 并创建 ${agents.length} 个权威子 Agent；如目录提供 agents/tools/*.py，运行时会提示 Agent 优先调用稳定工具入口。基模只用于建议共享上下文与调度图。`
        : `已通过基模拆解任务并创建 ${agents.length} 个子 Agent。启动运行时，每个 Agent 会进入独立 OpenClaw 子会话。`,
      visibility: 'public',
    }, now),
    makeMessage(clusterId, {
      senderType: 'user',
      senderAgentId: null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'instruction',
      content: compactText(sourceContent, 1200),
      visibility: 'public',
    }, now),
  ];

  return {
    clusterId,
    clusterName,
    sourceType,
    sourceContent,
    ...summarizeSourceLocation(input),
    sharedContext: {
      globalGoal: compactText(plan?.globalGoal || sourceContent, 420),
      originalInput: sourceContent,
      decompositionPlan,
      constraints,
      facts,
      decisions: [
        '采用共享 ClusterContext + 子 Agent LocalContext 的隔离模型。',
        '运行阶段使用 subagent_swarm 独立子会话。',
        'Cluster Manager 负责解释用户改动，系统 Run Manager 负责可靠调度和解锁。',
        '目录模式下优先使用 agents/*.md 作为 Agent prompt，并优先调用 agents/tools/ 稳定工具入口。',
      ],
      managerInstructions: [],
      promptPatches: [],
      runDecisions: [],
      latestArtifacts: [],
      managerProposals: [],
      openQuestions,
      artifacts: [],
      agentSummaries: agents.map((agent) => ({
        agentId: agent.agentId,
        name: agent.name,
        summary: `${agent.name} 负责：${agent.responsibilities.join('、')}。`,
        updatedAt: now,
      })),
      finalSummary: '',
    },
    agents,
    edges,
    executionGraph: buildExecutionGraph(agents, edges, false, now),
    orchestrationConfirmedAt: null,
    messages,
    runs: [],
    activeRunId: null,
    runtimeSessionKey: null,
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

function nextClusterName(clusters: AgentCluster[]): string {
  const used = new Set(clusters.map((cluster) => cluster.clusterName));
  let index = clusters.length + 1;
  while (used.has(`集群${index}`)) {
    index += 1;
  }
  return `集群${index}`;
}

async function resolveSourceContent(input: CreateAgentClusterInput): Promise<string> {
  if (input.sourceType === 'new_task') {
    const goal = input.taskGoal?.trim() ?? '';
    if (!goal) throw new Error('请输入任务目标');
    return goal;
  }

  const markdown = input.markdown?.trim() ?? '';
  if (markdown) return markdown;

  const folderPath = input.folderPath?.trim() ?? '';
  if (folderPath) return readFolderSourceContent(folderPath);

  const filePath = input.filePath?.trim() ?? '';
  if (!filePath) throw new Error('请粘贴 Markdown 内容、提供文件路径或目录路径');
  if (!isAbsolute(filePath)) throw new Error('文件路径必须是绝对路径');

  const content = await readFile(filePath);
  if (content.byteLength > MAX_FILE_BYTES) {
    throw new Error('文件超过 1MB，请先精简任务内容');
  }
  return content.toString('utf8');
}

async function readOptionalTextFile(filePath: string, displayPath = filePath): Promise<string | null> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size > MAX_FOLDER_FILE_BYTES) return null;
    const content = await readFile(filePath, 'utf8');
    return `# Source: ${displayPath}\n\n${content.trim()}`;
  } catch {
    return null;
  }
}

function stripInlineComment(value: string): string {
  const hashIndex = value.indexOf('#');
  return (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim();
}

function parseDirectoryManifestPaths(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const allowedKeys = new Set(['agent_prompts', 'agent_tools', 'skills', 'context']);
  const paths: string[] = [];
  let activeKey: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const keyMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*$/);
    if (keyMatch) {
      activeKey = allowedKeys.has(keyMatch[1]) ? keyMatch[1] : null;
      continue;
    }
    if (!activeKey) continue;
    const itemMatch = trimmed.match(/^-\s+(.+)$/);
    if (!itemMatch) {
      if (!/^\s/.test(line)) activeKey = null;
      continue;
    }
    const path = stripInlineComment(itemMatch[1])
      .replace(/^['"]|['"]$/g, '')
      .trim();
    if (path) paths.push(path);
  }
  return paths;
}

async function collectManifestPaths(manifestFiles: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const manifestFile of manifestFiles) {
    try {
      const content = await readFile(manifestFile, 'utf8');
      paths.push(...parseDirectoryManifestPaths(content));
    } catch {
      // Optional manifest file.
    }
  }
  return Array.from(new Set(paths));
}

async function readFolderSourceContent(folderPath: string): Promise<string> {
  if (!isAbsolute(folderPath)) throw new Error('目录路径必须是绝对路径');
  const folderStat = await stat(folderPath);
  if (!folderStat.isDirectory()) throw new Error('目录路径必须指向一个文件夹');
  const folderRealPath = await realpath(folderPath).catch(() => folderPath);

  const parts: string[] = [];
  const seenFiles = new Set<string>();
  const addFile = async (filePath: string): Promise<void> => {
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size > MAX_FOLDER_FILE_BYTES) return;
      const resolved = await realpath(filePath).catch(() => filePath);
      const relativeToRoot = relative(folderRealPath, resolved);
      if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) return;
      const key = `${fileStat.dev}:${fileStat.ino}:${resolved.toLowerCase()}`;
      if (seenFiles.has(key)) return;
      seenFiles.add(key);
      const displayPath = relative(folderPath, filePath) || basename(filePath);
      const content = await readOptionalTextFile(filePath, displayPath);
      if (content) parts.push(content);
    } catch {
      // Optional file.
    }
  };

  parts.push(`# Source: PROJECT_ROOT\n\n${folderPath}`);
  const manifestFiles: string[] = [];
  for (const name of ['README.md', 'README.MD', 'HANDOFF.md', 'HANDOFF.MD']) {
    const filePath = join(folderPath, name);
    await addFile(filePath);
    try {
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) manifestFiles.push(filePath);
    } catch {
      // Optional file.
    }
  }

  const manifestPaths = await collectManifestPaths(manifestFiles);
  for (const manifestPath of manifestPaths) {
    if (manifestPath.includes('..') || isAbsolute(manifestPath)) continue;
    await addFile(join(folderPath, manifestPath));
  }

  if (manifestPaths.length === 0) {
    for (const dirName of ['agents', 'skills']) {
      const dirPath = join(folderPath, dirName);
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        for (const entry of entries.slice(0, 40)) {
          if (dirName === 'agents' && entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            await addFile(join(dirPath, entry.name));
          }
          if (dirName === 'skills' && entry.isDirectory()) {
            await addFile(join(dirPath, entry.name, 'SKILL.md'));
          }
        }
      } catch {
        // Optional metadata directory.
      }
    }

    try {
      const toolsDir = join(folderPath, 'agents', 'tools');
      const entries = await readdir(toolsDir, { withFileTypes: true });
      for (const entry of entries.slice(0, 40)) {
        if (entry.isFile() && /\.(?:py|md)$/i.test(entry.name)) {
          await addFile(join(toolsDir, entry.name));
        }
      }
    } catch {
      // Optional Agent tool directory.
    }
  }

  if (parts.length <= 1) {
    throw new Error('目录中没有找到 README.md、HANDOFF.md，或 manifest 声明的可读文件');
  }
  return parts.join('\n\n---\n\n');
}

function findMentionTarget(content: string, agents: ClusterAgent[]): string | null {
  const mention = content.match(/@([\p{L}\p{N}_\-\s]+?)(?:\s|$)/u)?.[1]?.trim();
  if (!mention) return null;
  const normalized = mention.toLowerCase();
  const matched = agents.find((agent) =>
    agent.name.toLowerCase() === normalized
    || agent.agentId.toLowerCase() === normalized
    || agent.name.toLowerCase().includes(normalized)
  );
  return matched?.agentId ?? null;
}

function looseKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function inferInstructionTargetAgentIds(content: string, cluster: AgentCluster): string[] {
  const normalizedContent = looseKey(content);
  const targets = cluster.agents.filter((agent, index) => {
    const aliases = [
      agent.agentId,
      agent.name,
      agent.role,
      `agent${String.fromCharCode(65 + index)}`,
      `agent${index + 1}`,
    ].map(looseKey).filter(Boolean);
    return aliases.some((alias) => normalizedContent.includes(alias));
  });
  const mentionTarget = findMentionTarget(content, cluster.agents);
  const ids = new Set(targets.map((agent) => agent.agentId));
  if (mentionTarget) ids.add(mentionTarget);
  return Array.from(ids);
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getTextFromRuntimePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return safeStringify(payload);
  const data = payload as Record<string, unknown>;
  const candidates = [
    data.text,
    data.content,
    data.message,
    data.error,
    (data.params as Record<string, unknown> | undefined)?.text,
    (data.params as Record<string, unknown> | undefined)?.content,
    (data.params as Record<string, unknown> | undefined)?.message,
    (data.params as Record<string, unknown> | undefined)?.error,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

function summarizeRuntimeEvent(payload: unknown): Omit<AgentClusterEvent, 'eventId' | 'clusterId' | 'createdAt' | 'runId' | 'agentId'> {
  const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const method = String(raw.method ?? raw.type ?? raw.event ?? '').toLowerCase();
  const params = raw.params && typeof raw.params === 'object' ? raw.params as Record<string, unknown> : raw;
  const state = String(params.state ?? params.status ?? params.phase ?? '').toLowerCase();
  const text = compactText(getTextFromRuntimePayload(payload), 420);

  if (/error|failed|fail/.test(method) || /error|failed|fail/.test(state)) {
    return { title: '子会话出错', content: text || 'OpenClaw 返回错误事件', level: 'error', raw: payload };
  }
  if (/started|submitted/.test(method) || /started|submitted/.test(state)) {
    return { title: '子会话已提交', content: text || 'OpenClaw Gateway 已接受子会话请求，正在等待运行事件', level: 'info', raw: payload };
  }
  if (/final|done|completed|finished|end/.test(method) || /final|done|completed|finished|end/.test(state)) {
    return { title: '子会话完成', content: text || 'Agent 子会话已完成', level: 'success', raw: payload };
  }
  if (/tool|command/.test(method)) {
    const toolName = String(params.name ?? params.toolName ?? params.tool ?? '工具');
    return { title: `工具执行：${toolName}`, content: text || 'Agent 正在调用工具', level: 'info', raw: payload };
  }
  if (/assistant|message|chat|delta/.test(method) && text) {
    return { title: 'Agent 输出', content: text, level: 'info', raw: payload };
  }
  return { title: '子会话活动', content: text || 'Agent 子会话正在运行', level: 'info', raw: payload };
}

function isRuntimeFinalEvent(payload: unknown): boolean {
  const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const method = String(raw.method ?? raw.type ?? raw.event ?? '').toLowerCase();
  const params = raw.params && typeof raw.params === 'object' ? raw.params as Record<string, unknown> : raw;
  const state = String(params.state ?? params.status ?? params.phase ?? '').toLowerCase();
  return /final|done|completed|finished|end/.test(method) || /final|done|completed|finished|end/.test(state);
}

function extractSessionKey(payload: unknown): string | null {
  const raw = safeStringify(payload);
  return raw.match(/agent:main:subagent:[A-Za-z0-9:_-]+/)?.[0] ?? null;
}

function buildAgentChildPrompt(cluster: AgentCluster, agent: ClusterAgent): string {
  const projectRoot = cluster.projectRoot?.trim() || cluster.sourceFolderPath?.trim() || null;
  const activeRun = (cluster.runs ?? []).find((run) => run.runId === cluster.activeRunId) ?? cluster.runs?.[0] ?? null;
  const activeChild = activeRun?.childRuns.find((child) => child.agentId === agent.agentId) ?? null;
  const runOutputRoot = activeRun?.outputRoot
    ?? activeChild?.outputRoot
    ?? null;
  const agentOutputRelativeDir = getAgentOutputRelativeDirForAgent(agent, activeChild ?? undefined);
  const agentOutputDir = runOutputRoot && projectRoot && agentOutputRelativeDir
    ? join(runOutputRoot, agentOutputRelativeDir)
    : null;
  const relativeRunOutputRoot = runOutputRoot && projectRoot ? relative(projectRoot, runOutputRoot) : null;
  const relativeAgentOutputDir = agentOutputDir && projectRoot ? relative(projectRoot, agentOutputDir) : null;
  const iteration = getChildIteration(activeChild ?? undefined);
  const roundGuidance = runOutputRoot && relativeRunOutputRoot && isFactorGeneratorAgent(agent)
    ? [
      '',
      `当前 round：${iteration}`,
      `- 这是 ${getRoundLabel(activeChild ?? undefined)} 的 Agent B 候选生成任务。`,
      iteration > 1
        ? `- 必须先读取上一轮 Agent D 反馈：${relativeRunOutputRoot}/agent_d/round_${iteration - 1}/agent_d_summary.json 和 ${relativeRunOutputRoot}/memory.md。`
        : '- 这是本集群输出目录的第一轮候选生成。若存在旧 direct/version 目录产物，只能作为历史参考，不能直接复用完成。',
      '- 必须重新生成新的 LLM 候选草稿，再调用稳定工具入口覆盖当前 round 的 llm_candidates.json。',
      `- 候选必须分批写入 ${relativeRunOutputRoot}/agent_b/round_${iteration}/candidate_parts/part_XX.json，每批 5-10 个；禁止一次性写超长 JSON/heredoc。`,
      `- 校验命令优先使用 --candidate-parts-dir ${relativeRunOutputRoot}/agent_b/round_${iteration}/candidate_parts --history-scorecard ${relativeRunOutputRoot}/scorecard.csv --min-accepted 40。`,
      '- 历史 round 已出现过的完全相同 DSL 会被硬拒绝，不计入 40 个有效候选；不要用 replica/clone/copy 或改名方式复用旧 DSL。',
      '- 禁止仅 cat / 验证旧 llm_candidates.json 后返回 [status:completed]；这种情况会被系统判定为未重新生成候选。',
    ].join('\n')
    : runOutputRoot && relativeRunOutputRoot && isMemoryAgent(agent)
      ? [
        '',
        `当前 round：${iteration}`,
        `- 只归档当前 round 的评估结果：${relativeRunOutputRoot}/agent_c/round_${iteration}/evaluation_results.json。`,
        `- 归档结果必须写入：${relativeRunOutputRoot}/agent_d/round_${iteration}/。`,
        `- 集群根级 scorecard.csv 是跨 round 聚合总表，必须包含 iteration/round 字段并保留历史 round。`,
      ].join('\n')
      : runOutputRoot && relativeRunOutputRoot && isEvaluationAgent(agent)
        ? [
          '',
          `当前 round：${iteration}`,
          `- 只评估当前 round 的候选：${relativeRunOutputRoot}/agent_b/round_${iteration}/llm_candidates.json。`,
          `- 评估结果必须写入：${relativeRunOutputRoot}/agent_c/round_${iteration}/。`,
        ].join('\n')
        : '';
  const downstreamIds = getBlockingDownstreamAgentIds(cluster, agent.agentId);
  const downstreamSummary = downstreamIds.length > 0
    ? downstreamIds.map((agentId) => cluster.agents.find((item) => item.agentId === agentId)?.name ?? agentId).join('、')
    : '无阻塞下游。';
  const promptPatches = (cluster.sharedContext.promptPatches ?? [])
    .filter((patch) => !patch.targetAgentId || patch.targetAgentId === agent.agentId)
    .slice(-6)
    .map((patch) => `- ${patch.instruction}`)
    .join('\n') || '无。';
  return [
    `[agent:${agent.agentId}]`,
    `你是 ${agent.name}，角色：${agent.role}。`,
    projectRoot
      ? [
        '',
        '项目根目录 / 工作区边界（强制）：',
        `- 只允许在这个项目目录内工作：${projectRoot}`,
        `- 所有 Python、Shell、文件读写都必须以该目录作为 cwd：${projectRoot}`,
        '- 如果项目提供 agents/tools/*.py，必须优先调用 agents/tools/ 下与你角色对应的稳定工具入口。',
        '- 不要临时生成 run_agent_*.py 这类一次性脚本，除非用户明确要求并说明原因。',
        '- 禁止把产物写入 ~/.openclaw/workspace 或其他临时目录。',
        runOutputRoot
          ? `- 本轮唯一实验输出目录：${runOutputRoot}`
          : '- 本轮没有分配实验输出目录时，不要自行创建日期目录；请返回 [status:blocked]。',
        relativeRunOutputRoot
          ? `- 相对项目根目录的本轮输出目录：${relativeRunOutputRoot}`
          : '',
        agentOutputDir
          ? `- 你的 Agent 专属输出目录：${agentOutputDir}`
          : '',
        relativeAgentOutputDir
          ? `- 你的 Agent 专属相对输出目录：${relativeAgentOutputDir}`
          : '',
        runOutputRoot
          ? `- 调用 Python 工具前设置环境变量：INVESTCLAW_RUN_OUTPUT_DIR="${runOutputRoot}"`
          : '',
        relativeAgentOutputDir
          ? `- 工具命令优先显式传入：--output-dir ${relativeAgentOutputDir}`
          : '',
        roundGuidance,
        '- 不要写入 experiment_results/YYYYMMDD；旧日期目录只作为历史，不参与本轮运行。',
        '- 如果当前运行环境无法进入项目目录、无法访问项目文件、或工具把 cwd 固定到其他目录，必须返回 [status:blocked] 并说明原因，不允许声称完成。',
        '- 完成汇报必须包含 [cwd:<实际工作目录>]、[command:<实际执行或验证的命令>]、[artifact:<本轮唯一输出目录内产物路径或 none>]。',
      ].join('\n')
      : '',
    agent.systemPrompt,
    '',
    '全局目标：',
    cluster.sharedContext.globalGoal,
    '',
    '共享上下文摘要：',
    compactText(JSON.stringify({
      constraints: cluster.sharedContext.constraints,
      facts: cluster.sharedContext.facts,
      decisions: cluster.sharedContext.decisions,
      openQuestions: cluster.sharedContext.openQuestions,
      decompositionPlan: cluster.sharedContext.decompositionPlan,
    }), 2600),
    '',
    '你的职责：',
    agent.responsibilities.map((item) => `- ${item}`).join('\n'),
    '',
    '阻塞上游产物：',
    buildDependencySummary(cluster, agent, activeRun),
    '',
    '非阻塞参考 / 反馈记忆：',
    buildReferenceContextSummary(cluster, agent),
    '',
    '阻塞下游：',
    downstreamSummary,
    '',
    'Cluster Manager 最新指令 / prompt patch：',
    promptPatches,
    '',
    '输出要求：先说明当前步骤，再给出可同步到 ClusterContext 的结论。不要泄露私有推理链。每条关键输出都带上 [agent:' + agent.agentId + '] 标记。',
    '',
    '完成协议（很重要）：当且仅当你的本阶段任务已经完成、下游可以继续时，请在输出末尾包含以下结构化标记：',
    '[status:completed]',
    downstreamIds.map((agentId) => `[unblock:${agentId}]`).join('\n') || '[unblock:none]',
    '[artifact:你产出的文件、数据集、报告或关键对象名称；没有则写 none]',
    '[summary]用 3-8 句概括可写入 ClusterContext 的结论[/summary]',
  ].join('\n');
}

function updateRootRunStatus(cluster: AgentCluster, run: AgentClusterRun, now: string): void {
  const childRuns = run.childRuns;
  run.submittedChildCount = childRuns.filter((child) => child.submitStatus === 'submitted' || child.runId).length;
  run.completedChildCount = childRuns.filter((child) => child.status === 'completed').length;
  run.failedChildCount = childRuns.filter((child) => child.status === 'error' || child.status === 'timeout').length;
  run.lastHeartbeatAt = now;
  if (childRuns.some((child) => child.status === 'error' || child.status === 'timeout')) {
    run.status = 'error';
    run.error = childRuns.find((child) => child.error)?.error ?? '子 Agent 运行失败';
    run.completedAt = now;
    cluster.activeRunId = null;
  } else if (childRuns.length > 0 && childRuns.every((child) => child.status === 'completed' || child.status === 'aborted')) {
    run.status = childRuns.every((child) => child.status === 'completed') ? 'completed' : 'aborted';
    run.completedAt = now;
    cluster.activeRunId = null;
    for (const agent of cluster.agents) {
      if (agent.status === 'running' || agent.status === 'waiting') {
        agent.status = 'done';
        agent.localContext.status = 'done';
        agent.currentTask = '子会话已完成';
      }
    }
  } else if (new Date(run.timeoutAt ?? 0).getTime() < Date.now()) {
    if (hasDispatchablePendingChild(cluster, run)) {
      run.status = 'running';
      run.error = undefined;
      run.completedAt = undefined;
      run.timeoutAt = new Date(Date.now() + RUN_TIMEOUT_MS).toISOString();
      cluster.activeRunId = run.runId;
    } else {
      run.status = 'timeout';
      run.error = '运行超时';
      run.completedAt = now;
      cluster.activeRunId = null;
    }
  } else {
    run.status = 'running';
  }
  run.updatedAt = now;
}

function addClusterEvent(
  cluster: AgentCluster,
  input: Omit<AgentClusterEvent, 'eventId' | 'clusterId' | 'createdAt'> & { createdAt?: string },
): AgentClusterEvent {
  const event: AgentClusterEvent = {
    eventId: randomUUID(),
    clusterId: cluster.clusterId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...input,
  };
  cluster.events = [event, ...(cluster.events ?? [])].slice(0, 500);
  return event;
}

function findRun(cluster: AgentCluster, runId: string): AgentClusterRun {
  const run = (cluster.runs ?? []).find((item) => item.runId === runId);
  if (!run) throw new Error('Agent Cluster run not found');
  return run;
}

function hasDispatchablePendingChild(cluster: AgentCluster, run: AgentClusterRun): boolean {
  return run.childRuns.some((child) => {
    if (child.status === 'completed' || child.status === 'error' || child.status === 'timeout' || child.status === 'aborted') return false;
    if (child.submitStatus === 'submitted' && child.runId) return false;
    const upstreamIds = getBlockingUpstreamAgentIds(cluster, child.agentId);
    return upstreamIds.every((agentId) => {
      const upstreamChild = run.childRuns.find((item) => item.agentId === agentId);
      return upstreamChild?.status === 'completed';
    });
  });
}

function getBlockingUpstreamAgentIds(cluster: AgentCluster, agentId: string): string[] {
  const graph = normalizeExecutionGraph(cluster);
  return graph.edges
    .filter((edge) => edge.toAgentId === agentId && isBlockingExecutionEdge(edge))
    .map((edge) => edge.fromAgentId);
}

function getBlockingDownstreamAgentIds(cluster: AgentCluster, agentId: string): string[] {
  const graph = normalizeExecutionGraph(cluster);
  return graph.edges
    .filter((edge) => edge.fromAgentId === agentId && isBlockingExecutionEdge(edge))
    .map((edge) => edge.toAgentId);
}

function getBlockingDownstreamClosure(cluster: AgentCluster, agentId: string): string[] {
  const result = new Set<string>();
  const visit = (currentAgentId: string) => {
    for (const nextAgentId of getBlockingDownstreamAgentIds(cluster, currentAgentId)) {
      if (result.has(nextAgentId)) continue;
      result.add(nextAgentId);
      visit(nextAgentId);
    }
  };
  visit(agentId);
  return Array.from(result);
}

function getBlockingPathAgentIds(cluster: AgentCluster, startAgentId: string, endAgentId: string): string[] {
  if (startAgentId === endAgentId) return [startAgentId];
  const graph = normalizeExecutionGraph(cluster);
  const adjacency = new Map<string, string[]>();
  for (const agent of cluster.agents) adjacency.set(agent.agentId, []);
  for (const edge of graph.edges) {
    if (!isBlockingExecutionEdge(edge)) continue;
    adjacency.get(edge.fromAgentId)?.push(edge.toAgentId);
  }
  const queue: string[][] = [[startAgentId]];
  const seen = new Set<string>([startAgentId]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === endAgentId) return nextPath;
      seen.add(next);
      queue.push(nextPath);
    }
  }
  return [];
}

function getLoopState(run: AgentClusterRun, loop: AgentClusterExecutionLoop, now: string): AgentClusterRunLoopState {
  run.loopStates = Array.isArray(run.loopStates) ? run.loopStates : [];
  let state = run.loopStates.find((item) => item.loopId === loop.loopId);
  if (!state) {
    state = {
      loopId: loop.loopId,
      currentIteration: 1,
      repeatCount: loop.repeatCount,
      status: 'idle',
      updatedAt: now,
    };
    run.loopStates.push(state);
  }
  state.repeatCount = loop.repeatCount;
  return state;
}

function buildAgentChildSessionKey(cluster: AgentCluster, runId: string, agentId: string, attemptAt: string): string {
  const shortClusterId = cluster.clusterId.replace(/^cluster-/, '').slice(0, 10);
  const shortRunId = runId.replace(/^run-/, '').slice(0, 8);
  const attemptKey = String(new Date(attemptAt).getTime()).slice(-8);
  return `agent:main:subagent:cluster-${shortClusterId}-${shortRunId}-${agentId.slice(0, 12)}-${attemptKey}`;
}

function resetChildForRerun(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent | undefined,
  status: AgentClusterRunStatus,
  now: string,
  iteration?: number,
): void {
  child.sessionKey = buildAgentChildSessionKey(cluster, run.runId, child.agentId, now);
  child.status = status;
  child.submitStatus = 'pending';
  child.runId = '';
  child.error = undefined;
  child.completedAt = undefined;
  child.completionSignal = undefined;
  child.completionSource = undefined;
  child.unblockedAgentIds = [];
  child.artifacts = [];
  child.expectedArtifacts = agent ? expectedArtifactNamesForAgent(agent) : [];
  child.artifactValidationStatus = child.expectedArtifacts.length > 0 ? 'pending' : undefined;
  child.artifactValidationError = undefined;
  const candidateTarget = agent ? inferCandidateTarget(cluster, agent) : null;
  child.targetCandidateCount = candidateTarget?.target;
  child.minAcceptedCandidateCount = candidateTarget?.minimum;
  child.actualCandidateCount = undefined;
  child.outputRoot = run.outputRoot ?? child.outputRoot;
  child.lastEventAt = undefined;
  child.lastTranscriptMessageId = undefined;
  child.iteration = iteration;
  child.startedAt = now;
  child.updatedAt = now;
  if (agent) {
    agent.status = status === 'starting' ? 'running' : 'waiting';
    agent.localContext.status = agent.status;
    agent.currentTask = status === 'starting' ? '等待 DAG 调度器提交子会话' : '等待上游重新完成';
    agent.runtimeStatusReason = status === 'starting' ? '循环重跑' : 'DAG 阻塞';
    agent.runtimeSessionKey = child.sessionKey;
    agent.runtimeRunId = child.runId;
    agent.lastActivityAt = now;
  }
}

function maybeAdvanceExecutionLoops(
  cluster: AgentCluster,
  run: AgentClusterRun,
  completedAgentId: string,
  now: string,
): void {
  const graph = normalizeExecutionGraph(cluster);
  for (const loop of graph.loops ?? []) {
    if (loop.endAgentId !== completedAgentId || loop.repeatCount <= 1) continue;
    const path = getBlockingPathAgentIds(cluster, loop.startAgentId, loop.endAgentId);
    if (path.length === 0) continue;
    const pathChildren = path
      .map((agentId) => run.childRuns.find((child) => child.agentId === agentId))
      .filter((child): child is AgentClusterChildRun => Boolean(child));
    if (pathChildren.length !== path.length || !pathChildren.every((child) => child.status === 'completed')) continue;

    const state = getLoopState(run, loop, now);
    if (state.currentIteration >= loop.repeatCount) {
      state.status = 'completed';
      state.updatedAt = now;
      continue;
    }

    const nextIteration = state.currentIteration + 1;
    state.currentIteration = nextIteration;
    state.status = 'running';
    state.updatedAt = now;

    path.forEach((agentId, index) => {
      const child = run.childRuns.find((item) => item.agentId === agentId);
      const agent = cluster.agents.find((item) => item.agentId === agentId);
      if (!child) return;
      const outputRound = getOutputRoundForLoopIteration(run, nextIteration);
      resetChildForRerun(cluster, run, child, agent, index === 0 ? 'starting' : 'blocked', now, outputRound);
      if (agent) {
        agent.currentTask = index === 0
          ? `循环第 ${nextIteration}/${loop.repeatCount} 轮，从该节点继续（round ${outputRound}）`
          : `等待循环第 ${nextIteration}/${loop.repeatCount} 轮上游完成（round ${outputRound}）`;
      }
    });

    addClusterEvent(cluster, {
      runId: run.runId,
      agentId: loop.startAgentId,
      title: '进入下一轮循环',
      content: `循环链路 ${path.map((agentId) => cluster.agents.find((agent) => agent.agentId === agentId)?.name ?? agentId).join(' → ')} 进入第 ${nextIteration}/${loop.repeatCount} 轮，写入集群目录 round_${getOutputRoundForLoopIteration(run, nextIteration)}。`,
      level: 'info',
      createdAt: now,
    });
  }
}

function buildDependencySummary(cluster: AgentCluster, agent: ClusterAgent, run?: AgentClusterRun | null): string {
  const upstreamIds = getBlockingUpstreamAgentIds(cluster, agent.agentId);
  if (upstreamIds.length === 0) return '无阻塞上游，可以作为当前阶段入口执行。';
  return upstreamIds
    .map((agentId) => {
      const upstream = cluster.agents.find((item) => item.agentId === agentId);
      const outputs = upstream?.localContext.outputs.slice(-2).map((output) => output.content).join('\n') ?? '';
      const runArtifacts = (run?.childRuns.find((child) => child.agentId === agentId)?.artifacts ?? [])
        .slice(-4)
        .join('、');
      const sharedArtifacts = (cluster.sharedContext.latestArtifacts ?? [])
        .filter((artifact) => artifact.agentId === agentId)
        .slice(-4)
        .map((artifact) => artifact.artifact)
        .join('、');
      const artifacts = runArtifacts || sharedArtifacts;
      const details = [
        outputs ? compactText(outputs, 600) : '上游已完成，请基于其职责产物继续。',
        artifacts ? `本轮上游产物：${artifacts}` : '',
      ].filter(Boolean).join('\n');
      return `- ${upstream?.name ?? agentId}：${details}`;
    })
    .join('\n');
}

function buildReferenceContextSummary(cluster: AgentCluster, agent: ClusterAgent): string {
  const graph = normalizeExecutionGraph(cluster);
  const referenceIds = graph.edges
    .filter((edge) => edge.toAgentId === agent.agentId && !isBlockingExecutionEdge(edge))
    .map((edge) => edge.fromAgentId);
  const uniqueIds = Array.from(new Set(referenceIds));
  if (uniqueIds.length === 0) return '无。';
  return uniqueIds
    .map((agentId) => {
      const upstream = cluster.agents.find((item) => item.agentId === agentId);
      const agentSummary = cluster.sharedContext.agentSummaries?.find((summary) => summary.agentId === agentId)?.summary;
      const outputs = upstream?.localContext.outputs.slice(-2).map((output) => output.content).join('\n') ?? '';
      const artifacts = (cluster.sharedContext.latestArtifacts ?? [])
        .filter((artifact) => artifact.agentId === agentId)
        .slice(-3)
        .map((artifact) => artifact.artifact)
        .join('、');
      const details = [agentSummary, outputs, artifacts ? `相关产物：${artifacts}` : '']
        .filter(Boolean)
        .join('\n');
      return `- ${upstream?.name ?? agentId}：${details ? compactText(details, 800) : '非阻塞参考信息，可用于下一轮优化，但不要等待它完成。'}`;
    })
    .join('\n');
}

async function getNextClusterOutputRound(outputRoot?: string): Promise<number> {
  if (!outputRoot) return 1;
  const agentDirs = ['agent_b', 'agent_c', 'agent_d'];
  let maxRound = 0;
  for (const agentDir of agentDirs) {
    const entries = await readdir(join(outputRoot, agentDir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^round_(\d+)$/i);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > maxRound) maxRound = value;
    }
  }
  return maxRound + 1;
}

function formatVersionDate(nowIso: string): string {
  const date = new Date(nowIso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

async function getNextExperimentVersionIndex(experimentRoot: string): Promise<number> {
  const entries = await readdir(experimentRoot, { withFileTypes: true }).catch(() => []);
  let maxVersion = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^version_(\d+)_\d{8}$/i);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > maxVersion) maxVersion = value;
  }
  return maxVersion + 1;
}

async function allocateClusterExperimentOutput(projectRoot: string | null, _clusterId: string, nowIso: string): Promise<{
  outputVersion?: string;
  outputRoot?: string;
  outputCreatedAt?: string;
  roundStart: number;
}> {
  if (!projectRoot) return { roundStart: 1 };
  const experimentRoot = join(projectRoot, 'experiment_results');
  await mkdir(experimentRoot, { recursive: true });
  const versionIndex = await getNextExperimentVersionIndex(experimentRoot);
  const outputVersion = `version_${versionIndex}_${formatVersionDate(nowIso)}`;
  const outputRoot = join(experimentRoot, outputVersion);
  await mkdir(outputRoot, { recursive: true });
  return {
    outputVersion,
    outputRoot,
    outputCreatedAt: nowIso,
    roundStart: 1,
  };
}

export function inferAgentKind(agent: Pick<ClusterAgent, 'agentId' | 'name' | 'role'>): AgentClusterInferredKind {
  const text = looseKey(`${agent.agentId} ${agent.name} ${agent.role}`);
  if (text.includes('agentc') || text.includes('evaluation') || text.includes('evaluator') || text.includes('auditor') || text.includes('评估') || text.includes('审计')) {
    return 'evaluation';
  }
  if (text.includes('agentd') || text.includes('memory') || text.includes('librarian') || text.includes('记忆') || text.includes('归档') || text.includes('研究馆员')) {
    return 'memory';
  }
  if (text.includes('agentb') || text.includes('factorgenerator') || text.includes('generator') || text.includes('因子生成')) {
    return 'factor';
  }
  if (text.includes('agenta') || text.includes('datasteward') || text.includes('data') || text.includes('数据')) {
    return 'data';
  }
  return 'other';
}

function getAgentOutputDirName(agent: ClusterAgent): string | null {
  switch (inferAgentKind(agent)) {
    case 'data':
      return 'agent_a';
    case 'factor':
      return 'agent_b';
    case 'evaluation':
      return 'agent_c';
    case 'memory':
      return 'agent_d';
    case 'other':
      return null;
  }
}

function usesRoundOutputDir(agentDir: string): boolean {
  return agentDir === 'agent_b' || agentDir === 'agent_c' || agentDir === 'agent_d';
}

function getChildIteration(child?: AgentClusterChildRun): number {
  const value = Number(child?.iteration);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function getAgentOutputRelativeDir(agentDir: string, child?: AgentClusterChildRun): string {
  return usesRoundOutputDir(agentDir)
    ? `${agentDir}/round_${getChildIteration(child)}`
    : agentDir;
}

function getAgentOutputRelativeDirForAgent(agent: ClusterAgent, child?: AgentClusterChildRun): string | null {
  const agentDir = getAgentOutputDirName(agent);
  return agentDir ? getAgentOutputRelativeDir(agentDir, child) : null;
}

function getRoundLabel(child?: AgentClusterChildRun): string {
  return `round_${getChildIteration(child)}`;
}

function getRunRoundStart(run: AgentClusterRun): number {
  const value = Number(run.roundStart);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function getOutputRoundForLoopIteration(run: AgentClusterRun, loopIteration: number): number {
  return getRunRoundStart(run) + Math.max(1, Math.floor(loopIteration || 1)) - 1;
}

function getClusterProjectRoot(cluster: AgentCluster): string | null {
  return cluster.projectRoot?.trim() || cluster.sourceFolderPath?.trim() || null;
}

function isFactorGeneratorAgent(agent: ClusterAgent): boolean {
  return inferAgentKind(agent) === 'factor';
}

function isEvaluationAgent(agent: ClusterAgent): boolean {
  return inferAgentKind(agent) === 'evaluation';
}

function isMemoryAgent(agent: ClusterAgent): boolean {
  return inferAgentKind(agent) === 'memory';
}

function parseCandidateTargetFromText(text: string): number | null {
  const matches = [
    ...text.matchAll(/target[_\s-]*candidates?\s*[:=]\s*(\d{1,4})/gi),
    ...text.matchAll(/(?:生成|交付|产出|候选|candidates?)[^\d]{0,24}(\d{1,4})\s*(?:个|条)?/gi),
    ...text.matchAll(/(\d{1,4})\s*(?:个|条)?\s*(?:LLM\s*)?(?:候选|因子|candidates?)/gi),
  ].map((match) => Number(match[1])).filter((value) => Number.isFinite(value) && value > 0 && value <= 1000);
  return matches.length > 0 ? Math.max(...matches) : null;
}

function inferCandidateTarget(cluster: AgentCluster, agent: ClusterAgent): { target: number; minimum: number; explicit: boolean } | null {
  if (!isFactorGeneratorAgent(agent)) return null;
  const relevantPatches = (cluster.sharedContext.promptPatches ?? [])
    .filter((patch) => !patch.targetAgentId || patch.targetAgentId === agent.agentId)
    .map((patch) => patch.instruction);
  const texts = [
    ...relevantPatches,
    ...(cluster.sharedContext.decisions ?? []),
    ...(cluster.sharedContext.managerInstructions ?? []),
  ];
  const explicitTargets = texts
    .map(parseCandidateTargetFromText)
    .filter((value): value is number => value !== null);
  if (explicitTargets.length > 0) {
    const target = Math.max(...explicitTargets);
    return { target, minimum: target, explicit: true };
  }
  return null;
}

function expectedArtifactNamesForAgent(agent: ClusterAgent): string[] {
  switch (inferAgentKind(agent)) {
    case 'factor':
      return ['llm_candidates.json', 'agent_b_summary.json'];
    case 'evaluation':
      return ['scorecard.csv', 'evaluation_results.json'];
    case 'memory':
      return ['scorecard.csv', 'agent_d_summary.json'];
    case 'data':
    case 'other':
      return [];
  }
}

function splitArtifactTokens(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/[,，]/))
    .map((value) => value.trim())
    .filter((value) => value && value.toLowerCase() !== 'none');
}

function resolveProjectArtifactPath(projectRoot: string, value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned || cleaned.includes('*')) return null;
  const candidate = isAbsolute(cleaned) ? cleaned : join(projectRoot, cleaned);
  const relativePath = relative(projectRoot, candidate);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return candidate;
}

function requireRunOutputRoot(run: AgentClusterRun): string {
  const outputRoot = run.outputRoot?.trim();
  if (!outputRoot) {
    throw new Error('本轮运行没有 outputRoot，无法校验集群产物');
  }
  return outputRoot;
}

async function requireCurrentOutputFile(run: AgentClusterRun, child: AgentClusterChildRun, agentDir: string, fileName: string): Promise<string> {
  const outputRoot = requireRunOutputRoot(run);
  const filePath = join(outputRoot, getAgentOutputRelativeDir(agentDir, child), fileName);
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new Error(`本轮输出目录未交付 ${getAgentOutputRelativeDir(agentDir, child)}/${fileName}：${filePath}`);
  }
  return filePath;
}

function findReportedArtifactOutsideRun(
  completion: NonNullable<ReturnType<typeof parseCompletionSignal>>,
  projectRoot: string,
  outputRoot: string,
  fileName: string,
): string | null {
  const reported = splitArtifactTokens(completion.artifacts)
    .filter((artifact) => artifact.endsWith(fileName))
    .map((artifact) => resolveProjectArtifactPath(projectRoot, artifact))
    .filter((path): path is string => Boolean(path));
  return reported.find((path) => {
    const relativeToOutput = relative(outputRoot, path);
    return relativeToOutput.startsWith('..') || isAbsolute(relativeToOutput);
  }) ?? null;
}

function findRunArtifact(
  completion: NonNullable<ReturnType<typeof parseCompletionSignal>>,
  projectRoot: string,
  outputRoot: string,
  fileName: string,
): string | null {
  const reported = splitArtifactTokens(completion.artifacts)
    .filter((artifact) => artifact.endsWith(fileName))
    .map((artifact) => resolveProjectArtifactPath(projectRoot, artifact))
    .filter((path): path is string => Boolean(path))
    .find((path) => {
      const relativeToOutput = relative(outputRoot, path);
      return !relativeToOutput.startsWith('..') && !isAbsolute(relativeToOutput);
    });
  return reported ?? null;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function assertFileFresh(path: string, child: AgentClusterChildRun, label: string): Promise<void> {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) throw new Error(`${label} 不存在：${path}`);
  const startMs = new Date(child.startedAt).getTime();
  if (Number.isFinite(startMs) && fileStat.mtimeMs + 1000 < startMs) {
    throw new Error(`${label} 是上一轮旧产物，未在本轮更新：${path}`);
  }
}

async function validateFactorGeneratorArtifacts(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  completion: NonNullable<ReturnType<typeof parseCompletionSignal>>,
  projectRoot: string,
): Promise<string[]> {
  const outputRoot = requireRunOutputRoot(run);
  const reportedOldPath = findReportedArtifactOutsideRun(completion, projectRoot, outputRoot, 'llm_candidates.json');
  if (reportedOldPath) {
    addClusterEvent(cluster, {
      runId: run.runId,
      agentId: child.agentId,
      title: '报告路径不一致',
      content: `Agent 报告了非本轮产物路径，已忽略并改用当前集群输出目录校验：${reportedOldPath}`,
      level: 'warning',
      createdAt: new Date().toISOString(),
    });
  }
  const candidatePath = await requireCurrentOutputFile(run, child, 'agent_b', 'llm_candidates.json');
  const reportedRunPath = findRunArtifact(completion, projectRoot, outputRoot, 'llm_candidates.json');
  if (reportedRunPath && reportedRunPath !== candidatePath) {
    throw new Error(`Agent B 报告的候选路径不是当前 ${getRoundLabel(child)} 产物：${reportedRunPath}`);
  }
  if (!candidatePath) throw new Error('Agent B 未交付 llm_candidates.json');
  await assertFileFresh(candidatePath, child, 'llm_candidates.json');

  let candidates: unknown;
  try {
    candidates = await readJsonFile(candidatePath);
  } catch (error) {
    throw new Error(`llm_candidates.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!Array.isArray(candidates)) throw new Error('llm_candidates.json 必须是 JSON 数组');
  child.actualCandidateCount = candidates.length;

  const invalidSourceCount = candidates.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object') return true;
    const source = String((candidate as Record<string, unknown>).source ?? '').toLowerCase();
    return source !== 'llm';
  }).length;
  if (invalidSourceCount > 0) {
    throw new Error(`llm_candidates.json 中有 ${invalidSourceCount} 个候选不是 source=llm`);
  }

  const childAgent = cluster.agents.find((agent) => agent.agentId === child.agentId);
  const explicitTarget = childAgent ? inferCandidateTarget(cluster, childAgent) : null;
  const target = explicitTarget?.target;
  const minimum = explicitTarget?.minimum ?? 1;
  child.targetCandidateCount = target;
  child.minAcceptedCandidateCount = explicitTarget?.minimum;
  if (candidates.length < minimum) {
    throw new Error(target
      ? `Agent B 候选数量未达标：${candidates.length}/${target}，下游保持阻塞`
      : 'Agent B 没有交付可用候选因子，下游保持阻塞');
  }

  const summaryPath = await requireCurrentOutputFile(run, child, 'agent_b', 'agent_b_summary.json');
  await assertFileFresh(summaryPath, child, 'agent_b_summary.json');
  const summary = await readJsonFile(summaryPath) as Record<string, unknown>;
  const accepted = Number(summary.accepted ?? summary.input_candidates ?? candidates.length);
  if (!Number.isFinite(accepted) || accepted < minimum) {
    throw new Error(target
      ? `Agent B 预校验通过数量未达标：${Number.isFinite(accepted) ? accepted : '未知'}/${target}`
      : 'Agent B 预校验没有通过任何候选因子');
  }

  return [relative(projectRoot, candidatePath), relative(projectRoot, summaryPath)];
}

async function validateEvaluationArtifacts(run: AgentClusterRun, child: AgentClusterChildRun, projectRoot: string): Promise<string[]> {
  const scorecardPath = await requireCurrentOutputFile(run, child, 'agent_c', 'scorecard.csv');
  const evaluationPath = await requireCurrentOutputFile(run, child, 'agent_c', 'evaluation_results.json');
  await assertFileFresh(scorecardPath, child, 'Agent C scorecard.csv');
  await assertFileFresh(evaluationPath, child, 'Agent C evaluation_results.json');
  return [relative(projectRoot, scorecardPath), relative(projectRoot, evaluationPath)];
}

async function validateMemoryArtifacts(run: AgentClusterRun, child: AgentClusterChildRun, projectRoot: string): Promise<string[]> {
  const outputRoot = requireRunOutputRoot(run);
  const rootScorecard = join(outputRoot, 'scorecard.csv');
  const agentDScorecard = await requireCurrentOutputFile(run, child, 'agent_d', 'scorecard.csv');
  const summaryPath = await requireCurrentOutputFile(run, child, 'agent_d', 'agent_d_summary.json');
  const rootScorecardStat = await stat(rootScorecard).catch(() => null);
  if (!rootScorecardStat?.isFile()) throw new Error(`Agent D scorecard.csv 不存在：${rootScorecard}`);
  await assertFileFresh(agentDScorecard, child, 'Agent D round scorecard.csv');
  await assertFileFresh(summaryPath, child, 'Agent D agent_d_summary.json');
  return [relative(projectRoot, rootScorecard), relative(projectRoot, agentDScorecard), relative(projectRoot, summaryPath)];
}

async function validateAgentCompletionArtifacts(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  completion: NonNullable<ReturnType<typeof parseCompletionSignal>>,
  now: string,
): Promise<string[]> {
  if (completion.source === 'manual') {
    child.artifactValidationStatus = 'skipped';
    return completion.artifacts;
  }
  const projectRoot = getClusterProjectRoot(cluster);
  const expectedArtifacts = expectedArtifactNamesForAgent(agent);
  child.expectedArtifacts = expectedArtifacts;
  if (!projectRoot || expectedArtifacts.length === 0) {
    child.artifactValidationStatus = 'skipped';
    return splitArtifactTokens(completion.artifacts);
  }
  try {
    const artifacts = isFactorGeneratorAgent(agent)
      ? await validateFactorGeneratorArtifacts(cluster, run, child, completion, projectRoot)
      : isMemoryAgent(agent)
        ? await validateMemoryArtifacts(run, child, projectRoot)
        : isEvaluationAgent(agent)
          ? await validateEvaluationArtifacts(run, child, projectRoot)
          : splitArtifactTokens(completion.artifacts);
    child.artifactValidationStatus = 'passed';
    child.artifactValidationError = undefined;
    return artifacts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    child.status = 'error';
    child.submitStatus = 'failed';
    child.completionSignal = completion.signal;
    child.completionSource = undefined;
    child.unblockedAgentIds = [];
    child.artifacts = [];
    child.artifactValidationStatus = 'failed';
    child.artifactValidationError = message;
    child.error = message;
    child.completedAt = undefined;
    child.updatedAt = now;
    child.lastEventAt = now;
    agent.status = 'error';
    agent.localContext.status = 'error';
    agent.currentTask = message;
    agent.runtimeStatusReason = '产物校验失败';
    agent.lastActivityAt = now;
    addClusterEvent(cluster, {
      runId: run.runId,
      agentId: agent.agentId,
      title: '产物校验失败',
      content: message,
      level: 'error',
      createdAt: now,
    });
    throw error;
  }
}

async function hasExpectedArtifactsForRecovery(run: AgentClusterRun, child: AgentClusterChildRun, agent: ClusterAgent): Promise<boolean> {
  const outputRoot = run.outputRoot?.trim();
  if (!outputRoot) return false;
  const agentDir = getAgentOutputDirName(agent);
  if (!agentDir) return false;
  const relativeDir = getAgentOutputRelativeDir(agentDir, child);
  const expectedFiles = expectedArtifactNamesForAgent(agent).map((fileName) => join(outputRoot, relativeDir, fileName));
  if (isMemoryAgent(agent)) {
    expectedFiles.push(join(outputRoot, 'scorecard.csv'));
  }
  if (expectedFiles.length === 0) return false;
  const stats = await Promise.all(expectedFiles.map((filePath) => stat(filePath).catch(() => null)));
  return stats.every((fileStat) => fileStat?.isFile());
}

async function getCanonicalArtifactPathsForAgent(
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
): Promise<string[]> {
  const outputRoot = run.outputRoot?.trim();
  if (!outputRoot) return [];
  const agentDir = getAgentOutputDirName(agent);
  const expectedArtifacts = expectedArtifactNamesForAgent(agent);
  if (!agentDir || expectedArtifacts.length === 0) return [];
  const relativeDir = getAgentOutputRelativeDir(agentDir, child);
  const paths = expectedArtifacts.map((fileName) => join(outputRoot, relativeDir, fileName));
  if (isMemoryAgent(agent)) paths.push(join(outputRoot, 'scorecard.csv'));
  const stats = await Promise.all(paths.map((filePath) => stat(filePath).catch(() => null)));
  if (!stats.every((fileStat) => fileStat?.isFile())) return [];
  return paths;
}

async function reconcileRunArtifacts(cluster: AgentCluster, run: AgentClusterRun, now: string): Promise<boolean> {
  const projectRoot = getClusterProjectRoot(cluster);
  if (!projectRoot) return false;
  let changed = false;

  for (const child of run.childRuns) {
    const agent = cluster.agents.find((item) => item.agentId === child.agentId);
    if (!agent) continue;
    const expectedArtifacts = expectedArtifactNamesForAgent(agent);
    if (expectedArtifacts.length === 0) continue;
    child.expectedArtifacts = expectedArtifacts;
    const canonicalPaths = await getCanonicalArtifactPathsForAgent(run, child, agent);
    const canonicalArtifacts = canonicalPaths.map((filePath) => relative(projectRoot, filePath));

    if (canonicalArtifacts.length > 0) {
      if (child.status !== 'completed' && child.status !== 'aborted') {
        const wasPassed = child.artifactValidationStatus === 'passed'
          && JSON.stringify(child.artifacts ?? []) === JSON.stringify(canonicalArtifacts);
        child.artifacts = canonicalArtifacts;
        child.artifactValidationStatus = 'passed';
        child.artifactValidationError = undefined;
        child.runtimeWaitReason = '当前 round 产物已出现，等待 Agent 明确完成信号后再解锁下游。';
        child.updatedAt = now;
        agent.currentTask = child.runtimeWaitReason;
        agent.runtimeStatusReason = '等待完成信号';
        agent.lastActivityAt = now;
        if (!wasPassed) {
          addClusterEvent(cluster, {
            runId: run.runId,
            agentId: agent.agentId,
            title: '产物已发现',
            content: `${agent.name} 的当前 round 产物已出现；系统会等待结构化完成信号或运行结束事件后再解除下游阻塞。`,
            level: 'info',
            createdAt: now,
          });
        }
        changed = !wasPassed;
        continue;
      }
      if (
        child.status === 'completed'
        && (
          child.artifactValidationStatus !== 'passed'
          || JSON.stringify(child.artifacts ?? []) !== JSON.stringify(canonicalArtifacts)
        )
      ) {
        child.artifacts = canonicalArtifacts;
        child.artifactValidationStatus = 'passed';
        child.artifactValidationError = undefined;
        child.error = undefined;
        child.updatedAt = now;
        agent.status = 'done';
        agent.localContext.status = 'done';
        agent.runtimeStatusReason = '产物已校准';
        agent.lastActivityAt = now;
        changed = true;
      }
      continue;
    }

    if (child.status === 'completed') {
      child.status = 'blocked';
      child.submitStatus = 'pending';
      child.completionSignal = undefined;
      child.completionSource = undefined;
      child.unblockedAgentIds = [];
      child.artifacts = [];
      child.artifactValidationStatus = 'pending';
      child.artifactValidationError = '当前 round 缺少该 Agent 的 canonical 产物，已撤销错误完成状态';
      child.completedAt = undefined;
      child.error = child.artifactValidationError;
      child.updatedAt = now;
      child.lastEventAt = now;
      agent.status = 'waiting';
      agent.localContext.status = 'waiting';
      agent.currentTask = child.artifactValidationError;
      agent.runtimeStatusReason = '产物缺失';
      agent.lastActivityAt = now;
      addClusterEvent(cluster, {
        runId: run.runId,
        agentId: agent.agentId,
        title: '产物状态已校准',
        content: child.artifactValidationError,
        level: 'warning',
        createdAt: now,
      });
      changed = true;
    }
  }

  return changed;
}

function sanitizeExecutionGraph(cluster: AgentCluster, graphPatch: Partial<AgentClusterExecutionGraph>): AgentClusterExecutionGraph {
  const now = new Date().toISOString();
  const agentIds = new Set(cluster.agents.map((agent) => agent.agentId));
  const rawEdges = Array.isArray(graphPatch.edges) ? graphPatch.edges : cluster.executionGraph?.edges ?? cluster.edges;
  const seenEdges = new Set<string>();
  const edges = rawEdges
    .map((edge) => {
      if (!agentIds.has(edge.fromAgentId) || !agentIds.has(edge.toAgentId) || edge.fromAgentId === edge.toAgentId) return null;
      const key = `${edge.fromAgentId}:${edge.toAgentId}:${normalizeExecutionType(edge)}`;
      if (seenEdges.has(key)) return null;
      seenEdges.add(key);
      return normalizeEdge({
        ...edge,
        edgeId: edge.edgeId || randomUUID(),
        relationType: normalizeRelationType(edge.relationType),
        label: edge.label?.trim() || '协作',
      });
    })
    .filter((edge): edge is AgentEdge => Boolean(edge));

  const existingNodes = Array.isArray(graphPatch.nodes) ? graphPatch.nodes : cluster.executionGraph?.nodes ?? [];
  const seenNodes = new Set<string>();
  const nodes = [
    ...existingNodes
      .filter((node) => agentIds.has(node.agentId) && !seenNodes.has(node.agentId))
      .map((node) => {
        seenNodes.add(node.agentId);
        return { agentId: node.agentId, x: node.x, y: node.y };
      }),
    ...cluster.agents
      .filter((agent) => !seenNodes.has(agent.agentId))
      .map((agent, index) => ({ agentId: agent.agentId, x: index * 240, y: 0 })),
  ];

  return {
    nodes,
    edges,
    loops: normalizeExecutionLoops(cluster, graphPatch.loops ?? cluster.executionGraph?.loops),
    confirmed: Boolean(graphPatch.confirmed),
    updatedAt: now,
  };
}

export async function updateAgentCluster(
  clusterId: string,
  patch: { clusterName?: string },
): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const name = patch.clusterName?.trim();
    if (name !== undefined) {
      if (!name) throw new Error('集群名称不能为空');
      clusters[index].clusterName = compactText(name, 80);
    }
    clusters[index].updatedAt = new Date().toISOString();
    await writeClusters(clusters);
    return clusters[index];
  });
}

export async function deleteAgentCluster(clusterId: string): Promise<void> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const nextClusters = clusters.filter((cluster) => cluster.clusterId !== clusterId);
    if (nextClusters.length === clusters.length) throw new Error('Agent Cluster not found');
    await writeClusters(nextClusters);
  });
}

export async function updateAgentClusterExecutionGraph(
  clusterId: string,
  graphPatch: Partial<AgentClusterExecutionGraph>,
): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const graph = sanitizeExecutionGraph(cluster, { ...graphPatch, confirmed: false });
    cluster.executionGraph = graph;
    cluster.edges = graph.edges;
    cluster.orchestrationConfirmedAt = null;
    cluster.updatedAt = graph.updatedAt;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

export async function confirmAgentClusterExecutionGraph(clusterId: string): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const now = new Date().toISOString();
    const graph = sanitizeExecutionGraph(cluster, {
      ...(cluster.executionGraph ?? buildExecutionGraph(cluster.agents, cluster.edges, false, now)),
      confirmed: true,
    });
    graph.confirmed = true;
    graph.updatedAt = now;
    assertBlockingDag(cluster, graph);
    cluster.executionGraph = graph;
    cluster.edges = graph.edges;
    cluster.orchestrationConfirmedAt = now;
    cluster.updatedAt = now;
    addClusterEvent(cluster, {
      agentId: null,
      title: '编排图已确认',
      content: '后续启动运行将严格按 blocks/reviews 阻塞边进行 DAG 调度；其他边只传递上下文或用于展示。',
      level: 'success',
      createdAt: now,
    });
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

async function submitReadyAgentClusterChildren(
  clusterId: string,
  runId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<void> {
  const jobs = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) return [];
    const cluster = clusters[index];
    const run = (cluster.runs ?? []).find((item) => item.runId === runId);
    if (!run || cluster.activeRunId !== runId || run.status !== 'running') return [];
    const now = new Date().toISOString();
    await reconcileRunArtifacts(cluster, run, now);
    const readyJobs: Array<{ agent: ClusterAgent; child: AgentClusterChildRun; message: string }> = [];

    for (const child of run.childRuns) {
      const agent = cluster.agents.find((item) => item.agentId === child.agentId);
      if (!agent) continue;
      if (child.status === 'completed' || child.status === 'error' || child.status === 'timeout' || child.status === 'aborted') continue;
      if (child.submitStatus === 'submitted' && child.runId) continue;
      if (child.submitStatus === 'submitted' && child.status !== 'blocked') {
        const submittedAt = new Date(child.lastEventAt ?? child.updatedAt ?? child.startedAt).getTime();
        if (Number.isFinite(submittedAt) && Date.now() - submittedAt < 15_000) continue;
        child.submitStatus = 'pending';
        addClusterEvent(cluster, {
          runId,
          agentId: agent.agentId,
          title: '重新提交子会话',
          content: `${agent.name} 已提交但没有收到 runId，调度器将重新提交该子会话。`,
          level: 'warning',
          createdAt: now,
        });
      }

      const upstreamIds = getBlockingUpstreamAgentIds(cluster, child.agentId);
      const blockingUpstream = upstreamIds.filter((agentId) => {
        const upstreamChild = run.childRuns.find((item) => item.agentId === agentId);
        return !upstreamChild || upstreamChild.status !== 'completed';
      });

      if (blockingUpstream.length > 0) {
        child.status = 'blocked';
        child.submitStatus = child.submitStatus ?? 'pending';
        child.updatedAt = now;
        agent.status = 'waiting';
        agent.localContext.status = 'waiting';
        agent.currentTask = `等待上游完成：${blockingUpstream
          .map((agentId) => cluster.agents.find((item) => item.agentId === agentId)?.name ?? agentId)
          .join('、')}`;
        agent.runtimeStatusReason = 'DAG 阻塞';
        agent.lastActivityAt = now;
        addClusterEvent(cluster, {
          runId,
          agentId: agent.agentId,
          title: '等待上游 Agent',
          content: agent.currentTask,
          level: 'info',
          createdAt: now,
        });
        continue;
      }

      child.status = 'starting';
      child.submitStatus = 'submitted';
      child.updatedAt = now;
      child.lastEventAt = now;
      agent.status = 'running';
      agent.localContext.status = 'running';
      agent.currentTask = 'DAG 条件满足，正在提交子会话';
      agent.runtimeStatusReason = '子会话提交中';
      agent.lastActivityAt = now;
      agent.runtimeSessionKey = child.sessionKey;
      agent.runtimeRunId = child.runId;
      addClusterEvent(cluster, {
        runId,
        agentId: agent.agentId,
        title: '提交子会话',
        content: `${agent.name} 的上游依赖已满足，正在提交到 OpenClaw Gateway。`,
        level: 'info',
        createdAt: now,
      });
      readyJobs.push({
        agent: { ...agent },
        child: { ...child },
        message: buildAgentChildPrompt(cluster, agent),
      });
    }

    updateRootRunStatus(cluster, run, now);
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    eventBus?.emit('agent-cluster:updated', { cluster });
    return readyJobs;
  });

  await Promise.all(jobs.map(async ({ agent, child, message }) => {
    try {
      const result = await gatewayManager.rpc<{ runId?: string; status?: string }>('agent', {
        sessionKey: child.sessionKey,
        message,
        idempotencyKey: `${runId}:${agent.agentId}:${child.startedAt}`,
        deliver: false,
        lane: 'subagent',
        timeout: 0,
        label: `${agent.name}`,
      }, 10_000);
      await recordAgentClusterRuntimeEvent({
        method: 'agent.started',
        params: { sessionKey: child.sessionKey, runId: result?.runId, status: result?.status, agentId: agent.agentId },
      }, eventBus);
    } catch (error) {
      await recordAgentClusterRuntimeEvent({
        method: 'agent.error',
        params: { sessionKey: child.sessionKey, error: error instanceof Error ? error.message : String(error), agentId: agent.agentId },
      }, eventBus);
    } finally {
      scheduleAgentClusterRunWatchdog(clusterId, runId, gatewayManager, eventBus);
    }
  }));
}

export async function pumpReadyAgentClusterChildren(
  clusterId: string,
  runId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<void> {
  await submitReadyAgentClusterChildren(clusterId, runId, gatewayManager, eventBus);
}

export async function startAgentClusterRun(
  clusterId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  const cluster = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    if (cluster.activeRunId) return cluster;
    const executionGraph = normalizeExecutionGraph(cluster);
    if (!executionGraph.confirmed) {
      throw new Error('请先确认 Agent 编排图，再启动集群运行');
    }
    assertBlockingDag(cluster, executionGraph);
    const projectRoot = cluster.projectRoot?.trim() || cluster.sourceFolderPath?.trim() || null;
    if (projectRoot) {
      if (!isAbsolute(projectRoot)) throw new Error('项目根目录必须是绝对路径，无法启动隔离运行');
      const rootStat = await stat(projectRoot).catch(() => null);
      if (!rootStat?.isDirectory()) throw new Error('项目根目录不存在或不是文件夹，无法启动隔离运行');
    }

    const now = new Date().toISOString();
    const runId = `run-${randomUUID()}`;
    const shortClusterId = cluster.clusterId.replace(/^cluster-/, '').slice(0, 10);
    const output = await allocateClusterExperimentOutput(projectRoot, cluster.clusterId, now);
    const run: AgentClusterRun = {
      runId,
	      mode: 'subagent_swarm',
	      status: 'running',
	      sessionKey: `agent:main:cluster-${shortClusterId}`,
	      outputVersion: output.outputVersion,
	      outputRoot: output.outputRoot,
	      outputCreatedAt: output.outputCreatedAt,
	      roundStart: output.roundStart,
      loopStates: (executionGraph.loops ?? []).map((loop) => ({
        loopId: loop.loopId,
        currentIteration: 1,
        repeatCount: loop.repeatCount,
        status: loop.repeatCount > 1 ? 'running' : 'completed',
        updatedAt: now,
      })),
      childRuns: cluster.agents.map((agent) => {
        const expectedArtifacts = expectedArtifactNamesForAgent(agent);
        const candidateTarget = inferCandidateTarget(cluster, agent);
        const agentDir = getAgentOutputDirName(agent);
        return {
          agentId: agent.agentId,
          sessionKey: buildAgentChildSessionKey(cluster, runId, agent.agentId, now),
          runId: '',
          status: getBlockingUpstreamAgentIds(cluster, agent.agentId).length > 0 ? 'blocked' : 'starting',
          submitStatus: 'pending',
          expectedArtifacts,
          artifactValidationStatus: expectedArtifacts.length > 0 ? 'pending' : undefined,
          targetCandidateCount: candidateTarget?.target,
          minAcceptedCandidateCount: candidateTarget?.minimum,
          outputRoot: output.outputRoot,
          iteration: agentDir && usesRoundOutputDir(agentDir) ? output.roundStart : undefined,
          startedAt: now,
          updatedAt: now,
        };
      }),
      lastHeartbeatAt: now,
      watchdogStatus: 'watching',
      submittedChildCount: 0,
      completedChildCount: 0,
      failedChildCount: 0,
      startedAt: now,
      updatedAt: now,
      timeoutAt: new Date(Date.now() + RUN_TIMEOUT_MS).toISOString(),
    };

    cluster.runs = [run, ...(cluster.runs ?? [])];
    cluster.activeRunId = runId;
    cluster.runtimeSessionKey = run.sessionKey;
    addClusterEvent(cluster, {
	        runId,
	        agentId: null,
	        title: '启动 Agent 集群 DAG 调度',
	        content: projectRoot
	          ? `将按已确认编排图提交 ${cluster.agents.length} 个 Agent；blocks/reviews 上游完成后才会解锁下游。项目根目录约束会写入子 Agent prompt：${projectRoot}；本次输出版本：${output.outputVersion ?? '未配置'}；从 round ${output.roundStart} 开始。`
	          : `将按已确认编排图提交 ${cluster.agents.length} 个 Agent；blocks/reviews 上游完成后才会解锁下游。`,
	        level: 'info',
        createdAt: now,
    });

    for (const agent of cluster.agents) {
      const child = run.childRuns.find((item) => item.agentId === agent.agentId);
      if (!child) continue;
      const upstreamIds = getBlockingUpstreamAgentIds(cluster, agent.agentId);
      agent.status = upstreamIds.length > 0 ? 'waiting' : 'running';
      agent.localContext.status = agent.status;
      agent.currentTask = upstreamIds.length > 0
        ? `等待上游完成：${upstreamIds.map((agentId) => cluster.agents.find((item) => item.agentId === agentId)?.name ?? agentId).join('、')}`
        : '等待 DAG 调度器提交子会话';
      agent.lastActivityAt = now;
      agent.runtimeSessionKey = child.sessionKey;
      agent.runtimeRunId = child.runId;
      addClusterEvent(cluster, {
        runId,
        agentId: agent.agentId,
        title: upstreamIds.length > 0 ? '等待上游 Agent' : '准备启动子会话',
        content: agent.currentTask,
        level: 'info',
        createdAt: now,
      });
    }

    clusters[index] = cluster;
    await writeClusters(clusters);

    scheduleAgentClusterRunWatchdog(clusterId, runId, gatewayManager, eventBus);
    return cluster;
  });
  if (cluster.activeRunId) {
    void submitReadyAgentClusterChildren(clusterId, cluster.activeRunId, gatewayManager, eventBus);
  }
  return cluster;
}

export async function recordAgentClusterRuntimeEvent(payload: unknown, eventBus?: HostEventBus): Promise<AgentCluster | null> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const sessionKey = extractSessionKey(payload);
    if (!sessionKey) return null;
    const now = new Date().toISOString();
    let changedCluster: AgentCluster | null = null;

    for (const cluster of clusters) {
      const run = (cluster.runs ?? []).find((item) => item.status === 'running' && item.childRuns.some((child) => child.sessionKey === sessionKey));
      if (!run) continue;
      const child = run.childRuns.find((item) => item.sessionKey === sessionKey);
      const agent = child ? cluster.agents.find((item) => item.agentId === child.agentId) : null;
      if (!child || !agent) continue;

      const summary = summarizeRuntimeEvent(payload);
      if (child.status === 'completed') {
        child.status = 'completed';
        child.updatedAt = now;
        child.lastEventAt = now;
        child.runtimeWaitReason = undefined;
        agent.status = 'done';
        agent.localContext.status = 'done';
        agent.lastActivityAt = now;
        cluster.events = [
          {
            eventId: randomUUID(),
            clusterId: cluster.clusterId,
            runId: run.runId,
            agentId: agent.agentId,
            ...summary,
            createdAt: now,
          },
          ...(cluster.events ?? []),
        ].slice(0, 500);
        updateRootRunStatus(cluster, run, now);
        cluster.updatedAt = now;
        changedCluster = cluster;
        continue;
      }
      const runtimeText = getTextFromRuntimePayload(payload) || summary.content;
      const completion = parseCompletionSignal(cluster, agent, runtimeText)
        ?? (isRuntimeFinalEvent(payload)
          ? {
              completed: true,
              source: 'runtime_final' as const,
              signal: 'runtime final event',
              summary: compactText(runtimeText || `${agent.name} 子会话已结束。`, 900),
              unblockedAgentIds: getBlockingDownstreamAgentIds(cluster, agent.agentId),
              artifacts: [],
            }
          : null);
      child.status = summary.level === 'error'
        ? 'error'
        : 'running';
      child.submitStatus = summary.level === 'error' ? 'failed' : 'submitted';
      child.updatedAt = now;
      child.lastEventAt = now;
      child.runtimeWaitReason = undefined;
      if (summary.level === 'error') child.error = summary.content;
      const maybeRunId = (payload as { params?: { runId?: unknown }; runId?: unknown })?.params?.runId
        ?? (payload as { runId?: unknown })?.runId;
      if (typeof maybeRunId === 'string' && maybeRunId) child.runId = maybeRunId;

      if (completion?.completed) {
        try {
          await applyAgentCompletionSignal(cluster, run, child, agent, completion, summary.content, now);
        } catch {
          // validateAgentCompletionArtifacts already records the actionable error on the child run.
        }
      } else {
        agent.status = child.status === 'completed' ? 'done' : child.status === 'error' ? 'error' : 'running';
        agent.localContext.status = agent.status;
        agent.lastActivityAt = now;
        agent.currentTask = summary.content;
        agent.runtimeStatusReason = summary.title;
        agent.runtimeRunId = child.runId;
        agent.runtimeSessionKey = child.sessionKey;
      }
      cluster.events = [
        {
          eventId: randomUUID(),
          clusterId: cluster.clusterId,
          runId: run.runId,
          agentId: agent.agentId,
          ...summary,
          createdAt: now,
        },
        ...(cluster.events ?? []),
      ].slice(0, 500);
      updateRootRunStatus(cluster, run, now);
      cluster.updatedAt = now;
      changedCluster = cluster;
    }

    if (changedCluster) {
      await writeClusters(clusters);
      eventBus?.emit('agent-cluster:updated', { cluster: changedCluster });
    }
    return changedCluster;
  });
}

function getMessageContentText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return safeStringify(content);
  const parts: string[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === 'thinking') {
      parts.push('模型正在思考并规划下一步。');
    } else if (block.type === 'tool_use' || block.type === 'toolCall') {
      parts.push(`调用工具：${String(block.name ?? 'tool')}`);
    } else if (block.type === 'tool_result' || block.type === 'toolResult') {
      parts.push('工具返回结果。');
    } else if (typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.filter(Boolean).join('\n').trim();
}

function resolveAgentReference(cluster: AgentCluster, reference: string): string | null {
  const normalized = reference.trim().toLowerCase();
  if (!normalized || normalized === 'none') return null;
  const exact = cluster.agents.find((agent) =>
    agent.agentId.toLowerCase() === normalized
    || agent.name.toLowerCase() === normalized
    || agent.role.toLowerCase() === normalized
  );
  if (exact) return exact.agentId;
  const loose = cluster.agents.find((agent) =>
    normalized.includes(agent.agentId.toLowerCase())
    || normalized.includes(agent.name.toLowerCase())
    || normalized.includes(agent.role.toLowerCase())
    || agent.name.toLowerCase().includes(normalized)
    || agent.role.toLowerCase().includes(normalized)
  );
  return loose?.agentId ?? null;
}

function extractDelimitedBlock(text: string, tag: string): string | null {
  const pattern = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'i');
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function parseCompletionSignal(
  cluster: AgentCluster,
  agent: ClusterAgent,
  content: string,
): {
  completed: boolean;
  source: AgentClusterCompletionSource;
  signal: string;
  summary: string;
  unblockedAgentIds: string[];
  artifacts: string[];
} | null {
  const text = content.trim();
  if (!text) return null;
  const hasStructuredCompletion = /\[status\s*:\s*(completed|done|finished)\]/i.test(text);
  const unblockTokens = [...text.matchAll(/\[unblock\s*:\s*([^\]]+)\]/gi)]
    .map((match) => match[1])
    .flatMap((value) => value.split(/[,，、]/))
    .map((value) => value.trim())
    .filter(Boolean);
  const artifactTokens = [...text.matchAll(/\[artifact\s*:\s*([^\]]+)\]/gi)]
    .map((match) => match[1].trim())
    .filter((value) => value && value.toLowerCase() !== 'none');

  const fallbackCompletion = !hasStructuredCompletion
    && (
      /解除.+阻塞|unblock/i.test(text)
      || /可同步到\s*ClusterContext/i.test(text)
      || /step\s*\d+(?:\s*[-+]\s*\d+)?\s*(?:完成|complete|completed)/i.test(text)
      || /当前步骤.+完成/i.test(text)
    )
    && /完成|complete|completed|就绪|ready/i.test(text);

  if (!hasStructuredCompletion && !fallbackCompletion) return null;

  const downstreamIds = getBlockingDownstreamAgentIds(cluster, agent.agentId);
  const resolvedUnblocks = unblockTokens
    .map((token) => resolveAgentReference(cluster, token))
    .filter((agentId): agentId is string => Boolean(agentId));
  const unblockedAgentIds = Array.from(new Set(resolvedUnblocks.length > 0 ? resolvedUnblocks : downstreamIds));
  const summary = extractDelimitedBlock(text, 'summary') ?? compactText(text, 900);

  return {
    completed: true,
    source: hasStructuredCompletion ? 'structured' : 'fallback',
    signal: hasStructuredCompletion ? '[status:completed]' : 'fallback completion signal',
    summary,
    unblockedAgentIds,
    artifacts: splitArtifactTokens(artifactTokens),
  };
}

async function applyAgentCompletionSignal(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  completion: NonNullable<ReturnType<typeof parseCompletionSignal>>,
  content: string,
  now: string,
): Promise<void> {
  const validatedArtifacts = await validateAgentCompletionArtifacts(cluster, run, child, agent, completion, now);
  child.status = 'completed';
  child.submitStatus = 'submitted';
  child.completionSignal = completion.signal;
  child.completionSource = completion.source;
  child.unblockedAgentIds = completion.unblockedAgentIds;
  child.artifacts = validatedArtifacts;
  child.completedAt = now;
  child.updatedAt = now;
  child.lastEventAt = now;
  child.error = undefined;
  child.runtimeWaitReason = undefined;
  child.artifactValidationError = undefined;

  agent.status = 'done';
  agent.localContext.status = 'done';
  agent.currentTask = completion.summary;
  agent.runtimeStatusReason = completion.source === 'structured'
    ? '结构化完成信号'
    : completion.source === 'runtime_final'
      ? '运行结束事件'
      : '自动识别完成';
  agent.lastActivityAt = now;
  agent.localContext.outputs = [
    ...agent.localContext.outputs,
    {
      outputId: randomUUID(),
      agentId: agent.agentId,
      content: completion.summary || compactText(content, 900),
      createdAt: now,
    },
  ].slice(-20);

  cluster.sharedContext.agentSummaries = [
    ...(cluster.sharedContext.agentSummaries ?? []).filter((summary) => summary.agentId !== agent.agentId),
    {
      agentId: agent.agentId,
      name: agent.name,
      summary: completion.summary,
      updatedAt: now,
    },
  ];
  if (validatedArtifacts.length > 0) {
    cluster.sharedContext.latestArtifacts = [
      ...(cluster.sharedContext.latestArtifacts ?? []),
      ...validatedArtifacts.map((artifact) => ({ agentId: agent.agentId, artifact, createdAt: now })),
    ].slice(-30);
    cluster.sharedContext.artifacts = [
      ...(cluster.sharedContext.artifacts ?? []),
      ...validatedArtifacts.map((artifact) => ({
        artifactId: randomUUID(),
        title: artifact,
        kind: 'agent-output',
        content: completion.summary,
        createdAt: now,
      })),
    ].slice(-30);
  }

  addClusterEvent(cluster, {
    runId: run.runId,
    agentId: agent.agentId,
    title: completion.source === 'structured' ? '结构化完成信号' : '自动识别完成',
    content: completion.unblockedAgentIds.length > 0
      ? `${agent.name} 已完成，解除下游阻塞：${completion.unblockedAgentIds.map((agentId) => cluster.agents.find((item) => item.agentId === agentId)?.name ?? agentId).join('、')}`
      : `${agent.name} 已完成。`,
    level: 'success',
    createdAt: now,
  });
  maybeAdvanceExecutionLoops(cluster, run, agent.agentId, now);
}

async function recoverAgentCompletionFromArtifacts(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  now: string,
): Promise<boolean> {
  if (child.status === 'completed' || child.status === 'aborted') return false;
	const expectedArtifacts = expectedArtifactNamesForAgent(agent);
	if (expectedArtifacts.length === 0) return false;
	if (!(await hasExpectedArtifactsForRecovery(run, child, agent))) return false;
  const projectRoot = getClusterProjectRoot(cluster);
  const canonicalPaths = projectRoot ? await getCanonicalArtifactPathsForAgent(run, child, agent) : [];
  const canonicalArtifacts = projectRoot ? canonicalPaths.map((filePath) => relative(projectRoot, filePath)) : [];
  const wasPassed = child.artifactValidationStatus === 'passed'
    && JSON.stringify(child.artifacts ?? []) === JSON.stringify(canonicalArtifacts);
  child.artifacts = canonicalArtifacts;
  child.expectedArtifacts = expectedArtifacts;
  child.artifactValidationStatus = 'passed';
  child.artifactValidationError = undefined;
  child.runtimeWaitReason = '当前 round 产物已出现，等待 Agent 明确完成信号后再解锁下游。';
  child.updatedAt = now;
  agent.currentTask = child.runtimeWaitReason;
  agent.runtimeStatusReason = '等待完成信号';
  agent.lastActivityAt = now;
  if (!wasPassed) {
    addClusterEvent(cluster, {
      runId: run.runId,
      agentId: agent.agentId,
      title: '产物已发现',
      content: `${agent.name} 的预期产物已在当前输出目录中发现；系统不会仅凭文件出现就解除 DAG 阻塞。`,
      level: 'info',
      createdAt: now,
    });
  }
  return !wasPassed;
}

function getTranscriptMessageId(message: Record<string, unknown>, index: number): string {
  return String(message.id ?? message.timestamp ?? index);
}

function getTranscriptMessageTimeMs(message: Record<string, unknown>): number | null {
  const candidates = [message.timestamp, message.createdAt, message.created_at, message.time, message.id];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 1_000_000_000_000 ? value : value * 1000;
    }
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

async function refreshRunEventsLocked(
  cluster: AgentCluster,
  run: AgentClusterRun,
  gatewayManager: GatewayManager,
): Promise<boolean> {
  const now = new Date().toISOString();
  let changed = await reconcileRunArtifacts(cluster, run, now);
  for (const child of run.childRuns) {
    const agent = cluster.agents.find((item) => item.agentId === child.agentId);
    if (!agent) continue;
    if (child.status === 'completed' || child.status === 'aborted') continue;
    if (child.status === 'blocked' && child.submitStatus === 'pending') continue;

    try {
      const history = await gatewayManager.rpc<{ messages?: Array<Record<string, unknown>> }>('chat.history', {
        sessionKey: child.sessionKey,
        limit: 40,
      }, 5_000);
      const messages = Array.isArray(history.messages) ? history.messages : [];
      const lastKnownIndex = child.lastTranscriptMessageId
        ? messages.findIndex((message, index) => getTranscriptMessageId(message, index) === child.lastTranscriptMessageId)
        : -1;
      const newMessages = messages.slice(Math.max(0, lastKnownIndex + 1));
      for (const message of newMessages) {
        const messageTimeMs = getTranscriptMessageTimeMs(message);
        const childStartedMs = new Date(child.startedAt).getTime();
        if (
          messageTimeMs !== null
          && Number.isFinite(childStartedMs)
          && messageTimeMs + 1000 < childStartedMs
        ) {
          continue;
        }
        const role = String(message.role ?? '');
        if (role !== 'assistant' && role !== 'toolresult' && role !== 'tool') continue;
        const fullContent = getMessageContentText(message);
        const content = compactText(fullContent, 500);
        if (!content) continue;
        addClusterEvent(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          title: role === 'assistant' ? '子会话输出' : '工具事件',
          content,
          level: 'info',
          raw: message,
          createdAt: now,
        });
        const completion = role === 'assistant' ? parseCompletionSignal(cluster, agent, fullContent) : null;
        if (completion?.completed) {
          try {
            await applyAgentCompletionSignal(cluster, run, child, agent, completion, fullContent, now);
          } catch {
            // validateAgentCompletionArtifacts already marks the child run as failed with details.
          }
        } else {
          agent.currentTask = content;
          agent.runtimeStatusReason = role === 'assistant' ? '子会话输出' : '工具事件';
          agent.lastActivityAt = now;
          child.lastEventAt = now;
          child.runtimeWaitReason = undefined;
          if (child.status !== 'completed') child.status = 'running';
          child.submitStatus = 'submitted';
        }
        changed = true;
      }
      if (messages.length > 0) {
        child.lastTranscriptMessageId = getTranscriptMessageId(messages[messages.length - 1], messages.length - 1);
      }
      if (await recoverAgentCompletionFromArtifacts(cluster, run, child, agent, now)) {
        changed = true;
        continue;
      }
    } catch (error) {
      addClusterEvent(cluster, {
        runId: run.runId,
        agentId: agent.agentId,
        title: '读取子会话历史失败',
        content: error instanceof Error ? error.message : String(error),
        level: 'warning',
        createdAt: now,
      });
      changed = true;
    }

    if (child.status === 'completed' || child.status === 'error' || child.status === 'timeout') continue;
    const lastEventMs = new Date(child.lastEventAt ?? child.updatedAt ?? child.startedAt).getTime();
    if (Date.now() - lastEventMs > CHILD_NO_EVENT_TIMEOUT_MS) {
      const waitReason = '超过 5 分钟没有新的 Gateway 事件或 transcript 更新，系统会继续自动轮询子会话历史和本轮产物。';
      const shouldEmitWaitEvent = child.runtimeWaitReason !== waitReason;
      child.status = child.status === 'blocked' ? 'blocked' : 'running';
      child.runtimeWaitReason = waitReason;
      child.updatedAt = now;
      agent.status = child.status === 'blocked' ? 'waiting' : 'running';
      agent.localContext.status = agent.status;
      agent.currentTask = '等待子会话产物';
      agent.runtimeStatusReason = '等待产物';
      if (shouldEmitWaitEvent) {
        addClusterEvent(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          title: '等待子会话产物',
          content: waitReason,
          level: 'info',
          createdAt: now,
        });
      }
      changed = true;
    }
  }
  if (await reconcileRunArtifacts(cluster, run, now)) {
    changed = true;
  }
  updateRootRunStatus(cluster, run, now);
  if (run.status === 'running' && !cluster.activeRunId) {
    cluster.activeRunId = run.runId;
  }
  run.watchdogStatus = cluster.activeRunId === run.runId ? 'watching' : 'settled';
  cluster.updatedAt = now;
  return changed;
}

export async function refreshAgentClusterRunEvents(
  clusterId: string,
  runId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  const cluster = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const run = findRun(cluster, runId);
    await refreshRunEventsLocked(cluster, run, gatewayManager);
    clusters[index] = cluster;
    await writeClusters(clusters);
    eventBus?.emit('agent-cluster:updated', { cluster });
    return cluster;
  });
  if (cluster.activeRunId === runId) {
    void submitReadyAgentClusterChildren(clusterId, runId, gatewayManager, eventBus);
  }
  return cluster;
}

export async function resetAgentClusterRun(clusterId: string, runId: string): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    findRun(cluster, runId);
    const now = new Date().toISOString();
    cluster.runs = [];
    cluster.activeRunId = null;
    cluster.runtimeSessionKey = null;
    cluster.messages = [];
    cluster.events = [];
    cluster.sharedContext.managerInstructions = [];
    cluster.sharedContext.promptPatches = [];
    cluster.sharedContext.runDecisions = [];
    cluster.sharedContext.latestArtifacts = [];
    cluster.sharedContext.managerProposals = [];
    cluster.sharedContext.artifacts = [];
    cluster.sharedContext.agentSummaries = cluster.agents.map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      summary: `${agent.name} 已重置，等待下一次运行。`,
      updatedAt: now,
    }));
    cluster.sharedContext.finalSummary = '';
    for (const agent of cluster.agents) {
      agent.status = 'idle';
      agent.lastActivityAt = undefined;
      agent.currentTask = undefined;
      agent.runtimeStatusReason = undefined;
      agent.runtimeRunId = undefined;
      agent.runtimeSessionKey = undefined;
      agent.localContext.status = 'idle';
      agent.localContext.privateMessages = [];
      agent.localContext.receivedMessages = [];
      agent.localContext.outputs = [];
      agent.localContext.workingMemory = {
        resetAt: now,
        note: '集群运行已重置；保留 Agent 定义和编排图。',
      };
    }
    addClusterEvent(cluster, {
      runId,
      agentId: null,
      title: '运行状态已重置',
      content: '已清空 runs、消息、事件、Manager patch/proposal 和 Agent 本地上下文；保留 Agent 定义与编排图。',
      level: 'warning',
      createdAt: now,
    });
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

export async function retryAgentClusterRunAgent(
  clusterId: string,
  runId: string,
  agentId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
	const cluster = await withStoreQueue(async () => {
	  const clusters = await readClusters();
	  const index = clusters.findIndex((item) => item.clusterId === clusterId);
	  if (index === -1) throw new Error('Agent Cluster not found');
	  const cluster = clusters[index];
    const run = findRun(cluster, runId);
    const child = run.childRuns.find((item) => item.agentId === agentId);
    const agent = cluster.agents.find((item) => item.agentId === agentId);
    if (!child || !agent) throw new Error('Agent not found in run');
    const now = new Date().toISOString();
    resetChildForRerun(cluster, run, child, agent, 'starting', now, child.iteration);
    agent.status = 'running';
    agent.localContext.status = 'running';
    agent.currentTask = '正在重试该 Agent';
    agent.runtimeStatusReason = '手动重试';
    agent.lastActivityAt = now;
    run.status = 'running';
    run.error = undefined;
    run.completedAt = undefined;
    cluster.activeRunId = runId;
    addClusterEvent(cluster, {
      runId,
      agentId,
      title: '重试 Agent',
      content: `${agent.name} 已重新进入 DAG 调度队列。`,
      level: 'warning',
      createdAt: now,
    });
    updateRootRunStatus(cluster, run, now);
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    eventBus?.emit('agent-cluster:updated', { cluster });
    return cluster;
  });
  void submitReadyAgentClusterChildren(clusterId, runId, gatewayManager, eventBus);
  scheduleAgentClusterRunWatchdog(clusterId, runId, gatewayManager, eventBus);
  return cluster;
}

export async function skipAgentClusterRunAgent(
  clusterId: string,
  runId: string,
  agentId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  const cluster = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((item) => item.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const run = findRun(cluster, runId);
    const child = run.childRuns.find((item) => item.agentId === agentId);
    const agent = cluster.agents.find((item) => item.agentId === agentId);
    if (!child || !agent) throw new Error('Agent not found in run');
    const now = new Date().toISOString();
    child.status = 'completed';
    child.submitStatus = child.submitStatus ?? 'pending';
    child.error = undefined;
    child.completionSignal = 'manual skip';
    child.completionSource = 'manual';
    child.unblockedAgentIds = getBlockingDownstreamAgentIds(cluster, agentId);
    child.artifactValidationStatus = 'skipped';
    child.artifactValidationError = undefined;
    child.completedAt = now;
    child.updatedAt = now;
    agent.status = 'done';
    agent.localContext.status = 'done';
    agent.currentTask = '已手动跳过，允许下游继续';
    agent.runtimeStatusReason = '手动跳过';
    agent.lastActivityAt = now;
    run.status = 'running';
    run.error = undefined;
    run.completedAt = undefined;
    cluster.activeRunId = runId;
    addClusterEvent(cluster, {
      runId,
      agentId,
      title: '跳过 Agent',
      content: `${agent.name} 已标记为完成，下游阻塞节点可以继续调度。`,
      level: 'warning',
      createdAt: now,
    });
    maybeAdvanceExecutionLoops(cluster, run, agentId, now);
    updateRootRunStatus(cluster, run, now);
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    eventBus?.emit('agent-cluster:updated', { cluster });
    return cluster;
  });
  void submitReadyAgentClusterChildren(clusterId, runId, gatewayManager, eventBus);
  scheduleAgentClusterRunWatchdog(clusterId, runId, gatewayManager, eventBus);
  return cluster;
}

export async function resumeAgentClusterRunFromAgent(
  clusterId: string,
  runId: string,
  agentId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  const cluster = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((item) => item.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const run = findRun(cluster, runId);
    const agent = cluster.agents.find((item) => item.agentId === agentId);
	  if (!agent) throw new Error('Agent not found in run');
	  const projectRoot = getClusterProjectRoot(cluster);
	  let switchedOutputRoot = false;
	  if (projectRoot && (!run.outputRoot || !basename(run.outputRoot).startsWith('version_'))) {
	    const output = await allocateClusterExperimentOutput(projectRoot, cluster.clusterId, run.startedAt ?? new Date().toISOString());
	    run.outputRoot = output.outputRoot;
	    run.outputVersion = output.outputVersion;
	    run.outputCreatedAt = output.outputCreatedAt;
	    run.roundStart = output.roundStart;
	    for (const child of run.childRuns) {
	      child.outputRoot = run.outputRoot;
	    }
	    switchedOutputRoot = true;
	  }
    const affectedAgentIds = new Set([agentId, ...getBlockingDownstreamClosure(cluster, agentId)]);
    const now = new Date().toISOString();
    const currentChild = run.childRuns.find((child) => child.agentId === agentId);
    const upstreamIterations = getBlockingUpstreamAgentIds(cluster, agentId)
      .map((upstreamAgentId) => run.childRuns.find((child) => child.agentId === upstreamAgentId))
      .filter((child): child is AgentClusterChildRun => Boolean(child) && child.status === 'completed')
      .map((child) => getChildIteration(child));
	  const nextOutputRound = isFactorGeneratorAgent(agent)
	    ? await getNextClusterOutputRound(run.outputRoot)
	    : null;
	  const currentIteration = getChildIteration(currentChild);
	  const shouldStartNextRound = isFactorGeneratorAgent(agent) && currentChild?.status === 'completed';
	  const resumeIteration = isFactorGeneratorAgent(agent)
	    ? switchedOutputRoot
	      ? nextOutputRound ?? 1
	      : shouldStartNextRound
	        ? Math.max(currentIteration + 1, nextOutputRound ?? 1)
	        : currentIteration
	    : upstreamIterations.length > 0
	      ? Math.max(...upstreamIterations)
	      : currentIteration;

    run.status = 'running';
    run.error = undefined;
    run.completedAt = undefined;
    run.watchdogStatus = 'watching';
    run.timeoutAt = new Date(Date.now() + RUN_TIMEOUT_MS).toISOString();
    cluster.activeRunId = runId;

    const graph = normalizeExecutionGraph(cluster);
    const existingLoopStates = new Map((run.loopStates ?? []).map((state) => [state.loopId, state]));
    run.loopStates = (graph.loops ?? []).map((loop) => {
      const state = existingLoopStates.get(loop.loopId) ?? {
        loopId: loop.loopId,
        currentIteration: 1,
        repeatCount: loop.repeatCount,
        status: 'idle' as const,
        updatedAt: now,
      };
      const path = getBlockingPathAgentIds(cluster, loop.startAgentId, loop.endAgentId);
      if (!path.includes(agentId)) return state;
      return {
        ...state,
        currentIteration: 1,
        repeatCount: loop.repeatCount,
        status: loop.repeatCount > 1 ? 'running' : 'completed',
        updatedAt: now,
      };
    });

    for (const child of run.childRuns) {
      if (!affectedAgentIds.has(child.agentId)) continue;
      const affectedAgent = cluster.agents.find((item) => item.agentId === child.agentId);
      const isTarget = child.agentId === agentId;
      resetChildForRerun(cluster, run, child, affectedAgent, isTarget ? 'starting' : 'blocked', now, resumeIteration);
      if (affectedAgent) {
        affectedAgent.currentTask = isTarget
          ? `Cluster Manager 要求从该节点继续运行（round ${resumeIteration}）`
          : `等待 ${agent.name} 重新完成（round ${resumeIteration}）`;
        affectedAgent.runtimeStatusReason = isTarget ? '从指定节点继续' : 'DAG 阻塞';
      }
    }

    cluster.sharedContext.runDecisions = [
      ...(cluster.sharedContext.runDecisions ?? []),
      {
        decisionId: randomUUID(),
        title: '从指定 Agent 继续运行',
        content: `Cluster Manager 将从 ${agent.name} 继续，保留已完成上游产物，重置其阻塞下游，并复用当前集群输出目录。${isFactorGeneratorAgent(agent) ? `本次将进入 round ${resumeIteration} 并强制重新生成候选。` : ''}`,
        createdAt: now,
      },
    ].slice(-30);
    addClusterEvent(cluster, {
      runId,
      agentId,
      title: '从指定 Agent 继续运行',
      content: `已重置 ${[...affectedAgentIds].map((id) => cluster.agents.find((item) => item.agentId === id)?.name ?? id).join('、')}，上游已完成节点保持不变，并复用当前集群输出目录。${isFactorGeneratorAgent(agent) ? `本次为 round ${resumeIteration}。` : ''}`,
      level: 'warning',
      createdAt: now,
    });
    updateRootRunStatus(cluster, run, now);
    cluster.activeRunId = runId;
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    eventBus?.emit('agent-cluster:updated', { cluster });
    return cluster;
  });
  void submitReadyAgentClusterChildren(clusterId, runId, gatewayManager, eventBus);
  scheduleAgentClusterRunWatchdog(clusterId, runId, gatewayManager, eventBus);
  return cluster;
}

function scheduleAgentClusterRunWatchdog(
  clusterId: string,
  runId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): void {
  const key = `${clusterId}:${runId}`;
  const existing = runWatchdogs.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    void refreshAgentClusterRunEvents(clusterId, runId, gatewayManager, eventBus)
      .then((cluster) => {
        const run = (cluster.runs ?? []).find((item) => item.runId === runId);
        if (run && cluster.activeRunId === runId && run.status === 'running') {
          scheduleAgentClusterRunWatchdog(clusterId, runId, gatewayManager, eventBus);
        } else {
          runWatchdogs.delete(key);
        }
      })
      .catch(() => {
        scheduleAgentClusterRunWatchdog(clusterId, runId, gatewayManager, eventBus);
      });
  }, RUN_WATCHDOG_INTERVAL_MS);
  timer.unref?.();
  runWatchdogs.set(key, timer);
}

export async function listAgentClusters(): Promise<AgentCluster[]> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    return clusters.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function getAgentCluster(clusterId: string): Promise<AgentCluster | null> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    return clusters.find((cluster) => cluster.clusterId === clusterId) ?? null;
  });
}

export async function createAgentCluster(
  input: CreateAgentClusterInput,
  onCreationStatus?: CreationStatusListener,
): Promise<AgentCluster> {
  const requestId = input.requestId?.trim() || randomUUID();
  const emitStage = (
    stageId: AgentClusterCreationStageId,
    status: AgentClusterCreationStageStatus,
    detail: string,
    error?: string,
  ) => updateCreationStatus(requestId, stageId, status, detail, onCreationStatus, error);
  createCreationStatus(requestId);
  onCreationStatus?.(creationStatuses.get(requestId)!);
  try {
    emitStage('read_source', 'running', '正在读取任务输入');
    const sourceContent = await resolveSourceContent(input);
    emitStage('read_source', 'completed', `资料读取完成，约 ${sourceContent.length} 字符`);
    return await withStoreQueue(async () => {
      const clusters = await readClusters();
      const cluster = await buildClusterFromSource(input.sourceType, sourceContent, nextClusterName(clusters), input, emitStage);
      emitStage('save_cluster', 'running', '正在保存 Agent 集群');
      await writeClusters([cluster, ...clusters]);
      emitStage('save_cluster', 'completed', 'Agent 集群已保存');
      completeCreationStatus(requestId, cluster.clusterId, onCreationStatus);
      return cluster;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = creationStatuses.get(requestId);
    updateCreationStatus(requestId, status?.currentStageId ?? 'read_source', 'error', message, onCreationStatus, message);
    throw error;
  }
}

export async function sendAgentClusterMessage(
  clusterId: string,
  input: SendAgentClusterMessageInput,
): Promise<AgentCluster> {
  return withStoreQueue(async () => {
  const clusters = await readClusters();
  const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
  if (index === -1) throw new Error('Agent Cluster not found');

  const cluster = clusters[index];
  const content = input.content.trim();
  if (!content) throw new Error('消息不能为空');

  const targetAgentId = input.targetAgentId ?? findMentionTarget(content, cluster.agents);
  const targetAgent = targetAgentId
    ? cluster.agents.find((agent) => agent.agentId === targetAgentId) ?? null
    : null;
  const now = new Date().toISOString();
  const userMessage = makeMessage(clusterId, {
    senderType: 'user',
    senderAgentId: null,
    targetType: targetAgent ? 'agent' : 'cluster',
    targetAgentId: targetAgent?.agentId ?? null,
    messageType: 'instruction',
    content,
    visibility: targetAgent ? 'targeted' : 'public',
  }, now);

  cluster.messages.push(userMessage);

  if (targetAgent) {
    targetAgent.localContext.receivedMessages.push(userMessage);
    targetAgent.status = 'waiting';
    targetAgent.localContext.status = 'waiting';
    const output: AgentOutput = {
      outputId: randomUUID(),
      agentId: targetAgent.agentId,
      content: `${targetAgent.name} 已收到定向消息，下一步会围绕自身职责处理：${compactText(content, 180)}`,
      createdAt: now,
    };
    targetAgent.localContext.outputs.push(output);
    targetAgent.localContext.workingMemory = {
      lastInstruction: compactText(content, 260),
      updatedAt: now,
    };
    cluster.sharedContext.agentSummaries = cluster.sharedContext.agentSummaries.map((summary) =>
      summary.agentId === targetAgent.agentId
        ? { ...summary, summary: output.content, updatedAt: now }
        : summary
    );
  } else {
    cluster.sharedContext.decisions.push(`用户向集群广播：${compactText(content, 140)}`);
    cluster.messages.push(makeMessage(clusterId, {
      senderType: 'orchestrator',
      senderAgentId: cluster.agents[0]?.agentId ?? null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'update',
      content: `已将这条集群消息写入共享上下文，并等待相关 Agent 按职责跟进。`,
      visibility: 'public',
    }, now));
  }

  cluster.updatedAt = now;
  clusters[index] = cluster;
  await writeClusters(clusters);
  return cluster;
  });
}

export async function sendAgentClusterManagerMessage(
  clusterId: string,
  input: SendAgentClusterManagerMessageInput,
  gatewayManager?: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  void gatewayManager;
  void eventBus;
  const content = input.content.trim();
  if (!content) throw new Error('Manager 指令不能为空');

  const clusterSnapshot = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const cluster = clusters.find((item) => item.clusterId === clusterId);
    if (!cluster) throw new Error('Agent Cluster not found');
    return cluster;
  });
  const decision = await requestManagerDecisionFromLlm(clusterSnapshot, content, input);

  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');

    const cluster = clusters[index];
    const now = new Date().toISOString();
    const decisionTargetIds = [
      ...(decision.targetAgentIds ?? []),
      ...(decision.targetAgentNames ?? []),
      ...(decision.promptPatches ?? []).flatMap((patch) => [patch.targetAgentId, patch.targetAgentName]),
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => resolveAgentReference(cluster, value))
      .filter((agentId): agentId is string => Boolean(agentId));
    const targetAgentIds = Array.from(new Set(decisionTargetIds.length > 0 ? decisionTargetIds : inferInstructionTargetAgentIds(content, cluster)));
    const targetNames = targetAgentIds
      .map((agentId) => cluster.agents.find((agent) => agent.agentId === agentId)?.name ?? agentId)
      .join('、');
    const reply = decision.reply?.trim()
      || (targetAgentIds.length > 0
        ? `我已理解这条改动，并生成一个发给 ${targetNames} 的待确认提案。`
        : '我已理解这条改动，并生成一个待确认提案。');

    cluster.messages.push(makeMessage(clusterId, {
      senderType: 'user',
      senderAgentId: null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'instruction',
      content,
      visibility: 'public',
    }, now));

    const promptPatches = (decision.promptPatches ?? [])
      .map((patch) => {
        const targetAgentId = patch.targetAgentId
          ? resolveAgentReference(cluster, patch.targetAgentId)
          : patch.targetAgentName
            ? resolveAgentReference(cluster, patch.targetAgentName)
            : null;
        return {
          targetAgentId,
          targetAgentName: patch.targetAgentName,
          instruction: patch.instruction?.trim() || content,
        };
      })
      .filter((patch) => patch.instruction);
    const patchEntries = promptPatches.length > 0
      ? promptPatches
      : (targetAgentIds.length > 0
        ? targetAgentIds.map((targetAgentId) => ({ targetAgentId, instruction: content }))
        : [{ targetAgentId: null, instruction: content }]);

    const updates = decision.sharedContextUpdates ?? {};
    const resumeAgentId = decision.recommendedResumeFromAgentId
      ? resolveAgentReference(cluster, decision.recommendedResumeFromAgentId)
      : decision.recommendedResumeFromAgentName
        ? resolveAgentReference(cluster, decision.recommendedResumeFromAgentName)
        : null;
    const proposal: AgentClusterManagerProposal = {
      proposalId: `proposal-${randomUUID()}`,
      reply,
      sourceInstruction: content,
      promptPatches: patchEntries.map((patch) => ({
        targetAgentId: patch.targetAgentId ?? null,
        targetAgentName: patch.targetAgentName ?? null,
        instruction: patch.instruction,
      })),
      agentDrafts: (decision.agentDrafts ?? []).map((draft) => ({
        name: compactText(draft.name?.trim() || '新增 Agent', 80),
        role: compactText(draft.role?.trim() || '自定义协作者', 80),
        description: compactText(draft.description?.trim() || content, 240),
        responsibilities: coerceStringArray(draft.responsibilities, [compactText(content, 140)]),
        systemPrompt: draft.systemPrompt?.trim(),
        tools: coerceStringArray(draft.tools),
        capabilities: coerceStringArray(draft.capabilities, ['按用户定义执行']),
      })),
      edgeDrafts: (decision.edgeDrafts ?? []).map((edge) => ({
        ...edge,
        relationType: normalizeRelationType(edge.relationType),
        executionType: normalizeExecutionType(edge),
        isBlocking: edge.isBlocking ?? (normalizeExecutionType(edge) === 'blocks' || normalizeExecutionType(edge) === 'reviews'),
        label: edge.label?.trim() || executionTypeLabelForManager(normalizeExecutionType(edge)),
        reason: edge.reason?.trim(),
      })),
      sharedContextSummary: decision.sharedContextSummary?.trim() || updates.summary?.trim() || coerceStringArray(updates.decisions)[0],
      recommendedResumeFromAgentId: resumeAgentId,
      recommendedResumeFromAgentName: decision.recommendedResumeFromAgentName ?? null,
      runDecision: decision.runDecision?.trim(),
      status: 'pending',
      createdAt: now,
    };
    cluster.sharedContext.managerProposals = [
      proposal,
      ...(cluster.sharedContext.managerProposals ?? []),
    ].slice(0, 30);

    cluster.messages.push(makeMessage(clusterId, {
      senderType: 'orchestrator',
      senderAgentId: null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'update',
      content: `${reply}\n\n已生成待确认提案。应用前不会修改 Agent prompt 或编排图。`,
      visibility: 'public',
    }, now));

    addClusterEvent(cluster, {
      agentId: null,
      title: 'Manager 提案待确认',
      content: [
        patchEntries.length > 0 ? `Prompt 修改 ${patchEntries.length} 项` : '',
        proposal.agentDrafts.length > 0 ? `新增 Agent ${proposal.agentDrafts.length} 个` : '',
        proposal.edgeDrafts.length > 0 ? `新增/修改关系 ${proposal.edgeDrafts.length} 条` : '',
        resumeAgentId ? `建议从 ${cluster.agents.find((agent) => agent.agentId === resumeAgentId)?.name ?? resumeAgentId} 继续运行` : '',
      ].filter(Boolean).join('；'),
      level: 'info',
      raw: proposal,
      createdAt: now,
    });

    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

export async function applyAgentClusterManagerProposal(
  clusterId: string,
  proposalId: string,
): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');

    const cluster = clusters[index];
    const proposal = (cluster.sharedContext.managerProposals ?? []).find((item) => item.proposalId === proposalId);
    if (!proposal) throw new Error('Manager proposal not found');
    if (proposal.status !== 'pending') throw new Error('Manager proposal is not pending');

    const now = new Date().toISOString();
    const createdAgentIdsByName = new Map<string, string>();
    const graphChanged = proposal.agentDrafts.length > 0 || proposal.edgeDrafts.length > 0;

    for (const draft of proposal.agentDrafts) {
      const agent = buildAgent(cluster.clusterId, {
        name: draft.name || '新增 Agent',
        role: draft.role || '自定义协作者',
        description: draft.description || proposal.sourceInstruction,
        responsibilities: coerceStringArray(draft.responsibilities, [compactText(proposal.sourceInstruction, 120)]),
        tools: coerceStringArray(draft.tools),
        capabilities: coerceStringArray(draft.capabilities, ['按用户定义执行']),
      }, cluster.agents.length, proposal.sourceInstruction);
      if (draft.systemPrompt?.trim()) {
        agent.systemPrompt = draft.systemPrompt.trim();
        agent.localContext.systemPrompt = agent.systemPrompt;
      }
      cluster.agents.push(agent);
      createdAgentIdsByName.set(looseKey(agent.name), agent.agentId);
      cluster.sharedContext.agentSummaries.push({
        agentId: agent.agentId,
        name: agent.name,
        summary: `${agent.name} 负责：${agent.responsibilities.join('、')}。`,
        updatedAt: now,
      });
    }

    const resolveDraftAgent = (agentId?: string | null, agentName?: string | null): string | null => {
      if (agentId && cluster.agents.some((agent) => agent.agentId === agentId)) return agentId;
      if (agentId) {
        const resolved = resolveAgentReference(cluster, agentId);
        if (resolved) return resolved;
      }
      if (agentName) {
        const created = createdAgentIdsByName.get(looseKey(agentName));
        if (created) return created;
        return resolveAgentReference(cluster, agentName);
      }
      return null;
    };

    const newEdges: AgentEdge[] = [];
    for (const draft of proposal.edgeDrafts) {
      const fromAgentId = resolveDraftAgent(draft.fromAgentId, draft.fromAgentName);
      const toAgentId = resolveDraftAgent(draft.toAgentId, draft.toAgentName);
      if (!fromAgentId || !toAgentId || fromAgentId === toAgentId) continue;
      const executionType = normalizeExecutionType(draft);
      newEdges.push({
        edgeId: randomUUID(),
        fromAgentId,
        toAgentId,
        relationType: normalizeRelationType(draft.relationType),
        executionType,
        isBlocking: draft.isBlocking ?? (executionType === 'blocks' || executionType === 'reviews'),
        label: draft.label?.trim() || executionTypeLabelForManager(executionType),
        reason: draft.reason?.trim(),
      });
    }

    cluster.edges = [...cluster.edges, ...newEdges].map(normalizeEdge);
    cluster.sharedContext.promptPatches = [
      ...(cluster.sharedContext.promptPatches ?? []),
      ...proposal.promptPatches.map((patch) => ({
        patchId: randomUUID(),
        targetAgentId: resolveDraftAgent(patch.targetAgentId, patch.targetAgentName),
        instruction: patch.instruction,
        createdAt: now,
      })),
    ].slice(-50);
    cluster.sharedContext.managerInstructions = [
      ...(cluster.sharedContext.managerInstructions ?? []),
      compactText(proposal.sourceInstruction, 220),
    ].slice(-30);
    cluster.sharedContext.decisions = [
      ...(cluster.sharedContext.decisions ?? []),
      proposal.sharedContextSummary || compactText(proposal.sourceInstruction, 180),
    ].filter(Boolean).slice(-60);
    if (proposal.runDecision) {
      cluster.sharedContext.runDecisions = [
        ...(cluster.sharedContext.runDecisions ?? []),
        {
          decisionId: randomUUID(),
          title: 'Manager 提案已应用',
          content: proposal.runDecision,
          createdAt: now,
        },
      ].slice(-30);
    }

    proposal.status = 'applied';
    proposal.appliedAt = now;
    cluster.sharedContext.managerProposals = (cluster.sharedContext.managerProposals ?? []).map((item) =>
      item.proposalId === proposalId ? proposal : item
    );

    if (graphChanged) {
      const graph = sanitizeExecutionGraph(cluster, {
        ...(cluster.executionGraph ?? buildExecutionGraph(cluster.agents, cluster.edges, false, now)),
        edges: cluster.edges,
        confirmed: false,
      });
      cluster.executionGraph = graph;
      cluster.edges = graph.edges;
      cluster.orchestrationConfirmedAt = null;
    }

    cluster.messages.push(makeMessage(clusterId, {
      senderType: 'orchestrator',
      senderAgentId: null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'update',
      content: graphChanged
        ? 'Manager 提案已应用。由于 Agent 或关系发生变化，请重新确认流水线后再运行。'
        : 'Manager 提案已应用，新的 prompt patch 会进入后续 Agent 子会话。',
      visibility: 'public',
    }, now));
    addClusterEvent(cluster, {
      agentId: proposal.recommendedResumeFromAgentId ?? null,
      title: 'Manager 提案已应用',
      content: [
        proposal.promptPatches.length > 0 ? `已写入 ${proposal.promptPatches.length} 个 prompt patch` : '',
        proposal.agentDrafts.length > 0 ? `已新增 ${proposal.agentDrafts.length} 个 Agent` : '',
        newEdges.length > 0 ? `已新增 ${newEdges.length} 条关系` : '',
      ].filter(Boolean).join('；') || '提案已应用',
      level: 'success',
      createdAt: now,
      raw: proposal,
    });

    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

export async function dismissAgentClusterManagerProposal(
  clusterId: string,
  proposalId: string,
): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');

    const cluster = clusters[index];
    const proposal = (cluster.sharedContext.managerProposals ?? []).find((item) => item.proposalId === proposalId);
    if (!proposal) throw new Error('Manager proposal not found');
    if (proposal.status !== 'pending') throw new Error('Manager proposal is not pending');

    const now = new Date().toISOString();
    proposal.status = 'dismissed';
    proposal.dismissedAt = now;
    cluster.sharedContext.managerProposals = (cluster.sharedContext.managerProposals ?? []).map((item) =>
      item.proposalId === proposalId ? proposal : item
    );
    cluster.messages.push(makeMessage(clusterId, {
      senderType: 'orchestrator',
      senderAgentId: null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'update',
      content: 'Manager 提案已放弃，没有修改 Agent prompt 或编排图。',
      visibility: 'public',
    }, now));
    addClusterEvent(cluster, {
      agentId: null,
      title: 'Manager 提案已放弃',
      content: compactText(proposal.reply, 240),
      level: 'info',
      createdAt: now,
    });
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}
