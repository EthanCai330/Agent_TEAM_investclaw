import { createHash, randomUUID } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import { app } from 'electron';
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import type { HostEventBus } from '../api/event-bus';
import { getProviderService } from '../services/providers/provider-service';
import { getProviderConfig } from './provider-registry';
import { getOpenClawConfigDir } from './paths';

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
type AgentClusterRuntimeFailureKind = 'runtime_error' | 'incomplete_output' | 'stale_after_restart';
type AgentClusterChildPromptMode = 'initial' | 'continuation' | 'repair';
type AgentClusterCreationStageStatus = 'pending' | 'running' | 'completed' | 'error';
type AgentClusterCreationStatusValue = 'running' | 'completed' | 'error' | 'aborted';
type AgentClusterManagerProposalStatus = 'pending' | 'applied' | 'dismissed';
type AgentClusterWorkflowStatus = 'draft' | 'confirmed' | 'archived';
type AgentClusterRuntimeMode = 'project_directory' | 'dynamic_harness';
type WorkflowNodeType = 'agent' | 'fan_out' | 'join' | 'gate' | 'review' | 'reduce' | 'loop' | 'human_gate';
type WorkflowNodeRunStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'waiting_human'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'aborted'
  | 'recovering';
type WorkflowFailureAction = 'pause' | 'retry' | 'skip' | 'fail_run';
type WorkflowJoinMode = 'all' | 'minimum';
type WorkflowGateKind = 'completion' | 'artifact' | 'count' | 'schema' | 'llm';
type WorkflowEdgeCondition = 'always' | 'on_pass' | 'on_fail' | 'on_revise';
type WorkflowFanOutMode = 'fixed' | 'from_output';
type InteractionMode = 'ask' | 'plan' | 'run' | 'review';
type AgentClusterWorkflowScriptSourceType = 'planner' | 'project' | 'user';
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
  display?: 'visible' | 'silent';
  raw?: unknown;
  createdAt: string;
}

interface AgentClusterChildRun {
  agentId: string;
  workflowNodeId?: string;
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
  runtimeFailureKind?: AgentClusterRuntimeFailureKind;
  promptMode?: AgentClusterChildPromptMode;
  promptReason?: string;
  iteration?: number;
  outputRoot?: string;
  outputRelativeDir?: string;
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
  outputRoundStart?: number;
  status: 'idle' | 'running' | 'completed';
  updatedAt: string;
}

interface AgentClusterRun {
  runId: string;
  mode: AgentClusterRunMode;
  status: AgentClusterRunStatus;
  sessionKey: string;
  args?: Record<string, unknown>;
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
  workflowSnapshot?: AgentClusterWorkflow;
  scriptSnapshot?: AgentClusterWorkflowScript;
  nodeRuns?: WorkflowNodeRun[];
  resolvedInputsByNodeId?: Record<string, Record<string, unknown>>;
  phaseRuns?: WorkflowPhaseRun[];
  checkpoint?: WorkflowCheckpoint;
  harnessStatus?: 'running' | 'paused' | 'waiting_human' | 'completed' | 'failed' | 'aborted';
  pauseRequestedAt?: string;
  stopRequestedAt?: string;
  stoppedAt?: string;
}

interface AgentClusterWorkflowScript {
  source: string;
  sourceType: AgentClusterWorkflowScriptSourceType;
  version: number;
  hash: string;
  argsSchema?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
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
  runtimeContract?: AgentRuntimeContract;
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

interface WorkflowRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  failureAction: WorkflowFailureAction;
}

interface WorkflowInputContract {
  requiredNodeIds?: string[];
  requiredArtifacts?: string[];
  schema?: Record<string, unknown>;
}

type RuntimeArtifactMatchPolicy = 'literal' | 'glob' | 'one_or_more';

interface RuntimeArtifactSpec {
  path: string;
  match?: RuntimeArtifactMatchPolicy;
  fresh?: boolean;
}

type RuntimeArtifactRef = string | RuntimeArtifactSpec;

interface WorkflowOutputContract {
  requiredArtifacts?: RuntimeArtifactRef[];
  optionalArtifacts?: RuntimeArtifactRef[];
  auditArtifacts?: RuntimeArtifactRef[];
  minimumCount?: number;
  schema?: Record<string, unknown>;
}

interface AgentRuntimeContract {
  agentName?: string;
  promptPath?: string;
  canonicalOutputDir?: string;
  requiredArtifacts?: RuntimeArtifactRef[];
  optionalArtifacts?: RuntimeArtifactRef[];
  auditArtifacts?: RuntimeArtifactRef[];
  stableCommand?: string | string[];
  normalPathPolicy?: string[];
  troubleshootingPolicy?: string[];
}

interface ProjectRuntimeContract {
  schemaVersion?: number;
  summary?: string;
  agents?: AgentRuntimeContract[];
}

interface WorkflowNodeBase {
  nodeId: string;
  type: WorkflowNodeType;
  name: string;
  description?: string;
  x?: number;
  y?: number;
  timeoutMs?: number;
  retryPolicy?: WorkflowRetryPolicy;
  inputContract?: WorkflowInputContract;
  outputContract?: WorkflowOutputContract;
}

interface WorkflowAgentNode extends WorkflowNodeBase {
  type: 'agent' | 'review' | 'reduce';
  agentId: string;
  reviewTargetNodeIds?: string[];
  reviseTargetNodeId?: string;
}

interface WorkflowFanOutNode extends WorkflowNodeBase {
  type: 'fan_out';
  concurrency: number;
  fanOutMode?: WorkflowFanOutMode;
  itemsPath?: string;
  itemInputName?: string;
}

interface WorkflowJoinNode extends WorkflowNodeBase {
  type: 'join';
  mode: WorkflowJoinMode;
  minimumSuccess?: number;
}

interface WorkflowGateNode extends WorkflowNodeBase {
  type: 'gate';
  gateKind: WorkflowGateKind;
  minimumCount?: number;
  evaluationPrompt?: string;
  modelId?: string;
  lastEvaluation?: {
    verdict: 'pass' | 'fail' | 'revise';
    reason: string;
    nextAction?: string;
    confidence?: number;
    evaluatedAt: string;
  };
}

interface WorkflowLoopNode extends WorkflowNodeBase {
  type: 'loop';
  bodyNodeIds: string[];
  repeatCount: number;
  exitGateNodeId?: string;
}

interface WorkflowHumanGateNode extends WorkflowNodeBase {
  type: 'human_gate';
  prompt: string;
}

type WorkflowNode =
  | WorkflowAgentNode
  | WorkflowFanOutNode
  | WorkflowJoinNode
  | WorkflowGateNode
  | WorkflowLoopNode
  | WorkflowHumanGateNode;

interface WorkflowEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: 'control' | 'data';
  label?: string;
  condition?: WorkflowEdgeCondition;
  dataMapping?: WorkflowDataMapping[];
}

interface WorkflowPolicy {
  maxConcurrency: number;
  defaultTimeoutMs: number;
  defaultRetryPolicy: WorkflowRetryPolicy;
}

interface AgentClusterWorkflow {
  workflowId: string;
  version: number;
  status: AgentClusterWorkflowStatus;
  createdBy: 'planner' | 'manager' | 'user' | 'migration';
  layoutMode?: 'manual';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  policy: WorkflowPolicy;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}

interface WorkflowNodeRun {
  nodeId: string;
  status: WorkflowNodeRunStatus;
  attempt: number;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  waitingReason?: string;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
}

interface WorkflowDataMapping {
  source: string;
  target: string;
  optional?: boolean;
}

interface WorkflowPhaseRun {
  phaseId: string;
  name: string;
  nodeIds: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting';
  agentCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  retryCount: number;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
}

interface WorkflowCheckpoint {
  checkpointId: string;
  runId: string;
  workflowId: string;
  workflowVersion: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  nodeRuns: WorkflowNodeRun[];
  createdAt: string;
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
  runtimeContract?: AgentRuntimeContract;
}

interface AgentClusterManagerAgentPromptUpdate extends AgentClusterManagerAgentDraft {
  targetAgentId: string;
  targetAgentName?: string;
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

interface AgentClusterManagerWorkflowNodeDraft {
  type: 'fan_out' | 'join' | 'gate' | 'loop' | 'human_gate';
  name: string;
  description?: string;
  upstreamAgentNames?: string[];
  downstreamAgentNames?: string[];
  concurrency?: number;
  joinMode?: WorkflowJoinMode;
  minimumSuccess?: number;
  gateKind?: WorkflowGateKind;
  minimumCount?: number;
  evaluationPrompt?: string;
  modelId?: string;
  repeatCount?: number;
  prompt?: string;
}

interface AgentClusterManagerProposal {
  proposalId: string;
  kind?: 'manager_instruction' | 'project_prompt_sync';
  reply: string;
  sourceInstruction: string;
  promptPatches: AgentClusterManagerPromptPatchDraft[];
  agentPromptUpdates?: AgentClusterManagerAgentPromptUpdate[];
  agentDrafts: AgentClusterManagerAgentDraft[];
  edgeDrafts: AgentClusterManagerEdgeDraft[];
  workflowNodeDrafts?: AgentClusterManagerWorkflowNodeDraft[];
  sharedContextSummary?: string;
  recommendedResumeFromAgentId?: string | null;
  recommendedResumeFromAgentName?: string | null;
  runDecision?: string;
  status: AgentClusterManagerProposalStatus;
  createdAt: string;
  appliedAt?: string;
  dismissedAt?: string;
}

interface AgentClusterWorkflowTemplate {
  templateId: string;
  name: string;
  description?: string;
  workflow: AgentClusterWorkflow;
  defaultArgs?: Record<string, unknown>;
  argsSchema?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ClusterContext {
  globalGoal: string;
  originalInput: string;
  decompositionPlan: string | Record<string, unknown>;
  constraints: string[];
  facts: string[];
  projectContractSummary?: string;
  projectBackground?: string;
  historicalNotes?: string[];
  currentRunContext?: string;
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
  runtimeMode?: AgentClusterRuntimeMode;
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
  workflows?: AgentClusterWorkflow[];
  currentWorkflowId?: string | null;
  workflowTemplates?: AgentClusterWorkflowTemplate[];
  workflowScript?: AgentClusterWorkflowScript;
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
  requestId?: string;
  content: string;
  interactionMode?: InteractionMode;
  baseModel?: AgentClusterBaseModelInput;
  baseProviderAccountId?: string;
}

export interface StartAgentClusterRunInput {
  args?: Record<string, unknown>;
  templateId?: string;
  interactionMode?: InteractionMode;
}

export interface UpdateAgentClusterWorkflowScriptInput {
  source: string;
  argsSchema?: Record<string, unknown>;
}

export interface CreateAgentClusterAgentInput {
  name: string;
  role: string;
  description?: string;
  systemPrompt?: string;
  responsibilities?: string[];
  tools?: string[];
  capabilities?: string[];
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FOLDER_FILE_BYTES = 512 * 1024;
const DEFAULT_GLM_BASE_URL = 'http://117.50.195.92:8080/gpt-oss-120b/glm5.1/v1';
const DEFAULT_GLM_MODEL = 'glm-5.1';
const RUN_TIMEOUT_MS = 45 * 60 * 1000;
const RUN_TIMEOUT_RECOVERY_MS = 30 * 60 * 1000;
const LLM_PLANNING_TIMEOUT_MS = 4 * 60 * 1000;
const LLM_MANAGER_TIMEOUT_MS = 2 * 60 * 1000;
const RUN_WATCHDOG_INTERVAL_MS = 5 * 1000;
const CHILD_NO_EVENT_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_AFTER_GATEWAY_RESTART_GRACE_MS = 10 * 1000;
const DEFAULT_WORKFLOW_CONCURRENCY = 4;
const MAX_WORKFLOW_LOOP_COUNT = 20;

function hashWorkflowScriptSource(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function normalizeWorkflowScript(
  script: AgentClusterWorkflowScript | undefined,
  now = new Date().toISOString(),
): AgentClusterWorkflowScript | undefined {
  if (!script?.source?.trim()) return undefined;
  const source = script.source.trim();
  const sourceType: AgentClusterWorkflowScriptSourceType =
    script.sourceType === 'project' || script.sourceType === 'user' || script.sourceType === 'planner'
      ? script.sourceType
      : 'planner';
  const normalized: AgentClusterWorkflowScript = {
    source,
    sourceType,
    version: Math.max(1, Math.floor(Number(script.version) || 1)),
    hash: script.hash || hashWorkflowScriptSource(source),
    argsSchema: script.argsSchema && typeof script.argsSchema === 'object' && !Array.isArray(script.argsSchema)
      ? script.argsSchema
      : undefined,
    createdAt: script.createdAt || now,
    updatedAt: script.updatedAt || now,
    confirmedAt: script.confirmedAt,
  };
  return normalized;
}

function getStorePath(): string {
  return join(app.getPath('userData'), 'agent-clusters.json');
}

let storeQueue: Promise<unknown> = Promise.resolve();
const creationStatuses = new Map<string, AgentClusterCreationStatus>();
const creationAbortControllers = new Map<string, AbortController>();
const managerAbortControllers = new Map<string, AbortController>();
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

function abortCreationStatus(
  requestId: string,
  listener?: CreationStatusListener,
): AgentClusterCreationStatus {
  const now = new Date().toISOString();
  const status = creationStatuses.get(requestId) ?? createCreationStatus(requestId);
  status.status = 'aborted';
  status.error = '已终止创建';
  status.updatedAt = now;
  status.completedAt = now;
  status.stages = status.stages.map((stage) => stage.status === 'running'
    ? {
        ...stage,
        status: 'error',
        detail: '已终止',
        error: '已终止创建',
        completedAt: now,
      }
    : stage);
  creationStatuses.set(requestId, status);
  listener?.(status);
  setTimeout(() => creationStatuses.delete(requestId), 10 * 60 * 1000).unref?.();
  return status;
}

export function getAgentClusterCreationStatus(requestId: string): AgentClusterCreationStatus | null {
  return creationStatuses.get(requestId) ?? null;
}

export function abortAgentClusterCreation(requestId: string): AgentClusterCreationStatus {
  const controller = creationAbortControllers.get(requestId);
  controller?.abort();
  creationAbortControllers.delete(requestId);
  return abortCreationStatus(requestId);
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

function defaultWorkflowPolicy(): WorkflowPolicy {
  return {
    maxConcurrency: DEFAULT_WORKFLOW_CONCURRENCY,
    defaultTimeoutMs: RUN_TIMEOUT_MS,
    defaultRetryPolicy: {
      maxAttempts: 2,
      backoffMs: 1_000,
      failureAction: 'pause',
    },
  };
}

function workflowAgentNodeId(agentId: string): string {
  return `agent:${agentId}`;
}

function workflowNodeIsAgent(node: WorkflowNode): node is WorkflowAgentNode {
  return node.type === 'agent' || node.type === 'review' || node.type === 'reduce';
}

function normalizeContractArtifactPath(value: string, options: { allowGlob?: boolean } = {}): string | null {
  const cleaned = value
    .trim()
    .replace(/^["'`]+|["'`.,;，。；：:]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '');
  if (!cleaned || (!options.allowGlob && cleaned.includes('*'))) return null;
  const withoutExperimentRoot = cleaned.replace(/^experiment_results\/<run_root>\//i, '');
  if (withoutExperimentRoot.startsWith('../') || withoutExperimentRoot.startsWith('/')) return null;
  return withoutExperimentRoot;
}

function normalizeRuntimeArtifactTemplate(value: string, options: { allowGlob?: boolean } = {}): string | null {
  const normalized = normalizeContractArtifactPath(value, options);
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return null;
  return normalized;
}

function normalizeRuntimeArtifactMatch(value: unknown): RuntimeArtifactMatchPolicy | undefined {
  if (value === 'literal' || value === 'glob' || value === 'one_or_more') return value;
  return undefined;
}

function normalizeRuntimeArtifactRef(value: unknown): RuntimeArtifactRef | null {
  if (typeof value === 'string') return normalizeRuntimeArtifactTemplate(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.path !== 'string') return null;
  const match = normalizeRuntimeArtifactMatch(record.match);
  const path = normalizeRuntimeArtifactTemplate(record.path, { allowGlob: match === 'glob' || match === 'one_or_more' });
  if (!path) return null;
  if (path.includes('*') && !match) return null;
  return {
    path,
    ...(match ? { match } : {}),
    ...(typeof record.fresh === 'boolean' ? { fresh: record.fresh } : {}),
  };
}

function normalizeRuntimeArtifactList(values: unknown): RuntimeArtifactRef[] {
  const raw = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];
  return raw
    .map(normalizeRuntimeArtifactRef)
    .filter((value): value is RuntimeArtifactRef => Boolean(value));
}

function normalizeStableCommand(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function normalizeAgentRuntimeContract(value: unknown): AgentRuntimeContract | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const requiredArtifacts = normalizeRuntimeArtifactList(record.requiredArtifacts);
  const optionalArtifacts = normalizeRuntimeArtifactList(record.optionalArtifacts);
  const auditArtifacts = normalizeRuntimeArtifactList(record.auditArtifacts);
  const contract: AgentRuntimeContract = {
    agentName: typeof record.agentName === 'string' ? record.agentName.trim() : undefined,
    promptPath: typeof record.promptPath === 'string' ? record.promptPath.trim().replace(/\\/g, '/') : undefined,
    canonicalOutputDir: typeof record.canonicalOutputDir === 'string'
      ? normalizeRuntimeArtifactTemplate(record.canonicalOutputDir) ?? undefined
      : undefined,
    requiredArtifacts,
    optionalArtifacts,
    auditArtifacts,
    stableCommand: normalizeStableCommand(record.stableCommand),
    normalPathPolicy: coerceStringArray(record.normalPathPolicy).slice(0, 8),
    troubleshootingPolicy: coerceStringArray(record.troubleshootingPolicy).slice(0, 8),
  };
  return contract.agentName || contract.promptPath || requiredArtifacts.length > 0 || optionalArtifacts.length > 0 || auditArtifacts.length > 0
    ? contract
    : null;
}

function parseProjectRuntimeContract(content: string): ProjectRuntimeContract | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const agents = Array.isArray(record.agents)
      ? record.agents.map(normalizeAgentRuntimeContract).filter((item): item is AgentRuntimeContract => Boolean(item))
      : [];
    return {
      schemaVersion: Number.isFinite(Number(record.schemaVersion)) ? Number(record.schemaVersion) : undefined,
      summary: typeof record.summary === 'string' ? compactText(record.summary, 500) : undefined,
      agents,
    };
  } catch {
    return null;
  }
}

function extractRuntimeContractFromSource(sourceContent: string): ProjectRuntimeContract | null {
  const sections = parseSourceSections(sourceContent);
  const section = sections.find((item) =>
    /^(?:agents\/runtime_contract|investclaw\.runtime)\.json$/i.test(item.path)
  );
  return section ? parseProjectRuntimeContract(section.content) : null;
}

function runtimeContractForAgentDefinition(
  contract: ProjectRuntimeContract | null,
  definition: SourceAgentDefinition,
): AgentRuntimeContract | undefined {
  if (!contract?.agents?.length) return undefined;
  const definitionName = normalizeAgentNameForMatch(definition.name);
  return contract.agents.find((item) => item.promptPath && item.promptPath.replace(/\\/g, '/').toLowerCase() === definition.path.toLowerCase())
    ?? contract.agents.find((item) => item.agentName && normalizeAgentNameForMatch(item.agentName) === definitionName)
    ?? contract.agents.find((item) => item.agentName && (
      definitionName.includes(normalizeAgentNameForMatch(item.agentName))
      || normalizeAgentNameForMatch(item.agentName).includes(definitionName)
    ));
}

function isProjectInstructionArtifact(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)(?:readme|handoff|agents?\.md|shared_agent_contract)\.md$/.test(normalized)
    || /^agents\/tools\/[^/]+\.md$/.test(normalized)
    || /^skills\/[^/]+\/skill\.md$/.test(normalized);
}

function runtimeArtifactPath(artifact: RuntimeArtifactRef): string {
  return typeof artifact === 'string' ? artifact : artifact.path;
}

function runtimeArtifactLabel(artifact: RuntimeArtifactRef): string {
  const path = runtimeArtifactPath(artifact);
  if (typeof artifact === 'string' || !artifact.match || artifact.match === 'literal') return path;
  return `${path} (${artifact.match})`;
}

function sanitizeRuntimeArtifactRefs(values: unknown): RuntimeArtifactRef[] {
  const raw = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];
  return raw
    .map(normalizeRuntimeArtifactRef)
    .filter((artifact): artifact is RuntimeArtifactRef => Boolean(artifact))
    .filter((artifact) => !isProjectInstructionArtifact(runtimeArtifactPath(artifact)));
}

type RuntimeArtifactSectionKind = 'required' | 'optional' | 'audit';

function extractOutputArtifactSections(prompt: string, kind: RuntimeArtifactSectionKind): Array<{ text: string; prefixBareNames: boolean }> {
  const markerMap: Record<RuntimeArtifactSectionKind, Array<{ pattern: RegExp; prefixBareNames: boolean }>> = {
    required: [
      { pattern: /Runtime Required Artifacts\s*[：:]?/gi, prefixBareNames: false },
      { pattern: /Completion Required Artifacts\s*[：:]?/gi, prefixBareNames: false },
      { pattern: /Required Artifacts\s*[：:]?/gi, prefixBareNames: false },
    ],
    optional: [
      { pattern: /Runtime Optional Artifacts\s*[：:]?/gi, prefixBareNames: false },
      { pattern: /Optional Artifacts\s*[：:]?/gi, prefixBareNames: false },
    ],
    audit: [
      { pattern: /Runtime Audit Artifacts\s*[：:]?/gi, prefixBareNames: false },
      { pattern: /Audit Artifacts\s*[：:]?/gi, prefixBareNames: false },
    ],
  };
  const markers = [
    ...markerMap[kind],
  ];
  const sections: Array<{ text: string; prefixBareNames: boolean }> = [];

  for (const marker of markers) {
    marker.pattern.lastIndex = 0;
    for (const match of prompt.matchAll(marker.pattern)) {
      const start = (match.index ?? 0) + match[0].length;
      const afterMarker = prompt.slice(start, start + 2200);
      const codeBlock = afterMarker.match(/```(?:text|bash|json)?\s*([\s\S]*?)```/i)?.[1];
      const text = codeBlock ?? afterMarker.split(/\n##\s+/)[0] ?? '';
      if (text.trim()) {
        sections.push({ text, prefixBareNames: marker.prefixBareNames });
      }
    }
  }

  return sections;
}

function extractOutputArtifactsFromPrompt(prompt: string, kind: RuntimeArtifactSectionKind): string[] {
  const sections = extractOutputArtifactSections(prompt, kind);
  const sourceSections = sections;
  const seen = new Set<string>();
  const artifacts: string[] = [];

  for (const section of sourceSections) {
    for (const match of section.text.matchAll(/[A-Za-z0-9._<>/-]+\.(?:jsonl?|csv|md|parquet|txt|html)/gi)) {
      const rawArtifact = normalizeContractArtifactPath(match[0]);
      if (!rawArtifact) continue;
      if (isProjectInstructionArtifact(rawArtifact)) continue;
      const artifact = rawArtifact;
      const normalized = artifact.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      artifacts.push(artifact);
    }
  }

  return artifacts;
}

function defaultAgentOutputContract(agent: ClusterAgent): WorkflowOutputContract | undefined {
  const contract = agent.runtimeContract;
  if (contract?.requiredArtifacts?.length || contract?.optionalArtifacts?.length || contract?.auditArtifacts?.length) {
    return {
      requiredArtifacts: contract.requiredArtifacts,
      optionalArtifacts: contract.optionalArtifacts,
      auditArtifacts: contract.auditArtifacts,
    };
  }
  const requiredArtifacts = extractOutputArtifactsFromPrompt(agent.systemPrompt, 'required');
  const optionalArtifacts = extractOutputArtifactsFromPrompt(agent.systemPrompt, 'optional');
  const auditArtifacts = extractOutputArtifactsFromPrompt(agent.systemPrompt, 'audit');
  if (requiredArtifacts.length === 0 && optionalArtifacts.length === 0 && auditArtifacts.length === 0) return undefined;
  return {
    requiredArtifacts,
    optionalArtifacts,
    auditArtifacts,
  };
}

function sanitizeWorkflowNodeOutputContract<T extends WorkflowNode>(node: T, agent?: ClusterAgent): T {
  if (!workflowNodeIsAgent(node) || !agent || !node.outputContract) return node;
  const requiredArtifacts = sanitizeRuntimeArtifactRefs(node.outputContract.requiredArtifacts);
  const optionalArtifacts = sanitizeRuntimeArtifactRefs(node.outputContract.optionalArtifacts);
  const auditArtifacts = sanitizeRuntimeArtifactRefs(node.outputContract.auditArtifacts);
  return {
    ...node,
    outputContract: {
      ...node.outputContract,
      requiredArtifacts,
      optionalArtifacts,
      auditArtifacts,
    },
  };
}

function inferWorkflowAgentNodeType(agent: ClusterAgent, incomingEdges: AgentEdge[]): WorkflowAgentNode['type'] {
  const identity = `${agent.name} ${agent.role}`.toLowerCase();
  if (
    incomingEdges.some((edge) => normalizeExecutionType(edge) === 'reviews')
    && /review|audit|审查|审核/.test(identity)
  ) return 'review';
  if (incomingEdges.length > 1 || /reduce|synth|汇总|综合|dad|总工/.test(identity)) return 'reduce';
  return 'agent';
}

export function buildWorkflowFromExecutionGraph(
  clusterId: string,
  agents: ClusterAgent[],
  graph: AgentClusterExecutionGraph,
  createdBy: AgentClusterWorkflow['createdBy'],
  version = 1,
  now = new Date().toISOString(),
): AgentClusterWorkflow {
  const blockingEdges = graph.edges.filter(isBlockingExecutionEdge);
  const incomingByAgent = new Map<string, AgentEdge[]>();
  for (const agent of agents) incomingByAgent.set(agent.agentId, []);
  for (const edge of blockingEdges) {
    incomingByAgent.get(edge.toAgentId)?.push(edge);
  }

  const nodes: WorkflowNode[] = agents.map((agent) => ({
    nodeId: workflowAgentNodeId(agent.agentId),
    type: inferWorkflowAgentNodeType(agent, incomingByAgent.get(agent.agentId) ?? []),
    name: agent.name,
    description: agent.description,
    agentId: agent.agentId,
    x: graph.nodes.find((node) => node.agentId === agent.agentId)?.x,
    y: graph.nodes.find((node) => node.agentId === agent.agentId)?.y,
    retryPolicy: defaultWorkflowPolicy().defaultRetryPolicy,
    outputContract: defaultAgentOutputContract(agent),
  }));
  const edges: WorkflowEdge[] = [];

  const rootAgentIds = agents
    .filter((agent) => (incomingByAgent.get(agent.agentId)?.length ?? 0) === 0)
    .map((agent) => agent.agentId);
  if (rootAgentIds.length > 1) {
    const fanOutId = `fan-out:${clusterId}`;
    nodes.push({
      nodeId: fanOutId,
      type: 'fan_out',
      name: '并行分发',
      description: `并行启动 ${rootAgentIds.length} 个无阻塞上游的 Agent`,
      concurrency: DEFAULT_WORKFLOW_CONCURRENCY,
    });
    for (const agentId of rootAgentIds) {
      edges.push({
        edgeId: randomUUID(),
        fromNodeId: fanOutId,
        toNodeId: workflowAgentNodeId(agentId),
        kind: 'control',
      });
    }
  }

  for (const agent of agents) {
    const incoming = incomingByAgent.get(agent.agentId) ?? [];
    if (incoming.length === 0) continue;
    const targetNodeId = workflowAgentNodeId(agent.agentId);
    const joinNodeId = incoming.length > 1 ? `join:${agent.agentId}` : null;
    if (joinNodeId) {
      nodes.push({
        nodeId: joinNodeId,
        type: 'join',
        name: `${agent.name} 上游汇合`,
        description: `等待 ${incoming.length} 个阻塞上游全部完成`,
        mode: 'all',
      });
      edges.push({
        edgeId: randomUUID(),
        fromNodeId: joinNodeId,
        toNodeId: targetNodeId,
        kind: 'control',
      });
    }
    for (const edge of incoming) {
      const gateNodeId = `gate:${edge.edgeId}`;
      const upstream = agents.find((item) => item.agentId === edge.fromAgentId);
      nodes.push({
        nodeId: gateNodeId,
        type: 'gate',
        name: `${upstream?.name ?? '上游'} 完成验证`,
        description: edge.reason || '验证上游完成信号和约定产物',
        gateKind: 'completion',
        inputContract: {
          requiredNodeIds: [workflowAgentNodeId(edge.fromAgentId)],
        },
      });
      edges.push(
        {
          edgeId: randomUUID(),
          fromNodeId: workflowAgentNodeId(edge.fromAgentId),
          toNodeId: gateNodeId,
          kind: 'control',
          label: edge.executionType,
        },
        {
          edgeId: randomUUID(),
          fromNodeId: gateNodeId,
          toNodeId: joinNodeId ?? targetNodeId,
          kind: 'control',
        },
      );
    }
  }

  for (const edge of graph.edges.filter((item) => !isBlockingExecutionEdge(item))) {
    edges.push({
      edgeId: randomUUID(),
      fromNodeId: workflowAgentNodeId(edge.fromAgentId),
      toNodeId: workflowAgentNodeId(edge.toAgentId),
      kind: 'data',
      label: edge.executionType,
    });
  }

  for (const loop of graph.loops ?? []) {
    const bodyAgentIds = getBlockingPathAgentIds(
      {
        clusterId,
        agents,
        edges: graph.edges,
        executionGraph: graph,
      } as AgentCluster,
      loop.startAgentId,
      loop.endAgentId,
    );
    nodes.push({
      nodeId: `loop:${loop.loopId}`,
      type: 'loop',
      name: '循环',
      description: `${bodyAgentIds.length} 个 Agent 重复 ${loop.repeatCount} 轮`,
      bodyNodeIds: bodyAgentIds.map(workflowAgentNodeId),
      repeatCount: Math.min(MAX_WORKFLOW_LOOP_COUNT, loop.repeatCount),
    });
  }

  return normalizeAgentClusterWorkflow({
    workflowId: `workflow-${randomUUID()}`,
    version,
    status: 'draft',
    createdBy,
    nodes,
    edges,
    policy: defaultWorkflowPolicy(),
    createdAt: now,
    updatedAt: now,
  });
}

function workflowNodeIsAgentLikeForLoop(node: WorkflowNode | undefined): node is Extract<WorkflowNode, { type: 'agent' | 'review' | 'reduce' }> {
  return Boolean(node && (node.type === 'agent' || node.type === 'review' || node.type === 'reduce'));
}

function inferLoopBodyFromControlEdges(workflow: AgentClusterWorkflow, loop: WorkflowLoopNode): string[] {
  const nodeById = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
  const controlEdges = workflow.edges.filter((edge) => edge.kind === 'control');
  const outgoing = new Map<string, string[]>();
  for (const edge of controlEdges) {
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }
  const loopStarts = controlEdges
    .filter((edge) => edge.fromNodeId === loop.nodeId && edge.toNodeId !== loop.nodeId)
    .map((edge) => edge.toNodeId);
  const loopReturns = new Set(controlEdges
    .filter((edge) => edge.toNodeId === loop.nodeId && edge.fromNodeId !== loop.nodeId)
    .map((edge) => edge.fromNodeId));
  if (loopStarts.length === 0 || loopReturns.size === 0) return [];

  const candidateBodies: string[][] = [];
  for (const startNodeId of loopStarts) {
    const queue: Array<{ nodeId: string; path: string[]; agents: string[] }> = [{
      nodeId: startNodeId,
      path: [loop.nodeId],
      agents: [],
    }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.includes(current.nodeId)) continue;
      const node = nodeById.get(current.nodeId);
      const agents = workflowNodeIsAgentLikeForLoop(node) && !current.agents.includes(current.nodeId)
        ? [...current.agents, current.nodeId]
        : current.agents;
      if (loopReturns.has(current.nodeId) && agents.length > 0) {
        candidateBodies.push(agents);
        continue;
      }
      if (current.path.length > workflow.nodes.length + 1) continue;
      for (const nextNodeId of outgoing.get(current.nodeId) ?? []) {
        if (nextNodeId === loop.nodeId) continue;
        queue.push({ nodeId: nextNodeId, path: [...current.path, current.nodeId], agents });
      }
    }
  }

  return candidateBodies
    .sort((a, b) => a.length - b.length || a.join('|').localeCompare(b.join('|')))[0] ?? [];
}

export function getOrderedWorkflowLoopBodyNodeIds(workflow: AgentClusterWorkflow, loop: WorkflowLoopNode): string[] {
  const bodyNodeIds = loop.bodyNodeIds.length > 0
    ? loop.bodyNodeIds
    : inferLoopBodyFromControlEdges(workflow, loop);
  if (bodyNodeIds.length <= 1) return bodyNodeIds;

  const bodySet = new Set(bodyNodeIds);
  const fallbackIndex = new Map(bodyNodeIds.map((nodeId, index) => [nodeId, index]));
  const nodeById = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges.filter((item) => item.kind === 'control')) {
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }

  const bodyOutgoing = new Map<string, Set<string>>();
  const bodyIncomingCount = new Map<string, number>();
  for (const nodeId of bodyNodeIds) {
    bodyOutgoing.set(nodeId, new Set());
    bodyIncomingCount.set(nodeId, 0);
  }

  for (const startNodeId of bodyNodeIds) {
    const queue = [...(outgoing.get(startNodeId) ?? [])];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      if (bodySet.has(nodeId)) {
        if (nodeId !== startNodeId && !bodyOutgoing.get(startNodeId)?.has(nodeId)) {
          bodyOutgoing.get(startNodeId)?.add(nodeId);
          bodyIncomingCount.set(nodeId, (bodyIncomingCount.get(nodeId) ?? 0) + 1);
        }
        continue;
      }
      const node = nodeById.get(nodeId);
      if (!node || workflowNodeIsAgentLikeForLoop(node)) continue;
      queue.push(...(outgoing.get(nodeId) ?? []));
    }
  }

  const queue = bodyNodeIds
    .filter((nodeId) => (bodyIncomingCount.get(nodeId) ?? 0) === 0)
    .sort((a, b) => (fallbackIndex.get(a) ?? 0) - (fallbackIndex.get(b) ?? 0));
  const ordered: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    ordered.push(nodeId);
    const nextIds = [...(bodyOutgoing.get(nodeId) ?? [])]
      .sort((a, b) => (fallbackIndex.get(a) ?? 0) - (fallbackIndex.get(b) ?? 0));
    for (const nextId of nextIds) {
      const nextIncoming = (bodyIncomingCount.get(nextId) ?? 1) - 1;
      bodyIncomingCount.set(nextId, nextIncoming);
      if (nextIncoming === 0) queue.push(nextId);
    }
  }

  return ordered.length === bodyNodeIds.length ? ordered : bodyNodeIds;
}

export function normalizeAgentClusterWorkflow(workflow: AgentClusterWorkflow): AgentClusterWorkflow {
  const normalizedNodes = workflow.nodes.map((node) => {
    if (node.type !== 'loop') return node;
    const bodyNodeIds = getOrderedWorkflowLoopBodyNodeIds(workflow, node);
    return { ...node, bodyNodeIds };
  });
  const retainedNodeIds = new Set(normalizedNodes
    .filter((node) => node.type !== 'loop' || node.bodyNodeIds.length > 0)
    .map((node) => node.nodeId));
  return {
    ...workflow,
    nodes: normalizedNodes.filter((node) => retainedNodeIds.has(node.nodeId)),
    edges: workflow.edges.filter((edge) => retainedNodeIds.has(edge.fromNodeId) && retainedNodeIds.has(edge.toNodeId)),
  };
}

export function getWorkflowDisplayEdges(workflow: AgentClusterWorkflow, options: { includeDataEdges?: boolean } = {}): WorkflowEdge[] {
  if (options.includeDataEdges) return workflow.edges;
  return workflow.edges.filter((edge) => edge.kind === 'control');
}

function normalizeWorkflow(cluster: AgentCluster, workflow: AgentClusterWorkflow): AgentClusterWorkflow {
  const agentIds = new Set(cluster.agents.map((agent) => agent.agentId));
  const agentById = new Map(cluster.agents.map((agent) => [agent.agentId, agent]));
  const seenNodeIds = new Set<string>();
  const nodes = (Array.isArray(workflow.nodes) ? workflow.nodes : [])
    .filter((node) => {
      if (!node?.nodeId || seenNodeIds.has(node.nodeId)) return false;
      if (workflowNodeIsAgent(node) && !agentIds.has(node.agentId)) return false;
      seenNodeIds.add(node.nodeId);
      return true;
    })
    .map((node) => {
      if (node.type === 'fan_out') {
        return {
          ...node,
          concurrency: Math.max(1, Math.min(16, Math.floor(node.concurrency || DEFAULT_WORKFLOW_CONCURRENCY))),
          fanOutMode: node.fanOutMode === 'from_output' ? 'from_output' as const : 'fixed' as const,
          itemsPath: node.itemsPath?.trim() || undefined,
          itemInputName: node.itemInputName?.trim() || undefined,
        };
      }
      if (node.type === 'loop') {
        return { ...node, repeatCount: Math.max(1, Math.min(MAX_WORKFLOW_LOOP_COUNT, Math.floor(node.repeatCount || 1))) };
      }
      if (node.type === 'join') {
        return {
          ...node,
          mode: node.mode === 'minimum' ? 'minimum' as const : 'all' as const,
          minimumSuccess: node.mode === 'minimum' ? Math.max(1, Math.floor(node.minimumSuccess || 1)) : undefined,
        };
      }
      if (node.type === 'review') {
        const agent = agentById.get(node.agentId);
        const identity = `${agent?.name ?? node.name} ${agent?.role ?? ''}`.toLowerCase();
        const isEvaluationAgent = /evaluation|evaluator|评估/.test(identity);
        const isExplicitReviewer = /review|reviewer|审查|审核/.test(identity);
        if (isEvaluationAgent && !isExplicitReviewer && !node.reviewTargetNodeIds?.length && !node.reviseTargetNodeId) {
          return { ...node, type: 'agent' as const };
        }
      }
      if (workflowNodeIsAgent(node)) {
        return sanitizeWorkflowNodeOutputContract(node, agentById.get(node.agentId));
      }
      return node;
    });
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const edgeKeys = new Set<string>();
  const edges = (Array.isArray(workflow.edges) ? workflow.edges : [])
    .filter((edge) => {
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId) || edge.fromNodeId === edge.toNodeId) return false;
      const key = `${edge.fromNodeId}:${edge.toNodeId}:${edge.kind}`;
      if (edgeKeys.has(key)) return false;
      edgeKeys.add(key);
      return true;
    })
    .map((edge) => ({
      ...edge,
      edgeId: edge.edgeId || randomUUID(),
      kind: edge.kind === 'data' ? 'data' as const : 'control' as const,
      condition: edge.condition === 'on_pass' || edge.condition === 'on_fail' || edge.condition === 'on_revise'
        ? edge.condition
        : 'always' as const,
      dataMapping: Array.isArray(edge.dataMapping)
        ? edge.dataMapping
          .map((mapping) => ({
            source: String(mapping.source ?? '').trim(),
            target: String(mapping.target ?? '').trim(),
            optional: mapping.optional === true,
          }))
          .filter((mapping) => mapping.source && mapping.target)
        : undefined,
    }));
  return normalizeAgentClusterWorkflow({
    ...workflow,
    version: Math.max(1, Math.floor(workflow.version || 1)),
    status: workflow.status === 'confirmed' || workflow.status === 'archived' ? workflow.status : 'draft',
    layoutMode: workflow.layoutMode === 'manual' ? 'manual' : undefined,
    nodes,
    edges,
    policy: {
      ...defaultWorkflowPolicy(),
      ...(workflow.policy ?? {}),
      maxConcurrency: Math.max(1, Math.min(16, Math.floor(workflow.policy?.maxConcurrency || DEFAULT_WORKFLOW_CONCURRENCY))),
    },
  });
}

function getCurrentWorkflow(cluster: AgentCluster): AgentClusterWorkflow {
  const workflows = cluster.workflows ?? [];
  const selected = workflows.find((workflow) => workflow.workflowId === cluster.currentWorkflowId)
    ?? workflows.find((workflow) => workflow.status === 'confirmed')
    ?? workflows[0];
  if (selected) return selected;
  return buildWorkflowFromExecutionGraph(
    cluster.clusterId,
    cluster.agents,
    normalizeExecutionGraph(cluster),
    'migration',
    1,
    cluster.updatedAt,
  );
}

function assertWorkflowValid(cluster: AgentCluster, workflow: AgentClusterWorkflow): void {
  const normalized = normalizeWorkflow(cluster, workflow);
  const nodeIds = new Set(normalized.nodes.map((node) => node.nodeId));
  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) adjacency.set(nodeId, []);
  for (const edge of normalized.edges) {
    if (edge.kind === 'control') adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new Error('Workflow 控制边存在环路，请使用 Loop 节点表达循环');
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) visit(next);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodeIds) visit(nodeId);
  for (const node of normalized.nodes) {
    if (node.type === 'loop') {
      if (node.bodyNodeIds.length === 0) throw new Error(`Loop 节点 ${node.name} 尚未选择循环主体`);
      if (node.bodyNodeIds.some((nodeId) => !nodeIds.has(nodeId))) {
        throw new Error(`Loop 节点 ${node.name} 引用了不存在的节点`);
      }
    }
    if (node.type === 'join' && node.mode === 'minimum') {
      const incoming = normalized.edges.filter((edge) => edge.kind === 'control' && edge.toNodeId === node.nodeId).length;
      if ((node.minimumSuccess ?? 1) > incoming) throw new Error(`Join 节点 ${node.name} 的最少成功数超过上游数量`);
    }
  }
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

function terminalRunStatus(status: AgentClusterRunStatus): boolean {
  return status === 'completed' || status === 'error' || status === 'aborted' || status === 'timeout';
}

function terminalRunAgentDisplay(run: AgentClusterRun | undefined, agent: ClusterAgent): Partial<ClusterAgent> | null {
  if (!run || !terminalRunStatus(run.status)) return null;
  const child = run.childRuns?.find((item) => item.agentId === agent.agentId);
  if (!child) return null;

  if (child.status === 'completed') {
    return {
      status: 'done',
      currentTask: child.runtimeWaitReason ?? agent.currentTask ?? '子会话已完成',
      runtimeStatusReason: child.completionSource === 'fallback' ? '自动识别完成' : '结构化完成信号',
      lastActivityAt: child.completedAt ?? child.lastEventAt ?? child.updatedAt ?? agent.lastActivityAt,
    };
  }

  if (run.status === 'aborted') {
    return {
      status: 'idle',
      currentTask: '运行已停止',
      runtimeStatusReason: '运行已停止',
      lastActivityAt: child.updatedAt ?? agent.lastActivityAt,
    };
  }

  if (child.status === 'blocked' || child.submitStatus === 'pending') {
    return {
      status: 'waiting',
      currentTask: child.runtimeWaitReason ?? '上游未完成，未启动',
      runtimeStatusReason: run.status === 'timeout' ? '运行已超时' : '上游阻塞',
      lastActivityAt: child.updatedAt ?? agent.lastActivityAt,
    };
  }

  if (run.status === 'completed') {
    return {
      status: 'done',
      currentTask: child.runtimeWaitReason ?? '子会话已结束',
      runtimeStatusReason: '运行已完成',
      lastActivityAt: child.completedAt ?? child.lastEventAt ?? child.updatedAt ?? agent.lastActivityAt,
    };
  }

  return {
    status: 'error',
    currentTask: child.error
      ?? child.runtimeWaitReason
      ?? (run.status === 'timeout' ? '运行已超时，子会话未完成' : '运行失败，子会话未完成'),
    runtimeStatusReason: run.status === 'timeout' ? '运行超时' : '运行失败',
    lastActivityAt: child.lastEventAt ?? child.updatedAt ?? agent.lastActivityAt,
  };
}

function applyTerminalRunAgentDisplay(cluster: AgentCluster, run: AgentClusterRun | undefined): void {
  if (!run || !terminalRunStatus(run.status)) return;
  for (const agent of cluster.agents) {
    const display = terminalRunAgentDisplay(run, agent);
    if (!display) continue;
    if (display.status) {
      agent.status = display.status;
      agent.localContext.status = display.status;
    }
    if (display.currentTask !== undefined) agent.currentTask = display.currentTask;
    if (display.runtimeStatusReason !== undefined) agent.runtimeStatusReason = display.runtimeStatusReason;
    if (display.lastActivityAt !== undefined) agent.lastActivityAt = display.lastActivityAt;
  }
}

function normalizeCluster(cluster: AgentCluster): AgentCluster {
  const normalizedEdges = (cluster.edges ?? []).map(normalizeEdge);
  const normalizedGraph = normalizeExecutionGraph({ ...cluster, edges: normalizedEdges });
  const sourceWorkflows = Array.isArray(cluster.workflows) && cluster.workflows.length > 0
    ? cluster.workflows
    : [buildWorkflowFromExecutionGraph(
      cluster.clusterId,
      cluster.agents ?? [],
      normalizedGraph,
      'migration',
      1,
      cluster.updatedAt,
    )];
  const normalizedWorkflows = sourceWorkflows.map((workflow) => normalizeWorkflow(cluster, workflow));
  const currentWorkflowId = normalizedWorkflows.some((workflow) => workflow.workflowId === cluster.currentWorkflowId)
    ? cluster.currentWorkflowId
    : normalizedWorkflows.find((workflow) => workflow.status === 'confirmed')?.workflowId ?? normalizedWorkflows[0]?.workflowId ?? null;
  const projectRoot = cluster.projectRoot
    ?? cluster.sourceFolderPath
    ?? (cluster.sourcePath ? dirname(cluster.sourcePath) : null);
  const normalized: AgentCluster = {
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
    workflows: normalizedWorkflows,
    currentWorkflowId,
    workflowScript: normalizeWorkflowScript(cluster.workflowScript, cluster.updatedAt),
    workflowTemplates: Array.isArray(cluster.workflowTemplates)
      ? cluster.workflowTemplates.map((template) => ({
        ...template,
        workflow: normalizeWorkflow(cluster, template.workflow),
        defaultArgs: template.defaultArgs && typeof template.defaultArgs === 'object' && !Array.isArray(template.defaultArgs)
          ? template.defaultArgs
          : undefined,
      }))
      : [],
    orchestrationConfirmedAt: cluster.orchestrationConfirmedAt ?? null,
    runs: Array.isArray(cluster.runs)
      ? cluster.runs.map((run) => ({
        ...run,
        args: run.args && typeof run.args === 'object' && !Array.isArray(run.args) ? run.args : {},
        resolvedInputsByNodeId: run.resolvedInputsByNodeId && typeof run.resolvedInputsByNodeId === 'object' && !Array.isArray(run.resolvedInputsByNodeId)
          ? run.resolvedInputsByNodeId
          : {},
        phaseRuns: Array.isArray(run.phaseRuns) ? run.phaseRuns : [],
        loopStates: Array.isArray(run.loopStates) ? run.loopStates.map((state) => ({
          loopId: state.loopId,
          currentIteration: Math.max(1, Math.floor(Number(state.currentIteration) || 1)),
          repeatCount: Math.max(1, Math.min(20, Math.floor(Number(state.repeatCount) || 1))),
          outputRoundStart: typeof state.outputRoundStart === 'number' && Number.isFinite(state.outputRoundStart) && state.outputRoundStart > 0
            ? Math.floor(state.outputRoundStart)
            : undefined,
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
        workflowSnapshot: run.workflowSnapshot ? normalizeWorkflow(cluster, run.workflowSnapshot) : undefined,
        scriptSnapshot: normalizeWorkflowScript(run.scriptSnapshot, run.updatedAt),
        nodeRuns: Array.isArray(run.nodeRuns) ? run.nodeRuns : [],
        harnessStatus: run.harnessStatus ?? (run.status === 'completed'
          ? 'completed'
          : run.status === 'aborted'
            ? 'aborted'
            : run.status === 'error' || run.status === 'timeout'
              ? 'failed'
              : 'running'),
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
      projectContractSummary: typeof cluster.sharedContext.projectContractSummary === 'string' ? cluster.sharedContext.projectContractSummary : undefined,
      projectBackground: typeof cluster.sharedContext.projectBackground === 'string' ? cluster.sharedContext.projectBackground : undefined,
      historicalNotes: Array.isArray(cluster.sharedContext.historicalNotes) ? cluster.sharedContext.historicalNotes : [],
      currentRunContext: typeof cluster.sharedContext.currentRunContext === 'string' ? cluster.sharedContext.currentRunContext : undefined,
      managerInstructions: Array.isArray(cluster.sharedContext.managerInstructions) ? cluster.sharedContext.managerInstructions : [],
      promptPatches: Array.isArray(cluster.sharedContext.promptPatches) ? cluster.sharedContext.promptPatches : [],
      runDecisions: Array.isArray(cluster.sharedContext.runDecisions) ? cluster.sharedContext.runDecisions : [],
      latestArtifacts: Array.isArray(cluster.sharedContext.latestArtifacts) ? cluster.sharedContext.latestArtifacts : [],
      managerProposals: Array.isArray(cluster.sharedContext.managerProposals) ? cluster.sharedContext.managerProposals : [],
    },
  };
  applyTerminalRunAgentDisplay(normalized, normalized.runs[0]);
  return normalized;
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

function textValue(text: unknown): string {
  if (typeof text === 'string') return text;
  if (text === null || typeof text === 'undefined') return '';
  try {
    return JSON.stringify(text);
  } catch {
    return String(text);
  }
}

export function compactText(text: unknown, max = 360): string {
  const raw = textValue(text);
  const normalized = raw.replace(/\s+/g, ' ').trim();
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

function createLinearBlockingEdges(agents: ClusterAgent[]): AgentEdge[] {
  const edges: AgentEdge[] = [];
  for (let index = 0; index < agents.length - 1; index += 1) {
    const from = agents[index];
    const to = agents[index + 1];
    edges.push({
      edgeId: randomUUID(),
      fromAgentId: from.agentId,
      toAgentId: to.agentId,
      relationType: 'depends_on',
      executionType: 'blocks',
      isBlocking: true,
      label: '顺序执行',
      reason: '项目目录模式未声明动态 workflow；按 runtime contract / agents 顺序执行。',
    });
  }
  return edges;
}

function buildProjectDirectoryEdges(plan: LlmClusterPlan, agents: ClusterAgent[]): AgentEdge[] {
  if (Array.isArray(plan.edges) && plan.edges.length > 0) {
    return buildEdgesFromPlan(plan, agents);
  }
  return createLinearBlockingEdges(agents);
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
  workflow?: {
    nodes?: Array<{
      key?: string;
      type?: WorkflowNodeType;
      name?: string;
      description?: string;
      agentName?: string;
      concurrency?: number;
      fanOutMode?: WorkflowFanOutMode;
      itemsPath?: string;
      itemInputName?: string;
      joinMode?: WorkflowJoinMode;
      minimumSuccess?: number;
	      gateKind?: WorkflowGateKind;
	      minimumCount?: number;
	      evaluationPrompt?: string;
	      modelId?: string;
	      bodyAgentNames?: string[];
      repeatCount?: number;
      prompt?: string;
      requiredArtifacts?: string[];
    }>;
    edges?: Array<{
      from?: string;
      to?: string;
      kind?: 'control' | 'data';
      label?: string;
      condition?: WorkflowEdgeCondition;
      dataMapping?: WorkflowDataMapping[];
    }>;
    policy?: Partial<WorkflowPolicy>;
  };
  workflowScript?: {
    source?: string;
    argsSchema?: Record<string, unknown>;
  } | string;
}

interface SourceSection {
  path: string;
  content: string;
}

interface SourceAgentDefinition {
  path: string;
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
  workflowNodeDrafts?: AgentClusterManagerWorkflowNodeDraft[];
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

interface LlmGateDecision {
  verdict?: 'pass' | 'fail' | 'revise';
  reason?: string;
  nextAction?: string;
  confidence?: number;
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
      path: section.path,
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

function buildPlanningSourceContent(sourceContent: string): string {
  const sections = parseSourceSections(sourceContent);
  const hasSourceAgents = sections.some((section) => /^agents\/[^/]+\.md$/i.test(section.path));
  if (!hasSourceAgents) return sourceContent;

  const parts: string[] = [];
  for (const section of sections) {
    const path = section.path;
    const lowerPath = path.toLowerCase();
    if (path === 'PROJECT_ROOT') {
      parts.push(`# Source: ${path}\n\n${section.content}`);
      continue;
    }
    if (/^agents\/[^/]+\.md$/i.test(path)) {
      parts.push(`# Source: ${path}\n\n${section.content.trim()}`);
      continue;
    }
    if (['readme.md', 'handoff.md'].includes(lowerPath)) {
      parts.push(`# Source: ${path}\n\n${compactText(section.content, 14_000)}`);
      continue;
    }
    if (/^skills\/[^/]+\/skill\.md$/i.test(path)) {
      parts.push(`# Source: ${path}\n\n${compactText(section.content, 3_000)}`);
      continue;
    }
    if (/manifest|context|routing|workflow|pipeline|agents|skills/i.test(path)) {
      parts.push(`# Source: ${path}\n\n${compactText(section.content, 2_400)}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n---\n\n') : sourceContent;
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
      return {
        baseUrl: baseModel.baseUrl?.trim() || account.baseUrl || vendorConfig?.baseUrl || DEFAULT_GLM_BASE_URL,
        model: baseModel.model?.trim() || account.model || vendorConfig?.models?.[0]?.id || DEFAULT_GLM_MODEL,
        apiKey: apiKey || 'investclaw-local',
        headers: account.headers ?? {},
      };
    }
  }
  const accountId = input.baseProviderAccountId || await providerService.getDefaultAccountId();
  if (!accountId) {
    return { baseUrl: DEFAULT_GLM_BASE_URL, model: DEFAULT_GLM_MODEL, apiKey: 'investclaw-local', headers: {} };
  }

  const account = await providerService.getAccount(accountId);
  if (!account || !account.enabled) {
    return { baseUrl: DEFAULT_GLM_BASE_URL, model: DEFAULT_GLM_MODEL, apiKey: 'investclaw-local', headers: {} };
  }

  const vendorConfig = getProviderConfig(account.vendorId);
  const apiKey = await providerService.getLegacyProviderApiKey(account.id);
  return {
    baseUrl: account.baseUrl || vendorConfig?.baseUrl || DEFAULT_GLM_BASE_URL,
    model: account.model || vendorConfig?.models?.[0]?.id || DEFAULT_GLM_MODEL,
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
    'JSON 字段：globalGoal, decompositionPlan, constraints, facts, openQuestions, agents, edges, workflow, workflowScript。',
    'agents 每项包含 name, role, description, responsibilities, systemPrompt, tools, capabilities。',
    'edges 每项包含 fromAgentName, toAgentName, relationType(depends_on/reviews/delegates_to/reports_to/collaborates_with), executionType(blocks/informs/reviews/reports_to/writes_to_memory), isBlocking, label, reason。',
    '只有 executionType=blocks 或 reviews 表示执行顺序依赖；informs/reports_to/writes_to_memory 只表示上下文传递或图谱展示。',
    'workflow 是可执行 Workflow IR：nodes, edges, policy。节点 type 只能是 agent/fan_out/join/gate/review/reduce/loop/human_gate。',
    'workflow.nodes 每项使用稳定 key；Agent/Review/Reduce 节点必须提供 agentName；Gate 可使用 completion/artifact/count/schema/llm；llm Gate 必须提供 evaluationPrompt；Loop repeatCount 不得超过 20。',
    'workflow.edges 只通过 from/to 引用节点 key，kind 只能是 control/data。policy 只能设置 maxConcurrency、defaultTimeoutMs 和允许的重试策略。',
    'workflowScript 是可选真实动态工作流草稿，格式为 { source, argsSchema }。source 必须是 CommonJS：module.exports = async function workflow({ harness, args, context }) { ... }。',
    'workflowScript 只能调用 harness.agent/fanOut/join/gate/llmGate/humanGate/loop/log/finish/fail；不得包含 require/import/fs/process/fetch/shell/network/任意文件读写。',
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

function buildWorkflowFromPlan(
  plan: LlmClusterPlan,
  clusterId: string,
  agents: ClusterAgent[],
  fallback: AgentClusterWorkflow,
  now: string,
): AgentClusterWorkflow {
  const plannedNodes = Array.isArray(plan.workflow?.nodes) ? plan.workflow.nodes : [];
  if (plannedNodes.length === 0) return fallback;
  const keyToNodeId = new Map<string, string>();
  const nodes: WorkflowNode[] = [];
  for (const [index, planned] of plannedNodes.entries()) {
    const type = planned.type;
    if (!type || !['agent', 'fan_out', 'join', 'gate', 'review', 'reduce', 'loop', 'human_gate'].includes(type)) continue;
    const key = planned.key?.trim() || `node-${index + 1}`;
    if (keyToNodeId.has(key)) continue;
    const agent = type === 'agent' || type === 'review' || type === 'reduce'
      ? findAgentByPlanName(planned.agentName, agents)
      : null;
    if ((type === 'agent' || type === 'review' || type === 'reduce') && !agent) continue;
    const nodeId = agent ? workflowAgentNodeId(agent.agentId) : `${type}:${randomUUID()}`;
    if (nodes.some((node) => node.nodeId === nodeId)) {
      keyToNodeId.set(key, nodeId);
      continue;
    }
    keyToNodeId.set(key, nodeId);
    const base = {
      nodeId,
      type,
      name: compactText(planned.name?.trim() || agent?.name || workflowNodeLabelsForPrompt(type), 100),
      description: planned.description?.trim(),
      outputContract: planned.requiredArtifacts?.length
        ? { requiredArtifacts: sanitizeRuntimeArtifactRefs(planned.requiredArtifacts) }
        : agent
          ? defaultAgentOutputContract(agent)
          : undefined,
    };
    const node: WorkflowNode = type === 'agent' || type === 'review' || type === 'reduce'
      ? { ...base, type, agentId: agent!.agentId }
      : type === 'fan_out'
        ? {
            ...base,
            type,
            concurrency: Math.max(1, Math.min(16, Math.floor(planned.concurrency || DEFAULT_WORKFLOW_CONCURRENCY))),
            fanOutMode: planned.fanOutMode === 'from_output' ? 'from_output' as const : 'fixed' as const,
            itemsPath: planned.itemsPath?.trim(),
            itemInputName: planned.itemInputName?.trim(),
          }
        : type === 'join'
          ? { ...base, type, mode: planned.joinMode === 'minimum' ? 'minimum' : 'all', minimumSuccess: planned.minimumSuccess }
          : type === 'gate'
            ? {
                ...base,
                type,
                gateKind: planned.gateKind ?? 'completion',
                minimumCount: planned.minimumCount,
                evaluationPrompt: planned.evaluationPrompt?.trim(),
                modelId: planned.modelId?.trim(),
              }
            : type === 'loop'
              ? {
                  ...base,
                  type,
                  bodyNodeIds: coerceStringArray(planned.bodyAgentNames)
                    .map((name) => findAgentByPlanName(name, agents)?.agentId)
                    .filter((agentId): agentId is string => Boolean(agentId))
                    .map(workflowAgentNodeId),
                  repeatCount: Math.max(1, Math.min(MAX_WORKFLOW_LOOP_COUNT, Math.floor(planned.repeatCount || 1))),
                }
              : { ...base, type: 'human_gate', prompt: planned.prompt?.trim() || '请确认是否继续执行。' };
    nodes.push(node);
  }
  for (const agent of agents) {
    if (nodes.some((node) => workflowNodeIsAgent(node) && node.agentId === agent.agentId)) continue;
    nodes.push({
      nodeId: workflowAgentNodeId(agent.agentId),
      type: 'agent',
      name: agent.name,
      description: agent.description,
      agentId: agent.agentId,
      outputContract: defaultAgentOutputContract(agent),
    });
  }
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const edges = (plan.workflow?.edges ?? []).map((edge) => {
    const fromNodeId = keyToNodeId.get(edge.from?.trim() || '');
    const toNodeId = keyToNodeId.get(edge.to?.trim() || '');
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId || !nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return null;
    return {
      edgeId: randomUUID(),
      fromNodeId,
      toNodeId,
      kind: edge.kind === 'data' ? 'data' as const : 'control' as const,
      label: edge.label?.trim(),
      condition: edge.condition === 'on_pass' || edge.condition === 'on_fail' || edge.condition === 'on_revise'
        ? edge.condition
        : 'always' as const,
      dataMapping: Array.isArray(edge.dataMapping)
        ? edge.dataMapping
          .map((mapping) => ({
            source: String(mapping.source ?? '').trim(),
            target: String(mapping.target ?? '').trim(),
            optional: mapping.optional === true,
          }))
          .filter((mapping) => mapping.source && mapping.target)
        : undefined,
    };
  }).filter((edge): edge is WorkflowEdge => Boolean(edge));
  if (edges.length === 0) return fallback;
  return normalizeAgentClusterWorkflow({
    workflowId: `workflow-${randomUUID()}`,
    version: 1,
    status: 'draft',
    createdBy: 'planner',
    nodes,
    edges,
    policy: {
      ...defaultWorkflowPolicy(),
      ...(plan.workflow?.policy ?? {}),
      maxConcurrency: Math.max(1, Math.min(16, Math.floor(plan.workflow?.policy?.maxConcurrency || DEFAULT_WORKFLOW_CONCURRENCY))),
    },
    createdAt: now,
    updatedAt: now,
  });
}

function workflowScriptFromPlan(plan: LlmClusterPlan | null | undefined, now: string): AgentClusterWorkflowScript | undefined {
  const raw = typeof plan?.workflowScript === 'string'
    ? { source: plan.workflowScript }
    : plan?.workflowScript;
  const source = raw?.source?.trim();
  if (!source) return undefined;
  return normalizeWorkflowScript({
    source,
    sourceType: 'planner',
    version: 1,
    hash: hashWorkflowScriptSource(source),
    argsSchema: raw?.argsSchema && typeof raw.argsSchema === 'object' && !Array.isArray(raw.argsSchema)
      ? raw.argsSchema
      : undefined,
    createdAt: now,
    updatedAt: now,
  }, now);
}

function workflowScriptFromProjectSource(source: string, now: string): AgentClusterWorkflowScript {
  return normalizeWorkflowScript({
    source,
    sourceType: 'project',
    version: 1,
    hash: hashWorkflowScriptSource(source),
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
  }, now)!;
}

function workflowNodeLabelsForPrompt(type: WorkflowNodeType): string {
  switch (type) {
    case 'fan_out': return '并行分发';
    case 'join': return '结果汇合';
    case 'gate': return '确定性门禁';
    case 'review': return '审查';
    case 'reduce': return '综合';
    case 'loop': return '循环';
    case 'human_gate': return '人工确认';
    default: return 'Agent';
  }
}

async function requestClusterPlanFromLlm(
  sourceContent: string,
  input: CreateAgentClusterInput,
  onStage?: (stageId: AgentClusterCreationStageId, status: AgentClusterCreationStageStatus, detail: string, error?: string) => void,
  abortSignal?: AbortSignal,
): Promise<LlmClusterPlan | null> {
  if (process.env.INVESTCLAW_E2E === '1' || process.env.VITEST === 'true') {
    return null;
  }

  const model = await resolvePlanningModel(input);
  const baseUrl = model.baseUrl.replace(/\/$/, '');
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  if (abortSignal?.aborted) throw new Error('已终止创建 Agent 集群');
  const abortListener = (): void => controller.abort();
  abortSignal?.addEventListener('abort', abortListener, { once: true });
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
          { role: 'user', content: buildPlanningPrompt(buildPlanningSourceContent(sourceContent)) },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (abortSignal?.aborted) throw new Error('已终止创建 Agent 集群', { cause: error });
      throw new Error(`基模调用超时：${Math.round(timeoutMs / 1000)} 秒内没有返回任务拆解结果`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener('abort', abortListener);
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

function interactionModeInstruction(mode: InteractionMode): string {
  switch (mode) {
    case 'ask':
      return '当前模式 Ask：只回答用户问题。不要生成 promptPatches、agentDrafts、edgeDrafts、workflowNodeDrafts、recommendedResumeFromAgentId 或 runDecision。';
    case 'plan':
      return '当前模式 Plan：只生成计划/草稿提案，不建议立即运行，不设置 runDecision。';
    case 'review':
      return '当前模式 Review：审查已有内容和风险，除非用户明确要求修改，否则不要生成变更提案。';
    default:
      return '当前模式 Run：可以生成待确认提案，并在用户明确要求时建议从某个节点继续运行。';
  }
}

function buildManagerPrompt(cluster: AgentCluster, content: string, mode: InteractionMode = 'run'): string {
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
    interactionModeInstruction(mode),
    '只返回 JSON，不要 Markdown，不要解释。',
    'JSON 字段：reply, targetAgentIds, targetAgentNames, promptPatches, agentDrafts, edgeDrafts, workflowNodeDrafts, sharedContextUpdates, sharedContextSummary, recommendedResumeFromAgentId, recommendedResumeFromAgentName, runDecision。',
    'promptPatches 每项包含 targetAgentId 或 targetAgentName，以及 instruction。',
    'agentDrafts 用于用户要求新增 Agent；每项包含 name, role, description, responsibilities, systemPrompt, tools, capabilities。',
    'edgeDrafts 用于新增/修改协作关系；每项包含 fromAgentName/fromAgentId, toAgentName/toAgentId, relationType, executionType, isBlocking, label, reason。',
    'workflowNodeDrafts 只能使用 fan_out/join/gate/loop/human_gate；每项包含 type, name, description, upstreamAgentNames, downstreamAgentNames，以及该类型允许的 concurrency/joinMode/minimumSuccess/gateKind/minimumCount/evaluationPrompt/modelId/repeatCount/prompt。',
    '不要生成 JavaScript、Shell 或任意条件表达式；Gate 只能选择 completion/artifact/count/schema/llm；llm Gate 必须返回结构化判定并提供 evaluationPrompt。',
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
  abortSignal?: AbortSignal,
): Promise<LlmManagerDecision> {
  if (process.env.INVESTCLAW_E2E === '1' || process.env.VITEST === 'true') {
    const fallback = buildFallbackManagerDecision(cluster, content);
    if (input.interactionMode === 'ask' || input.interactionMode === 'review') {
      return { reply: fallback.reply ?? '已收到，我会只做说明，不修改集群。' };
    }
    if (input.interactionMode === 'plan') {
      return { ...fallback, runDecision: undefined, recommendedResumeFromAgentId: undefined, recommendedResumeFromAgentName: undefined };
    }
    return fallback;
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
  if (abortSignal?.aborted) throw new Error('已终止 Cluster Manager 生成');
  const abortListener = (): void => controller.abort();
  abortSignal?.addEventListener('abort', abortListener, { once: true });
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
          { role: 'user', content: buildManagerPrompt(cluster, content, input.interactionMode ?? 'run') },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (abortSignal?.aborted) throw new Error('已终止 Cluster Manager 生成', { cause: error });
      throw new Error(`Cluster Manager 基模调用超时：${Math.round(timeoutMs / 1000)} 秒内没有返回决策`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener('abort', abortListener);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Cluster Manager 调用基模失败 (${response.status})${text ? `: ${compactText(text, 240)}` : ''}`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const decisionContent = data.choices?.[0]?.message?.content;
  if (!decisionContent) throw new Error('Cluster Manager 基模没有返回决策内容');
  const decision = extractJsonObjectAs<LlmManagerDecision>(decisionContent);
  if (input.interactionMode === 'ask' || input.interactionMode === 'review') {
    return {
      reply: decision.reply,
      sharedContextSummary: decision.sharedContextSummary,
      sharedContextUpdates: input.interactionMode === 'review' ? decision.sharedContextUpdates : undefined,
    };
  }
  if (input.interactionMode === 'plan') {
    return {
      ...decision,
      runDecision: undefined,
      recommendedResumeFromAgentId: undefined,
      recommendedResumeFromAgentName: undefined,
    };
  }
  return decision;
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
  const runtimeContract = extractRuntimeContractFromSource(taskText);
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
    const contract = runtimeContractForAgentDefinition(runtimeContract, definition);
    if (contract) agent.runtimeContract = contract;
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

function looksLikeHistoricalContext(value: string): boolean {
  return /上次实验|历史实验|历史兼容|旧\s*(?:version|目录|实验|产物|缓存|链路|artifact|file|文件|报告|结果|[\w./-]+\.(?:jsonl?|csv|md|txt|parquet))|离线复盘|历史\s*\d+\s*次|2026-0[1-5]-\d{2}|20260[1-5]\d{2}|version_\d+_\d{8}|旧日期目录/i.test(value);
}

function splitCurrentAndHistoricalContext(values: string[]): { current: string[]; historical: string[] } {
  const current: string[] = [];
  const historical: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text) continue;
    if (looksLikeHistoricalContext(text)) historical.push(text);
    else current.push(text);
  }
  return { current, historical };
}

function buildProjectContractSummary(sourceContent: string): string | undefined {
  const runtimeContract = extractRuntimeContractFromSource(sourceContent);
  const agentDefinitions = extractSourceAgentDefinitions(sourceContent);
  const toolSections = parseSourceSections(sourceContent)
    .filter((section) => /^agents\/tools\/[^/]+\.(?:py|md)$/i.test(section.path))
    .map((section) => section.path)
    .slice(0, 12);
  const lines = [
    runtimeContract?.agents?.length ? `runtime_contract agents=${runtimeContract.agents.length}` : '',
    agentDefinitions.length > 0 ? `agents=${agentDefinitions.map((agent) => agent.name).join(', ')}` : '',
    toolSections.length > 0 ? `stable_tools=${toolSections.join(', ')}` : '',
    runtimeContract?.summary ? `summary=${runtimeContract.summary}` : '',
  ].filter(Boolean);
  return lines.length > 0 ? compactText(lines.join(' | '), 900) : undefined;
}

async function buildClusterFromSource(
  sourceType: AgentClusterSourceType,
  sourceContent: string,
  clusterName: string,
  input: CreateAgentClusterInput,
  onStage?: (stageId: AgentClusterCreationStageId, status: AgentClusterCreationStageStatus, detail: string, error?: string) => void,
  abortSignal?: AbortSignal,
  projectWorkflowScriptSource?: string | null,
): Promise<AgentCluster> {
  const now = new Date().toISOString();
  const clusterId = `cluster-${randomUUID()}`;
  const runtimeMode: AgentClusterRuntimeMode = input.folderPath?.trim() ? 'project_directory' : 'dynamic_harness';
  onStage?.('prepare_context', 'running', '正在压缩资料并准备集群规划提示词');
  onStage?.('prepare_context', 'completed', `上下文准备完成，输入约 ${sourceContent.length} 字符`);
  onStage?.('call_model', 'running', '正在调用基模拆解任务并生成 Agent 规划');
  const sourceAgentDefinitions = extractSourceAgentDefinitions(sourceContent);
  if (abortSignal?.aborted) throw new Error('已终止创建 Agent 集群');
  const plan = await requestClusterPlanFromLlm(sourceContent, input, onStage, abortSignal);
  onStage?.('call_model', 'completed', plan ? '基模已返回 Agent 规划' : '测试环境使用确定性 Agent 规划');
  if (!plan) {
    onStage?.('parse_plan', 'completed', '测试环境跳过基模 JSON 解析');
  }
  onStage?.('build_agents', 'running', '正在生成 Agent、本地上下文和协作关系');
  const agents = sourceAgentDefinitions.length > 0
    ? buildAgentsFromSourceDefinitions(clusterId, sourceAgentDefinitions, sourceContent)
    : buildAgentsFromPlan(clusterId, plan ?? {}, sourceContent);
  const constraints = coerceStringArray(plan?.constraints, extractListCandidates(sourceContent, ['constraint', '约束', '必须', '不要', '不允许', 'requirement']));
  const factLayers = splitCurrentAndHistoricalContext(coerceStringArray(plan?.facts, extractListCandidates(sourceContent, ['fact', '事实', '数据', '背景', '目标', 'source'])));
  const facts = factLayers.current;
  const openQuestions = coerceStringArray(plan?.openQuestions, extractListCandidates(sourceContent, ['question', '问题', 'unknown', '待确认', '开放']));
  const decompositionPlan = plan?.decompositionPlan ?? agents
    .map((agent, index) => `${index + 1}. ${agent.name}：${agent.description}`)
    .join('\n');
  const edges = runtimeMode === 'project_directory'
    ? buildProjectDirectoryEdges(plan ?? {}, agents)
    : buildEdgesFromPlan(plan ?? {}, agents);
  const executionGraph = buildExecutionGraph(agents, edges, false, now);
  const fallbackWorkflow = buildWorkflowFromExecutionGraph(clusterId, agents, executionGraph, 'planner', 1, now);
  const workflow = runtimeMode === 'project_directory'
    ? fallbackWorkflow
    : buildWorkflowFromPlan(plan ?? {}, clusterId, agents, fallbackWorkflow, now);
  const workflowScript = projectWorkflowScriptSource?.trim()
    ? workflowScriptFromProjectSource(projectWorkflowScriptSource, now)
    : input.folderPath?.trim()
      ? undefined
      : workflowScriptFromPlan(plan, now);
  onStage?.('build_agents', 'completed', `已生成 ${agents.length} 个 Agent`);
  const messages = [
    makeMessage(clusterId, {
      senderType: 'orchestrator',
      senderAgentId: agents[0]?.agentId ?? null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'summary',
      content: sourceAgentDefinitions.length > 0
        ? `已通过基模理解项目并读取目录 agents/*.md 创建 ${agents.length} 个权威子 Agent；目录项目运行时采用项目原生 Thin Harness，只做调度、round 和产物校验。${workflowScript?.sourceType === 'project' ? '已检测到项目 JS Workflow，将优先使用真实 JS Workflow。' : '项目未提供 JS Workflow，当前使用 runtime contract / Agent prompt 调度。'}`
        : `已通过基模拆解任务并创建 ${agents.length} 个子 Agent。${workflowScript ? '已生成 Dynamic Workflow JS 草稿，确认后可优先执行脚本。' : '启动运行时，每个 Agent 会进入独立 OpenClaw 子会话。'}`,
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
    runtimeMode,
    sourceContent,
    ...summarizeSourceLocation(input),
    sharedContext: {
      globalGoal: compactText(plan?.globalGoal || sourceContent, 420),
      originalInput: sourceContent,
      decompositionPlan,
      constraints,
      facts,
      projectContractSummary: buildProjectContractSummary(sourceContent),
      projectBackground: compactText(sourceContent, 1200),
      historicalNotes: factLayers.historical,
      currentRunContext: '',
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
    executionGraph,
    workflows: [workflow],
    currentWorkflowId: workflow.workflowId,
    workflowScript,
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

interface DirectoryManifest {
  paths: string[];
  workflowScriptPaths: string[];
  runtimeContractPaths: string[];
}

function parseDirectoryManifest(content: string): DirectoryManifest {
  const lines = content.split(/\r?\n/);
  const allowedKeys = new Set(['agent_prompts', 'agent_tools', 'skills', 'context', 'workflow_script', 'workflow_scripts', 'runtime_contract', 'runtime_contracts']);
  const paths: string[] = [];
  const workflowScriptPaths: string[] = [];
  const runtimeContractPaths: string[] = [];
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
    if (!path) continue;
    if (activeKey === 'workflow_script' || activeKey === 'workflow_scripts') workflowScriptPaths.push(path);
    else if (activeKey === 'runtime_contract' || activeKey === 'runtime_contracts') runtimeContractPaths.push(path);
    else paths.push(path);
  }
  return { paths, workflowScriptPaths, runtimeContractPaths };
}

async function collectManifest(manifestFiles: string[]): Promise<DirectoryManifest> {
  const paths: string[] = [];
  const workflowScriptPaths: string[] = [];
  const runtimeContractPaths: string[] = [];
  for (const manifestFile of manifestFiles) {
    try {
      const content = await readFile(manifestFile, 'utf8');
      const manifest = parseDirectoryManifest(content);
      paths.push(...manifest.paths);
      workflowScriptPaths.push(...manifest.workflowScriptPaths);
      runtimeContractPaths.push(...manifest.runtimeContractPaths);
    } catch {
      // Optional manifest file.
    }
  }
  return {
    paths: Array.from(new Set(paths)),
    workflowScriptPaths: Array.from(new Set(workflowScriptPaths)),
    runtimeContractPaths: Array.from(new Set(runtimeContractPaths)),
  };
}

export async function readFolderSourceContent(folderPath: string): Promise<string> {
  if (!isAbsolute(folderPath)) throw new Error('目录路径必须是绝对路径');
  const folderStat = await stat(folderPath);
  if (!folderStat.isDirectory()) throw new Error('目录路径必须指向一个文件夹');
  const folderRealPath = await realpath(folderPath).catch(() => folderPath);

  const parts: string[] = [];
  const seenFiles = new Set<string>();
  const addFile = async (filePath: string): Promise<boolean> => {
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size > MAX_FOLDER_FILE_BYTES) return false;
      const resolved = await realpath(filePath).catch(() => filePath);
      const relativeToRoot = relative(folderRealPath, resolved);
      if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) return false;
      const key = `${fileStat.dev}:${fileStat.ino}:${resolved.toLowerCase()}`;
      if (seenFiles.has(key)) return false;
      seenFiles.add(key);
      const displayPath = relative(folderPath, filePath) || basename(filePath);
      const content = await readOptionalTextFile(filePath, displayPath);
      if (!content) return false;
      parts.push(content);
      return true;
    } catch {
      // Optional file.
      return false;
    }
  };

  parts.push(`# Source: PROJECT_ROOT\n\n${folderPath}`);
  let hasPrimarySource = false;
  hasPrimarySource = await addFile(join(folderPath, 'investclaw.workflow.js')) || hasPrimarySource;
  hasPrimarySource = await addFile(join(folderPath, 'investclaw.runtime.json')) || hasPrimarySource;
  hasPrimarySource = await addFile(join(folderPath, 'agents', 'runtime_contract.json')) || hasPrimarySource;
  const manifestFiles: string[] = [];
  for (const name of ['README.md', 'README.MD']) {
    const filePath = join(folderPath, name);
    hasPrimarySource = await addFile(filePath) || hasPrimarySource;
    try {
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) manifestFiles.push(filePath);
    } catch {
      // Optional file.
    }
  }

  const manifest = await collectManifest(manifestFiles);
  for (const manifestPath of [...manifest.paths, ...manifest.workflowScriptPaths, ...manifest.runtimeContractPaths]) {
    if (manifestPath.includes('..') || isAbsolute(manifestPath)) continue;
    hasPrimarySource = await addFile(join(folderPath, manifestPath)) || hasPrimarySource;
  }

  if (manifest.paths.length === 0 && manifest.workflowScriptPaths.length === 0) {
    try {
      const agentsDir = join(folderPath, 'agents');
      const entries = await readdir(agentsDir, { withFileTypes: true });
      for (const entry of entries.slice(0, 40)) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          hasPrimarySource = await addFile(join(agentsDir, entry.name)) || hasPrimarySource;
        }
      }
    } catch {
      // Optional Agent prompt directory.
    }
  }

  if (!hasPrimarySource) {
    for (const name of ['HANDOFF.md', 'HANDOFF.MD']) {
      hasPrimarySource = await addFile(join(folderPath, name)) || hasPrimarySource;
      if (hasPrimarySource) break;
    }
  }

  if (parts.length <= 1) {
    throw new Error('目录中没有找到 README.md、agents/runtime_contract.json、investclaw.runtime.json、agents/*.md，或 manifest 声明的可读文件');
  }
  return parts.join('\n\n---\n\n');
}

async function readProjectWorkflowScript(projectRoot: string | null | undefined): Promise<string | null> {
  const root = projectRoot?.trim();
  if (!root || !isAbsolute(root)) return null;
  const candidates = ['investclaw.workflow.js'];
  const manifestFiles: string[] = [];
  for (const name of ['README.md', 'README.MD']) {
    const filePath = join(root, name);
    const fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isFile()) manifestFiles.push(filePath);
  }
  const manifest = await collectManifest(manifestFiles);
  candidates.push(...manifest.workflowScriptPaths);
  for (const candidate of candidates) {
    if (candidate.includes('..') || isAbsolute(candidate)) continue;
    const workflowPath = join(root, candidate);
    const fileStat = await stat(workflowPath).catch(() => null);
    if (!fileStat?.isFile()) continue;
    if (fileStat.size > MAX_FOLDER_FILE_BYTES) {
      throw new Error(`${candidate} 超过 512KB，请精简后再创建集群`);
    }
    return readFile(workflowPath, 'utf8');
  }
  return null;
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

export function summarizeRuntimeEvent(payload: unknown): Omit<AgentClusterEvent, 'eventId' | 'clusterId' | 'createdAt' | 'runId' | 'agentId'> {
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
  return {
    title: '子会话活动',
    content: text || 'Agent 子会话正在运行',
    level: 'info',
    display: 'silent',
    raw: payload,
  };
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

function sanitizeArtifactsForAgentPrompt(_agent: ClusterAgent, artifacts: string[]): string[] {
  return artifacts.filter((artifact) => !isProjectInstructionArtifact(artifact));
}

function sanitizeTextForAgentPrompt(_agent: ClusterAgent, text: string, max: number): string {
  if (!text.trim()) return '';
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter((line) => !looksLikeHistoricalContext(line));
  return compactText(filtered.join('\n'), max);
}

function artifactMatchesAllowedForPrompt(artifact: string, allowedArtifacts: string[]): boolean {
  if (allowedArtifacts.length === 0) return true;
  const normalized = artifact.replace(/\\/g, '/').replace(/^\/+/, '');
  return allowedArtifacts.some((allowed) => {
    const cleanAllowed = allowed
      .replace(/\s+\((?:literal|glob|one_or_more)\)$/i, '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    return normalized === cleanAllowed || normalized.endsWith(`/${cleanAllowed}`) || cleanAllowed.endsWith(`/${normalized}`);
  });
}

function sanitizeWorkflowOutputForAgentPrompt(agent: ClusterAgent, output: unknown, allowedArtifacts: string[] = []): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output;
  const record = { ...(output as Record<string, unknown>) };
  if (Array.isArray(record.artifacts)) {
    record.artifacts = sanitizeArtifactsForAgentPrompt(
      agent,
      record.artifacts.filter((artifact): artifact is string => typeof artifact === 'string'),
    ).filter((artifact) => artifactMatchesAllowedForPrompt(artifact, allowedArtifacts));
  }
  if (typeof record.summary === 'string') {
    record.summary = sanitizeTextForAgentPrompt(agent, record.summary, 700);
  }
  return record;
}

interface RuntimeTemplateContext {
  outputVersion?: string | null;
  outputRoot?: string | null;
  relativeRunOutputRoot?: string | null;
  iteration: number;
  agentId: string;
}

function deriveRuntimeTemplateRunRoot(context: RuntimeTemplateContext): string {
  const explicit = context.outputVersion?.trim();
  if (explicit) return explicit;
  const relativeRoot = context.relativeRunOutputRoot?.replace(/\\/g, '/').trim();
  const relativeMatch = relativeRoot?.match(/(?:^|\/)experiment_results\/([^/]+)$/i)?.[1];
  if (relativeMatch) return relativeMatch;
  const rootName = context.outputRoot ? basename(context.outputRoot) : '';
  return rootName || '<run_root>';
}

function resolveRuntimeTemplate(value: string, context: RuntimeTemplateContext): string {
  const iteration = Math.max(1, Math.floor(context.iteration || 1));
  return value
    .replace(/<run_root>/gi, deriveRuntimeTemplateRunRoot(context))
    .replace(/<round>/gi, String(iteration))
    .replace(/<iteration>/gi, String(iteration))
    .replace(/<agent_id>/gi, context.agentId)
    .replace(/round_n/gi, `round_${iteration}`)
    .replace(/experiment_results\/experiment_results\//gi, 'experiment_results/');
}

function resolveRuntimeArtifactRefForPrompt(artifact: RuntimeArtifactRef, context: RuntimeTemplateContext): RuntimeArtifactRef {
  if (typeof artifact === 'string') return resolveRuntimeTemplate(artifact, context);
  return {
    ...artifact,
    path: resolveRuntimeTemplate(artifact.path, context),
  };
}

function resolveOutputContractForPrompt(contract: WorkflowOutputContract | undefined, context: RuntimeTemplateContext): WorkflowOutputContract | undefined {
  if (!contract) return undefined;
  return {
    ...contract,
    requiredArtifacts: contract.requiredArtifacts?.map((artifact) => resolveRuntimeArtifactRefForPrompt(artifact, context)),
    optionalArtifacts: contract.optionalArtifacts?.map((artifact) => resolveRuntimeArtifactRefForPrompt(artifact, context)),
    auditArtifacts: contract.auditArtifacts?.map((artifact) => resolveRuntimeArtifactRefForPrompt(artifact, context)),
  };
}

function agentContextAliases(agent: ClusterAgent): string[] {
  return [agent.agentId, agent.name, agent.role]
    .map((value) => value.trim())
    .filter((value) => value.length >= 4 && !/^agent$/i.test(value));
}

function textMentionsAlias(text: string, alias: string): boolean {
  if (!alias) return false;
  return text.toLowerCase().includes(alias.toLowerCase());
}

function textMentionsAgent(text: string, agent: ClusterAgent): boolean {
  return agentContextAliases(agent).some((alias) => textMentionsAlias(text, alias));
}

function isProjectLevelContextText(text: string): boolean {
  return /所有\s*agent|all\s+agents|项目|project|workspace|工作区|runtime\s+contract|stable\s+tools|canonical\s+output|输出目录/i.test(text);
}

function shouldIncludeTextForAgent(cluster: AgentCluster, agent: ClusterAgent, value: unknown): boolean {
  const text = textValue(value);
  if (!text.trim()) return false;
  if (looksLikeHistoricalContext(text)) return false;
  if (textMentionsAgent(text, agent)) return true;
  const mentionsOtherAgent = cluster.agents.some((candidate) => candidate.agentId !== agent.agentId && textMentionsAgent(text, candidate));
  if (mentionsOtherAgent) return false;
  if (isProjectLevelContextText(text)) return true;
  return true;
}

function buildProjectContractPromptSummary(cluster: AgentCluster, agent: ClusterAgent): string | undefined {
  const hasRuntimeContract = Boolean(agent.runtimeContract || cluster.agents.some((item) => item.runtimeContract));
  if (!hasRuntimeContract) {
    const rawSummary = textValue((cluster.sharedContext as Record<string, unknown>).projectContractSummary);
    if (!rawSummary.trim()) return undefined;
    return compactText(rawSummary.replace(/\bstable_tools\s*=\s*[^|]+/gi, '').replace(/\s*\|\s*$/, ''), 260);
  }
  const parts = ['runtime_contract 已加载'];
  if (agent.runtimeContract?.stableCommand) parts.push('当前 Agent 声明 stableCommand');
  if (
    agent.runtimeContract?.requiredArtifacts?.length
    || agent.runtimeContract?.optionalArtifacts?.length
    || agent.runtimeContract?.auditArtifacts?.length
  ) {
    parts.push('当前 Agent 声明 outputContract');
  }
  if (agent.runtimeContract?.canonicalOutputDir) parts.push('当前 Agent 声明 canonicalOutputDir');
  return parts.join('；');
}

function buildChildSharedContextPrompt(cluster: AgentCluster, agent?: ClusterAgent): string {
  const filterText = (value: unknown) => {
    const text = textValue(value);
    if (!text.trim()) return false;
    if (looksLikeHistoricalContext(text)) return false;
    if (agent && !shouldIncludeTextForAgent(cluster, agent, text)) return false;
    return true;
  };
  const sharedContext = cluster.sharedContext as Record<string, unknown>;
  const projectContractSummary = agent
    ? buildProjectContractPromptSummary(cluster, agent)
    : textValue(sharedContext.projectContractSummary);
  const payload = {
    projectContract: projectContractSummary?.trim()
      ? compactText(projectContractSummary, 500)
      : undefined,
    currentRunContext: textValue(sharedContext.currentRunContext),
    constraints: coerceStringArray(sharedContext.constraints)
      .filter(filterText)
      .slice(0, 5),
    decisions: coerceStringArray(sharedContext.decisions)
      .filter(filterText)
      .slice(-3),
  };
  return compactText(JSON.stringify(payload), 900);
}

function runtimeStableCommandText(contract?: AgentRuntimeContract, context?: RuntimeTemplateContext): string | null {
  const command = contract?.stableCommand;
  if (!command) return null;
  const resolveCommand = (value: string) => context ? resolveRuntimeTemplate(value, context) : value;
  return Array.isArray(command) ? command.map(resolveCommand).join('\n') : resolveCommand(command);
}

function isProjectDirectoryRuntimeMode(cluster: AgentCluster): boolean {
  return cluster.runtimeMode === 'project_directory'
    || (!cluster.runtimeMode && Boolean(cluster.sourceFolderPath?.trim()));
}

function buildProjectDirectoryChildPrompt(cluster: AgentCluster, agent: ClusterAgent): string {
  const projectRoot = cluster.projectRoot?.trim() || cluster.sourceFolderPath?.trim() || null;
  const activeRun = (cluster.runs ?? []).find((run) => run.runId === cluster.activeRunId) ?? cluster.runs?.[0] ?? null;
  const activeChild = activeRun?.childRuns.find((child) => child.agentId === agent.agentId) ?? null;
  const workflowNode = activeRun?.workflowSnapshot?.nodes.find((node) => workflowNodeIsAgent(node) && node.agentId === agent.agentId);
  const runOutputRoot = activeRun?.outputRoot ?? activeChild?.outputRoot ?? null;
  const relativeRunOutputRoot = runOutputRoot && projectRoot ? relative(projectRoot, runOutputRoot) : null;
  const iteration = getChildIteration(activeChild ?? undefined);
  const runtimeTemplateContext: RuntimeTemplateContext = {
    outputVersion: activeRun?.outputVersion,
    outputRoot: runOutputRoot,
    relativeRunOutputRoot,
    iteration,
    agentId: agent.agentId,
  };
  const resolvedOutputContract = resolveOutputContractForPrompt(workflowNode?.outputContract, runtimeTemplateContext);
  const downstreamIds = getBlockingDownstreamAgentIds(cluster, agent.agentId);
  const promptPatches = (cluster.sharedContext.promptPatches ?? [])
    .filter((patch) => !patch.targetAgentId || patch.targetAgentId === agent.agentId)
    .slice(-3)
    .map((patch) => `- ${patch.instruction}`)
    .join('\n');

  return [
    `[agent:${agent.agentId}]`,
    `你是 ${agent.name}，角色：${agent.role}。`,
    '',
    '运行模式：项目目录模式 / Thin Harness。InvestClaw 只负责调度、round、产物校验和完成信号；业务规则以当前 Agent prompt 和 runtime contract 为准。',
    projectRoot
      ? [
          '',
          '项目根目录 / 工作区边界：',
          `- cwd 必须是：${projectRoot}`,
          '- 只在项目目录内读写文件；禁止写入 ~/.openclaw/workspace 或项目外目录。',
          runOutputRoot ? `- 本轮唯一实验输出目录：${runOutputRoot}` : '- 本轮没有分配实验输出目录时，请返回 [status:blocked]。',
          relativeRunOutputRoot ? `- 相对项目根目录的本轮输出目录：${relativeRunOutputRoot}` : '',
          runOutputRoot ? `- 调用项目工具前设置：INVESTCLAW_RUN_OUTPUT_DIR="${runOutputRoot}"` : '',
          `- 当前 round / iteration：${iteration}`,
          agent.runtimeContract?.canonicalOutputDir
            ? `- 当前 Agent canonical output dir：${resolveRuntimeTemplate(agent.runtimeContract.canonicalOutputDir, runtimeTemplateContext)}`
            : '',
          runtimeStableCommandText(agent.runtimeContract, runtimeTemplateContext)
            ? `- 默认稳定命令：\n${runtimeStableCommandText(agent.runtimeContract, runtimeTemplateContext)}`
            : '',
        ].filter(Boolean).join('\n')
      : '',
    resolvedOutputContract
      ? `\n本节点 runtime outputContract：${safeStringify(resolvedOutputContract)}`
      : '\n本节点没有显式 outputContract；完成时请在 [artifact:] 报告实际产物。',
    activeRun && activeChild ? firstArtifactGuidanceForPrompt(activeRun, activeChild, agent) : '',
    '',
    '当前 Agent prompt：',
    agent.systemPrompt,
    '',
    '已完成且通过校验的阻塞上游：',
    buildDependencySummary(cluster, agent, activeRun),
    promptPatches
      ? `\nCluster Manager 针对当前 Agent 的最新指令：\n${promptPatches}`
      : '',
    '',
    '完成协议（很重要）：当且仅当本阶段任务已经完成、下游可以继续时，请在输出末尾包含：',
    '[status:completed]',
    downstreamIds.map((agentId) => `[unblock:${agentId}]`).join('\n') || '[unblock:none]',
    '[artifact:本轮产物路径；多个用逗号分隔；没有则写 none]',
    '[summary]用 3-8 句概括可写入 ClusterContext 的结论[/summary]',
  ].filter(Boolean).join('\n');
}

export function buildAgentChildPrompt(cluster: AgentCluster, agent: ClusterAgent): string {
  if (isProjectDirectoryRuntimeMode(cluster)) {
    return buildProjectDirectoryChildPrompt(cluster, agent);
  }
  const projectRoot = cluster.projectRoot?.trim() || cluster.sourceFolderPath?.trim() || null;
  const activeRun = (cluster.runs ?? []).find((run) => run.runId === cluster.activeRunId) ?? cluster.runs?.[0] ?? null;
  const activeChild = activeRun?.childRuns.find((child) => child.agentId === agent.agentId) ?? null;
  const workflowNode = activeRun?.workflowSnapshot?.nodes.find((node) => workflowNodeIsAgent(node) && node.agentId === agent.agentId);
  const resolvedInputs = workflowNode
    ? activeRun?.resolvedInputsByNodeId?.[workflowNode.nodeId] ?? {}
    : {};
  const upstreamIsReady = (nodeId: string): boolean => {
    const sourceRun = activeRun?.nodeRuns?.find((nodeRun) => nodeRun.nodeId === nodeId);
    if (sourceRun?.status !== 'completed') return false;
    const sourceNode = activeRun?.workflowSnapshot?.nodes.find((node) => node.nodeId === nodeId);
    if (!sourceNode || !workflowNodeIsAgent(sourceNode)) return true;
    const sourceChild = activeRun?.childRuns.find((child) => child.workflowNodeId === sourceNode.nodeId || child.agentId === sourceNode.agentId);
    return !sourceChild?.expectedArtifacts?.length || sourceChild.artifactValidationStatus === 'passed';
  };
  const upstreamWorkflowInputs = activeRun?.workflowSnapshot && workflowNode
    ? activeRun.workflowSnapshot.edges
      .filter((edge) => edge.toNodeId === workflowNode.nodeId)
      .filter((edge) => upstreamIsReady(edge.fromNodeId))
      .map((edge) => {
        const sourceNode = activeRun.workflowSnapshot?.nodes.find((node) => node.nodeId === edge.fromNodeId);
        const sourceRun = activeRun.nodeRuns?.find((nodeRun) => nodeRun.nodeId === edge.fromNodeId);
        const sourceChild = sourceNode && workflowNodeIsAgent(sourceNode)
          ? activeRun.childRuns.find((child) => child.workflowNodeId === sourceNode.nodeId || child.agentId === sourceNode.agentId)
          : undefined;
        return {
          nodeId: edge.fromNodeId,
          name: sourceNode?.name,
          kind: edge.kind,
          status: 'completed',
          output: sourceRun?.output,
          allowedArtifacts: sourceChild?.expectedArtifacts ?? [],
        };
      })
    : [];
  const runOutputRoot = activeRun?.outputRoot
    ?? activeChild?.outputRoot
    ?? null;
  const relativeRunOutputRoot = runOutputRoot && projectRoot ? relative(projectRoot, runOutputRoot) : null;
  const iteration = getChildIteration(activeChild ?? undefined);
  const runtimeTemplateContext: RuntimeTemplateContext = {
    outputVersion: activeRun?.outputVersion,
    outputRoot: runOutputRoot,
    relativeRunOutputRoot,
    iteration,
    agentId: agent.agentId,
  };
  const resolvedOutputContract = resolveOutputContractForPrompt(workflowNode?.outputContract, runtimeTemplateContext);
  const roundGuidance = runOutputRoot && relativeRunOutputRoot
    ? [
      '',
      `当前 round / iteration：${iteration}`,
      '- Harness 只注入当前 Agent 的运行参数、显式 runtime contract 和已完成上游产物；业务细节以当前 Agent prompt 为准。',
      resolvedOutputContract
        ? `- 本节点显式输出契约：${safeStringify(resolvedOutputContract)}`
        : '- 本节点没有显式输出契约；完成时请在 [artifact:] 中报告本轮实际产物，Harness 只校验完成信号和可解析产物路径。',
      firstArtifactGuidanceForPrompt(activeRun, activeChild, agent),
      milestoneArtifactGuidanceForPrompt(activeRun, activeChild, agent),
    ].filter(Boolean).join('\n')
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
        runOutputRoot
          ? `- 调用 Python 工具前设置环境变量：INVESTCLAW_RUN_OUTPUT_DIR="${runOutputRoot}"`
          : '',
        agent.runtimeContract?.canonicalOutputDir
          ? `- 当前 Agent canonical output dir：${resolveRuntimeTemplate(agent.runtimeContract.canonicalOutputDir, runtimeTemplateContext)}`
          : '',
        runtimeStableCommandText(agent.runtimeContract, runtimeTemplateContext) ? `- 项目声明的默认稳定命令：\n${runtimeStableCommandText(agent.runtimeContract, runtimeTemplateContext)}` : '',
        '- 正常路径优先执行当前 Agent prompt 和 runtime contract 声明的稳定工具；只有工具失败、缺产物或排障时才读取局部项目文档。',
        '- 目录模式下，Harness 只注入当前 run/round 和已完成上游产物；不要把审计表、历史 round 或旧实验统计当作当前事实。',
        '- 如果项目稳定工具要求 --output-dir，请使用 runtime contract 或当前 Agent prompt 声明的 canonical 目录；不要把 Harness 的子会话镜像目录当作业务产物目录。',
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
    buildChildSharedContextPrompt(cluster, agent),
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
    'Harness 节点契约：',
    workflowNode
      ? [
          `- 节点类型：${workflowNode.type}`,
          `- 节点名称：${workflowNode.name}`,
          workflowNode.inputContract ? `- 输入契约：${safeStringify(workflowNode.inputContract)}` : '',
          resolvedOutputContract ? `- 输出契约：${safeStringify(resolvedOutputContract)}` : '',
          workflowNode.type === 'review'
            ? '- 审查节点必须额外输出 [review:pass]、[review:revise] 或 [review:fail]。revise 表示退回目标节点重做，fail 表示暂停等待用户处理。'
            : '',
          workflowNode.type === 'reduce'
            ? '- 综合节点必须只基于 Harness 提供的上游结构化结果进行汇总，不得跳过缺失输入。'
            : '',
        ].filter(Boolean).join('\n')
      : '- 兼容旧 Agent 节点。',
    '',
    'Harness 上游结构化输入：',
    upstreamWorkflowInputs.length > 0
      ? compactText(safeStringify(upstreamWorkflowInputs.map((input) => ({
          nodeId: input.nodeId,
          name: input.name,
          kind: input.kind,
          status: input.status,
          output: sanitizeWorkflowOutputForAgentPrompt(agent, input.output, input.allowedArtifacts),
        }))), 2800)
      : '无。',
    '',
    'Harness dataMapping 已解析输入：',
    Object.keys(resolvedInputs).length > 0
      ? compactText(safeStringify(resolvedInputs), 5000)
      : '无。',
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

function buildAgentContinuationPrompt(
  cluster: AgentCluster,
  agent: ClusterAgent,
  child: AgentClusterChildRun,
): string {
  const projectRoot = cluster.projectRoot?.trim() || cluster.sourceFolderPath?.trim() || null;
  const activeRun = (cluster.runs ?? []).find((run) => run.runId === cluster.activeRunId) ?? cluster.runs?.[0] ?? null;
  const workflowNode = activeRun?.workflowSnapshot?.nodes.find((node) => workflowNodeIsAgent(node) && node.agentId === agent.agentId);
  const resolvedInputs = workflowNode
    ? activeRun?.resolvedInputsByNodeId?.[workflowNode.nodeId] ?? {}
    : {};
  const runOutputRoot = activeRun?.outputRoot ?? child.outputRoot ?? null;
  const relativeRunOutputRoot = runOutputRoot && projectRoot ? relative(projectRoot, runOutputRoot) : null;
  const iteration = getChildIteration(child);
  const runtimeTemplateContext: RuntimeTemplateContext = {
    outputVersion: activeRun?.outputVersion,
    outputRoot: runOutputRoot,
    relativeRunOutputRoot,
    iteration,
    agentId: agent.agentId,
  };
  const stableCommand = runtimeStableCommandText(agent.runtimeContract, runtimeTemplateContext);
  const expectedArtifacts = activeRun
    ? expectedArtifactLabelsForRunAgent(activeRun, agent, child)
    : [];
  const downstreamIds = getBlockingDownstreamAgentIds(cluster, agent.agentId);
  const isRepair = child.promptMode === 'repair';
  const projectDirectoryMode = isProjectDirectoryRuntimeMode(cluster);
  const referenceContext = projectDirectoryMode
    ? buildReferenceArtifactContextSummary(cluster, agent)
    : buildReferenceContextSummary(cluster, agent);
  return [
    `[agent:${agent.agentId}]`,
    isRepair
      ? `继续修复 ${agent.name} 的当前 round_${iteration}。`
      : `继续执行 ${agent.name}，现在进入 round_${iteration}。`,
    '',
    projectDirectoryMode
      ? '这是项目目录模式的新 Agent 子会话。请基于当前 round、已完成上游产物、runtime contract 和当前 Agent prompt 执行；不要依赖上一轮对话上下文。'
      : '这是同一个 Agent 子会话里的续跑消息。请复用本会话已有上下文，优先补交当前 runtime contract 产物；只有工具明确报错或上下文缺失时才读取局部项目文档排障。',
    child.promptReason ? `续跑原因：${child.promptReason}` : '',
    projectRoot ? `项目根目录：${projectRoot}` : '',
    runOutputRoot ? `本轮唯一实验输出目录：${runOutputRoot}` : '',
    relativeRunOutputRoot ? `相对项目根目录的本轮输出目录：${relativeRunOutputRoot}` : '',
    `当前 round / iteration：${iteration}`,
    projectDirectoryMode && stableCommand
      ? `当前 Agent 声明的稳定命令（正常路径先执行）：\n${stableCommand}`
      : '',
    expectedArtifacts.length > 0
      ? `本轮必需产物：${expectedArtifacts.join('、')}`
      : '本轮没有显式产物契约；完成时请在 [artifact:] 中报告实际产物。',
    expectedArtifacts.length > 0
      ? `执行优先：先补交或生成首个 required artifact：${expectedArtifacts[0]}；在它落盘前，不要重新读取完整工具源码、排障文档或一次性规划全部输出。`
      : '',
    projectDirectoryMode
      ? '目录模式边界：只读取本 prompt 明确列出的上游产物、参考产物和 stable command 输出；不要扫描未列出的历史 round、audit artifacts、示例路径或项目输出目录。stable command 失败或缺产物时，才读取局部文档/工具错误排障。'
      : '',
    '',
    isRepair
      ? '任务：补交或修复当前 round 缺失/未通过的产物，不要开启新 round。'
      : projectDirectoryMode
        ? '任务：基于显式上游产物和本轮输出目录继续完成本 round，不要覆盖上一轮产物目录。'
        : '任务：基于上一轮上下文、上游新增产物和反馈继续完成本 round，不要覆盖上一轮产物目录。',
    referenceContext && referenceContext !== '无。'
      ? `非阻塞参考 / 反馈记忆：\n${compactText(referenceContext, 1200)}`
      : '',
    Object.keys(resolvedInputs).length > 0
      ? `Harness dataMapping 已解析输入：\n${compactText(safeStringify(resolvedInputs), 1600)}`
      : '',
    '',
    '完成协议（很重要）：当且仅当本阶段任务已经完成、下游可以继续时，请在输出末尾包含：',
    '[status:completed]',
    downstreamIds.map((agentId) => `[unblock:${agentId}]`).join('\n') || '[unblock:none]',
    '[artifact:本轮产物路径；多个用逗号分隔；没有则写 none]',
    '[summary]用 3-8 句概括可写入 ClusterContext 的结论[/summary]',
  ].filter(Boolean).join('\n');
}

function buildAgentSubmissionPrompt(
  cluster: AgentCluster,
  agent: ClusterAgent,
  child: AgentClusterChildRun,
): string {
  if (child.promptMode === 'continuation' || child.promptMode === 'repair') {
    return buildAgentContinuationPrompt(cluster, agent, child);
  }
  return buildAgentChildPrompt(cluster, agent);
}

export function updateRootRunStatus(cluster: AgentCluster, run: AgentClusterRun, now: string): void {
  const childRuns = run.childRuns;
  const nodeRuns = run.nodeRuns ?? [];
  const hasWorkflowNodes = nodeRuns.length > 0;
  const failedNode = nodeRuns.find((nodeRun) => nodeRun.status === 'failed');
  const allWorkflowNodesComplete = hasWorkflowNodes
    && nodeRuns.every((nodeRun) => workflowNodeSucceeded(nodeRun.status));
  run.submittedChildCount = childRuns.filter((child) => child.submitStatus === 'submitted' || child.runId).length;
  run.completedChildCount = childRuns.filter((child) => child.status === 'completed').length;
  run.failedChildCount = childRuns.filter((child) => child.status === 'error' || child.status === 'timeout').length;
  run.lastHeartbeatAt = now;
  if (run.harnessStatus === 'waiting_human') {
    run.status = 'blocked';
    run.error = undefined;
    run.completedAt = undefined;
    cluster.activeRunId = run.runId;
  } else if (run.harnessStatus === 'paused') {
    run.status = 'blocked';
    run.error = failedNode?.error;
    run.completedAt = undefined;
    cluster.activeRunId = run.runId;
  } else if (failedNode || childRuns.some((child) => child.status === 'error' || child.status === 'timeout')) {
    run.status = 'error';
    run.harnessStatus = 'failed';
    run.error = failedNode?.error ?? childRuns.find((child) => child.error)?.error ?? 'Harness 节点运行失败';
    run.completedAt = now;
    cluster.activeRunId = null;
  } else if (
    (hasWorkflowNodes && allWorkflowNodesComplete)
    || (!hasWorkflowNodes && childRuns.length > 0 && childRuns.every((child) => child.status === 'completed' || child.status === 'aborted'))
  ) {
    const aborted = childRuns.some((child) => child.status === 'aborted');
    run.status = aborted ? 'aborted' : 'completed';
    run.harnessStatus = run.status === 'completed' ? 'completed' : 'aborted';
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
    if (hasDispatchablePendingChild(cluster, run) || hasRecentlyActiveChildRun(run)) {
      run.status = 'running';
      run.harnessStatus = 'running';
      run.error = undefined;
      run.completedAt = undefined;
      extendRunTimeout(run, now, true);
      cluster.activeRunId = run.runId;
    } else {
      run.status = 'timeout';
      run.harnessStatus = 'failed';
      run.error = '运行超时';
      run.completedAt = now;
      cluster.activeRunId = null;
    }
  } else {
    run.status = 'running';
    if (run.harnessStatus !== 'paused' && run.harnessStatus !== 'waiting_human') {
      run.harnessStatus = 'running';
    }
  }
  applyTerminalRunAgentDisplay(cluster, run);
  run.updatedAt = now;
}

function extendRunTimeout(run: AgentClusterRun, now: string, force = false): boolean {
  const currentMs = new Date(run.timeoutAt ?? 0).getTime();
  const remainingMs = currentMs - Date.now();
  if (!force && Number.isFinite(remainingMs) && remainingMs > RUN_TIMEOUT_MS - 60_000) return false;
  run.timeoutAt = new Date(Date.now() + RUN_TIMEOUT_MS).toISOString();
  run.lastHeartbeatAt = now;
  return true;
}

function hasRecentlyActiveChildRun(run: AgentClusterRun): boolean {
  return run.childRuns.some((child) => {
    if (child.status === 'completed' || child.status === 'aborted' || child.status === 'error' || child.status === 'timeout') return false;
    if (child.submitStatus !== 'submitted' && !child.runId) return false;
    const activityMs = new Date(child.lastEventAt ?? child.updatedAt ?? child.startedAt).getTime();
    return Number.isFinite(activityMs) && Date.now() - activityMs < RUN_TIMEOUT_MS;
  });
}

function canRecoverTimedOutRunFromChild(cluster: AgentCluster, run: AgentClusterRun, child: AgentClusterChildRun): boolean {
  if (cluster.activeRunId && cluster.activeRunId !== run.runId) return false;
  if (run.status !== 'timeout' && run.status !== 'error') return false;
  if (run.harnessStatus !== 'failed') return false;
  if (child.status === 'completed' || child.status === 'aborted' || child.status === 'error') return false;
  const settledMs = new Date(run.completedAt ?? run.updatedAt ?? run.startedAt).getTime();
  return Number.isFinite(settledMs) && Date.now() - settledMs < RUN_TIMEOUT_RECOVERY_MS;
}

function recoverTimedOutRunForLateCompletion(cluster: AgentCluster, run: AgentClusterRun, now: string): void {
  run.status = 'running';
  run.harnessStatus = 'running';
  run.error = undefined;
  run.completedAt = undefined;
  run.watchdogStatus = 'watching';
  extendRunTimeout(run, now, true);
  cluster.activeRunId = run.runId;
}

function workflowNodeRun(run: AgentClusterRun, nodeId: string): WorkflowNodeRun | undefined {
  return run.nodeRuns?.find((nodeRun) => nodeRun.nodeId === nodeId);
}

function workflowNodeFailed(status: WorkflowNodeRunStatus | undefined): boolean {
  return status === 'failed' || status === 'aborted';
}

function workflowNodeTerminal(status: WorkflowNodeRunStatus | undefined): boolean {
  return workflowNodeSucceeded(status) || workflowNodeFailed(status) || status === 'skipped';
}

function workflowNodeVerdict(nodeRun: WorkflowNodeRun | undefined): 'pass' | 'fail' | 'revise' | null {
  const verdict = String(nodeRun?.output?.verdict ?? '').toLowerCase();
  if (verdict === 'pass' || verdict === 'fail' || verdict === 'revise') return verdict;
  if (nodeRun?.output?.passed === true) return 'pass';
  if (workflowNodeSucceeded(nodeRun?.status)) return 'pass';
  if (workflowNodeFailed(nodeRun?.status)) return 'fail';
  return null;
}

function workflowEdgeSatisfied(edge: WorkflowEdge, sourceRun: WorkflowNodeRun | undefined): boolean {
  const condition = edge.condition ?? 'always';
  if (condition === 'always' || condition === 'on_pass') return workflowNodeSucceeded(sourceRun?.status);
  if (condition === 'on_fail') return workflowNodeFailed(sourceRun?.status) || workflowNodeVerdict(sourceRun) === 'fail';
  if (condition === 'on_revise') return workflowNodeVerdict(sourceRun) === 'revise';
  return workflowNodeSucceeded(sourceRun?.status);
}

function workflowEdgeStillWaiting(edge: WorkflowEdge, sourceRun: WorkflowNodeRun | undefined): boolean {
  if (!sourceRun) return true;
  if (workflowEdgeSatisfied(edge, sourceRun)) return false;
  return !workflowNodeTerminal(sourceRun.status);
}

function workflowActiveControlPredecessorEdges(
  workflow: AgentClusterWorkflow,
  run: AgentClusterRun,
  nodeId: string,
): WorkflowEdge[] {
  return workflow.edges
    .filter((edge) => edge.kind === 'control' && edge.toNodeId === nodeId)
    .filter((edge) => {
      const sourceRun = workflowNodeRun(run, edge.fromNodeId);
      return workflowEdgeSatisfied(edge, sourceRun) || workflowEdgeStillWaiting(edge, sourceRun);
    });
}

function workflowControlPredecessors(workflow: AgentClusterWorkflow, nodeId: string): string[] {
  return workflow.edges
    .filter((edge) => edge.kind === 'control' && edge.toNodeId === nodeId)
    .map((edge) => edge.fromNodeId);
}

function workflowControlSuccessors(workflow: AgentClusterWorkflow, nodeId: string): string[] {
  return workflow.edges
    .filter((edge) => edge.kind === 'control' && edge.fromNodeId === nodeId)
    .map((edge) => edge.toNodeId);
}

function readPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(key);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === 'object') return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let current: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function resolveWorkflowReference(
  expression: string,
  cluster: AgentCluster,
  run: AgentClusterRun,
  sourceNodeId?: string,
): unknown {
  const source = expression.trim();
  if (!source) return undefined;
  if (source.startsWith('args.')) return readPath(run.args ?? {}, source.slice('args.'.length));
  if (source === 'args') return run.args ?? {};
  if (source.startsWith('run.args.')) return readPath(run.args ?? {}, source.slice('run.args.'.length));
  if (source.startsWith('sharedContext.')) return readPath(cluster.sharedContext, source.slice('sharedContext.'.length));
  if (source === 'sharedContext') return cluster.sharedContext;
  if (source.startsWith('node.')) {
    const rest = source.slice('node.'.length);
    const [nodeId, ...pathParts] = rest.split('.');
    const nodeRun = workflowNodeRun(run, nodeId);
    return pathParts.length > 0 ? readPath(nodeRun, pathParts.join('.')) : nodeRun;
  }
  if (sourceNodeId && source.startsWith('output.')) {
    return readPath(workflowNodeRun(run, sourceNodeId)?.output, source.slice('output.'.length));
  }
  if (sourceNodeId && source === 'output') return workflowNodeRun(run, sourceNodeId)?.output;
  if (sourceNodeId && source === 'artifacts') return workflowNodeRun(run, sourceNodeId)?.output?.artifacts;
  return undefined;
}

function resolveWorkflowInputsForNode(
  cluster: AgentCluster,
  run: AgentClusterRun,
  nodeId: string,
): Record<string, unknown> {
  const workflow = run.workflowSnapshot;
  if (!workflow) return {};
  const resolved: Record<string, unknown> = {};
  const incomingEdges = workflow.edges.filter((edge) => edge.toNodeId === nodeId);
  for (const edge of incomingEdges) {
    const mappings = edge.dataMapping ?? [];
    if (mappings.length === 0 && edge.kind === 'data') {
      const sourceRun = workflowNodeRun(run, edge.fromNodeId);
      if (sourceRun?.output !== undefined) writePath(resolved, `upstream.${edge.fromNodeId}`, sourceRun.output);
      continue;
    }
    for (const mapping of mappings) {
      const value = resolveWorkflowReference(mapping.source, cluster, run, edge.fromNodeId);
      if (value === undefined && !mapping.optional) continue;
      writePath(resolved, mapping.target, value);
    }
  }
  return resolved;
}

function updateResolvedInputsForNode(
  cluster: AgentCluster,
  run: AgentClusterRun,
  nodeId: string,
  now: string,
): Record<string, unknown> {
  const resolved = resolveWorkflowInputsForNode(cluster, run, nodeId);
  run.resolvedInputsByNodeId = {
    ...(run.resolvedInputsByNodeId ?? {}),
    [nodeId]: resolved,
  };
  const nodeRun = workflowNodeRun(run, nodeId);
  if (nodeRun) {
    nodeRun.input = {
      ...(nodeRun.input ?? {}),
      ...(Object.keys(resolved).length > 0 ? resolved : {}),
    };
    nodeRun.updatedAt = now;
  }
  return resolved;
}

function workflowAgentNodeIdsInLoop(loop: WorkflowLoopNode): Set<string> {
  return new Set(loop.bodyNodeIds);
}

export function collectLoopDeterministicNodeIds(workflow: AgentClusterWorkflow, loop: WorkflowLoopNode): Set<string> {
  const bodyNodeIds = workflowAgentNodeIdsInLoop(loop);
  const deterministicNodeIds = new Set<string>();
  const visit = (nodeId: string, seen: Set<string>) => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    for (const nextNodeId of workflowControlSuccessors(workflow, nodeId)) {
      const nextNode = workflow.nodes.find((node) => node.nodeId === nextNodeId);
      if (!nextNode) continue;
      if (workflowNodeIsAgent(nextNode)) {
        if (bodyNodeIds.has(nextNodeId)) continue;
        continue;
      }
      deterministicNodeIds.add(nextNodeId);
      visit(nextNodeId, seen);
    }
  };
  for (const bodyNodeId of bodyNodeIds) visit(bodyNodeId, new Set());
  deterministicNodeIds.delete(loop.nodeId);
  return deterministicNodeIds;
}

function collectDownstreamDeterministicNodeIds(
  workflow: AgentClusterWorkflow,
  startAgentNodeId: string,
  affectedAgentNodeIds: Set<string>,
): Set<string> {
  const deterministicNodeIds = new Set<string>();
  const visit = (nodeId: string, seen: Set<string>) => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    for (const nextNodeId of workflowControlSuccessors(workflow, nodeId)) {
      const nextNode = workflow.nodes.find((node) => node.nodeId === nextNodeId);
      if (!nextNode) continue;
      if (workflowNodeIsAgent(nextNode)) {
        if (affectedAgentNodeIds.has(nextNodeId)) visit(nextNodeId, seen);
        continue;
      }
      deterministicNodeIds.add(nextNodeId);
      visit(nextNodeId, seen);
    }
  };
  visit(startAgentNodeId, new Set());
  return deterministicNodeIds;
}

function workflowNodeSucceeded(status: WorkflowNodeRunStatus | undefined): boolean {
  return status === 'completed' || status === 'skipped';
}

function syncAgentWorkflowNodeRun(
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  now: string,
): void {
  const nodeId = child.workflowNodeId;
  if (!nodeId) return;
  const nodeRun = workflowNodeRun(run, nodeId);
  if (!nodeRun) return;
  const status: WorkflowNodeRunStatus = child.status === 'completed'
    ? 'completed'
    : child.status === 'error' || child.status === 'timeout'
      ? 'failed'
      : child.status === 'aborted'
        ? 'aborted'
        : child.status === 'running' || child.status === 'starting'
          ? 'running'
          : child.status === 'blocked'
            ? 'waiting'
            : 'pending';
  nodeRun.status = status;
  nodeRun.updatedAt = now;
  nodeRun.startedAt = nodeRun.startedAt ?? child.startedAt;
  nodeRun.completedAt = child.completedAt;
  nodeRun.error = child.error;
  nodeRun.waitingReason = child.runtimeWaitReason;
  nodeRun.output = {
    ...(nodeRun.output ?? {}),
    artifacts: child.artifacts ?? [],
    completionSource: child.completionSource,
    iteration: child.iteration,
    count: child.actualCandidateCount,
  };
}

function applyWorkflowFailurePolicy(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  now: string,
): void {
  if (child.status !== 'error' && child.status !== 'timeout') return;
  const node = run.workflowSnapshot?.nodes.find((item) => item.nodeId === child.workflowNodeId);
  const nodeRun = child.workflowNodeId ? workflowNodeRun(run, child.workflowNodeId) : undefined;
  const policy = node?.retryPolicy
    ?? run.workflowSnapshot?.policy.defaultRetryPolicy
    ?? defaultWorkflowPolicy().defaultRetryPolicy;
  const attempts = nodeRun?.attempt ?? 1;
  if (attempts < policy.maxAttempts) {
    const error = child.error;
    resetChildForRerun(cluster, run, child, agent, 'starting', now, child.iteration, {
      preserveSession: true,
      promptMode: 'repair',
      promptReason: `Harness 自动重试第 ${attempts + 1}/${policy.maxAttempts} 次；修复当前 round 的缺失或失败产物。`,
    });
    child.runtimeWaitReason = `自动重试 ${attempts + 1}/${policy.maxAttempts}`;
    addClusterEvent(cluster, {
      runId: run.runId,
      agentId: agent.agentId,
      title: 'Harness 自动重试',
      content: `${agent.name} 第 ${attempts} 次执行失败，Harness 将按策略提交第 ${attempts + 1} 次尝试。${error ? ` 原因：${error}` : ''}`,
      level: 'warning',
      createdAt: now,
    });
    return;
  }
  if (policy.failureAction === 'skip') {
    child.status = 'completed';
    child.completionSource = 'manual';
    child.completionSignal = 'workflow failure policy: skip';
    child.completedAt = now;
    child.error = undefined;
    if (nodeRun) {
      nodeRun.status = 'skipped';
      nodeRun.completedAt = now;
      nodeRun.error = undefined;
    }
    agent.status = 'done';
    agent.localContext.status = 'done';
    agent.currentTask = '失败策略已跳过该节点';
    return;
  }
  if (policy.failureAction === 'pause' || policy.failureAction === 'retry') {
    run.harnessStatus = 'paused';
    run.status = 'blocked';
    cluster.activeRunId = run.runId;
  }
}

export function runtimeFailureAllowsAutoRetry(kind?: AgentClusterRuntimeFailureKind): boolean {
  return !kind;
}

function normalizeTokenUsageNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstTokenUsageNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = normalizeTokenUsageNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function extractWorkflowTokenUsage(message: Record<string, unknown>): { input: number; output: number; total: number } | null {
  const candidates: unknown[] = [
    message.usage,
    message.usageMetadata,
    message.tokenUsage,
  ];
  const details = message.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const detailsRecord = details as Record<string, unknown>;
    candidates.push(detailsRecord.usage, detailsRecord.usageMetadata, detailsRecord.tokenUsage);
  }
  const response = message.response;
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const responseRecord = response as Record<string, unknown>;
    candidates.push(responseRecord.usage, responseRecord.usageMetadata, responseRecord.tokenUsage);
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const input = firstTokenUsageNumber(record, [
      'input',
      'inputTokens',
      'input_tokens',
      'inputTokenCount',
      'input_token_count',
      'promptTokens',
      'prompt_tokens',
      'promptTokenCount',
      'prompt_token_count',
    ]) ?? 0;
    const output = firstTokenUsageNumber(record, [
      'output',
      'outputTokens',
      'output_tokens',
      'outputTokenCount',
      'output_token_count',
      'completionTokens',
      'completion_tokens',
      'completionTokenCount',
      'completion_token_count',
      'candidatesTokenCount',
      'candidates_token_count',
    ]) ?? 0;
    const total = firstTokenUsageNumber(record, [
      'total',
      'totalTokens',
      'total_tokens',
      'totalTokenCount',
      'total_token_count',
    ]) ?? input + output;
    if ([input, output, total].some((value) => Number.isFinite(value) && value > 0)) {
      return { input, output, total };
    }
  }
  return null;
}

function mergeWorkflowTokenUsage(nodeRun: WorkflowNodeRun | undefined, message: Record<string, unknown>): void {
  if (!nodeRun) return;
  const usage = extractWorkflowTokenUsage(message);
  if (!usage) return;
  nodeRun.tokenUsage = {
    input: (nodeRun.tokenUsage?.input ?? 0) + usage.input,
    output: (nodeRun.tokenUsage?.output ?? 0) + usage.output,
    total: (nodeRun.tokenUsage?.total ?? 0) + usage.total,
  };
}

function valueMatchesWorkflowSchema(value: unknown, schema: Record<string, unknown>): boolean {
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    if (required.some((key) => !(key in record))) return false;
    const properties = schema.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const [key, childSchema] of Object.entries(properties as Record<string, unknown>)) {
        if (!(key in record) || !childSchema || typeof childSchema !== 'object' || Array.isArray(childSchema)) continue;
        if (!valueMatchesWorkflowSchema(record[key], childSchema as Record<string, unknown>)) return false;
      }
    }
    return true;
  }
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number' || type === 'integer') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return value !== undefined;
}

function buildLlmGatePrompt(node: WorkflowGateNode, workflow: AgentClusterWorkflow, run: AgentClusterRun): string {
  const predecessorIds = workflowActiveControlPredecessorEdges(workflow, run, node.nodeId).map((edge) => edge.fromNodeId);
  const predecessorRuns = predecessorIds.map((nodeId) => workflowNodeRun(run, nodeId)).filter(Boolean);
  return [
    '你是 InvestClaw Harness 的 LLM Gate。',
    '你的任务是根据上游节点结构化输出和 Gate 要求做质量门禁。',
    '只输出严格 JSON，不要 Markdown。',
    'JSON schema: {"verdict":"pass|fail|revise","reason":"string","nextAction":"string","confidence":0-1}',
    '',
    'Gate 名称：',
    node.name,
    '',
    'Gate 要求：',
    node.evaluationPrompt?.trim() || node.description || '判断上游结果是否足以继续下游。',
    '',
    '上游节点输出：',
    compactText(safeStringify(predecessorRuns.map((nodeRun) => ({
      nodeId: nodeRun?.nodeId,
      status: nodeRun?.status,
      output: nodeRun?.output,
      error: nodeRun?.error,
    }))), 9000),
  ].join('\n');
}

async function evaluateLlmGate(node: WorkflowGateNode, workflow: AgentClusterWorkflow, run: AgentClusterRun): Promise<Required<Pick<LlmGateDecision, 'verdict' | 'reason'>> & Pick<LlmGateDecision, 'nextAction' | 'confidence'>> {
  const model = await resolvePlanningModel({
    sourceType: 'new_task',
    taskGoal: node.evaluationPrompt || node.description || node.name,
  });
  const baseUrl = model.baseUrl.replace(/\/$/, '');
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(LLM_MANAGER_TIMEOUT_MS, 90_000));
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
        ...model.headers,
      },
      body: JSON.stringify({
        model: node.modelId?.trim() || model.model,
        temperature: 0,
        messages: [
          { role: 'system', content: '你是严格 JSON 输出的 workflow gate evaluator。' },
          { role: 'user', content: buildLlmGatePrompt(node, workflow, run) },
        ],
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`LLM Gate 调用失败 (${response.status})${text ? `: ${compactText(text, 240)}` : ''}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM Gate 没有返回判定内容');
    const decision = extractJsonObjectAs<LlmGateDecision>(content);
    const verdict = decision.verdict === 'pass' || decision.verdict === 'fail' || decision.verdict === 'revise'
      ? decision.verdict
      : null;
    if (!verdict) throw new Error('LLM Gate JSON 缺少合法 verdict');
    const reason = decision.reason?.trim();
    if (!reason) throw new Error('LLM Gate JSON 缺少 reason');
    return {
      verdict,
      reason,
      nextAction: decision.nextAction?.trim(),
      confidence: typeof decision.confidence === 'number' && Number.isFinite(decision.confidence)
        ? Math.max(0, Math.min(1, decision.confidence))
        : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('LLM Gate 调用超时', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function gatePasses(node: WorkflowGateNode, workflow: AgentClusterWorkflow, run: AgentClusterRun): { passed: boolean; reason?: string } {
  const predecessorIds = workflowActiveControlPredecessorEdges(workflow, run, node.nodeId).map((edge) => edge.fromNodeId);
  const predecessorRuns = predecessorIds.map((nodeId) => workflowNodeRun(run, nodeId));
  if (!workflowActiveControlPredecessorEdges(workflow, run, node.nodeId).every((edge) => workflowEdgeSatisfied(edge, workflowNodeRun(run, edge.fromNodeId)))) {
    return { passed: false, reason: '等待上游节点完成' };
  }
  const requiredArtifacts = (node.inputContract?.requiredArtifacts ?? node.outputContract?.requiredArtifacts ?? [])
    .map((artifact) => typeof artifact === 'string' ? artifact : runtimeArtifactPath(artifact));
  if (node.gateKind === 'artifact' && requiredArtifacts.length > 0) {
    const artifacts = predecessorRuns.flatMap((nodeRun) => {
      const value = nodeRun?.output?.artifacts;
      return Array.isArray(value) ? value.map(String) : [];
    });
    const missing = requiredArtifacts.filter((required) => !artifacts.some((artifact) => artifact.endsWith(required)));
    if (missing.length > 0) return { passed: false, reason: `缺少产物：${missing.join('、')}` };
  }
  if (node.gateKind === 'count' && typeof node.minimumCount === 'number') {
    const count = predecessorRuns.reduce((total, nodeRun) => total + Number(nodeRun?.output?.count ?? 0), 0);
    if (count < node.minimumCount) return { passed: false, reason: `数量未达标：${count}/${node.minimumCount}` };
  }
  if (node.gateKind === 'schema') {
    const schema = node.inputContract?.schema ?? node.outputContract?.schema;
    if (!schema) return { passed: false, reason: 'Schema Gate 未配置 Schema' };
    const invalid = predecessorRuns.find((nodeRun) => !valueMatchesWorkflowSchema(nodeRun?.output, schema));
    if (invalid) return { passed: false, reason: `上游节点 ${invalid.nodeId} 输出不符合 Schema` };
  }
  if (node.gateKind === 'llm') {
    return { passed: false, reason: '等待 LLM Gate 结构化判定' };
  }
  return { passed: true };
}

async function advanceDeterministicWorkflowNodes(cluster: AgentCluster, run: AgentClusterRun, now: string): Promise<boolean> {
  const workflow = run.workflowSnapshot;
  if (!workflow || !run.nodeRuns) return false;
  let changed = false;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const node of workflow.nodes) {
      if (workflowNodeIsAgent(node)) continue;
      const nodeRun = workflowNodeRun(run, node.nodeId);
      if (!nodeRun || workflowNodeSucceeded(nodeRun.status) || nodeRun.status === 'failed' || nodeRun.status === 'aborted') continue;
      const predecessorEdges = workflowActiveControlPredecessorEdges(workflow, run, node.nodeId);
      const predecessors = predecessorEdges.map((edge) => edge.fromNodeId);
      const predecessorRuns = predecessors.map((nodeId) => workflowNodeRun(run, nodeId));
      const predecessorEdgesReady = predecessorEdges.every((edge) => workflowEdgeSatisfied(edge, workflowNodeRun(run, edge.fromNodeId)));
      if (node.type === 'human_gate') {
        if (predecessorEdgesReady && nodeRun.status !== 'waiting_human') {
          nodeRun.status = 'waiting_human';
          nodeRun.waitingReason = node.prompt;
          nodeRun.updatedAt = now;
          run.harnessStatus = 'waiting_human';
          addClusterEvent(cluster, {
            runId: run.runId,
            agentId: null,
            title: '等待人工确认',
            content: node.prompt,
            level: 'warning',
            createdAt: now,
          });
          changed = true;
        }
        continue;
      }
      if (node.type === 'loop') {
        if (node.repeatCount <= 1 && predecessorEdgesReady) {
          nodeRun.status = 'completed';
          nodeRun.output = { repeatCount: node.repeatCount, bodyNodeIds: node.bodyNodeIds };
          nodeRun.updatedAt = now;
          nodeRun.completedAt = now;
          changed = true;
          progressed = true;
        } else if (nodeRun.status === 'pending') {
          nodeRun.status = 'waiting';
          nodeRun.waitingReason = '等待循环主体完成';
          nodeRun.updatedAt = now;
          changed = true;
        }
        continue;
      }
      if (node.type === 'fan_out') {
        if (predecessorEdgesReady) {
          const items = node.fanOutMode === 'from_output' && node.itemsPath
            ? resolveWorkflowReference(node.itemsPath, cluster, run)
            : undefined;
          const itemArray = Array.isArray(items) ? items : [];
          nodeRun.status = 'completed';
          nodeRun.output = {
            concurrency: node.concurrency,
            fanOutMode: node.fanOutMode ?? 'fixed',
            itemInputName: node.itemInputName,
            items: itemArray.slice(0, 200),
            itemCount: itemArray.length,
            branchNodeIds: workflowControlSuccessors(workflow, node.nodeId),
          };
          nodeRun.updatedAt = now;
          nodeRun.completedAt = now;
          changed = true;
          progressed = true;
        }
        continue;
      }
      if (node.type === 'join') {
        const succeeded = predecessorEdges.filter((edge) => workflowEdgeSatisfied(edge, workflowNodeRun(run, edge.fromNodeId))).length;
        const failed = predecessorRuns.filter((item) => item?.status === 'failed' || item?.status === 'aborted').length;
        const required = node.mode === 'minimum' ? Math.max(1, node.minimumSuccess ?? 1) : predecessorRuns.length;
        if (succeeded >= required) {
          nodeRun.status = 'completed';
          nodeRun.output = { succeeded, failed, required, sourceNodeIds: predecessors };
          nodeRun.updatedAt = now;
          nodeRun.completedAt = now;
          changed = true;
          progressed = true;
        } else if (failed > predecessorRuns.length - required) {
          nodeRun.status = 'failed';
          nodeRun.error = `Join 无法达到成功条件：${succeeded}/${required}`;
          nodeRun.updatedAt = now;
          run.harnessStatus = 'paused';
          changed = true;
        }
        continue;
      }
      if (node.type === 'gate') {
        const predecessorsReady = predecessorEdgesReady;
        if (node.gateKind === 'llm') {
          if (!predecessorsReady) {
            nodeRun.status = 'waiting';
            nodeRun.waitingReason = '等待上游节点完成';
            nodeRun.updatedAt = now;
            changed = true;
            continue;
          }
          nodeRun.status = 'running';
          nodeRun.startedAt = nodeRun.startedAt ?? now;
          nodeRun.updatedAt = now;
          changed = true;
          try {
            const decision = await evaluateLlmGate(node, workflow, run);
            const evaluatedAt = new Date().toISOString();
            node.lastEvaluation = {
              verdict: decision.verdict,
              reason: decision.reason,
              nextAction: decision.nextAction,
              confidence: decision.confidence,
              evaluatedAt,
            };
            nodeRun.output = {
              passed: decision.verdict === 'pass',
              verdict: decision.verdict,
              reason: decision.reason,
              nextAction: decision.nextAction,
              confidence: decision.confidence,
            };
            nodeRun.updatedAt = evaluatedAt;
            if (decision.verdict === 'pass') {
              nodeRun.status = 'completed';
              nodeRun.completedAt = evaluatedAt;
              addClusterEvent(cluster, {
                runId: run.runId,
                agentId: null,
                title: 'LLM Gate 通过',
                content: decision.reason,
                level: 'success',
                createdAt: evaluatedAt,
              });
              progressed = true;
            } else {
              nodeRun.status = 'failed';
              nodeRun.error = decision.reason;
              run.harnessStatus = 'paused';
              addClusterEvent(cluster, {
                runId: run.runId,
                agentId: null,
                title: decision.verdict === 'revise' ? 'LLM Gate 要求修订' : 'LLM Gate 未通过',
                content: [decision.reason, decision.nextAction].filter(Boolean).join('\n'),
                level: 'warning',
                createdAt: evaluatedAt,
              });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            nodeRun.status = 'failed';
            nodeRun.error = message;
            nodeRun.updatedAt = new Date().toISOString();
            run.harnessStatus = 'paused';
            addClusterEvent(cluster, {
              runId: run.runId,
              agentId: null,
              title: 'LLM Gate 失败',
              content: message,
              level: 'error',
              createdAt: nodeRun.updatedAt,
            });
          }
          continue;
        }
        const result = gatePasses(node, workflow, run);
        if (result.passed) {
          nodeRun.status = 'completed';
          nodeRun.output = { passed: true };
          nodeRun.updatedAt = now;
          nodeRun.completedAt = now;
          changed = true;
          progressed = true;
        } else {
          nodeRun.status = 'waiting';
          nodeRun.waitingReason = result.reason;
          nodeRun.updatedAt = now;
        }
      }
    }
  }
  return changed;
}

function isWorkflowAgentNodeReady(run: AgentClusterRun, workflowNodeId: string): boolean {
  const workflow = run.workflowSnapshot;
  if (!workflow) return true;
  const predecessorEdges = workflowActiveControlPredecessorEdges(workflow, run, workflowNodeId);
  return predecessorEdges.every((edge) => workflowEdgeSatisfied(edge, workflowNodeRun(run, edge.fromNodeId)));
}

function childRequiredArtifactsSatisfied(child: AgentClusterChildRun | undefined): boolean {
  if (!child) return false;
  if (child.status !== 'completed') return false;
  return !child.expectedArtifacts?.length || child.artifactValidationStatus === 'passed';
}

function areBlockingUpstreamAgentsSatisfied(cluster: AgentCluster, run: AgentClusterRun, agentId: string): boolean {
  const upstreamIds = getBlockingUpstreamAgentIds(cluster, agentId);
  return upstreamIds.every((upstreamAgentId) =>
    childRequiredArtifactsSatisfied(run.childRuns.find((child) => child.agentId === upstreamAgentId))
  );
}

function isAgentChildReadyForDispatch(cluster: AgentCluster, run: AgentClusterRun, child: AgentClusterChildRun): boolean {
  const workflowReady = child.workflowNodeId ? isWorkflowAgentNodeReady(run, child.workflowNodeId) : true;
  if (!workflowReady) return false;
  if (!isProjectDirectoryRuntimeMode(cluster)) return true;
  return areBlockingUpstreamAgentsSatisfied(cluster, run, child.agentId);
}

function hasWorkflowFanOutCapacity(run: AgentClusterRun, workflowNodeId: string): boolean {
  const workflow = run.workflowSnapshot;
  if (!workflow) return true;
  const fanOutNodes = workflowControlPredecessors(workflow, workflowNodeId)
    .map((nodeId) => workflow.nodes.find((node) => node.nodeId === nodeId))
    .filter((node): node is WorkflowFanOutNode => node?.type === 'fan_out');
  return fanOutNodes.every((fanOut) => {
    const branchNodeIds = new Set(workflowControlSuccessors(workflow, fanOut.nodeId));
    const runningBranches = (run.nodeRuns ?? []).filter((nodeRun) =>
      branchNodeIds.has(nodeRun.nodeId)
      && (nodeRun.status === 'running' || nodeRun.status === 'recovering')
    ).length;
    return runningBranches < fanOut.concurrency;
  });
}

function updateWorkflowCheckpoint(run: AgentClusterRun, now: string): void {
  if (!run.workflowSnapshot || !run.nodeRuns) return;
  run.phaseRuns = summarizeWorkflowPhases(run, now);
  run.checkpoint = {
    checkpointId: `checkpoint-${randomUUID()}`,
    runId: run.runId,
    workflowId: run.workflowSnapshot.workflowId,
    workflowVersion: run.workflowSnapshot.version,
    status: run.harnessStatus === 'paused' || run.harnessStatus === 'waiting_human'
      ? 'paused'
      : run.harnessStatus === 'completed'
        ? 'completed'
        : run.harnessStatus === 'failed'
          ? 'failed'
          : run.harnessStatus === 'aborted'
            ? 'aborted'
            : 'running',
    nodeRuns: structuredClone(run.nodeRuns),
    createdAt: now,
  };
}

function summarizeWorkflowPhases(run: AgentClusterRun, now: string): WorkflowPhaseRun[] {
  const workflow = run.workflowSnapshot;
  if (!workflow || !run.nodeRuns) return [];
  const nodeRunById = new Map(run.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
  const agentNodeIds = workflow.nodes.filter(workflowNodeIsAgent).map((node) => node.nodeId);
  const operatorNodeIds = workflow.nodes.filter((node) => !workflowNodeIsAgent(node)).map((node) => node.nodeId);
  const groups: Array<{ phaseId: string; name: string; nodeIds: string[] }> = [
    { phaseId: 'agents', name: 'Agent 执行', nodeIds: agentNodeIds },
    { phaseId: 'harness', name: 'Harness 控制', nodeIds: operatorNodeIds },
  ].filter((group) => group.nodeIds.length > 0);
  return groups.map((group) => {
    const runs = group.nodeIds.map((nodeId) => nodeRunById.get(nodeId)).filter((item): item is WorkflowNodeRun => Boolean(item));
    const runningCount = runs.filter((item) => item.status === 'running' || item.status === 'recovering').length;
    const completedCount = runs.filter((item) => workflowNodeSucceeded(item.status)).length;
    const failedCount = runs.filter((item) => workflowNodeFailed(item.status)).length;
    const startedAt = runs.map((item) => item.startedAt).filter((value): value is string => Boolean(value)).sort()[0];
    const completedAt = completedCount === runs.length
      ? runs.map((item) => item.completedAt).filter((value): value is string => Boolean(value)).sort().at(-1)
      : undefined;
    const status: WorkflowPhaseRun['status'] = failedCount > 0
      ? 'failed'
      : completedCount === runs.length && runs.length > 0
        ? 'completed'
        : runningCount > 0
          ? 'running'
          : runs.some((item) => item.status === 'waiting' || item.status === 'waiting_human')
            ? 'waiting'
            : 'pending';
    const tokenUsage = runs.reduce<NonNullable<WorkflowPhaseRun['tokenUsage']>>((total, item) => ({
      input: (total.input ?? 0) + (item.tokenUsage?.input ?? 0),
      output: (total.output ?? 0) + (item.tokenUsage?.output ?? 0),
      total: (total.total ?? 0) + (item.tokenUsage?.total ?? 0),
    }), {});
    return {
      phaseId: group.phaseId,
      name: group.name,
      nodeIds: group.nodeIds,
      status,
      agentCount: group.nodeIds.filter((nodeId) => workflow.nodes.some((node) => workflowNodeIsAgent(node) && node.nodeId === nodeId)).length,
      runningCount,
      completedCount,
      failedCount,
      retryCount: runs.reduce((total, item) => total + Math.max(0, item.attempt - 1), 0),
      tokenUsage,
      startedAt,
      completedAt,
      durationMs: startedAt ? new Date(completedAt ?? now).getTime() - new Date(startedAt).getTime() : undefined,
      summary: `${completedCount}/${runs.length} 完成`,
    };
  });
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

function shouldAppendRuntimeEvent(
  cluster: AgentCluster,
  input: Omit<AgentClusterEvent, 'eventId' | 'clusterId' | 'createdAt'>,
  createdAt: string,
): boolean {
  if (input.display === 'silent') return false;
  const duplicateWindowMs = input.title === '子会话活动' ? 60_000 : 8_000;
  const currentMs = new Date(createdAt).getTime();
  const duplicate = (cluster.events ?? []).find((event) =>
    event.runId === input.runId
    && event.agentId === input.agentId
    && event.title === input.title
    && event.content === input.content
  );
  if (!duplicate) return true;
  const duplicateMs = new Date(duplicate.createdAt).getTime();
  return !Number.isFinite(currentMs)
    || !Number.isFinite(duplicateMs)
    || currentMs - duplicateMs > duplicateWindowMs;
}

function appendRuntimeEventIfVisible(
  cluster: AgentCluster,
  input: Omit<AgentClusterEvent, 'eventId' | 'clusterId' | 'createdAt'>,
  createdAt: string,
): boolean {
  if (!shouldAppendRuntimeEvent(cluster, input, createdAt)) return false;
  addClusterEvent(cluster, { ...input, createdAt });
  return true;
}

function findRun(cluster: AgentCluster, runId: string): AgentClusterRun {
  const run = (cluster.runs ?? []).find((item) => item.runId === runId);
  if (!run) throw new Error('Agent Cluster run not found');
  return run;
}

function isChildReadyForDispatchNow(cluster: AgentCluster, run: AgentClusterRun, child: AgentClusterChildRun): boolean {
  if (child.status === 'completed' || child.status === 'error' || child.status === 'timeout' || child.status === 'aborted') return false;
  if (child.submitStatus === 'submitted' && child.runId) return false;
  if (child.workflowNodeId && run.workflowSnapshot) {
    return isAgentChildReadyForDispatch(cluster, run, child);
  }
  const upstreamIds = getBlockingUpstreamAgentIds(cluster, child.agentId);
  return upstreamIds.every((agentId) =>
    childRequiredArtifactsSatisfied(run.childRuns.find((item) => item.agentId === agentId))
  );
}

function hasDispatchablePendingChild(cluster: AgentCluster, run: AgentClusterRun): boolean {
  return run.childRuns.some((child) => isChildReadyForDispatchNow(cluster, run, child));
}

function hasStartingPendingDispatchableChild(cluster: AgentCluster, run: AgentClusterRun): boolean {
  return run.childRuns.some((child) =>
    child.status === 'starting'
    && child.submitStatus === 'pending'
    && !child.runId
    && isChildReadyForDispatchNow(cluster, run, child)
  );
}

function resumeRunForDispatchableManualProgress(
  cluster: AgentCluster,
  run: AgentClusterRun,
  now: string,
): boolean {
  if (run.harnessStatus === 'waiting_human') return false;
  if (!hasDispatchablePendingChild(cluster, run)) return false;
  const changed = run.status !== 'running'
    || run.harnessStatus !== 'running'
    || cluster.activeRunId !== run.runId
    || run.watchdogStatus !== 'watching'
    || Boolean(run.completedAt)
    || Boolean(run.error);
  run.status = 'running';
  run.harnessStatus = 'running';
  run.error = undefined;
  run.completedAt = undefined;
  run.watchdogStatus = 'watching';
  run.timeoutAt = new Date(Date.now() + RUN_TIMEOUT_MS).toISOString();
  cluster.activeRunId = run.runId;
  if (changed) {
    addClusterEvent(cluster, {
      runId: run.runId,
      agentId: null,
      title: '恢复调度',
      content: '手动放行产生了新的可执行节点，Harness 已恢复调度并将提交下一 ready Agent。',
      level: 'info',
      createdAt: now,
    });
  }
  return changed;
}

export function countSubmittedActiveChildRuns(run: Pick<AgentClusterRun, 'childRuns'>): number {
  return run.childRuns.filter((child) =>
    (child.status === 'running' || child.status === 'starting')
    && (child.submitStatus === 'submitted' || Boolean(child.runId))
  ).length;
}

export function summarizeRuntimeSessionFailure(entry: Record<string, unknown>): string | null {
  const status = String(entry.status ?? '').toLowerCase();
  const message = entry.message && typeof entry.message === 'object'
    ? entry.message as Record<string, unknown>
    : null;
  const stopReason = String(entry.stopReason ?? message?.stopReason ?? '').toLowerCase();
  if (status !== 'failed' && status !== 'error' && stopReason !== 'error') return null;
  const explicitError = [
    entry.error,
    entry.errorMessage,
    typeof entry.message === 'string' ? entry.message : undefined,
    message?.error,
    message?.errorMessage,
  ].find((value) => typeof value === 'string' && value.trim());
  if (typeof explicitError === 'string') return compactText(explicitError, 600);

  const runtimeMs = Number(entry.runtimeMs);
  const duration = Number.isFinite(runtimeMs) && runtimeMs > 0
    ? `，运行约 ${Math.max(1, Math.round(runtimeMs / 1000))} 秒`
    : '';
  return `OpenClaw 子会话状态为 ${status}${duration}，但 transcript 未提供可读错误正文。`;
}

function runtimeSessionIsDone(entry: Record<string, unknown>): boolean {
  const status = String(entry.status ?? '').toLowerCase();
  const message = entry.message && typeof entry.message === 'object'
    ? entry.message as Record<string, unknown>
    : null;
  const stopReason = String(entry.stopReason ?? message?.stopReason ?? '').toLowerCase();
  return status === 'done' || stopReason === 'done' || stopReason === 'completed';
}

function runtimeSessionDurationText(entry: Record<string, unknown>): string {
  const runtimeMs = Number(entry.runtimeMs);
  return Number.isFinite(runtimeMs) && runtimeMs > 0
    ? `，运行约 ${Math.max(1, Math.round(runtimeMs / 1000))} 秒`
    : '';
}

function messageIsThinkingOnly(message: Record<string, unknown>): boolean {
  if (String(message.role ?? '').toLowerCase() !== 'assistant') return false;
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((block) => {
    if (!block || typeof block !== 'object') return false;
    const record = block as Record<string, unknown>;
    return record.type === 'thinking' || record.type === 'redacted_thinking';
  });
}

function messageStopReason(message: Record<string, unknown> | null): string {
  if (!message) return '';
  return String(
    message.stopReason
    ?? message.finishReason
    ?? message.finish_reason
    ?? message.stop_reason
    ?? '',
  ).toLowerCase();
}

function runtimeAgentIdFromSessionKey(sessionKey?: string): string {
  const parts = String(sessionKey || '').split(':');
  return parts[1]?.trim() || 'main';
}

async function runtimeModelLimitDiagnostic(entry: Record<string, unknown>, child: AgentClusterChildRun): Promise<string> {
  const model = typeof entry.model === 'string' ? entry.model.trim() : '';
  if (!model) return '未能从 OpenClaw session metadata 读取模型名称。';
  const runtimeAgentId = runtimeAgentIdFromSessionKey(child.sessionKey);
  const modelsPath = join(getOpenClawConfigDir(), 'agents', runtimeAgentId, 'agent', 'models.json');
  try {
    const data = JSON.parse(await readFile(modelsPath, 'utf8')) as { providers?: Record<string, { models?: Array<Record<string, unknown>> }> };
    const modelId = model.includes('/') ? model.split('/').pop() || model : model;
    for (const provider of Object.values(data.providers ?? {})) {
      const match = (provider.models ?? []).find((candidate) => {
        const id = typeof candidate.id === 'string' ? candidate.id : '';
        return id === model || id === modelId || `${id}`.endsWith(`/${modelId}`);
      });
      if (!match) continue;
      const contextWindow = typeof match.contextWindow === 'number' ? match.contextWindow : undefined;
      const maxTokens = typeof match.maxTokens === 'number' ? match.maxTokens : undefined;
      if (!contextWindow && !maxTokens) {
        return `当前运行 agent(${runtimeAgentId}) 的 models.json 中，模型 ${model} 未配置 contextWindow/maxTokens。`;
      }
      return `当前运行 agent(${runtimeAgentId}) 的模型限额：contextWindow=${contextWindow ?? '未配置'}，maxTokens=${maxTokens ?? '未配置'}。`;
    }
    return `当前运行 agent(${runtimeAgentId}) 的 models.json 中未找到模型 ${model} 的 entry。`;
  } catch {
    return `无法读取当前运行 agent(${runtimeAgentId}) 的 models.json 以确认 maxTokens/contextWindow。`;
  }
}

async function readLastTranscriptMessage(sessionFile: unknown): Promise<Record<string, unknown> | null> {
  if (typeof sessionFile !== 'string' || !sessionFile.trim()) return null;
  const raw = await readFile(sessionFile, 'utf8').catch(() => '');
  if (!raw.trim()) return null;
  const lines = raw.trim().split(/\n+/).slice(-80).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (record.role || record.content) return record;
        const message = record.message;
        if (message && typeof message === 'object' && !Array.isArray(message)) {
          return message as Record<string, unknown>;
        }
      }
    } catch {
      // Skip malformed transcript lines.
    }
  }
  return null;
}

export async function summarizeRuntimeDoneMissingArtifacts(
  entry: Record<string, unknown>,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
): Promise<string | null> {
  if (!runtimeSessionIsDone(entry)) return null;
  const expectedArtifacts = expectedArtifactsForRunAgent(run, agent);
  if (expectedArtifacts.length === 0) return null;
  const outputRoot = run.outputRoot?.trim();
  if (!outputRoot) {
    return `OpenClaw 子会话已结束${runtimeSessionDurationText(entry)}，但当前节点定义了产物契约，Harness 无法定位本轮输出目录。`;
  }

  const missing: string[] = [];
  for (const artifact of expectedArtifacts) {
    const matches = await resolveExpectedArtifactMatches(outputRoot, agent, child, artifact);
    if (matches.length === 0) missing.push(normalizeExpectedArtifactForRound(artifact, child));
  }
  if (missing.length === 0) return null;

  const lastMessage = await readLastTranscriptMessage(entry.sessionFile);
  const thinkingOnly = lastMessage ? messageIsThinkingOnly(lastMessage) : false;
  const lastStopReason = messageStopReason(lastMessage);
  const stoppedByOutputLimit = /length|max_tokens?|output_limit|token_limit/.test(lastStopReason);
  const collectionOrIntermediateMissing = missing.some((artifact) =>
    /\bpart_\w+\b|draft|checkpoint|intermediate|partial|中间产物/i.test(artifact)
  );
  const modelLimitDiagnostic = stoppedByOutputLimit ? await runtimeModelLimitDiagnostic(entry, child) : '';
  const diagnostic = stoppedByOutputLimit
    ? `最后一次模型输出被长度上限截断（stopReason=${lastStopReason || 'length'}），这不是 Harness 给了 ${Math.max(1, Math.round(Number(entry.runtimeMs) / 1000))} 秒超时；${modelLimitDiagnostic} 请提高该模型的 maxTokens/contextWindow，或让 Agent 先写最小 required artifact 再继续分批生成。`
    : thinkingOnly && collectionOrIntermediateMissing
    ? '最后 transcript 停在 thinking：模型可能已经形成输出思路，但未落盘显式契约要求的中间产物或最终产物；请重试或从该 Agent 开始。'
    : '请重试或从该 Agent 开始。';
  return `OpenClaw 子会话已结束${runtimeSessionDurationText(entry)}，但未交付当前节点必需产物：${missing.join('、')}。${diagnostic}`;
}

function resolveSessionFileFromEntry(entry: Record<string, unknown>, sessionsDir: string): string | null {
  const rawFile = [entry.sessionFile, entry.file, entry.fileName, entry.path]
    .find((value) => typeof value === 'string' && value.trim());
  if (typeof rawFile === 'string') {
    if (isAbsolute(rawFile)) return rawFile;
    return join(sessionsDir, rawFile.endsWith('.jsonl') ? rawFile : `${rawFile}.jsonl`);
  }

  const rawId = [entry.sessionId, entry.id]
    .find((value) => typeof value === 'string' && value.trim());
  if (typeof rawId === 'string') {
    return join(sessionsDir, rawId.endsWith('.jsonl') ? rawId : `${rawId}.jsonl`);
  }

  return null;
}

async function readRuntimeSessionStoreEntry(sessionKey: string): Promise<Record<string, unknown> | null> {
  const parts = sessionKey.split(':');
  const agentId = parts[1];
  if (!agentId) return null;
  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');
  const raw = await readFile(sessionsJsonPath, 'utf8').catch(() => '');
  if (!raw.trim()) return null;

  try {
    const store = JSON.parse(raw) as Record<string, unknown>;
    const directEntry = store[sessionKey];
    if (directEntry && typeof directEntry === 'object' && !Array.isArray(directEntry)) {
      const entry = { ...(directEntry as Record<string, unknown>) };
      entry.sessionFile = entry.sessionFile ?? resolveSessionFileFromEntry(entry, sessionsDir);
      return entry;
    }

    const sessions = store.sessions;
    if (Array.isArray(sessions)) {
      const arrayEntry = sessions.find((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const record = entry as Record<string, unknown>;
        return record.key === sessionKey || record.sessionKey === sessionKey;
      });
      if (arrayEntry && typeof arrayEntry === 'object' && !Array.isArray(arrayEntry)) {
        const entry = { ...(arrayEntry as Record<string, unknown>) };
        entry.sessionFile = entry.sessionFile ?? resolveSessionFileFromEntry(entry, sessionsDir);
        return entry;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getBlockingUpstreamAgentIds(cluster: AgentCluster, agentId: string): string[] {
  const workflow = getCurrentWorkflow(cluster);
  const targetNode = workflow.nodes.find((node) => workflowNodeIsAgent(node) && node.agentId === agentId);
  if (targetNode) {
    const incoming = new Map<string, string[]>();
    for (const edge of workflow.edges.filter((item) => item.kind === 'control')) {
      incoming.set(edge.toNodeId, [...(incoming.get(edge.toNodeId) ?? []), edge.fromNodeId]);
    }
    const result = new Set<string>();
    const seen = new Set<string>();
    const visit = (nodeId: string) => {
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
      for (const upstreamNodeId of incoming.get(nodeId) ?? []) {
        const upstreamNode = workflow.nodes.find((node) => node.nodeId === upstreamNodeId);
        if (!upstreamNode) continue;
        if (workflowNodeIsAgent(upstreamNode)) {
          result.add(upstreamNode.agentId);
        } else {
          visit(upstreamNodeId);
        }
      }
    };
    visit(targetNode.nodeId);
    return [...result];
  }
  const graph = normalizeExecutionGraph(cluster);
  return graph.edges
    .filter((edge) => edge.toAgentId === agentId && isBlockingExecutionEdge(edge))
    .map((edge) => edge.fromAgentId);
}

function getBlockingDownstreamAgentIds(cluster: AgentCluster, agentId: string): string[] {
  const workflow = getCurrentWorkflow(cluster);
  const sourceNode = workflow.nodes.find((node) => workflowNodeIsAgent(node) && node.agentId === agentId);
  if (sourceNode) {
    const outgoing = new Map<string, string[]>();
    for (const edge of workflow.edges.filter((item) => item.kind === 'control')) {
      outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    }
    const result = new Set<string>();
    const seen = new Set<string>();
    const visit = (nodeId: string) => {
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
      for (const downstreamNodeId of outgoing.get(nodeId) ?? []) {
        const downstreamNode = workflow.nodes.find((node) => node.nodeId === downstreamNodeId);
        if (!downstreamNode) continue;
        if (workflowNodeIsAgent(downstreamNode)) {
          result.add(downstreamNode.agentId);
        } else {
          visit(downstreamNodeId);
        }
      }
    };
    visit(sourceNode.nodeId);
    return [...result];
  }
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
      outputRoundStart: getRunRoundStart(run),
      status: 'idle',
      updatedAt: now,
    };
    run.loopStates.push(state);
  }
  state.repeatCount = loop.repeatCount;
  state.outputRoundStart = getLoopOutputRoundStart(run, state);
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
  options: {
    preserveSession?: boolean;
    promptMode?: AgentClusterChildPromptMode;
    promptReason?: string;
  } = {},
): void {
  const projectDirectoryMode = isProjectDirectoryRuntimeMode(cluster);
  const preserveSession = !projectDirectoryMode && options.preserveSession && Boolean(child.sessionKey);
  if (!preserveSession) {
    child.sessionKey = buildAgentChildSessionKey(cluster, run.runId, child.agentId, now);
  }
  child.status = status;
  child.submitStatus = 'pending';
  child.runId = '';
  child.error = undefined;
  child.runtimeFailureKind = undefined;
  child.promptMode = options.promptMode ?? 'initial';
  child.promptReason = options.promptReason;
  child.completedAt = undefined;
  child.completionSignal = undefined;
  child.completionSource = undefined;
  child.unblockedAgentIds = [];
  child.artifacts = [];
  child.iteration = iteration;
  child.expectedArtifacts = agent ? expectedArtifactLabelsForRunAgent(run, agent, child) : [];
  child.artifactValidationStatus = child.expectedArtifacts.length > 0 ? 'pending' : undefined;
  child.artifactValidationError = undefined;
  child.targetCandidateCount = undefined;
  child.minAcceptedCandidateCount = undefined;
  child.actualCandidateCount = undefined;
  child.outputRoot = run.outputRoot ?? child.outputRoot;
  child.outputRelativeDir = agent
    ? buildDefaultAgentOutputRelativeDir(agent.agentId, iteration ?? getChildIteration(child))
    : child.outputRelativeDir;
  child.lastEventAt = preserveSession ? now : undefined;
  if (!preserveSession) child.lastTranscriptMessageId = undefined;
  child.startedAt = now;
  child.updatedAt = now;
  if (child.workflowNodeId) {
    const nodeRun = workflowNodeRun(run, child.workflowNodeId);
    if (nodeRun) {
      nodeRun.status = status === 'starting' ? 'ready' : 'waiting';
      nodeRun.error = undefined;
      nodeRun.output = undefined;
      nodeRun.completedAt = undefined;
      nodeRun.waitingReason = status === 'starting' ? undefined : '等待上游重新完成';
      nodeRun.updatedAt = now;
    }
  }
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

function resetWorkflowNodeForLoopIteration(run: AgentClusterRun, nodeId: string, now: string): void {
  const nodeRun = workflowNodeRun(run, nodeId);
  if (!nodeRun) return;
  nodeRun.status = 'pending';
  nodeRun.output = undefined;
  nodeRun.error = undefined;
  nodeRun.completedAt = undefined;
  nodeRun.waitingReason = '等待循环本轮上游完成';
  nodeRun.updatedAt = now;
}

function maybeAdvanceExecutionLoops(
  cluster: AgentCluster,
  run: AgentClusterRun,
  completedAgentId: string,
  now: string,
): void {
  const workflow = run.workflowSnapshot ?? getCurrentWorkflow(cluster);
  const projectDirectoryMode = isProjectDirectoryRuntimeMode(cluster);
  for (const loop of workflow.nodes.filter((node): node is WorkflowLoopNode => node.type === 'loop')) {
    if (loop.repeatCount <= 1) continue;
    const orderedBodyNodeIds = getOrderedWorkflowLoopBodyNodeIds(workflow, loop);
    const path = orderedBodyNodeIds
      .map((nodeId) => workflow.nodes.find((node) => node.nodeId === nodeId))
      .filter((node): node is WorkflowAgentNode => Boolean(node) && workflowNodeIsAgent(node))
      .map((node) => node.agentId);
    if (path.length === 0 || path[path.length - 1] !== completedAgentId) continue;
    const pathChildren = path
      .map((agentId) => run.childRuns.find((child) => child.agentId === agentId))
      .filter((child): child is AgentClusterChildRun => Boolean(child));
    if (pathChildren.length !== path.length || !pathChildren.every((child) => child.status === 'completed')) continue;

    const legacyLoop: AgentClusterExecutionLoop = {
      loopId: loop.nodeId,
      startAgentId: path[0],
      endAgentId: path[path.length - 1],
      repeatCount: loop.repeatCount,
    };
    const state = getLoopState(run, legacyLoop, now);
    if (state.currentIteration >= loop.repeatCount) {
      state.status = 'completed';
      state.updatedAt = now;
      const loopNodeRun = workflowNodeRun(run, loop.nodeId);
      if (loopNodeRun) {
        loopNodeRun.status = 'completed';
        loopNodeRun.output = { repeatCount: loop.repeatCount, bodyNodeIds: orderedBodyNodeIds };
        loopNodeRun.updatedAt = now;
        loopNodeRun.completedAt = now;
      }
      continue;
    }

    const nextIteration = state.currentIteration + 1;
    state.currentIteration = nextIteration;
    state.status = 'running';
    state.updatedAt = now;
    const loopNodeRun = workflowNodeRun(run, loop.nodeId);
    if (loopNodeRun) {
      loopNodeRun.status = 'waiting';
      loopNodeRun.completedAt = undefined;
      loopNodeRun.output = undefined;
      loopNodeRun.waitingReason = '等待循环主体完成';
      loopNodeRun.updatedAt = now;
    }
    for (const deterministicNodeId of collectLoopDeterministicNodeIds(workflow, loop)) {
      resetWorkflowNodeForLoopIteration(run, deterministicNodeId, now);
    }

    path.forEach((agentId, index) => {
      const child = run.childRuns.find((item) => item.agentId === agentId);
      const agent = cluster.agents.find((item) => item.agentId === agentId);
      if (!child) return;
      const outputRound = getOutputRoundForLoopStateIteration(run, state, nextIteration);
      resetChildForRerun(cluster, run, child, agent, index === 0 ? 'starting' : 'blocked', now, outputRound, {
        preserveSession: !projectDirectoryMode,
        promptMode: 'continuation',
        promptReason: projectDirectoryMode
          ? `循环第 ${nextIteration}/${loop.repeatCount} 轮；使用新的 ${agent?.name ?? agentId} 子会话，显式上游产物和 runtime contract 作为上下文。`
          : `循环第 ${nextIteration}/${loop.repeatCount} 轮；复用上一轮 ${agent?.name ?? agentId} 子会话上下文。`,
      });
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
      content: `循环链路 ${path.map((agentId) => cluster.agents.find((agent) => agent.agentId === agentId)?.name ?? agentId).join(' → ')} 进入第 ${nextIteration}/${state.repeatCount} 轮，写入集群目录 round_${getOutputRoundForLoopStateIteration(run, state, nextIteration)}。`,
      level: 'info',
      createdAt: now,
    });
  }
}

function reconcileCompletedExecutionLoops(cluster: AgentCluster, run: AgentClusterRun, now: string): boolean {
  const workflow = run.workflowSnapshot ?? getCurrentWorkflow(cluster);
  const before = JSON.stringify(run.loopStates ?? []);
  for (const loop of workflow.nodes.filter((node): node is WorkflowLoopNode => node.type === 'loop')) {
    if (loop.repeatCount <= 1) continue;
    const orderedBodyNodeIds = getOrderedWorkflowLoopBodyNodeIds(workflow, loop);
    const path = orderedBodyNodeIds
      .map((nodeId) => workflow.nodes.find((node) => node.nodeId === nodeId))
      .filter((node): node is WorkflowAgentNode => Boolean(node) && workflowNodeIsAgent(node))
      .map((node) => node.agentId);
    const lastAgentId = path[path.length - 1];
    if (!lastAgentId) continue;
    if (run.childRuns.find((child) => child.agentId === lastAgentId)?.status !== 'completed') continue;
    maybeAdvanceExecutionLoops(cluster, run, lastAgentId, now);
  }
  return JSON.stringify(run.loopStates ?? []) !== before;
}

function buildDependencySummary(cluster: AgentCluster, agent: ClusterAgent, run?: AgentClusterRun | null): string {
  const upstreamIds = getBlockingUpstreamAgentIds(cluster, agent.agentId);
  if (upstreamIds.length === 0) return '无阻塞上游，可以作为当前阶段入口执行。';
  return upstreamIds
    .map((agentId) => {
      const upstream = cluster.agents.find((item) => item.agentId === agentId);
      const upstreamChild = run?.childRuns.find((child) => child.agentId === agentId);
      if (run && (!upstreamChild || upstreamChild.status !== 'completed')) {
        return `- ${upstream?.name ?? agentId}：等待上游完成。`;
      }
      if (upstreamChild?.expectedArtifacts?.length && upstreamChild.artifactValidationStatus !== 'passed') {
        return `- ${upstream?.name ?? agentId}：等待上游产物校验通过。`;
      }
      const outputs = sanitizeTextForAgentPrompt(
        agent,
        upstream?.localContext.outputs.slice(-2).map((output) => output.content).join('\n') ?? '',
        600,
      );
      const runArtifacts = (upstreamChild?.artifacts ?? [])
        .filter((artifact) => sanitizeArtifactsForAgentPrompt(agent, [artifact]).length > 0)
        .filter((artifact) => artifactMatchesAllowedForPrompt(artifact, upstreamChild?.expectedArtifacts ?? []))
        .slice(-4);
      const sharedArtifacts = (cluster.sharedContext.latestArtifacts ?? [])
        .filter((artifact) => artifact.agentId === agentId)
        .map((artifact) => artifact.artifact)
        .filter((artifact) => sanitizeArtifactsForAgentPrompt(agent, [artifact]).length > 0)
        .slice(-4)
        ;
      const artifacts = (runArtifacts.length > 0 ? runArtifacts : sharedArtifacts).join('、');
      const details = [
        outputs || '上游已完成，请基于其职责产物继续。',
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
  const summaries = uniqueIds
    .map((agentId): string | null => {
      const upstream = cluster.agents.find((item) => item.agentId === agentId);
      const rawOutputs = upstream?.localContext.outputs.slice(-2).map((output) => output.content).join('\n') ?? '';
      const artifacts = (cluster.sharedContext.latestArtifacts ?? [])
        .filter((artifact) => artifact.agentId === agentId)
        .map((artifact) => artifact.artifact)
        .filter((artifact) => sanitizeArtifactsForAgentPrompt(agent, [artifact]).length > 0)
        .slice(-3)
        .join('、');
      if (!rawOutputs.trim() && !artifacts.trim()) return null;
      const agentSummary = sanitizeTextForAgentPrompt(
        agent,
        cluster.sharedContext.agentSummaries?.find((summary) => summary.agentId === agentId)?.summary ?? '',
        500,
      );
      const outputs = sanitizeTextForAgentPrompt(
        agent,
        rawOutputs,
        500,
      );
      const details = [agentSummary, outputs, artifacts ? `相关产物：${artifacts}` : '']
        .filter(Boolean)
        .join('\n');
      return details ? `- ${upstream?.name ?? agentId}：${compactText(details, 800)}` : null;
    })
    .filter((summary): summary is string => Boolean(summary));
  return summaries.length > 0 ? summaries.join('\n') : '无。';
}

function buildReferenceArtifactContextSummary(cluster: AgentCluster, agent: ClusterAgent): string {
  const graph = normalizeExecutionGraph(cluster);
  const referenceIds = Array.from(new Set(graph.edges
    .filter((edge) => edge.toAgentId === agent.agentId && !isBlockingExecutionEdge(edge))
    .map((edge) => edge.fromAgentId)));
  if (referenceIds.length === 0) return '无。';
  const summaries = referenceIds
    .map((agentId): string | null => {
      const upstream = cluster.agents.find((item) => item.agentId === agentId);
      const artifacts = (cluster.sharedContext.latestArtifacts ?? [])
        .filter((artifact) => artifact.agentId === agentId)
        .map((artifact) => artifact.artifact)
        .filter((artifact) => sanitizeArtifactsForAgentPrompt(agent, [artifact]).length > 0)
        .slice(-3);
      if (artifacts.length === 0) return null;
      return `- ${upstream?.name ?? agentId}：参考产物：${artifacts.join('、')}`;
    })
    .filter((summary): summary is string => Boolean(summary));
  return summaries.length > 0 ? summaries.join('\n') : '无。';
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

function getChildIteration(child?: AgentClusterChildRun): number {
  const value = Number(child?.iteration);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function safeOutputSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'agent';
}

function buildDefaultAgentOutputRelativeDir(agentId: string, iteration = 1): string {
  return `agents/${safeOutputSegment(agentId)}/round_${Math.max(1, Math.floor(iteration || 1))}`;
}

function getRunRoundStart(run: AgentClusterRun): number {
  const value = Number(run.roundStart);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function getLoopOutputRoundStart(run: AgentClusterRun, state?: Pick<AgentClusterRunLoopState, 'outputRoundStart'> | null): number {
  const value = Number(state?.outputRoundStart);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : getRunRoundStart(run);
}

function getOutputRoundForLoopStateIteration(
  run: AgentClusterRun,
  state: Pick<AgentClusterRunLoopState, 'currentIteration' | 'outputRoundStart'>,
  loopIteration = state.currentIteration,
): number {
  return getLoopOutputRoundStart(run, state) + Math.max(1, Math.floor(loopIteration || 1)) - 1;
}

function getClusterProjectRoot(cluster: AgentCluster): string | null {
  return cluster.projectRoot?.trim() || cluster.sourceFolderPath?.trim() || null;
}

function workflowAgentNodeForRun(run: AgentClusterRun, agent: ClusterAgent): WorkflowAgentNode | null {
  const node = run.workflowSnapshot?.nodes.find((item) => workflowNodeIsAgent(item) && item.agentId === agent.agentId);
  return node && workflowNodeIsAgent(node) ? node : null;
}

function workflowOutputContractArtifacts(run: AgentClusterRun, agent: ClusterAgent): RuntimeArtifactRef[] {
  const node = workflowAgentNodeForRun(run, agent);
  const requiredArtifacts = node?.outputContract?.requiredArtifacts;
  if (!requiredArtifacts?.length) return [];
  return sanitizeRuntimeArtifactRefs(requiredArtifacts);
}

function expectedArtifactsForRunAgent(run: AgentClusterRun, agent: ClusterAgent): RuntimeArtifactRef[] {
  const contractArtifacts = workflowOutputContractArtifacts(run, agent);
  return contractArtifacts;
}

function expectedArtifactLabelsForRunAgent(run: AgentClusterRun, agent: ClusterAgent, child?: AgentClusterChildRun): string[] {
  return expectedArtifactsForRunAgent(run, agent)
    .map((artifact) => child ? normalizeExpectedArtifactForRound(artifact, child) : runtimeArtifactLabel(artifact));
}

function milestoneArtifactGuidanceForPrompt(run: AgentClusterRun | null, child: AgentClusterChildRun | null, agent: ClusterAgent): string | null {
  if (!run || !child) return null;
  const artifacts = expectedArtifactLabelsForRunAgent(run, agent, child);
  if (artifacts.length === 0) return null;
  const milestoneArtifacts = artifacts.filter((artifact) =>
    /draft|checkpoint|intermediate|partial|中间产物/i.test(artifact)
  );
  if (milestoneArtifacts.length === 0) return null;
  return [
    '- 本节点存在中间产物契约；读取上游输入并确定格式后，必须尽早写入第一个中间产物，再继续完善后续产物。',
    `- 优先落盘的中间产物示例：${milestoneArtifacts.slice(0, 3).join('、')}。不要长时间只在 thinking 中设计方案而不写文件。`,
  ].join('\n');
}

function firstArtifactGuidanceForPrompt(run: AgentClusterRun | null, child: AgentClusterChildRun | null, agent: ClusterAgent): string | null {
  if (!run || !child) return null;
  const artifacts = expectedArtifactLabelsForRunAgent(run, agent, child);
  if (artifacts.length === 0) return null;
  return [
    '- 执行优先：先执行当前 Agent prompt/runtime contract 声明的稳定命令，并尽早交付首个 required artifact；之后再继续后续批次或完整输出。',
    `- 首个 required artifact：${artifacts[0]}。在它落盘前，不要读取完整工具源码、排障文档或一次性规划全部输出；先交付最小可校验产物，再继续完善。`,
  ].join('\n');
}

function resolveExpectedArtifactPath(
  outputRoot: string,
  _agent: ClusterAgent,
  child: AgentClusterChildRun,
  expectedArtifact: RuntimeArtifactRef,
): string | null {
  const iteration = getChildIteration(child);
  const expected = runtimeArtifactPath(expectedArtifact)
    .replace(/<round>/gi, String(iteration))
    .replace(/<iteration>/gi, String(iteration))
    .replace(/<agent_id>/gi, child.agentId)
    .replace(/round_n/gi, `round_${iteration}`)
    .trim();
  if (!expected || expected.includes('*')) return null;
  if (isAbsolute(expected)) return expected;
  const normalized = expected.replace(/^[/\\]+/, '');
  const candidate = join(outputRoot, normalized);
  const relativeToOutputRoot = relative(outputRoot, candidate);
  if (relativeToOutputRoot.startsWith('..') || isAbsolute(relativeToOutputRoot)) return null;
  return candidate;
}

function normalizeExpectedArtifactForRound(expectedArtifact: RuntimeArtifactRef, child: AgentClusterChildRun): string {
  const iteration = getChildIteration(child);
  const path = runtimeArtifactPath(expectedArtifact)
    .replace(/<round>/gi, String(iteration))
    .replace(/<iteration>/gi, String(iteration))
    .replace(/<agent_id>/gi, child.agentId)
    .replace(/round_n/gi, `round_${iteration}`)
    .trim();
  return typeof expectedArtifact === 'string' || !expectedArtifact.match || expectedArtifact.match === 'literal'
    ? path
    : `${path} (${expectedArtifact.match})`;
}

async function resolveExpectedArtifactMatches(
  outputRoot: string,
  _agent: ClusterAgent,
  child: AgentClusterChildRun,
  expectedArtifact: RuntimeArtifactRef,
): Promise<string[]> {
  const matchPolicy = typeof expectedArtifact === 'string' ? undefined : expectedArtifact.match;
  const expected = runtimeArtifactPath(expectedArtifact)
    .replace(/<round>/gi, String(getChildIteration(child)))
    .replace(/<iteration>/gi, String(getChildIteration(child)))
    .replace(/<agent_id>/gi, child.agentId)
    .replace(/round_n/gi, `round_${getChildIteration(child)}`)
    .trim();
  if (!expected) return [];
  if (!expected.includes('*') && matchPolicy !== 'one_or_more') {
    const literal = resolveExpectedArtifactPath(outputRoot, _agent, child, expectedArtifact);
    if (!literal) return [];
    const fileStat = await stat(literal).catch(() => null);
    return fileStat?.isFile() ? [literal] : [];
  }

  const normalized = expected.replace(/\\/g, '/').replace(/^[/\\]+/, '');
  const patternDir = matchPolicy === 'one_or_more' && !normalized.includes('*')
      ? normalized
      : normalized.slice(0, normalized.lastIndexOf('/'));
  const directory = isAbsolute(patternDir) ? patternDir : join(outputRoot, patternDir);
  const relativeToOutputRoot = relative(outputRoot, directory);
  if (relativeToOutputRoot.startsWith('..') || isAbsolute(relativeToOutputRoot)) return [];

  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const matches = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(directory, entry.name))
    .filter((filePath) => {
      const fileName = basename(filePath);
      if (matchPolicy === 'one_or_more' && !normalized.includes('*')) return true;
      const globName = basename(normalized)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*');
      return new RegExp(`^${globName}$`, 'i').test(fileName);
    });
  return matches.sort();
}

export async function resolveExpectedArtifactMatchesForRunAgent(
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
): Promise<string[]> {
  const outputRoot = run.outputRoot?.trim();
  if (!outputRoot) return [];
  if (!(await hasExpectedArtifactsForRecovery(run, child, agent))) return [];
  const matches: string[] = [];
  for (const artifact of expectedArtifactsForRunAgent(run, agent)) {
    matches.push(...await resolveExpectedArtifactMatches(outputRoot, agent, child, artifact));
  }
  return matches;
}

export function resolveExpectedArtifactPathsForRunAgent(
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
): string[] {
  const outputRoot = run.outputRoot?.trim();
  if (!outputRoot) return [];
  return expectedArtifactsForRunAgent(run, agent)
    .map((artifact) => resolveExpectedArtifactPath(outputRoot, agent, child, artifact))
    .filter((artifactPath): artifactPath is string => Boolean(artifactPath));
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

async function validateGenericRequiredArtifacts(
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  completion: NonNullable<ReturnType<typeof parseCompletionSignal>>,
  projectRoot: string,
  expectedArtifacts: RuntimeArtifactRef[],
): Promise<string[]> {
  const reported = splitArtifactTokens(completion.artifacts);
  const resolvedArtifacts: string[] = [];
  for (const expectedArtifact of expectedArtifacts) {
    const expectedLabel = normalizeExpectedArtifactForRound(expectedArtifact, child);
    if (!expectedLabel) continue;
    const directMatches = run.outputRoot
      ? await resolveExpectedArtifactMatches(run.outputRoot, agent, child, expectedArtifact)
      : [];
    if (directMatches.length > 0) {
      for (const artifactPath of directMatches) {
        await assertFileFresh(artifactPath, child, expectedLabel);
        resolvedArtifacts.push(relative(projectRoot, artifactPath));
      }
      continue;
    }
    const directPath = run.outputRoot
      ? resolveExpectedArtifactPath(run.outputRoot, agent, child, expectedArtifact)
      : null;
    const expectedPath = runtimeArtifactPath(expectedArtifact)
      .replace(/<round>/gi, String(getChildIteration(child)))
      .replace(/<iteration>/gi, String(getChildIteration(child)))
      .replace(/<agent_id>/gi, child.agentId)
      .replace(/round_n/gi, `round_${getChildIteration(child)}`)
      .trim();
    const reportedPath = reported
      .find((artifact) => artifact === expectedPath || artifact.endsWith(`/${expectedPath}`) || artifact.endsWith(`\\${expectedPath}`));
    const artifactPath = directPath ?? (reportedPath ? resolveProjectArtifactPath(projectRoot, reportedPath) : null);
    if (!artifactPath) {
      throw new Error(`缺少约定产物：${expectedLabel}`);
    }
    await assertFileFresh(artifactPath, child, expectedLabel);
    resolvedArtifacts.push(relative(projectRoot, artifactPath));
  }
  return resolvedArtifacts;
}

async function assertFileFresh(path: string, child: AgentClusterChildRun, label: string): Promise<void> {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) throw new Error(`${label} 不存在：${path}`);
  const startMs = new Date(child.startedAt).getTime();
  if (Number.isFinite(startMs) && fileStat.mtimeMs + 1000 < startMs) {
    throw new Error(`${label} 是上一轮旧产物，未在本轮更新：${path}`);
  }
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
  const contractArtifacts = workflowOutputContractArtifacts(run, agent);
  const expectedArtifacts = contractArtifacts;
  child.expectedArtifacts = expectedArtifactLabelsForRunAgent(run, agent, child);
  if (!projectRoot || expectedArtifacts.length === 0) {
    child.artifactValidationStatus = 'skipped';
    return splitArtifactTokens(completion.artifacts);
  }
  try {
    const artifacts = await validateGenericRequiredArtifacts(run, child, agent, completion, projectRoot, expectedArtifacts);
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
  const expectedArtifacts = expectedArtifactsForRunAgent(run, agent);
  const outputRoot = run.outputRoot?.trim();
  if (!outputRoot || expectedArtifacts.length === 0) return false;
  for (const artifact of expectedArtifacts) {
    const matches = await resolveExpectedArtifactMatches(outputRoot, agent, child, artifact);
    if (matches.length === 0) return false;
  }
  return true;
}

async function inferLatestCompletedArtifactIterationForAgent(
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  minimumIteration = 1,
): Promise<number | null> {
  const expectedArtifacts = expectedArtifactsForRunAgent(run, agent);
  if (!run.outputRoot?.trim() || expectedArtifacts.length === 0) return null;
  const start = Math.max(1, Math.floor(minimumIteration || 1));
  const current = getChildIteration(child);
  const maxLoopRound = Math.max(
    current,
    ...(run.loopStates ?? []).map((state) => getOutputRoundForLoopStateIteration(run, state)),
  );
  const upperBound = Math.max(start, maxLoopRound, current) + 20;
  let latest: number | null = null;
  for (let iteration = start; iteration <= upperBound; iteration += 1) {
    const probeChild: AgentClusterChildRun = { ...child, iteration };
    if (await hasExpectedArtifactsForRecovery(run, probeChild, agent)) latest = iteration;
  }
  return latest;
}

async function getCanonicalArtifactPathsForAgent(
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
): Promise<string[]> {
  const outputRoot = run.outputRoot?.trim();
  if (!outputRoot) return [];
  const paths = await resolveExpectedArtifactMatchesForRunAgent(run, child, agent);
  if (paths.length === 0) return [];
  if (!(await hasExpectedArtifactsForRecovery(run, child, agent))) return [];
  return paths;
}

async function reconcileRunArtifacts(cluster: AgentCluster, run: AgentClusterRun, now: string): Promise<boolean> {
  const projectRoot = getClusterProjectRoot(cluster);
  if (!projectRoot) return false;
  let changed = false;

  for (const child of run.childRuns) {
    const agent = cluster.agents.find((item) => item.agentId === child.agentId);
    if (!agent) continue;
    const expectedArtifacts = expectedArtifactsForRunAgent(run, agent);
    if (expectedArtifacts.length === 0) continue;
    child.expectedArtifacts = expectedArtifactLabelsForRunAgent(run, agent, child);
    const canonicalPaths = await getCanonicalArtifactPathsForAgent(run, child, agent);
    const canonicalArtifacts = canonicalPaths.map((filePath) => relative(projectRoot, filePath));

    if (canonicalArtifacts.length > 0) {
      if (
        child.status === 'error'
        && (child.completionSignal || child.completionSource)
        && child.artifactValidationStatus === 'failed'
      ) {
        child.artifacts = canonicalArtifacts;
        child.artifactValidationStatus = 'passed';
        child.artifactValidationError = undefined;
        child.error = undefined;
        child.runtimeWaitReason = undefined;
        child.status = 'completed';
        child.submitStatus = 'submitted';
        child.completedAt = now;
        child.updatedAt = now;
        agent.status = 'done';
        agent.localContext.status = 'done';
        agent.currentTask = '产物校验已恢复，Agent 已完成';
        agent.runtimeStatusReason = '产物已校准';
        agent.lastActivityAt = now;
        syncAgentWorkflowNodeRun(run, child, now);
        addClusterEvent(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          title: '产物校验已恢复',
          content: `${agent.name} 的完成信号已存在，且当前 outputContract 产物已全部找到；已恢复为 completed。`,
          level: 'success',
          createdAt: now,
        });
        changed = true;
        continue;
      }
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

    if (
      child.artifactValidationStatus === 'passed'
      && child.status !== 'completed'
      && child.status !== 'aborted'
    ) {
      child.artifacts = [];
      child.artifactValidationStatus = 'pending';
      child.artifactValidationError = undefined;
      child.runtimeWaitReason = '已发现部分产物，但 outputContract 所需最终产物尚未齐全。';
      child.updatedAt = now;
      agent.currentTask = '等待最终产物';
      agent.runtimeStatusReason = '等待产物';
      agent.lastActivityAt = now;
      addClusterEvent(cluster, {
        runId: run.runId,
        agentId: agent.agentId,
        title: '等待产物',
        content: child.runtimeWaitReason,
        level: 'info',
        createdAt: now,
      });
      changed = true;
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

export async function createAgentClusterAgent(
  clusterId: string,
  input: CreateAgentClusterAgentInput,
): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    if (cluster.activeRunId) throw new Error('运行中不能新增 Agent');

    const name = input.name?.trim();
    const role = input.role?.trim();
    if (!name) throw new Error('Agent name is required');
    if (!role) throw new Error('Agent role is required');

    const now = new Date().toISOString();
    const responsibilities = coerceStringArray(input.responsibilities);
    const description = input.description?.trim() || role;
    const agent = buildAgent(cluster.clusterId, {
      name: compactText(name, 80),
      role: compactText(role, 80),
      description: compactText(description, 260),
      responsibilities: responsibilities.length > 0 ? responsibilities : [description],
      tools: coerceStringArray(input.tools),
      capabilities: coerceStringArray(input.capabilities),
    }, cluster.agents.length, cluster.sharedContext.globalGoal || cluster.sourceContent || description);
    const systemPrompt = input.systemPrompt?.trim();
    if (systemPrompt) {
      agent.systemPrompt = systemPrompt;
      agent.localContext.systemPrompt = systemPrompt;
    }

    cluster.agents = [...cluster.agents, agent];
    cluster.sharedContext.agentSummaries = [
      ...(cluster.sharedContext.agentSummaries ?? []),
      {
        agentId: agent.agentId,
        name: agent.name,
        summary: `手动新增：${agent.role}。${agent.description}`,
        updatedAt: now,
      },
    ].slice(-50);

    const graph = sanitizeExecutionGraph(cluster, {
      ...(cluster.executionGraph ?? buildExecutionGraph(cluster.agents, cluster.edges, false, now)),
      confirmed: false,
      updatedAt: now,
    });
    cluster.executionGraph = graph;
    cluster.edges = graph.edges;

    const nextVersion = Math.max(0, ...(cluster.workflows ?? []).map((workflow) => workflow.version)) + 1;
    const workflow = buildWorkflowFromExecutionGraph(cluster.clusterId, cluster.agents, graph, 'user', nextVersion, now);
    cluster.workflows = [
      workflow,
      ...(cluster.workflows ?? []).map((item) => item.status === 'confirmed' ? { ...item, status: 'archived' as const } : item),
    ];
    cluster.currentWorkflowId = workflow.workflowId;
    cluster.orchestrationConfirmedAt = null;
    cluster.messages.push(makeMessage(clusterId, {
      senderType: 'orchestrator',
      senderAgentId: null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'update',
      content: `已新增子 Agent「${agent.name}」。请在 Workflow 画布中连接它，并重新确认流水线。`,
      visibility: 'public',
    }, now));
    addClusterEvent(cluster, {
      agentId: agent.agentId,
      title: '子 Agent 已新增',
      content: `${agent.name} 已加入集群；当前 Workflow 已变为草稿。`,
      level: 'info',
      createdAt: now,
    });
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
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
    const nextVersion = Math.max(0, ...(cluster.workflows ?? []).map((workflow) => workflow.version)) + 1;
    const workflow = buildWorkflowFromExecutionGraph(cluster.clusterId, cluster.agents, graph, 'user', nextVersion, graph.updatedAt);
    cluster.executionGraph = graph;
    cluster.edges = graph.edges;
    cluster.workflows = [
      workflow,
      ...(cluster.workflows ?? []).map((item) => item.status === 'confirmed' ? { ...item, status: 'archived' as const } : item),
    ];
    cluster.currentWorkflowId = workflow.workflowId;
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
    const currentWorkflow = normalizeWorkflow(cluster, getCurrentWorkflow(cluster));
    assertWorkflowValid(cluster, currentWorkflow);
    currentWorkflow.status = 'confirmed';
    currentWorkflow.confirmedAt = now;
    currentWorkflow.updatedAt = now;
    cluster.executionGraph = graph;
    cluster.edges = graph.edges;
    cluster.workflows = (cluster.workflows ?? []).map((workflow) => workflow.workflowId === currentWorkflow.workflowId
      ? currentWorkflow
      : workflow.status === 'confirmed'
        ? { ...workflow, status: 'archived' as const }
        : workflow);
    if (!(cluster.workflows ?? []).some((workflow) => workflow.workflowId === currentWorkflow.workflowId)) {
      cluster.workflows = [currentWorkflow, ...(cluster.workflows ?? [])];
    }
    cluster.currentWorkflowId = currentWorkflow.workflowId;
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

export async function updateAgentClusterWorkflow(
  clusterId: string,
  workflowPatch: Partial<AgentClusterWorkflow>,
): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    if (cluster.activeRunId) throw new Error('运行中不能修改 Workflow');
    const now = new Date().toISOString();
    const current = getCurrentWorkflow(cluster);
    const nextVersion = Math.max(0, ...(cluster.workflows ?? []).map((workflow) => workflow.version)) + 1;
    const draft = normalizeWorkflow(cluster, {
      ...current,
      ...workflowPatch,
      workflowId: `workflow-${randomUUID()}`,
      version: nextVersion,
      status: 'draft',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      confirmedAt: undefined,
      nodes: Array.isArray(workflowPatch.nodes) ? workflowPatch.nodes : current.nodes,
      edges: Array.isArray(workflowPatch.edges) ? workflowPatch.edges : current.edges,
      policy: workflowPatch.policy ? { ...current.policy, ...workflowPatch.policy } : current.policy,
    });
    assertWorkflowValid(cluster, draft);
    cluster.workflows = [draft, ...(cluster.workflows ?? [])];
    cluster.currentWorkflowId = draft.workflowId;
    cluster.orchestrationConfirmedAt = null;
    cluster.updatedAt = now;
    addClusterEvent(cluster, {
      agentId: null,
      title: 'Workflow 草稿已保存',
      content: `已创建 Workflow v${draft.version}，确认后才会用于运行。`,
      level: 'info',
      createdAt: now,
    });
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

export async function saveAgentClusterWorkflowTemplate(
  clusterId: string,
  input: { name?: string; description?: string; defaultArgs?: Record<string, unknown>; argsSchema?: Record<string, unknown> },
): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const now = new Date().toISOString();
    const workflow = normalizeWorkflow(cluster, getCurrentWorkflow(cluster));
    const template: AgentClusterWorkflowTemplate = {
      templateId: `template-${randomUUID()}`,
      name: input.name?.trim() || `${cluster.clusterName} Workflow`,
      description: input.description?.trim(),
      workflow: structuredClone(workflow),
      defaultArgs: input.defaultArgs && typeof input.defaultArgs === 'object' && !Array.isArray(input.defaultArgs)
        ? structuredClone(input.defaultArgs)
        : undefined,
      argsSchema: input.argsSchema && typeof input.argsSchema === 'object' && !Array.isArray(input.argsSchema)
        ? structuredClone(input.argsSchema)
        : undefined,
      createdAt: now,
      updatedAt: now,
    };
    cluster.workflowTemplates = [template, ...(cluster.workflowTemplates ?? [])].slice(0, 20);
    cluster.updatedAt = now;
    addClusterEvent(cluster, {
      agentId: null,
      title: 'Workflow 模板已保存',
      content: `已保存模板：${template.name}`,
      level: 'success',
      createdAt: now,
    });
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

export async function confirmAgentClusterWorkflow(clusterId: string, workflowId?: string): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    if (cluster.activeRunId) throw new Error('运行中不能确认新的 Workflow');
    const now = new Date().toISOString();
    const target = (cluster.workflows ?? []).find((workflow) => workflow.workflowId === (workflowId ?? cluster.currentWorkflowId));
    if (!target) throw new Error('Workflow not found');
    const confirmed = normalizeWorkflow(cluster, target);
    assertWorkflowValid(cluster, confirmed);
    confirmed.status = 'confirmed';
    confirmed.confirmedAt = now;
    confirmed.updatedAt = now;
    cluster.workflows = (cluster.workflows ?? []).map((workflow) => workflow.workflowId === confirmed.workflowId
      ? confirmed
      : workflow.status === 'confirmed'
        ? { ...workflow, status: 'archived' as const }
        : workflow);
    cluster.currentWorkflowId = confirmed.workflowId;
    cluster.orchestrationConfirmedAt = now;
    cluster.updatedAt = now;
    addClusterEvent(cluster, {
      agentId: null,
      title: 'Workflow 已确认',
      content: `Workflow v${confirmed.version} 已锁定；后续运行会保存不可变快照。`,
      level: 'success',
      createdAt: now,
    });
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

export async function rollbackAgentClusterWorkflow(clusterId: string, workflowId: string): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    if (cluster.activeRunId) throw new Error('运行中不能回退 Workflow');
    const source = (cluster.workflows ?? []).find((workflow) => workflow.workflowId === workflowId);
    if (!source) throw new Error('Workflow not found');
    const now = new Date().toISOString();
    const version = Math.max(0, ...(cluster.workflows ?? []).map((workflow) => workflow.version)) + 1;
    const draft = normalizeWorkflow(cluster, {
      ...structuredClone(source),
      workflowId: `workflow-${randomUUID()}`,
      version,
      status: 'draft',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      confirmedAt: undefined,
    });
    cluster.workflows = [draft, ...(cluster.workflows ?? [])];
    cluster.currentWorkflowId = draft.workflowId;
    cluster.orchestrationConfirmedAt = null;
    cluster.updatedAt = now;
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
    if (run.scriptSnapshot) return [];
    if (run.harnessStatus === 'paused' || run.harnessStatus === 'waiting_human') return [];
    const now = new Date().toISOString();
    let changed = await reconcileRunArtifacts(cluster, run, now);
    if (await advanceDeterministicWorkflowNodes(cluster, run, now)) changed = true;
    if (reconcileCompletedExecutionLoops(cluster, run, now)) changed = true;
    const readyJobs: Array<{ agent: ClusterAgent; child: AgentClusterChildRun; message: string }> = [];
    const maxConcurrency = run.workflowSnapshot?.policy.maxConcurrency ?? DEFAULT_WORKFLOW_CONCURRENCY;
    const activeCount = countSubmittedActiveChildRuns(run);
    let availableSlots = Math.max(0, maxConcurrency - activeCount);

    for (const child of run.childRuns) {
      if (availableSlots <= 0) break;
      const agent = cluster.agents.find((item) => item.agentId === child.agentId);
      if (!agent) continue;
      if (child.status === 'completed' || child.status === 'error' || child.status === 'timeout' || child.status === 'aborted') continue;
      const upstreamIds = getBlockingUpstreamAgentIds(cluster, child.agentId);
      const harnessReady = child.workflowNodeId
        ? isAgentChildReadyForDispatch(cluster, run, child)
        : upstreamIds.every((agentId) =>
            childRequiredArtifactsSatisfied(run.childRuns.find((item) => item.agentId === agentId))
          );
      const fanOutReady = child.workflowNodeId ? hasWorkflowFanOutCapacity(run, child.workflowNodeId) : true;
      const blockingUpstream = harnessReady ? [] : upstreamIds.filter((agentId) => {
        const upstreamChild = run.childRuns.find((item) => item.agentId === agentId);
        return !upstreamChild || upstreamChild.status !== 'completed';
      });
      if (child.submitStatus === 'submitted' && child.runId) continue;
      if (child.submitStatus === 'submitted' && child.status !== 'blocked') {
        const submittedAt = new Date(child.lastEventAt ?? child.updatedAt ?? child.startedAt).getTime();
        if (harnessReady && Number.isFinite(submittedAt) && Date.now() - submittedAt < 15_000) continue;
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

      if (!harnessReady || !fanOutReady) {
        const nextTask = !fanOutReady
          ? '等待 Fan-out 并发槽位'
          : blockingUpstream.length > 0 ? `等待上游完成：${blockingUpstream
          .map((agentId) => cluster.agents.find((item) => item.agentId === agentId)?.name ?? agentId)
          .join('、')}` : '等待 Harness 算子完成';
        const nextReason = 'Harness 阻塞';
        const stateChanged = child.status !== 'blocked'
          || child.submitStatus !== 'pending'
          || agent.status !== 'waiting'
          || agent.currentTask !== nextTask
          || agent.runtimeStatusReason !== nextReason;
        if (stateChanged) {
          child.status = 'blocked';
          child.submitStatus = 'pending';
          child.updatedAt = now;
          agent.status = 'waiting';
          agent.localContext.status = 'waiting';
          agent.currentTask = nextTask;
          agent.runtimeStatusReason = nextReason;
          agent.lastActivityAt = now;
          addClusterEvent(cluster, {
            runId,
            agentId: agent.agentId,
            title: '等待上游 Agent',
            content: agent.currentTask,
            level: 'info',
            createdAt: now,
          });
          changed = true;
        }
        continue;
      }

      changed = true;
      child.status = 'starting';
      child.submitStatus = 'submitted';
      child.updatedAt = now;
      child.lastEventAt = now;
      extendRunTimeout(run, now, true);
      agent.status = 'running';
      agent.localContext.status = 'running';
      agent.currentTask = 'DAG 条件满足，正在提交子会话';
      agent.runtimeStatusReason = '子会话提交中';
      agent.lastActivityAt = now;
      agent.runtimeSessionKey = child.sessionKey;
      agent.runtimeRunId = child.runId;
      if (child.workflowNodeId) {
        updateResolvedInputsForNode(cluster, run, child.workflowNodeId, now);
        const nodeRun = workflowNodeRun(run, child.workflowNodeId);
        if (nodeRun) {
          nodeRun.status = 'running';
          nodeRun.attempt += 1;
          nodeRun.startedAt = now;
          nodeRun.updatedAt = now;
          nodeRun.waitingReason = undefined;
        }
      }
      const isRepairPrompt = child.promptMode === 'repair';
      const isContinuationPrompt = child.promptMode === 'continuation';
      const projectDirectoryMode = isProjectDirectoryRuntimeMode(cluster);
      addClusterEvent(cluster, {
        runId,
        agentId: agent.agentId,
        title: isRepairPrompt ? '修复子会话' : isContinuationPrompt ? '继续子会话' : '提交子会话',
        content: isRepairPrompt
          ? projectDirectoryMode
            ? `${agent.name} 将使用新的子会话修复 round_${getChildIteration(child)} 的缺失产物。`
            : `${agent.name} 将在同一个子会话中修复 round_${getChildIteration(child)} 的缺失产物。`
          : isContinuationPrompt
            ? projectDirectoryMode
              ? `${agent.name} 将使用新的子会话继续 round_${getChildIteration(child)}。`
              : `${agent.name} 将复用同一个子会话继续 round_${getChildIteration(child)}。`
            : `${agent.name} 的上游依赖已满足，正在提交到 OpenClaw Gateway。`,
        level: 'info',
        createdAt: now,
      });
      readyJobs.push({
        agent: { ...agent },
        child: { ...child },
        message: buildAgentSubmissionPrompt(cluster, agent, child),
      });
      availableSlots -= 1;
    }

    updateRootRunStatus(cluster, run, now);
    if (changed) {
      updateWorkflowCheckpoint(run, now);
      cluster.updatedAt = now;
      clusters[index] = cluster;
      await writeClusters(clusters);
      eventBus?.emit('agent-cluster:updated', { cluster });
    }
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

function validateWorkflowScriptSource(source: string): void {
  const forbidden = [
    /\brequire\s*\(/,
    /\bimport\s*\(/,
    /\bimport\s+[^('"`]/,
    /\bprocess\b/,
    /\bchild_process\b/,
    /\bfs\b/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /constructor\s*\.\s*constructor/,
  ];
  const matched = forbidden.find((pattern) => pattern.test(source));
  if (matched) {
    throw new Error(`Workflow JS 包含禁用能力：${matched.source}`);
  }
}

function findHarnessAgent(cluster: AgentCluster, agentRef: string): ClusterAgent {
  const normalized = normalizeAgentNameForMatch(agentRef);
  const agent = cluster.agents.find((candidate) => candidate.agentId === agentRef)
    ?? cluster.agents.find((candidate) => candidate.name === agentRef)
    ?? cluster.agents.find((candidate) => normalizeAgentNameForMatch(candidate.name) === normalized)
    ?? cluster.agents.find((candidate) => normalizeAgentNameForMatch(candidate.role) === normalized);
  if (!agent) throw new Error(`Workflow JS 找不到 Agent：${agentRef}`);
  return agent;
}

function terminalChildStatus(status: AgentClusterRunStatus): boolean {
  return status === 'completed' || status === 'error' || status === 'timeout' || status === 'aborted';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WorkflowHumanGateWaitError extends Error {
  constructor() {
    super('Human Gate waiting for user decision');
    this.name = 'WorkflowHumanGateWaitError';
  }
}

async function submitScriptAgentAndWait(
  clusterId: string,
  runId: string,
  agentRef: string,
  input: Record<string, unknown> | undefined,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<Record<string, unknown>> {
  const job = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const run = findRun(cluster, runId);
    if (cluster.activeRunId !== runId || run.status !== 'running') throw new Error('Workflow run is not active');
    const agent = findHarnessAgent(cluster, agentRef);
    const child = run.childRuns.find((item) => item.agentId === agent.agentId);
    if (!child) throw new Error(`Workflow run 缺少 Agent 子会话：${agent.name}`);
    const now = new Date().toISOString();
    if (terminalChildStatus(child.status)) {
      return { agent: { ...agent }, child: { ...child }, message: '', alreadyDone: true };
    }
    child.status = 'starting';
    child.submitStatus = 'submitted';
    child.updatedAt = now;
    child.lastEventAt = now;
    extendRunTimeout(run, now, true);
    agent.status = 'running';
    agent.localContext.status = 'running';
    agent.currentTask = 'JS Workflow 正在提交子会话';
    agent.runtimeStatusReason = 'dynamic workflow';
    agent.lastActivityAt = now;
    agent.runtimeSessionKey = child.sessionKey;
    if (child.workflowNodeId) {
      updateResolvedInputsForNode(cluster, run, child.workflowNodeId, now);
      run.resolvedInputsByNodeId ??= {};
      run.resolvedInputsByNodeId[child.workflowNodeId] = {
        ...(run.resolvedInputsByNodeId[child.workflowNodeId] ?? {}),
        ...(input ?? {}),
      };
      const nodeRun = workflowNodeRun(run, child.workflowNodeId);
      if (nodeRun) {
        nodeRun.status = 'running';
        nodeRun.attempt += 1;
        nodeRun.startedAt = nodeRun.startedAt ?? now;
        nodeRun.updatedAt = now;
        nodeRun.input = {
          ...(nodeRun.input ?? {}),
          ...(input ?? {}),
        };
      }
    }
    addClusterEvent(cluster, {
      runId,
      agentId: agent.agentId,
      title: 'JS Workflow 提交 Agent',
      content: `${agent.name} 由 Dynamic Workflow 脚本启动。`,
      level: 'info',
      createdAt: now,
    });
    updateWorkflowCheckpoint(run, now);
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    eventBus?.emit('agent-cluster:updated', { cluster });
    const inputText = input && Object.keys(input).length > 0
      ? `\n\nDynamic Workflow 输入：\n${safeStringify(input)}`
      : '';
    return {
      agent: { ...agent },
      child: { ...child },
      message: `${buildAgentChildPrompt(cluster, agent)}${inputText}`,
      alreadyDone: false,
    };
  });

  if (!job.alreadyDone) {
    try {
      const result = await gatewayManager.rpc<{ runId?: string; status?: string }>('agent', {
        sessionKey: job.child.sessionKey,
        message: job.message,
        idempotencyKey: `${runId}:script:${job.agent.agentId}:${job.child.startedAt}`,
        deliver: false,
        lane: 'subagent',
        timeout: 0,
        label: `${job.agent.name}`,
      }, 10_000);
      await recordAgentClusterRuntimeEvent({
        method: 'agent.started',
        params: { sessionKey: job.child.sessionKey, runId: result?.runId, status: result?.status, agentId: job.agent.agentId },
      }, eventBus);
    } catch (error) {
      await recordAgentClusterRuntimeEvent({
        method: 'agent.error',
        params: { sessionKey: job.child.sessionKey, error: error instanceof Error ? error.message : String(error), agentId: job.agent.agentId },
      }, eventBus);
    }
  }

  for (;;) {
    await wait(2_000);
    const refreshed = await refreshAgentClusterRunEvents(clusterId, runId, gatewayManager, eventBus).catch(() => null);
    const cluster = refreshed ?? await getAgentCluster(clusterId);
    const run = cluster?.runs?.find((item) => item.runId === runId);
    const child = run?.childRuns.find((item) => item.agentId === job.agent.agentId);
    if (!cluster || !run || !child) throw new Error('Workflow run disappeared');
    if (cluster.activeRunId !== runId || run.status !== 'running') {
      throw new Error('Workflow run is no longer active');
    }
    if (!terminalChildStatus(child.status)) continue;
    if (child.status !== 'completed') {
      throw new Error(child.error || child.artifactValidationError || `${job.agent.name} failed: ${child.status}`);
    }
    return {
      agentId: job.agent.agentId,
      name: job.agent.name,
      status: child.status,
      artifacts: child.artifacts ?? [],
      outputRelativeDir: child.outputRelativeDir,
      completedAt: child.completedAt,
    };
  }
}

async function runAgentClusterWorkflowScript(
  clusterId: string,
  runId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<void> {
  const snapshot = await withStoreQueue(async () => {
    const cluster = (await readClusters()).find((item) => item.clusterId === clusterId);
    const run = cluster?.runs?.find((item) => item.runId === runId);
    if (!cluster || !run?.scriptSnapshot) throw new Error('Workflow script snapshot not found');
    validateWorkflowScriptSource(run.scriptSnapshot.source);
    return {
      script: run.scriptSnapshot,
      args: run.args ?? {},
      context: {
        clusterId,
        runId,
        clusterName: cluster.clusterName,
        projectName: cluster.projectName,
        agents: cluster.agents.map((agent) => ({ agentId: agent.agentId, name: agent.name, role: agent.role })),
      },
    };
  });

  const harness = {
    agent: (agentRef: string, input?: Record<string, unknown>) =>
      submitScriptAgentAndWait(clusterId, runId, agentRef, input, gatewayManager, eventBus),
    fanOut: async <T, R>(
      items: T[],
      worker: (item: T, index: number) => Promise<R>,
      options?: { concurrency?: number },
    ): Promise<R[]> => {
      const max = Math.max(1, Math.min(DEFAULT_WORKFLOW_CONCURRENCY, Math.floor(options?.concurrency ?? DEFAULT_WORKFLOW_CONCURRENCY)));
      const results: R[] = [];
      let index = 0;
      const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
        for (;;) {
          const current = index;
          index += 1;
          if (current >= items.length) return;
          results[current] = await worker(items[current], current);
        }
      });
      await Promise.all(workers);
      return results;
    },
    join: async <T>(values: T[]): Promise<T[]> => values,
    gate: async (name: string, options?: { artifacts?: string[]; minimumCount?: number; value?: unknown }): Promise<Record<string, unknown>> => {
      const artifacts = coerceStringArray(options?.artifacts);
      if (artifacts.length > 0) {
        const cluster = await getAgentCluster(clusterId);
        const run = cluster?.runs?.find((item) => item.runId === runId);
        const projectRoot = cluster ? getClusterProjectRoot(cluster) : null;
        if (!cluster || !run || !projectRoot) throw new Error(`Gate ${name} 无法解析项目根目录`);
        for (const artifact of artifacts) {
          const artifactPath = resolveProjectArtifactPath(projectRoot, artifact);
          const fileStat = await stat(artifactPath).catch(() => null);
          if (!fileStat?.isFile()) throw new Error(`Gate ${name} 未通过，缺少产物：${artifact}`);
        }
      }
      if (typeof options?.minimumCount === 'number' && Array.isArray(options.value) && options.value.length < options.minimumCount) {
        throw new Error(`Gate ${name} 未通过，数量 ${options.value.length}/${options.minimumCount}`);
      }
      return { verdict: 'pass', name, artifacts };
    },
    llmGate: async (prompt: string, input?: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const cluster = await getAgentCluster(clusterId);
      const run = cluster?.runs?.find((item) => item.runId === runId);
      if (!cluster || !run) throw new Error('LLM Gate run not found');
      const workflow = run.workflowSnapshot ?? getCurrentWorkflow(cluster);
      const node: WorkflowGateNode = {
        nodeId: `script-llm-gate:${randomUUID()}`,
        type: 'gate',
        name: 'JS Workflow LLM Gate',
        gateKind: 'llm',
        evaluationPrompt: `${prompt}\n\n输入：${safeStringify(input ?? {})}`,
      };
      const result = await evaluateLlmGate(node, workflow, run);
      if (result.verdict !== 'pass') throw new Error(`LLM Gate ${result.verdict}: ${result.reason}`);
      return result;
    },
    humanGate: async (prompt: string): Promise<never> => {
      await withStoreQueue(async () => {
        const clusters = await readClusters();
        const cluster = clusters.find((item) => item.clusterId === clusterId);
        const run = cluster?.runs?.find((item) => item.runId === runId);
        if (!cluster || !run) return;
        const now = new Date().toISOString();
        run.harnessStatus = 'waiting_human';
        run.updatedAt = now;
        addClusterEvent(cluster, {
          runId,
          agentId: null,
          title: 'Human Gate',
          content: prompt,
          level: 'warning',
          createdAt: now,
        });
        await writeClusters(clusters);
        eventBus?.emit('agent-cluster:updated', { cluster });
      });
      throw new WorkflowHumanGateWaitError();
    },
    loop: async <T>(count: number, worker: (iteration: number) => Promise<T>): Promise<T[]> => {
      const safeCount = Math.max(1, Math.min(MAX_WORKFLOW_LOOP_COUNT, Math.floor(count)));
      const results: T[] = [];
      for (let iteration = 1; iteration <= safeCount; iteration += 1) {
        results.push(await worker(iteration));
      }
      return results;
    },
    log: async (message: string): Promise<void> => {
      await withStoreQueue(async () => {
        const clusters = await readClusters();
        const cluster = clusters.find((item) => item.clusterId === clusterId);
        if (!cluster) return;
        const now = new Date().toISOString();
        addClusterEvent(cluster, {
          runId,
          agentId: null,
          title: 'Workflow Log',
          content: compactText(message, 800),
          level: 'info',
          createdAt: now,
        });
        cluster.updatedAt = now;
        await writeClusters(clusters);
        eventBus?.emit('agent-cluster:updated', { cluster });
      });
    },
    finish: (result?: Record<string, unknown>) => ({ status: 'completed', ...(result ?? {}) }),
    fail: (message: string): never => {
      throw new Error(message);
    },
  };

  try {
    const moduleObject = { exports: undefined as unknown };
    const sandbox = createContext({
      module: moduleObject,
      exports: {},
      console: {
        log: (...args: unknown[]) => void harness.log(args.map(String).join(' ')),
        warn: (...args: unknown[]) => void harness.log(args.map(String).join(' ')),
        error: (...args: unknown[]) => void harness.log(args.map(String).join(' ')),
      },
      require: undefined,
      process: undefined,
      fetch: undefined,
      XMLHttpRequest: undefined,
      setTimeout: undefined,
      setInterval: undefined,
    });
    new Script(snapshot.script.source, { filename: 'investclaw.workflow.js' }).runInContext(sandbox, { timeout: 1_000 });
    const workflowFunction = (sandbox as { module?: { exports?: unknown } }).module?.exports;
    if (typeof workflowFunction !== 'function') {
      throw new Error('investclaw.workflow.js 必须导出 async function workflow({ harness, args, context })');
    }
    const result = await workflowFunction({ harness, args: snapshot.args, context: snapshot.context });
    await withStoreQueue(async () => {
      const clusters = await readClusters();
      const cluster = clusters.find((item) => item.clusterId === clusterId);
      const run = cluster?.runs?.find((item) => item.runId === runId);
      if (!cluster || !run || cluster.activeRunId !== runId) return;
      const now = new Date().toISOString();
      run.status = 'completed';
      run.harnessStatus = 'completed';
      run.completedAt = now;
      run.updatedAt = now;
      cluster.activeRunId = null;
      cluster.runtimeSessionKey = null;
      addClusterEvent(cluster, {
        runId,
        agentId: null,
        title: 'JS Workflow 完成',
        content: compactText(typeof result === 'object' ? safeStringify(result) : String(result ?? 'done'), 900),
        level: 'success',
        createdAt: now,
      });
      updateWorkflowCheckpoint(run, now);
      cluster.updatedAt = now;
      await writeClusters(clusters);
      eventBus?.emit('agent-cluster:updated', { cluster });
    });
  } catch (error) {
    if (error instanceof WorkflowHumanGateWaitError) return;
    await withStoreQueue(async () => {
      const clusters = await readClusters();
      const cluster = clusters.find((item) => item.clusterId === clusterId);
      const run = cluster?.runs?.find((item) => item.runId === runId);
      if (!cluster || !run || cluster.activeRunId !== runId) return;
      const now = new Date().toISOString();
      run.status = 'error';
      run.harnessStatus = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      run.completedAt = now;
      run.updatedAt = now;
      cluster.activeRunId = null;
      cluster.runtimeSessionKey = null;
      addClusterEvent(cluster, {
        runId,
        agentId: null,
        title: 'JS Workflow 失败',
        content: run.error,
        level: 'error',
        createdAt: now,
      });
      updateWorkflowCheckpoint(run, now);
      cluster.updatedAt = now;
      await writeClusters(clusters);
      eventBus?.emit('agent-cluster:updated', { cluster });
    });
  }
}

export async function startAgentClusterRun(
  clusterId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
  input: StartAgentClusterRunInput = {},
): Promise<AgentCluster> {
  const cluster = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    if (cluster.activeRunId) return cluster;
    const now = new Date().toISOString();
    const workflow = normalizeWorkflow(cluster, getCurrentWorkflow(cluster));
    const workflowScript = normalizeWorkflowScript(cluster.workflowScript, now);
    const useWorkflowScript = Boolean(workflowScript?.confirmedAt);
    if (!useWorkflowScript && workflow.status !== 'confirmed') {
      throw new Error('请先确认 Harness Workflow 或 JS Workflow，再启动集群运行');
    }
    if (!useWorkflowScript) assertWorkflowValid(cluster, workflow);
    const projectRoot = cluster.projectRoot?.trim() || cluster.sourceFolderPath?.trim() || null;
    if (projectRoot) {
      if (!isAbsolute(projectRoot)) throw new Error('项目根目录必须是绝对路径，无法启动隔离运行');
      const rootStat = await stat(projectRoot).catch(() => null);
      if (!rootStat?.isDirectory()) throw new Error('项目根目录不存在或不是文件夹，无法启动隔离运行');
    }
    const runId = `run-${randomUUID()}`;
    const shortClusterId = cluster.clusterId.replace(/^cluster-/, '').slice(0, 10);
    const output = await allocateClusterExperimentOutput(projectRoot, cluster.clusterId, now);
    const runArgs = input.args && typeof input.args === 'object' && !Array.isArray(input.args)
      ? structuredClone(input.args)
      : {};
    const run: AgentClusterRun = {
      runId,
	      mode: 'subagent_swarm',
	      status: 'running',
	      sessionKey: `agent:main:cluster-${shortClusterId}`,
      args: runArgs,
	      outputVersion: output.outputVersion,
	      outputRoot: output.outputRoot,
	      outputCreatedAt: output.outputCreatedAt,
	      roundStart: output.roundStart,
      workflowSnapshot: structuredClone(workflow),
      scriptSnapshot: useWorkflowScript ? structuredClone(workflowScript) : undefined,
      resolvedInputsByNodeId: {},
      nodeRuns: workflow.nodes.map((node) => ({
        nodeId: node.nodeId,
        status: 'pending',
        attempt: 0,
        input: node.type === 'agent' || node.type === 'review' || node.type === 'reduce'
          ? {}
          : undefined,
        updatedAt: now,
      })),
      harnessStatus: 'running',
      loopStates: workflow.nodes.filter((node): node is WorkflowLoopNode => node.type === 'loop').map((loop) => ({
        loopId: loop.nodeId,
        currentIteration: 1,
        repeatCount: loop.repeatCount,
        status: loop.repeatCount > 1 ? 'running' : 'completed',
        updatedAt: now,
      })),
      childRuns: cluster.agents.map((agent) => {
        const workflowNode = workflow.nodes.find((node) => workflowNodeIsAgent(node) && node.agentId === agent.agentId);
        const workflowArtifacts = workflowNode?.outputContract?.requiredArtifacts
          ? sanitizeRuntimeArtifactRefs(workflowNode.outputContract.requiredArtifacts)
          : [];
        const expectedArtifacts = workflowArtifacts.map((artifact) => runtimeArtifactLabel(artifact));
        return {
          agentId: agent.agentId,
          workflowNodeId: workflowNode?.nodeId,
          sessionKey: buildAgentChildSessionKey(cluster, runId, agent.agentId, now),
          runId: '',
          status: 'blocked',
          submitStatus: 'pending',
          expectedArtifacts,
          artifactValidationStatus: expectedArtifacts.length > 0 ? 'pending' : undefined,
          outputRoot: output.outputRoot,
          iteration: output.roundStart,
          outputRelativeDir: buildDefaultAgentOutputRelativeDir(agent.agentId, output.roundStart),
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
    if (!useWorkflowScript) {
      await advanceDeterministicWorkflowNodes(cluster, run, now);
    }
    for (const child of run.childRuns) {
      const ready = useWorkflowScript
        ? false
        : child.workflowNodeId
          ? isAgentChildReadyForDispatch(cluster, run, child)
          : getBlockingUpstreamAgentIds(cluster, child.agentId).length === 0;
      child.status = ready ? 'starting' : 'blocked';
      const nodeRun = child.workflowNodeId ? workflowNodeRun(run, child.workflowNodeId) : undefined;
      if (nodeRun) {
        nodeRun.status = ready ? 'ready' : 'waiting';
        nodeRun.waitingReason = ready ? undefined : '等待 Harness 上游节点完成';
      }
    }
    updateWorkflowCheckpoint(run, now);

    cluster.runs = [run, ...(cluster.runs ?? [])];
    cluster.activeRunId = runId;
    cluster.runtimeSessionKey = run.sessionKey;
    addClusterEvent(cluster, {
        runId,
        agentId: null,
        title: useWorkflowScript
          ? '启动 JS Dynamic Workflow'
          : isProjectDirectoryRuntimeMode(cluster) ? '启动项目原生执行' : '启动 Agent Harness Workflow',
        content: useWorkflowScript
          ? `将执行已确认的 investclaw.workflow.js v${workflowScript?.version ?? 1}。JS 只能调用受控 Harness API；Agent 子会话仍由 Electron Main 管理。`
          : isProjectDirectoryRuntimeMode(cluster)
            ? `将按项目 runtime contract / Agent prompt 执行 ${cluster.agents.length} 个子 Agent，InvestClaw 只负责顺序、round、产物校验和监控。项目根目录：${projectRoot ?? '未配置'}；本次输出版本：${output.outputVersion ?? '未配置'}；从 round ${output.roundStart} 开始。`
          : projectRoot
            ? `将按 Workflow v${workflow.version} 执行 ${workflow.nodes.length} 个节点，最大并发 ${workflow.policy.maxConcurrency}。项目根目录约束会写入子 Agent prompt：${projectRoot}；本次输出版本：${output.outputVersion ?? '未配置'}；从 round ${output.roundStart} 开始。`
            : `将按 Workflow v${workflow.version} 执行 ${workflow.nodes.length} 个节点，最大并发 ${workflow.policy.maxConcurrency}。`,
        level: 'info',
        createdAt: now,
    });

    for (const agent of cluster.agents) {
      const child = run.childRuns.find((item) => item.agentId === agent.agentId);
      if (!child) continue;
      const ready = useWorkflowScript ? false : child.workflowNodeId ? isAgentChildReadyForDispatch(cluster, run, child) : false;
      const upstreamIds = getBlockingUpstreamAgentIds(cluster, agent.agentId);
      agent.status = ready ? 'running' : 'waiting';
      agent.localContext.status = agent.status;
      agent.currentTask = !ready
        ? `等待上游完成：${upstreamIds.map((agentId) => cluster.agents.find((item) => item.agentId === agentId)?.name ?? agentId).join('、')}`
        : useWorkflowScript ? '等待 JS Workflow 调度' : '等待 Harness 提交子会话';
      agent.lastActivityAt = now;
      agent.runtimeSessionKey = child.sessionKey;
      agent.runtimeRunId = child.runId;
      addClusterEvent(cluster, {
        runId,
        agentId: agent.agentId,
        title: !ready ? (useWorkflowScript ? '等待 JS Workflow' : '等待上游节点') : '准备启动子会话',
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
  if (cluster.activeRunId && cluster.runs?.find((run) => run.runId === cluster.activeRunId)?.scriptSnapshot) {
    void runAgentClusterWorkflowScript(clusterId, cluster.activeRunId, gatewayManager, eventBus);
  } else if (cluster.activeRunId) {
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
      const run = (cluster.runs ?? []).find((item) => {
        const child = item.childRuns.find((candidate) => candidate.sessionKey === sessionKey);
        if (!child) return false;
        const isActiveRun = (item.status === 'running' || item.status === 'blocked')
          && item.harnessStatus === 'running'
          && cluster.activeRunId === item.runId;
        return isActiveRun || canRecoverTimedOutRunFromChild(cluster, item, child);
      });
      if (!run) continue;
      const child = run.childRuns.find((item) => item.sessionKey === sessionKey);
      const agent = child ? cluster.agents.find((item) => item.agentId === child.agentId) : null;
      if (!child || !agent) continue;
      const recoveringTimedOutRun = canRecoverTimedOutRunFromChild(cluster, run, child);

      const summary = summarizeRuntimeEvent(payload);
      if (child.status === 'completed') {
        child.status = 'completed';
        child.updatedAt = now;
        child.lastEventAt = now;
        child.runtimeWaitReason = undefined;
        agent.status = 'done';
        agent.localContext.status = 'done';
        agent.lastActivityAt = now;
        const eventChanged = appendRuntimeEventIfVisible(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          ...summary,
        }, now);
        updateRootRunStatus(cluster, run, now);
        if (eventChanged) cluster.updatedAt = now;
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
      if (recoveringTimedOutRun && !completion?.completed) continue;
      if (recoveringTimedOutRun && completion?.completed) {
        recoverTimedOutRunForLateCompletion(cluster, run, now);
        addClusterEvent(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          title: '迟到完成恢复',
          content: `${agent.name} 在 run 超时后返回了结构化完成信号；Harness 将校验当前 round 产物并继续推进。`,
          level: 'warning',
          createdAt: now,
        });
      }
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
      const runIdChanged = typeof maybeRunId === 'string' && maybeRunId && child.runId !== maybeRunId;
      if (typeof maybeRunId === 'string' && maybeRunId) child.runId = maybeRunId;

      if (!completion?.completed && summary.display === 'silent' && summary.level === 'info') {
        if (runIdChanged) {
          syncAgentWorkflowNodeRun(run, child, now);
          updateRootRunStatus(cluster, run, now);
          updateWorkflowCheckpoint(run, now);
          cluster.updatedAt = now;
          changedCluster = cluster;
        }
        continue;
      }

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
      syncAgentWorkflowNodeRun(run, child, now);
      applyWorkflowFailurePolicy(cluster, run, child, agent, now);
      syncAgentWorkflowNodeRun(run, child, now);
      await advanceDeterministicWorkflowNodes(cluster, run, now);
      const eventChanged = appendRuntimeEventIfVisible(cluster, {
        runId: run.runId,
        agentId: agent.agentId,
        ...summary,
      }, now);
      updateRootRunStatus(cluster, run, now);
      updateWorkflowCheckpoint(run, now);
      if (eventChanged || summary.level !== 'info' || summary.display !== 'silent') {
        cluster.updatedAt = now;
      }
      changedCluster = cluster;
    }

    if (changedCluster) {
      await writeClusters(clusters);
      eventBus?.emit('agent-cluster:updated', { cluster: changedCluster });
    }
    return changedCluster;
  });
}

export function getMessageContentText(message: Record<string, unknown>): string {
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

function hasAssistantTextContent(message: Record<string, unknown>): boolean {
  const content = message.content;
  if (typeof content === 'string') return Boolean(content.trim());
  if (!Array.isArray(content)) return false;
  return content.some((block) =>
    block
    && typeof block === 'object'
    && typeof (block as Record<string, unknown>).text === 'string'
    && Boolean(((block as Record<string, unknown>).text as string).trim())
  );
}

export function isLowSignalTranscriptActivity(message: Record<string, unknown>, content: string): boolean {
  if (hasAssistantTextContent(message)) return false;
  return /^(调用工具：[^。\n]+|工具返回结果。|模型正在思考并规划下一步。)(\n(?:调用工具：[^。\n]+|工具返回结果。|模型正在思考并规划下一步。))*$/u.test(content.trim());
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
  extendRunTimeout(run, now, true);
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
  const completedNodeRun = child.workflowNodeId ? workflowNodeRun(run, child.workflowNodeId) : undefined;
  if (completedNodeRun) {
    completedNodeRun.output = {
      ...(completedNodeRun.output ?? {}),
      summary: completion.summary,
      artifacts: validatedArtifacts,
      count: child.actualCandidateCount,
    };
  }

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

  const workflowNode = run.workflowSnapshot?.nodes.find((node) => node.nodeId === child.workflowNodeId);
  if (workflowNode?.type === 'review') {
    const verdict = content.match(/\[review\s*:\s*(pass|revise|fail)\s*\]/i)?.[1]?.toLowerCase();
    const nodeRun = workflowNodeRun(run, workflowNode.nodeId);
    if (nodeRun) {
      nodeRun.output = { ...(nodeRun.output ?? {}), verdict: verdict ?? 'pass', summary: completion.summary };
    }
    if (verdict === 'revise' && workflowNode.reviseTargetNodeId) {
      const targetNode = run.workflowSnapshot?.nodes.find((node) => node.nodeId === workflowNode.reviseTargetNodeId);
      const targetChild = targetNode && workflowNodeIsAgent(targetNode)
        ? run.childRuns.find((item) => item.agentId === targetNode.agentId)
        : undefined;
      const targetAgent = targetChild ? cluster.agents.find((item) => item.agentId === targetChild.agentId) : undefined;
      const retryPolicy = workflowNode.retryPolicy ?? run.workflowSnapshot?.policy.defaultRetryPolicy ?? defaultWorkflowPolicy().defaultRetryPolicy;
      const targetNodeRun = targetNode ? workflowNodeRun(run, targetNode.nodeId) : undefined;
      if (targetChild && targetAgent && (targetNodeRun?.attempt ?? 0) < retryPolicy.maxAttempts) {
        resetChildForRerun(cluster, run, targetChild, targetAgent, 'starting', now, targetChild.iteration);
        resetChildForRerun(cluster, run, child, agent, 'blocked', now, child.iteration);
        child.runtimeWaitReason = `等待 ${targetAgent.name} 按审查意见修订`;
        run.status = 'running';
        run.harnessStatus = 'running';
        run.error = undefined;
        run.completedAt = undefined;
        cluster.activeRunId = run.runId;
        addClusterEvent(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          title: '审查要求修订',
          content: `${agent.name} 已将工作退回 ${targetAgent.name}，Harness 将在修订完成后重新执行审查。`,
          level: 'warning',
          createdAt: now,
        });
        updateWorkflowCheckpoint(run, now);
        return;
      }
      run.harnessStatus = 'paused';
      run.status = 'running';
      child.status = 'blocked';
      child.runtimeWaitReason = '审查要求修订，但目标节点已达到重试上限';
    } else if (verdict === 'fail') {
      run.harnessStatus = 'paused';
      run.status = 'running';
      child.status = 'blocked';
      child.runtimeWaitReason = '审查失败，等待用户处理';
    }
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
  syncAgentWorkflowNodeRun(run, child, now);
  await advanceDeterministicWorkflowNodes(cluster, run, now);
  updateWorkflowCheckpoint(run, now);
}

async function recoverAgentCompletionFromArtifacts(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  now: string,
): Promise<boolean> {
  if (child.status === 'completed' || child.status === 'aborted') return false;
  const expectedArtifacts = expectedArtifactsForRunAgent(run, agent);
  if (expectedArtifacts.length === 0) return false;
  if (!(await hasExpectedArtifactsForRecovery(run, child, agent))) return false;
  const projectRoot = getClusterProjectRoot(cluster);
  const canonicalPaths = projectRoot ? await getCanonicalArtifactPathsForAgent(run, child, agent) : [];
  const canonicalArtifacts = projectRoot ? canonicalPaths.map((filePath) => relative(projectRoot, filePath)) : [];
  const wasPassed = child.artifactValidationStatus === 'passed'
    && JSON.stringify(child.artifacts ?? []) === JSON.stringify(canonicalArtifacts);
  child.artifacts = canonicalArtifacts;
  child.expectedArtifacts = expectedArtifactLabelsForRunAgent(run, agent, child);
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

function isRecoverableSubmissionFailure(child: AgentClusterChildRun): boolean {
  if (child.status !== 'error' || child.submitStatus !== 'failed') return false;
  if (child.runtimeFailureKind && child.runtimeFailureKind !== 'stale_after_restart') return false;
  const text = `${child.error ?? ''} ${child.artifactValidationError ?? ''} ${child.runtimeWaitReason ?? ''}`.toLowerCase();
  if (!text.trim()) return false;
  return /\brpc\b|\bgateway\b|\btimeout\b|timed out|network|socket|econnreset|econnrefused|fetch failed|request failed|提交|连接|超时/.test(text);
}

export async function applyRuntimeDoneArtifactCompletion(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  entry: Record<string, unknown>,
  now: string,
): Promise<boolean> {
  const recoveringSubmissionFailure = isRecoverableSubmissionFailure(child);
  if (
    child.status === 'completed'
    || child.status === 'aborted'
    || child.status === 'timeout'
    || (child.status === 'error' && !recoveringSubmissionFailure)
  ) {
    return false;
  }
  if (child.submitStatus !== 'submitted' && !recoveringSubmissionFailure) return false;
  if (!runtimeSessionIsDone(entry)) return false;
  if (runtimeTerminalEntryPredatesChildRun(entry, child)) return false;
  if (summarizeRuntimeSessionFailure(entry)) return false;

  const expectedArtifacts = expectedArtifactsForRunAgent(run, agent);
  if (expectedArtifacts.length === 0) return false;
  if (!(await hasExpectedArtifactsForRecovery(run, child, agent))) return false;

  const projectRoot = getClusterProjectRoot(cluster);
  const canonicalPaths = await getCanonicalArtifactPathsForAgent(run, child, agent);
  const canonicalArtifacts = projectRoot
    ? canonicalPaths.map((filePath) => relative(projectRoot, filePath))
    : canonicalPaths;
  if (canonicalArtifacts.length === 0) return false;

  child.status = 'completed';
  child.submitStatus = 'submitted';
  child.completionSignal = 'runtime session done + required artifacts passed';
  child.completionSource = 'fallback';
  child.unblockedAgentIds = getBlockingDownstreamAgentIds(cluster, agent.agentId);
  child.artifacts = canonicalArtifacts;
  child.expectedArtifacts = expectedArtifactLabelsForRunAgent(run, agent, child);
  child.artifactValidationStatus = 'passed';
  child.artifactValidationError = undefined;
  child.error = undefined;
  child.runtimeFailureKind = undefined;
  child.runtimeWaitReason = undefined;
  child.completedAt = now;
  child.updatedAt = now;
  child.lastEventAt = now;
  extendRunTimeout(run, now, true);

  agent.status = 'done';
  agent.localContext.status = 'done';
  agent.currentTask = '子会话已结束，必需产物已通过校验';
  agent.runtimeStatusReason = '自动识别完成';
  agent.lastActivityAt = now;

  const summary = `${agent.name} 的 OpenClaw 子会话已结束，且当前 required artifacts 已通过校验；已自动标记完成并推进 Workflow。`;
  agent.localContext.outputs = [
    ...agent.localContext.outputs,
    {
      outputId: randomUUID(),
      agentId: agent.agentId,
      content: summary,
      createdAt: now,
    },
  ].slice(-20);
  cluster.sharedContext.agentSummaries = [
    ...(cluster.sharedContext.agentSummaries ?? []).filter((item) => item.agentId !== agent.agentId),
    {
      agentId: agent.agentId,
      name: agent.name,
      summary,
      updatedAt: now,
    },
  ];
  cluster.sharedContext.latestArtifacts = [
    ...(cluster.sharedContext.latestArtifacts ?? []),
    ...canonicalArtifacts.map((artifact) => ({ agentId: agent.agentId, artifact, createdAt: now })),
  ].slice(-30);

  const completedNodeRun = child.workflowNodeId ? workflowNodeRun(run, child.workflowNodeId) : undefined;
  if (completedNodeRun) {
    completedNodeRun.output = {
      ...(completedNodeRun.output ?? {}),
      summary,
      artifacts: canonicalArtifacts,
      completionSource: 'fallback',
      iteration: child.iteration,
      count: child.actualCandidateCount,
    };
  }
  syncAgentWorkflowNodeRun(run, child, now);
  maybeAdvanceExecutionLoops(cluster, run, agent.agentId, now);
  await advanceDeterministicWorkflowNodes(cluster, run, now);
  updateWorkflowCheckpoint(run, now);

  const recoveryPrefix = recoveringSubmissionFailure
    ? '子会话曾出现提交/RPC 错误，但 '
    : '';
  addClusterEvent(cluster, {
    runId: run.runId,
    agentId: agent.agentId,
    title: '自动识别完成',
    content: `${recoveryPrefix}${summary}`,
    level: 'success',
    createdAt: now,
  });
  return true;
}

async function recoverAgentCompletionFromDoneSessionArtifacts(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  now: string,
): Promise<boolean> {
  if (!child.sessionKey || child.submitStatus !== 'submitted') return false;
  const entry = await readRuntimeSessionStoreEntry(child.sessionKey);
  if (!entry) return false;
  return applyRuntimeDoneArtifactCompletion(cluster, run, child, agent, entry, now);
}

async function recoverChildRuntimeSessionFailure(
  cluster: AgentCluster,
  run: AgentClusterRun,
  child: AgentClusterChildRun,
  agent: ClusterAgent,
  now: string,
): Promise<boolean> {
  if (child.status === 'completed' || child.status === 'aborted' || child.status === 'error' || child.status === 'timeout') {
    return false;
  }
  if (!child.sessionKey || child.submitStatus !== 'submitted') return false;

  const entry = await readRuntimeSessionStoreEntry(child.sessionKey);
  if (!entry) return false;
  if (runtimeTerminalEntryPredatesChildRun(entry, child)) return false;
  const runtimeFailureReason = summarizeRuntimeSessionFailure(entry);
  const incompleteOutputReason = runtimeFailureReason
    ? null
    : await summarizeRuntimeDoneMissingArtifacts(entry, run, child, agent);
  const reason = runtimeFailureReason ?? incompleteOutputReason;
  if (!reason) return false;
  const isIncompleteOutput = Boolean(incompleteOutputReason);

  child.status = isIncompleteOutput ? 'blocked' : 'error';
  child.submitStatus = 'failed';
  child.error = reason;
  child.runtimeFailureKind = isIncompleteOutput ? 'incomplete_output' : 'runtime_error';
  child.runtimeWaitReason = undefined;
  child.updatedAt = now;
  child.lastEventAt = now;
  child.artifactValidationStatus = 'failed';
  child.artifactValidationError = reason;

  agent.status = isIncompleteOutput ? 'waiting' : 'error';
  agent.localContext.status = agent.status;
  agent.currentTask = isIncompleteOutput ? '缺产物结束' : '子会话失败';
  agent.runtimeStatusReason = reason;
  agent.lastActivityAt = now;

  syncAgentWorkflowNodeRun(run, child, now);
  const nodeRun = child.workflowNodeId ? workflowNodeRun(run, child.workflowNodeId) : undefined;
  if (nodeRun) {
    nodeRun.status = isIncompleteOutput ? 'waiting' : 'failed';
    nodeRun.error = reason;
    nodeRun.waitingReason = isIncompleteOutput ? reason : nodeRun.waitingReason;
    nodeRun.completedAt = isIncompleteOutput ? undefined : now;
    nodeRun.updatedAt = now;
  }

  addClusterEvent(cluster, {
    runId: run.runId,
    agentId: agent.agentId,
    title: isIncompleteOutput ? '缺产物结束' : '子会话失败',
    content: reason,
    level: 'error',
    createdAt: now,
  });

  if (!runtimeFailureAllowsAutoRetry(child.runtimeFailureKind)) {
    run.harnessStatus = 'paused';
    run.status = 'blocked';
    cluster.activeRunId = run.runId;
  } else {
    applyWorkflowFailurePolicy(cluster, run, child, agent, now);
  }
  updateWorkflowCheckpoint(run, now);
  return true;
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

export type AgentClusterChildRunForRuntimeChecks = Pick<
  AgentClusterChildRun,
  'status' | 'submitStatus' | 'startedAt' | 'updatedAt' | 'lastEventAt'
>;

function parseIsoMs(value?: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function runtimeEntryTimeMs(entry: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = entry[key];
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

export function runtimeTerminalEntryPredatesChildRun(
  entry: Record<string, unknown>,
  child: Pick<AgentClusterChildRun, 'startedAt' | 'promptMode'>,
  graceMs = 1_000,
): boolean {
  const startedAtMs = parseIsoMs(child.startedAt);
  if (!startedAtMs) return false;
  if (!runtimeSessionIsDone(entry) && !summarizeRuntimeSessionFailure(entry)) return false;
  const terminalAtMs = runtimeEntryTimeMs(entry, ['endedAt', 'completedAt', 'finishedAt']);
  if (terminalAtMs !== null) return terminalAtMs <= startedAtMs + graceMs;
  const entryStartedAtMs = runtimeEntryTimeMs(entry, ['startedAt', 'createdAt']);
  const entryUpdatedAtMs = runtimeEntryTimeMs(entry, ['updatedAt']);
  return Boolean(
    entryStartedAtMs !== null
    && entryStartedAtMs + graceMs < startedAtMs
    && entryUpdatedAtMs !== null
    && entryUpdatedAtMs <= startedAtMs + graceMs,
  );
}

function getChildLastRealActivityMs(child: Pick<AgentClusterChildRun, 'lastEventAt' | 'startedAt'>): number | null {
  return parseIsoMs(child.lastEventAt) ?? parseIsoMs(child.startedAt);
}

export function shouldMarkChildStaleAfterGatewayRestart({
  child,
  gatewayConnectedAtMs,
  checkedHistory,
  sawNewTranscript,
  nowMs,
  graceMs = STALE_AFTER_GATEWAY_RESTART_GRACE_MS,
}: {
  child: AgentClusterChildRunForRuntimeChecks;
  gatewayConnectedAtMs?: number;
  checkedHistory: boolean;
  sawNewTranscript: boolean;
  nowMs: number;
  graceMs?: number;
}): boolean {
  if (!checkedHistory || sawNewTranscript) return false;
  if (child.submitStatus !== 'submitted') return false;
  if (child.status !== 'running' && child.status !== 'starting') return false;
  if (!gatewayConnectedAtMs || !Number.isFinite(gatewayConnectedAtMs)) return false;
  if (nowMs - gatewayConnectedAtMs < graceMs) return false;
  const startedAtMs = parseIsoMs(child.startedAt);
  const lastActivityMs = getChildLastRealActivityMs(child);
  if (!startedAtMs || !lastActivityMs) return false;
  return startedAtMs < gatewayConnectedAtMs && lastActivityMs < gatewayConnectedAtMs;
}

async function refreshRunEventsLocked(
  cluster: AgentCluster,
  run: AgentClusterRun,
  gatewayManager: GatewayManager,
): Promise<boolean> {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const gatewayConnectedAtMs = typeof gatewayManager.getStatus === 'function'
    ? gatewayManager.getStatus().connectedAt
    : undefined;
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
      const sawNewTranscript = newMessages.length > 0;
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
        const role = String(message.role ?? '').toLowerCase();
        if (role !== 'assistant' && role !== 'toolresult' && role !== 'tool') continue;
        const fullContent = getMessageContentText(message);
        const content = compactText(fullContent, 500);
        if (!content) continue;
        const lowSignalActivity = isLowSignalTranscriptActivity(message, content);
        mergeWorkflowTokenUsage(
          child.workflowNodeId ? workflowNodeRun(run, child.workflowNodeId) : undefined,
          message,
        );
        const completion = role === 'assistant' ? parseCompletionSignal(cluster, agent, fullContent) : null;
        if (!lowSignalActivity || completion?.completed) {
          addClusterEvent(cluster, {
            runId: run.runId,
            agentId: agent.agentId,
            title: role === 'assistant' ? '子会话输出' : '工具事件',
            content,
            level: 'info',
            display: lowSignalActivity ? 'silent' : 'visible',
            raw: message,
            createdAt: now,
          });
        }
        if (completion?.completed) {
          try {
            await applyAgentCompletionSignal(cluster, run, child, agent, completion, fullContent, now);
          } catch {
            // validateAgentCompletionArtifacts already marks the child run as failed with details.
          }
        } else {
          agent.currentTask = content;
          agent.runtimeStatusReason = lowSignalActivity ? '子会话活动' : role === 'assistant' ? '子会话输出' : '工具事件';
          agent.lastActivityAt = now;
          child.lastEventAt = now;
          child.runtimeWaitReason = undefined;
          if (child.status !== 'completed') child.status = 'running';
          child.submitStatus = 'submitted';
        }
        if (extendRunTimeout(run, now)) changed = true;
        changed = true;
      }
      if (messages.length > 0) {
        child.lastTranscriptMessageId = getTranscriptMessageId(messages[messages.length - 1], messages.length - 1);
      }
      syncAgentWorkflowNodeRun(run, child, now);
      if (await recoverAgentCompletionFromArtifacts(cluster, run, child, agent, now)) {
        changed = true;
      }
      if (await recoverAgentCompletionFromDoneSessionArtifacts(cluster, run, child, agent, now)) {
        changed = true;
        continue;
      }
      if (await recoverChildRuntimeSessionFailure(cluster, run, child, agent, now)) {
        changed = true;
        continue;
      }
      if (shouldMarkChildStaleAfterGatewayRestart({
        child,
        gatewayConnectedAtMs,
        checkedHistory: true,
        sawNewTranscript,
        nowMs,
      })) {
        const lastActivity = new Date(getChildLastRealActivityMs(child) ?? nowMs).toLocaleString();
        const reason = `子会话可能因 Gateway/Electron 重启中断，最后活动时间为 ${lastActivity}；请重试或从这里开始。`;
        child.status = 'error';
        child.submitStatus = 'failed';
        child.error = reason;
        child.runtimeFailureKind = 'stale_after_restart';
        child.runtimeWaitReason = undefined;
        child.updatedAt = now;
        child.completedAt = now;
        child.artifactValidationStatus = 'failed';
        child.artifactValidationError = reason;
        agent.status = 'error';
        agent.localContext.status = 'error';
        agent.currentTask = '子会话已中断';
        agent.runtimeStatusReason = reason;
        agent.lastActivityAt = now;
        syncAgentWorkflowNodeRun(run, child, now);
        const nodeRun = child.workflowNodeId ? workflowNodeRun(run, child.workflowNodeId) : undefined;
        if (nodeRun) {
          nodeRun.status = 'failed';
          nodeRun.error = reason;
          nodeRun.completedAt = now;
          nodeRun.updatedAt = now;
        }
        addClusterEvent(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          title: '子会话已中断',
          content: reason,
          level: 'error',
          createdAt: now,
        });
        run.harnessStatus = 'paused';
        run.status = 'blocked';
        cluster.activeRunId = run.runId;
        updateWorkflowCheckpoint(run, now);
        changed = true;
        continue;
      }
    } catch (error) {
      const message = `读取子会话历史失败：${error instanceof Error ? error.message : String(error)}`;
      if (child.runtimeWaitReason !== message) {
        child.runtimeWaitReason = message;
        child.updatedAt = now;
        agent.runtimeStatusReason = '等待 Gateway';
        addClusterEvent(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          title: '读取子会话历史失败',
          content: message,
          level: 'warning',
          createdAt: now,
        });
        changed = true;
      }
    }

    if (await recoverAgentCompletionFromDoneSessionArtifacts(cluster, run, child, agent, now)) {
      changed = true;
      continue;
    }

    if (await recoverChildRuntimeSessionFailure(cluster, run, child, agent, now)) {
      changed = true;
      continue;
    }

    if (
      child.status === 'completed'
      || child.status === 'error'
      || child.status === 'timeout'
      || child.status === 'aborted'
      || child.submitStatus === 'failed'
      || child.runtimeFailureKind === 'incomplete_output'
      || run.harnessStatus === 'paused'
      || run.harnessStatus === 'waiting_human'
    ) continue;
    const lastEventMs = new Date(child.lastEventAt ?? child.updatedAt ?? child.startedAt).getTime();
    if (Date.now() - lastEventMs > CHILD_NO_EVENT_TIMEOUT_MS) {
      const waitReason = '超过 5 分钟没有新的 Gateway 事件或 transcript 更新，系统会继续自动轮询子会话历史和本轮产物。';
      const shouldEmitWaitEvent = child.runtimeWaitReason !== waitReason;
      if (shouldEmitWaitEvent) {
        child.status = child.status === 'blocked' ? 'blocked' : 'running';
        child.runtimeWaitReason = waitReason;
        child.updatedAt = now;
        agent.status = child.status === 'blocked' ? 'waiting' : 'running';
        agent.localContext.status = agent.status;
        agent.currentTask = '等待子会话产物';
        agent.runtimeStatusReason = '等待产物';
        addClusterEvent(cluster, {
          runId: run.runId,
          agentId: agent.agentId,
          title: '等待子会话产物',
          content: waitReason,
          level: 'info',
          createdAt: now,
        });
        changed = true;
      }
    }
  }
  if (await reconcileRunArtifacts(cluster, run, now)) {
    changed = true;
  }
  if (await advanceDeterministicWorkflowNodes(cluster, run, now)) {
    changed = true;
  }
  if (
    run.harnessStatus === 'paused'
    && hasStartingPendingDispatchableChild(cluster, run)
    && resumeRunForDispatchableManualProgress(cluster, run, now)
  ) {
    changed = true;
  }
  const rootStateBefore = JSON.stringify({
    status: run.status,
    harnessStatus: run.harnessStatus,
    error: run.error,
    completedAt: run.completedAt,
    activeRunId: cluster.activeRunId,
    submittedChildCount: run.submittedChildCount,
    completedChildCount: run.completedChildCount,
    failedChildCount: run.failedChildCount,
  });
  updateRootRunStatus(cluster, run, now);
  const rootStateAfter = JSON.stringify({
    status: run.status,
    harnessStatus: run.harnessStatus,
    error: run.error,
    completedAt: run.completedAt,
    activeRunId: cluster.activeRunId,
    submittedChildCount: run.submittedChildCount,
    completedChildCount: run.completedChildCount,
    failedChildCount: run.failedChildCount,
  });
  if (rootStateBefore !== rootStateAfter) changed = true;
  if (run.status === 'running' && !cluster.activeRunId) {
    cluster.activeRunId = run.runId;
    changed = true;
  }
  run.watchdogStatus = cluster.activeRunId === run.runId ? 'watching' : 'settled';
  if (changed) {
    updateWorkflowCheckpoint(run, now);
    cluster.updatedAt = now;
  }
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
    const changed = await refreshRunEventsLocked(cluster, run, gatewayManager);
    if (changed) {
      clusters[index] = cluster;
      await writeClusters(clusters);
      eventBus?.emit('agent-cluster:updated', { cluster });
    }
    return cluster;
  });
  if (cluster.activeRunId === runId) {
    void submitReadyAgentClusterChildren(clusterId, runId, gatewayManager, eventBus);
  }
  return cluster;
}

export async function pauseAgentClusterRun(
  clusterId: string,
  runId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  const sessionKeys = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const cluster = clusters.find((item) => item.clusterId === clusterId);
    const run = cluster ? findRun(cluster, runId) : null;
    return run?.childRuns
      .filter((child) =>
        child.status === 'running'
        || child.status === 'starting'
        || (child.submitStatus === 'submitted' && child.status !== 'completed' && child.status !== 'aborted')
      )
      .map((child) => child.sessionKey) ?? [];
  });
  await Promise.allSettled(sessionKeys.map((sessionKey) => gatewayManager.rpc('chat.abort', { sessionKey }, 5_000)));
  clearAgentClusterRunWatchdog(clusterId, runId);
  const cluster = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const run = findRun(cluster, runId);
    if (run.status !== 'running') throw new Error('只有运行中的 Workflow 可以暂停');
    const now = new Date().toISOString();
    for (const child of run.childRuns) {
      if (child.status === 'completed' || child.status === 'aborted' || child.status === 'error' || child.status === 'timeout') continue;
      if (child.status !== 'running' && child.status !== 'starting' && child.submitStatus !== 'submitted') continue;
      const agent = cluster.agents.find((item) => item.agentId === child.agentId);
      resetChildForRerun(cluster, run, child, agent, 'blocked', now, child.iteration);
      child.runtimeWaitReason = '暂停中，可恢复';
      if (agent) {
        agent.status = 'waiting';
        agent.localContext.status = 'waiting';
        agent.currentTask = '暂停中，可恢复';
        agent.runtimeStatusReason = '用户暂停';
      }
    }
    run.harnessStatus = 'paused';
    run.status = 'blocked';
    run.pauseRequestedAt = now;
    run.updatedAt = now;
    updateWorkflowCheckpoint(run, now);
    addClusterEvent(cluster, {
      runId,
      agentId: null,
      title: 'Workflow 已暂停',
      content: 'Harness 已停止提交新节点，并已请求中止当前活动子会话；恢复时会从未完成节点重新提交。',
      level: 'warning',
      createdAt: now,
    });
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
  eventBus?.emit('agent-cluster:updated', { cluster });
  return cluster;
}

export async function resumeAgentClusterRun(
  clusterId: string,
  runId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  const cluster = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((item) => item.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const run = findRun(cluster, runId);
    if (run.harnessStatus !== 'paused') throw new Error('Workflow 当前不是暂停状态');
    const waitingHuman = run.nodeRuns?.some((nodeRun) => nodeRun.status === 'waiting_human');
    if (waitingHuman) throw new Error('请先处理 Human Gate，再恢复 Workflow');
    const now = new Date().toISOString();
    run.harnessStatus = 'running';
    run.pauseRequestedAt = undefined;
    run.status = 'running';
    run.error = undefined;
    run.completedAt = undefined;
    run.updatedAt = now;
    cluster.activeRunId = runId;
    await advanceDeterministicWorkflowNodes(cluster, run, now);
    updateWorkflowCheckpoint(run, now);
    addClusterEvent(cluster, {
      runId,
      agentId: null,
      title: 'Workflow 已恢复',
      content: 'Harness 将从 checkpoint 继续，已完成节点不会重跑。',
      level: 'success',
      createdAt: now,
    });
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

export async function stopAgentClusterRun(
  clusterId: string,
  runId: string,
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  clearAgentClusterRunWatchdog(clusterId, runId);
  const sessionKeys = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const cluster = clusters.find((item) => item.clusterId === clusterId);
    const run = cluster ? findRun(cluster, runId) : null;
    return run?.childRuns
      .filter((child) =>
        child.status === 'running'
        || child.status === 'starting'
        || (child.submitStatus === 'submitted' && child.status !== 'completed' && child.status !== 'aborted')
      )
      .map((child) => child.sessionKey) ?? [];
  });
  await Promise.allSettled(sessionKeys.map((sessionKey) => gatewayManager.rpc('chat.abort', { sessionKey }, 5_000)));
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const run = findRun(cluster, runId);
    const now = new Date().toISOString();
    for (const child of run.childRuns) {
      if (child.status === 'completed') continue;
      child.status = 'aborted';
      child.completedAt = now;
      child.updatedAt = now;
      syncAgentWorkflowNodeRun(run, child, now);
      const agent = cluster.agents.find((item) => item.agentId === child.agentId);
      if (agent && agent.status !== 'done') {
        agent.status = 'idle';
        agent.localContext.status = 'idle';
        agent.currentTask = '运行已停止';
        agent.runtimeStatusReason = '用户停止';
      }
    }
    for (const nodeRun of run.nodeRuns ?? []) {
      if (!workflowNodeSucceeded(nodeRun.status)) {
        nodeRun.status = 'aborted';
        nodeRun.updatedAt = now;
        nodeRun.completedAt = now;
      }
    }
    run.status = 'aborted';
    run.harnessStatus = 'aborted';
    run.stopRequestedAt = now;
    run.stoppedAt = now;
    run.completedAt = now;
    run.updatedAt = now;
    cluster.activeRunId = null;
    updateWorkflowCheckpoint(run, now);
    addClusterEvent(cluster, {
      runId,
      agentId: null,
      title: 'Workflow 已停止',
      content: '活动子会话已请求中止，已完成节点和 checkpoint 保留。',
      level: 'warning',
      createdAt: now,
    });
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    eventBus?.emit('agent-cluster:updated', { cluster });
    return cluster;
  });
}

export async function decideAgentClusterHumanGate(
  clusterId: string,
  runId: string,
  nodeId: string,
  decision: 'approve' | 'reject',
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<AgentCluster> {
  const cluster = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((item) => item.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const run = findRun(cluster, runId);
    const node = run.workflowSnapshot?.nodes.find((item) => item.nodeId === nodeId);
    const nodeRun = workflowNodeRun(run, nodeId);
    if (!node || node.type !== 'human_gate' || !nodeRun) throw new Error('Human Gate not found');
    if (nodeRun.status !== 'waiting_human') throw new Error('Human Gate 当前不等待决策');
    const now = new Date().toISOString();
    if (decision === 'approve') {
      nodeRun.status = 'completed';
      nodeRun.output = { decision: 'approve' };
      nodeRun.completedAt = now;
      run.harnessStatus = 'running';
      run.status = 'running';
      cluster.activeRunId = runId;
    } else {
      nodeRun.status = 'failed';
      nodeRun.output = { decision: 'reject' };
      nodeRun.error = '用户拒绝继续';
      run.harnessStatus = 'paused';
    }
    nodeRun.updatedAt = now;
    await advanceDeterministicWorkflowNodes(cluster, run, now);
    updateWorkflowCheckpoint(run, now);
    addClusterEvent(cluster, {
      runId,
      agentId: null,
      title: decision === 'approve' ? '人工确认通过' : '人工确认拒绝',
      content: node.name,
      level: decision === 'approve' ? 'success' : 'warning',
      createdAt: now,
    });
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    eventBus?.emit('agent-cluster:updated', { cluster });
    return cluster;
  });
  if (decision === 'approve') {
    void submitReadyAgentClusterChildren(clusterId, runId, gatewayManager, eventBus);
    scheduleAgentClusterRunWatchdog(clusterId, runId, gatewayManager, eventBus);
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

export async function resetAgentClusterCurrentTaskContext(clusterId: string): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const now = new Date().toISOString();

    for (const run of cluster.runs ?? []) {
      clearAgentClusterRunWatchdog(cluster.clusterId, run.runId);
    }

    cluster.runs = [];
    cluster.activeRunId = null;
    cluster.runtimeSessionKey = null;
    cluster.messages = [];
    cluster.events = [];
    cluster.sharedContext.managerInstructions = [];
    cluster.sharedContext.runDecisions = [];
    cluster.sharedContext.latestArtifacts = [];
    cluster.sharedContext.artifacts = [];
    cluster.sharedContext.finalSummary = '';
    cluster.sharedContext.managerProposals = (cluster.sharedContext.managerProposals ?? [])
      .filter((proposal) => proposal.status !== 'pending')
      .slice(-20);
    cluster.sharedContext.agentSummaries = cluster.agents.map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      summary: `${agent.name} 已准备好处理新任务。`,
      updatedAt: now,
    }));

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
        note: '已清理本轮运行上下文；保留 Agent 定义、已确认 prompt patch 和 Workflow。',
      };
    }

    cluster.messages.push(makeMessage(clusterId, {
      senderType: 'orchestrator',
      senderAgentId: null,
      targetType: 'cluster',
      targetAgentId: null,
      messageType: 'update',
      content: '已开始新任务：本轮运行上下文已清理，项目磁盘产物不会被删除。',
      visibility: 'public',
    }, now));

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
    resetChildForRerun(cluster, run, child, agent, 'starting', now, child.iteration, {
      preserveSession: true,
      promptMode: 'repair',
      promptReason: '用户手动重试；修复当前 round 的缺失或失败产物。',
    });
    agent.status = 'running';
    agent.localContext.status = 'running';
    agent.currentTask = '正在重试该 Agent';
    agent.runtimeStatusReason = '手动重试';
    agent.lastActivityAt = now;
    run.status = 'running';
    run.harnessStatus = 'running';
    run.error = undefined;
    run.completedAt = undefined;
    run.watchdogStatus = 'watching';
    run.timeoutAt = new Date(Date.now() + RUN_TIMEOUT_MS).toISOString();
    cluster.activeRunId = runId;
    addClusterEvent(cluster, {
      runId,
      agentId,
      title: '重试 Agent',
      content: isProjectDirectoryRuntimeMode(cluster)
        ? `${agent.name} 将使用新的子会话修复 round_${getChildIteration(child)}。`
        : `${agent.name} 将在同一个子会话中修复 round_${getChildIteration(child)}。`,
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
    syncAgentWorkflowNodeRun(run, child, now);
    await advanceDeterministicWorkflowNodes(cluster, run, now);
    resumeRunForDispatchableManualProgress(cluster, run, now);
    updateRootRunStatus(cluster, run, now);
    updateWorkflowCheckpoint(run, now);
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
		  if (projectRoot && (!run.outputRoot || !basename(run.outputRoot).startsWith('version_'))) {
		    const output = await allocateClusterExperimentOutput(projectRoot, cluster.clusterId, run.startedAt ?? new Date().toISOString());
	    run.outputRoot = output.outputRoot;
	    run.outputVersion = output.outputVersion;
	    run.outputCreatedAt = output.outputCreatedAt;
	    run.roundStart = output.roundStart;
		    for (const child of run.childRuns) {
		      child.outputRoot = run.outputRoot;
		    }
		  }
    const affectedAgentIds = new Set([agentId, ...getBlockingDownstreamClosure(cluster, agentId)]);
    const now = new Date().toISOString();
    const projectDirectoryMode = isProjectDirectoryRuntimeMode(cluster);
    const currentChild = run.childRuns.find((child) => child.agentId === agentId);
    const upstreamIterations = getBlockingUpstreamAgentIds(cluster, agentId)
      .map((upstreamAgentId) => run.childRuns.find((child) => child.agentId === upstreamAgentId))
      .filter((child): child is AgentClusterChildRun => Boolean(child) && child.status === 'completed')
      .map((child) => getChildIteration(child));
    const currentIteration = getChildIteration(currentChild);
    const workflow = run.workflowSnapshot ?? getCurrentWorkflow(cluster);
    const targetWorkflowNode = workflow.nodes.find((node) => workflowNodeIsAgent(node) && node.agentId === agentId);
    const affectedAgentNodeIds = new Set(workflow.nodes
      .filter((node) => workflowNodeIsAgent(node) && affectedAgentIds.has(node.agentId))
      .map((node) => node.nodeId));
    const loopIterations = (run.loopStates ?? [])
      .filter((state) => state.status === 'running')
      .filter((state) => {
        const loopNode = workflow.nodes.find((node): node is WorkflowLoopNode => node.nodeId === state.loopId && node.type === 'loop');
        if (!loopNode) return false;
        return getOrderedWorkflowLoopBodyNodeIds(workflow, loopNode)
          .some((nodeId) => {
            const node = workflow.nodes.find((item) => item.nodeId === nodeId);
            return Boolean(node && workflowNodeIsAgent(node) && node.agentId === agentId);
          });
      })
      .map((state) => getOutputRoundForLoopStateIteration(run, state));
    const latestCompletedArtifactIteration = currentChild
      ? await inferLatestCompletedArtifactIterationForAgent(run, currentChild, agent, getRunRoundStart(run))
      : null;
    const startsNewRound = currentChild?.status === 'completed';
    const resumeIteration = startsNewRound
      ? currentIteration + 1
      : Math.max(
          currentIteration,
          latestCompletedArtifactIteration ?? 1,
          ...(upstreamIterations.length > 0 ? upstreamIterations : [1]),
          ...(loopIterations.length > 0 ? loopIterations : [1]),
        );
    run.status = 'running';
    run.harnessStatus = 'running';
    run.error = undefined;
    run.completedAt = undefined;
    run.watchdogStatus = 'watching';
    run.timeoutAt = new Date(Date.now() + RUN_TIMEOUT_MS).toISOString();
    cluster.activeRunId = runId;

    const existingLoopStates = new Map((run.loopStates ?? []).map((state) => [state.loopId, state]));
    let resumedLoopRepeatCount: number | null = null;
    let resumedLoopOutputRoundStart: number | null = null;
    const resumedLoopDeterministicNodeIds = new Set<string>();
    run.loopStates = workflow.nodes.filter((node): node is WorkflowLoopNode => node.type === 'loop').map((loop) => {
      const state = existingLoopStates.get(loop.nodeId) ?? {
        loopId: loop.nodeId,
        currentIteration: 1,
        repeatCount: loop.repeatCount,
        outputRoundStart: getRunRoundStart(run),
        status: 'idle' as const,
        updatedAt: now,
      };
      const path = getOrderedWorkflowLoopBodyNodeIds(workflow, loop)
        .map((nodeId) => workflow.nodes.find((item) => item.nodeId === nodeId))
        .filter((node): node is WorkflowAgentNode => Boolean(node) && workflowNodeIsAgent(node))
        .map((node) => node.agentId);
      if (!path.includes(agentId)) return state;
      const outputRoundStart = startsNewRound ? resumeIteration : getLoopOutputRoundStart(run, state);
      const segmentIteration = startsNewRound
        ? 1
        : Math.max(1, resumeIteration - outputRoundStart + 1);
      if (startsNewRound) {
        resumedLoopRepeatCount = loop.repeatCount;
        resumedLoopOutputRoundStart = outputRoundStart;
        for (const deterministicNodeId of collectLoopDeterministicNodeIds(workflow, loop)) {
          resumedLoopDeterministicNodeIds.add(deterministicNodeId);
        }
      }
      return {
        ...state,
        currentIteration: segmentIteration,
        repeatCount: loop.repeatCount,
        outputRoundStart,
        status: segmentIteration >= loop.repeatCount ? 'completed' : 'running',
        updatedAt: now,
      };
    });
    for (const deterministicNodeId of resumedLoopDeterministicNodeIds) {
      resetWorkflowNodeForLoopIteration(run, deterministicNodeId, now);
    }
    if (targetWorkflowNode) {
      for (const deterministicNodeId of collectDownstreamDeterministicNodeIds(workflow, targetWorkflowNode.nodeId, affectedAgentNodeIds)) {
        resetWorkflowNodeForLoopIteration(run, deterministicNodeId, now);
      }
    }
    const resumeLoopDescription = startsNewRound && resumedLoopRepeatCount && resumedLoopRepeatCount > 1
      ? `按当前 Workflow Loop 执行 ${resumedLoopRepeatCount} 轮，写入 round_${resumedLoopOutputRoundStart ?? resumeIteration} 起`
      : null;

    for (const child of run.childRuns) {
      if (!affectedAgentIds.has(child.agentId)) continue;
      const affectedAgent = cluster.agents.find((item) => item.agentId === child.agentId);
      const isTarget = child.agentId === agentId;
      const wasCompleted = child.status === 'completed';
      const promptMode: AgentClusterChildPromptMode = startsNewRound || wasCompleted ? 'continuation' : isTarget ? 'repair' : 'initial';
      resetChildForRerun(cluster, run, child, affectedAgent, isTarget ? 'starting' : 'blocked', now, resumeIteration, {
        preserveSession: !projectDirectoryMode && Boolean(child.sessionKey) && (startsNewRound || wasCompleted || isTarget),
        promptMode,
        promptReason: startsNewRound
          ? resumeLoopDescription
            ? `用户从 ${agent.name} 开始；${resumeLoopDescription}。`
            : `用户从 ${agent.name} 开始新一轮；当前 round_${resumeIteration}。`
          : isTarget
            ? `用户从 ${agent.name} 继续修复当前 round_${resumeIteration}。`
            : `等待 ${agent.name} 完成后继续当前链路。`,
      });
      if (affectedAgent) {
        affectedAgent.currentTask = isTarget
          ? startsNewRound
            ? resumeLoopDescription
              ? `Cluster Manager 要求从该节点开始，${resumeLoopDescription}`
              : `Cluster Manager 要求从该节点开始新一轮（round ${resumeIteration}）`
            : `Cluster Manager 要求从该节点继续修复（round ${resumeIteration}）`
          : `等待 ${agent.name} 重新完成（round ${resumeIteration}）`;
        affectedAgent.runtimeStatusReason = isTarget
          ? startsNewRound ? '从指定节点开始新一轮' : '从指定节点继续'
          : 'DAG 阻塞';
      }
    }

    cluster.sharedContext.runDecisions = [
      ...(cluster.sharedContext.runDecisions ?? []),
      {
	        decisionId: randomUUID(),
	        title: startsNewRound ? '从指定 Agent 开始新一轮' : '从指定 Agent 继续运行',
	        content: startsNewRound
            ? projectDirectoryMode
              ? `Cluster Manager 将从 ${agent.name} 开始${resumeLoopDescription ? `，${resumeLoopDescription}` : ` round_${resumeIteration}`}，使用新的子会话和已完成上游产物。`
              : `Cluster Manager 将从 ${agent.name} 开始${resumeLoopDescription ? `，${resumeLoopDescription}` : ` round_${resumeIteration}`}，保留同一子会话上下文和已完成上游产物。`
            : projectDirectoryMode
              ? `Cluster Manager 将从 ${agent.name} 继续，保留已完成上游产物，重置其阻塞下游，并使用新的子会话。`
              : `Cluster Manager 将从 ${agent.name} 继续，保留已完成上游产物，重置其阻塞下游，并复用当前集群输出目录。`,
	        createdAt: now,
	      },
    ].slice(-30);
    addClusterEvent(cluster, {
	      runId,
	      agentId,
	      title: startsNewRound ? '从指定 Agent 开始新一轮' : '从指定 Agent 继续运行',
	      content: startsNewRound
          ? projectDirectoryMode
            ? `已重置 ${[...affectedAgentIds].map((id) => cluster.agents.find((item) => item.agentId === id)?.name ?? id).join('、')} 到 ${resumeLoopDescription ?? `round_${resumeIteration}`}，并为目录模式创建新的子会话。`
            : `已重置 ${[...affectedAgentIds].map((id) => cluster.agents.find((item) => item.agentId === id)?.name ?? id).join('、')} 到 ${resumeLoopDescription ?? `round_${resumeIteration}`}，并复用各自已有子会话。`
          : projectDirectoryMode
            ? `已重置 ${[...affectedAgentIds].map((id) => cluster.agents.find((item) => item.agentId === id)?.name ?? id).join('、')}，上游已完成节点保持不变，并为目录模式创建新的子会话。`
            : `已重置 ${[...affectedAgentIds].map((id) => cluster.agents.find((item) => item.agentId === id)?.name ?? id).join('、')}，上游已完成节点保持不变，并复用当前集群输出目录。`,
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
        if (
          run
          && cluster.activeRunId === runId
          && run.status === 'running'
          && run.harnessStatus === 'running'
        ) {
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

function clearAgentClusterRunWatchdog(clusterId: string, runId: string): void {
  const key = `${clusterId}:${runId}`;
  const existing = runWatchdogs.get(key);
  if (existing) clearTimeout(existing);
  runWatchdogs.delete(key);
}

export async function recoverActiveAgentClusterRuns(
  gatewayManager: GatewayManager,
  eventBus?: HostEventBus,
): Promise<void> {
  const activeRuns = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const now = new Date().toISOString();
    const result: Array<{ clusterId: string; runId: string }> = [];
    let changed = false;
    for (const cluster of clusters) {
      const run = (cluster.runs ?? []).find((item) =>
        item.runId === cluster.activeRunId
        && (item.status === 'running' || item.status === 'blocked')
      );
      if (!run || run.harnessStatus === 'aborted' || run.harnessStatus === 'completed') continue;
      for (const nodeRun of run.nodeRuns ?? []) {
        if (nodeRun.status === 'running' || nodeRun.status === 'ready') {
          nodeRun.status = 'recovering';
          nodeRun.waitingReason = '应用重启后正在核对子会话和产物';
          nodeRun.updatedAt = now;
          changed = true;
        }
      }
      for (const child of run.childRuns) {
        if (child.status === 'running' || child.status === 'starting') {
          child.runtimeWaitReason = '应用重启后正在恢复';
          child.updatedAt = now;
          changed = true;
        }
      }
      updateWorkflowCheckpoint(run, now);
      result.push({ clusterId: cluster.clusterId, runId: run.runId });
    }
    if (changed) await writeClusters(clusters);
    return result;
  });
  for (const active of activeRuns) {
    await refreshAgentClusterRunEvents(active.clusterId, active.runId, gatewayManager, eventBus).catch(() => undefined);
    scheduleAgentClusterRunWatchdog(active.clusterId, active.runId, gatewayManager, eventBus);
  }
}

export async function listAgentClusters(): Promise<AgentCluster[]> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    return clusters.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function updateAgentClusterWorkflowScript(
  clusterId: string,
  input: UpdateAgentClusterWorkflowScriptInput,
): Promise<AgentCluster> {
  const source = input.source?.trim();
  if (!source) throw new Error('workflow script source is required');
  validateWorkflowScriptSource(source);
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const now = new Date().toISOString();
    const previous = normalizeWorkflowScript(cluster.workflowScript, now);
    cluster.workflowScript = normalizeWorkflowScript({
      source,
      sourceType: 'user',
      version: (previous?.version ?? 0) + 1,
      hash: hashWorkflowScriptSource(source),
      argsSchema: input.argsSchema && typeof input.argsSchema === 'object' && !Array.isArray(input.argsSchema)
        ? input.argsSchema
        : previous?.argsSchema,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }, now);
    addClusterEvent(cluster, {
      agentId: null,
      title: '保存 JS Workflow 草稿',
      content: '已保存 investclaw.workflow.js 草稿；确认后启动运行会优先执行该脚本。',
      level: 'info',
      createdAt: now,
    });
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

export async function confirmAgentClusterWorkflowScript(clusterId: string): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const now = new Date().toISOString();
    const script = normalizeWorkflowScript(cluster.workflowScript, now);
    if (!script) throw new Error('当前集群没有 workflow script 草稿');
    validateWorkflowScriptSource(script.source);
    script.confirmedAt = now;
    script.updatedAt = now;
    script.hash = hashWorkflowScriptSource(script.source);
    cluster.workflowScript = script;
    addClusterEvent(cluster, {
      agentId: null,
      title: '确认 JS Workflow',
      content: `已确认 investclaw.workflow.js v${script.version}；下一次启动运行会优先使用真实 Dynamic Workflow。`,
      level: 'success',
      createdAt: now,
    });
    cluster.updatedAt = now;
    clusters[index] = cluster;
    await writeClusters(clusters);
    return cluster;
  });
}

function safeExportName(input: string): string {
  return input
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'investclaw-agent-cluster';
}

function defaultExportWorkflowScript(cluster: AgentCluster): string {
  return [
    'module.exports = async function workflow({ harness, args, context }) {',
    '  await harness.log(`Starting frozen InvestClaw cluster: ${context.clusterName}`);',
    ...cluster.agents.map((agent) => `  await harness.agent(${JSON.stringify(agent.name)}, args);`),
    '  return harness.finish({ summary: "Frozen cluster workflow completed." });',
    '};',
    '',
  ].join('\n');
}

function sanitizedClusterForExport(cluster: AgentCluster): Record<string, unknown> {
  return {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    sourceType: cluster.sourceType,
    projectName: cluster.projectName,
    sharedContext: {
      globalGoal: cluster.sharedContext.globalGoal,
      decompositionPlan: cluster.sharedContext.decompositionPlan,
      constraints: cluster.sharedContext.constraints,
      facts: cluster.sharedContext.facts,
      openQuestions: cluster.sharedContext.openQuestions,
    },
    agents: cluster.agents.map((agent) => ({
      name: agent.name,
      role: agent.role,
      description: agent.description,
      responsibilities: agent.responsibilities,
      systemPrompt: agent.systemPrompt,
      tools: agent.tools,
      capabilities: agent.capabilities,
    })),
    edges: cluster.edges.map((edge) => ({
      fromAgentName: cluster.agents.find((agent) => agent.agentId === edge.fromAgentId)?.name,
      toAgentName: cluster.agents.find((agent) => agent.agentId === edge.toAgentId)?.name,
      relationType: edge.relationType,
      executionType: edge.executionType,
      isBlocking: edge.isBlocking,
      label: edge.label,
      reason: edge.reason,
    })),
    workflow: getCurrentWorkflow(cluster),
    workflowScript: cluster.workflowScript
      ? {
          sourceType: cluster.workflowScript.sourceType,
          version: cluster.workflowScript.version,
          hash: cluster.workflowScript.hash,
          argsSchema: cluster.workflowScript.argsSchema,
          confirmedAt: cluster.workflowScript.confirmedAt,
        }
      : undefined,
    exportedAt: new Date().toISOString(),
  };
}

export async function freezeAgentCluster(
  clusterId: string,
  targetDirectory: string,
): Promise<{ targetDirectory: string }> {
  if (!targetDirectory?.trim() || !isAbsolute(targetDirectory)) {
    throw new Error('固化目录必须是绝对路径');
  }
  const cluster = await getAgentCluster(clusterId);
  if (!cluster) throw new Error('Agent Cluster not found');
  const parentStat = await stat(targetDirectory).catch(() => null);
  if (!parentStat?.isDirectory()) throw new Error('固化目标必须是一个文件夹');
  const exportDir = join(targetDirectory, `${safeExportName(cluster.clusterName)}-${cluster.clusterId.replace(/^cluster-/, '').slice(0, 8)}`);
  const agentsDir = join(exportDir, 'agents');
  await mkdir(agentsDir, { recursive: true });
  const scriptSource = cluster.workflowScript?.source?.trim() || defaultExportWorkflowScript(cluster);
  const argsSchema = cluster.workflowScript?.argsSchema ?? { type: 'object', additionalProperties: true };
  await writeFile(join(exportDir, 'investclaw.cluster.json'), `${JSON.stringify(sanitizedClusterForExport(cluster), null, 2)}\n`, 'utf8');
  await writeFile(join(exportDir, 'investclaw.workflow.js'), scriptSource.endsWith('\n') ? scriptSource : `${scriptSource}\n`, 'utf8');
  await writeFile(join(exportDir, 'args.schema.json'), `${JSON.stringify(argsSchema, null, 2)}\n`, 'utf8');
  await writeFile(join(exportDir, 'workflow.snapshot.json'), `${JSON.stringify(getCurrentWorkflow(cluster), null, 2)}\n`, 'utf8');
  await writeFile(join(exportDir, 'README.md'), [
    `# ${cluster.clusterName}`,
    '',
    '这是由 InvestClaw 固化导出的 Agent Cluster 包。',
    '',
    '## 内容',
    '',
    '- `investclaw.workflow.js`：受控 Dynamic Workflow 脚本。',
    '- `investclaw.cluster.json`：脱敏后的集群定义，不包含运行历史、transcript、API key 或本地 provider 配置。',
    '- `agents/*.md`：每个子 Agent 的 prompt 与职责。',
    '- `args.schema.json`：启动参数 schema。',
    '- `workflow.snapshot.json`：导出时的受控 Workflow IR 快照。',
    '',
    '## 使用',
    '',
    '将该目录作为项目目录导入 InvestClaw。若保留 `investclaw.workflow.js`，创建集群时会优先使用它作为 Dynamic Workflow。',
    '',
  ].join('\n'), 'utf8');
  for (const agent of cluster.agents) {
    await writeFile(join(agentsDir, `${safeExportName(agent.name)}.md`), [
      `# ${agent.name}`,
      '',
      `agent_name: ${agent.name}`,
      `agent_role: ${agent.role}`,
      `agent_description: ${agent.description}`,
      `agent_tools: ${agent.tools.join(', ')}`,
      `agent_capabilities: ${agent.capabilities.join(', ')}`,
      '',
      '## Responsibilities',
      '',
      ...agent.responsibilities.map((item) => `- ${item}`),
      '',
      '## System Prompt',
      '',
      agent.systemPrompt,
      '',
    ].join('\n'), 'utf8');
  }
  return { targetDirectory: exportDir };
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
  const abortController = new AbortController();
  creationAbortControllers.set(requestId, abortController);
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
    if (abortController.signal.aborted) throw new Error('已终止创建 Agent 集群');
    emitStage('read_source', 'completed', `资料读取完成，约 ${sourceContent.length} 字符`);
    return await withStoreQueue(async () => {
      if (abortController.signal.aborted) throw new Error('已终止创建 Agent 集群');
      const clusters = await readClusters();
      const projectRoot = summarizeSourceLocation(input).projectRoot;
      const projectWorkflowScriptSource = await readProjectWorkflowScript(projectRoot);
      const cluster = await buildClusterFromSource(
        input.sourceType,
        sourceContent,
        nextClusterName(clusters),
        input,
        emitStage,
        abortController.signal,
        projectWorkflowScriptSource,
      );
      if (abortController.signal.aborted) throw new Error('已终止创建 Agent 集群');
      emitStage('save_cluster', 'running', '正在保存 Agent 集群');
      await writeClusters([cluster, ...clusters]);
      emitStage('save_cluster', 'completed', 'Agent 集群已保存');
      completeCreationStatus(requestId, cluster.clusterId, onCreationStatus);
      return cluster;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (abortController.signal.aborted || /已终止/.test(message)) {
      abortCreationStatus(requestId, onCreationStatus);
    } else {
      const status = creationStatuses.get(requestId);
      updateCreationStatus(requestId, status?.currentStageId ?? 'read_source', 'error', message, onCreationStatus, message);
    }
    throw error;
  } finally {
    creationAbortControllers.delete(requestId);
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
  const requestId = input.requestId?.trim() || randomUUID();
  const abortController = new AbortController();
  managerAbortControllers.set(requestId, abortController);

  const clusterSnapshot = await withStoreQueue(async () => {
    const clusters = await readClusters();
    const cluster = clusters.find((item) => item.clusterId === clusterId);
    if (!cluster) throw new Error('Agent Cluster not found');
    return cluster;
  });
  let decision: LlmManagerDecision;
  try {
    decision = await requestManagerDecisionFromLlm(clusterSnapshot, content, input, abortController.signal);
  } finally {
    managerAbortControllers.delete(requestId);
  }
  if (abortController.signal.aborted) throw new Error('已终止 Cluster Manager 生成');

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
      workflowNodeDrafts: (decision.workflowNodeDrafts ?? [])
        .filter((draft) => ['fan_out', 'join', 'gate', 'loop', 'human_gate'].includes(draft.type))
        .map((draft) => ({
          ...draft,
          name: compactText(draft.name?.trim() || executionTypeLabelForManager('informs'), 80),
          description: draft.description?.trim(),
          upstreamAgentNames: coerceStringArray(draft.upstreamAgentNames),
          downstreamAgentNames: coerceStringArray(draft.downstreamAgentNames),
          evaluationPrompt: draft.evaluationPrompt?.trim(),
          modelId: draft.modelId?.trim(),
          concurrency: draft.concurrency ? Math.max(1, Math.min(16, Math.floor(draft.concurrency))) : undefined,
          minimumSuccess: draft.minimumSuccess ? Math.max(1, Math.floor(draft.minimumSuccess)) : undefined,
          minimumCount: draft.minimumCount ? Math.max(1, Math.floor(draft.minimumCount)) : undefined,
          repeatCount: draft.repeatCount ? Math.max(1, Math.min(MAX_WORKFLOW_LOOP_COUNT, Math.floor(draft.repeatCount))) : undefined,
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
        (proposal.workflowNodeDrafts?.length ?? 0) > 0 ? `Harness 算子 ${proposal.workflowNodeDrafts?.length} 个` : '',
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

export function abortAgentClusterManagerMessage(_clusterId: string, requestId: string): boolean {
  const controller = managerAbortControllers.get(requestId);
  if (!controller) return false;
  controller.abort();
  managerAbortControllers.delete(requestId);
  return true;
}

export async function syncAgentClusterProjectPrompts(clusterId: string): Promise<AgentCluster> {
  return withStoreQueue(async () => {
    const clusters = await readClusters();
    const index = clusters.findIndex((cluster) => cluster.clusterId === clusterId);
    if (index === -1) throw new Error('Agent Cluster not found');
    const cluster = clusters[index];
    const activeRun = (cluster.runs ?? []).find((run) => run.runId === cluster.activeRunId);
    if (activeRun && ['starting', 'running', 'blocked'].includes(activeRun.status)) {
      throw new Error('当前集群正在运行，请先暂停或停止后再同步项目 prompt');
    }
    const projectRoot = cluster.projectRoot || cluster.sourceFolderPath || (cluster.sourcePath ? dirname(cluster.sourcePath) : null);
    if (!projectRoot) throw new Error('当前集群没有可同步的项目目录');

    const sourceContent = await readFolderSourceContent(projectRoot);
    const definitions = extractSourceAgentDefinitions(sourceContent);
    const runtimeContract = extractRuntimeContractFromSource(sourceContent);
    if (definitions.length === 0) throw new Error('项目目录中没有发现 agents/*.md prompt 定义');

    const now = new Date().toISOString();
    const agentPromptUpdates: AgentClusterManagerAgentPromptUpdate[] = [];
    const agentDrafts: AgentClusterManagerAgentDraft[] = [];
    for (const definition of definitions) {
      const existing = cluster.agents.find((agent) =>
        looseKey(agent.name) === looseKey(definition.name)
        || normalizeAgentNameForMatch(agent.name) === normalizeAgentNameForMatch(definition.name)
      );
      const draft = {
        name: definition.name,
        role: definition.role,
        description: definition.description,
        responsibilities: definition.responsibilities,
        systemPrompt: definition.systemPrompt,
        tools: definition.tools,
        capabilities: definition.capabilities,
        runtimeContract: runtimeContractForAgentDefinition(runtimeContract, definition),
      };
      if (!existing) {
        agentDrafts.push(draft);
        continue;
      }
      const changed = existing.systemPrompt !== definition.systemPrompt
        || existing.role !== definition.role
        || existing.description !== definition.description
        || JSON.stringify(existing.responsibilities) !== JSON.stringify(definition.responsibilities)
        || JSON.stringify(existing.tools) !== JSON.stringify(definition.tools)
        || JSON.stringify(existing.capabilities) !== JSON.stringify(definition.capabilities)
        || JSON.stringify(existing.runtimeContract ?? null) !== JSON.stringify(draft.runtimeContract ?? null);
      if (changed) {
        agentPromptUpdates.push({
          targetAgentId: existing.agentId,
          targetAgentName: existing.name,
          ...draft,
        });
      }
    }

    if (agentPromptUpdates.length === 0 && agentDrafts.length === 0) {
      throw new Error('项目 prompt 与当前集群 Agent 定义一致，无需同步');
    }

    const proposal: AgentClusterManagerProposal = {
      proposalId: randomUUID(),
      kind: 'project_prompt_sync',
      reply: [
        `已重新读取项目 prompt，发现 ${agentPromptUpdates.length} 个现有 Agent 可更新`,
        agentDrafts.length > 0 ? `以及 ${agentDrafts.length} 个新 Agent 草稿` : '',
        '请确认后再应用；应用前不会覆盖当前集群。',
      ].filter(Boolean).join('，'),
      sourceInstruction: `同步项目 prompt：${projectRoot}`,
      promptPatches: [],
      agentPromptUpdates,
      agentDrafts,
      edgeDrafts: [],
      workflowNodeDrafts: [],
      sharedContextSummary: '项目 prompt 同步提案已生成，等待用户确认。',
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
      content: proposal.reply,
      visibility: 'public',
    }, now));
    addClusterEvent(cluster, {
      agentId: null,
      title: '项目 prompt 同步提案',
      content: proposal.reply,
      level: 'info',
      createdAt: now,
      raw: proposal,
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
    const graphChanged = proposal.agentDrafts.length > 0
      || proposal.edgeDrafts.length > 0
      || (proposal.workflowNodeDrafts?.length ?? 0) > 0;

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
      agent.runtimeContract = draft.runtimeContract;
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

    for (const update of proposal.agentPromptUpdates ?? []) {
      const agentId = resolveDraftAgent(update.targetAgentId, update.targetAgentName);
      const agent = agentId ? cluster.agents.find((item) => item.agentId === agentId) : null;
      if (!agent) continue;
      agent.name = update.name?.trim() || agent.name;
      agent.role = update.role?.trim() || agent.role;
      agent.description = update.description?.trim() || agent.description;
      agent.responsibilities = coerceStringArray(update.responsibilities, agent.responsibilities);
      agent.tools = coerceStringArray(update.tools, agent.tools);
      agent.capabilities = coerceStringArray(update.capabilities, agent.capabilities);
      agent.runtimeContract = update.runtimeContract;
      if (update.systemPrompt?.trim()) {
        agent.systemPrompt = update.systemPrompt.trim();
        agent.localContext.systemPrompt = agent.systemPrompt;
      }
      agent.localContext.role = agent.role;
      agent.localContext.responsibilities = agent.responsibilities;
      agent.localContext.assignedTasks = agent.responsibilities.map((item) => `${item}：按最新项目 prompt 执行。`);
      const summaryIndex = cluster.sharedContext.agentSummaries.findIndex((summary) => summary.agentId === agent.agentId);
      const summary = {
        agentId: agent.agentId,
        name: agent.name,
        summary: `${agent.name} 已同步项目 prompt：${agent.responsibilities.join('、')}。`,
        updatedAt: now,
      };
      if (summaryIndex >= 0) cluster.sharedContext.agentSummaries[summaryIndex] = summary;
      else cluster.sharedContext.agentSummaries.push(summary);
    }

    if ((proposal.agentPromptUpdates?.length ?? 0) > 0) {
      cluster.workflows = (cluster.workflows ?? []).map((workflow) => normalizeWorkflow(cluster, {
        ...workflow,
        nodes: workflow.nodes.map((node) => {
          if (!workflowNodeIsAgent(node)) return node;
          const agent = cluster.agents.find((item) => item.agentId === node.agentId);
          return agent ? { ...node, outputContract: defaultAgentOutputContract(agent) } : node;
        }),
        updatedAt: now,
      }));
    }

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
      const nextVersion = Math.max(0, ...(cluster.workflows ?? []).map((workflow) => workflow.version)) + 1;
      const workflow = buildWorkflowFromExecutionGraph(cluster.clusterId, cluster.agents, graph, 'manager', nextVersion, now);
      for (const draft of proposal.workflowNodeDrafts ?? []) {
        const nodeId = `${draft.type}:${randomUUID()}`;
        const base = {
          nodeId,
          type: draft.type,
          name: draft.name,
          description: draft.description,
        };
        const node: WorkflowNode = draft.type === 'fan_out'
          ? { ...base, type: 'fan_out', concurrency: draft.concurrency ?? DEFAULT_WORKFLOW_CONCURRENCY }
          : draft.type === 'join'
            ? { ...base, type: 'join', mode: draft.joinMode === 'minimum' ? 'minimum' : 'all', minimumSuccess: draft.minimumSuccess }
            : draft.type === 'gate'
              ? {
                  ...base,
                  type: 'gate',
                  gateKind: draft.gateKind ?? 'completion',
                  minimumCount: draft.minimumCount,
                  evaluationPrompt: draft.evaluationPrompt?.trim(),
                  modelId: draft.modelId?.trim(),
                }
              : draft.type === 'loop'
                ? {
                    ...base,
                    type: 'loop',
                    bodyNodeIds: coerceStringArray(draft.upstreamAgentNames)
                      .map((name) => resolveAgentReference(cluster, name))
                      .filter((agentId): agentId is string => Boolean(agentId))
                      .map(workflowAgentNodeId),
                    repeatCount: draft.repeatCount ?? 2,
                  }
                : { ...base, type: 'human_gate', prompt: draft.prompt?.trim() || '请确认是否继续执行。' };
        workflow.nodes.push(node);
        const upstreamNodeIds = coerceStringArray(draft.upstreamAgentNames)
          .map((name) => resolveAgentReference(cluster, name))
          .filter((agentId): agentId is string => Boolean(agentId))
          .map(workflowAgentNodeId);
        const downstreamNodeIds = coerceStringArray(draft.downstreamAgentNames)
          .map((name) => resolveAgentReference(cluster, name))
          .filter((agentId): agentId is string => Boolean(agentId))
          .map(workflowAgentNodeId);
        for (const upstreamNodeId of upstreamNodeIds) {
          for (const downstreamNodeId of downstreamNodeIds) {
            workflow.edges = workflow.edges.filter((edge) => !(
              edge.kind === 'control'
              && edge.fromNodeId === upstreamNodeId
              && edge.toNodeId === downstreamNodeId
            ));
          }
          workflow.edges.push({
            edgeId: randomUUID(),
            fromNodeId: upstreamNodeId,
            toNodeId: nodeId,
            kind: 'control',
          });
        }
        for (const downstreamNodeId of downstreamNodeIds) {
          workflow.edges.push({
            edgeId: randomUUID(),
            fromNodeId: nodeId,
            toNodeId: downstreamNodeId,
            kind: 'control',
          });
        }
      }
      const normalizedWorkflow = normalizeWorkflow(cluster, workflow);
      assertWorkflowValid(cluster, normalizedWorkflow);
      cluster.workflows = [normalizedWorkflow, ...(cluster.workflows ?? [])];
      cluster.currentWorkflowId = normalizedWorkflow.workflowId;
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
        : proposal.kind === 'project_prompt_sync'
          ? '项目 prompt 同步提案已应用，后续 Agent 子会话会使用最新项目定义。'
          : 'Manager 提案已应用，新的 prompt patch 会进入后续 Agent 子会话。',
      visibility: 'public',
    }, now));
    addClusterEvent(cluster, {
      agentId: proposal.recommendedResumeFromAgentId ?? null,
      title: 'Manager 提案已应用',
      content: [
        proposal.promptPatches.length > 0 ? `已写入 ${proposal.promptPatches.length} 个 prompt patch` : '',
        (proposal.agentPromptUpdates?.length ?? 0) > 0 ? `已同步 ${proposal.agentPromptUpdates?.length} 个 Agent prompt` : '',
        proposal.agentDrafts.length > 0 ? `已新增 ${proposal.agentDrafts.length} 个 Agent` : '',
        newEdges.length > 0 ? `已新增 ${newEdges.length} 条关系` : '',
        (proposal.workflowNodeDrafts?.length ?? 0) > 0 ? `已新增 ${proposal.workflowNodeDrafts?.length} 个 Harness 算子` : '',
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
