import { DEFAULT_SESSION_KEY, type ChatState } from './types';
import { createRuntimeActions } from './runtime-actions';
import { createSessionHistoryActions } from './session-history-actions';
import type { ChatGet, ChatSet } from './store-api';

export const initialChatState: Pick<
  ChatState,
  | 'messages'
  | 'loading'
  | 'error'
  | 'sending'
  | 'activeRunId'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingTools'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'pendingToolImages'
  | 'sessions'
  | 'currentSessionKey'
  | 'currentAgentId'
  | 'sessionLabels'
  | 'sessionLastActivity'
  | 'sessionProjects'
  | 'showThinking'
  | 'thinkingLevel'
> = {
  messages: [],
  loading: false,
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: null,
  pendingToolImages: [],

  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  currentAgentId: 'main',
  sessionLabels: {},
  sessionLastActivity: {},
  sessionProjects: {},

  showThinking: true,
  thinkingLevel: null,
};

export function createChatActions(
  set: ChatSet,
  get: ChatGet,
): Pick<
  ChatState,
  | 'loadSessions'
  | 'switchSession'
  | 'newSession'
  | 'deleteSession'
  | 'renameSession'
  | 'assignSessionToProject'
  | 'unassignSessionProject'
  | 'unassignSessionsFromProject'
  | 'cleanupEmptySession'
  | 'loadHistory'
  | 'sendMessage'
  | 'abortRun'
  | 'handleChatEvent'
  | 'toggleThinking'
  | 'refresh'
  | 'clearError'
> {
  return {
    ...createSessionHistoryActions(set, get),
    ...createRuntimeActions(set, get),
    renameSession: (key, label) => {
      const trimmed = label.trim();
      set((state) => ({
        sessionLabels: trimmed
          ? { ...state.sessionLabels, [key]: trimmed.slice(0, 80) }
          : Object.fromEntries(Object.entries(state.sessionLabels).filter(([entryKey]) => entryKey !== key)),
      }));
    },
    assignSessionToProject: (key, project) => {
      const projectKey = project.projectKey.trim();
      const projectName = project.projectName.trim();
      if (!projectKey || !projectName) return;
      set((state) => ({
        sessionProjects: {
          ...state.sessionProjects,
          [key]: {
            projectKey,
            projectName: projectName.slice(0, 120),
            projectPath: project.projectPath ?? null,
          },
        },
      }));
    },
    unassignSessionProject: (key) => {
      set((state) => ({
        sessionProjects: Object.fromEntries(
          Object.entries(state.sessionProjects).filter(([entryKey]) => entryKey !== key),
        ),
      }));
    },
    unassignSessionsFromProject: (projectKey) => {
      const normalizedProjectKey = projectKey.trim();
      if (!normalizedProjectKey) return;
      set((state) => ({
        sessionProjects: Object.fromEntries(
          Object.entries(state.sessionProjects).filter(([, assignment]) => (
            assignment.projectKey !== normalizedProjectKey
          )),
        ),
      }));
    },
  };
}
