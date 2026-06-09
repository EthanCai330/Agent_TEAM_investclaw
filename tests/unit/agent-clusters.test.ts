import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/investclaw-test'),
  },
}));

describe('agent cluster helpers', () => {
  it('marks generic runtime heartbeats as silent events', async () => {
    const { summarizeRuntimeEvent } = await import('@electron/utils/agent-clusters');

    expect(summarizeRuntimeEvent({
      method: 'agent.progress',
      params: { sessionKey: 'agent:main:subagent:cluster-test-run-agent' },
    })).toEqual(expect.objectContaining({
      title: '子会话活动',
      content: 'Agent 子会话正在运行',
      display: 'silent',
      level: 'info',
    }));
  });

  it('keeps submitted runtime events visible', async () => {
    const { summarizeRuntimeEvent } = await import('@electron/utils/agent-clusters');

    expect(summarizeRuntimeEvent({
      method: 'agent.started',
      params: { sessionKey: 'agent:main:subagent:cluster-test-run-agent' },
    })).toEqual(expect.objectContaining({
      title: '子会话已提交',
      level: 'info',
    }));
  });

  it('treats pure tool-use transcript messages as low-signal activity', async () => {
    const { getMessageContentText, isLowSignalTranscriptActivity } = await import('@electron/utils/agent-clusters');
    const message = {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'exec' },
        { type: 'tool_use', name: 'exec' },
      ],
    };
    const content = getMessageContentText(message);

    expect(content).toBe('调用工具：exec\n调用工具：exec');
    expect(isLowSignalTranscriptActivity(message, content)).toBe(true);
  });

  it('keeps cluster order stable when applying runtime updates', async () => {
    const { useAgentClusterStore } = await import('@/stores/agent-clusters');
    const makeCluster = (clusterId: string, clusterName: string, createdAt: string) => ({
      clusterId,
      clusterName,
      sourceType: 'new_task',
      sourceContent: 'task',
      sharedContext: {},
      agents: [],
      edges: [],
      messages: [],
      events: [],
      runs: [],
      createdAt,
      updatedAt: createdAt,
    });
    const first = makeCluster('cluster-first', '集群1', '2026-06-01T00:00:00.000Z');
    const second = makeCluster('cluster-second', '集群2', '2026-06-02T00:00:00.000Z');

    useAgentClusterStore.setState({ clusters: [second, first] as never });
    useAgentClusterStore.getState().applyClusterUpdate({
      ...first,
      updatedAt: '2026-06-09T00:00:00.000Z',
    } as never);

    expect(useAgentClusterStore.getState().clusters.map((cluster) => cluster.clusterId)).toEqual([
      'cluster-second',
      'cluster-first',
    ]);
  });

  it('extends an expired root run when a child run is still recently active', async () => {
    const { updateRootRunStatus } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const run = {
      runId: 'run-active-child',
      mode: 'subagent_swarm',
      status: 'running',
      harnessStatus: 'running',
      sessionKey: 'agent:main:cluster-test',
      startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      updatedAt: now,
      timeoutAt: new Date(Date.now() - 1000).toISOString(),
      childRuns: [{
        agentId: 'agent-b',
        sessionKey: 'agent:main:subagent:cluster-test-b',
        runId: 'child-b',
        status: 'running',
        submitStatus: 'submitted',
        startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        updatedAt: now,
        lastEventAt: now,
      }],
    };
    const cluster = {
      clusterId: 'cluster-test',
      clusterName: '集群',
      activeRunId: run.runId,
      agents: [],
      runs: [run],
    };

    updateRootRunStatus(cluster as never, run as never, now);

    expect(run.status).toBe('running');
    expect(run.harnessStatus).toBe('running');
    expect(cluster.activeRunId).toBe(run.runId);
    expect(new Date(run.timeoutAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not count pending pre-submit children as active concurrency', async () => {
    const { countSubmittedActiveChildRuns } = await import('@electron/utils/agent-clusters');

    expect(countSubmittedActiveChildRuns({
      childRuns: [{
        agentId: 'agent-a',
        sessionKey: 'agent:main:subagent:cluster-test-a',
        runId: '',
        status: 'running',
        submitStatus: 'pending',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, {
        agentId: 'agent-b',
        sessionKey: 'agent:main:subagent:cluster-test-b',
        runId: 'child-b',
        status: 'running',
        submitStatus: 'submitted',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    } as never)).toBe(1);
  });

  it('summarizes failed OpenClaw session metadata for the Harness', async () => {
    const { summarizeRuntimeSessionFailure } = await import('@electron/utils/agent-clusters');

    expect(summarizeRuntimeSessionFailure({
      status: 'failed',
      runtimeMs: 2003,
    })).toBe('OpenClaw 子会话状态为 failed，运行约 2 秒，但 transcript 未提供可读错误正文。');

    expect(summarizeRuntimeSessionFailure({
      status: 'failed',
      error: 'model request aborted',
    })).toBe('model request aborted');

    expect(summarizeRuntimeSessionFailure({ status: 'done' })).toBeNull();
  });

  it('infers Agent C from id/name/role instead of description text', async () => {
    const { inferAgentKind } = await import('@electron/utils/agent-clusters');

    expect(inferAgentKind({
      agentId: 'agent-3-abc',
      name: 'Agent_C_Evaluation_Auditor',
      role: '评估审计官',
      description: '读取 Agent B 的候选因子并输出评估结果',
    } as Parameters<typeof inferAgentKind>[0])).toBe('evaluation');
  });

  it('does not classify Agent C as factor generator when description mentions Agent B', async () => {
    const { inferAgentKind } = await import('@electron/utils/agent-clusters');

    expect(inferAgentKind({
      agentId: 'agent-3-def',
      name: 'Agent_C',
      role: 'Evaluation Auditor',
      description: 'Agent B has generated candidates',
    } as Parameters<typeof inferAgentKind>[0])).not.toBe('factor');
  });

  it('compiles legacy blocking edges into deterministic artifact gates', async () => {
    const { buildWorkflowFromExecutionGraph } = await import('@electron/utils/agent-clusters');
    const makeAgent = (agentId: string, name: string) => ({
      agentId,
      name,
      role: name,
      description: `${name} task`,
      responsibilities: [`${name} task`],
      status: 'idle',
      systemPrompt: name,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: name,
        role: name,
        responsibilities: [`${name} task`],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    });
    const agents = [makeAgent('agent-a', 'Data Agent'), makeAgent('agent-b', 'Research Agent')];
    const workflow = buildWorkflowFromExecutionGraph(
      'cluster-test',
      agents as Parameters<typeof buildWorkflowFromExecutionGraph>[1],
      {
        nodes: agents.map((agent, index) => ({ agentId: agent.agentId, x: index * 200, y: 0 })),
        edges: [{
          edgeId: 'edge-a-b',
          fromAgentId: 'agent-a',
          toAgentId: 'agent-b',
          relationType: 'depends_on',
          executionType: 'blocks',
          isBlocking: true,
          label: 'blocks',
        }],
        loops: [],
        confirmed: false,
        updatedAt: new Date().toISOString(),
      },
      'migration',
    );

    const gate = workflow.nodes.find((node) => node.type === 'gate');
    expect(gate).toBeDefined();
    expect(workflow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNodeId: 'agent:agent-a', toNodeId: gate?.nodeId, kind: 'control' }),
      expect.objectContaining({ fromNodeId: gate?.nodeId, toNodeId: 'agent:agent-b', kind: 'control' }),
    ]));
    expect(workflow.policy.maxConcurrency).toBe(4);
  });

  it('keeps an evaluation auditor as a normal Agent unless the edge explicitly requests review', async () => {
    const { buildWorkflowFromExecutionGraph } = await import('@electron/utils/agent-clusters');
    const makeAgent = (agentId: string, name: string, role: string) => ({
      agentId,
      name,
      role,
      description: `${name} task`,
      responsibilities: [`${name} task`],
      status: 'idle',
      systemPrompt: name,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: name,
        role,
        responsibilities: [`${name} task`],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    });
    const agents = [
      makeAgent('agent-b', 'Agent_B_Factor_Generator', '因子生成器'),
      makeAgent('agent-c', 'Agent_C_Evaluation_Auditor', '评估审计官'),
    ];
    const workflow = buildWorkflowFromExecutionGraph(
      'cluster-test',
      agents as Parameters<typeof buildWorkflowFromExecutionGraph>[1],
      {
        nodes: agents.map((agent, index) => ({ agentId: agent.agentId, x: index * 200, y: 0 })),
        edges: [{
          edgeId: 'edge-b-c',
          fromAgentId: 'agent-b',
          toAgentId: 'agent-c',
          relationType: 'depends_on',
          executionType: 'blocks',
          isBlocking: true,
          label: 'blocks',
        }],
        loops: [],
        confirmed: false,
        updatedAt: new Date().toISOString(),
      },
      'migration',
    );

    expect(workflow.nodes.find((node) => node.nodeId === 'agent:agent-c')?.type).toBe('agent');
  });

  it('resets only deterministic gates inside a loop body', async () => {
    const { collectLoopDeterministicNodeIds } = await import('@electron/utils/agent-clusters');
    const workflow = {
      workflowId: 'workflow-test',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      policy: {
        maxConcurrency: 4,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:a', type: 'agent', name: 'Agent A', agentId: 'a' },
        { nodeId: 'gate:a', type: 'gate', name: 'Gate A', gateKind: 'completion' },
        { nodeId: 'agent:b', type: 'agent', name: 'Agent B', agentId: 'b' },
        { nodeId: 'gate:b', type: 'gate', name: 'Gate B', gateKind: 'completion' },
        { nodeId: 'agent:c', type: 'agent', name: 'Agent C', agentId: 'c' },
        { nodeId: 'gate:c', type: 'gate', name: 'Gate C', gateKind: 'completion' },
        { nodeId: 'agent:d', type: 'agent', name: 'Agent D', agentId: 'd' },
        { nodeId: 'loop:bcd', type: 'loop', name: 'Loop', bodyNodeIds: ['agent:b', 'agent:c', 'agent:d'], repeatCount: 4 },
      ],
      edges: [
        { edgeId: 'a-ga', fromNodeId: 'agent:a', toNodeId: 'gate:a', kind: 'control' },
        { edgeId: 'ga-b', fromNodeId: 'gate:a', toNodeId: 'agent:b', kind: 'control' },
        { edgeId: 'b-gb', fromNodeId: 'agent:b', toNodeId: 'gate:b', kind: 'control' },
        { edgeId: 'gb-c', fromNodeId: 'gate:b', toNodeId: 'agent:c', kind: 'control' },
        { edgeId: 'c-gc', fromNodeId: 'agent:c', toNodeId: 'gate:c', kind: 'control' },
        { edgeId: 'gc-d', fromNodeId: 'gate:c', toNodeId: 'agent:d', kind: 'control' },
      ],
    } as Parameters<typeof collectLoopDeterministicNodeIds>[0];
    const loop = workflow.nodes.find((node) => node.nodeId === 'loop:bcd') as Parameters<typeof collectLoopDeterministicNodeIds>[1];

    expect([...collectLoopDeterministicNodeIds(workflow, loop)].sort()).toEqual(['gate:b', 'gate:c']);
  });
});
