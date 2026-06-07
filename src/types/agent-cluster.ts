export type AgentClusterSourceType = 'new_task' | 'existing_task';
export type AgentClusterStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error';
export type AgentClusterRelationType =
  | 'depends_on'
  | 'reviews'
  | 'delegates_to'
  | 'reports_to'
  | 'collaborates_with';
export type AgentClusterExecutionType =
  | 'blocks'
  | 'informs'
  | 'reviews'
  | 'reports_to'
  | 'writes_to_memory';
export type AgentClusterSenderType = 'user' | 'system' | 'orchestrator' | 'agent';
export type AgentClusterTargetType = 'cluster' | 'agent';
export type AgentClusterMessageType =
  | 'instruction'
  | 'question'
  | 'answer'
  | 'update'
  | 'result'
  | 'critique'
  | 'summary'
  | 'error';
export type AgentClusterMessageVisibility = 'public' | 'targeted' | 'private';
export type AgentClusterRunStatus = 'starting' | 'running' | 'blocked' | 'completed' | 'error' | 'aborted' | 'timeout';
export type AgentClusterRunMode = 'single_chat' | 'subagent_swarm';
export type AgentClusterChildSubmitStatus = 'pending' | 'submitted' | 'failed';
export type AgentClusterCompletionSource = 'structured' | 'fallback' | 'runtime_final' | 'manual';
export type AgentClusterArtifactValidationStatus = 'pending' | 'passed' | 'failed' | 'skipped';
export type AgentClusterCreationStageStatus = 'pending' | 'running' | 'completed' | 'error';
export type AgentClusterCreationStatusValue = 'running' | 'completed' | 'error';
export type AgentClusterManagerProposalStatus = 'pending' | 'applied' | 'dismissed';

export interface AgentClusterEvent {
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

export interface AgentClusterChildRun {
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

export interface AgentClusterRunLoopState {
  loopId: string;
  currentIteration: number;
  repeatCount: number;
  status: 'idle' | 'running' | 'completed';
  updatedAt: string;
}

export interface AgentClusterRun {
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

export interface AgentClusterCreationStage {
  stageId: 'read_source' | 'prepare_context' | 'call_model' | 'parse_plan' | 'build_agents' | 'save_cluster';
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
  currentStageId: AgentClusterCreationStage['stageId'];
  stages: AgentClusterCreationStage[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  clusterId?: string;
  error?: string;
}

export interface ClusterArtifact {
  artifactId: string;
  title: string;
  kind: string;
  content: string;
  createdAt: string;
}

export interface AgentSummary {
  agentId: string;
  name: string;
  summary: string;
  updatedAt: string;
}

export interface AgentOutput {
  outputId: string;
  agentId: string;
  content: string;
  createdAt: string;
}

export interface AgentMessage {
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

export interface AgentLocalContext {
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

export interface ClusterAgent {
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

export interface AgentEdge {
  edgeId: string;
  fromAgentId: string;
  toAgentId: string;
  relationType: AgentClusterRelationType;
  label: string;
  executionType?: AgentClusterExecutionType;
  isBlocking?: boolean;
  reason?: string;
}

export interface AgentClusterExecutionGraphNode {
  agentId: string;
  x?: number;
  y?: number;
}

export interface AgentClusterExecutionLoop {
  loopId: string;
  startAgentId: string;
  endAgentId: string;
  repeatCount: number;
  currentIteration?: number;
  status?: 'idle' | 'running' | 'completed';
}

export interface AgentClusterExecutionGraph {
  nodes: AgentClusterExecutionGraphNode[];
  edges: AgentEdge[];
  loops?: AgentClusterExecutionLoop[];
  confirmed: boolean;
  updatedAt: string;
}

export interface AgentClusterManagerPromptPatchDraft {
  targetAgentId?: string | null;
  targetAgentName?: string | null;
  instruction: string;
}

export interface AgentClusterManagerAgentDraft {
  name: string;
  role: string;
  description: string;
  responsibilities: string[];
  systemPrompt?: string;
  tools: string[];
  capabilities: string[];
}

export interface AgentClusterManagerEdgeDraft {
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

export interface AgentClusterManagerProposal {
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

export interface ClusterContext {
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
  artifacts: ClusterArtifact[];
  agentSummaries: AgentSummary[];
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

export interface CreateAgentClusterRequest {
  sourceType: AgentClusterSourceType;
  taskGoal?: string;
  markdown?: string;
  filePath?: string;
  folderPath?: string;
  baseModel?: {
    id: string;
    label: string;
    provider: 'custom-openai-compatible' | 'provider-account';
    baseUrl: string;
    model: string;
    accountId?: string;
  };
  baseProviderAccountId?: string;
  requestId?: string;
}

export interface SendAgentClusterMessageRequest {
  content: string;
  targetAgentId?: string | null;
}

export interface SendAgentClusterManagerMessageRequest {
  content: string;
  baseModel?: CreateAgentClusterRequest['baseModel'];
}
