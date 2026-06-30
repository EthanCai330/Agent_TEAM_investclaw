import { invokeIpc } from '@/lib/api-client';
import { useAgentsStore } from '@/stores/agents';
import { useInteractionModeStore } from '@/stores/interaction-mode';
import {
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  getLastChatEventAt,
  setHistoryPollTimer,
  setLastChatEventAt,
  upsertImageCacheEntry,
} from './helpers';
import type { ChatSession, RawMessage } from './types';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function buildFallbackMainSessionKey(agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:main`;
}

function resolveMainSessionKeyForAgent(agentId: string | undefined | null): string | null {
  if (!agentId) return null;
  const normalizedAgentId = normalizeAgentId(agentId);
  const summary = useAgentsStore.getState().agents.find((agent) => agent.id === normalizedAgentId);
  return summary?.mainSessionKey || buildFallbackMainSessionKey(normalizedAgentId);
}

function applyInteractionModePrompt(text: string): string {
  const mode = useInteractionModeStore.getState().mode;
  if (mode === 'run') return text;
  if (mode === 'plan') {
    return [
      '你现在处于 InvestClaw Plan 模式。',
      '严格要求：不要执行工具、不要写文件、不要启动任务、不要声称已经完成执行。',
      '请只输出 2-3 个互斥可选方案，使用 A/B/C 标记。',
      '每个方案包含：目标、步骤、风险、适用场景、预计成本/耗时。',
      '最后给出推荐方案，并停下来问我选择 A/B/C 哪个。',
      '',
      '用户原始请求：',
      text,
    ].join('\n');
  }
  if (mode === 'ask') {
    return [
      '你现在处于 InvestClaw Ask 模式。',
      '只回答问题和解释概念，不要执行工具、不要写文件、不要启动任务。',
      '',
      '用户原始请求：',
      text,
    ].join('\n');
  }
  return [
    '你现在处于 InvestClaw Review 模式。',
    '请审查、指出风险和改进建议。除非用户明确要求，否则不要执行工具、不要写文件、不要启动任务。',
    '',
    '用户原始请求：',
    text,
  ].join('\n');
}

function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  return [...sessions, { key: sessionKey, displayName: sessionKey }];
}

export function createRuntimeSendActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'sendMessage' | 'abortRun'> {
  return {
    sendMessage: async (
      text: string,
      attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
      targetAgentId?: string | null,
    ) => {
      const trimmed = text.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;

      const targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId) ?? get().currentSessionKey;
      if (targetSessionKey !== get().currentSessionKey) {
        const current = get();
        const leavingEmpty = !current.currentSessionKey.endsWith(':main') && current.messages.length === 0;
        set((s) => ({
          currentSessionKey: targetSessionKey,
          currentAgentId: getAgentIdFromSessionKey(targetSessionKey),
          sessions: ensureSessionEntry(
            leavingEmpty ? s.sessions.filter((session) => session.key !== current.currentSessionKey) : s.sessions,
            targetSessionKey,
          ),
          sessionLabels: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([key]) => key !== current.currentSessionKey))
            : s.sessionLabels,
          sessionLastActivity: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([key]) => key !== current.currentSessionKey))
            : s.sessionLastActivity,
          messages: [],
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          activeRunId: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
        }));
        await get().loadHistory(true);
      }

      const currentSessionKey = targetSessionKey;

      // Add user message optimistically (with local file metadata for UI display)
      const nowMs = Date.now();
      const userMsg: RawMessage = {
        role: 'user',
        content: trimmed || (attachments?.length ? '(file attached)' : ''),
        timestamp: nowMs / 1000,
        id: crypto.randomUUID(),
        _attachedFiles: attachments?.map(a => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          preview: a.preview,
          filePath: a.stagedPath,
        })),
      };
      set((s) => ({
        messages: [...s.messages, userMsg],
        sending: true,
        error: null,
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        pendingFinal: false,
        lastUserMessageAt: nowMs,
      }));

      // Update session label with first user message text as soon as it's sent
      const { sessionLabels, messages } = get();
      const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
      if (!currentSessionKey.endsWith(':main') && isFirstMessage && !sessionLabels[currentSessionKey] && trimmed) {
        const truncated = trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
        set((s) => ({ sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated } }));
      }

      // Mark this session as most recently active
      set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

      // Start the history poll and safety timeout IMMEDIATELY (before the
      // RPC await) because the gateway's chat.send RPC may block until the
      // entire agentic conversation finishes — the poll must run in parallel.
      setLastChatEventAt(Date.now());
      clearHistoryPoll();
      clearErrorRecoveryTimer();

      const POLL_START_DELAY = 3_000;
      const POLL_INTERVAL = 4_000;
      const pollHistory = () => {
        const state = get();
        if (!state.sending) { clearHistoryPoll(); return; }
        if (state.streamingMessage) {
          setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
          return;
        }
        state.loadHistory(true);
        setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
      };
      setHistoryPollTimer(setTimeout(pollHistory, POLL_START_DELAY));

      const SAFETY_TIMEOUT_MS = 90_000;
      const checkStuck = () => {
        const state = get();
        if (!state.sending) return;
        if (state.streamingMessage || state.streamingText) return;
        if (state.pendingFinal) {
          setTimeout(checkStuck, 10_000);
          return;
        }
        if (Date.now() - getLastChatEventAt() < SAFETY_TIMEOUT_MS) {
          setTimeout(checkStuck, 10_000);
          return;
        }
        clearHistoryPoll();
        set({
          error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
          sending: false,
          activeRunId: null,
          lastUserMessageAt: null,
        });
      };
      setTimeout(checkStuck, 30_000);

      try {
        const idempotencyKey = crypto.randomUUID();
        const hasMedia = attachments && attachments.length > 0;
        const outboundMessage = trimmed ? applyInteractionModePrompt(trimmed) : '';
        if (hasMedia) {
          console.log('[sendMessage] Media paths:', attachments!.map(a => a.stagedPath));
        }

        // Cache image attachments BEFORE the IPC call to avoid race condition:
        // history may reload (via Gateway event) before the RPC returns.
        // Keyed by staged file path which appears in [media attached: <path> ...].
        if (hasMedia && attachments) {
          for (const a of attachments) {
            upsertImageCacheEntry(a.stagedPath, {
              fileName: a.fileName,
              mimeType: a.mimeType,
              fileSize: a.fileSize,
              preview: a.preview,
            });
          }
        }

        let result: { success: boolean; result?: { runId?: string }; error?: string };

        // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
        const CHAT_SEND_TIMEOUT_MS = 120_000;

        if (hasMedia) {
          result = await invokeIpc(
            'chat:sendWithMedia',
            {
              sessionKey: currentSessionKey,
              message: outboundMessage || 'Process the attached file(s).',
              deliver: false,
              idempotencyKey,
              media: attachments.map((a) => ({
                filePath: a.stagedPath,
                mimeType: a.mimeType,
                fileName: a.fileName,
              })),
            },
          ) as { success: boolean; result?: { runId?: string }; error?: string };
        } else {
          result = await invokeIpc(
            'gateway:rpc',
            'chat.send',
            {
              sessionKey: currentSessionKey,
              message: outboundMessage,
              deliver: false,
              idempotencyKey,
            },
            CHAT_SEND_TIMEOUT_MS,
          ) as { success: boolean; result?: { runId?: string }; error?: string };
        }

        console.log(`[sendMessage] RPC result: success=${result.success}, runId=${result.result?.runId || 'none'}`);

        if (!result.success) {
          clearHistoryPoll();
          set({ error: result.error || 'Failed to send message', sending: false });
        } else if (result.result?.runId) {
          set({ activeRunId: result.result.runId });
        }
      } catch (err) {
        clearHistoryPoll();
        set({ error: String(err), sending: false });
      }
    },

    // ── Abort active run ──

    abortRun: async () => {
      clearHistoryPoll();
      clearErrorRecoveryTimer();
      const { currentSessionKey } = get();
      set({ sending: false, streamingText: '', streamingMessage: null, pendingFinal: false, lastUserMessageAt: null, pendingToolImages: [] });
      set({ streamingTools: [] });

      try {
        await invokeIpc(
          'gateway:rpc',
          'chat.abort',
          { sessionKey: currentSessionKey },
        );
      } catch (err) {
        set({ error: String(err) });
      }
    },

    // ── Handle incoming chat events from Gateway ──

  };
}
