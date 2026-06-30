import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/investclaw-test'),
  },
}));

describe('agent cluster helpers', () => {
  it('keeps the core harness free of project-specific artifact rules', async () => {
    const source = await readFile(join(process.cwd(), 'electron/utils/agent-clusters.ts'), 'utf8');

    expect(source).not.toContain('factor_mining_v3');
    expect(source).not.toContain('Data_Acquire_system');
    expect(source).not.toContain('/private/project/oc_factor_mining');
    expect(source).not.toContain('candidate_parts');
    expect(source).not.toContain('scorecard.csv');
  });

  it('does not read HANDOFF by default when README and runtime contract are available', async () => {
    const { readFolderSourceContent } = await import('@electron/utils/agent-clusters');
    const root = await mkdtemp(join(tmpdir(), 'investclaw-folder-source-'));
    try {
      await mkdir(join(root, 'agents'), { recursive: true });
      await writeFile(join(root, 'README.md'), '# Project\n\nREADME_ONLY_CONTEXT');
      await writeFile(join(root, 'HANDOFF.md'), '# Handoff\n\nHANDOFF_SECRET_CONTEXT');
      await writeFile(join(root, 'agents', 'runtime_contract.json'), JSON.stringify({ agents: [] }));
      await writeFile(join(root, 'agents', 'agent_worker.md'), '# Worker\n\nAGENT_PROMPT_CONTEXT');

      const content = await readFolderSourceContent(root);

      expect(content).toContain('README_ONLY_CONTEXT');
      expect(content).toContain('runtime_contract.json');
      expect(content).toContain('AGENT_PROMPT_CONTEXT');
      expect(content).not.toContain('HANDOFF_SECRET_CONTEXT');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads HANDOFF only when README manifest explicitly opts into it', async () => {
    const { readFolderSourceContent } = await import('@electron/utils/agent-clusters');
    const root = await mkdtemp(join(tmpdir(), 'investclaw-folder-source-'));
    try {
      await writeFile(join(root, 'README.md'), ['# Project', '', 'context:', '- HANDOFF.md'].join('\n'));
      await writeFile(join(root, 'HANDOFF.md'), '# Handoff\n\nHANDOFF_INCLUDED_CONTEXT');

      const content = await readFolderSourceContent(root);

      expect(content).toContain('HANDOFF_INCLUDED_CONTEXT');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to HANDOFF for legacy folders without README, runtime contract, or agent prompts', async () => {
    const { readFolderSourceContent } = await import('@electron/utils/agent-clusters');
    const root = await mkdtemp(join(tmpdir(), 'investclaw-folder-source-'));
    try {
      await writeFile(join(root, 'HANDOFF.md'), '# Legacy Handoff\n\nLEGACY_HANDOFF_CONTEXT');

      const content = await readFolderSourceContent(root);

      expect(content).toContain('LEGACY_HANDOFF_CONTEXT');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('compacts non-string legacy context values without crashing', async () => {
    const { compactText } = await import('@electron/utils/agent-clusters');

    expect(compactText({ next: 'A -> B', nested: { ok: true } }, 80)).toContain('"next"');
    expect(compactText(['old', 'context'], 80)).toContain('old');
    expect(compactText(null, 80)).toBe('');
  });

  it('orders loop body nodes by control edges instead of checkbox order', async () => {
    const { getOrderedWorkflowLoopBodyNodeIds } = await import('@electron/utils/agent-clusters');
    const workflow = {
      workflowId: 'workflow-loop-order',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent-b', type: 'agent', name: 'B', agentId: 'b' },
        { nodeId: 'agent-c', type: 'agent', name: 'C', agentId: 'c' },
        { nodeId: 'agent-d', type: 'agent', name: 'D', agentId: 'd' },
        { nodeId: 'gate-b', type: 'gate', name: 'Gate B', gateKind: 'completion' },
        { nodeId: 'gate-c', type: 'gate', name: 'Gate C', gateKind: 'completion' },
        { nodeId: 'loop-1', type: 'loop', name: 'Loop', bodyNodeIds: ['agent-b', 'agent-d', 'agent-c'], repeatCount: 2 },
      ],
      edges: [
        { edgeId: 'b-gate', fromNodeId: 'agent-b', toNodeId: 'gate-b', kind: 'control' },
        { edgeId: 'gate-c', fromNodeId: 'gate-b', toNodeId: 'agent-c', kind: 'control' },
        { edgeId: 'c-gate', fromNodeId: 'agent-c', toNodeId: 'gate-c', kind: 'control' },
        { edgeId: 'gate-d', fromNodeId: 'gate-c', toNodeId: 'agent-d', kind: 'control' },
      ],
    };
    const loop = workflow.nodes.find((node) => node.type === 'loop');

    expect(getOrderedWorkflowLoopBodyNodeIds(workflow as never, loop as never)).toEqual(['agent-b', 'agent-c', 'agent-d']);
  });

  it('builds child prompts when legacy shared context fields are not strings', async () => {
    const { buildAgentChildPrompt } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-b',
      name: 'Agent_B_Factor_Generator',
      role: '因子候选生成器',
      description: 'Generate candidates',
      responsibilities: ['生成候选'],
      status: 'idle',
      systemPrompt: 'Use project tools.',
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-b',
        systemPrompt: '',
        role: '因子候选生成器',
        responsibilities: ['生成候选'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };

    const prompt = buildAgentChildPrompt({
      clusterId: 'cluster-legacy-context',
      clusterName: 'Legacy Context',
      sourceType: 'existing_task',
      runtimeMode: 'dynamic_harness',
      sourceContent: '',
      projectRoot: '/project/factor_mining_v3',
      sourceFolderPath: '/project/factor_mining_v3',
      sharedContext: {
        globalGoal: 'Run pipeline',
        originalInput: '',
        decompositionPlan: { steps: ['A', 'B'], note: 'object from legacy planner' },
        constraints: { hard: ['project only'] },
        facts: [],
        historicalNotes: [],
        projectContractSummary: { source: 'README/HANDOFF' },
        currentRunContext: { runRoot: 'experiment_results/version_1' },
        decisions: { latest: 'use canonical outputs' },
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: { q: 'legacy object' },
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      agents: [agent],
      edges: [],
      messages: [],
      events: [],
      runs: [],
      createdAt: now,
      updatedAt: now,
    } as never, agent as never);

    expect(prompt).toContain('Run pipeline');
    expect(prompt).not.toContain('undefined');
  });

  it('resolves runtime contract templates before injecting stable commands and output contracts', async () => {
    const { buildAgentChildPrompt } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-worker',
      name: 'Worker Agent',
      role: 'Worker',
      description: 'Runs a stable command',
      responsibilities: ['Run the project command'],
      status: 'idle',
      systemPrompt: 'Use the runtime contract.',
      runtimeContract: {
        agentName: 'Worker Agent',
        canonicalOutputDir: 'workers/<agent_id>/round_<round>',
        stableCommand: [
          'uv run python agents/tools/worker.py --output-root experiment_results/<run_root> --output-dir experiment_results/<run_root>/workers/<agent_id>/round_<round>',
        ],
      },
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-worker',
        systemPrompt: '',
        role: 'Worker',
        responsibilities: ['Run the project command'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };

    const prompt = buildAgentChildPrompt({
      clusterId: 'cluster-template',
      clusterName: 'Template Cluster',
      sourceType: 'existing_task',
      sourceContent: '',
      projectRoot: '/project',
      sourceFolderPath: '/project',
      activeRunId: 'run-1',
      sharedContext: {
        globalGoal: 'Run project',
        originalInput: '',
        decompositionPlan: 'Worker',
        constraints: [],
        facts: [],
        historicalNotes: [],
        projectContractSummary: 'runtime_contract agents=1 | stable_tools=agents/tools/worker.py',
        currentRunContext: '',
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      agents: [agent],
      edges: [],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'running',
        harnessStatus: 'running',
        sessionKey: 'agent:main:cluster-template',
        outputRoot: '/project/experiment_results/version_7_20260625',
        outputVersion: 'version_7_20260625',
        startedAt: now,
        updatedAt: now,
        childRuns: [{
          agentId: 'agent-worker',
          sessionKey: 'agent:main:subagent:worker',
          runId: '',
          status: 'starting',
          submitStatus: 'pending',
          startedAt: now,
          updatedAt: now,
          iteration: 3,
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 1,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: [{
            nodeId: 'agent:agent-worker',
            type: 'agent',
            name: 'Worker Agent',
            agentId: 'agent-worker',
            outputContract: {
              requiredArtifacts: ['workers/<agent_id>/round_<round>/result.json'],
            },
          }],
          edges: [],
        },
      }],
      createdAt: now,
      updatedAt: now,
    } as never, agent as never);

    expect(prompt).toContain('workers/agent-worker/round_3');
    expect(prompt).toContain('experiment_results/version_7_20260625/workers/agent-worker/round_3');
    expect(prompt).toContain('workers/agent-worker/round_3/result.json');
    expect(prompt).toContain('执行优先：先执行当前 Agent prompt/runtime contract 声明的稳定命令');
    expect(prompt).toContain('首个 required artifact：workers/agent-worker/round_3/result.json');
    expect(prompt).toContain('先交付最小可校验产物');
    expect(prompt).not.toContain('<run_root>');
    expect(prompt).not.toContain('<round>');
    expect(prompt).not.toContain('experiment_results/experiment_results');
  });

  it('uses a thin child prompt for project directory runtime mode', async () => {
    const { buildAgentChildPrompt } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-worker',
      name: 'Worker Agent',
      role: 'Worker',
      description: 'Runs a project command',
      responsibilities: ['Run the project command'],
      status: 'idle',
      systemPrompt: '# Worker\nRun only the project stable command.',
      runtimeContract: {
        agentName: 'Worker Agent',
        canonicalOutputDir: 'workers/round_<round>',
        stableCommand: 'uv run python agents/tools/worker.py --output-root experiment_results/<run_root> --output-dir experiment_results/<run_root>/workers/round_<round>',
      },
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-worker',
        systemPrompt: '',
        role: 'Worker',
        responsibilities: ['Run the project command'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };

    const prompt = buildAgentChildPrompt({
      clusterId: 'cluster-project-directory',
      clusterName: 'Project Directory',
      sourceType: 'existing_task',
      runtimeMode: 'project_directory',
      sourceContent: '# README\nLong project explanation',
      projectRoot: '/project',
      sourceFolderPath: '/project',
      activeRunId: 'run-1',
      sharedContext: {
        globalGoal: 'This global goal should not be injected into project directory prompts.',
        originalInput: '',
        decompositionPlan: 'Long plan should not appear',
        constraints: ['Shared constraint should not appear'],
        facts: ['Planner fact should not appear'],
        historicalNotes: [],
        projectContractSummary: 'runtime_contract agents=1 | stable_tools=huge-list',
        currentRunContext: 'Shared current run context should not appear',
        decisions: ['Planner decision should not appear'],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: ['Planner question should not appear'],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      agents: [agent],
      edges: [],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'running',
        harnessStatus: 'running',
        sessionKey: 'agent:main:cluster-project-directory',
        outputRoot: '/project/experiment_results/version_1_20260626',
        outputVersion: 'version_1_20260626',
        startedAt: now,
        updatedAt: now,
        childRuns: [{
          agentId: 'agent-worker',
          sessionKey: 'agent:main:subagent:worker',
          runId: '',
          status: 'starting',
          submitStatus: 'pending',
          startedAt: now,
          updatedAt: now,
          iteration: 2,
          outputRoot: '/project/experiment_results/version_1_20260626',
          expectedArtifacts: ['workers/round_2/result.json'],
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'planner',
          nodes: [{
            nodeId: 'agent:agent-worker',
            type: 'agent',
            name: 'Worker Agent',
            agentId: 'agent-worker',
            outputContract: { requiredArtifacts: ['workers/round_<round>/result.json'] },
          }],
          edges: [],
          policy: {
            maxConcurrency: 1,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          createdAt: now,
          updatedAt: now,
        },
      }],
      createdAt: now,
      updatedAt: now,
    } as never, agent as never);

    expect(prompt).toContain('运行模式：项目目录模式 / Thin Harness');
    expect(prompt).toContain('默认稳定命令');
    expect(prompt).toContain('experiment_results/version_1_20260626/workers/round_2');
    expect(prompt).toContain('首个 required artifact：workers/round_2/result.json');
    expect(prompt).toContain('# Worker');
    expect(prompt).not.toContain('共享上下文摘要');
    expect(prompt).not.toContain('Harness dataMapping 已解析输入');
    expect(prompt).not.toContain('Harness 节点契约');
    expect(prompt).not.toContain('This global goal should not be injected');
    expect(prompt).not.toContain('Shared constraint should not appear');
    expect(prompt).not.toContain('Planner fact should not appear');
    expect(prompt).not.toContain('stable_tools=huge-list');
  });

  it('filters shared context to the current agent instead of injecting other agents static rules', async () => {
    const { buildAgentChildPrompt } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agentB = {
      agentId: 'agent-b',
      name: 'Generator Agent',
      role: 'Generator',
      description: 'Generates output',
      responsibilities: ['Generate output'],
      status: 'idle',
      systemPrompt: 'Generate.',
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-b',
        systemPrompt: '',
        role: 'Generator',
        responsibilities: ['Generate output'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };
    const agentC = {
      ...agentB,
      agentId: 'agent-c',
      name: 'Evaluator Agent',
      role: 'Evaluator',
      description: 'Evaluates output',
      responsibilities: ['Evaluate output'],
      localContext: {
        ...agentB.localContext,
        agentId: 'agent-c',
        role: 'Evaluator',
        responsibilities: ['Evaluate output'],
      },
    };

    const prompt = buildAgentChildPrompt({
      clusterId: 'cluster-context-filter',
      clusterName: 'Context Filter',
      sourceType: 'existing_task',
      sourceContent: '',
      sharedContext: {
        globalGoal: 'Run workflow',
        originalInput: '',
        decompositionPlan: 'B -> C',
        constraints: [
          '所有 Agent 必须在项目根目录内工作。',
          'Generator Agent 必须先写第一份中间产物。',
          'Evaluator Agent 必须运行审查工具。',
        ],
        facts: [],
        historicalNotes: [],
        projectContractSummary: 'runtime_contract agents=2 | stable_tools=a.py,b.py,c.py,d.py',
        currentRunContext: '',
        decisions: ['Evaluator Agent 的审查策略由项目 contract 决定。'],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      agents: [agentB, agentC],
      edges: [],
      messages: [],
      events: [],
      runs: [],
      createdAt: now,
      updatedAt: now,
    } as never, agentB as never);

    expect(prompt).toContain('所有 Agent 必须在项目根目录内工作');
    expect(prompt).toContain('Generator Agent 必须先写第一份中间产物');
    expect(prompt).not.toContain('Evaluator Agent 必须运行审查工具');
    expect(prompt).not.toContain('Evaluator Agent 的审查策略');
    expect(prompt).not.toContain('stable_tools=a.py,b.py,c.py,d.py');
  });

  it('does not inject static non-blocking agent summaries as feedback memory', async () => {
    const { buildAgentChildPrompt } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agentB = {
      agentId: 'agent-b',
      name: 'Generator Agent',
      role: 'Generator',
      description: 'Generates output',
      responsibilities: ['Generate output'],
      status: 'idle',
      systemPrompt: 'Generate.',
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-b',
        systemPrompt: '',
        role: 'Generator',
        responsibilities: ['Generate output'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };
    const agentD = {
      ...agentB,
      agentId: 'agent-d',
      name: 'Memory Agent',
      role: 'Memory',
      description: 'Archives output',
      responsibilities: ['Archive output'],
      localContext: {
        ...agentB.localContext,
        agentId: 'agent-d',
        role: 'Memory',
        responsibilities: ['Archive output'],
        outputs: [],
      },
    };

    const prompt = buildAgentChildPrompt({
      clusterId: 'cluster-reference-filter',
      clusterName: 'Reference Filter',
      sourceType: 'existing_task',
      sourceContent: '',
      sharedContext: {
        globalGoal: 'Run workflow',
        originalInput: '',
        decompositionPlan: 'B <- D',
        constraints: [],
        facts: [],
        historicalNotes: [],
        projectContractSummary: '',
        currentRunContext: '',
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [{
          agentId: 'agent-d',
          name: 'Memory Agent',
          summary: 'Memory Agent 负责：归档历史结果和生成下一轮反馈。',
          updatedAt: now,
        }],
        finalSummary: '',
      },
      agents: [agentB, agentD],
      edges: [{
        edgeId: 'edge-d-b',
        fromAgentId: 'agent-d',
        toAgentId: 'agent-b',
        relationType: 'reports_to',
        executionType: 'informs',
        isBlocking: false,
        label: 'feedback',
      }],
      messages: [],
      events: [],
      runs: [],
      createdAt: now,
      updatedAt: now,
    } as never, agentB as never);

    expect(prompt).toContain('非阻塞参考 / 反馈记忆：\n无。');
    expect(prompt).not.toContain('Memory Agent 负责：归档历史结果');
  });

  it('extracts workflow token usage from common transcript shapes', async () => {
    const { extractWorkflowTokenUsage } = await import('@electron/utils/agent-clusters');

    expect(extractWorkflowTokenUsage({
      role: 'assistant',
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    })).toEqual({ input: 12, output: 8, total: 20 });

    expect(extractWorkflowTokenUsage({
      role: 'toolResult',
      details: {
        usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27 },
      },
    })).toEqual({ input: 20, output: 7, total: 27 });

    expect(extractWorkflowTokenUsage({
      role: 'assistant',
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 9, totalTokenCount: 14 },
    })).toEqual({ input: 5, output: 9, total: 14 });
  });

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

  it('marks a running child stale when Gateway reconnected after its last activity and history was checked', async () => {
    const { shouldMarkChildStaleAfterGatewayRestart } = await import('@electron/utils/agent-clusters');

    expect(shouldMarkChildStaleAfterGatewayRestart({
      child: {
        status: 'running',
        submitStatus: 'submitted',
        startedAt: '2026-06-25T07:50:00.000Z',
        updatedAt: '2026-06-25T08:02:00.000Z',
        lastEventAt: '2026-06-25T07:57:00.000Z',
      },
      gatewayConnectedAtMs: Date.parse('2026-06-25T07:58:30.000Z'),
      checkedHistory: true,
      sawNewTranscript: false,
      nowMs: Date.parse('2026-06-25T07:59:00.000Z'),
    })).toBe(true);
  });

  it('does not mark a running child stale when chat history could not be read', async () => {
    const { shouldMarkChildStaleAfterGatewayRestart } = await import('@electron/utils/agent-clusters');

    expect(shouldMarkChildStaleAfterGatewayRestart({
      child: {
        status: 'running',
        submitStatus: 'submitted',
        startedAt: '2026-06-25T07:50:00.000Z',
        updatedAt: '2026-06-25T08:02:00.000Z',
        lastEventAt: '2026-06-25T07:57:00.000Z',
      },
      gatewayConnectedAtMs: Date.parse('2026-06-25T07:58:30.000Z'),
      checkedHistory: false,
      sawNewTranscript: false,
      nowMs: Date.parse('2026-06-25T08:03:00.000Z'),
    })).toBe(false);
  });

  it('does not auto-retry stale-after-restart failures', async () => {
    const { runtimeFailureAllowsAutoRetry } = await import('@electron/utils/agent-clusters');

    expect(runtimeFailureAllowsAutoRetry('stale_after_restart')).toBe(false);
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

  it('manual retry reopens a paused harness after incomplete output', async () => {
    const { retryAgentClusterRunAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-b',
      name: 'Agent_B_Factor_Generator',
      role: '因子候选生成器',
      description: 'Generate candidates',
      responsibilities: ['生成候选'],
      status: 'waiting',
      systemPrompt: 'Use project tools.',
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-b',
        systemPrompt: '',
        role: '因子候选生成器',
        responsibilities: ['生成候选'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'waiting',
      },
    };
    const cluster = {
      clusterId: 'cluster-retry-paused',
      clusterName: 'Retry Paused',
      sourceType: 'existing_task',
      sourceContent: '',
      sharedContext: {
        globalGoal: 'Run pipeline',
        originalInput: '',
        decompositionPlan: 'B',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents: [agent],
      edges: [],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'blocked',
        harnessStatus: 'paused',
        sessionKey: 'agent:main:cluster-retry-paused',
        startedAt: now,
        updatedAt: now,
        childRuns: [{
          agentId: 'agent-b',
          workflowNodeId: 'agent:agent-b',
          sessionKey: 'agent:main:subagent:retry-paused-b',
          runId: '',
          status: 'blocked',
          submitStatus: 'failed',
          runtimeFailureKind: 'incomplete_output',
          startedAt: now,
          updatedAt: now,
          iteration: 1,
        }],
        nodeRuns: [{
          nodeId: 'agent:agent-b',
          status: 'waiting',
          attempt: 1,
          startedAt: now,
          updatedAt: now,
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 1,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: [{ nodeId: 'agent:agent-b', type: 'agent', name: 'Agent B', agentId: 'agent-b' }],
          edges: [],
        },
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b', status: 'submitted' }) };
    const updated = await retryAgentClusterRunAgent(
      'cluster-retry-paused',
      'run-1',
      'agent-b',
      gateway as never,
    );

    const run = updated.runs[0];
    expect(run.status).toBe('running');
    expect(run.harnessStatus).toBe('running');
    expect(run.watchdogStatus).toBe('watching');
    expect(updated.activeRunId).toBe('run-1');
    expect(run.childRuns[0].status).toBe('starting');

    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
  });

  it('recovers failed artifact validation when root-level contract artifacts now resolve', async () => {
    const { refreshAgentClusterRunEvents } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-d-recovery-'));
    await writeFile(join(outputRoot, 'scorecard.csv'), 'name,total_score\nfactor,0.1\n', 'utf8');
    await mkdir(join(outputRoot, 'agent_d', 'round_1'), { recursive: true });
    await writeFile(join(outputRoot, 'agent_d', 'round_1', 'agent_d_summary.json'), '{"status":"completed"}', 'utf8');
    await writeFile(join(outputRoot, 'agent_d', 'round_1', 'scorecard.csv'), 'name,total_score\nfactor,0.1\n', 'utf8');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-d',
      name: 'Agent_D_Research_Librarian',
      role: '研究馆员',
      description: 'Archive results',
      responsibilities: ['归档'],
      status: 'error',
      systemPrompt: 'Archive',
      tools: [],
      capabilities: [],
      currentTask: 'scorecard.csv 不存在',
      localContext: {
        agentId: 'agent-d',
        systemPrompt: '',
        role: '研究馆员',
        responsibilities: ['归档'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'error',
      },
    };
    const cluster = {
      clusterId: 'cluster-d-recovery',
      clusterName: 'D Recovery',
      sourceType: 'existing_task',
      sourceContent: '',
      projectRoot: outputRoot,
      sourceFolderPath: outputRoot,
      sharedContext: {
        globalGoal: 'Run pipeline',
        originalInput: '',
        decompositionPlan: 'D',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents: [agent],
      edges: [],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'error',
        harnessStatus: 'failed',
        sessionKey: 'agent:main:cluster-d-recovery',
        outputRoot,
        startedAt: now,
        updatedAt: now,
        childRuns: [{
          agentId: 'agent-d',
          workflowNodeId: 'agent:agent-d',
          sessionKey: 'agent:main:subagent:d-recovery',
          runId: 'runtime-d',
          status: 'error',
          submitStatus: 'failed',
          completionSignal: '[status:completed]',
          completionSource: 'structured',
          artifactValidationStatus: 'failed',
          artifactValidationError: `scorecard.csv 不存在：${join(outputRoot, 'agents', 'agent-d', 'round_1', 'scorecard.csv')}`,
          error: 'scorecard.csv 不存在',
          startedAt: now,
          updatedAt: now,
          iteration: 1,
        }],
        nodeRuns: [{
          nodeId: 'agent:agent-d',
          status: 'failed',
          attempt: 1,
          error: 'scorecard.csv 不存在',
          startedAt: now,
          updatedAt: now,
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 1,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: [{
            nodeId: 'agent:agent-d',
            type: 'agent',
            name: 'Agent D',
            agentId: 'agent-d',
            outputContract: {
              requiredArtifacts: [
                'agent_d/round_<round>/agent_d_summary.json',
                'agent_d/round_<round>/scorecard.csv',
                'scorecard.csv',
              ],
            },
          }],
          edges: [],
        },
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const updated = await refreshAgentClusterRunEvents(
      'cluster-d-recovery',
      'run-1',
      { rpc: vi.fn().mockRejectedValue(new Error('RPC timeout: chat.history')) } as never,
    );

    const run = updated.runs[0];
    expect(run.childRuns[0].status).toBe('completed');
    expect(run.childRuns[0].artifactValidationStatus).toBe('passed');
    expect(run.childRuns[0].artifacts).toEqual([
      'agent_d/round_1/agent_d_summary.json',
      'agent_d/round_1/scorecard.csv',
      'scorecard.csv',
    ]);
    expect(run.status).toBe('completed');
  });

  it('marks a running child completed when its runtime session is done and required artifacts passed', async () => {
    const { applyRuntimeDoneArtifactCompletion, updateRootRunStatus } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-done-artifacts-'));
    await mkdir(join(outputRoot, 'worker', 'round_1'), { recursive: true });
    await writeFile(join(outputRoot, 'worker', 'round_1', 'final.json'), '{"ok":true}', 'utf8');
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const now = new Date().toISOString();
    const agent = {
      agentId: 'worker',
      name: 'Worker',
      role: '执行者',
      description: '',
      responsibilities: [],
      status: 'running',
      systemPrompt: '',
      tools: [],
      capabilities: [],
      currentTask: '等待完成信号',
      localContext: {
        agentId: 'worker',
        systemPrompt: '',
        role: '执行者',
        responsibilities: [],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'running',
      },
    };
    const child = {
      agentId: 'worker',
      workflowNodeId: 'agent:worker',
      sessionKey: 'agent:main:subagent:worker',
      runId: 'runtime-worker',
      status: 'running',
      submitStatus: 'submitted',
      startedAt,
      updatedAt: startedAt,
      iteration: 1,
    };
    const run = {
      runId: 'run-done-artifacts',
      mode: 'subagent_swarm',
      status: 'running',
      harnessStatus: 'running',
      sessionKey: 'agent:main:cluster-done-artifacts',
      outputRoot,
      startedAt,
      updatedAt: startedAt,
      childRuns: [child],
      nodeRuns: [{
        nodeId: 'agent:worker',
        status: 'running',
        attempt: 1,
        startedAt,
        updatedAt: startedAt,
      }],
      workflowSnapshot: {
        workflowId: 'workflow-done-artifacts',
        version: 1,
        status: 'confirmed',
        createdBy: 'user',
        createdAt: startedAt,
        updatedAt: startedAt,
        policy: {
          maxConcurrency: 1,
          defaultTimeoutMs: 1000,
          defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
        },
        nodes: [{
          nodeId: 'agent:worker',
          type: 'agent',
          name: 'Worker',
          agentId: 'worker',
          outputContract: { requiredArtifacts: ['worker/round_<round>/final.json'] },
        }],
        edges: [],
      },
    };
    const cluster = {
      clusterId: 'cluster-done-artifacts',
      clusterName: 'Done Artifacts',
      sourceType: 'existing_task',
      sourceContent: '',
      projectRoot: outputRoot,
      sourceFolderPath: outputRoot,
      sharedContext: {
        globalGoal: '',
        originalInput: '',
        decompositionPlan: '',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-done-artifacts',
      agents: [agent],
      edges: [],
      messages: [],
      events: [],
      runs: [run],
      createdAt: startedAt,
      updatedAt: startedAt,
    };

    const changed = await applyRuntimeDoneArtifactCompletion(
      cluster as never,
      run as never,
      child as never,
      agent as never,
      { status: 'done', updatedAt: now },
      now,
    );
    updateRootRunStatus(cluster as never, run as never, now);

    expect(changed).toBe(true);
    expect(child.status).toBe('completed');
    expect(child.completionSource).toBe('fallback');
    expect(child.artifactValidationStatus).toBe('passed');
    expect(child.artifacts).toEqual(['worker/round_1/final.json']);
    expect(run.nodeRuns[0].status).toBe('completed');
    expect(run.status).toBe('completed');
    expect(cluster.activeRunId).toBeNull();
    expect(cluster.events.at(-1)?.title).toBe('自动识别完成');
  });

  it('does not complete a done runtime session when required artifacts are missing', async () => {
    const { applyRuntimeDoneArtifactCompletion } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-done-missing-'));
    const now = new Date().toISOString();
    const agent = {
      agentId: 'worker',
      name: 'Worker',
      role: '执行者',
      status: 'running',
      localContext: { agentId: 'worker', status: 'running', outputs: [] },
    };
    const child = {
      agentId: 'worker',
      workflowNodeId: 'agent:worker',
      sessionKey: 'agent:main:subagent:worker',
      runId: 'runtime-worker',
      status: 'running',
      submitStatus: 'submitted',
      startedAt: now,
      updatedAt: now,
      iteration: 1,
    };
    const run = {
      runId: 'run-done-missing',
      outputRoot,
      childRuns: [child],
      nodeRuns: [{ nodeId: 'agent:worker', status: 'running', attempt: 1, updatedAt: now }],
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:worker',
          type: 'agent',
          name: 'Worker',
          agentId: 'worker',
          outputContract: { requiredArtifacts: ['worker/round_<round>/final.json'] },
        }],
        edges: [],
      },
    };
    const cluster = {
      clusterId: 'cluster-done-missing',
      clusterName: 'Done Missing',
      projectRoot: outputRoot,
      sharedContext: { latestArtifacts: [], agentSummaries: [] },
      agents: [agent],
      events: [],
    };

    const changed = await applyRuntimeDoneArtifactCompletion(
      cluster as never,
      run as never,
      child as never,
      agent as never,
      { status: 'done', updatedAt: now },
      now,
    );

    expect(changed).toBe(false);
    expect(child.status).toBe('running');
  });

  it('does not complete a failed runtime session even when artifacts exist', async () => {
    const { applyRuntimeDoneArtifactCompletion } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-failed-artifacts-'));
    await mkdir(join(outputRoot, 'worker', 'round_1'), { recursive: true });
    await writeFile(join(outputRoot, 'worker', 'round_1', 'final.json'), '{"ok":true}', 'utf8');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'worker',
      name: 'Worker',
      role: '执行者',
      status: 'running',
      localContext: { agentId: 'worker', status: 'running', outputs: [] },
    };
    const child = {
      agentId: 'worker',
      workflowNodeId: 'agent:worker',
      sessionKey: 'agent:main:subagent:worker',
      runId: 'runtime-worker',
      status: 'running',
      submitStatus: 'submitted',
      startedAt: now,
      updatedAt: now,
      iteration: 1,
    };
    const run = {
      runId: 'run-failed-artifacts',
      outputRoot,
      childRuns: [child],
      nodeRuns: [{ nodeId: 'agent:worker', status: 'running', attempt: 1, updatedAt: now }],
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:worker',
          type: 'agent',
          name: 'Worker',
          agentId: 'worker',
          outputContract: { requiredArtifacts: ['worker/round_<round>/final.json'] },
        }],
        edges: [],
      },
    };
    const cluster = {
      clusterId: 'cluster-failed-artifacts',
      clusterName: 'Failed Artifacts',
      projectRoot: outputRoot,
      sharedContext: { latestArtifacts: [], agentSummaries: [] },
      agents: [agent],
      events: [],
    };

    const changed = await applyRuntimeDoneArtifactCompletion(
      cluster as never,
      run as never,
      child as never,
      agent as never,
      { status: 'failed', error: 'runtime failed', updatedAt: now },
      now,
    );

    expect(changed).toBe(false);
    expect(child.status).toBe('running');
  });

  it('recovers a submit RPC timeout when the runtime session later finishes with required artifacts', async () => {
    const { applyRuntimeDoneArtifactCompletion, updateRootRunStatus } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-submit-timeout-recovery-'));
    await mkdir(join(outputRoot, 'worker-3', 'round_3'), { recursive: true });
    await writeFile(join(outputRoot, 'worker-3', 'round_3', 'final.json'), '{"ok":true}', 'utf8');
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const now = new Date().toISOString();
    const makeAgent = (agentId: string, status = 'done') => ({
      agentId,
      name: agentId,
      role: '执行者',
      description: '',
      responsibilities: [],
      status,
      systemPrompt: '',
      tools: [],
      capabilities: [],
      currentTask: '',
      localContext: {
        agentId,
        systemPrompt: '',
        role: '执行者',
        responsibilities: [],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status,
      },
    });
    const agents = [
      makeAgent('worker-1'),
      makeAgent('worker-2'),
      makeAgent('worker-3', 'error'),
    ];
    const finalChild = {
      agentId: 'worker-3',
      workflowNodeId: 'agent:worker-3',
      sessionKey: 'agent:main:subagent:worker-3',
      runId: '',
      status: 'error',
      submitStatus: 'failed',
      error: 'RPC timeout: agent',
      startedAt,
      updatedAt: startedAt,
      iteration: 3,
    };
    const run = {
      runId: 'run-submit-timeout-recovery',
      mode: 'subagent_swarm',
      status: 'blocked',
      harnessStatus: 'paused',
      sessionKey: 'agent:main:cluster-submit-timeout-recovery',
      outputRoot,
      startedAt,
      updatedAt: startedAt,
      childRuns: [{
        agentId: 'worker-1',
        workflowNodeId: 'agent:worker-1',
        sessionKey: 'agent:main:subagent:worker-1',
        runId: 'runtime-worker-1',
        status: 'completed',
        submitStatus: 'submitted',
        startedAt,
        updatedAt: startedAt,
        completedAt: startedAt,
        iteration: 3,
        artifactValidationStatus: 'passed',
      }, {
        agentId: 'worker-2',
        workflowNodeId: 'agent:worker-2',
        sessionKey: 'agent:main:subagent:worker-2',
        runId: 'runtime-worker-2',
        status: 'completed',
        submitStatus: 'submitted',
        startedAt,
        updatedAt: startedAt,
        completedAt: startedAt,
        iteration: 3,
        artifactValidationStatus: 'passed',
      }, finalChild],
      nodeRuns: [{
        nodeId: 'agent:worker-1',
        status: 'completed',
        attempt: 1,
        startedAt,
        updatedAt: startedAt,
        completedAt: startedAt,
      }, {
        nodeId: 'agent:worker-2',
        status: 'completed',
        attempt: 1,
        startedAt,
        updatedAt: startedAt,
        completedAt: startedAt,
      }, {
        nodeId: 'agent:worker-3',
        status: 'failed',
        attempt: 1,
        error: 'RPC timeout: agent',
        startedAt,
        updatedAt: startedAt,
      }, {
        nodeId: 'loop:workers',
        status: 'waiting',
        attempt: 1,
        startedAt,
        updatedAt: startedAt,
      }],
      loopStates: [{
        loopId: 'loop:workers',
        currentIteration: 1,
        repeatCount: 2,
        outputRoundStart: 3,
        status: 'running',
        updatedAt: startedAt,
      }],
      workflowSnapshot: {
        workflowId: 'workflow-submit-timeout-recovery',
        version: 1,
        status: 'confirmed',
        createdBy: 'user',
        createdAt: startedAt,
        updatedAt: startedAt,
        policy: {
          maxConcurrency: 1,
          defaultTimeoutMs: 1000,
          defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
        },
        nodes: [{
          nodeId: 'agent:worker-1',
          type: 'agent',
          name: 'Worker 1',
          agentId: 'worker-1',
        }, {
          nodeId: 'agent:worker-2',
          type: 'agent',
          name: 'Worker 2',
          agentId: 'worker-2',
        }, {
          nodeId: 'agent:worker-3',
          type: 'agent',
          name: 'Worker 3',
          agentId: 'worker-3',
          outputContract: { requiredArtifacts: ['worker-3/round_<round>/final.json'] },
        }, {
          nodeId: 'loop:workers',
          type: 'loop',
          name: 'Workers Loop',
          bodyNodeIds: ['agent:worker-1', 'agent:worker-2', 'agent:worker-3'],
          repeatCount: 2,
        }],
        edges: [{
          edgeId: 'edge-1-2',
          fromNodeId: 'agent:worker-1',
          toNodeId: 'agent:worker-2',
          kind: 'control',
        }, {
          edgeId: 'edge-2-3',
          fromNodeId: 'agent:worker-2',
          toNodeId: 'agent:worker-3',
          kind: 'control',
        }],
      },
    };
    const cluster = {
      clusterId: 'cluster-submit-timeout-recovery',
      clusterName: 'Submit Timeout Recovery',
      sourceType: 'existing_task',
      sourceContent: '',
      projectRoot: outputRoot,
      sourceFolderPath: outputRoot,
      sharedContext: {
        globalGoal: '',
        originalInput: '',
        decompositionPlan: '',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-submit-timeout-recovery',
      agents,
      edges: [],
      messages: [],
      events: [],
      runs: [run],
      createdAt: startedAt,
      updatedAt: startedAt,
    };

    const changed = await applyRuntimeDoneArtifactCompletion(
      cluster as never,
      run as never,
      finalChild as never,
      agents[2] as never,
      { status: 'done', updatedAt: now },
      now,
    );
    updateRootRunStatus(cluster as never, run as never, now);

    expect(changed).toBe(true);
    expect(finalChild.status).toBe('blocked');
    expect(finalChild.submitStatus).toBe('pending');
    expect(finalChild.iteration).toBe(4);
    expect(finalChild.error).toBeUndefined();
    expect(run.loopStates[0].currentIteration).toBe(2);
    expect(run.loopStates[0].status).toBe('running');
    expect(run.childRuns[0].status).toBe('starting');
    expect(run.childRuns[0].iteration).toBe(4);
    expect(run.childRuns[1].status).toBe('blocked');
    expect(run.childRuns[2].status).toBe('blocked');
    expect(cluster.events.some((event) =>
      event.title === '自动识别完成' && event.content.includes('提交/RPC 错误')
    )).toBe(true);
  });

  it('does not recover non-submission runtime errors from done artifacts', async () => {
    const { applyRuntimeDoneArtifactCompletion } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-non-submit-error-'));
    await mkdir(join(outputRoot, 'worker', 'round_1'), { recursive: true });
    await writeFile(join(outputRoot, 'worker', 'round_1', 'final.json'), '{"ok":true}', 'utf8');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'worker',
      name: 'Worker',
      role: '执行者',
      status: 'error',
      localContext: { agentId: 'worker', status: 'error', outputs: [] },
    };
    const child = {
      agentId: 'worker',
      workflowNodeId: 'agent:worker',
      sessionKey: 'agent:main:subagent:worker',
      runId: 'runtime-worker',
      status: 'error',
      submitStatus: 'failed',
      error: 'tool execution failed',
      runtimeFailureKind: 'runtime_error',
      startedAt: now,
      updatedAt: now,
      iteration: 1,
    };
    const run = {
      runId: 'run-non-submit-error',
      outputRoot,
      childRuns: [child],
      nodeRuns: [{ nodeId: 'agent:worker', status: 'failed', attempt: 1, updatedAt: now }],
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:worker',
          type: 'agent',
          name: 'Worker',
          agentId: 'worker',
          outputContract: { requiredArtifacts: ['worker/round_<round>/final.json'] },
        }],
        edges: [],
      },
    };
    const cluster = {
      clusterId: 'cluster-non-submit-error',
      clusterName: 'Non Submit Error',
      projectRoot: outputRoot,
      sharedContext: { latestArtifacts: [], agentSummaries: [] },
      agents: [agent],
      events: [],
    };

    const changed = await applyRuntimeDoneArtifactCompletion(
      cluster as never,
      run as never,
      child as never,
      agent as never,
      { status: 'done', updatedAt: now },
      now,
    );

    expect(changed).toBe(false);
    expect(child.status).toBe('error');
  });

  it('settles the root run when the final loop agent session is done and artifacts passed', async () => {
    const { applyRuntimeDoneArtifactCompletion, updateRootRunStatus } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-loop-done-artifacts-'));
    await mkdir(join(outputRoot, 'worker-3', 'round_2'), { recursive: true });
    await writeFile(join(outputRoot, 'worker-3', 'round_2', 'final.json'), '{"ok":true}', 'utf8');
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const now = new Date().toISOString();
    const makeAgent = (agentId: string, status = 'done') => ({
      agentId,
      name: agentId,
      role: '执行者',
      description: '',
      responsibilities: [],
      status,
      systemPrompt: '',
      tools: [],
      capabilities: [],
      currentTask: '',
      localContext: {
        agentId,
        systemPrompt: '',
        role: '执行者',
        responsibilities: [],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status,
      },
    });
    const agents = [
      makeAgent('worker-1'),
      makeAgent('worker-2'),
      makeAgent('worker-3', 'running'),
    ];
    const finalChild = {
      agentId: 'worker-3',
      workflowNodeId: 'agent:worker-3',
      sessionKey: 'agent:main:subagent:worker-3',
      runId: 'runtime-worker-3',
      status: 'running',
      submitStatus: 'submitted',
      startedAt,
      updatedAt: startedAt,
      iteration: 2,
    };
    const run = {
      runId: 'run-loop-done-artifacts',
      mode: 'subagent_swarm',
      status: 'running',
      harnessStatus: 'running',
      sessionKey: 'agent:main:cluster-loop-done-artifacts',
      outputRoot,
      startedAt,
      updatedAt: startedAt,
      childRuns: [{
        agentId: 'worker-1',
        workflowNodeId: 'agent:worker-1',
        sessionKey: 'agent:main:subagent:worker-1',
        runId: 'runtime-worker-1',
        status: 'completed',
        submitStatus: 'submitted',
        startedAt,
        updatedAt: startedAt,
        completedAt: startedAt,
        iteration: 2,
        artifactValidationStatus: 'passed',
      }, {
        agentId: 'worker-2',
        workflowNodeId: 'agent:worker-2',
        sessionKey: 'agent:main:subagent:worker-2',
        runId: 'runtime-worker-2',
        status: 'completed',
        submitStatus: 'submitted',
        startedAt,
        updatedAt: startedAt,
        completedAt: startedAt,
        iteration: 2,
        artifactValidationStatus: 'passed',
      }, finalChild],
      nodeRuns: [{
        nodeId: 'agent:worker-1',
        status: 'completed',
        attempt: 1,
        startedAt,
        updatedAt: startedAt,
        completedAt: startedAt,
      }, {
        nodeId: 'agent:worker-2',
        status: 'completed',
        attempt: 1,
        startedAt,
        updatedAt: startedAt,
        completedAt: startedAt,
      }, {
        nodeId: 'agent:worker-3',
        status: 'running',
        attempt: 1,
        startedAt,
        updatedAt: startedAt,
      }, {
        nodeId: 'loop:workers',
        status: 'waiting',
        attempt: 1,
        startedAt,
        updatedAt: startedAt,
      }],
      loopStates: [{
        loopId: 'loop:workers',
        currentIteration: 2,
        repeatCount: 2,
        outputRoundStart: 1,
        status: 'running',
        updatedAt: startedAt,
      }],
      workflowSnapshot: {
        workflowId: 'workflow-loop-done-artifacts',
        version: 1,
        status: 'confirmed',
        createdBy: 'user',
        createdAt: startedAt,
        updatedAt: startedAt,
        policy: {
          maxConcurrency: 1,
          defaultTimeoutMs: 1000,
          defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
        },
        nodes: [{
          nodeId: 'agent:worker-1',
          type: 'agent',
          name: 'Worker 1',
          agentId: 'worker-1',
        }, {
          nodeId: 'agent:worker-2',
          type: 'agent',
          name: 'Worker 2',
          agentId: 'worker-2',
        }, {
          nodeId: 'agent:worker-3',
          type: 'agent',
          name: 'Worker 3',
          agentId: 'worker-3',
          outputContract: { requiredArtifacts: ['worker-3/round_<round>/final.json'] },
        }, {
          nodeId: 'loop:workers',
          type: 'loop',
          name: 'Workers Loop',
          bodyNodeIds: ['agent:worker-1', 'agent:worker-2', 'agent:worker-3'],
          repeatCount: 2,
        }],
        edges: [{
          edgeId: 'edge-1-2',
          fromNodeId: 'agent:worker-1',
          toNodeId: 'agent:worker-2',
          kind: 'control',
        }, {
          edgeId: 'edge-2-3',
          fromNodeId: 'agent:worker-2',
          toNodeId: 'agent:worker-3',
          kind: 'control',
        }],
      },
    };
    const cluster = {
      clusterId: 'cluster-loop-done-artifacts',
      clusterName: 'Loop Done Artifacts',
      sourceType: 'existing_task',
      sourceContent: '',
      projectRoot: outputRoot,
      sourceFolderPath: outputRoot,
      sharedContext: {
        globalGoal: '',
        originalInput: '',
        decompositionPlan: '',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-loop-done-artifacts',
      agents,
      edges: [],
      messages: [],
      events: [],
      runs: [run],
      createdAt: startedAt,
      updatedAt: startedAt,
    };

    const changed = await applyRuntimeDoneArtifactCompletion(
      cluster as never,
      run as never,
      finalChild as never,
      agents[2] as never,
      { status: 'done', updatedAt: now },
      now,
    );
    updateRootRunStatus(cluster as never, run as never, now);

    expect(changed).toBe(true);
    expect(finalChild.status).toBe('completed');
    expect(run.loopStates[0].status).toBe('completed');
    expect(run.loopStates[0].currentIteration).toBe(2);
    expect(run.nodeRuns.find((nodeRun) => nodeRun.nodeId === 'loop:workers')?.status).toBe('completed');
    expect(run.status).toBe('completed');
    expect(cluster.activeRunId).toBeNull();
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

  it('settles terminal timeout runs into readable agent display states', async () => {
    const { updateRootRunStatus } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const run = {
      runId: 'run-timeout',
      mode: 'subagent_swarm',
      status: 'running',
      harnessStatus: 'running',
      sessionKey: 'agent:main:cluster-test',
      startedAt: stale,
      updatedAt: stale,
      timeoutAt: new Date(Date.now() - 1000).toISOString(),
      childRuns: [{
        agentId: 'agent-a',
        sessionKey: 'agent:main:subagent:cluster-test-a',
        runId: 'child-a',
        status: 'completed',
        submitStatus: 'submitted',
        startedAt: stale,
        updatedAt: stale,
        completedAt: stale,
      }, {
        agentId: 'agent-b',
        sessionKey: 'agent:main:subagent:cluster-test-b',
        runId: 'child-b',
        status: 'running',
        submitStatus: 'submitted',
        startedAt: stale,
        updatedAt: stale,
        lastEventAt: stale,
        runtimeWaitReason: '等待子会话产物',
      }, {
        agentId: 'agent-c',
        sessionKey: 'agent:main:subagent:cluster-test-c',
        runId: '',
        status: 'blocked',
        submitStatus: 'pending',
        startedAt: stale,
        updatedAt: stale,
      }],
    };
    const makeAgent = (agentId: string, status = 'running') => ({
      agentId,
      name: agentId,
      role: agentId,
      description: '',
      responsibilities: [],
      status,
      systemPrompt: '',
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: '',
        role: agentId,
        responsibilities: [],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status,
      },
    });
    const cluster = {
      clusterId: 'cluster-test',
      clusterName: '集群',
      activeRunId: run.runId,
      agents: [makeAgent('agent-a'), makeAgent('agent-b'), makeAgent('agent-c', 'waiting')],
      edges: [{
        edgeId: 'edge-a-b',
        fromAgentId: 'agent-a',
        toAgentId: 'agent-b',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }, {
        edgeId: 'edge-b-c',
        fromAgentId: 'agent-b',
        toAgentId: 'agent-c',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }],
      runs: [run],
    };

    updateRootRunStatus(cluster as never, run as never, now);

    expect(run.status).toBe('timeout');
    expect(cluster.activeRunId).toBeNull();
    expect(cluster.agents.find((agent) => agent.agentId === 'agent-a')?.status).toBe('done');
    expect(cluster.agents.find((agent) => agent.agentId === 'agent-b')?.status).toBe('error');
    expect(cluster.agents.find((agent) => agent.agentId === 'agent-b')?.runtimeStatusReason).toBe('运行超时');
    expect(cluster.agents.find((agent) => agent.agentId === 'agent-c')?.status).toBe('waiting');
    expect(cluster.agents.find((agent) => agent.agentId === 'agent-c')?.currentTask).toBe('上游未完成，未启动');
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

  it('summarizes done OpenClaw sessions that ended without required artifacts', async () => {
    const { summarizeRuntimeDoneMissingArtifacts } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-missing-artifacts-'));
    const sessionFile = join(outputRoot, 'session.jsonl');
    await writeFile(sessionFile, JSON.stringify({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '输出思路已经形成，但还没有写文件。' }],
    }), 'utf8');
    const now = new Date().toISOString();
    const run = {
      runId: 'run-1',
      outputRoot,
      childRuns: [],
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:worker',
          type: 'agent',
          name: 'Worker Agent',
          agentId: 'worker',
          outputContract: {
            requiredArtifacts: [
              'worker/round_<round>/intermediate_draft.json',
              'worker/round_<round>/final_report.json',
            ],
          },
        }],
        edges: [],
      },
      startedAt: now,
      updatedAt: now,
    };
    const child = {
      agentId: 'worker',
      sessionKey: 'agent:investclaw-test-runtime-limits:subagent:worker',
      iteration: 1,
      status: 'running',
      submitStatus: 'submitted',
      startedAt: now,
      updatedAt: now,
    };
    const agent = {
      agentId: 'worker',
      name: 'Worker Agent',
      role: '执行 Agent',
    };

    const summary = await summarizeRuntimeDoneMissingArtifacts(
      { status: 'done', runtimeMs: 206_000, sessionFile },
      run as never,
      child as never,
      agent as never,
    );

    expect(summary).toContain('OpenClaw 子会话已结束');
    expect(summary).toContain('intermediate_draft.json');
    expect(summary).toContain('未落盘显式契约要求的中间产物或最终产物');
    expect(summary).toContain('final_report.json');
  });

  it('explains missing artifacts caused by model output length truncation', async () => {
    const { summarizeRuntimeDoneMissingArtifacts } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-length-missing-artifacts-'));
    const sessionFile = join(outputRoot, 'session.jsonl');
    await writeFile(sessionFile, JSON.stringify({
      message: {
        role: 'assistant',
        stopReason: 'length',
        content: [{ type: 'thinking', thinking: '候选已经设计完，但还没来得及写 part_01.json。' }],
      },
    }), 'utf8');
    const now = new Date().toISOString();
    const run = {
      runId: 'run-length',
      outputRoot,
      childRuns: [],
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:worker',
          type: 'agent',
          name: 'Worker Agent',
          agentId: 'worker',
          outputContract: {
            requiredArtifacts: [
              'worker/round_<round>/candidate_parts/part_01.json',
              'worker/round_<round>/final_report.json',
            ],
          },
        }],
        edges: [],
      },
      startedAt: now,
      updatedAt: now,
    };
    const child = {
      agentId: 'worker',
      sessionKey: 'agent:investclaw-test-runtime-limits:subagent:worker',
      iteration: 1,
      status: 'running',
      submitStatus: 'submitted',
      startedAt: now,
      updatedAt: now,
    };
    const agent = {
      agentId: 'worker',
      name: 'Worker Agent',
      role: '执行 Agent',
    };

    const summary = await summarizeRuntimeDoneMissingArtifacts(
      { status: 'done', runtimeMs: 95_000, sessionFile, model: 'TestModel' },
      run as never,
      child as never,
      agent as never,
    );

    expect(summary).toContain('模型输出被长度上限截断');
    expect(summary).toContain('stopReason=length');
    expect(summary).toContain('这不是 Harness 给了 95 秒超时');
    expect(summary).toContain('无法读取当前运行 agent(investclaw-test-runtime-limits) 的 models.json');
    expect(summary).toContain('part_01.json');
  });

  it('does not auto-retry incomplete output failures', async () => {
    const { runtimeFailureAllowsAutoRetry } = await import('@electron/utils/agent-clusters');

    expect(runtimeFailureAllowsAutoRetry('runtime_error')).toBe(false);
    expect(runtimeFailureAllowsAutoRetry(undefined)).toBe(true);
    expect(runtimeFailureAllowsAutoRetry('incomplete_output')).toBe(false);
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

  it('does not infer output artifacts from Agent names', async () => {
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
      makeAgent('agent-a', 'Agent_A_Source_Intake', '数据接入'),
      makeAgent('agent-b', 'Agent_B_Normalize_Dedupe', '规范化与去重'),
      makeAgent('agent-factor', 'Agent_B_Factor_Generator', '因子生成器'),
    ];
    const workflow = buildWorkflowFromExecutionGraph(
      'cluster-test',
      agents as Parameters<typeof buildWorkflowFromExecutionGraph>[1],
      {
        nodes: agents.map((agent, index) => ({ agentId: agent.agentId, x: index * 200, y: 0 })),
        edges: [],
        loops: [],
        confirmed: false,
        updatedAt: new Date().toISOString(),
      },
      'migration',
    );

    const normalizeNode = workflow.nodes.find((node) => node.nodeId === 'agent:agent-b');
    const factorNode = workflow.nodes.find((node) => node.nodeId === 'agent:agent-factor');

    expect(normalizeNode?.outputContract?.requiredArtifacts).toBeUndefined();
    expect(factorNode?.outputContract?.requiredArtifacts).toBeUndefined();
  });

  it('builds directory-mode child prompts without overriding project canonical output dirs', async () => {
    const { buildAgentChildPrompt } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-b',
      name: 'Agent_B_Factor_Generator',
      role: '因子生成器',
      description: 'Generate candidates',
      responsibilities: ['调用项目稳定工具生成候选'],
      status: 'idle',
      systemPrompt: '项目权威 prompt：请使用 agent_b/round_<n> canonical output dir。',
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-b',
        systemPrompt: '',
        role: '因子生成器',
        responsibilities: ['调用项目稳定工具生成候选'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };
    const cluster = {
      clusterId: 'cluster-contract',
      clusterName: '集群',
      sourceType: 'existing_task',
      sourceContent: '',
      projectRoot: '/project/factor_mining_v3',
      sourceFolderPath: '/project/factor_mining_v3',
      activeRunId: 'run-1',
      sharedContext: {
        globalGoal: 'Run factor pipeline',
        originalInput: '',
        decompositionPlan: 'A -> B -> C -> D',
        constraints: ['遵守项目 stable tools 和 canonical output dirs'],
        facts: [
          '当前事实：项目提供 agents/tools/shared_agent_contract.md',
          '上次实验（2026-04-24）：414 候选，8 入库（7 确定性 + 1 LLM）。',
          ...Array.from({ length: 20 }, (_, index) => `历史实验 ${index + 1}：旧 version_${index + 1}_20260501 scorecard.csv 中的长旧事实不应进入子 Agent prompt。`),
        ],
        historicalNotes: ['上次实验：2026-04-24 有旧 scorecard.csv'],
        projectContractSummary: '项目 canonical output dirs：Agent B 使用 experiment_results/<run_root>/agent_b/round_<n>/。',
        currentRunContext: '当前 run facts 只来自上游结构化输出。',
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      agents: [agent],
      edges: [],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'running',
        harnessStatus: 'running',
        sessionKey: 'agent:main:cluster-contract',
        startedAt: now,
        updatedAt: now,
        outputRoot: '/project/factor_mining_v3/experiment_results/version_1_20260623',
        childRuns: [{
          agentId: 'agent-b',
          sessionKey: 'agent:main:subagent:contract-b',
          runId: 'child-b',
          status: 'starting',
          submitStatus: 'pending',
          startedAt: now,
          updatedAt: now,
          outputRelativeDir: 'agents/agent-b/round_1',
          iteration: 1,
        }],
        nodeRuns: [{
          nodeId: 'agent:agent-b',
          status: 'running',
          startedAt: now,
          updatedAt: now,
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 4,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: [{
            nodeId: 'agent:agent-b',
            type: 'agent',
            name: 'Agent_B_Factor_Generator',
            agentId: 'agent-b',
            outputContract: {
              requiredArtifacts: [
                'agent_b/round_1/candidate_parts/part_XX.json',
                'agent_b/round_1/llm_candidates.json',
                'agent_b/round_1/agent_b_summary.json',
              ],
            },
          }],
          edges: [],
        },
      }],
      createdAt: now,
      updatedAt: now,
    };

    const prompt = buildAgentChildPrompt(cluster as never, agent as never);

    expect(prompt).toContain('运行模式：项目目录模式 / Thin Harness');
    expect(prompt).toContain('agent_b/round_1/candidate_parts/part_XX.json');
    expect(prompt).toContain('agent_b/round_1/llm_candidates.json');
    expect(prompt).not.toContain('共享上下文摘要');
    expect(prompt).not.toContain('Harness dataMapping 已解析输入');
    expect(prompt).not.toContain('Harness 节点契约');
    expect(prompt).not.toContain('--history-scorecard');
    expect(prompt).not.toContain('工具命令优先显式传入：--output-dir agents/agent-b/round_1');
    expect(prompt).not.toContain('你的 Agent 专属输出目录');
    expect(prompt).not.toContain('你的 Agent 专属相对输出目录');
    expect(prompt).not.toContain('scorecard.csv');
    expect(prompt).not.toContain('上次实验');
    expect(prompt).not.toContain('414 候选');
    expect(prompt).not.toContain('旧 version_');
    expect(prompt.length).toBeLessThan(8_000);
  });

  it('filters audit and contract artifacts from AgentB injected upstream context', async () => {
    const { buildAgentChildPrompt } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agentA = {
      agentId: 'agent-a',
      name: 'Agent_A_Data_Steward',
      role: '数据管家',
      description: 'Prepare data',
      responsibilities: ['准备字段'],
      status: 'done',
      systemPrompt: 'Agent A',
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-a',
        systemPrompt: '',
        role: '数据管家',
        responsibilities: ['准备字段'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [{ outputId: 'out-a', agentId: 'agent-a', content: '已输出 feature_inventory.json。旧 scorecard.csv 不应进入下游。', createdAt: now }],
        status: 'done',
      },
    };
    const agentB = {
      agentId: 'agent-b',
      name: 'Agent_B_Factor_Generator',
      role: '因子候选生成器',
      description: 'Generate candidates',
      responsibilities: ['生成候选'],
      status: 'running',
      systemPrompt: '只读 generation_context.json。',
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-b',
        systemPrompt: '',
        role: '因子候选生成器',
        responsibilities: ['生成候选'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'running',
      },
    };
    const cluster = {
      clusterId: 'cluster-filter',
      clusterName: '集群',
      sourceType: 'existing_task',
      sourceContent: '',
      projectRoot: '/project/factor_mining_v3',
      sourceFolderPath: '/project/factor_mining_v3',
      activeRunId: 'run-1',
      sharedContext: {
        globalGoal: 'Run factor pipeline',
        originalInput: '',
        decompositionPlan: 'A -> B',
        constraints: [],
        facts: [],
        historicalNotes: [],
        projectContractSummary: 'shared_agent_contract.md',
        currentRunContext: '当前 run facts only',
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [
          { agentId: 'agent-a', artifact: 'experiment_results/version_1/agent_a/feature_inventory.json', createdAt: now },
          { agentId: 'agent-a', artifact: 'agents/tools/shared_agent_contract.md', createdAt: now },
          { agentId: 'agent-a', artifact: 'scorecard.csv', createdAt: now },
        ],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      agents: [agentA, agentB],
      edges: [{
        edgeId: 'edge-a-b',
        fromAgentId: 'agent-a',
        toAgentId: 'agent-b',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'running',
        harnessStatus: 'running',
        sessionKey: 'agent:main:cluster-filter',
        startedAt: now,
        updatedAt: now,
        outputRoot: '/project/factor_mining_v3/experiment_results/version_1',
        childRuns: [{
          agentId: 'agent-a',
          sessionKey: 'agent:main:subagent:a',
          runId: 'child-a',
          status: 'completed',
          submitStatus: 'submitted',
          startedAt: now,
          updatedAt: now,
          artifacts: [
            'experiment_results/version_1/agent_a/feature_inventory.json',
            'agents/tools/shared_agent_contract.md',
            'scorecard.csv',
          ],
          expectedArtifacts: ['experiment_results/version_1/agent_a/feature_inventory.json'],
          artifactValidationStatus: 'passed',
          iteration: 1,
        }, {
          agentId: 'agent-b',
          sessionKey: 'agent:main:subagent:b',
          runId: 'child-b',
          status: 'running',
          submitStatus: 'submitted',
          startedAt: now,
          updatedAt: now,
          iteration: 1,
          workflowNodeId: 'agent:agent-b',
        }],
        nodeRuns: [{
          nodeId: 'agent:agent-a',
          status: 'completed',
          startedAt: now,
          updatedAt: now,
          output: {
            artifacts: [
              'experiment_results/version_1/agent_a/feature_inventory.json',
              'agents/tools/shared_agent_contract.md',
              'scorecard.csv',
            ],
            summary: 'Agent A 完成。旧 scorecard.csv 不应作为当前事实。',
          },
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 4,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: [
            {
              nodeId: 'agent:agent-a',
              type: 'agent',
              name: 'Agent_A_Data_Steward',
              agentId: 'agent-a',
              outputContract: { requiredArtifacts: ['experiment_results/version_1/agent_a/feature_inventory.json'] },
            },
            { nodeId: 'agent:agent-b', type: 'agent', name: 'Agent_B_Factor_Generator', agentId: 'agent-b' },
          ],
          edges: [{ edgeId: 'wf-edge-a-b', fromNodeId: 'agent:agent-a', toNodeId: 'agent:agent-b', kind: 'control' }],
        },
      }],
      createdAt: now,
      updatedAt: now,
    };

    const prompt = buildAgentChildPrompt(cluster as never, agentB as never);

    expect(prompt).toContain('feature_inventory.json');
    expect(prompt).not.toContain('scorecard.csv');
    expect(prompt).not.toContain('本轮上游产物：agents/tools/shared_agent_contract.md');
  });

  it('resolves workflow artifact contracts relative to outputRoot before harness mirror dirs', async () => {
    const { resolveExpectedArtifactPathsForRunAgent } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const run = {
      runId: 'run-1',
      outputRoot: '/project/experiment_results/version_1_20260623',
      childRuns: [],
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:agent-b',
          type: 'agent',
          name: 'Agent_B',
          agentId: 'agent-b',
          outputContract: {
            requiredArtifacts: [
              'agent_b/round_1/llm_candidates.json',
              'agent_b/round_1/agent_b_summary.json',
              'scorecard.csv',
              'memory.md',
            ],
          },
        }],
        edges: [],
      },
      startedAt: now,
      updatedAt: now,
    };
    const child = {
      agentId: 'agent-b',
      outputRelativeDir: 'agents/agent-b/round_1',
      iteration: 1,
      startedAt: now,
      updatedAt: now,
    };
    const agent = {
      agentId: 'agent-b',
      name: 'Agent_B_Normalize_Dedupe',
      role: '规范化与去重',
    };

    expect(resolveExpectedArtifactPathsForRunAgent(run as never, child as never, agent as never)).toEqual([
      '/project/experiment_results/version_1_20260623/agent_b/round_1/llm_candidates.json',
      '/project/experiment_results/version_1_20260623/agent_b/round_1/agent_b_summary.json',
      '/project/experiment_results/version_1_20260623/scorecard.csv',
      '/project/experiment_results/version_1_20260623/memory.md',
    ]);
  });

  it('treats artifact strings as literal paths unless the contract declares glob matching', async () => {
    const { resolveExpectedArtifactMatchesForRunAgent } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-parts-'));
    const roundDir = join(outputRoot, 'agent_b', 'round_1', 'candidate_parts');
    await mkdir(roundDir, { recursive: true });
    await writeFile(join(roundDir, 'part_01.json'), '[]', 'utf8');
    await writeFile(join(roundDir, 'notes.txt'), 'ignore', 'utf8');
    const now = new Date().toISOString();
    const run = {
      runId: 'run-1',
      outputRoot,
      childRuns: [],
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:agent-b',
          type: 'agent',
          name: 'Agent_B',
          agentId: 'agent-b',
          outputContract: {
            requiredArtifacts: [{ path: 'agent_b/round_<round>/candidate_parts/*.json', match: 'glob' }],
          },
        }],
        edges: [],
      },
      startedAt: now,
      updatedAt: now,
    };
    const child = {
      agentId: 'agent-b',
      iteration: 1,
      startedAt: now,
      updatedAt: now,
    };
    const agent = { agentId: 'agent-b', name: 'Agent_B_Factor_Generator', role: '因子生成器' };

    expect(await resolveExpectedArtifactMatchesForRunAgent(run as never, child as never, agent as never)).toEqual([
      join(roundDir, 'part_01.json'),
    ]);
  });

  it('matches root-level workflow artifacts at outputRoot', async () => {
    const { resolveExpectedArtifactMatchesForRunAgent } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-root-artifacts-'));
    await writeFile(join(outputRoot, 'scorecard.csv'), 'name,total_score\nfactor,0.1\n', 'utf8');
    await mkdir(join(outputRoot, 'agent_d', 'round_1'), { recursive: true });
    await writeFile(join(outputRoot, 'agent_d', 'round_1', 'scorecard.csv'), 'name,total_score\nfactor,0.1\n', 'utf8');
    const now = new Date().toISOString();
    const run = {
      runId: 'run-root-artifacts',
      outputRoot,
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:agent-d',
          type: 'agent',
          name: 'Agent_D_Research_Librarian',
          agentId: 'agent-d',
          outputContract: {
            requiredArtifacts: ['agent_d/round_<round>/scorecard.csv', 'scorecard.csv'],
          },
        }],
        edges: [],
      },
      startedAt: now,
      updatedAt: now,
    };
    const child = {
      agentId: 'agent-d',
      outputRelativeDir: 'agents/agent-d/round_1',
      iteration: 1,
      startedAt: now,
      updatedAt: now,
    };
    const agent = {
      agentId: 'agent-d',
      name: 'Agent_D_Research_Librarian',
      role: '研究馆员',
    };

    expect(await resolveExpectedArtifactMatchesForRunAgent(run as never, child as never, agent as never)).toEqual([
      join(outputRoot, 'agent_d', 'round_1', 'scorecard.csv'),
      join(outputRoot, 'scorecard.csv'),
    ]);
  });

  it('does not expose partial contract artifacts as canonical completion artifacts', async () => {
    const { resolveExpectedArtifactMatchesForRunAgent } = await import('@electron/utils/agent-clusters');
    const outputRoot = await mkdtemp(join(tmpdir(), 'investclaw-partial-artifacts-'));
    const roundDir = join(outputRoot, 'agent_b', 'round_1');
    await mkdir(roundDir, { recursive: true });
    await writeFile(join(roundDir, 'generation_context.json'), '{}', 'utf8');
    await writeFile(join(roundDir, 'agent_b_context_summary.json'), '{}', 'utf8');
    const now = new Date().toISOString();
    const run = {
      runId: 'run-1',
      outputRoot,
      childRuns: [],
      workflowSnapshot: {
        nodes: [{
          nodeId: 'agent:agent-b',
          type: 'agent',
          name: 'Agent_B',
          agentId: 'agent-b',
          outputContract: {
            requiredArtifacts: [
              'agent_b/round_<round>/generation_context.json',
              'agent_b/round_<round>/agent_b_context_summary.json',
              'agent_b/round_<round>/candidate_parts/part_XX.json',
              'agent_b/round_<round>/llm_candidates.json',
            ],
          },
        }],
        edges: [],
      },
      startedAt: now,
      updatedAt: now,
    };
    const child = {
      agentId: 'agent-b',
      iteration: 1,
      startedAt: now,
      updatedAt: now,
    };
    const agent = { agentId: 'agent-b', name: 'Agent_B_Factor_Generator', role: '因子生成器' };

    expect(await resolveExpectedArtifactMatchesForRunAgent(run as never, child as never, agent as never)).toEqual([]);
  });

  it('derives canonical output contracts from project agent prompts instead of Agent letters', async () => {
    const { buildWorkflowFromExecutionGraph } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-b',
      name: 'Agent_B_Factor_Generator',
      role: '因子候选生成器',
      description: 'Generate candidates',
      responsibilities: ['生成候选'],
      status: 'idle',
      systemPrompt: [
        '# Agent_B_Factor_Generator',
        '稳定工具必须写入 canonical Agent B round 目录。',
        'uv run python agents/tools/agent_b_validate_llm_candidates.py \\',
        '  --candidate-parts-dir experiment_results/<run_root>/agent_b/round_<round>/candidate_parts \\',
        '  --output-root experiment_results/<run_root> \\',
        '  --output-dir experiment_results/<run_root>/agent_b/round_<round>',
        '',
        'Runtime Required Artifacts:',
        '```text',
        'agent_b/round_<round>/candidate_parts/part_XX.json',
        'agent_b/round_<round>/llm_candidates.json',
        'agent_b/round_<round>/agent_b_summary.json',
        '```',
      ].join('\n'),
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-b',
        systemPrompt: '',
        role: '因子候选生成器',
        responsibilities: ['生成候选'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };

    const workflow = buildWorkflowFromExecutionGraph(
      'cluster-contract',
      [agent] as Parameters<typeof buildWorkflowFromExecutionGraph>[1],
      {
        nodes: [{ agentId: 'agent-b', x: 0, y: 0 }],
        edges: [],
        loops: [],
        confirmed: false,
        updatedAt: now,
      },
      'migration',
    );
    const node = workflow.nodes.find((item) => item.nodeId === 'agent:agent-b');

    expect(node?.outputContract?.requiredArtifacts).toEqual(expect.arrayContaining([
      'agent_b/round_<round>/candidate_parts/part_XX.json',
      'agent_b/round_<round>/llm_candidates.json',
      'agent_b/round_<round>/agent_b_summary.json',
    ]));
    expect(node?.outputContract?.requiredArtifacts).not.toEqual(expect.arrayContaining([
      'agents/agent-b/round_<round>/llm_candidates.json',
      'agent_b/round_<round>/part_XX.json',
    ]));
  });

  it('does not infer output contracts from unmarked prose sections', async () => {
    const { buildWorkflowFromExecutionGraph } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-a',
      name: 'Generic_Agent',
      role: '通用 Agent',
      description: 'Generic task',
      responsibilities: ['运行任务'],
      status: 'idle',
      systemPrompt: [
        '# Generic_Agent',
        '输入可能来自 /external/source/actionable_guidance.jsonl。',
        '工具可能参考 README.md、HANDOFF.md 和 agents/tools/shared_agent_contract.md。',
        '输出示例不是契约：experiment_results/<run_root>/agent_a/feature_inventory.json。',
      ].join('\n'),
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-a',
        systemPrompt: '',
        role: '通用 Agent',
        responsibilities: ['运行任务'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };

    const workflow = buildWorkflowFromExecutionGraph(
      'cluster-contract',
      [agent] as Parameters<typeof buildWorkflowFromExecutionGraph>[1],
      {
        nodes: [{ agentId: 'agent-a', x: 0, y: 0 }],
        edges: [],
        loops: [],
        confirmed: false,
        updatedAt: now,
      },
      'migration',
    );
    const node = workflow.nodes.find((item) => item.nodeId === 'agent:agent-a');

    expect(node?.outputContract).toBeUndefined();
  });

  it('uses explicit runtime contracts instead of prose-derived artifacts', async () => {
    const { buildWorkflowFromExecutionGraph } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-worker',
      name: 'Worker',
      role: '执行者',
      description: 'Run project task',
      responsibilities: ['执行项目任务'],
      status: 'idle',
      systemPrompt: [
        '# Worker',
        'README.md 提到 outputs/example.csv，但这不是 contract。',
        'Runtime Required Artifacts:',
        '```text',
        'wrong/from-prompt.json',
        '```',
      ].join('\n'),
      runtimeContract: {
        agentName: 'Worker',
        requiredArtifacts: ['results/round_<round>/final.json'],
        optionalArtifacts: ['results/round_<round>/debug.md'],
        auditArtifacts: ['results/round_<round>/audit.csv'],
        stableCommand: 'python scripts/run_worker.py --round <round>',
      },
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-worker',
        systemPrompt: '',
        role: '执行者',
        responsibilities: ['执行项目任务'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };

    const workflow = buildWorkflowFromExecutionGraph(
      'cluster-contract',
      [agent] as Parameters<typeof buildWorkflowFromExecutionGraph>[1],
      {
        nodes: [{ agentId: 'agent-worker', x: 0, y: 0 }],
        edges: [],
        loops: [],
        confirmed: false,
        updatedAt: now,
      },
      'migration',
    );
    const node = workflow.nodes.find((item) => item.nodeId === 'agent:agent-worker');

    expect(node?.outputContract?.requiredArtifacts).toEqual(['results/round_<round>/final.json']);
    expect(node?.outputContract?.optionalArtifacts).toEqual(['results/round_<round>/debug.md']);
    expect(node?.outputContract?.auditArtifacts).toEqual(['results/round_<round>/audit.csv']);
    expect(node?.outputContract?.requiredArtifacts).not.toContain('wrong/from-prompt.json');
  });

  it('does not treat project contract markdown files as required output artifacts', async () => {
    const { buildWorkflowFromExecutionGraph } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-a',
      name: 'Agent_A_Data_Steward',
      role: '数据管家',
      description: 'Prepare fields',
      responsibilities: ['准备字段'],
      status: 'idle',
      systemPrompt: [
        '# Agent_A_Data_Steward',
        '先遵守 agents/tools/shared_agent_contract.md。',
        'uv run python agents/tools/agent_a_prepare_data.py \\',
        '  --output-root experiment_results/<run_root> \\',
        '  --output-dir experiment_results/<run_root>/agent_a',
        '',
        'Runtime Required Artifacts:',
        '```text',
        'agents/tools/shared_agent_contract.md',
        'README.md',
        'HANDOFF.md',
        'agent_a/feature_inventory.json',
        'agent_a/agent_a_summary.json',
        'agent_a/external_guidance_inventory.json',
        '```',
      ].join('\n'),
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-a',
        systemPrompt: '',
        role: '数据管家',
        responsibilities: ['准备字段'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };

    const workflow = buildWorkflowFromExecutionGraph(
      'cluster-contract',
      [agent] as Parameters<typeof buildWorkflowFromExecutionGraph>[1],
      {
        nodes: [{ agentId: 'agent-a', x: 0, y: 0 }],
        edges: [],
        loops: [],
        confirmed: false,
        updatedAt: now,
      },
      'migration',
    );
    const node = workflow.nodes.find((item) => item.nodeId === 'agent:agent-a');

    expect(node?.outputContract?.requiredArtifacts).toEqual(expect.arrayContaining([
      'agent_a/feature_inventory.json',
      'agent_a/agent_a_summary.json',
      'agent_a/external_guidance_inventory.json',
    ]));
    expect(node?.outputContract?.requiredArtifacts).not.toEqual(expect.arrayContaining([
      'agent_a/agents/tools/shared_agent_contract.md',
      'agent_a/README.md',
      'agent_a/HANDOFF.md',
      'agents/tools/shared_agent_contract.md',
      'README.md',
      'HANDOFF.md',
    ]));
  });

  it('keeps root-level project artifacts root-relative when deriving contracts', async () => {
    const { buildWorkflowFromExecutionGraph } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-d',
      name: 'Agent_D_Research_Librarian',
      role: '研究馆员',
      description: 'Archive results',
      responsibilities: ['归档'],
      status: 'idle',
      systemPrompt: [
        '# Agent_D_Research_Librarian',
        '默认调用：',
        'uv run python agents/tools/agent_d_archive_results.py \\',
        '  --evaluation experiment_results/<run_root>/agent_c/round_<round>/evaluation_results.json \\',
        '  --output-root experiment_results/<run_root> \\',
        '  --output-dir experiment_results/<run_root>/agent_d/round_<round>',
        '',
        'Runtime Required Artifacts:',
        '```text',
        'agent_d/round_<round>/agent_d_summary.json',
        'agent_d/round_<round>/scorecard.csv',
        'scorecard.csv',
        'memory.md',
        'research_memory/dedup_index.json',
        '```',
      ].join('\n'),
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-d',
        systemPrompt: '',
        role: '研究馆员',
        responsibilities: ['归档'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'idle',
      },
    };

    const workflow = buildWorkflowFromExecutionGraph(
      'cluster-contract',
      [agent] as Parameters<typeof buildWorkflowFromExecutionGraph>[1],
      {
        nodes: [{ agentId: 'agent-d', x: 0, y: 0 }],
        edges: [],
        loops: [],
        confirmed: false,
        updatedAt: now,
      },
      'migration',
    );
    const node = workflow.nodes.find((item) => item.nodeId === 'agent:agent-d');

    expect(node?.outputContract?.requiredArtifacts).toEqual(expect.arrayContaining([
      'agent_d/round_<round>/agent_d_summary.json',
      'agent_d/round_<round>/scorecard.csv',
      'scorecard.csv',
      'memory.md',
      'research_memory/dedup_index.json',
    ]));
    expect(node?.outputContract?.requiredArtifacts).not.toEqual(expect.arrayContaining([
      'agent_d/round_<round>/memory.md',
      'agent_d/round_<round>/research_memory/dedup_index.json',
    ]));
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

  it('infers an empty loop body from its generic control cycle', async () => {
    const { normalizeAgentClusterWorkflow } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const workflow = {
      workflowId: 'workflow-loop-infer',
      version: 1,
      status: 'draft',
      createdBy: 'planner',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:a', type: 'agent', name: 'Agent A', agentId: 'a' },
        { nodeId: 'gate:a', type: 'gate', name: 'Gate A', gateKind: 'completion' },
        { nodeId: 'loop:rounds', type: 'loop', name: 'Loop', bodyNodeIds: [], repeatCount: 3 },
        { nodeId: 'agent:b', type: 'agent', name: 'Agent B', agentId: 'b' },
        { nodeId: 'gate:b', type: 'gate', name: 'Gate B', gateKind: 'completion' },
        { nodeId: 'agent:c', type: 'agent', name: 'Agent C', agentId: 'c' },
        { nodeId: 'gate:c', type: 'gate', name: 'Gate C', gateKind: 'completion' },
        { nodeId: 'agent:d', type: 'agent', name: 'Agent D', agentId: 'd' },
        { nodeId: 'gate:d', type: 'gate', name: 'Gate D', gateKind: 'completion' },
        { nodeId: 'gate:done', type: 'gate', name: 'Done Gate', gateKind: 'completion' },
      ],
      edges: [
        { edgeId: 'a-ga', fromNodeId: 'agent:a', toNodeId: 'gate:a', kind: 'control' },
        { edgeId: 'ga-loop', fromNodeId: 'gate:a', toNodeId: 'loop:rounds', kind: 'control' },
        { edgeId: 'loop-b', fromNodeId: 'loop:rounds', toNodeId: 'agent:b', kind: 'control' },
        { edgeId: 'b-gb', fromNodeId: 'agent:b', toNodeId: 'gate:b', kind: 'control' },
        { edgeId: 'gb-c', fromNodeId: 'gate:b', toNodeId: 'agent:c', kind: 'control' },
        { edgeId: 'c-gc', fromNodeId: 'agent:c', toNodeId: 'gate:c', kind: 'control' },
        { edgeId: 'gc-d', fromNodeId: 'gate:c', toNodeId: 'agent:d', kind: 'control' },
        { edgeId: 'd-gd', fromNodeId: 'agent:d', toNodeId: 'gate:d', kind: 'control' },
        { edgeId: 'gd-loop', fromNodeId: 'gate:d', toNodeId: 'loop:rounds', kind: 'control' },
        { edgeId: 'loop-done', fromNodeId: 'loop:rounds', toNodeId: 'gate:done', kind: 'control' },
        { edgeId: 'd-b-data', fromNodeId: 'agent:d', toNodeId: 'agent:b', kind: 'data' },
      ],
    };

    const normalized = normalizeAgentClusterWorkflow(workflow as never);
    const loop = normalized.nodes.find((node) => node.nodeId === 'loop:rounds');

    expect(loop).toEqual(expect.objectContaining({
      type: 'loop',
      bodyNodeIds: ['agent:b', 'agent:c', 'agent:d'],
    }));
  });

  it('removes empty loops when no generic control cycle can define the body', async () => {
    const { normalizeAgentClusterWorkflow } = await import('@electron/utils/agent-clusters');
    const now = new Date().toISOString();
    const workflow = {
      workflowId: 'workflow-empty-loop',
      version: 1,
      status: 'draft',
      createdBy: 'planner',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:a', type: 'agent', name: 'Agent A', agentId: 'a' },
        { nodeId: 'loop:empty', type: 'loop', name: 'Loop', bodyNodeIds: [], repeatCount: 3 },
      ],
      edges: [
        { edgeId: 'a-loop', fromNodeId: 'agent:a', toNodeId: 'loop:empty', kind: 'control' },
      ],
    };

    const normalized = normalizeAgentClusterWorkflow(workflow as never);

    expect(normalized.nodes.some((node) => node.nodeId === 'loop:empty')).toBe(false);
    expect(normalized.edges.some((edge) => edge.toNodeId === 'loop:empty' || edge.fromNodeId === 'loop:empty')).toBe(false);
  });

  it('hides data and feedback edges from the default workflow display edges', async () => {
    const { getWorkflowDisplayEdges } = await import('@electron/utils/agent-clusters');
    const workflow = {
      workflowId: 'workflow-display',
      version: 1,
      status: 'draft',
      createdBy: 'planner',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:a', type: 'agent', name: 'A', agentId: 'a' },
        { nodeId: 'agent:b', type: 'agent', name: 'B', agentId: 'b' },
      ],
      edges: [
        { edgeId: 'control', fromNodeId: 'agent:a', toNodeId: 'agent:b', kind: 'control' },
        { edgeId: 'data', fromNodeId: 'agent:b', toNodeId: 'agent:a', kind: 'data' },
      ],
    };

    expect(getWorkflowDisplayEdges(workflow as never).map((edge) => edge.edgeId)).toEqual(['control']);
    expect(getWorkflowDisplayEdges(workflow as never, { includeDataEdges: true }).map((edge) => edge.edgeId)).toEqual(['control', 'data']);
  });

  it('starts the next round in the same child session when resuming from a completed agent', async () => {
    const { resumeAgentClusterRunFromAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const makeAgent = (agentId: string, name: string) => ({
      agentId,
      name,
      role: name,
      description: name,
      responsibilities: [name],
      status: 'done',
      systemPrompt: name,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: name,
        role: name,
        responsibilities: [name],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'done',
      },
    });
    const agents = [
      makeAgent('agent-a', 'Agent A'),
      makeAgent('agent-b', 'Agent B'),
      makeAgent('agent-c', 'Agent C'),
    ];
    const cluster = {
      clusterId: 'cluster-resume-next-round',
      clusterName: 'Resume Next Round',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'dynamic_harness',
      projectRoot: '/project/factor_mining_v3',
      sourceFolderPath: '/project/factor_mining_v3',
      sharedContext: {
        globalGoal: 'Run pipeline',
        originalInput: '',
        decompositionPlan: 'A -> B -> C',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: null,
      agents,
      edges: [{
        edgeId: 'edge-a-b',
        fromAgentId: 'agent-a',
        toAgentId: 'agent-b',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }, {
        edgeId: 'edge-b-c',
        fromAgentId: 'agent-b',
        toAgentId: 'agent-c',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'completed',
        harnessStatus: 'completed',
        sessionKey: 'agent:main:cluster-resume',
        outputRoot: '/project/factor_mining_v3/experiment_results/version_1_20260625',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        childRuns: ['agent-a', 'agent-b', 'agent-c'].map((agentId) => ({
          agentId,
          workflowNodeId: `agent:${agentId}`,
          sessionKey: `agent:main:subagent:${agentId}`,
          runId: `runtime-${agentId}`,
          status: 'completed',
          submitStatus: 'submitted',
          startedAt: now,
          updatedAt: now,
          completedAt: now,
          iteration: 1,
        })),
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 1,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: agents.map((agent) => ({ nodeId: `agent:${agent.agentId}`, type: 'agent', name: agent.name, agentId: agent.agentId })),
          edges: [{ edgeId: 'wf-edge-b-c', fromNodeId: 'agent:agent-b', toNodeId: 'agent:agent-c', kind: 'control' }],
        },
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b2', status: 'submitted' }) };
    const updated = await resumeAgentClusterRunFromAgent(
      'cluster-resume-next-round',
      'run-1',
      'agent-b',
      gateway as never,
    );

    const run = updated.runs[0];
    const childB = run.childRuns.find((child) => child.agentId === 'agent-b')!;
    const childC = run.childRuns.find((child) => child.agentId === 'agent-c')!;
    expect(childB.iteration).toBe(2);
    expect(childC.iteration).toBe(2);
    expect(childB.sessionKey).toBe('agent:main:subagent:agent-b');
    expect(childC.sessionKey).toBe('agent:main:subagent:agent-c');
    expect(childB.promptMode).toBe('continuation');
    expect(childC.promptMode).toBe('continuation');
    expect(childB.status).toBe('starting');
    expect(childC.status).toBe('blocked');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
  });

  it('keeps retry on the same round and same child session with a repair prompt', async () => {
    const { retryAgentClusterRunAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const cluster = {
      clusterId: 'cluster-retry-same-session',
      clusterName: 'Retry Same Session',
      sourceType: 'existing_task',
      sourceContent: '',
      sharedContext: {
        globalGoal: 'Run pipeline',
        originalInput: '',
        decompositionPlan: 'B',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents: [{
        agentId: 'agent-b',
        name: 'Agent B',
        role: 'Generator',
        description: 'Generate',
        responsibilities: ['Generate'],
        status: 'error',
        systemPrompt: 'Generate',
        tools: [],
        capabilities: [],
        localContext: {
          agentId: 'agent-b',
          systemPrompt: 'Generate',
          role: 'Generator',
          responsibilities: ['Generate'],
          assignedTasks: [],
          privateMessages: [],
          receivedMessages: [],
          workingMemory: '',
          outputs: [],
          status: 'error',
        },
      }],
      edges: [],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'blocked',
        harnessStatus: 'paused',
        sessionKey: 'agent:main:cluster-retry',
        startedAt: now,
        updatedAt: now,
        childRuns: [{
          agentId: 'agent-b',
          workflowNodeId: 'agent:agent-b',
          sessionKey: 'agent:main:subagent:retry-b',
          runId: 'runtime-b',
          status: 'blocked',
          submitStatus: 'failed',
          runtimeFailureKind: 'incomplete_output',
          startedAt: now,
          updatedAt: now,
          iteration: 1,
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 1,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: [{ nodeId: 'agent:agent-b', type: 'agent', name: 'Agent B', agentId: 'agent-b' }],
          edges: [],
        },
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b2', status: 'submitted' }) };
    const updated = await retryAgentClusterRunAgent(
      'cluster-retry-same-session',
      'run-1',
      'agent-b',
      gateway as never,
    );

    const child = updated.runs[0].childRuns[0];
    expect(child.iteration).toBe(1);
    expect(child.sessionKey).toBe('agent:main:subagent:retry-b');
    expect(child.promptMode).toBe('repair');
    expect(child.status).toBe('starting');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
  });

  it('uses a new child session when retrying a project directory agent round', async () => {
    const { retryAgentClusterRunAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const cluster = {
      clusterId: 'cluster-project-retry-new-session',
      clusterName: 'Project Retry New Session',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'project_directory',
      sourceFolderPath: '/project/native',
      sharedContext: {
        globalGoal: 'Run pipeline',
        originalInput: '',
        decompositionPlan: 'B',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents: [{
        agentId: 'agent-b',
        name: 'Agent B',
        role: 'Generator',
        description: 'Generate',
        responsibilities: ['Generate'],
        status: 'error',
        systemPrompt: 'Generate',
        tools: [],
        capabilities: [],
        localContext: {
          agentId: 'agent-b',
          systemPrompt: 'Generate',
          role: 'Generator',
          responsibilities: ['Generate'],
          assignedTasks: [],
          privateMessages: [],
          receivedMessages: [],
          workingMemory: '',
          outputs: [],
          status: 'error',
        },
      }],
      edges: [],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'blocked',
        harnessStatus: 'paused',
        sessionKey: 'agent:main:cluster-project-retry',
        startedAt: now,
        updatedAt: now,
        childRuns: [{
          agentId: 'agent-b',
          workflowNodeId: 'agent:agent-b',
          sessionKey: 'agent:main:subagent:project-retry-b',
          runId: 'runtime-b',
          status: 'blocked',
          submitStatus: 'failed',
          runtimeFailureKind: 'incomplete_output',
          startedAt: now,
          updatedAt: now,
          iteration: 2,
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 1,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: [{ nodeId: 'agent:agent-b', type: 'agent', name: 'Agent B', agentId: 'agent-b' }],
          edges: [],
        },
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b2', status: 'submitted' }) };
    const updated = await retryAgentClusterRunAgent(
      'cluster-project-retry-new-session',
      'run-1',
      'agent-b',
      gateway as never,
    );

    const child = updated.runs[0].childRuns[0];
    expect(child.iteration).toBe(2);
    expect(child.sessionKey).not.toBe('agent:main:subagent:project-retry-b');
    expect(child.promptMode).toBe('repair');
    expect(child.status).toBe('starting');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
  });

  it('keeps a loop continuation on the active round when resuming from a failed body agent', async () => {
    const { resumeAgentClusterRunFromAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const makeAgent = (agentId: string, status: string) => ({
      agentId,
      name: agentId,
      role: agentId,
      description: agentId,
      responsibilities: [agentId],
      status,
      systemPrompt: agentId,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: agentId,
        role: agentId,
        responsibilities: [agentId],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status,
      },
    });
    const agents = [
      makeAgent('agent-a', 'done'),
      makeAgent('agent-b', 'error'),
      makeAgent('agent-c', 'waiting'),
      makeAgent('agent-d', 'waiting'),
    ];
    const workflow = {
      workflowId: 'workflow-loop-resume',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:agent-a', type: 'agent', name: 'Agent A', agentId: 'agent-a' },
        { nodeId: 'agent:agent-b', type: 'agent', name: 'Agent B', agentId: 'agent-b' },
        { nodeId: 'agent:agent-c', type: 'agent', name: 'Agent C', agentId: 'agent-c' },
        { nodeId: 'agent:agent-d', type: 'agent', name: 'Agent D', agentId: 'agent-d' },
        { nodeId: 'gate:b', type: 'gate', name: 'Gate B', gateKind: 'completion', requiredNodeIds: ['agent:agent-b'], description: 'B complete' },
        { nodeId: 'gate:c', type: 'gate', name: 'Gate C', gateKind: 'completion', requiredNodeIds: ['agent:agent-c'], description: 'C complete' },
        { nodeId: 'loop:bcd', type: 'loop', name: 'Loop', bodyNodeIds: ['agent:agent-b', 'agent:agent-c', 'agent:agent-d'], repeatCount: 2 },
      ],
      edges: [
        { edgeId: 'a-b', fromNodeId: 'agent:agent-a', toNodeId: 'agent:agent-b', kind: 'control' },
        { edgeId: 'b-gate', fromNodeId: 'agent:agent-b', toNodeId: 'gate:b', kind: 'control' },
        { edgeId: 'gate-c', fromNodeId: 'gate:b', toNodeId: 'agent:agent-c', kind: 'control' },
        { edgeId: 'c-gate', fromNodeId: 'agent:agent-c', toNodeId: 'gate:c', kind: 'control' },
        { edgeId: 'gate-d', fromNodeId: 'gate:c', toNodeId: 'agent:agent-d', kind: 'control' },
      ],
    };
    const cluster = {
      clusterId: 'cluster-loop-resume-active-round',
      clusterName: 'Loop Resume Active Round',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'project_directory',
      sharedContext: {
        globalGoal: 'Run loop',
        originalInput: '',
        decompositionPlan: 'A -> B -> C -> D loop',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: null,
      agents,
      edges: [
        { edgeId: 'edge-a-b', fromAgentId: 'agent-a', toAgentId: 'agent-b', relationType: 'depends_on', executionType: 'blocks', isBlocking: true, label: 'blocks' },
        { edgeId: 'edge-b-c', fromAgentId: 'agent-b', toAgentId: 'agent-c', relationType: 'depends_on', executionType: 'blocks', isBlocking: true, label: 'blocks' },
        { edgeId: 'edge-c-d', fromAgentId: 'agent-c', toAgentId: 'agent-d', relationType: 'depends_on', executionType: 'blocks', isBlocking: true, label: 'blocks' },
      ],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'error',
        harnessStatus: 'failed',
        sessionKey: 'agent:main:cluster-loop-resume',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        loopStates: [{ loopId: 'loop:bcd', currentIteration: 2, repeatCount: 2, status: 'running', updatedAt: now }],
        childRuns: [
          { agentId: 'agent-a', workflowNodeId: 'agent:agent-a', sessionKey: 'agent:main:subagent:a', runId: 'runtime-a', status: 'completed', submitStatus: 'submitted', startedAt: now, updatedAt: now, completedAt: now, iteration: 1 },
          { agentId: 'agent-b', workflowNodeId: 'agent:agent-b', sessionKey: 'agent:main:subagent:b', runId: 'runtime-b', status: 'error', submitStatus: 'failed', startedAt: now, updatedAt: now, error: 'missing artifacts', iteration: 2 },
          { agentId: 'agent-c', workflowNodeId: 'agent:agent-c', sessionKey: 'agent:main:subagent:c', runId: '', status: 'blocked', submitStatus: 'pending', startedAt: now, updatedAt: now, iteration: 2 },
          { agentId: 'agent-d', workflowNodeId: 'agent:agent-d', sessionKey: 'agent:main:subagent:d', runId: '', status: 'blocked', submitStatus: 'pending', startedAt: now, updatedAt: now, iteration: 2 },
        ],
        workflowSnapshot: workflow,
        nodeRuns: [
          { nodeId: 'agent:agent-a', status: 'completed', attempt: 1, startedAt: now, updatedAt: now, completedAt: now },
          { nodeId: 'agent:agent-b', status: 'failed', attempt: 1, startedAt: now, updatedAt: now, error: 'missing artifacts' },
          { nodeId: 'agent:agent-c', status: 'waiting', attempt: 1, startedAt: now, updatedAt: now, waitingReason: '等待上游重新完成' },
          { nodeId: 'agent:agent-d', status: 'waiting', attempt: 1, startedAt: now, updatedAt: now, waitingReason: '等待上游重新完成' },
          { nodeId: 'loop:bcd', status: 'waiting', attempt: 0, startedAt: now, updatedAt: now, waitingReason: '等待循环主体完成' },
        ],
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b2', status: 'submitted' }) };
    const updated = await resumeAgentClusterRunFromAgent(
      'cluster-loop-resume-active-round',
      'run-1',
      'agent-b',
      gateway as never,
    );

    const run = updated.runs[0];
    expect(run.childRuns.find((child) => child.agentId === 'agent-b')?.iteration).toBe(2);
    expect(run.childRuns.find((child) => child.agentId === 'agent-c')?.iteration).toBe(2);
    expect(run.childRuns.find((child) => child.agentId === 'agent-d')?.iteration).toBe(2);
    expect(run.childRuns.find((child) => child.agentId === 'agent-b')?.sessionKey).not.toBe('agent:main:subagent:b');
    expect(run.childRuns.find((child) => child.agentId === 'agent-c')?.sessionKey).not.toBe('agent:main:subagent:c');
    expect(run.childRuns.find((child) => child.agentId === 'agent-d')?.sessionKey).not.toBe('agent:main:subagent:d');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
  });

  it('starts a fresh loop segment from a completed loop body agent using the workflow repeat count', async () => {
    const { resumeAgentClusterRunFromAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const projectRoot = await mkdtemp(join(tmpdir(), 'investclaw-loop-resume-segment-'));
    const outputRoot = join(projectRoot, 'experiment_results', 'version_1_20260626');
    await mkdir(outputRoot, { recursive: true });
    const now = new Date().toISOString();
    const makeAgent = (agentId: string) => ({
      agentId,
      name: agentId,
      role: agentId,
      description: agentId,
      responsibilities: [agentId],
      status: 'done',
      systemPrompt: agentId,
      runtimeContract: agentId === 'agent-b' ? {
        agentName: agentId,
        stableCommand: 'uv run python agents/tools/worker.py --output-root experiment_results/<run_root> --output-dir experiment_results/<run_root>/workers/round_<round>',
        requiredArtifacts: ['workers/round_<round>/result.json'],
      } : undefined,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: agentId,
        role: agentId,
        responsibilities: [agentId],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'done',
      },
    });
    const agents = ['agent-a', 'agent-b', 'agent-c', 'agent-d'].map(makeAgent);
    const workflow = {
      workflowId: 'workflow-loop-resume-segment',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:agent-a', type: 'agent', name: 'Agent A', agentId: 'agent-a' },
        { nodeId: 'agent:agent-b', type: 'agent', name: 'Agent B', agentId: 'agent-b' },
        { nodeId: 'agent:agent-c', type: 'agent', name: 'Agent C', agentId: 'agent-c' },
        { nodeId: 'agent:agent-d', type: 'agent', name: 'Agent D', agentId: 'agent-d' },
        { nodeId: 'gate:b', type: 'gate', name: 'Gate B', gateKind: 'completion', requiredNodeIds: ['agent:agent-b'], description: 'B complete' },
        { nodeId: 'gate:c', type: 'gate', name: 'Gate C', gateKind: 'completion', requiredNodeIds: ['agent:agent-c'], description: 'C complete' },
        { nodeId: 'loop:bcd', type: 'loop', name: 'Loop', bodyNodeIds: ['agent:agent-b', 'agent:agent-c', 'agent:agent-d'], repeatCount: 2 },
      ],
      edges: [
        { edgeId: 'a-b', fromNodeId: 'agent:agent-a', toNodeId: 'agent:agent-b', kind: 'control' },
        { edgeId: 'b-gate', fromNodeId: 'agent:agent-b', toNodeId: 'gate:b', kind: 'control' },
        { edgeId: 'gate-c', fromNodeId: 'gate:b', toNodeId: 'agent:agent-c', kind: 'control' },
        { edgeId: 'c-gate', fromNodeId: 'agent:agent-c', toNodeId: 'gate:c', kind: 'control' },
        { edgeId: 'gate-d', fromNodeId: 'gate:c', toNodeId: 'agent:agent-d', kind: 'control' },
      ],
    };
    const cluster = {
      clusterId: 'cluster-loop-resume-segment',
      clusterName: 'Loop Resume Segment',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'project_directory',
      sourceFolderPath: projectRoot,
      sharedContext: {
        globalGoal: 'Run loop',
        originalInput: '',
        decompositionPlan: 'A -> B -> C -> D loop',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: null,
      agents,
      edges: [
        { edgeId: 'edge-a-b', fromAgentId: 'agent-a', toAgentId: 'agent-b', relationType: 'depends_on', executionType: 'blocks', isBlocking: true, label: 'blocks' },
        { edgeId: 'edge-b-c', fromAgentId: 'agent-b', toAgentId: 'agent-c', relationType: 'depends_on', executionType: 'blocks', isBlocking: true, label: 'blocks' },
        { edgeId: 'edge-c-d', fromAgentId: 'agent-c', toAgentId: 'agent-d', relationType: 'depends_on', executionType: 'blocks', isBlocking: true, label: 'blocks' },
      ],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'completed',
        harnessStatus: 'completed',
        sessionKey: 'agent:main:cluster-loop-resume-segment',
        outputRoot,
        outputVersion: 'version_1_20260626',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        loopStates: [{ loopId: 'loop:bcd', currentIteration: 2, repeatCount: 2, status: 'completed', updatedAt: now }],
        childRuns: [
          { agentId: 'agent-a', workflowNodeId: 'agent:agent-a', sessionKey: 'agent:main:subagent:a', runId: 'runtime-a', status: 'completed', submitStatus: 'submitted', startedAt: now, updatedAt: now, completedAt: now, iteration: 1 },
          { agentId: 'agent-b', workflowNodeId: 'agent:agent-b', sessionKey: 'agent:main:subagent:b', runId: 'runtime-b', status: 'completed', submitStatus: 'submitted', startedAt: now, updatedAt: now, completedAt: now, iteration: 2 },
          { agentId: 'agent-c', workflowNodeId: 'agent:agent-c', sessionKey: 'agent:main:subagent:c', runId: 'runtime-c', status: 'completed', submitStatus: 'submitted', startedAt: now, updatedAt: now, completedAt: now, iteration: 2 },
          { agentId: 'agent-d', workflowNodeId: 'agent:agent-d', sessionKey: 'agent:main:subagent:d', runId: 'runtime-d', status: 'completed', submitStatus: 'submitted', startedAt: now, updatedAt: now, completedAt: now, iteration: 2 },
        ],
        workflowSnapshot: workflow,
        nodeRuns: workflow.nodes.map((node) => ({
          nodeId: node.nodeId,
          status: 'completed',
          attempt: node.type === 'loop' ? 0 : 1,
          startedAt: now,
          updatedAt: now,
          completedAt: now,
        })),
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b3', status: 'submitted' }) };
    const updated = await resumeAgentClusterRunFromAgent(
      'cluster-loop-resume-segment',
      'run-1',
      'agent-b',
      gateway as never,
    );

    const run = updated.runs[0];
    const state = run.loopStates?.find((item) => item.loopId === 'loop:bcd');
    expect(state).toMatchObject({ currentIteration: 1, repeatCount: 2, outputRoundStart: 3, status: 'running' });
    for (const agentId of ['agent-b', 'agent-c', 'agent-d']) {
      const child = run.childRuns.find((item) => item.agentId === agentId)!;
      expect(child.iteration).toBe(3);
      expect(child.sessionKey).not.toBe(`agent:main:subagent:${agentId.slice(-1)}`);
    }
    expect(run.childRuns.find((item) => item.agentId === 'agent-b')?.status).toBe('starting');
    expect(run.childRuns.find((item) => item.agentId === 'agent-c')?.status).toBe('blocked');
    expect(run.childRuns.find((item) => item.agentId === 'agent-d')?.status).toBe('blocked');
    expect(run.nodeRuns?.find((item) => item.nodeId === 'gate:b')?.status).toBe('pending');
    expect(run.nodeRuns?.find((item) => item.nodeId === 'gate:c')?.status).toBe('pending');
    expect(updated.events.at(-1)?.content).toContain('执行 2 轮');
    expect(updated.events.at(-1)?.content).toContain('round_3 起');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalledTimes(1));
    expect(gateway.rpc.mock.calls[0]?.[1]?.sessionKey).toBe(run.childRuns.find((item) => item.agentId === 'agent-b')?.sessionKey);
  });

  it('does not dispatch downstream project-directory agents when stale gates are completed', async () => {
    const { pumpReadyAgentClusterChildren } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const projectRoot = await mkdtemp(join(tmpdir(), 'investclaw-project-ready-'));
    const outputRoot = join(projectRoot, 'experiment_results', 'version_1_20260629');
    await mkdir(outputRoot, { recursive: true });
    const now = new Date().toISOString();
    const makeAgent = (agentId: string) => ({
      agentId,
      name: agentId,
      role: agentId,
      description: agentId,
      responsibilities: [agentId],
      status: agentId === 'agent-b' ? 'running' : 'waiting',
      systemPrompt: agentId,
      runtimeContract: agentId === 'agent-b' ? {
        agentName: agentId,
        stableCommand: 'uv run python agents/tools/worker.py --output-root experiment_results/<run_root> --output-dir experiment_results/<run_root>/workers/round_<round>',
        requiredArtifacts: ['workers/round_<round>/result.json'],
      } : undefined,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: agentId,
        role: agentId,
        responsibilities: [agentId],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: agentId === 'agent-b' ? 'running' : 'waiting',
      },
    });
    const workflow = {
      workflowId: 'workflow-stale-gate',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 4,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:b', type: 'agent', name: 'B', agentId: 'agent-b' },
        { nodeId: 'gate:b', type: 'gate', name: 'Gate B', gateKind: 'completion' },
        { nodeId: 'agent:c', type: 'agent', name: 'C', agentId: 'agent-c' },
      ],
      edges: [
        { edgeId: 'b-gate', fromNodeId: 'agent:b', toNodeId: 'gate:b', kind: 'control' },
        { edgeId: 'gate-c', fromNodeId: 'gate:b', toNodeId: 'agent:c', kind: 'control' },
      ],
    };
    const cluster = {
      clusterId: 'cluster-stale-gate',
      clusterName: 'Stale Gate',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'project_directory',
      sourceFolderPath: projectRoot,
      sharedContext: {
        globalGoal: 'Run',
        originalInput: '',
        decompositionPlan: '',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents: ['agent-b', 'agent-c'].map(makeAgent),
      edges: [
        { edgeId: 'edge-b-c', fromAgentId: 'agent-b', toAgentId: 'agent-c', relationType: 'depends_on', executionType: 'blocks', isBlocking: true, label: 'blocks' },
      ],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'running',
        harnessStatus: 'running',
        sessionKey: 'agent:main:cluster-stale-gate',
        outputRoot,
        outputVersion: 'version_1_20260629',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        childRuns: [
          { agentId: 'agent-b', workflowNodeId: 'agent:b', sessionKey: 'agent:main:subagent:b', runId: '', status: 'starting', submitStatus: 'pending', startedAt: now, updatedAt: now, iteration: 1, promptMode: 'repair', expectedArtifacts: ['workers/round_1/result.json'] },
          { agentId: 'agent-c', workflowNodeId: 'agent:c', sessionKey: 'agent:main:subagent:c', runId: '', status: 'blocked', submitStatus: 'pending', startedAt: now, updatedAt: now, iteration: 1 },
        ],
        workflowSnapshot: workflow,
        nodeRuns: [
          { nodeId: 'agent:b', status: 'ready', attempt: 0, startedAt: now, updatedAt: now },
          { nodeId: 'gate:b', status: 'completed', attempt: 1, startedAt: now, updatedAt: now, completedAt: now },
          { nodeId: 'agent:c', status: 'waiting', attempt: 0, startedAt: now, updatedAt: now },
        ],
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b', status: 'submitted' }) };
    await pumpReadyAgentClusterChildren('cluster-stale-gate', 'run-1', gateway as never);

    expect(gateway.rpc).toHaveBeenCalledTimes(1);
    expect(gateway.rpc.mock.calls[0]?.[1]?.sessionKey).toBe('agent:main:subagent:b');
    expect(gateway.rpc.mock.calls[0]?.[1]?.message).toContain('当前 Agent 声明的稳定命令');
    expect(gateway.rpc.mock.calls[0]?.[1]?.message).toContain('experiment_results/version_1_20260629/workers/round_1');
    expect(gateway.rpc.mock.calls[0]?.[1]?.message).toContain('不要扫描未列出的历史 round');
    const stored = JSON.parse(await readFile(storePath, 'utf8')) as { clusters: Array<{ runs: Array<{ childRuns: Array<{ agentId: string; status: string; submitStatus: string }> }> }> };
    const childC = stored.clusters[0].runs[0].childRuns.find((child) => child.agentId === 'agent-c');
    expect(childC).toMatchObject({ status: 'blocked', submitStatus: 'pending' });
  });

  it('advances a resumed loop segment by outputRoundStart and stops after repeat count', async () => {
    const { skipAgentClusterRunAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const makeAgent = (agentId: string) => ({
      agentId,
      name: agentId,
      role: agentId,
      description: agentId,
      responsibilities: [agentId],
      status: 'done',
      systemPrompt: agentId,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: agentId,
        role: agentId,
        responsibilities: [agentId],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'done',
      },
    });
    const agents = ['agent-b', 'agent-c', 'agent-d'].map(makeAgent);
    const workflow = {
      workflowId: 'workflow-loop-resume-advance',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:agent-b', type: 'agent', name: 'Agent B', agentId: 'agent-b' },
        { nodeId: 'agent:agent-c', type: 'agent', name: 'Agent C', agentId: 'agent-c' },
        { nodeId: 'agent:agent-d', type: 'agent', name: 'Agent D', agentId: 'agent-d' },
        { nodeId: 'loop:bcd', type: 'loop', name: 'Loop', bodyNodeIds: ['agent:agent-b', 'agent:agent-c', 'agent:agent-d'], repeatCount: 2 },
      ],
      edges: [
        { edgeId: 'b-c', fromNodeId: 'agent:agent-b', toNodeId: 'agent:agent-c', kind: 'control' },
        { edgeId: 'c-d', fromNodeId: 'agent:agent-c', toNodeId: 'agent:agent-d', kind: 'control' },
      ],
    };
    const baseCluster = {
      clusterId: 'cluster-loop-resume-advance',
      clusterName: 'Loop Resume Advance',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'project_directory',
      sourceFolderPath: '/project/native',
      sharedContext: {
        globalGoal: 'Run loop',
        originalInput: '',
        decompositionPlan: 'B -> C -> D loop',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents,
      edges: [{
        edgeId: 'edge-b-c',
        fromAgentId: 'agent-b',
        toAgentId: 'agent-c',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }, {
        edgeId: 'edge-c-d',
        fromAgentId: 'agent-c',
        toAgentId: 'agent-d',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }],
      messages: [],
      events: [],
      workflows: [workflow],
      currentWorkflowId: workflow.workflowId,
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'blocked',
        harnessStatus: 'paused',
        sessionKey: 'agent:main:cluster-loop-resume-advance',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        loopStates: [{ loopId: 'loop:bcd', currentIteration: 1, repeatCount: 2, outputRoundStart: 3, status: 'running', updatedAt: now }],
        childRuns: ['agent-b', 'agent-c', 'agent-d'].map((agentId) => ({
          agentId,
          workflowNodeId: `agent:${agentId}`,
          sessionKey: `agent:main:subagent:round3-${agentId}`,
          runId: `runtime-round3-${agentId}`,
          status: 'completed',
          submitStatus: 'submitted',
          startedAt: now,
          updatedAt: now,
          completedAt: now,
          iteration: 3,
        })),
        workflowSnapshot: workflow,
        nodeRuns: workflow.nodes.map((node) => ({
          nodeId: node.nodeId,
          status: node.type === 'loop' ? 'waiting' : 'completed',
          attempt: node.type === 'loop' ? 0 : 1,
          startedAt: now,
          updatedAt: now,
          completedAt: node.type === 'loop' ? undefined : now,
        })),
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [baseCluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b4', status: 'submitted' }) };
    const round4Cluster = await skipAgentClusterRunAgent(
      'cluster-loop-resume-advance',
      'run-1',
      'agent-d',
      gateway as never,
    );
    let run = round4Cluster.runs[0];
    expect(run.status).toBe('running');
    expect(run.harnessStatus).toBe('running');
    expect(round4Cluster.activeRunId).toBe('run-1');
    expect(run.loopStates?.find((item) => item.loopId === 'loop:bcd')).toMatchObject({ currentIteration: 2, repeatCount: 2, outputRoundStart: 3, status: 'running' });
    for (const agentId of ['agent-b', 'agent-c', 'agent-d']) {
      expect(run.childRuns.find((item) => item.agentId === agentId)?.iteration).toBe(4);
    }
    expect(run.childRuns.find((item) => item.agentId === 'agent-b')?.status).toBe('starting');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
    expect(gateway.rpc).toHaveBeenCalledTimes(1);
    expect(gateway.rpc.mock.calls[0]?.[1]?.sessionKey).toContain('agent-b');

    const completedRound4 = structuredClone(round4Cluster);
    completedRound4.activeRunId = 'run-1';
    const completedRun = completedRound4.runs[0];
    completedRun.status = 'running';
    completedRun.harnessStatus = 'running';
    completedRun.childRuns = completedRun.childRuns.map((child) => ({
      ...child,
      status: 'completed',
      submitStatus: 'submitted',
      runId: `runtime-round4-${child.agentId}`,
      completedAt: now,
      iteration: 4,
    }));
    completedRun.nodeRuns = completedRun.nodeRuns?.map((node) => ({
      ...node,
      status: node.nodeId === 'loop:bcd' ? 'waiting' : 'completed',
      completedAt: node.nodeId === 'loop:bcd' ? undefined : now,
    }));
    await writeFile(storePath, JSON.stringify({ clusters: [completedRound4] }), 'utf8');

    const finalCluster = await skipAgentClusterRunAgent(
      'cluster-loop-resume-advance',
      'run-1',
      'agent-d',
      { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-should-not-submit', status: 'submitted' }) } as never,
    );
    run = finalCluster.runs[0];
    expect(run.loopStates?.find((item) => item.loopId === 'loop:bcd')).toMatchObject({ currentIteration: 2, repeatCount: 2, outputRoundStart: 3, status: 'completed' });
    for (const agentId of ['agent-b', 'agent-c', 'agent-d']) {
      expect(run.childRuns.find((item) => item.agentId === agentId)?.iteration).toBe(4);
    }
  });

  it('refreshes a skipped paused run back to running when a ready child is already starting', async () => {
    const { refreshAgentClusterRunEvents } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const workflow = {
      workflowId: 'workflow-skip-refresh-resume',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:worker', type: 'agent', name: 'Worker', agentId: 'worker', outputContract: { requiredArtifacts: ['worker/result.json'] } },
      ],
      edges: [],
    };
    const cluster = {
      clusterId: 'cluster-skip-refresh-resume',
      clusterName: 'Skip Refresh Resume',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'project_directory',
      sourceFolderPath: '/project/native',
      sharedContext: {
        globalGoal: 'Run worker',
        originalInput: '',
        decompositionPlan: 'Worker',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents: [{
        agentId: 'worker',
        name: 'Worker',
        role: 'worker',
        description: 'worker',
        responsibilities: ['worker'],
        status: 'running',
        systemPrompt: 'worker',
        tools: [],
        capabilities: [],
        localContext: {
          agentId: 'worker',
          systemPrompt: 'worker',
          role: 'worker',
          responsibilities: ['worker'],
          assignedTasks: [],
          privateMessages: [],
          receivedMessages: [],
          workingMemory: '',
          outputs: [],
          status: 'running',
        },
      }],
      edges: [],
      messages: [],
      events: [],
      workflows: [workflow],
      currentWorkflowId: workflow.workflowId,
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'blocked',
        harnessStatus: 'paused',
        sessionKey: 'agent:main:cluster-skip-refresh-resume',
        outputRoot: '/project/native/experiment_results/version_1_20260629',
        outputVersion: 'version_1_20260629',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        childRuns: [{
          agentId: 'worker',
          workflowNodeId: 'agent:worker',
          sessionKey: 'agent:main:subagent:worker',
          runId: '',
          status: 'starting',
          submitStatus: 'pending',
          startedAt: now,
          updatedAt: now,
          iteration: 1,
          expectedArtifacts: ['worker/result.json'],
        }],
        workflowSnapshot: workflow,
        nodeRuns: [{
          nodeId: 'agent:worker',
          status: 'ready',
          attempt: 0,
          startedAt: now,
          updatedAt: now,
        }],
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = {
      getStatus: () => ({ connectedAt: Date.now() - 1000 }),
      rpc: vi.fn(async (method: string) => {
        if (method === 'chat.history') return { messages: [] };
        return { runId: 'runtime-worker', status: 'submitted' };
      }),
    };

    const updated = await refreshAgentClusterRunEvents(
      'cluster-skip-refresh-resume',
      'run-1',
      gateway as never,
    );
    const run = updated.runs[0];
    expect(run.status).toBe('running');
    expect(run.harnessStatus).toBe('running');
    expect(updated.activeRunId).toBe('run-1');
    expect(updated.events.some((event) => event.title === '恢复调度')).toBe(true);
    await vi.waitFor(() =>
      expect(gateway.rpc.mock.calls.some((call) => call[0] === 'agent')).toBe(true)
    );
    expect(gateway.rpc.mock.calls.filter((call) => call[0] === 'agent')).toHaveLength(1);
    await vi.waitFor(async () => {
      const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
        clusters: Array<{ runs: Array<{ childRuns: Array<{ agentId: string; runId: string; submitStatus: string }> }> }>;
      };
      expect(stored.clusters[0].runs[0].childRuns.find((child) => child.agentId === 'worker')).toMatchObject({
        runId: 'runtime-worker',
        submitStatus: 'submitted',
      });
    });
  });

  it('infers the current round from existing contract artifacts before resuming a stale child state', async () => {
    const { resumeAgentClusterRunFromAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const projectRoot = await mkdtemp(join(tmpdir(), 'investclaw-resume-artifacts-'));
    const outputRoot = join(projectRoot, 'experiment_results', 'version_1_20260626');
    await mkdir(join(outputRoot, 'worker', 'round_2'), { recursive: true });
    await writeFile(join(outputRoot, 'worker', 'round_2', 'result.json'), '{"status":"completed"}', 'utf8');
    const now = new Date().toISOString();
    const agent = {
      agentId: 'agent-worker',
      name: 'Worker',
      role: 'Worker',
      description: 'Worker',
      responsibilities: ['Worker'],
      status: 'error',
      systemPrompt: 'Worker',
      tools: [],
      capabilities: [],
      localContext: {
        agentId: 'agent-worker',
        systemPrompt: 'Worker',
        role: 'Worker',
        responsibilities: ['Worker'],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'error',
      },
    };
    const cluster = {
      clusterId: 'cluster-resume-artifact-round',
      clusterName: 'Resume Artifact Round',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'project_directory',
      projectRoot,
      sourceFolderPath: projectRoot,
      sharedContext: {
        globalGoal: 'Run worker',
        originalInput: '',
        decompositionPlan: 'Worker',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: null,
      agents: [agent],
      edges: [],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'error',
        harnessStatus: 'failed',
        sessionKey: 'agent:main:cluster-artifact-round',
        outputRoot,
        outputVersion: 'version_1_20260626',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        childRuns: [{
          agentId: 'agent-worker',
          workflowNodeId: 'agent:agent-worker',
          sessionKey: 'agent:main:subagent:worker',
          runId: 'runtime-worker',
          status: 'error',
          submitStatus: 'failed',
          startedAt: now,
          updatedAt: now,
          error: 'stale round_1 state',
          iteration: 1,
        }],
        workflowSnapshot: {
          workflowId: 'workflow-1',
          version: 1,
          status: 'confirmed',
          createdBy: 'user',
          createdAt: now,
          updatedAt: now,
          policy: {
            maxConcurrency: 1,
            defaultTimeoutMs: 1000,
            defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
          },
          nodes: [{
            nodeId: 'agent:agent-worker',
            type: 'agent',
            name: 'Worker',
            agentId: 'agent-worker',
            outputContract: { requiredArtifacts: ['worker/round_<round>/result.json'] },
          }],
          edges: [],
        },
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-worker-2', status: 'submitted' }) };
    const updated = await resumeAgentClusterRunFromAgent(
      'cluster-resume-artifact-round',
      'run-1',
      'agent-worker',
      gateway as never,
    );

    const child = updated.runs[0].childRuns[0];
    expect(child.iteration).toBe(2);
    expect(child.expectedArtifacts).toEqual(['worker/round_2/result.json']);
    expect(child.promptMode).toBe('repair');
    expect(child.sessionKey).not.toBe('agent:main:subagent:worker');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
  });

  it('does not allow automatic repair retry for terminal runtime errors', async () => {
    const { runtimeFailureAllowsAutoRetry } = await import('@electron/utils/agent-clusters');

    expect(runtimeFailureAllowsAutoRetry('runtime_error')).toBe(false);
    expect(runtimeFailureAllowsAutoRetry('incomplete_output')).toBe(false);
    expect(runtimeFailureAllowsAutoRetry('stale_after_restart')).toBe(false);
  });

  it('ignores terminal runtime metadata from an earlier loop round', async () => {
    const { runtimeTerminalEntryPredatesChildRun } = await import('@electron/utils/agent-clusters');

    expect(runtimeTerminalEntryPredatesChildRun(
      {
        status: 'done',
        startedAt: Date.parse('2026-06-26T16:54:16.243Z'),
        endedAt: Date.parse('2026-06-26T16:59:25.154Z'),
        updatedAt: Date.parse('2026-06-26T17:10:00.977Z'),
      },
      {
        startedAt: '2026-06-26T17:05:27.481Z',
        promptMode: 'continuation',
      },
    )).toBe(true);

    expect(runtimeTerminalEntryPredatesChildRun(
      {
        status: 'done',
        startedAt: Date.parse('2026-06-26T17:05:28.000Z'),
        endedAt: Date.parse('2026-06-26T17:06:00.000Z'),
      },
      {
        startedAt: '2026-06-26T17:05:27.481Z',
        promptMode: 'continuation',
      },
    )).toBe(false);
  });

  it('reuses loop body child sessions when advancing to the next loop round', async () => {
    const { skipAgentClusterRunAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const makeAgent = (agentId: string) => ({
      agentId,
      name: agentId,
      role: agentId,
      description: agentId,
      responsibilities: [agentId],
      status: 'done',
      systemPrompt: agentId,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: agentId,
        role: agentId,
        responsibilities: [agentId],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'done',
      },
    });
    const agents = ['agent-b', 'agent-c', 'agent-d'].map(makeAgent);
    const workflow = {
      workflowId: 'workflow-loop',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:agent-b', type: 'agent', name: 'Agent B', agentId: 'agent-b' },
        { nodeId: 'agent:agent-c', type: 'agent', name: 'Agent C', agentId: 'agent-c' },
        { nodeId: 'agent:agent-d', type: 'agent', name: 'Agent D', agentId: 'agent-d' },
        { nodeId: 'loop:bcd', type: 'loop', name: 'Loop', bodyNodeIds: ['agent:agent-b', 'agent:agent-c', 'agent:agent-d'], repeatCount: 2 },
      ],
      edges: [
        { edgeId: 'b-c', fromNodeId: 'agent:agent-b', toNodeId: 'agent:agent-c', kind: 'control' },
        { edgeId: 'c-d', fromNodeId: 'agent:agent-c', toNodeId: 'agent:agent-d', kind: 'control' },
      ],
    };
    const cluster = {
	      clusterId: 'cluster-loop-reuse',
	      clusterName: 'Loop Reuse',
	      sourceType: 'existing_task',
	      sourceContent: '',
	      runtimeMode: 'dynamic_harness',
      sharedContext: {
        globalGoal: 'Run loop',
        originalInput: '',
        decompositionPlan: 'B -> C -> D loop',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents,
      edges: [{
        edgeId: 'edge-b-c',
        fromAgentId: 'agent-b',
        toAgentId: 'agent-c',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }, {
        edgeId: 'edge-c-d',
        fromAgentId: 'agent-c',
        toAgentId: 'agent-d',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'running',
        harnessStatus: 'running',
        sessionKey: 'agent:main:cluster-loop',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        loopStates: [{ loopId: 'loop:bcd', currentIteration: 1, repeatCount: 2, status: 'running', updatedAt: now }],
        childRuns: ['agent-b', 'agent-c', 'agent-d'].map((agentId) => ({
          agentId,
          workflowNodeId: `agent:${agentId}`,
          sessionKey: `agent:main:subagent:loop-${agentId}`,
          runId: `runtime-${agentId}`,
          status: 'completed',
          submitStatus: 'submitted',
          startedAt: now,
          updatedAt: now,
          completedAt: now,
          iteration: 1,
        })),
        workflowSnapshot: workflow,
        nodeRuns: workflow.nodes.map((node) => ({
          nodeId: node.nodeId,
          status: node.type === 'loop' ? 'waiting' : 'completed',
          attempt: node.type === 'loop' ? 0 : 1,
          startedAt: now,
          updatedAt: now,
          completedAt: node.type === 'loop' ? undefined : now,
        })),
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b2', status: 'submitted' }) };
    const updated = await skipAgentClusterRunAgent(
      'cluster-loop-reuse',
      'run-1',
      'agent-d',
      gateway as never,
    );

    const run = updated.runs[0];
    for (const agentId of ['agent-b', 'agent-c', 'agent-d']) {
      const child = run.childRuns.find((item) => item.agentId === agentId)!;
      expect(child.iteration).toBe(2);
      expect(child.sessionKey).toBe(`agent:main:subagent:loop-${agentId}`);
      expect(child.promptMode).toBe('continuation');
    }
    expect(run.childRuns.find((item) => item.agentId === 'agent-b')?.status).toBe('starting');
    expect(run.childRuns.find((item) => item.agentId === 'agent-c')?.status).toBe('blocked');
    expect(run.childRuns.find((item) => item.agentId === 'agent-d')?.status).toBe('blocked');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
    await vi.waitFor(async () => {
      const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
        clusters: Array<{ runs: Array<{ childRuns: Array<{ agentId: string; runId: string; submitStatus: string }> }> }>;
      };
      expect(stored.clusters[0].runs[0].childRuns.find((child) => child.agentId === 'agent-b')).toMatchObject({
        runId: 'runtime-b2',
        submitStatus: 'submitted',
      });
    });
  });

  it('uses new loop body child sessions for project directory rounds', async () => {
    const { skipAgentClusterRunAgent } = await import('@electron/utils/agent-clusters');
    const storeDir = '/tmp/investclaw-test';
    const storePath = `${storeDir}/agent-clusters.json`;
    await mkdir(storeDir, { recursive: true });
    await rm(storePath, { force: true });
    const now = new Date().toISOString();
    const makeAgent = (agentId: string) => ({
      agentId,
      name: agentId,
      role: agentId,
      description: agentId,
      responsibilities: [agentId],
      status: 'done',
      systemPrompt: agentId,
      tools: [],
      capabilities: [],
      localContext: {
        agentId,
        systemPrompt: agentId,
        role: agentId,
        responsibilities: [agentId],
        assignedTasks: [],
        privateMessages: [],
        receivedMessages: [],
        workingMemory: '',
        outputs: [],
        status: 'done',
      },
    });
    const agents = ['agent-b', 'agent-c', 'agent-d'].map(makeAgent);
    const workflow = {
      workflowId: 'workflow-project-loop',
      version: 1,
      status: 'confirmed',
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      policy: {
        maxConcurrency: 1,
        defaultTimeoutMs: 1000,
        defaultRetryPolicy: { maxAttempts: 1, backoffMs: 0, failureAction: 'pause' },
      },
      nodes: [
        { nodeId: 'agent:agent-b', type: 'agent', name: 'Agent B', agentId: 'agent-b' },
        { nodeId: 'agent:agent-c', type: 'agent', name: 'Agent C', agentId: 'agent-c' },
        { nodeId: 'agent:agent-d', type: 'agent', name: 'Agent D', agentId: 'agent-d' },
        { nodeId: 'loop:bcd', type: 'loop', name: 'Loop', bodyNodeIds: ['agent:agent-b', 'agent:agent-c', 'agent:agent-d'], repeatCount: 2 },
      ],
      edges: [
        { edgeId: 'b-c', fromNodeId: 'agent:agent-b', toNodeId: 'agent:agent-c', kind: 'control' },
        { edgeId: 'c-d', fromNodeId: 'agent:agent-c', toNodeId: 'agent:agent-d', kind: 'control' },
      ],
    };
    const cluster = {
      clusterId: 'cluster-project-loop-new-session',
      clusterName: 'Project Loop New Session',
      sourceType: 'existing_task',
      sourceContent: '',
      runtimeMode: 'project_directory',
      sourceFolderPath: '/project/native',
      sharedContext: {
        globalGoal: 'Run loop',
        originalInput: '',
        decompositionPlan: 'B -> C -> D loop',
        constraints: [],
        facts: [],
        historicalNotes: [],
        decisions: [],
        managerInstructions: [],
        promptPatches: [],
        runDecisions: [],
        latestArtifacts: [],
        managerProposals: [],
        openQuestions: [],
        artifacts: [],
        agentSummaries: [],
        finalSummary: '',
      },
      activeRunId: 'run-1',
      agents,
      edges: [{
        edgeId: 'edge-b-c',
        fromAgentId: 'agent-b',
        toAgentId: 'agent-c',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }, {
        edgeId: 'edge-c-d',
        fromAgentId: 'agent-c',
        toAgentId: 'agent-d',
        relationType: 'depends_on',
        executionType: 'blocks',
        isBlocking: true,
        label: 'blocks',
      }],
      messages: [],
      events: [],
      runs: [{
        runId: 'run-1',
        mode: 'subagent_swarm',
        status: 'running',
        harnessStatus: 'running',
        sessionKey: 'agent:main:cluster-project-loop',
        roundStart: 1,
        startedAt: now,
        updatedAt: now,
        loopStates: [{ loopId: 'loop:bcd', currentIteration: 1, repeatCount: 2, status: 'running', updatedAt: now }],
        childRuns: ['agent-b', 'agent-c', 'agent-d'].map((agentId) => ({
          agentId,
          workflowNodeId: `agent:${agentId}`,
          sessionKey: `agent:main:subagent:project-loop-${agentId}`,
          runId: `runtime-${agentId}`,
          status: 'completed',
          submitStatus: 'submitted',
          startedAt: now,
          updatedAt: now,
          completedAt: now,
          iteration: 1,
        })),
        workflowSnapshot: workflow,
        nodeRuns: workflow.nodes.map((node) => ({
          nodeId: node.nodeId,
          status: node.type === 'loop' ? 'waiting' : 'completed',
          attempt: node.type === 'loop' ? 0 : 1,
          startedAt: now,
          updatedAt: now,
          completedAt: node.type === 'loop' ? undefined : now,
        })),
      }],
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(storePath, JSON.stringify({ clusters: [cluster] }), 'utf8');

    const gateway = { rpc: vi.fn().mockResolvedValue({ runId: 'runtime-b2', status: 'submitted' }) };
    const updated = await skipAgentClusterRunAgent(
      'cluster-project-loop-new-session',
      'run-1',
      'agent-d',
      gateway as never,
    );

    const run = updated.runs[0];
    for (const agentId of ['agent-b', 'agent-c', 'agent-d']) {
      const child = run.childRuns.find((item) => item.agentId === agentId)!;
      expect(child.iteration).toBe(2);
      expect(child.sessionKey).not.toBe(`agent:main:subagent:project-loop-${agentId}`);
      expect(child.promptMode).toBe('continuation');
    }
    expect(run.childRuns.find((item) => item.agentId === 'agent-b')?.status).toBe('starting');
    expect(run.childRuns.find((item) => item.agentId === 'agent-c')?.status).toBe('blocked');
    expect(run.childRuns.find((item) => item.agentId === 'agent-d')?.status).toBe('blocked');
    await vi.waitFor(() => expect(gateway.rpc).toHaveBeenCalled());
    await vi.waitFor(async () => {
      const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
        clusters: Array<{ runs: Array<{ childRuns: Array<{ agentId: string; runId: string; submitStatus: string }> }> }>;
      };
      expect(stored.clusters[0].runs[0].childRuns.find((child) => child.agentId === 'agent-b')).toMatchObject({
        runId: 'runtime-b2',
        submitStatus: 'submitted',
      });
    });
  });
});
