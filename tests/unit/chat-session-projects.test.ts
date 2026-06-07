import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@/stores/chat';

describe('chat session project assignments', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useChatStore.setState({
      sessions: [
        { key: 'agent:main:session-1', displayName: 'session-1' },
        { key: 'agent:main:session-2', displayName: 'session-2' },
      ],
      currentSessionKey: 'agent:main:session-1',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {
        'agent:main:session-1': 100,
        'agent:main:session-2': 200,
      },
      sessionProjects: {},
    });
  });

  it('assigns a chat session to a project and persists it locally', () => {
    useChatStore.getState().assignSessionToProject('agent:main:session-1', {
      projectKey: '/tmp/sample_research_project',
      projectName: 'sample_research_project',
      projectPath: '/tmp/sample_research_project',
    });

    expect(useChatStore.getState().sessionProjects['agent:main:session-1']).toEqual({
      projectKey: '/tmp/sample_research_project',
      projectName: 'sample_research_project',
      projectPath: '/tmp/sample_research_project',
    });
    expect(JSON.parse(window.localStorage.getItem('investclaw:session-projects') || '{}')).toEqual({
      'agent:main:session-1': {
        projectKey: '/tmp/sample_research_project',
        projectName: 'sample_research_project',
        projectPath: '/tmp/sample_research_project',
      },
    });
  });

  it('moves a chat session back to standalone conversations', () => {
    useChatStore.getState().assignSessionToProject('agent:main:session-1', {
      projectKey: '/tmp/sample_research_project',
      projectName: 'sample_research_project',
      projectPath: '/tmp/sample_research_project',
    });

    useChatStore.getState().unassignSessionProject('agent:main:session-1');

    expect(useChatStore.getState().sessionProjects['agent:main:session-1']).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem('investclaw:session-projects') || '{}')).toEqual({});
  });

  it('moves every session in a project back with one persisted state update', () => {
    const project = {
      projectKey: '/tmp/sample_research_project',
      projectName: 'sample_research_project',
      projectPath: '/tmp/sample_research_project',
    };
    useChatStore.getState().assignSessionToProject('agent:main:session-1', project);
    useChatStore.getState().assignSessionToProject('agent:main:session-2', project);

    useChatStore.getState().unassignSessionsFromProject(project.projectKey);

    expect(useChatStore.getState().sessionProjects).toEqual({});
    expect(JSON.parse(window.localStorage.getItem('investclaw:session-projects') || '{}')).toEqual({});
  });
});
