import { type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type WheelEvent as ReactWheelEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  Pause,
  Square,
  Pencil,
  Check,
  X,
  Plus,
  RefreshCcw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BaseModelButton } from '@/components/common/BaseModelButton';
import { cn, formatElapsedDuration } from '@/lib/utils';
import { useAgentClusterStore, getSelectedAgentNameFromInput } from '@/stores/agent-clusters';
import { useBaseModelStore } from '@/stores/base-model';
import type {
  AgentCluster,
  AgentClusterEvent,
  AgentClusterExecutionGraph,
  AgentClusterExecutionLoop,
  AgentClusterExecutionType,
  AgentClusterWorkflow,
  AgentClusterManagerProposal,
  AgentClusterRun,
  AgentClusterChildRun,
  AgentEdge,
  AgentMessage,
  ClusterAgent,
  CreateAgentClusterAgentRequest,
  WorkflowEdge,
  WorkflowGateKind,
  WorkflowNode,
  WorkflowNodeType,
} from '@/types/agent-cluster';

type CreateMode = 'new_task' | 'existing_task';
type AgentClusterCenterTab = 'monitor' | 'workflow' | 'context';
type ClusterManagerMode = 'ask' | 'plan' | 'review';

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

function formatExactTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
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

function runMonitorStatusText(run: AgentClusterRun): string {
  if (run.harnessStatus === 'paused') return '暂停中，可恢复';
  if (run.harnessStatus === 'aborted' || run.status === 'aborted') return '已停止，不会继续';
  if (run.harnessStatus === 'waiting_human') return '等待人工确认';
  if (run.status === 'running') return '正在执行';
  if (run.status === 'completed') return '已完成';
  if (run.status === 'error' || run.status === 'timeout') return '需处理';
  return '等待事件';
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

function childRunProgressHint(_agent: ClusterAgent, child: AgentClusterChildRun | null): string | null {
  if (!child || (child.status !== 'running' && child.status !== 'starting')) return null;
  if (child.expectedArtifacts?.length && child.artifactValidationStatus !== 'passed' && !child.completionSource) {
    return '正在等待显式契约产物落盘。';
  }
  return null;
}

function buildPhaseProgress(run: AgentClusterRun | null): Array<{
  phaseId: string;
  name: string;
  total: number;
  agentCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  retryCount: number;
  tokenTotal: number;
  durationMs?: number;
  status: string;
}> {
  if (!run) return [];
  const childRuns = run.childRuns ?? [];
  const completedCount = childRuns.filter((child) => child.status === 'completed').length;
  const runningCount = childRuns.filter((child) => child.status === 'running' || child.status === 'starting').length;
  const failedCount = childRuns.filter((child) => child.status === 'error' || child.status === 'timeout').length;
  const retryCount = run.nodeRuns?.reduce((total, nodeRun) => total + Math.max(0, nodeRun.attempt - 1), 0) ?? 0;
  const tokenTotal = run.nodeRuns?.reduce((total, nodeRun) => total + (nodeRun.tokenUsage?.total ?? 0), 0) ?? 0;
  const durationMs = run.startedAt
    ? new Date(run.completedAt ?? run.updatedAt ?? new Date().toISOString()).getTime() - new Date(run.startedAt).getTime()
    : undefined;
  return [{
    phaseId: 'cluster',
    name: '集群运行统计',
    total: childRuns.length,
    agentCount: childRuns.length,
    runningCount,
    completedCount,
    failedCount,
    retryCount,
    tokenTotal,
    durationMs,
    status: run.harnessStatus ?? run.status,
  }];
}

function formatRunDurationMs(durationMs?: number): string {
  if (!durationMs || !Number.isFinite(durationMs)) return '--';
  return formatElapsedDuration(Math.max(1, Math.round(durationMs / 1000)));
}

function parseDateMs(value?: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatClockTime(valueMs: number): string {
  return new Date(valueMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildAgentDurationTooltip(cluster: AgentCluster, run: AgentClusterRun): string {
  const runUpdatedMs = parseDateMs(run.completedAt ?? run.updatedAt) ?? Date.now();
  return run.childRuns.map((child) => {
    const agent = cluster.agents.find((item) => item.agentId === child.agentId);
    const name = agent?.name ?? child.agentId;
    if (!child.runId && child.submitStatus !== 'submitted' && child.status === 'blocked') {
      return `${name}：未启动`;
    }
    const startedAtMs = parseDateMs(child.startedAt) ?? runUpdatedMs;
    const endMs = parseDateMs(child.completedAt) ?? (
      child.status === 'running' || child.status === 'starting'
        ? runUpdatedMs
        : parseDateMs(child.updatedAt) ?? runUpdatedMs
    );
    const duration = formatElapsedDuration(Math.max(0, Math.floor((endMs - startedAtMs) / 1000)));
    const endLabel = child.status === 'running' || child.status === 'starting' ? 'now' : formatClockTime(endMs);
    return `${name}：${duration}（${formatClockTime(startedAtMs)} → ${endLabel}）`;
  }).join('\n');
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

function getCurrentWorkflow(cluster: AgentCluster): AgentClusterWorkflow | null {
  return cluster.workflows?.find((workflow) => workflow.workflowId === cluster.currentWorkflowId)
    ?? cluster.workflows?.find((workflow) => workflow.status === 'confirmed')
    ?? cluster.workflows?.[0]
    ?? null;
}

const workflowNodeLabels: Record<WorkflowNodeType, string> = {
  agent: 'Agent',
  fan_out: 'Fan-out',
  join: 'Join',
  gate: 'Gate',
  review: 'Review',
  reduce: 'Reduce',
  loop: 'Loop',
  human_gate: 'Human Gate',
};

function getWorkflowNodeOrder(workflow: AgentClusterWorkflow): WorkflowNode[] {
  const nodeById = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
  const incoming = new Map(workflow.nodes.map((node) => [node.nodeId, 0]));
  const outgoing = new Map(workflow.nodes.map((node) => [node.nodeId, [] as string[]]));
  for (const edge of workflow.edges.filter((edge) => edge.kind === 'control')) {
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1);
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
  }
  const queue = workflow.nodes.filter((node) => (incoming.get(node.nodeId) ?? 0) === 0);
  const result: WorkflowNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const nextId of outgoing.get(node.nodeId) ?? []) {
      const nextIncoming = (incoming.get(nextId) ?? 1) - 1;
      incoming.set(nextId, nextIncoming);
      if (nextIncoming === 0) {
        const next = nodeById.get(nextId);
        if (next) queue.push(next);
      }
    }
  }
  return result.length === workflow.nodes.length ? result : workflow.nodes;
}

function isWorkflowAgentLikeNode(node: WorkflowNode): boolean {
  return node.type === 'agent' || node.type === 'review' || node.type === 'reduce';
}

function getWorkflowAgentDisplayOrder(workflow: AgentClusterWorkflow): WorkflowNode[] {
  const orderedNodes = getWorkflowNodeOrder(workflow);
  const nodeById = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
  const agentLikeIds = new Set(workflow.nodes.filter(isWorkflowAgentLikeNode).map((node) => node.nodeId));
  const controlOutgoing = new Map<string, string[]>();
  for (const edge of workflow.edges.filter((item) => item.kind === 'control')) {
    controlOutgoing.set(edge.fromNodeId, [...(controlOutgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }

  const agentOutgoing = new Map<string, Set<string>>();
  const agentIncomingCount = new Map<string, number>();
  for (const agentId of agentLikeIds) {
    agentOutgoing.set(agentId, new Set());
    agentIncomingCount.set(agentId, 0);
  }

  for (const agentId of agentLikeIds) {
    const queue = [...(controlOutgoing.get(agentId) ?? [])];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = nodeById.get(nodeId);
      if (!node) continue;
      if (agentLikeIds.has(nodeId)) {
        if (nodeId !== agentId && !agentOutgoing.get(agentId)?.has(nodeId)) {
          agentOutgoing.get(agentId)?.add(nodeId);
          agentIncomingCount.set(nodeId, (agentIncomingCount.get(nodeId) ?? 0) + 1);
        }
        continue;
      }
      queue.push(...(controlOutgoing.get(nodeId) ?? []));
    }
  }

  const fallbackOrder = orderedNodes.filter(isWorkflowAgentLikeNode);
  const fallbackIndex = new Map(fallbackOrder.map((node, index) => [node.nodeId, index]));
  const queue = fallbackOrder
    .filter((node) => (agentIncomingCount.get(node.nodeId) ?? 0) === 0)
    .sort((a, b) => (fallbackIndex.get(a.nodeId) ?? 0) - (fallbackIndex.get(b.nodeId) ?? 0));
  const result: WorkflowNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    const nextIds = [...(agentOutgoing.get(node.nodeId) ?? [])]
      .sort((a, b) => (fallbackIndex.get(a) ?? 0) - (fallbackIndex.get(b) ?? 0));
    for (const nextId of nextIds) {
      const nextIncoming = (agentIncomingCount.get(nextId) ?? 1) - 1;
      agentIncomingCount.set(nextId, nextIncoming);
      if (nextIncoming === 0) {
        const next = nodeById.get(nextId);
        if (next) queue.push(next);
      }
    }
  }

  if (result.length !== agentLikeIds.size) {
    return fallbackOrder;
  }
  return result;
}

function getOrderedWorkflowLoopBodyNodeIds(workflow: AgentClusterWorkflow, loop: Extract<WorkflowNode, { type: 'loop' }>): string[] {
  if (loop.bodyNodeIds.length <= 1) return loop.bodyNodeIds;
  const bodySet = new Set(loop.bodyNodeIds);
  const fallbackIndex = new Map(loop.bodyNodeIds.map((nodeId, index) => [nodeId, index]));
  const nodeById = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges.filter((item) => item.kind === 'control')) {
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }

  const bodyOutgoing = new Map<string, Set<string>>();
  const bodyIncomingCount = new Map<string, number>();
  for (const nodeId of loop.bodyNodeIds) {
    bodyOutgoing.set(nodeId, new Set());
    bodyIncomingCount.set(nodeId, 0);
  }

  for (const startNodeId of loop.bodyNodeIds) {
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
      if (!node || isWorkflowAgentLikeNode(node)) continue;
      queue.push(...(outgoing.get(nodeId) ?? []));
    }
  }

  const queue = loop.bodyNodeIds
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
  return ordered.length === loop.bodyNodeIds.length ? ordered : loop.bodyNodeIds;
}

function clearWorkflowNodePositions(workflow: AgentClusterWorkflow): AgentClusterWorkflow {
  return {
    ...workflow,
    layoutMode: undefined,
    nodes: workflow.nodes.map((node) => {
      const next = { ...node } as WorkflowNode;
      delete next.x;
      delete next.y;
      return next;
    }),
  };
}

function prepareWorkflowForEditing(workflow: AgentClusterWorkflow): AgentClusterWorkflow {
  if (workflow.layoutMode === 'manual') return structuredClone(workflow);
  return {
    ...clearWorkflowNodePositions(structuredClone(workflow)),
    layoutMode: 'manual',
  };
}

function WorkflowOverview({
  workflow,
  run,
  selectedNodeId,
  onSelectNode,
  selectedEdgeId,
  onSelectEdge,
  connectFromNodeId,
  onHandleClick,
  onCancelConnect,
  onNodePositionChange,
}: {
  workflow: AgentClusterWorkflow;
  run?: AgentClusterRun | null;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  selectedEdgeId?: string | null;
  onSelectEdge?: (edgeId: string) => void;
  connectFromNodeId?: string | null;
  onHandleClick?: (nodeId: string) => void;
  onCancelConnect?: () => void;
  onNodePositionChange?: (nodeId: string, position: { x: number; y: number }) => void;
}) {
  const [showDataEdges, setShowDataEdges] = useState(false);
  const orderedNodes = getWorkflowNodeOrder(workflow);
  const agents = getWorkflowAgentDisplayOrder(workflow);
  const nodeRunById = new Map((run?.nodeRuns ?? []).map((nodeRun) => [nodeRun.nodeId, nodeRun]));
  const dataEdgeCount = workflow.edges.filter((edge) => edge.kind === 'data').length;
  const displayEdges = workflow.edges.filter((edge) => showDataEdges || edge.kind === 'control');
  const incoming = new Map<string, WorkflowEdge[]>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of displayEdges) {
    incoming.set(edge.toNodeId, [...(incoming.get(edge.toNodeId) ?? []), edge]);
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge]);
  }

  const nodeWidth = 200;
  const nodeHeight = 106;
  const xStep = 300;
  const baseY = 250;
  const initialCanvasWidth = Math.max(860, agents.length * xStep + 220);
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const useSavedNodePositions = workflow.layoutMode === 'manual';
  const savedPositionFor = (node: WorkflowNode) => (
    useSavedNodePositions && typeof node.x === 'number' && Number.isFinite(node.x) && typeof node.y === 'number' && Number.isFinite(node.y)
      ? { x: node.x, y: node.y }
      : null
  );
  const operatorSizeFor = (node: WorkflowNode) => {
    if (node.type === 'gate') return { width: 86, height: 30 };
    if (node.type === 'loop') return { width: 96, height: 30 };
    if (node.type === 'fan_out' || node.type === 'join') return { width: 96, height: 32 };
    return { width: 112, height: 32 };
  };

  agents.forEach((node, index) => {
    const saved = savedPositionFor(node);
    positions.set(node.nodeId, { x: saved?.x ?? 80 + index * xStep, y: saved?.y ?? baseY, width: nodeWidth, height: nodeHeight });
  });

  const placeBetween = (node: WorkflowNode, width: number, height: number, yOffset = 38) => {
    const from = (incoming.get(node.nodeId) ?? []).map((edge) => positions.get(edge.fromNodeId)).find(Boolean);
    const to = (outgoing.get(node.nodeId) ?? []).map((edge) => positions.get(edge.toNodeId)).find(Boolean);
    if (!from || !to) return false;
    const fromCenter = from.x + from.width / 2;
    const toCenter = to.x + to.width / 2;
    positions.set(node.nodeId, {
      x: (fromCenter + toCenter) / 2 - width / 2,
      y: Math.min(from.y, to.y) + yOffset,
      width,
      height,
    });
    return true;
  };

  const floatingOperators = orderedNodes.filter((node) => node.type !== 'agent' && node.type !== 'review' && node.type !== 'reduce');
  const gateLaneByPair = new Map<string, number>();
  floatingOperators.forEach((node, index) => {
    const saved = savedPositionFor(node);
    if (saved) {
      const size = operatorSizeFor(node);
      positions.set(node.nodeId, { ...saved, ...size });
      return;
    }
    if (node.type === 'gate') {
      const incomingEdge = (incoming.get(node.nodeId) ?? []).find((edge) => positions.has(edge.fromNodeId));
      const outgoingEdge = (outgoing.get(node.nodeId) ?? []).find((edge) => positions.has(edge.toNodeId));
      const pairKey = incomingEdge && outgoingEdge ? `${incomingEdge.fromNodeId}->${outgoingEdge.toNodeId}` : node.nodeId;
      const lane = gateLaneByPair.get(pairKey) ?? 0;
      gateLaneByPair.set(pairKey, lane + 1);
      if (placeBetween(node, 86, 30, 38 + lane * 36)) return;
    }
    if (node.type === 'fan_out') {
      const branchPositions = (outgoing.get(node.nodeId) ?? [])
        .map((edge) => positions.get(edge.toNodeId))
        .filter((position): position is { x: number; y: number; width: number; height: number } => Boolean(position));
      if (branchPositions.length > 0) {
        const minX = Math.min(...branchPositions.map((position) => position.x));
        const maxX = Math.max(...branchPositions.map((position) => position.x + position.width));
        positions.set(node.nodeId, { x: minX + (maxX - minX) / 2 - 48, y: baseY - 88, width: 96, height: 32 });
        return;
      }
    }
    if (node.type === 'join') {
      const sourcePositions = (incoming.get(node.nodeId) ?? [])
        .map((edge) => positions.get(edge.fromNodeId))
        .filter((position): position is { x: number; y: number; width: number; height: number } => Boolean(position));
      if (sourcePositions.length > 0) {
        const minX = Math.min(...sourcePositions.map((position) => position.x));
        const maxX = Math.max(...sourcePositions.map((position) => position.x + position.width));
        positions.set(node.nodeId, { x: minX + (maxX - minX) / 2 - 48, y: baseY + 150, width: 96, height: 32 });
        return;
      }
    }
    if (node.type === 'loop') {
      const loopBody = new Set(node.bodyNodeIds);
      const loopPositions = agents
        .filter((agent) => loopBody.has(agent.nodeId))
        .map((agent) => positions.get(agent.nodeId))
        .filter((position): position is { x: number; y: number; width: number; height: number } => Boolean(position));
      if (loopPositions.length > 0) {
        const minX = Math.min(...loopPositions.map((position) => position.x));
        const maxX = Math.max(...loopPositions.map((position) => position.x + position.width));
        positions.set(node.nodeId, { x: minX + (maxX - minX) / 2 - 48, y: baseY - 34, width: 96, height: 30 });
        return;
      }
    }
    positions.set(node.nodeId, {
      x: 80 + (index % 4) * 150,
      y: baseY + 180 + Math.floor(index / 4) * 58,
      width: 112,
      height: 32,
    });
  });

  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<
    | {
      type: 'node';
      nodeId: string;
      startX: number;
      startY: number;
      startOffsetX: number;
      startOffsetY: number;
      startNodeX: number;
      startNodeY: number;
    }
    | {
      type: 'pan';
      startX: number;
      startY: number;
      startPanX: number;
      startPanY: number;
    }
    | null
  >(null);

  for (const [nodeId, offset] of Object.entries(nodeOffsets)) {
    const position = positions.get(nodeId);
    if (position) positions.set(nodeId, { ...position, x: position.x + offset.x, y: position.y + offset.y });
  }

  const positionedNodes = Array.from(positions.values());
  const contentWidthFromNodes = positionedNodes.length > 0
    ? Math.max(...positionedNodes.map((position) => position.x + position.width + 160))
    : initialCanvasWidth;
  const managerBaseWidth = Math.max(initialCanvasWidth, contentWidthFromNodes);
  const agentPositions = agents
    .map((node) => positions.get(node.nodeId))
    .filter((position): position is { x: number; y: number; width: number; height: number } => Boolean(position));
  const agentRowMinX = agentPositions.length > 0 ? Math.min(...agentPositions.map((position) => position.x)) : 80;
  const agentRowMaxX = agentPositions.length > 0 ? Math.max(...agentPositions.map((position) => position.x + position.width)) : managerBaseWidth;
  const managerCenterX = agentPositions.length > 0 ? (agentRowMinX + agentRowMaxX) / 2 : managerBaseWidth / 2;
  const managerPosition = { x: Math.max(80, managerCenterX - 110), y: 24, width: 220, height: 76 };
  const getCenter = (nodeId: string) => {
    const position = positions.get(nodeId);
    if (!position) return null;
    return { x: position.x + position.width / 2, y: position.y + position.height / 2 };
  };
  const edgePath = (edge: WorkflowEdge) => {
    const from = getCenter(edge.fromNodeId);
    const to = getCenter(edge.toNodeId);
    if (!from || !to) return '';
    if (from.x > to.x) {
      const drop = Math.max(92, Math.abs(from.x - to.x) / 3);
      return `M ${from.x} ${from.y} C ${from.x + 60} ${from.y + drop}, ${to.x - 60} ${to.y + drop}, ${to.x} ${to.y}`;
    }
    const midX = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
  };

  const firstEntry = agents.find((node) => (incoming.get(node.nodeId) ?? []).length === 0) ?? agents[0];
  const lastTerminal = [...agents].reverse().find((node) => (outgoing.get(node.nodeId) ?? []).length === 0) ?? agents[agents.length - 1];
  const layoutBounds = { maxX: managerPosition.x + managerPosition.width + 80, maxY: managerPosition.y + managerPosition.height + 80 };
  const includeBounds = (x: number, y: number, width = 0, height = 0) => {
    layoutBounds.maxX = Math.max(layoutBounds.maxX, x + width + 80);
    layoutBounds.maxY = Math.max(layoutBounds.maxY, y + height + 80);
  };
  for (const position of positions.values()) includeBounds(position.x, position.y, position.width, position.height);
  for (const loop of workflow.nodes.filter((node): node is Extract<WorkflowNode, { type: 'loop' }> => node.type === 'loop')) {
    const loopPositions = loop.bodyNodeIds
      .map((nodeId) => positions.get(nodeId))
      .filter((position): position is { x: number; y: number; width: number; height: number } => Boolean(position));
    if (loopPositions.length === 0) continue;
    const minX = Math.min(...loopPositions.map((position) => position.x));
    const maxX = Math.max(...loopPositions.map((position) => position.x + position.width));
    const minY = Math.min(...loopPositions.map((position) => position.y));
    const maxY = Math.max(...loopPositions.map((position) => position.y + position.height));
    includeBounds(minX - 24, minY - 56, maxX - minX + 48, maxY - minY + 88);
  }
  for (const fanOut of workflow.nodes.filter((node): node is Extract<WorkflowNode, { type: 'fan_out' }> => node.type === 'fan_out')) {
    const branchPositions = (outgoing.get(fanOut.nodeId) ?? [])
      .map((edge) => positions.get(edge.toNodeId))
      .filter((position): position is { x: number; y: number; width: number; height: number } => Boolean(position));
    if (branchPositions.length === 0) continue;
    const minX = Math.min(...branchPositions.map((position) => position.x));
    const maxX = Math.max(...branchPositions.map((position) => position.x + position.width));
    const minY = Math.min(...branchPositions.map((position) => position.y));
    const maxY = Math.max(...branchPositions.map((position) => position.y + position.height));
    includeBounds(minX - 18, minY - 44, maxX - minX + 36, maxY - minY + 68);
  }
  for (const edge of displayEdges) {
    const from = getCenter(edge.fromNodeId);
    const to = getCenter(edge.toNodeId);
    if (!from || !to || from.x <= to.x) continue;
    const drop = Math.max(92, Math.abs(from.x - to.x) / 3);
    includeBounds(Math.min(from.x, to.x), Math.max(from.y, to.y) + drop, Math.abs(from.x - to.x), 24);
  }
  const canvasWidth = Math.ceil(Math.max(initialCanvasWidth, layoutBounds.maxX));
  const canvasHeight = Math.ceil(Math.max(620, layoutBounds.maxY));

  const toCanvasPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (clientX - rect.left - pan.x) / scale,
      y: (clientY - rect.top - pan.y) / scale,
    };
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (event.ctrlKey || event.metaKey) {
      const viewportX = event.clientX - rect.left;
      const viewportY = event.clientY - rect.top;
      const nextScale = Math.min(1.8, Math.max(0.55, Number((scale * Math.exp(-event.deltaY * 0.002)).toFixed(3))));
      if (nextScale === scale) return;

      const anchorX = (viewportX - pan.x) / scale;
      const anchorY = (viewportY - pan.y) / scale;
      setScale(nextScale);
      setPan({
        x: viewportX - anchorX * nextScale,
        y: viewportY - anchorY * nextScale,
      });
      return;
    }

    setPan((value) => ({
      x: value.x - event.deltaX,
      y: value.y - event.deltaY,
    }));
  };

  useEffect(() => {
    if (!dragState) return;
    const onPointerMove = (event: PointerEvent) => {
      const deltaX = (event.clientX - dragState.startX) / scale;
      const deltaY = (event.clientY - dragState.startY) / scale;
      if (dragState.type === 'node') {
        setNodeOffsets((value) => ({
          ...value,
          [dragState.nodeId]: {
            x: dragState.startOffsetX + deltaX,
            y: dragState.startOffsetY + deltaY,
          },
        }));
      } else {
        setPan({
          x: dragState.startPanX + event.clientX - dragState.startX,
          y: dragState.startPanY + event.clientY - dragState.startY,
        });
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (dragState.type === 'node') {
        const deltaX = (event.clientX - dragState.startX) / scale;
        const deltaY = (event.clientY - dragState.startY) / scale;
        onNodePositionChange?.(dragState.nodeId, {
          x: Math.round(dragState.startNodeX + deltaX),
          y: Math.round(dragState.startNodeY + deltaY),
        });
        setNodeOffsets((value) => {
          const next = { ...value };
          delete next[dragState.nodeId];
          return next;
        });
      }
      setDragState(null);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragState, onNodePositionChange, scale]);

  const renderAgent = (node: WorkflowNode) => {
    const nodeRun = nodeRunById.get(node.nodeId);
    const isRunning = nodeRun?.status === 'running';
    const selectable = Boolean(onSelectNode);
    const selected = selectedNodeId === node.nodeId;
    const position = positions.get(node.nodeId);
    if (!position) return null;
    const handles = ['top', 'right', 'bottom', 'left'] as const;
    return (
      <div
        key={node.nodeId}
        data-testid={`workflow-agent-node-${node.nodeId}`}
        className="absolute"
        style={{ left: position.x, top: position.y, width: position.width, height: position.height }}
      >
        <button
          type="button"
          onPointerDown={(event) => {
            if (!onHandleClick) return;
            event.stopPropagation();
            const offset = nodeOffsets[node.nodeId] ?? { x: 0, y: 0 };
            setDragState({
              type: 'node',
              nodeId: node.nodeId,
              startX: event.clientX,
              startY: event.clientY,
              startOffsetX: offset.x,
              startOffsetY: offset.y,
              startNodeX: position.x - offset.x,
              startNodeY: position.y - offset.y,
            });
          }}
          onClick={() => onSelectNode?.(node.nodeId)}
          className={cn(
            'h-full w-full rounded-xl border border-border/80 bg-card px-3 py-3 text-left shadow-sm transition-shadow',
            selectable ? 'cursor-pointer hover:shadow-md' : 'cursor-default',
            selected && 'ring-2 ring-foreground/20',
            connectFromNodeId === node.nodeId && 'ring-2 ring-foreground',
            isRunning && 'workflow-node-running',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="line-clamp-2 break-words text-sm font-semibold [overflow-wrap:anywhere]">{node.name}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {node.type === 'review' ? 'Review Agent' : node.type === 'reduce' ? 'Reduce Agent' : 'Agent'}
              </div>
            </div>
            {nodeRun && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-foreground/50" title={nodeRun.status} />}
          </div>
          {node.description && <div className="mt-2 line-clamp-2 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{node.description}</div>}
        </button>
        {onHandleClick && handles.map((handle) => (
          <button
            type="button"
            key={handle}
            aria-label={`${node.name} ${handle} 触点`}
            onClick={(event) => {
              event.stopPropagation();
              onHandleClick(node.nodeId);
            }}
            className={cn(
              'absolute h-3 w-3 rounded-full border border-border bg-background shadow-sm transition-transform hover:scale-125',
              handle === 'top' && 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2',
              handle === 'right' && 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2',
              handle === 'bottom' && 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
              handle === 'left' && 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
            )}
          />
        ))}
      </div>
    );
  };

  const renderOperator = (node: WorkflowNode) => {
    const position = positions.get(node.nodeId);
    if (!position) return null;
    const nodeRun = nodeRunById.get(node.nodeId);
    const isRunning = nodeRun?.status === 'running';
    const selected = selectedNodeId === node.nodeId;
    const handles = ['top', 'right', 'bottom', 'left'] as const;
    return (
      <div
        key={node.nodeId}
        className="absolute"
        style={{ left: position.x, top: position.y, width: position.width, height: position.height }}
      >
        <button
          type="button"
          data-testid={`workflow-operator-node-${node.nodeId}`}
          onPointerDown={(event) => {
            if (!onHandleClick) return;
            event.stopPropagation();
            const offset = nodeOffsets[node.nodeId] ?? { x: 0, y: 0 };
            setDragState({
              type: 'node',
              nodeId: node.nodeId,
              startX: event.clientX,
              startY: event.clientY,
              startOffsetX: offset.x,
              startOffsetY: offset.y,
              startNodeX: position.x - offset.x,
              startNodeY: position.y - offset.y,
            });
          }}
          onClick={() => onSelectNode?.(node.nodeId)}
          className={cn(
            'h-full w-full rounded-lg border border-border/80 bg-background px-2 text-center text-[10px] font-medium text-muted-foreground shadow-sm transition-shadow hover:shadow-md',
            selected && 'ring-2 ring-foreground/20',
            connectFromNodeId === node.nodeId && 'ring-2 ring-foreground',
            isRunning && 'workflow-node-running',
          )}
          style={{ lineHeight: `${position.height}px` }}
          title={node.description || node.name}
        >
          {node.type === 'gate' ? 'Gate' : workflowNodeLabels[node.type]}
        </button>
        {onHandleClick && handles.map((handle) => (
          <button
            type="button"
            key={handle}
            aria-label={`${node.name} ${handle} 触点`}
            onClick={(event) => {
              event.stopPropagation();
              onHandleClick(node.nodeId);
            }}
            className={cn(
              'absolute h-2.5 w-2.5 rounded-full border border-border bg-background shadow-sm transition-transform hover:scale-125',
              handle === 'top' && 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2',
              handle === 'right' && 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2',
              handle === 'bottom' && 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
              handle === 'left' && 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
            )}
          />
        ))}
      </div>
    );
  };

  if (agents.length === 0) {
    return (
      <div className="mt-4 min-h-[520px] w-full max-w-full min-w-0 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
        Workflow 尚未包含 Agent 节点。
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      data-testid="agent-cluster-workflow-overview"
      className={cn(
        'mt-4 h-[620px] max-h-[calc(100vh-14rem)] min-h-[420px] w-full max-w-full min-w-0 overflow-auto overscroll-contain rounded-xl border border-border/70 bg-background/55 p-3',
        onHandleClick && (dragState?.type === 'pan' ? 'cursor-grabbing' : 'cursor-grab'),
      )}
      onWheel={handleWheel}
      onPointerMove={(event) => {
        if (!connectFromNodeId) return;
        setPointerPosition(toCanvasPoint(event.clientX, event.clientY));
      }}
    >
      <div
        className="relative"
        style={{
          width: canvasWidth,
          height: canvasHeight,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
        onPointerDown={(event) => {
          if (!onHandleClick || event.target !== event.currentTarget) return;
          setDragState({
            type: 'pan',
            startX: event.clientX,
            startY: event.clientY,
            startPanX: pan.x,
            startPanY: pan.y,
          });
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          setPointerPosition(null);
          onCancelConnect?.();
        }}
      >
        <svg className="pointer-events-none absolute inset-0" width={canvasWidth} height={canvasHeight} aria-hidden="true">
          <defs>
            <marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          {firstEntry && (() => {
            const to = getCenter(firstEntry.nodeId);
            if (!to) return null;
            const from = { x: managerPosition.x + managerPosition.width / 2, y: managerPosition.y + managerPosition.height };
            return <path d={`M ${from.x} ${from.y} C ${from.x} ${from.y + 54}, ${to.x} ${to.y - 72}, ${to.x} ${to.y - 4}`} className="fill-none stroke-border" strokeWidth="1.5" strokeDasharray="4 4" markerEnd="url(#workflow-arrow)" />;
          })()}
          {showDataEdges && lastTerminal && (() => {
            const from = getCenter(lastTerminal.nodeId);
            if (!from) return null;
            const to = { x: managerPosition.x + managerPosition.width / 2, y: managerPosition.y + managerPosition.height / 2 };
            return <path d={`M ${from.x} ${from.y - 42} C ${from.x} ${managerPosition.y - 12}, ${to.x} ${managerPosition.y - 12}, ${to.x} ${to.y}`} className="fill-none stroke-border" strokeWidth="1.2" strokeDasharray="3 5" />;
          })()}
        </svg>

        {(workflow.nodes.filter((node) => node.type === 'loop') as Extract<WorkflowNode, { type: 'loop' }>[]).map((loop) => {
          const loopPositions = loop.bodyNodeIds
            .map((nodeId) => positions.get(nodeId))
            .filter((position): position is { x: number; y: number; width: number; height: number } => Boolean(position));
          if (loopPositions.length === 0) return null;
          const minX = Math.min(...loopPositions.map((position) => position.x));
          const maxX = Math.max(...loopPositions.map((position) => position.x + position.width));
          const minY = Math.min(...loopPositions.map((position) => position.y));
          const maxY = Math.max(...loopPositions.map((position) => position.y + position.height));
          return (
            <button
              key={loop.nodeId}
              type="button"
              data-testid="workflow-loop-group"
              onClick={() => onSelectNode?.(loop.nodeId)}
              className={cn(
                'absolute rounded-2xl border border-dashed border-foreground/25 bg-card/20 text-left',
                selectedNodeId === loop.nodeId && 'ring-2 ring-foreground/20',
              )}
              style={{ left: minX - 24, top: minY - 56, width: maxX - minX + 48, height: maxY - minY + 88 }}
            >
              <span className="absolute left-4 top-2 rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                Loop × {loop.repeatCount}
              </span>
            </button>
          );
        })}

        {(workflow.nodes.filter((node) => node.type === 'fan_out') as Extract<WorkflowNode, { type: 'fan_out' }>[]).map((fanOut) => {
          const branchPositions = (outgoing.get(fanOut.nodeId) ?? [])
            .map((edge) => positions.get(edge.toNodeId))
            .filter((position): position is { x: number; y: number; width: number; height: number } => Boolean(position));
          if (branchPositions.length === 0) return null;
          const minX = Math.min(...branchPositions.map((position) => position.x));
          const maxX = Math.max(...branchPositions.map((position) => position.x + position.width));
          const minY = Math.min(...branchPositions.map((position) => position.y));
          const maxY = Math.max(...branchPositions.map((position) => position.y + position.height));
          return (
            <button
              key={fanOut.nodeId}
              type="button"
              data-testid="workflow-fanout-group"
              onClick={() => onSelectNode?.(fanOut.nodeId)}
              className={cn(
                'absolute rounded-2xl border border-dashed border-border bg-card/10 text-left',
                selectedNodeId === fanOut.nodeId && 'ring-2 ring-foreground/20',
              )}
              style={{ left: minX - 18, top: minY - 44, width: maxX - minX + 36, height: maxY - minY + 68 }}
            >
              <span className="absolute left-4 top-2 rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                Fan-out · 并发 {fanOut.concurrency}
              </span>
            </button>
          );
        })}

        <svg className="absolute inset-0" width={canvasWidth} height={canvasHeight}>
          <defs>
            <marker id="workflow-arrow-interactive" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          {displayEdges.map((edge) => {
            const path = edgePath(edge);
            const from = getCenter(edge.fromNodeId);
            const to = getCenter(edge.toNodeId);
            if (!path || !from || !to) return null;
            const selected = selectedEdgeId === edge.edgeId;
            const edgeRunning = nodeRunById.get(edge.fromNodeId)?.status === 'running'
              || nodeRunById.get(edge.toNodeId)?.status === 'running';
            return (
              <g key={edge.edgeId}>
                <path
                  d={path}
                  className="fill-none stroke-transparent"
                  strokeWidth="14"
                  onClick={() => onSelectEdge?.(edge.edgeId)}
                  role={onSelectEdge ? 'button' : undefined}
                />
                <path
                  d={path}
                  className={cn('pointer-events-none fill-none', selected ? 'stroke-foreground' : 'stroke-muted-foreground/55', edgeRunning && 'workflow-edge-running')}
                  strokeWidth={selected ? 2.4 : 1.6}
                  strokeDasharray={edge.kind === 'data' || from.x > to.x ? '5 5' : undefined}
                  markerEnd="url(#workflow-arrow-interactive)"
                />
              </g>
            );
          })}
          {connectFromNodeId && pointerPosition && (() => {
            const from = getCenter(connectFromNodeId);
            if (!from) return null;
            const midX = (from.x + pointerPosition.x) / 2;
            return (
              <path
                d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${pointerPosition.y}, ${pointerPosition.x} ${pointerPosition.y}`}
                className="pointer-events-none fill-none stroke-foreground/70"
                strokeWidth="1.8"
                strokeDasharray="5 5"
              />
            );
          })()}
        </svg>

        <div
          className="absolute rounded-2xl border border-border/80 bg-card px-4 py-3 text-center shadow-sm"
          style={{ left: managerPosition.x, top: managerPosition.y, width: managerPosition.width, height: managerPosition.height }}
        >
          <div className="text-sm font-semibold">Cluster Manager</div>
          <div className="mt-1 text-[11px] leading-4 text-muted-foreground">提案、总控与结果汇总</div>
        </div>

        {dataEdgeCount > 0 && (
          <button
            type="button"
            className="absolute right-3 top-3 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-shadow hover:shadow-md"
            style={{ transform: `scale(${1 / scale})`, transformOrigin: 'top right' }}
            onClick={(event) => {
              event.stopPropagation();
              setShowDataEdges((value) => !value);
            }}
          >
            {showDataEdges ? '隐藏数据/反馈边' : `显示数据/反馈边 ${dataEdgeCount}`}
          </button>
        )}

        {agents.map(renderAgent)}
        {floatingOperators.filter((node) => node.type !== 'loop').map(renderOperator)}
      </div>
    </div>
  );
}

function WorkflowEditor({
  workflow,
  run,
  editing,
  label = 'Harness Workflow',
  onChange,
  onManualCreateAgent,
  onAiCreateAgent,
}: {
  workflow: AgentClusterWorkflow;
  run?: AgentClusterRun | null;
  editing: boolean;
  label?: string;
  onChange: (workflow: AgentClusterWorkflow) => void;
  onManualCreateAgent: (input: CreateAgentClusterAgentRequest) => Promise<void>;
  onAiCreateAgent: (prompt: string) => Promise<void>;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(workflow.nodes[0]?.nodeId ?? '');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectFromNodeId, setConnectFromNodeId] = useState<string | null>(null);
  const [addAgentMode, setAddAgentMode] = useState<'closed' | 'ai' | 'manual'>('closed');
  const [aiAgentPrompt, setAiAgentPrompt] = useState('');
  const [manualAgentDraft, setManualAgentDraft] = useState<CreateAgentClusterAgentRequest>({
    name: '',
    role: '',
    description: '',
    systemPrompt: '',
    tools: [],
    capabilities: [],
  });
  const [addingAgent, setAddingAgent] = useState(false);
  const selectedNode = workflow.nodes.find((node) => node.nodeId === selectedNodeId) ?? workflow.nodes[0] ?? null;
  const selectedEdge = workflow.edges.find((edge) => edge.edgeId === selectedEdgeId) ?? null;
  const operatorDescriptions: Record<Exclude<WorkflowNodeType, 'agent' | 'review' | 'reduce'>, string> = {
    fan_out: '并行展开多个分支',
    join: '等待并汇合分支结果',
    gate: '用代码检查完成、产物或数量',
    loop: '框住子链并重复执行',
    human_gate: '暂停等待用户确认',
  };

  const appendNodesAndEdges = (nodes: WorkflowNode[], edges: WorkflowEdge[] = []) => {
    onChange({
      ...workflow,
      status: 'draft',
      nodes: [...workflow.nodes, ...nodes],
      edges: [...workflow.edges, ...edges],
    });
  };

  const updateNode = (nodeId: string, patch: Partial<WorkflowNode>) => {
    const updatesPosition = typeof patch.x === 'number' || typeof patch.y === 'number';
    onChange({
      ...workflow,
      status: 'draft',
      layoutMode: updatesPosition ? 'manual' : workflow.layoutMode,
      nodes: workflow.nodes.map((node) => node.nodeId === nodeId ? { ...node, ...patch } as WorkflowNode : node),
    });
  };

  const addOperator = (type: Exclude<WorkflowNodeType, 'agent' | 'review' | 'reduce'>) => {
    const nodeId = `${type}:${crypto.randomUUID()}`;
    const base = { nodeId, type, name: workflowNodeLabels[type] };
    const node: WorkflowNode = type === 'join'
        ? { ...base, type, mode: 'all' }
        : type === 'gate'
          ? { ...base, type, gateKind: 'completion' }
          : type === 'fan_out'
            ? { ...base, type, concurrency: Math.min(4, workflow.policy.maxConcurrency) }
            : type === 'loop'
              ? { ...base, type, bodyNodeIds: [], repeatCount: 2 }
              : { ...base, type, prompt: '请确认是否继续执行后续节点。' };
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    if (type === 'fan_out') {
      const joinId = `join:${crypto.randomUUID()}`;
      appendNodesAndEdges([node, { nodeId: joinId, type: 'join', name: 'Join', mode: 'all' }]);
      return;
    }
    appendNodesAndEdges([node]);
  };

  const addEdgeBetween = (fromNodeId: string, toNodeId: string) => {
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
    if (workflow.edges.some((edge) => edge.kind === 'control' && edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId)) return;
    const edge: WorkflowEdge = {
      edgeId: crypto.randomUUID(),
      fromNodeId,
      toNodeId,
      kind: 'control',
    };
    onChange({ ...workflow, status: 'draft', edges: [...workflow.edges, edge] });
    setSelectedEdgeId(edge.edgeId);
  };

  const handleCanvasHandleClick = (nodeId: string) => {
    if (!connectFromNodeId) {
      setConnectFromNodeId(nodeId);
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      return;
    }
    if (connectFromNodeId === nodeId) {
      setConnectFromNodeId(null);
      return;
    }
    addEdgeBetween(connectFromNodeId, nodeId);
    setConnectFromNodeId(null);
  };

  const updateEdge = (edgeId: string, patch: Partial<WorkflowEdge>) => {
    onChange({
      ...workflow,
      status: 'draft',
      edges: workflow.edges.map((edge) => edge.edgeId === edgeId ? { ...edge, ...patch } : edge),
    });
  };

  const deleteEdge = (edgeId: string) => {
    setSelectedEdgeId(null);
    onChange({ ...workflow, status: 'draft', edges: workflow.edges.filter((edge) => edge.edgeId !== edgeId) });
  };

  const insertOperatorOnEdge = (edge: WorkflowEdge, type: Exclude<WorkflowNodeType, 'agent' | 'review' | 'reduce' | 'join'>) => {
    const nodeId = `${type}:${crypto.randomUUID()}`;
    const base = { nodeId, type, name: workflowNodeLabels[type] };
    const operator: WorkflowNode = type === 'gate'
      ? { ...base, type, gateKind: 'completion' }
      : type === 'fan_out'
        ? { ...base, type, concurrency: Math.min(4, workflow.policy.maxConcurrency) }
        : type === 'loop'
          ? { ...base, type, bodyNodeIds: [edge.toNodeId], repeatCount: 2 }
          : { ...base, type, prompt: '请确认是否继续执行后续节点。' };
    const nextEdges: WorkflowEdge[] = [
      { edgeId: crypto.randomUUID(), fromNodeId: edge.fromNodeId, toNodeId: nodeId, kind: edge.kind },
      { edgeId: crypto.randomUUID(), fromNodeId: nodeId, toNodeId: edge.toNodeId, kind: edge.kind },
    ];
    const nextNodes: WorkflowNode[] = [operator];
    if (type === 'fan_out') {
      const joinId = `join:${crypto.randomUUID()}`;
      nextNodes.push({ nodeId: joinId, type: 'join', name: 'Join', mode: 'all' });
      nextEdges.push({ edgeId: crypto.randomUUID(), fromNodeId: edge.toNodeId, toNodeId: joinId, kind: edge.kind });
    }
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    onChange({
      ...workflow,
      status: 'draft',
      nodes: [...workflow.nodes, ...nextNodes],
      edges: [...workflow.edges.filter((item) => item.edgeId !== edge.edgeId), ...nextEdges],
    });
  };

  const removeNode = (nodeId: string) => {
    const node = workflow.nodes.find((item) => item.nodeId === nodeId);
    if (!node || node.type === 'agent' || node.type === 'review' || node.type === 'reduce') return;
    const nextNodes = workflow.nodes.filter((item) => item.nodeId !== nodeId);
    setSelectedNodeId(nextNodes[0]?.nodeId ?? '');
    onChange({
      ...workflow,
      status: 'draft',
      nodes: nextNodes,
      edges: workflow.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId),
    });
  };

  useEffect(() => {
    if (!connectFromNodeId && !selectedEdgeId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setConnectFromNodeId(null);
      setSelectedEdgeId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [connectFromNodeId, selectedEdgeId]);

  const submitAiAgent = async () => {
    const prompt = aiAgentPrompt.trim();
    if (!prompt) return;
    setAddingAgent(true);
    try {
      await onAiCreateAgent(`请为当前集群新增一个子 Agent，并给出推荐连线/Workflow 修改提案：${prompt}`);
      setAiAgentPrompt('');
      setAddAgentMode('closed');
    } finally {
      setAddingAgent(false);
    }
  };

  const submitManualAgent = async () => {
    const name = manualAgentDraft.name.trim();
    const role = manualAgentDraft.role.trim();
    if (!name || !role) return;
    setAddingAgent(true);
    try {
      await onManualCreateAgent({
        ...manualAgentDraft,
        name,
        role,
        description: manualAgentDraft.description?.trim(),
        systemPrompt: manualAgentDraft.systemPrompt?.trim(),
      });
      setManualAgentDraft({
        name: '',
        role: '',
        description: '',
        systemPrompt: '',
        tools: [],
        capabilities: [],
      });
      setAddAgentMode('closed');
    } finally {
      setAddingAgent(false);
    }
  };

  return (
    <section data-testid="agent-cluster-workflow-editor" className="soft-panel min-w-0 overflow-hidden rounded-xl p-4">
      <div className="grid min-w-0 gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <h2 className="min-w-0 truncate text-sm font-semibold">{label} v{workflow.version}</h2>
            <Badge variant={workflow.status === 'confirmed' ? 'secondary' : 'outline'}>{workflow.status === 'confirmed' ? '已确认' : '草稿'}</Badge>
            <Badge variant="outline">最大并发 {workflow.policy.maxConcurrency}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">模型负责节点任务；Harness 负责并行、汇合、门禁、重试与恢复。</p>
        </div>
      </div>

      {editing ? (
        <div className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[180px_minmax(0,1fr)_280px]">
          <aside className="soft-row min-w-0 rounded-xl p-3 2xl:order-none">
            <div className="text-xs font-semibold">组件库</div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              点击添加 Harness 算子；新增业务 Agent 建议通过 Cluster Manager 提案生成。
            </p>
            <div className="mt-3 space-y-2">
              <div className="rounded-lg border border-dashed border-border/80 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium">添加子 Agent</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">AI 提案或手动创建</div>
                  </div>
                  <Plus className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAddAgentMode(addAgentMode === 'ai' ? 'closed' : 'ai')}>
                    AI 生成
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAddAgentMode(addAgentMode === 'manual' ? 'closed' : 'manual')}>
                    手动创建
                  </Button>
                </div>
                {addAgentMode === 'ai' && (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      className="min-h-20 resize-y text-xs"
                      value={aiAgentPrompt}
                      onChange={(event) => setAiAgentPrompt(event.target.value)}
                      placeholder="描述新 Agent 的职责、输入和输出，例如：新增一个审查因子重复度的 Agent。"
                    />
                    <Button type="button" size="sm" className="h-8 w-full text-xs" disabled={!aiAgentPrompt.trim() || addingAgent} onClick={() => void submitAiAgent()}>
                      {addingAgent && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      生成提案
                    </Button>
                  </div>
                )}
                {addAgentMode === 'manual' && (
                  <div className="mt-2 space-y-2">
                    <Input
                      className="h-8 text-xs"
                      value={manualAgentDraft.name}
                      onChange={(event) => setManualAgentDraft((value) => ({ ...value, name: event.target.value }))}
                      placeholder="Agent 名称"
                    />
                    <Input
                      className="h-8 text-xs"
                      value={manualAgentDraft.role}
                      onChange={(event) => setManualAgentDraft((value) => ({ ...value, role: event.target.value }))}
                      placeholder="角色"
                    />
                    <Textarea
                      className="min-h-16 resize-y text-xs"
                      value={manualAgentDraft.description}
                      onChange={(event) => setManualAgentDraft((value) => ({ ...value, description: event.target.value }))}
                      placeholder="职责描述"
                    />
                    <Textarea
                      className="min-h-20 resize-y text-xs"
                      value={manualAgentDraft.systemPrompt}
                      onChange={(event) => setManualAgentDraft((value) => ({ ...value, systemPrompt: event.target.value }))}
                      placeholder="可选：system prompt"
                    />
                    <Button type="button" size="sm" className="h-8 w-full text-xs" disabled={!manualAgentDraft.name.trim() || !manualAgentDraft.role.trim() || addingAgent} onClick={() => void submitManualAgent()}>
                      {addingAgent && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      创建并生成草稿
                    </Button>
                  </div>
                )}
              </div>
              {(['gate', 'loop', 'fan_out', 'join', 'human_gate'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-left text-xs shadow-sm transition-shadow hover:shadow-md"
                  onClick={() => addOperator(type)}
                >
                  <span className="font-medium">{workflowNodeLabels[type]}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{operatorDescriptions[type]}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0 rounded-xl border border-border/70 bg-card/45 p-4 2xl:order-none">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold">流程画布</div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  点击节点触点开始连线；点击连线后可在右侧插入 Gate、Fan-out、Loop 或 Human Gate。
                </p>
              </div>
              <div className="flex items-center gap-2">
                {connectFromNodeId && <Badge variant="secondary">正在连线：{workflow.nodes.find((node) => node.nodeId === connectFromNodeId)?.name ?? connectFromNodeId}</Badge>}
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onChange({ ...clearWorkflowNodePositions(workflow), status: 'draft' })}>
                  自动整理
                </Button>
                <Badge variant="outline">{workflow.nodes.length} 节点</Badge>
              </div>
            </div>
            <WorkflowOverview
              workflow={workflow}
              run={run}
              selectedNodeId={selectedNode?.nodeId}
              onSelectNode={(nodeId) => {
                setSelectedNodeId(nodeId);
                setSelectedEdgeId(null);
              }}
              selectedEdgeId={selectedEdgeId}
              onSelectEdge={(edgeId) => {
                setSelectedEdgeId(edgeId);
                setConnectFromNodeId(null);
              }}
              connectFromNodeId={connectFromNodeId}
              onHandleClick={handleCanvasHandleClick}
              onCancelConnect={() => setConnectFromNodeId(null)}
              onNodePositionChange={(nodeId, position) => updateNode(nodeId, position)}
            />
          </div>

          <aside className="soft-row min-w-0 rounded-xl p-3 2xl:order-none">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-semibold">属性</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {selectedEdge ? '连接' : selectedNode ? workflowNodeLabels[selectedNode.type] : '未选择节点'}
                </div>
              </div>
              {!selectedEdge && selectedNode && selectedNode.type !== 'agent' && selectedNode.type !== 'review' && selectedNode.type !== 'reduce' && (
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeNode(selectedNode.nodeId)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            {selectedEdge ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-border/70 p-3 text-xs">
                  <div className="font-medium">
                    {workflow.nodes.find((node) => node.nodeId === selectedEdge.fromNodeId)?.name ?? selectedEdge.fromNodeId}
                  </div>
                  <ArrowRight className="my-2 h-4 w-4 text-muted-foreground" />
                  <div className="font-medium">
                    {workflow.nodes.find((node) => node.nodeId === selectedEdge.toNodeId)?.name ?? selectedEdge.toNodeId}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">连接类型</label>
                  <select
                    className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={selectedEdge.kind}
                    onChange={(event) => updateEdge(selectedEdge.edgeId, { kind: event.target.value as WorkflowEdge['kind'] })}
                  >
                    <option value="control">control · 控制顺序</option>
                    <option value="data">data · 上下文/数据</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">激活条件</label>
                  <select
                    className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={selectedEdge.condition ?? 'always'}
                    onChange={(event) => updateEdge(selectedEdge.edgeId, { condition: event.target.value as WorkflowEdge['condition'] })}
                  >
                    <option value="always">always · 默认通过</option>
                    <option value="on_pass">on_pass · 上游通过</option>
                    <option value="on_fail">on_fail · 上游失败</option>
                    <option value="on_revise">on_revise · 要求修订</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">连接标签</label>
                  <Input className="mt-1 h-8 text-xs" value={selectedEdge.label ?? ''} onChange={(event) => updateEdge(selectedEdge.edgeId, { label: event.target.value || undefined })} />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">dataMapping JSON</label>
                  <Textarea
                    className="mt-1 min-h-20 resize-y font-mono text-xs"
                    value={JSON.stringify(selectedEdge.dataMapping ?? [], null, 2)}
                    onChange={(event) => {
                      try {
                        const value = JSON.parse(event.target.value) as unknown;
                        if (Array.isArray(value)) updateEdge(selectedEdge.edgeId, { dataMapping: value as WorkflowEdge['dataMapping'] });
                      } catch {
                        // Keep editing locally until JSON becomes valid.
                      }
                    }}
                    placeholder='[{"source":"output.artifacts","target":"inputs.artifacts"}]'
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-muted-foreground">在线上插入算子</div>
                  {(['gate', 'fan_out', 'loop', 'human_gate'] as const).map((type) => (
                    <Button key={type} type="button" variant="outline" size="sm" className="h-8 w-full justify-start text-xs" onClick={() => insertOperatorOnEdge(selectedEdge, type)}>
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      插入 {workflowNodeLabels[type]}
                    </Button>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-full text-destructive" onClick={() => deleteEdge(selectedEdge.edgeId)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除连接
                </Button>
              </div>
            ) : selectedNode ? (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">名称</label>
                  <Input className="mt-1 h-8 text-xs" value={selectedNode.name} onChange={(event) => updateNode(selectedNode.nodeId, { name: event.target.value })} />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">说明</label>
                  <Textarea className="mt-1 min-h-20 resize-y text-xs" value={selectedNode.description ?? ''} onChange={(event) => updateNode(selectedNode.nodeId, { description: event.target.value })} />
                </div>

                {(selectedNode.type === 'agent' || selectedNode.type === 'review' || selectedNode.type === 'reduce') && (
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">Agent 节点类型</label>
                    <select
                      className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={selectedNode.type}
                      onChange={(event) => updateNode(selectedNode.nodeId, { type: event.target.value as 'agent' | 'review' | 'reduce' })}
                    >
                      <option value="agent">Agent</option>
                      <option value="review">Review Agent</option>
                      <option value="reduce">Reduce Agent</option>
                    </select>
                  </div>
                )}

                {selectedNode.type === 'fan_out' && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">最大并发</label>
                      <Input className="mt-1 h-8" type="number" min={1} max={16} value={selectedNode.concurrency} onChange={(event) => updateNode(selectedNode.nodeId, { concurrency: Number(event.target.value) } as Partial<WorkflowNode>)} />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">Fan-out 模式</label>
                      <select
                        className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={selectedNode.fanOutMode ?? 'fixed'}
                        onChange={(event) => updateNode(selectedNode.nodeId, { fanOutMode: event.target.value as 'fixed' | 'from_output' } as Partial<WorkflowNode>)}
                      >
                        <option value="fixed">fixed · 固定分支</option>
                        <option value="from_output">from_output · 从上游数组展开</option>
                      </select>
                    </div>
                    {selectedNode.fanOutMode === 'from_output' && (
                      <>
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground">数组路径</label>
                          <Input className="mt-1 h-8 text-xs" value={selectedNode.itemsPath ?? ''} onChange={(event) => updateNode(selectedNode.nodeId, { itemsPath: event.target.value } as Partial<WorkflowNode>)} placeholder="node.planner.output.items 或 output.items" />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground">注入变量名</label>
                          <Input className="mt-1 h-8 text-xs" value={selectedNode.itemInputName ?? ''} onChange={(event) => updateNode(selectedNode.nodeId, { itemInputName: event.target.value } as Partial<WorkflowNode>)} placeholder="item" />
                        </div>
                      </>
                    )}
                    <div className="space-y-1 rounded-md border border-border/70 p-2">
                      <div className="mb-1 text-[11px] text-muted-foreground">并行分支</div>
                      {workflow.nodes.filter((item) => item.type === 'agent' || item.type === 'review' || item.type === 'reduce').map((item) => {
                        const checked = workflow.edges.some((edge) => edge.fromNodeId === selectedNode.nodeId && edge.toNodeId === item.nodeId);
                        return (
                          <label key={item.nodeId} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  addEdgeBetween(selectedNode.nodeId, item.nodeId);
                                } else {
                                  onChange({
                                    ...workflow,
                                    status: 'draft',
                                    edges: workflow.edges.filter((edge) => !(edge.fromNodeId === selectedNode.nodeId && edge.toNodeId === item.nodeId)),
                                  });
                                }
                              }}
                            />
                            <span className="truncate">{item.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedNode.type === 'join' && (
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground">汇合策略</label>
                    <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={selectedNode.mode} onChange={(event) => updateNode(selectedNode.nodeId, { mode: event.target.value as 'all' | 'minimum' } as Partial<WorkflowNode>)}>
                      <option value="all">等待全部成功</option>
                      <option value="minimum">达到最少成功数</option>
                    </select>
                    {selectedNode.mode === 'minimum' && (
                      <Input className="h-8" type="number" min={1} value={selectedNode.minimumSuccess ?? 1} onChange={(event) => updateNode(selectedNode.nodeId, { minimumSuccess: Number(event.target.value) } as Partial<WorkflowNode>)} />
                    )}
                  </div>
                )}

                {selectedNode.type === 'gate' && (
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground">Gate 类型</label>
                    <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={selectedNode.gateKind} onChange={(event) => updateNode(selectedNode.nodeId, { gateKind: event.target.value as WorkflowGateKind } as Partial<WorkflowNode>)}>
                      <option value="completion">完成状态</option>
                      <option value="artifact">产物存在</option>
                      <option value="count">数量门槛</option>
                      <option value="schema">Schema 必填字段</option>
                      <option value="llm">LLM 语义判定</option>
                    </select>
                    {selectedNode.gateKind === 'count' && (
                      <Input className="h-8" type="number" min={1} value={selectedNode.minimumCount ?? 1} onChange={(event) => updateNode(selectedNode.nodeId, { minimumCount: Number(event.target.value) } as Partial<WorkflowNode>)} />
                    )}
                    {selectedNode.gateKind === 'artifact' && (
                      <Input
                        className="h-8"
                        value={selectedNode.inputContract?.requiredArtifacts?.join(', ') ?? ''}
                        placeholder="必需产物，逗号分隔"
                        onChange={(event) => updateNode(selectedNode.nodeId, {
                          inputContract: {
                            ...selectedNode.inputContract,
                            requiredArtifacts: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                          },
                        })}
                      />
                    )}
                    {selectedNode.gateKind === 'schema' && (
                      <Input
                        className="h-8"
                        value={Array.isArray(selectedNode.inputContract?.schema?.required) ? selectedNode.inputContract?.schema?.required.join(', ') : ''}
                        placeholder="必填输出字段，逗号分隔"
                        onChange={(event) => updateNode(selectedNode.nodeId, {
                          inputContract: {
                            ...selectedNode.inputContract,
                            schema: {
                              type: 'object',
                              required: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                            },
                          },
                        })}
                      />
                    )}
                    {selectedNode.gateKind === 'llm' && (
                      <div className="space-y-2">
                        <Textarea
                          className="min-h-24 resize-y text-xs"
                          value={selectedNode.evaluationPrompt ?? ''}
                          placeholder="写清楚这个 Gate 应该如何判定 pass / fail / revise。Harness 会要求模型只返回结构化 JSON。"
                          onChange={(event) => updateNode(selectedNode.nodeId, { evaluationPrompt: event.target.value } as Partial<WorkflowNode>)}
                        />
                        <Input
                          className="h-8"
                          value={selectedNode.modelId ?? ''}
                          placeholder="可选：指定模型；留空使用当前基模"
                          onChange={(event) => updateNode(selectedNode.nodeId, { modelId: event.target.value } as Partial<WorkflowNode>)}
                        />
                        {selectedNode.lastEvaluation && (
                          <div className="rounded-md border border-border/70 bg-card/50 p-2 text-[11px] leading-5 text-muted-foreground">
                            最近判定：{selectedNode.lastEvaluation.verdict} · {selectedNode.lastEvaluation.reason}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedNode.type === 'loop' && (
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground">重复次数</label>
                    <Input className="h-8" type="number" min={1} max={20} value={selectedNode.repeatCount} onChange={(event) => updateNode(selectedNode.nodeId, { repeatCount: Number(event.target.value) } as Partial<WorkflowNode>)} />
                    <div className="space-y-1 rounded-md border border-border/70 p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[11px] text-muted-foreground">循环体节点</div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => updateNode(selectedNode.nodeId, {
                            bodyNodeIds: getOrderedWorkflowLoopBodyNodeIds(workflow, selectedNode),
                          } as Partial<WorkflowNode>)}
                        >
                          按控制链排序
                        </Button>
                      </div>
                      {selectedNode.bodyNodeIds.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {selectedNode.bodyNodeIds.map((nodeId, index) => {
                            const node = workflow.nodes.find((item) => item.nodeId === nodeId);
                            return (
                              <span
                                key={nodeId}
                                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1 text-[10px] font-medium"
                                title={node?.name ?? nodeId}
                              >
                                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground text-[9px] text-background">
                                  {index + 1}
                                </span>
                                <span className="max-w-28 truncate">{node?.name ?? nodeId}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {workflow.nodes.filter((item) => item.type === 'agent' || item.type === 'review' || item.type === 'reduce').map((item) => (
                        <label key={item.nodeId} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={selectedNode.bodyNodeIds.includes(item.nodeId)}
                            onChange={(event) => updateNode(selectedNode.nodeId, {
                              bodyNodeIds: event.target.checked
                                ? [...selectedNode.bodyNodeIds, item.nodeId]
                                : selectedNode.bodyNodeIds.filter((nodeId) => nodeId !== item.nodeId),
                            } as Partial<WorkflowNode>)}
                          />
                          <span className="truncate">{item.name}</span>
                        </label>
                      ))}
                      <p className="pt-1 text-[10px] leading-4 text-muted-foreground">
                        数字显示当前保存顺序；实际运行会按控制链推导顺序，排序按钮可把显示顺序同步为真实链路。
                      </p>
                    </div>
                  </div>
                )}

                {selectedNode.type === 'human_gate' && (
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">用户确认提示</label>
                    <Textarea className="mt-1 min-h-24 resize-y text-xs" value={selectedNode.prompt} onChange={(event) => updateNode(selectedNode.nodeId, { prompt: event.target.value } as Partial<WorkflowNode>)} />
                  </div>
                )}

                {selectedNode.type === 'review' && (
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">退回目标</label>
                    <select
                      className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={selectedNode.reviseTargetNodeId ?? ''}
                      onChange={(event) => updateNode(selectedNode.nodeId, { reviseTargetNodeId: event.target.value || undefined })}
                    >
                      <option value="">仅给出审查结论</option>
                      {workflow.nodes.filter((item) => item.nodeId !== selectedNode.nodeId && (item.type === 'agent' || item.type === 'reduce')).map((item) => (
                        <option key={item.nodeId} value={item.nodeId}>退回：{item.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-border/80 p-4 text-xs text-muted-foreground">
                从画布中选择一个节点查看配置。
              </div>
            )}
          </aside>
        </div>
      ) : (
        <WorkflowOverview workflow={workflow} run={run} />
      )}
    </section>
  );
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
  const abortCreation = useAgentClusterStore((state) => state.abortCreation);
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
            {creating && (
              <Button type="button" variant="outline" className="mr-2" onClick={() => void abortCreation()}>
                <Square className="mr-2 h-4 w-4" />
                终止
              </Button>
            )}
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

type ConversationTimelineItem =
  | { kind: 'message'; id: string; createdAt: string; message: AgentMessage }
  | { kind: 'output'; id: string; createdAt: string; output: { content: string; createdAt: string } }
  | { kind: 'event'; id: string; createdAt: string; event: AgentClusterEvent }
  | { kind: 'tool-summary'; id: string; createdAt: string; count: number; events: AgentClusterEvent[] };

function eventIsToolActivity(event: AgentClusterEvent): boolean {
  const content = event.content.trim();
  return event.title === '工具事件'
    || event.title.startsWith('工具执行')
    || (event.title === '子会话输出' && /调用工具：/u.test(content))
    || /调用工具：(exec|write|read|process|python|shell|bash)/u.test(content);
}

function eventIsLowValue(event: AgentClusterEvent): boolean {
  const content = event.content.trim();
  if (event.display === 'silent') return true;
  if (event.title === '子会话活动' || content === 'Agent 子会话正在运行') return true;
  if (event.title === '产物已发现') return true;
  if (event.title === '产物状态已校准' && event.level !== 'error') return true;
  if (event.title === '读取子会话历史失败' && /chat\.history|RPC timeout/i.test(content)) return true;
  if (eventIsToolActivity(event)) return true;
  return false;
}

function eventIsImportant(event: AgentClusterEvent): boolean {
  if (event.level === 'error') return true;
  return /产物校验失败|缺产物结束|子会话出错|failed|LLM Gate|Human Gate|等待人工确认|未通过|要求修订/u.test(`${event.title}\n${event.content}`);
}

function buildConversationTimeline(params: {
  messages: AgentMessage[];
  outputs: Array<{ outputId: string; content: string; createdAt: string }>;
  events: AgentClusterEvent[];
}): ConversationTimelineItem[] {
  const toolEvents: AgentClusterEvent[] = [];
  const items: ConversationTimelineItem[] = [
    ...params.messages.map((message) => ({
      kind: 'message' as const,
      id: message.messageId,
      createdAt: message.createdAt,
      message,
    })),
    ...params.outputs.map((output) => ({
      kind: 'output' as const,
      id: output.outputId,
      createdAt: output.createdAt,
      output,
    })),
  ];
  for (const event of params.events) {
    if (eventIsToolActivity(event)) {
      toolEvents.push(event);
      continue;
    }
    if (eventIsLowValue(event) && !eventIsImportant(event)) continue;
    items.push({
      kind: 'event',
      id: event.eventId,
      createdAt: event.createdAt,
      event,
    });
  }
  if (toolEvents.length > 0) {
    const latest = [...toolEvents].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)!;
    items.push({
      kind: 'tool-summary',
      id: `tool-summary-${latest.eventId}`,
      createdAt: latest.createdAt,
      count: toolEvents.length,
      events: toolEvents.slice(-20),
    });
  }
  return items
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-80);
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
        {(proposal.agentPromptUpdates?.length ?? 0) > 0 && <Badge variant="secondary">同步 Prompt {proposal.agentPromptUpdates?.length}</Badge>}
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
          {(proposal.agentPromptUpdates ?? []).map((update) => (
            <div key={`${proposal.proposalId}-sync-${update.targetAgentId}`}>
              <span className="font-medium">同步：</span>{update.targetAgentName ?? update.name} · {update.role}
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
  const abortManagerMessage = useAgentClusterStore((state) => state.abortManagerMessage);
  const resetCurrentTaskContext = useAgentClusterStore((state) => state.resetCurrentTaskContext);
  const syncProjectPrompts = useAgentClusterStore((state) => state.syncProjectPrompts);
  const sending = useAgentClusterStore((state) => state.sending);
  const managerRequestId = useAgentClusterStore((state) => state.managerRequestId);
  const error = useAgentClusterStore((state) => state.error);
  const selectedBaseModel = useBaseModelStore((state) => state.selectedModel);
  const [managerMode, setManagerMode] = useState<ClusterManagerMode>('plan');
  const [input, setInput] = useState('');
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const visibleMessages = useMemo(() => (selectedAgent
    ? cluster.messages.filter((message) =>
        message.targetAgentId === selectedAgent.agentId
        || message.senderAgentId === selectedAgent.agentId
      )
    : cluster.messages.filter((message) => message.targetType === 'cluster' && message.visibility === 'public')).slice(-40), [cluster.messages, selectedAgent]);
  const agentOutputs = useMemo(() => (selectedAgent?.localContext.outputs ?? []).slice(-12), [selectedAgent?.localContext.outputs]);
  const scopedEvents = useMemo(() => (cluster.events ?? [])
    .filter((event) => (selectedAgent ? event.agentId === selectedAgent.agentId : !event.agentId))
    .slice(0, 120), [cluster.events, selectedAgent]);
  const timelineItems = useMemo(() => buildConversationTimeline({
    messages: visibleMessages,
    outputs: agentOutputs,
    events: scopedEvents,
  }), [agentOutputs, scopedEvents, visibleMessages]);
  const pendingProposals = useMemo(() => (selectedAgent
    ? []
    : (cluster.sharedContext.managerProposals ?? []).filter((proposal) => proposal.status === 'pending')), [cluster.sharedContext.managerProposals, selectedAgent]);
  const activeRun = cluster.runs?.find((run) => run.runId === cluster.activeRunId) ?? null;
  const selectedChildRun = selectedAgent && activeRun
    ? activeRun.childRuns.find((child) => child.agentId === selectedAgent.agentId) ?? null
    : null;
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ block: 'end' });
  }, [timelineItems.length, selectedAgent?.agentId]);
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    const mentionedAgentId = selectedAgent ? null : getSelectedAgentNameFromInput(content, cluster);
    try {
      if (!selectedAgent && !mentionedAgentId) {
        await sendManagerMessage(cluster.clusterId, { content, interactionMode: managerMode, baseModel: selectedBaseModel });
      } else {
        await sendMessage(cluster.clusterId, {
          content,
          targetAgentId: selectedAgent?.agentId ?? mentionedAgentId,
        });
      }
      setInput('');
    } catch {
      // Aborted Manager generations keep the draft text so the user can edit and resend.
    }
  };

  return (
    <aside data-testid="agent-cluster-conversation" className="zone-cluster soft-panel flex h-full min-h-0 flex-col overflow-hidden rounded-xl">
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <span className="zone-dot h-2.5 w-2.5 rounded-full" />
          {selectedAgent ? <Bot className="h-4 w-4 zone-icon" /> : <MessageSquare className="h-4 w-4 zone-icon" />}
          <h2 className="text-sm font-semibold">{selectedAgent ? selectedAgent.name : 'Cluster Manager'}</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedAgent ? '定向消息进入该 Agent 的本地上下文。' : '默认由 Cluster Manager 解析你的自然语言改动，并写入 prompt patch / 调度决策。'}
        </p>
        {!selectedAgent && (
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="soft-row inline-flex items-center rounded-full p-1">
              {([
                ['ask', '问答'],
                ['plan', '规划'],
                ['review', '审查'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setManagerMode(mode)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-shadow hover:shadow-sm',
                    managerMode === mode ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const confirmed = window.confirm('清理本轮运行上下文？这不会删除项目磁盘产物，也不会改变 Agent 定义和已确认 Workflow。');
                if (confirmed) void resetCurrentTaskContext(cluster.clusterId);
              }}
              disabled={Boolean(cluster.activeRunId)}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              开始新任务
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void syncProjectPrompts(cluster.clusterId)}
              disabled={Boolean(cluster.activeRunId)}
            >
              <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              同步项目 Prompt
            </Button>
            {sending && managerRequestId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void abortManagerMessage(cluster.clusterId)}
              >
                <Square className="mr-2 h-3.5 w-3.5" />
                终止生成
              </Button>
            )}
          </div>
        )}
        {activeRun && (
          <div className="tinted-panel mt-3 rounded-lg px-3 py-2 text-xs">
            {selectedChildRun
              ? `${selectedAgent?.name}：${selectedChildRun.status}，${selectedChildRun.submitStatus ?? 'pending'}，正在等待 Gateway 事件或读取子会话历史。`
              : `集群运行中：正在等待 Gateway 事件并定期读取 ${activeRun.childRuns.length} 个子会话历史。`}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto bg-card/35 p-4">
        {pendingProposals.map((proposal) => (
          <ManagerProposalCard key={proposal.proposalId} proposal={proposal} cluster={cluster} />
        ))}
        {timelineItems.length === 0 && pendingProposals.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无消息
          </div>
        ) : (
          <>
            {timelineItems.map((item) => {
              if (item.kind === 'message') {
                const message = item.message;
                return (
                  <div key={item.id} className={cn('rounded-lg border px-3 py-2 text-sm leading-6', messageTone(message))}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px] opacity-70">
                      <span>{message.senderType === 'user' ? '用户' : message.senderType}</span>
                      <span title={formatExactTime(message.createdAt)}>{formatTime(message.createdAt)}</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  </div>
                );
              }
              if (item.kind === 'output') {
                return (
                  <details key={item.id} className="rounded-lg border border-border/70 bg-card/55 px-3 py-2 text-sm leading-6">
                    <summary className="cursor-pointer list-none">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Agent 输出</span>
                        <span title={formatExactTime(item.output.createdAt)}>{formatTime(item.output.createdAt)}</span>
                      </div>
                      <div className="line-clamp-5 whitespace-pre-wrap break-words">{item.output.content}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">点击展开完整输出</div>
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap break-words border-t pt-2">{item.output.content}</div>
                  </details>
                );
              }
              if (item.kind === 'tool-summary') {
                return (
                  <details key={item.id} className="soft-row rounded-lg px-3 py-2 text-sm leading-6">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      工具活动 {item.count} 次 · <span title={formatExactTime(item.createdAt)}>{formatTime(item.createdAt)}</span>
                    </summary>
                    <div className="mt-2 space-y-2 border-t pt-2">
                      {item.events.map((event) => (
                        <div key={event.eventId} className="text-xs text-muted-foreground">
                          <span title={formatExactTime(event.createdAt)}>{formatTime(event.createdAt)}</span>
                          <span className="mx-1">·</span>
                          <span>{event.title}</span>
                          <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words">{event.content}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              }
              const event = item.event;
              return (
                <div key={item.id} className={cn(
                  'rounded-lg px-3 py-2 text-sm leading-6',
                  event.level === 'success' && 'bg-emerald-500/5',
                  event.level === 'error' && 'bg-destructive/10 text-destructive',
                  event.level !== 'success' && event.level !== 'error' && 'soft-row',
                )}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] opacity-70">
                    <span>{event.title}</span>
                    <span title={formatExactTime(event.createdAt)}>{formatTime(event.createdAt)}</span>
                  </div>
                  <div className="line-clamp-6 whitespace-pre-wrap break-words">{event.content}</div>
                </div>
              );
            })}
            <div ref={timelineEndRef} />
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
    <aside data-testid="agent-cluster-agent-rail" className="zone-cluster soft-panel flex h-full min-h-0 flex-col overflow-hidden rounded-xl p-3">
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
  const saveWorkflow = useAgentClusterStore((state) => state.saveWorkflow);
  const confirmWorkflow = useAgentClusterStore((state) => state.confirmWorkflow);
  const rollbackWorkflow = useAgentClusterStore((state) => state.rollbackWorkflow);
  const saveWorkflowScript = useAgentClusterStore((state) => state.saveWorkflowScript);
  const confirmWorkflowScript = useAgentClusterStore((state) => state.confirmWorkflowScript);
  const selectFreezeFolder = useAgentClusterStore((state) => state.selectFreezeFolder);
  const freezeCluster = useAgentClusterStore((state) => state.freezeCluster);
  const startRun = useAgentClusterStore((state) => state.startRun);
  const pauseRun = useAgentClusterStore((state) => state.pauseRun);
  const resumeRun = useAgentClusterStore((state) => state.resumeRun);
  const stopRun = useAgentClusterStore((state) => state.stopRun);
  const decideHumanGate = useAgentClusterStore((state) => state.decideHumanGate);
  const refreshRunEvents = useAgentClusterStore((state) => state.refreshRunEvents);
  const resetRun = useAgentClusterStore((state) => state.resetRun);
  const resumeRunFromAgent = useAgentClusterStore((state) => state.resumeRunFromAgent);
  const retryRunAgent = useAgentClusterStore((state) => state.retryRunAgent);
  const skipRunAgent = useAgentClusterStore((state) => state.skipRunAgent);
  const createAgent = useAgentClusterStore((state) => state.createAgent);
  const sendManagerMessage = useAgentClusterStore((state) => state.sendManagerMessage);
  const selectedBaseModel = useBaseModelStore((state) => state.selectedModel);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(cluster.clusterName);
  const [editingGraph, setEditingGraph] = useState(false);
  const [draftGraph, setDraftGraph] = useState<AgentClusterExecutionGraph>(() => getClusterExecutionGraph(cluster));
  const [legacyGraphDirty, setLegacyGraphDirty] = useState(false);
  const currentWorkflow = getCurrentWorkflow(cluster);
  const projectDirectoryMode = cluster.runtimeMode === 'project_directory'
    || (!cluster.runtimeMode && Boolean(cluster.sourceFolderPath));
  const runtimeModeLabel = projectDirectoryMode ? '项目原生执行' : '动态 Harness 模式';
  const workflowDisplayLabel = projectDirectoryMode ? '执行链路' : 'Workflow';
  const [draftWorkflow, setDraftWorkflow] = useState<AgentClusterWorkflow | null>(() => currentWorkflow ? structuredClone(currentWorkflow) : null);
  const [leftPaneWidth, setLeftPaneWidth] = useState(260);
  const [rightPaneWidth, setRightPaneWidth] = useState(420);
  const [showLegacyGraph, setShowLegacyGraph] = useState(false);
  const [centerTab, setCenterTab] = useState<AgentClusterCenterTab>('monitor');
  const [runArgsDraft, setRunArgsDraft] = useState('{}');
  const [scriptDraft, setScriptDraft] = useState(cluster.workflowScript?.source ?? '');
  const shouldShowWorkflowScriptPanel = Boolean(cluster.workflowScript)
    && (!projectDirectoryMode || cluster.workflowScript?.sourceType === 'project');
  const [showWorkflowScriptPanel, setShowWorkflowScriptPanel] = useState(shouldShowWorkflowScriptPanel);
  const [freezeExportPath, setFreezeExportPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedAgent = cluster.agents.find((agent) => agent.agentId === selectedAgentId) ?? null;
  const executionGraph = getClusterExecutionGraph(cluster);
  const workflowScriptConfirmed = Boolean(cluster.workflowScript?.confirmedAt);
  const orchestrationConfirmed = currentWorkflow?.status === 'confirmed' || workflowScriptConfirmed;
  const activeRun = cluster.runs?.find((run) => run.runId === cluster.activeRunId) ?? null;
  const runningCount = activeRun?.childRuns.filter((child) => child.status === 'running' || child.status === 'starting').length ?? 0;
  const blockedCount = activeRun?.childRuns.filter((child) => child.status === 'blocked').length ?? 0;
  const latestRun = activeRun ?? cluster.runs?.[0] ?? null;
  const completedCount = latestRun?.completedChildCount ?? latestRun?.childRuns.filter((child) => child.status === 'completed').length ?? 0;
  const failedCount = latestRun?.failedChildCount ?? latestRun?.childRuns.filter((child) => child.status === 'error' || child.status === 'timeout').length ?? 0;
  const latestEvent = cluster.events?.[0] ?? null;
  const canControlLatestRun = Boolean(latestRun);
  const waitingHumanNodes = latestRun?.nodeRuns?.filter((nodeRun) => nodeRun.status === 'waiting_human') ?? [];
  const phaseProgress = useMemo(() => buildPhaseProgress(latestRun), [latestRun]);
  const runStats = phaseProgress[0] ?? null;
  const runDurationTooltip = latestRun ? buildAgentDurationTooltip(cluster, latestRun) : undefined;

  useEffect(() => {
    setScriptDraft(cluster.workflowScript?.source ?? '');
    setShowWorkflowScriptPanel(shouldShowWorkflowScriptPanel);
    setFreezeExportPath(null);
  }, [cluster.clusterId, cluster.workflowScript?.hash, cluster.workflowScript?.source, shouldShowWorkflowScriptPanel]);

  const startResize = (pane: 'left' | 'right', startEvent: ReactMouseEvent<HTMLDivElement>) => {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startLeft = leftPaneWidth;
    const startRight = rightPaneWidth;
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      const container = containerRef.current;
      if (!container) return;
      if (pane === 'left') {
        container.style.setProperty('--agent-cluster-left-pane', `${clamp(startLeft + delta, 220, 360)}px`);
      } else {
        container.style.setProperty('--agent-cluster-right-pane', `${clamp(startRight - delta, 320, 560)}px`);
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const delta = event.clientX - startX;
      if (pane === 'left') {
        setLeftPaneWidth(clamp(startLeft + delta, 220, 360));
      } else {
        setRightPaneWidth(clamp(startRight - delta, 320, 560));
      }
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const submitRename = async () => {
    const next = nameDraft.trim();
    if (next && next !== cluster.clusterName) {
      await renameCluster(cluster.clusterId, next);
    }
    setEditingName(false);
  };

  const saveGraph = async () => {
    if (legacyGraphDirty) await saveExecutionGraph(cluster.clusterId, draftGraph);
    if (draftWorkflow) await saveWorkflow(cluster.clusterId, draftWorkflow);
    setLegacyGraphDirty(false);
    setEditingGraph(false);
  };

  const confirmGraph = async () => {
    const graphToConfirm = editingGraph ? draftGraph : executionGraph;
    if (editingGraph) {
      if (legacyGraphDirty) await saveExecutionGraph(cluster.clusterId, graphToConfirm);
      if (draftWorkflow) await saveWorkflow(cluster.clusterId, draftWorkflow);
      setLegacyGraphDirty(false);
      setEditingGraph(false);
    }
    const workflow = getCurrentWorkflow(useAgentClusterStore.getState().clusters.find((item) => item.clusterId === cluster.clusterId) ?? cluster);
    if (workflow) await confirmWorkflow(cluster.clusterId, workflow.workflowId);
    else await confirmExecutionGraph(cluster.clusterId);
  };

  const handleResetLatestRun = async () => {
    if (!latestRun) return;
    const confirmed = window.confirm('清空本集群运行记忆、消息、事件、Manager patch/proposal 和 Agent 本地上下文；只保留 Agent 定义与编排图？');
    if (!confirmed) return;
    await resetRun(cluster.clusterId, latestRun.runId);
  };

  const handleStartRun = async () => {
    let args: Record<string, unknown> = {};
    const raw = runArgsDraft.trim();
    if (raw && raw !== '{}') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('运行参数必须是 JSON object');
        }
        args = parsed as Record<string, unknown>;
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '运行参数 JSON 无法解析');
        return;
      }
    }
    await startRun(cluster.clusterId, args);
  };

  const handleSaveWorkflowScript = async () => {
    const source = scriptDraft.trim();
    if (!source) {
      window.alert('workflow.js 不能为空');
      return;
    }
    await saveWorkflowScript(cluster.clusterId, {
      source,
      argsSchema: cluster.workflowScript?.argsSchema,
    });
  };

  const handleConfirmWorkflowScript = async () => {
    if (scriptDraft.trim() && scriptDraft.trim() !== (cluster.workflowScript?.source ?? '').trim()) {
      await saveWorkflowScript(cluster.clusterId, {
        source: scriptDraft.trim(),
        argsSchema: cluster.workflowScript?.argsSchema,
      });
    }
    await confirmWorkflowScript(cluster.clusterId);
  };

  const handleRunWorkflowScriptOnce = async () => {
    await handleConfirmWorkflowScript();
    await handleStartRun();
  };

  const handleFreezeCluster = async () => {
    const ok = window.confirm('固化集群会导出可复用包，不包含运行历史、transcript、API key 或本地 provider 配置。继续选择导出位置？');
    if (!ok) return;
    const folder = await selectFreezeFolder(cluster.clusterId);
    if (!folder) return;
    const exportedPath = await freezeCluster(cluster.clusterId, folder);
    if (exportedPath) setFreezeExportPath(exportedPath);
  };

  const centerTabs: Array<{ id: AgentClusterCenterTab; label: string; hint: string }> = [
    { id: 'monitor', label: '运行监控', hint: '节点状态与控制' },
    { id: 'workflow', label: projectDirectoryMode ? '执行链路' : 'Workflow', hint: '链路与编排' },
    projectDirectoryMode ? null : { id: 'context', label: '共享上下文', hint: '全局记忆' },
  ].filter((tab): tab is { id: AgentClusterCenterTab; label: string; hint: string } => Boolean(tab));

  return (
    <div data-testid="agent-cluster-detail-page" className="zone-cluster -m-6 min-h-[calc(100vh-2.5rem)] bg-transparent">
      <div
        ref={containerRef}
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
        <main className="soft-panel flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl xl:min-h-0">
          <div className="min-h-0 flex-1 overflow-y-auto bg-card/35 p-4">
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
                {projectDirectoryMode
                  ? '项目 prompt 和 runtime contract 是权威；InvestClaw 只负责调度、round、产物校验和运行监控。'
                  : '共享上下文保存全局一致性；每个子 Agent 保留自己的本地上下文，通过显式消息协作。'}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2 lg:items-end">
              <div
                className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground lg:justify-end"
                title={`${runtimeModeLabel} · ${workflowDisplayLabel} v${currentWorkflow?.version ?? cluster.workflows?.[0]?.version ?? 1} · ${orchestrationConfirmed ? '已确认' : '待确认'}`}
              >
                <BaseModelButton compact className="max-w-[150px] sm:max-w-[190px]" />
                <span className="rounded-full border border-border/70 bg-card/60 px-2 py-1">subagent_swarm</span>
                <span className="rounded-full border border-border/70 bg-card/60 px-2 py-1">{projectDirectoryMode ? '项目原生' : '动态 Harness'}</span>
                <span className="rounded-full border border-border/70 bg-card/60 px-2 py-1">{workflowDisplayLabel} v{currentWorkflow?.version ?? cluster.workflows?.[0]?.version ?? 1}</span>
                <Badge variant={orchestrationConfirmed ? 'secondary' : 'outline'} className="rounded-full">
                  {orchestrationConfirmed ? '已确认' : '待确认'}
                </Badge>
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-2 lg:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (editingGraph) {
                      setDraftGraph(executionGraph);
                      setDraftWorkflow(currentWorkflow ? structuredClone(currentWorkflow) : null);
                      setLegacyGraphDirty(false);
                      setEditingGraph(false);
                      return;
                    }
                    {
                      setDraftGraph(executionGraph);
                      setDraftWorkflow(currentWorkflow ? prepareWorkflowForEditing(currentWorkflow) : null);
                      setLegacyGraphDirty(false);
                      setCenterTab('workflow');
                    }
                    setEditingGraph(true);
                  }}
                  disabled={Boolean(cluster.activeRunId)}
                >
                  {editingGraph ? '退出编辑' : '编辑编排'}
                </Button>
                {editingGraph && (
                  <Button variant="outline" size="sm" onClick={() => void saveGraph()} disabled={Boolean(cluster.activeRunId)}>
                    保存
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void handleFreezeCluster()} disabled={Boolean(cluster.activeRunId)} title="导出可复用集群包">
                  <FileText className="mr-1.5 h-4 w-4" />
                  固化
                </Button>
                <Button variant="outline" size="sm" onClick={() => void confirmGraph()} disabled={Boolean(cluster.activeRunId)}>
                  <Check className="mr-1.5 h-4 w-4" />
                  确认
                </Button>
                <Button
                  data-testid="agent-cluster-start-run"
                  size="sm"
                  onClick={() => void handleStartRun()}
                  disabled={Boolean(cluster.activeRunId) || !orchestrationConfirmed}
                  title={orchestrationConfirmed ? undefined : '请先确认 Agent 编排图或 JS Workflow'}
                >
                  {cluster.activeRunId ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
                  {cluster.activeRunId ? `运行中 ${runningCount}/${cluster.agents.length}` : orchestrationConfirmed ? '启动' : '先确认'}
                </Button>
                {activeRun?.harnessStatus === 'running' && (
                  <Button variant="outline" size="sm" onClick={() => void pauseRun(cluster.clusterId, activeRun.runId)}>
                    <Pause className="mr-1.5 h-4 w-4" />
                    暂停
                  </Button>
                )}
                {activeRun && (activeRun.harnessStatus === 'paused' || activeRun.harnessStatus === 'waiting_human') && (
                  <Button variant="outline" size="sm" onClick={() => void resumeRun(cluster.clusterId, activeRun.runId)} disabled={activeRun.harnessStatus === 'waiting_human'}>
                    <Play className="mr-1.5 h-4 w-4" />
                    恢复
                  </Button>
                )}
                {activeRun && (
                  <Button variant="outline" size="sm" onClick={() => void stopRun(cluster.clusterId, activeRun.runId)}>
                    <Square className="mr-1.5 h-4 w-4" />
                    停止
                  </Button>
                )}
                {latestRun && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleResetLatestRun()}
                    title="清空运行记忆、消息、事件、Manager patch/proposal 和 Agent 本地上下文，只保留 Agent 定义与编排图"
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    重置
                  </Button>
                )}
              </div>
            </div>
          </div>

          {!orchestrationConfirmed && (
            <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-800 dark:text-amber-200">
              规划模型已生成 Workflow 草稿。请检查 Agent、Fan-out、Join、Gate、Review、Reduce、Loop 与 Human Gate，确认后 Harness 才能启动。
            </div>
          )}

          <div data-testid="agent-cluster-center-tabs" className="mb-4 flex flex-wrap gap-2 rounded-xl border border-border/70 bg-background/60 p-1">
            {centerTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCenterTab(tab.id)}
                className={cn(
                  'flex min-w-32 flex-1 flex-col rounded-lg px-3 py-2 text-left transition-shadow hover:shadow-sm md:flex-none',
                  centerTab === tab.id ? 'bg-card shadow-sm' : 'text-muted-foreground',
                )}
              >
                <span className="text-sm font-medium">{tab.label}</span>
                <span className="mt-0.5 text-[11px]">{tab.hint}</span>
              </button>
            ))}
          </div>

          {centerTab === 'monitor' && (
            <div data-testid="agent-cluster-run-monitor" className="soft-panel mb-5 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">运行监控</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {latestRun ? runMonitorStatusText(latestRun) : '等待启动'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">round {latestRun?.roundStart ?? latestRun?.childRuns.find((child) => typeof child.iteration === 'number')?.iteration ?? 1}</Badge>
                  <Badge variant="outline">{workflowDisplayLabel} v{latestRun?.workflowSnapshot?.version ?? currentWorkflow?.version ?? 1}</Badge>
                  <Badge variant="secondary">已完成 {completedCount}/{latestRun?.childRuns.length ?? cluster.agents.length}</Badge>
                  <Badge variant="secondary">运行中 {runStats?.runningCount ?? runningCount}</Badge>
                  <Badge variant="secondary">阻塞 {blockedCount}</Badge>
                  <Badge variant={failedCount > 0 ? 'destructive' : 'secondary'}>异常 {failedCount}</Badge>
                  <Badge variant="outline">Token {runStats?.tokenTotal ?? 0}</Badge>
                  <Badge variant="outline" title={runDurationTooltip}>耗时 {formatRunDurationMs(runStats?.durationMs)}</Badge>
                  <Badge variant="outline">重试 {runStats?.retryCount ?? 0}</Badge>
                  {(latestRun?.loopStates ?? []).map((loop) => (
                    <Badge key={loop.loopId} variant="outline">
                      循环 {loop.currentIteration}/{loop.repeatCount}
                    </Badge>
                  ))}
                  {latestRun && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => void refreshRunEvents(cluster.clusterId, latestRun.runId)}>
                        刷新运行事件
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void handleResetLatestRun()}>
                        重置运行状态
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-border/70 bg-card/45 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      Cluster Manager
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {latestRun ? '总控运行、提案、人工门禁和结果汇总。' : '等待你确认 Workflow 并启动运行。'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{latestRun ? latestRun.harnessStatus : 'idle'}</Badge>
                    <Badge variant="outline">{cluster.agents.length} Agents</Badge>
                  </div>
                </div>
                {latestEvent && (
                  <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    最近事件：{latestEvent.title} · {latestEvent.content}
                  </div>
                )}
              </div>
              {!cluster.activeRunId && (
                <details className="mt-3 rounded-xl border border-border/70 bg-card/35 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">运行参数 args</summary>
                  <Textarea
                    value={runArgsDraft}
                    onChange={(event) => setRunArgsDraft(event.target.value)}
                    className="mt-2 min-h-20 resize-y font-mono text-xs"
                    placeholder='例如 {"ticker":"AAPL","date":"2026-06-16"}'
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Args 只绑定本次 run，不写入长期 sharedContext。
                  </p>
                </details>
              )}
              {latestRun && waitingHumanNodes.map((nodeRun) => {
                const node = latestRun.workflowSnapshot?.nodes.find((item) => item.nodeId === nodeRun.nodeId);
                return (
                  <div key={nodeRun.nodeId} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{node?.name ?? 'Human Gate'}</div>
                      <div className="text-xs text-muted-foreground">{nodeRun.waitingReason ?? '等待你的决定'}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void decideHumanGate(cluster.clusterId, latestRun.runId, nodeRun.nodeId, 'approve')}>批准继续</Button>
                      <Button size="sm" variant="outline" onClick={() => void decideHumanGate(cluster.clusterId, latestRun.runId, nodeRun.nodeId, 'reject')}>拒绝</Button>
                    </div>
                  </div>
                );
              })}
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {cluster.agents.map((agent) => {
                  const child = latestRun?.childRuns.find((item) => item.agentId === agent.agentId) ?? null;
                  const artifactText = child ? artifactValidationText(child.artifactValidationStatus) : null;
                  const progressHint = childRunProgressHint(agent, child);
                  return (
                    <div key={agent.agentId} className="soft-row rounded-xl px-3 py-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{agent.name}</span>
                        {child ? (
                          <span className={cn(
                            'rounded-full px-2 py-0.5',
                            child.status === 'completed' && 'bg-emerald-500/10 text-emerald-700',
                            (child.status === 'error' || child.status === 'timeout') && 'bg-destructive/10 text-destructive',
                            (child.status === 'running' || child.status === 'starting') && 'bg-card text-foreground',
                            child.status === 'blocked' && 'bg-amber-500/10 text-amber-700',
                          )}>
                            {childRunStatusText(child.status)}
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">待启动</Badge>
                        )}
                      </div>
                      <div className="mt-1 truncate text-muted-foreground">{agent.role}</div>
                      {agent.description && <div className="mt-1 line-clamp-2 leading-5 text-muted-foreground">{agent.description}</div>}
                      {child && <div className="mt-2 truncate text-muted-foreground">{child.submitStatus ?? 'pending'} · Agent 子会话</div>}
                      {child && typeof child.targetCandidateCount === 'number' && (
                        <div className="mt-1 text-muted-foreground">
                          候选：{child.actualCandidateCount ?? 0}/{child.targetCandidateCount}
                        </div>
                      )}
                      {child && artifactText && (
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
                      {child?.completionSource && (
                        <div className="mt-1 text-emerald-700 dark:text-emerald-300">
                          完成信号：{child.completionSource}
                        </div>
                      )}
                      {child && typeof child.iteration === 'number' && (
                        <div className="mt-1 text-muted-foreground">第 {child.iteration} 轮</div>
                      )}
                      {progressHint && <div className="mt-1 line-clamp-2 text-muted-foreground">{progressHint}</div>}
                      {child?.runtimeWaitReason && <div className="mt-1 line-clamp-2 text-muted-foreground">等待产物：{child.runtimeWaitReason}</div>}
                      {child?.artifactValidationError && <div className="mt-1 line-clamp-2 text-destructive">{child.artifactValidationError}</div>}
                      {child?.error && <div className="mt-1 line-clamp-2 text-destructive">{child.error}</div>}
                      {latestRun && child && canControlLatestRun && (
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
            </div>
          )}

          {centerTab === 'workflow' && (
          <div className="grid gap-5">
            {draftWorkflow && (
              editingGraph ? (
                  <WorkflowEditor
                    workflow={draftWorkflow}
                    run={latestRun}
                    editing
                    label={projectDirectoryMode ? '项目执行链路' : 'Harness Workflow'}
                    onChange={setDraftWorkflow}
                    onManualCreateAgent={async (input) => {
                      const updatedCluster = await createAgent(cluster.clusterId, input);
                      const nextWorkflow = updatedCluster ? getCurrentWorkflow(updatedCluster) : null;
                      if (nextWorkflow) setDraftWorkflow(structuredClone(nextWorkflow));
                    }}
                    onAiCreateAgent={async (prompt) => {
                      await sendManagerMessage(cluster.clusterId, { content: prompt, baseModel: selectedBaseModel });
                    }}
                  />
              ) : (
                <section data-testid="agent-cluster-workflow-summary" className="soft-panel min-w-0 overflow-hidden rounded-xl p-4">
                  <div className="grid min-w-0 gap-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Network className="h-4 w-4 text-muted-foreground" />
                        <h2 className="min-w-0 truncate text-sm font-semibold">
                          {projectDirectoryMode ? '项目执行链路' : 'Harness Workflow'} v{(currentWorkflow ?? draftWorkflow).version}
                        </h2>
                        <Badge variant={(currentWorkflow ?? draftWorkflow).status === 'confirmed' ? 'secondary' : 'outline'}>
                          {(currentWorkflow ?? draftWorkflow).status === 'confirmed' ? '已确认' : '草稿'}
                        </Badge>
                        <Badge variant="outline">最大并发 {(currentWorkflow ?? draftWorkflow).policy.maxConcurrency}</Badge>
                      </div>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                        轻量进度视图；完整编辑器仅在“编辑编排”时挂载。
                      </p>
                    </div>
                  </div>
                  <WorkflowOverview workflow={currentWorkflow ?? draftWorkflow} run={latestRun} />
                </section>
              )
            )}
            {showWorkflowScriptPanel && (
              <section className="soft-panel rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold">Dynamic Workflow JS</h2>
                      <Badge variant={workflowScriptConfirmed ? 'secondary' : 'outline'}>
                        {workflowScriptConfirmed ? '已确认' : cluster.workflowScript ? '草稿' : '未配置'}
                      </Badge>
                      {cluster.workflowScript?.sourceType && (
                        <Badge variant="outline">{cluster.workflowScript.sourceType === 'planner' ? '基模草稿' : cluster.workflowScript.sourceType === 'project' ? '项目脚本' : '用户脚本'}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      可选真实 JS workflow。目录模式只有项目显式提供脚本时才默认启用；否则使用 Harness IR 调度。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {cluster.workflowScript?.hash && (
                      <span className="text-xs text-muted-foreground">sha256 {cluster.workflowScript.hash.slice(0, 10)}</span>
                    )}
                    <Button variant="outline" size="sm" onClick={() => void handleSaveWorkflowScript()} disabled={Boolean(cluster.activeRunId) || !scriptDraft.trim()}>
                      保存脚本
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleRunWorkflowScriptOnce()} disabled={Boolean(cluster.activeRunId) || !scriptDraft.trim()}>
                      运行一次
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleConfirmWorkflowScript()} disabled={Boolean(cluster.activeRunId) || !scriptDraft.trim()}>
                      {cluster.workflowScript?.sourceType === 'project' ? '总是信任项目脚本' : '确认 JS Workflow'}
                    </Button>
                  </div>
                </div>
                <Textarea
                  className="mt-3 min-h-48 resize-y font-mono text-xs"
                  value={scriptDraft}
                  onChange={(event) => setScriptDraft(event.target.value)}
                  placeholder={'module.exports = async function workflow({ harness, args, context }) {\\n  await harness.agent("Agent_A", args);\\n  return harness.finish({ summary: "done" });\\n};'}
                  spellCheck={false}
                />
                {freezeExportPath && (
                  <p className="mt-3 text-xs text-muted-foreground">已固化到：{freezeExportPath}</p>
                )}
              </section>
            )}
            {editingGraph && (cluster.workflows?.length ?? 0) > 1 && (
                  <details className="soft-panel rounded-xl p-4">
                    <summary className="cursor-pointer text-sm font-medium">Workflow 版本历史</summary>
                    <div className="mt-3 space-y-2">
                      {cluster.workflows?.map((workflow) => (
                        <div key={workflow.workflowId} className="soft-row flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs">
                          <div>
                            <span className="font-medium">v{workflow.version}</span>
                            <span className="ml-2 text-muted-foreground">
                              {workflow.status} · {workflow.nodes.length} 节点 · {workflow.edges.length} 连接 · {workflow.createdBy}
                            </span>
                          </div>
                          {workflow.workflowId !== cluster.currentWorkflowId && !cluster.activeRunId && (
                            <Button variant="outline" size="sm" onClick={() => void rollbackWorkflow(cluster.clusterId, workflow.workflowId)}>
                              以此版本创建草稿
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
            )}
            {editingGraph && (
              <section className="soft-panel rounded-xl p-4">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left text-sm font-medium"
                  onClick={() => setShowLegacyGraph((value) => !value)}
                >
                  <span>旧 Agent 关系图（兼容编辑）</span>
                  <span className="text-xs text-muted-foreground">{showLegacyGraph ? '收起' : '展开'}</span>
                </button>
                {showLegacyGraph && (
                  <div className="mt-4">
                  <AgentGraph
                    cluster={cluster}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={selectAgent}
                    editing
                    draftGraph={draftGraph}
                    onDraftGraphChange={(graph) => {
                      setDraftGraph(graph);
                      setLegacyGraphDirty(true);
                    }}
                  />
                  </div>
                )}
              </section>
            )}
          </div>
          )}

          {centerTab === 'context' && (
            <section className="soft-panel rounded-xl p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">共享上下文</h2>
                  <p className="mt-1 text-xs text-muted-foreground">全局目标、约束、决策和 Agent 摘要。</p>
                </div>
                <Badge variant="outline">ClusterContext</Badge>
              </div>
              <SharedContextPanel cluster={cluster} />
            </section>
          )}
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
