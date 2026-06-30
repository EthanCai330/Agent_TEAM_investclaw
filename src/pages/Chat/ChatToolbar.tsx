/**
 * Chat Toolbar
 * Session selector, new session, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { useMemo } from 'react';
import { RefreshCw, Brain, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InteractionModeSwitch } from '@/components/common/InteractionModeSwitch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentResponderAgentId = useChatStore((s) => s.currentResponderAgentId);
  const setCurrentResponderAgent = useChatStore((s) => s.setCurrentResponderAgent);
  const sending = useChatStore((s) => s.sending);
  const agents = useAgentsStore((s) => s.agents);
  const { t } = useTranslation('chat');
  const agentOptions = useMemo(
    () => {
      const options = [
        { id: 'main', name: t('toolbar.mainAgent') },
        ...(agents ?? []).map((agent) => ({ id: agent.id, name: agent.name || agent.id })),
      ];
      if (!options.some((agent) => agent.id === currentResponderAgentId)) {
        options.push({ id: currentResponderAgentId, name: currentResponderAgentId });
      }
      const seen = new Set<string>();
      return options.filter((agent) => {
        if (seen.has(agent.id)) return false;
        seen.add(agent.id);
        return true;
      });
    },
    [agents, currentResponderAgentId, t],
  );
  const currentAgentName = useMemo(
    () => agentOptions.find((agent) => agent.id === currentResponderAgentId)?.name ?? currentResponderAgentId,
    [agentOptions, currentResponderAgentId],
  );
  const currentAgentValue = useMemo(
    () => agentOptions.some((agent) => agent.id === currentResponderAgentId) ? currentResponderAgentId : 'main',
    [agentOptions, currentResponderAgentId],
  );

  return (
    <div className="flex items-center gap-2">
      <InteractionModeSwitch compact />
      <label
        className="soft-row hidden items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-foreground/80 sm:flex"
        title={t('toolbar.currentAgent', { agent: currentAgentName })}
      >
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="sr-only">{t('toolbar.selectAgent')}</span>
        <select
          value={currentAgentValue}
          disabled={loading || sending}
          onChange={(event) => setCurrentResponderAgent(event.target.value)}
          className="max-w-[180px] cursor-pointer truncate border-0 bg-transparent py-0 pl-0 pr-1 text-[12px] font-medium text-foreground/80 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:bg-transparent"
          aria-label={t('toolbar.selectAgent')}
        >
          {agentOptions.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>
      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Thinking Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              showThinking && 'zone-chat zone-active',
            )}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
