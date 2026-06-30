import { create } from 'zustand';
import type { InteractionMode } from '@/types/agent-cluster';

const STORAGE_KEY = 'investclaw:interaction-mode';

function readInitialMode(): InteractionMode {
  if (typeof window === 'undefined') return 'run';
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === 'ask' || value === 'plan' || value === 'review' || value === 'run' ? value : 'run';
}

interface InteractionModeState {
  mode: InteractionMode;
  setMode: (mode: InteractionMode) => void;
}

export const interactionModeLabels: Record<InteractionMode, string> = {
  ask: 'Ask',
  plan: 'Plan',
  run: 'Run',
  review: 'Review',
};

export const useInteractionModeStore = create<InteractionModeState>((set) => ({
  mode: readInitialMode(),
  setMode: (mode) => {
    window.localStorage.setItem(STORAGE_KEY, mode);
    set({ mode });
  },
}));
