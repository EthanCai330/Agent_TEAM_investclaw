import { cn } from '@/lib/utils';
import { interactionModeLabels, useInteractionModeStore } from '@/stores/interaction-mode';
import type { InteractionMode } from '@/types/agent-cluster';

const modes: InteractionMode[] = ['ask', 'plan', 'run', 'review'];

export function InteractionModeSwitch({ compact = false }: { compact?: boolean }) {
  const mode = useInteractionModeStore((state) => state.mode);
  const setMode = useInteractionModeStore((state) => state.setMode);

  return (
    <div
      data-testid="interaction-mode-switch"
      className={cn(
        'soft-row inline-flex items-center rounded-full p-1',
        compact ? 'gap-0.5' : 'gap-1',
      )}
    >
      {modes.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => setMode(item)}
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-medium transition-shadow hover:shadow-sm',
            mode === item ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
          )}
          title={{
            ask: '只问答，不执行或修改',
            plan: '只生成计划或草稿',
            run: '允许执行确认后的动作',
            review: '审查已有内容，不主动执行',
          }[item]}
        >
          {interactionModeLabels[item]}
        </button>
      ))}
    </div>
  );
}
