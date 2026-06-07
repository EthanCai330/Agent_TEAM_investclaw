import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/investclaw-test'),
  },
}));

describe('agent cluster helpers', () => {
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
});
