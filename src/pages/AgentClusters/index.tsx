import { type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  Network,
  Send,
  Sparkles,
  Target,
  Users,
  Play,
  Pencil,
  Check,
  X,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BaseModelButton } from '@/components/common/BaseModelButton';
import { cn } from '@/lib/utils';
import { useAgentClusterStore, getSelectedAgentNameFromInput } from '@/stores/agent-clusters';
import { useBaseModelStore } from '@/stores/base-model';
import type {
  AgentCluster,
  AgentClusterExecutionGraph,
  AgentClusterExecutionLoop,
  AgentClusterExecutionType,
  AgentClusterManagerProposal,
  AgentClusterChildRun,
  AgentEdge,
  AgentMessage,
  ClusterAgent,
} from '@/types/agent-cluster';

type CreateMode = 'new_task' | 'existing_task';

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusText(status: ClusterAgent['status']): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'waiting':
      return '等待';
    case 'done':
      return '完成';
    case 'error':
      return '错误';
    default:
      return '空闲';
  }
}

function AgentStatusBadge({ status }: { status: ClusterAgent['status'] }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'h-5 rounded-full px-2 text-[10px]',
        status === 'waiting' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        status === 'done' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        status === 'error' && 'bg-destructive/10 text-destructive',
      )}
    >
      {statusText(status)}
    </Badge>
  );
}

const executionTypeOptions: Array<{ value: AgentClusterExecutionType; label: string; blocking: boolean }> = [
  { value: 'blocks', label: '阻塞顺序', blocking: true },
  { value: 'reviews', label: '审查门禁', blocking: true },
  { value: 'informs', label: '提供信息', blocking: false },
  { value: 'reports_to', label: '汇报', blocking: false },
  { value: 'writes_to_memory', label: '写入记忆', blocking: false },
];

function executionTypeLabel(value?: AgentClusterExecutionType): string {
  return executionTypeOptions.find((option) => option.value === value)?.label ?? '协作';
}

function childRunStatusText(status: AgentClusterChildRun['status']): string {
  switch (status) {
    case 'starting':
      return '启动中';
    case 'running':
      return '运行中';
    case 'blocked':
      return '等待';
    case 'completed':
      return '完成';
    case 'error':
      return '异常';
    case 'aborted':
      return '已停止';
    case 'timeout':
      return '超时';
    default:
      return status;
  }
}

function artifactValidationText(status?: AgentClusterChildRun['artifactValidationStatus']): string | null {
  switch (status) {
    case 'pending':
      return '产物待校验';
    case 'passed':
      return '产物已通过';
    case 'failed':
      return '产物未通过';
    case 'skipped':
      return '产物未要求';
    default:
      return null;
  }
}

function edgeIsBlocking(edge: AgentEdge): boolean {
  return edge.isBlocking === true || edge.executionType === 'blocks' || edge.executionType === 'reviews';
}

function getClusterExecutionGraph(cluster: AgentCluster): AgentClusterExecutionGraph {
  return cluster.executionGraph ?? {
    nodes: cluster.agents.map((agent, index) => ({ agentId: agent.agentId, x: index * 240, y: 0 })),
    edges: cluster.edges,
    loops: [],
    confirmed: false,
    updatedAt: cluster.updatedAt,
  };
}

function AgentClusterCreateModeCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'soft-panel zone-hoverable min-h-28 rounded-xl p-4 text-left transition-[border-color,box-shadow,background-color]',
        active ? 'zone-active' : '',
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="zone-chip flex h-8 w-8 items-center justify-center rounded-lg">
          {icon}
        </div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
    </button>
  );
}

function AgentClusterCreatePage() {
  const navigate = useNavigate();
  const createCluster = useAgentClusterStore((state) => state.createCluster);
  const creating = useAgentClusterStore((state) => state.creating);
  const creationStatus = useAgentClusterStore((state) => state.creationStatus);
  const error = useAgentClusterStore((state) => state.error);
  const clearError = useAgentClusterStore((state) => state.clearError);
  const selectedBaseModel = useBaseModelStore((state) => state.selectedModel);
  const [mode, setMode] = useState<CreateMode>('new_task');
  const [taskGoal, setTaskGoal] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [filePath, setFilePath] = useState('');
  const [folderPath, setFolderPath] = useState('');

  const canSubmit = mode === 'new_task'
    ? taskGoal.trim().length > 0
    : markdown.trim().length > 0 || filePath.trim().length > 0 || folderPath.trim().length > 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cluster = await createCluster(
      mode === 'new_task'
        ? { sourceType: 'new_task', taskGoal, baseModel: selectedBaseModel }
        : { sourceType: 'existing_task', markdown, filePath, folderPath, baseModel: selectedBaseModel },
    );
    if (cluster) {
      navigate(`/agent-clusters/${cluster.clusterId}`);
    }
  };

  return (
    <div data-testid="agent-clusters-page" className="zone-cluster -m-6 min-h-[calc(100vh-2.5rem)] bg-transparent">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <GitBranch className="h-4 w-4" />
              Agent 集群
            </div>
            <h1 data-testid="agent-clusters-title" className="text-5xl font-semibold tracking-[-0.04em] text-foreground">
              创建协作型 Agent 集群
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
              从一个新目标或现有 Markdown/file 任务开始，生成带共享上下文、独立本地上下文和显式协作关系的多 Agent 工作组。
            </p>
          </div>
          <BaseModelButton />
        </div>

        <form onSubmit={handleSubmit} className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-2">
            <AgentClusterCreateModeCard
              active={mode === 'new_task'}
              icon={<Sparkles className="h-4 w-4" />}
              title="新任务"
              description="输入一个目标，由系统拆解任务并创建一组子 Agent。"
              onClick={() => {
                clearError();
                setMode('new_task');
              }}
            />
            <AgentClusterCreateModeCard
              active={mode === 'existing_task'}
              icon={<FileText className="h-4 w-4" />}
              title="基于现有任务创建"
              description="粘贴 Markdown，或提供本地文件路径，由 Main 进程读取并生成集群。"
              onClick={() => {
                clearError();
                setMode('existing_task');
              }}
            />
          </div>

          <div className="soft-panel rounded-xl p-4">
            {mode === 'new_task' ? (
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="agent-cluster-task-goal">任务目标</label>
                <Textarea
                  id="agent-cluster-task-goal"
                  data-testid="agent-cluster-task-goal"
                  value={taskGoal}
                  onChange={(event) => setTaskGoal(event.target.value)}
                  placeholder="例如：为美股 AI 半导体主题构建一个多 Agent 因子研究流程。"
                  className="min-h-40 resize-none"
                />
              </div>
            ) : (
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="agent-cluster-markdown">Markdown 内容</label>
                  <Textarea
                    id="agent-cluster-markdown"
                    data-testid="agent-cluster-markdown"
                    value={markdown}
                    onChange={(event) => setMarkdown(event.target.value)}
                    placeholder="粘贴任务说明、约束、已有研究笔记或交付要求。"
                    className="min-h-40 resize-none"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="agent-cluster-file-path">或本地文件路径</label>
                  <Input
                    id="agent-cluster-file-path"
                    data-testid="agent-cluster-file-path"
                    autoComplete="off"
                    spellCheck={false}
                    value={filePath}
                    onChange={(event) => setFilePath(event.target.value)}
                    placeholder="输入文件路径"
                    className=""
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="agent-cluster-folder-path">或项目目录路径</label>
                  <Input
                    id="agent-cluster-folder-path"
                    data-testid="agent-cluster-folder-path"
                    autoComplete="off"
                    spellCheck={false}
                    value={folderPath}
                    onChange={(event) => setFolderPath(event.target.value)}
                    placeholder="输入项目目录路径"
                    className=""
                  />
                  <p className="text-xs text-muted-foreground">
                    目录模式只读取说明文件和 Agent/Skill 元信息。
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {creating && creationStatus && (
            <div data-testid="agent-cluster-creation-progress" className="soft-panel rounded-xl p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">正在创建 Agent 集群</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {creationStatus.stages.find((stage) => stage.stageId === creationStatus.currentStageId)?.detail ?? '准备中'}
                  </div>
                </div>
                <Badge variant="secondary" className="rounded-full">
                  {creationStatus.status === 'running' ? '运行中' : creationStatus.status}
                </Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {creationStatus.stages.map((stage) => (
                  <div
                    key={stage.stageId}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-xs',
                      stage.status === 'running' && 'zone-active',
                      stage.status === 'completed' && 'border-emerald-500/20 bg-emerald-500/5',
                      stage.status === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      {stage.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {stage.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                      {stage.status === 'error' && <AlertCircle className="h-3.5 w-3.5" />}
                      <span>{stage.label}</span>
                    </div>
                    {stage.detail && <div className="mt-1 line-clamp-2 text-muted-foreground">{stage.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button data-testid="agent-cluster-create-button" type="submit" disabled={!canSubmit || creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              创建集群
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AgentGraphNode({
  agent,
  selected,
  onClick,
}: {
  agent: ClusterAgent;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`agent-graph-node-${agent.agentId}`}
      onClick={onClick}
      className={cn(
        'soft-panel zone-hoverable h-full min-h-36 w-full min-w-0 rounded-xl p-4 text-left [overflow-wrap:anywhere] transition-[border-color,box-shadow,background-color]',
        selected ? 'zone-active' : '',
      )}
    >
      <div
        data-testid={`agent-graph-node-header-${agent.agentId}`}
        className="relative mb-3 grid min-h-[68px] grid-cols-[36px_minmax(0,1fr)] items-start gap-2 pr-[76px]"
      >
          <div className="zone-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div
              title={agent.name}
              className="line-clamp-2 min-h-10 break-words text-sm font-semibold leading-5 [overflow-wrap:anywhere]"
            >
              {agent.name}
            </div>
            <div
              title={agent.role}
              className="mt-0.5 truncate text-xs leading-4 text-muted-foreground"
            >
              {agent.role}
            </div>
          </div>
        <div className="absolute right-0 top-0 max-w-[72px]">
          <AgentStatusBadge status={agent.status} />
        </div>
      </div>
      <p
        data-testid={`agent-graph-node-description-${agent.agentId}`}
        className="line-clamp-3 min-h-[72px] break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]"
      >
        {agent.description}
      </p>
      {agent.currentTask && (
        <div className="soft-row mt-3 break-words rounded-lg px-2.5 py-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {agent.runtimeStatusReason ? `${agent.runtimeStatusReason}：` : ''}{agent.currentTask}
        </div>
      )}
      <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
        {agent.capabilities.slice(0, 3).map((capability) => (
          <span
            key={capability}
            className="zone-chip max-w-full whitespace-normal break-words rounded-md px-2 py-1 text-[10px] leading-4 [overflow-wrap:anywhere]"
          >
            {capability}
          </span>
        ))}
      </div>
    </button>
  );
}

function AgentGraph({
  cluster,
  selectedAgentId,
  onSelectAgent,
  editing,
  draftGraph,
  onDraftGraphChange,
}: {
  cluster: AgentCluster;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
  editing: boolean;
  draftGraph: AgentClusterExecutionGraph;
  onDraftGraphChange: (graph: AgentClusterExecutionGraph) => void;
}) {
  const [edgeDraft, setEdgeDraft] = useState<{
    fromAgentId: string;
    toAgentId: string;
    executionType: AgentClusterExecutionType;
    label: string;
    reason: string;
  }>({
    fromAgentId: cluster.agents[0]?.agentId ?? '',
    toAgentId: cluster.agents[1]?.agentId ?? '',
    executionType: 'blocks',
    label: '阻塞依赖',
    reason: '',
  });
  const [loopDraft, setLoopDraft] = useState<{
    startAgentId: string;
    endAgentId: string;
    repeatCount: number;
  }>({
    startAgentId: cluster.agents[1]?.agentId ?? cluster.agents[0]?.agentId ?? '',
    endAgentId: cluster.agents[cluster.agents.length - 1]?.agentId ?? cluster.agents[0]?.agentId ?? '',
    repeatCount: 2,
  });
  const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null);
  const agentNameById = useMemo(
    () => Object.fromEntries(cluster.agents.map((agent) => [agent.agentId, agent.name])),
    [cluster.agents],
  );
  const orderedAgents = useMemo(() => {
    const order = new Map(draftGraph.nodes.map((node, index) => [node.agentId, index]));
    return [...cluster.agents].sort((a, b) => (order.get(a.agentId) ?? 999) - (order.get(b.agentId) ?? 999));
  }, [cluster.agents, draftGraph.nodes]);

  const updateEdge = (edgeId: string, patch: Partial<AgentEdge>) => {
    onDraftGraphChange({
      ...draftGraph,
      confirmed: false,
      edges: draftGraph.edges.map((edge) => {
        if (edge.edgeId !== edgeId) return edge;
        const next = { ...edge, ...patch };
        const option = executionTypeOptions.find((item) => item.value === next.executionType);
        return {
          ...next,
          isBlocking: option?.blocking ?? edgeIsBlocking(next),
          label: next.label || option?.label || '协作',
        };
      }),
    });
  };

  const removeEdge = (edgeId: string) => {
    onDraftGraphChange({
      ...draftGraph,
      confirmed: false,
      edges: draftGraph.edges.filter((edge) => edge.edgeId !== edgeId),
    });
  };

  const addEdge = () => {
    if (!edgeDraft.fromAgentId || !edgeDraft.toAgentId || edgeDraft.fromAgentId === edgeDraft.toAgentId) return;
    const option = executionTypeOptions.find((item) => item.value === edgeDraft.executionType);
    const edge: AgentEdge = {
      edgeId: crypto.randomUUID(),
      fromAgentId: edgeDraft.fromAgentId,
      toAgentId: edgeDraft.toAgentId,
      relationType: edgeDraft.executionType === 'blocks' ? 'depends_on' : edgeDraft.executionType === 'reviews' ? 'reviews' : 'collaborates_with',
      executionType: edgeDraft.executionType,
      isBlocking: option?.blocking ?? false,
      label: edgeDraft.label.trim() || option?.label || '协作',
      reason: edgeDraft.reason.trim() || undefined,
    };
    onDraftGraphChange({
      ...draftGraph,
      confirmed: false,
      edges: [...draftGraph.edges, edge],
    });
  };

  const addLoop = () => {
    if (!loopDraft.startAgentId || !loopDraft.endAgentId || loopDraft.startAgentId === loopDraft.endAgentId) return;
    const loop: AgentClusterExecutionLoop = {
      loopId: crypto.randomUUID(),
      startAgentId: loopDraft.startAgentId,
      endAgentId: loopDraft.endAgentId,
      repeatCount: Math.max(1, Math.min(20, Math.floor(loopDraft.repeatCount || 1))),
      status: 'idle',
    };
    onDraftGraphChange({
      ...draftGraph,
      confirmed: false,
      loops: [...(draftGraph.loops ?? []), loop],
    });
  };

  const removeLoop = (loopId: string) => {
    onDraftGraphChange({
      ...draftGraph,
      confirmed: false,
      loops: (draftGraph.loops ?? []).filter((loop) => loop.loopId !== loopId),
    });
  };

  const updateLoop = (loopId: string, patch: Partial<AgentClusterExecutionLoop>) => {
    onDraftGraphChange({
      ...draftGraph,
      confirmed: false,
      loops: (draftGraph.loops ?? []).map((loop) => (
        loop.loopId === loopId
          ? { ...loop, ...patch, repeatCount: Math.max(1, Math.min(20, Math.floor(Number(patch.repeatCount ?? loop.repeatCount) || 1))) }
          : loop
      )),
    });
  };

  const moveNodeBefore = (targetAgentId: string) => {
    if (!editing || !draggingAgentId || draggingAgentId === targetAgentId) return;
    const nextOrder = orderedAgents.map((agent) => agent.agentId).filter((agentId) => agentId !== draggingAgentId);
    const targetIndex = nextOrder.indexOf(targetAgentId);
    nextOrder.splice(Math.max(0, targetIndex), 0, draggingAgentId);
    onDraftGraphChange({
      ...draftGraph,
      confirmed: false,
      nodes: nextOrder.map((agentId, index) => ({ agentId, x: index * 260, y: 0 })),
    });
    setDraggingAgentId(null);
  };

  return (
    <div data-testid="agent-cluster-graph" className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Agent 编排图</h2>
          <Badge variant={draftGraph.confirmed ? 'secondary' : 'outline'} className="rounded-full">
            {draftGraph.confirmed ? '已确认' : '待确认'}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onSelectAgent(null)}>
          <Users className="mr-2 h-4 w-4" />
          集群会话
        </Button>
      </div>

      <button
        type="button"
        onClick={() => onSelectAgent(null)}
        className={cn(
          'soft-panel zone-hoverable rounded-xl p-4 text-left transition-[border-color,box-shadow,background-color]',
          selectedAgentId === null && 'zone-active',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="zone-chip flex h-9 w-9 items-center justify-center rounded-lg">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Cluster Manager</div>
              <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                系统调度器 + 指令分发入口，不参与阻塞 DAG
              </div>
            </div>
          </div>
          <Badge variant="secondary" className="rounded-full">控制层</Badge>
        </div>
        <p className="mt-3 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          默认接收你的自然语言改动，生成 prompt patch；系统 Run Manager 负责解析完成信号、解除 blocks/reviews 阻塞并启动下游。
        </p>
      </button>

      <div
        data-testid="agent-cluster-node-grid"
        className="grid min-w-0 gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}
      >
        {orderedAgents.map((agent) => (
          <div
            key={agent.agentId}
            draggable={editing}
            onDragStart={() => setDraggingAgentId(agent.agentId)}
            onDragOver={(event) => editing && event.preventDefault()}
            onDrop={() => moveNodeBefore(agent.agentId)}
            className={cn(
              'min-w-0',
              editing && 'cursor-grab rounded-lg ring-1 ring-dashed ring-muted-foreground/20',
            )}
          >
            <AgentGraphNode
              agent={agent}
              selected={selectedAgentId === agent.agentId}
              onClick={() => onSelectAgent(agent.agentId)}
            />
          </div>
        ))}
      </div>

      <div className="soft-panel rounded-xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            调度关系
          </div>
          <div className="text-xs text-muted-foreground">blocks/reviews 会影响执行顺序，其余只用于上下文与展示。</div>
        </div>
        {editing && (
            <div className="soft-row mb-4 grid gap-2 rounded-xl p-3 md:grid-cols-[1fr_1fr_150px_1fr_auto]">
            <select
              value={edgeDraft.fromAgentId}
              onChange={(event) => setEdgeDraft((draft) => ({ ...draft, fromAgentId: event.target.value }))}
              className="h-9 rounded-lg border border-input/80 bg-card/70 px-2 text-sm"
            >
              {cluster.agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}
            </select>
            <select
              value={edgeDraft.toAgentId}
              onChange={(event) => setEdgeDraft((draft) => ({ ...draft, toAgentId: event.target.value }))}
              className="h-9 rounded-lg border border-input/80 bg-card/70 px-2 text-sm"
            >
              {cluster.agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}
            </select>
            <select
              value={edgeDraft.executionType}
              onChange={(event) => {
                const executionType = event.target.value as AgentClusterExecutionType;
                const option = executionTypeOptions.find((item) => item.value === executionType);
                setEdgeDraft((draft) => ({ ...draft, executionType, label: option?.label ?? draft.label }));
              }}
              className="h-9 rounded-lg border border-input/80 bg-card/70 px-2 text-sm"
            >
              {executionTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <Input
              value={edgeDraft.reason}
              onChange={(event) => setEdgeDraft((draft) => ({ ...draft, reason: event.target.value }))}
              placeholder="原因，可选"
              className="h-9"
            />
            <Button type="button" size="sm" onClick={addEdge}>
              <Plus className="mr-1.5 h-4 w-4" />
              加边
            </Button>
          </div>
        )}
        <div className="grid gap-2">
          {draftGraph.edges.map((edge) => (
            <div
              key={edge.edgeId}
              className="soft-row grid min-w-0 gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground md:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">From</div>
                <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]" title={agentNameById[edge.fromAgentId] ?? edge.fromAgentId}>
                  {agentNameById[edge.fromAgentId] ?? edge.fromAgentId}
                </div>
              </div>
              <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground md:block" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">To</div>
                <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]" title={agentNameById[edge.toAgentId] ?? edge.toAgentId}>
                  {agentNameById[edge.toAgentId] ?? edge.toAgentId}
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                <Badge variant={edgeIsBlocking(edge) ? 'default' : 'secondary'} className="shrink-0 rounded-full text-[10px]">
                  {executionTypeLabel(edge.executionType)}
                </Badge>
                {editing && (
                  <>
                    <select
                      value={edge.executionType ?? 'informs'}
                      onChange={(event) => {
                        const executionType = event.target.value as AgentClusterExecutionType;
                        const option = executionTypeOptions.find((item) => item.value === executionType);
                        updateEdge(edge.edgeId, {
                          executionType,
                          isBlocking: option?.blocking ?? false,
                          label: option?.label ?? edge.label,
                        });
                      }}
                      className="h-8 max-w-full rounded-lg border border-input/80 bg-card/70 px-2 text-xs"
                    >
                      {executionTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeEdge(edge.edgeId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              {edge.reason && (
                <div className="min-w-0 text-xs leading-5 md:col-span-4">
                  <span className="text-muted-foreground/70">原因：</span>
                  <span className="break-words [overflow-wrap:anywhere]">{edge.reason}</span>
                </div>
              )}
            </div>
          ))}
          {draftGraph.edges.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              还没有边。可以先添加 blocks 顺序边，再确认流水线。
            </div>
          )}
        </div>
        <div className="mt-5 border-t pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">循环组件</div>
            <div className="text-xs text-muted-foreground">不制造阻塞环；按选定子链重复 n 轮。</div>
          </div>
          {editing && (
            <div className="soft-row mb-4 grid gap-2 rounded-xl p-3 md:grid-cols-[1fr_1fr_120px_auto]">
              <select
                value={loopDraft.startAgentId}
                onChange={(event) => setLoopDraft((draft) => ({ ...draft, startAgentId: event.target.value }))}
                className="h-9 rounded-lg border border-input/80 bg-card/70 px-2 text-sm"
              >
                {cluster.agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>起点：{agent.name}</option>)}
              </select>
              <select
                value={loopDraft.endAgentId}
                onChange={(event) => setLoopDraft((draft) => ({ ...draft, endAgentId: event.target.value }))}
                className="h-9 rounded-lg border border-input/80 bg-card/70 px-2 text-sm"
              >
                {cluster.agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>终点：{agent.name}</option>)}
              </select>
              <Input
                type="number"
                min={1}
                max={20}
                value={loopDraft.repeatCount}
                onChange={(event) => setLoopDraft((draft) => ({ ...draft, repeatCount: Number(event.target.value) }))}
                className="h-9"
              />
              <Button type="button" size="sm" onClick={addLoop}>
                <Plus className="mr-1.5 h-4 w-4" />
                加循环
              </Button>
            </div>
          )}
          <div className="grid gap-2">
            {(draftGraph.loops ?? []).map((loop) => (
              <div
                key={loop.loopId}
                className="soft-row grid min-w-0 gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground md:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Loop start</div>
                  <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]" title={agentNameById[loop.startAgentId] ?? loop.startAgentId}>
                    {agentNameById[loop.startAgentId] ?? loop.startAgentId}
                  </div>
                </div>
                <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground md:block" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Loop end</div>
                  <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]" title={agentNameById[loop.endAgentId] ?? loop.endAgentId}>
                    {agentNameById[loop.endAgentId] ?? loop.endAgentId}
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                  <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                    × {loop.repeatCount}
                  </Badge>
                  {editing && (
                    <>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={loop.repeatCount}
                        onChange={(event) => updateLoop(loop.loopId, { repeatCount: Number(event.target.value) })}
                        className="h-8 w-20 text-xs"
                      />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeLoop(loop.loopId)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {(draftGraph.loops ?? []).length === 0 && (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                暂无循环。需要 ABCD BCD BCD 这类运行时，可以添加 B→D 循环并设置轮数。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function messageTone(message: AgentMessage): string {
  if (message.senderType === 'user') return 'zone-chat tinted-panel';
  if (message.senderType === 'orchestrator') return 'tinted-panel';
  return 'soft-row';
}

function ManagerProposalCard({
  proposal,
  cluster,
}: {
  proposal: AgentClusterManagerProposal;
  cluster: AgentCluster;
}) {
  const applyManagerProposal = useAgentClusterStore((state) => state.applyManagerProposal);
  const dismissManagerProposal = useAgentClusterStore((state) => state.dismissManagerProposal);
  const targetNames = proposal.promptPatches
    .map((patch) => {
      if (!patch.targetAgentId && !patch.targetAgentName) return '全局';
      return cluster.agents.find((agent) => agent.agentId === patch.targetAgentId)?.name
        ?? patch.targetAgentName
        ?? patch.targetAgentId
        ?? '未知 Agent';
    });

  return (
    <div data-testid="agent-cluster-manager-proposal" className="tinted-panel rounded-xl p-3 text-sm">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="font-medium zone-icon">Manager 提案待确认</div>
          <div className="mt-1 text-xs text-muted-foreground">{formatTime(proposal.createdAt)}</div>
        </div>
        <Badge variant="secondary" className="rounded-full">未应用</Badge>
      </div>
      <p className="line-clamp-3 leading-6 text-muted-foreground">{proposal.reply}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {proposal.promptPatches.length > 0 && <Badge variant="secondary">Prompt {proposal.promptPatches.length}</Badge>}
        {proposal.agentDrafts.length > 0 && <Badge variant="secondary">新增 Agent {proposal.agentDrafts.length}</Badge>}
        {proposal.edgeDrafts.length > 0 && <Badge variant="secondary">关系 {proposal.edgeDrafts.length}</Badge>}
        {targetNames.length > 0 && <Badge variant="outline">{targetNames.slice(0, 3).join('、')}</Badge>}
      </div>
      <details className="soft-row mt-3 rounded-lg px-3 py-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">查看详情</summary>
        <div className="mt-2 space-y-2 leading-5">
          {proposal.sharedContextSummary && <div>摘要：{proposal.sharedContextSummary}</div>}
          {proposal.promptPatches.map((patch, index) => (
            <div key={`${proposal.proposalId}-patch-${index}`}>
              <span className="font-medium">Prompt：</span>{patch.instruction}
            </div>
          ))}
          {proposal.agentDrafts.map((draft) => (
            <div key={draft.name}>
              <span className="font-medium">新增 Agent：</span>{draft.name} · {draft.role}
            </div>
          ))}
          {proposal.edgeDrafts.map((edge, index) => (
            <div key={`${proposal.proposalId}-edge-${index}`}>
              <span className="font-medium">关系：</span>{edge.fromAgentName ?? edge.fromAgentId ?? '?'} → {edge.toAgentName ?? edge.toAgentId ?? '?'}
            </div>
          ))}
          {proposal.recommendedResumeFromAgentId && (
            <div>建议继续：{cluster.agents.find((agent) => agent.agentId === proposal.recommendedResumeFromAgentId)?.name ?? proposal.recommendedResumeFromAgentId}</div>
          )}
        </div>
      </details>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void dismissManagerProposal(cluster.clusterId, proposal.proposalId)}>
          放弃
        </Button>
        <Button size="sm" onClick={() => void applyManagerProposal(cluster.clusterId, proposal.proposalId)}>
          应用提案
        </Button>
      </div>
    </div>
  );
}

function AgentConversationPanel({
  cluster,
  selectedAgent,
}: {
  cluster: AgentCluster;
  selectedAgent: ClusterAgent | null;
}) {
  const sendMessage = useAgentClusterStore((state) => state.sendMessage);
  const sendManagerMessage = useAgentClusterStore((state) => state.sendManagerMessage);
  const sending = useAgentClusterStore((state) => state.sending);
  const error = useAgentClusterStore((state) => state.error);
  const selectedBaseModel = useBaseModelStore((state) => state.selectedModel);
  const [input, setInput] = useState('');

  const visibleMessages = selectedAgent
    ? cluster.messages.filter((message) =>
        message.targetAgentId === selectedAgent.agentId
        || message.senderAgentId === selectedAgent.agentId
      )
    : cluster.messages.filter((message) => message.targetType === 'cluster' && message.visibility === 'public');
  const agentOutputs = selectedAgent?.localContext.outputs ?? [];
  const visibleEvents = (cluster.events ?? []).filter((event) =>
    selectedAgent ? event.agentId === selectedAgent.agentId : !event.agentId
  ).slice(0, 80);
  const pendingProposals = selectedAgent
    ? []
    : (cluster.sharedContext.managerProposals ?? []).filter((proposal) => proposal.status === 'pending');
  const activeRun = cluster.runs?.find((run) => run.runId === cluster.activeRunId) ?? null;
  const selectedChildRun = selectedAgent && activeRun
    ? activeRun.childRuns.find((child) => child.agentId === selectedAgent.agentId) ?? null
    : null;
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    const mentionedAgentId = selectedAgent ? null : getSelectedAgentNameFromInput(content, cluster);
    if (!selectedAgent && !mentionedAgentId) {
      await sendManagerMessage(cluster.clusterId, { content, baseModel: selectedBaseModel });
    } else {
      await sendMessage(cluster.clusterId, {
        content,
        targetAgentId: selectedAgent?.agentId ?? mentionedAgentId,
      });
    }
    setInput('');
  };

  return (
    <aside data-testid="agent-cluster-conversation" className="zone-cluster glass-shell flex h-full min-h-0 flex-col rounded-xl">
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <span className="zone-dot h-2.5 w-2.5 rounded-full" />
          {selectedAgent ? <Bot className="h-4 w-4 zone-icon" /> : <MessageSquare className="h-4 w-4 zone-icon" />}
          <h2 className="text-sm font-semibold">{selectedAgent ? selectedAgent.name : 'Cluster Manager'}</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedAgent ? '定向消息进入该 Agent 的本地上下文。' : '默认由 Cluster Manager 解析你的自然语言改动，并写入 prompt patch / 调度决策。'}
        </p>
        {activeRun && (
          <div className="tinted-panel mt-3 rounded-lg px-3 py-2 text-xs">
            {selectedChildRun
              ? `${selectedAgent?.name}：${selectedChildRun.status}，${selectedChildRun.submitStatus ?? 'pending'}，正在等待 Gateway 事件或读取子会话历史。`
              : `集群运行中：正在等待 Gateway 事件并定期读取 ${activeRun.childRuns.length} 个子会话历史。`}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {pendingProposals.map((proposal) => (
          <ManagerProposalCard key={proposal.proposalId} proposal={proposal} cluster={cluster} />
        ))}
        {visibleMessages.length === 0 && agentOutputs.length === 0 && visibleEvents.length === 0 && pendingProposals.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无消息
          </div>
        ) : (
          <>
            {visibleMessages.map((message) => (
              <div key={message.messageId} className={cn('rounded-lg border px-3 py-2 text-sm leading-6', messageTone(message))}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] opacity-70">
                  <span>{message.senderType === 'user' ? '用户' : message.senderType}</span>
                  <span>{formatTime(message.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap break-words">{message.content}</div>
              </div>
            ))}
            {agentOutputs.map((output) => (
              <div key={output.outputId} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm leading-6">
                <div className="mb-1 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Agent 输出
                </div>
                <div className="whitespace-pre-wrap break-words">{output.content}</div>
              </div>
            ))}
            {visibleEvents.map((event) => (
              <div key={event.eventId} className={cn(
                'rounded-lg px-3 py-2 text-sm leading-6',
                event.level === 'success' && 'bg-emerald-500/5',
                event.level === 'error' && 'bg-destructive/10 text-destructive',
                event.level !== 'success' && event.level !== 'error' && 'soft-row',
              )}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] opacity-70">
                  <span>{event.title}</span>
                  <span>{formatTime(event.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap break-words">{event.content}</div>
              </div>
            ))}
          </>
        )}
      </div>

      {error && (
        <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="border-t border-border/70 bg-card/50 px-4 py-2 text-xs text-muted-foreground">
        提示：Manager 会先生成提案；应用后才会修改 Agent prompt、Agent 列表或编排图。
      </div>

      <form onSubmit={handleSubmit} className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            data-testid="agent-cluster-message-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void handleSubmit(event as unknown as FormEvent);
              }
            }}
            placeholder={selectedAgent ? `发送给 ${selectedAgent.name}` : '告诉 Cluster Manager 要改什么；也可 @Agent 定向发送'}
            className="min-h-14 max-h-52 resize-y"
          />
          <Button data-testid="agent-cluster-send-button" type="submit" size="icon" disabled={sending || !input.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </aside>
  );
}

function SharedContextPanel({ cluster }: { cluster: AgentCluster }) {
  const context = cluster.sharedContext;
  const sections = [
    { title: '约束', items: context.constraints },
    { title: '事实', items: context.facts },
    { title: '决策', items: context.decisions },
    { title: 'Manager 指令', items: context.managerInstructions ?? [] },
    { title: 'Prompt Patch', items: (context.promptPatches ?? []).map((patch) => patch.instruction) },
    { title: '最新产物', items: (context.latestArtifacts ?? []).map((artifact) => artifact.artifact) },
    { title: '开放问题', items: context.openQuestions },
  ];

  return (
    <div data-testid="agent-cluster-shared-context" className="soft-panel grid gap-4 rounded-xl p-4">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">ClusterContext</h2>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{context.globalGoal}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="soft-row rounded-xl p-3">
            <div className="mb-2 text-xs font-semibold text-foreground/80">{section.title}</div>
            {section.items.length > 0 ? (
              <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
                {section.items.slice(0, 4).map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <CircleDot className="mt-1 h-2.5 w-2.5 shrink-0" />
                    <span className="break-words">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground">暂无</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentClusterAgentRail({
  cluster,
  selectedAgentId,
  onSelectAgent,
}: {
  cluster: AgentCluster;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
}) {
  return (
    <aside data-testid="agent-cluster-agent-rail" className="zone-cluster glass-shell flex h-full min-h-0 flex-col rounded-xl p-3">
      <button
        type="button"
        onClick={() => onSelectAgent(null)}
        className={cn(
          'zone-hoverable mb-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
          selectedAgentId === null ? 'zone-active' : 'soft-row',
        )}
      >
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 zone-icon" />
          Cluster Manager
        </div>
        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">提案、调度与集群会话</div>
      </button>
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>Agents</span>
        <span>{cluster.agents.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {cluster.agents.map((agent) => (
          <button
            key={agent.agentId}
            type="button"
            onClick={() => onSelectAgent(agent.agentId)}
            className={cn(
              'zone-hoverable w-full rounded-lg px-3 py-2 text-left transition-colors',
              selectedAgentId === agent.agentId ? 'zone-active' : 'soft-row',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{agent.name}</span>
              <AgentStatusBadge status={agent.status} />
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{agent.role}</div>
            {agent.currentTask && (
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{agent.currentTask}</div>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}

function AgentClusterDetailPage({ cluster }: { cluster: AgentCluster }) {
  const selectedAgentId = useAgentClusterStore((state) => state.selectedAgentId);
  const selectAgent = useAgentClusterStore((state) => state.selectAgent);
  const renameCluster = useAgentClusterStore((state) => state.renameCluster);
  const saveExecutionGraph = useAgentClusterStore((state) => state.saveExecutionGraph);
  const confirmExecutionGraph = useAgentClusterStore((state) => state.confirmExecutionGraph);
  const startRun = useAgentClusterStore((state) => state.startRun);
  const refreshRunEvents = useAgentClusterStore((state) => state.refreshRunEvents);
  const resetRun = useAgentClusterStore((state) => state.resetRun);
  const resumeRunFromAgent = useAgentClusterStore((state) => state.resumeRunFromAgent);
  const retryRunAgent = useAgentClusterStore((state) => state.retryRunAgent);
  const skipRunAgent = useAgentClusterStore((state) => state.skipRunAgent);
  const loadCluster = useAgentClusterStore((state) => state.loadCluster);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(cluster.clusterName);
  const [editingGraph, setEditingGraph] = useState(false);
  const [draftGraph, setDraftGraph] = useState<AgentClusterExecutionGraph>(() => getClusterExecutionGraph(cluster));
  const [leftPaneWidth, setLeftPaneWidth] = useState(260);
  const [rightPaneWidth, setRightPaneWidth] = useState(420);
  const selectedAgent = cluster.agents.find((agent) => agent.agentId === selectedAgentId) ?? null;
  const executionGraph = getClusterExecutionGraph(cluster);
  const orchestrationConfirmed = executionGraph.confirmed;
  const activeRun = cluster.runs?.find((run) => run.runId === cluster.activeRunId) ?? null;
  const runningCount = activeRun?.childRuns.filter((child) => child.status === 'running' || child.status === 'starting').length ?? 0;
  const blockedCount = activeRun?.childRuns.filter((child) => child.status === 'blocked').length ?? 0;
  const latestRun = activeRun ?? cluster.runs?.[0] ?? null;
  const submittedCount = latestRun?.submittedChildCount ?? latestRun?.childRuns.filter((child) => child.submitStatus === 'submitted').length ?? 0;
  const completedCount = latestRun?.completedChildCount ?? latestRun?.childRuns.filter((child) => child.status === 'completed').length ?? 0;
  const failedCount = latestRun?.failedChildCount ?? latestRun?.childRuns.filter((child) => child.status === 'error' || child.status === 'timeout').length ?? 0;
  const latestEvent = cluster.events?.[0] ?? null;
  const canControlLatestRun = Boolean(latestRun);

  const startResize = (pane: 'left' | 'right', startEvent: ReactMouseEvent<HTMLDivElement>) => {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startLeft = leftPaneWidth;
    const startRight = rightPaneWidth;
    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      if (pane === 'left') {
        setLeftPaneWidth(Math.min(360, Math.max(220, startLeft + delta)));
      } else {
        setRightPaneWidth(Math.min(560, Math.max(320, startRight - delta)));
      }
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    if (!cluster.activeRunId) return;
    const timer = window.setInterval(() => {
      void loadCluster(cluster.clusterId);
      void refreshRunEvents(cluster.clusterId, cluster.activeRunId!);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [cluster.activeRunId, cluster.clusterId, loadCluster, refreshRunEvents]);

  const submitRename = async () => {
    const next = nameDraft.trim();
    if (next && next !== cluster.clusterName) {
      await renameCluster(cluster.clusterId, next);
    }
    setEditingName(false);
  };

  const saveGraph = async () => {
    await saveExecutionGraph(cluster.clusterId, draftGraph);
    setEditingGraph(false);
  };

  const confirmGraph = async () => {
    const graphToConfirm = editingGraph ? draftGraph : executionGraph;
    if (editingGraph) {
      await saveExecutionGraph(cluster.clusterId, graphToConfirm);
      setEditingGraph(false);
    }
    await confirmExecutionGraph(cluster.clusterId);
  };

  const handleResetLatestRun = async () => {
    if (!latestRun) return;
    const confirmed = window.confirm('清空本集群运行记忆、消息、事件、Manager patch/proposal 和 Agent 本地上下文；只保留 Agent 定义与编排图？');
    if (!confirmed) return;
    await resetRun(cluster.clusterId, latestRun.runId);
  };

  return (
    <div data-testid="agent-cluster-detail-page" className="zone-cluster -m-6 min-h-[calc(100vh-2.5rem)] bg-transparent">
      <div
        className="flex min-h-[calc(100vh-2.5rem)] flex-col gap-4 overflow-y-auto p-4 xl:h-[calc(100vh-2.5rem)] xl:overflow-hidden xl:flex-row"
        style={{
          '--agent-cluster-left-pane': `${leftPaneWidth}px`,
          '--agent-cluster-right-pane': `${rightPaneWidth}px`,
        } as CSSProperties}
      >
        <div className="min-h-[220px] w-full shrink-0 xl:min-h-0 xl:w-[var(--agent-cluster-left-pane)]">
          <AgentClusterAgentRail cluster={cluster} selectedAgentId={selectedAgentId} onSelectAgent={selectAgent} />
        </div>
        <div
          data-testid="agent-cluster-resize-left"
          className="hidden w-1 cursor-col-resize rounded-full bg-border transition-colors hover:bg-foreground/30 xl:block"
          onMouseDown={(event) => startResize('left', event)}
          aria-hidden="true"
        />
        <main className="glass-shell min-h-[420px] min-w-0 flex-1 overflow-y-auto rounded-xl p-4 xl:min-h-0">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                <GitBranch className="h-4 w-4" />
                Agent 集群
                {cluster.projectName && <span>· {cluster.projectName}</span>}
              </div>
              <div className="flex items-center gap-2">
                {editingName ? (
                  <>
                    <Input
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void submitRename();
                        if (event.key === 'Escape') setEditingName(false);
                      }}
                      className="h-11 max-w-md text-2xl"
                      autoFocus
                    />
                    <Button variant="ghost" size="icon" onClick={() => void submitRename()}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEditingName(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <h1 className="text-4xl font-semibold tracking-[-0.04em]">{cluster.clusterName}</h1>
                    <Button variant="ghost" size="icon" onClick={() => { setNameDraft(cluster.clusterName); setEditingName(true); }} aria-label="重命名集群">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                共享上下文保存全局一致性；每个子 Agent 保留自己的本地上下文，通过显式消息协作。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <BaseModelButton compact />
              <Badge variant="secondary" className="rounded-full">subagent_swarm</Badge>
              <Badge variant={orchestrationConfirmed ? 'secondary' : 'outline'} className="rounded-full">
                {orchestrationConfirmed ? '流水线已确认' : '待确认流水线'}
              </Badge>
              <Button
                variant="outline"
                onClick={() => {
                  if (!editingGraph) setDraftGraph(executionGraph);
                  setEditingGraph((value) => !value);
                }}
                disabled={Boolean(cluster.activeRunId)}
              >
                {editingGraph ? '退出编辑' : '编辑编排'}
              </Button>
              {editingGraph && (
                <Button variant="outline" onClick={() => void saveGraph()} disabled={Boolean(cluster.activeRunId)}>
                  保存编排
                </Button>
              )}
              <Button variant="outline" onClick={() => void confirmGraph()} disabled={Boolean(cluster.activeRunId)}>
                <Check className="mr-2 h-4 w-4" />
                确认流水线
              </Button>
              <Button
                data-testid="agent-cluster-start-run"
                onClick={() => void startRun(cluster.clusterId)}
                disabled={Boolean(cluster.activeRunId) || !orchestrationConfirmed}
                title={orchestrationConfirmed ? undefined : '请先确认 Agent 编排图'}
              >
                {cluster.activeRunId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {cluster.activeRunId ? `运行中 ${runningCount}/${cluster.agents.length}` : orchestrationConfirmed ? '启动运行' : '先确认编排'}
              </Button>
              {latestRun && (
                <Button
                  variant="outline"
                  onClick={() => void handleResetLatestRun()}
                  title="清空运行记忆、消息、事件、Manager patch/proposal 和 Agent 本地上下文，只保留 Agent 定义与编排图"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  重置运行
                </Button>
              )}
            </div>
          </div>

          {!orchestrationConfirmed && (
            <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-800 dark:text-amber-200">
              LLM 已生成建议编排图，但还不会直接运行。你可以先编辑 blocks/reviews 阻塞边，确认后运行器会按 DAG 严格调度，而不是默认并行启动所有 Agent。
            </div>
          )}

          {latestRun && (
            <div data-testid="agent-cluster-run-monitor" className="soft-panel mb-5 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">运行监控</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {latestRun.status === 'running' ? '正在执行' : latestRun.status === 'completed' ? '已完成' : latestRun.status === 'error' ? '需处理' : '等待事件'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">round {latestRun.roundStart ?? latestRun.childRuns.find((child) => typeof child.iteration === 'number')?.iteration ?? 1}</Badge>
                  <Badge variant="secondary">已提交 {submittedCount}/{cluster.agents.length}</Badge>
                  <Badge variant="secondary">完成 {completedCount}</Badge>
                  <Badge variant="secondary">阻塞 {blockedCount}</Badge>
                  <Badge variant={failedCount > 0 ? 'destructive' : 'secondary'}>异常 {failedCount}</Badge>
                  {(latestRun.loopStates ?? []).map((loop) => (
                    <Badge key={loop.loopId} variant="outline">
                      循环 {loop.currentIteration}/{loop.repeatCount}
                    </Badge>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => void refreshRunEvents(cluster.clusterId, latestRun.runId)}>
                    刷新运行事件
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleResetLatestRun()}>
                    重置运行状态
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {latestRun.childRuns.map((child) => {
                  const agent = cluster.agents.find((item) => item.agentId === child.agentId);
                  const artifactText = artifactValidationText(child.artifactValidationStatus);
                  return (
                    <div key={child.agentId} className="soft-row rounded-xl px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{agent?.name ?? child.agentId}</span>
                        <span className={cn(
                          'rounded-full px-2 py-0.5',
                          child.status === 'completed' && 'bg-emerald-500/10 text-emerald-700',
                          (child.status === 'error' || child.status === 'timeout') && 'bg-destructive/10 text-destructive',
                          (child.status === 'running' || child.status === 'starting') && 'bg-card text-foreground',
                          child.status === 'blocked' && 'bg-amber-500/10 text-amber-700',
                        )}>
                          {childRunStatusText(child.status)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-muted-foreground">{child.submitStatus ?? 'pending'} · Agent 子会话</div>
                      {typeof child.targetCandidateCount === 'number' && (
                        <div className="mt-1 text-muted-foreground">
                          候选：{child.actualCandidateCount ?? 0}/{child.targetCandidateCount}
                        </div>
                      )}
                      {artifactText && (
                        <div className={cn(
                          'mt-1',
                          child.artifactValidationStatus === 'passed' && 'text-emerald-700 dark:text-emerald-300',
                          child.artifactValidationStatus === 'failed' && 'text-destructive',
                          child.artifactValidationStatus === 'pending' && 'text-amber-700 dark:text-amber-300',
                          child.artifactValidationStatus === 'skipped' && 'text-muted-foreground',
                        )}>
                          {artifactText}
                        </div>
                      )}
                      {child.completionSource && (
                        <div className="mt-1 text-emerald-700 dark:text-emerald-300">
                          完成信号：{child.completionSource}
                        </div>
                      )}
                      {typeof child.iteration === 'number' && (
                        <div className="mt-1 text-muted-foreground">第 {child.iteration} 轮</div>
                      )}
                      {child.runtimeWaitReason && <div className="mt-1 line-clamp-2 text-muted-foreground">等待产物：{child.runtimeWaitReason}</div>}
                      {child.artifactValidationError && <div className="mt-1 line-clamp-2 text-destructive">{child.artifactValidationError}</div>}
                      {child.error && <div className="mt-1 line-clamp-2 text-destructive">{child.error}</div>}
                      {canControlLatestRun && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(child.status === 'error' || child.status === 'timeout') && (
                            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void retryRunAgent(cluster.clusterId, latestRun.runId, child.agentId)}>
                              重试
                            </Button>
                          )}
                          {(child.status === 'error' || child.status === 'timeout' || child.status === 'blocked') && (
                            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void skipRunAgent(cluster.clusterId, latestRun.runId, child.agentId)}>
                              跳过
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            disabled={Boolean(cluster.activeRunId) && (child.status === 'running' || child.status === 'starting')}
                            onClick={() => void resumeRunFromAgent(cluster.clusterId, latestRun.runId, child.agentId)}
                          >
                            从这里开始
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {latestEvent && (
                <div className="mt-3 rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
                  最近事件：{latestEvent.title} · {latestEvent.content}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-5">
            <AgentGraph
              cluster={cluster}
              selectedAgentId={selectedAgentId}
              onSelectAgent={selectAgent}
              editing={editingGraph}
              draftGraph={editingGraph ? draftGraph : executionGraph}
              onDraftGraphChange={setDraftGraph}
            />
            <SharedContextPanel cluster={cluster} />
          </div>
        </main>
        <div
          data-testid="agent-cluster-resize-right"
          className="hidden w-1 cursor-col-resize rounded-full bg-border transition-colors hover:bg-foreground/30 xl:block"
          onMouseDown={(event) => startResize('right', event)}
          aria-hidden="true"
        />
        <div className="min-h-[420px] w-full shrink-0 xl:min-h-0 xl:w-[var(--agent-cluster-right-pane)]">
          <AgentConversationPanel cluster={cluster} selectedAgent={selectedAgent} />
        </div>
      </div>
    </div>
  );
}

export function AgentClusters() {
  const { clusterId } = useParams<{ clusterId?: string }>();
  const clusters = useAgentClusterStore((state) => state.clusters);
  const loading = useAgentClusterStore((state) => state.loading);
  const loadClusters = useAgentClusterStore((state) => state.loadClusters);
  const loadCluster = useAgentClusterStore((state) => state.loadCluster);
  const selectCluster = useAgentClusterStore((state) => state.selectCluster);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

  useEffect(() => {
    selectCluster(clusterId ?? null);
    if (clusterId) {
      void loadCluster(clusterId);
    }
  }, [clusterId, loadCluster, selectCluster]);

  const cluster = clusterId
    ? clusters.find((item) => item.clusterId === clusterId) ?? null
    : null;

  if (!clusterId) {
    return <AgentClusterCreatePage />;
  }

  if (loading && !cluster) {
    return (
      <div className="flex h-[calc(100vh-2.5rem)] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!cluster) {
    return (
      <div className="flex h-[calc(100vh-2.5rem)] flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-6 w-6" />
        <p>未找到这个 Agent 集群。</p>
      </div>
    );
  }

  return <AgentClusterDetailPage key={cluster.clusterId} cluster={cluster} />;
}
