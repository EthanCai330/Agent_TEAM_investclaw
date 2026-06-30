/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Network,
  Bot,
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Terminal,
  ExternalLink,
  Trash2,
  Cpu,
  GitBranch,
  Folder,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Pin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useAgentClusterStore } from '@/stores/agent-clusters';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';

type SidebarSectionKey = 'agentClusters' | 'projectFolders' | 'unfiledChats';

const SIDEBAR_SECTION_STATE_KEY = 'investclaw:sidebar-section-state';
const SIDEBAR_PROJECT_STATE_KEY = 'investclaw:sidebar-project-state';
const HIDDEN_PROJECT_FOLDERS_KEY = 'investclaw:hidden-project-folders';
const PINNED_AGENT_CLUSTERS_KEY = 'investclaw:pinned-agent-clusters';
const DEFAULT_SECTION_STATE: Record<SidebarSectionKey, boolean> = {
  agentClusters: true,
  projectFolders: true,
  unfiledChats: true,
};

function loadStoredRecord<T extends Record<string, boolean>>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function loadHiddenProjectFolders(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_PROJECT_FOLDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
  } catch {
    return [];
  }
}

function loadStringRecord(key: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string'
      ),
    );
  } catch {
    return {};
  }
}

function persistLocalState(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sidebar organization is best-effort local UI state.
  }
}

function SidebarSectionHeader({
  testId,
  expanded,
  label,
  count,
  onToggle,
  action,
}: {
  testId: string;
  expanded: boolean;
  label: string;
  count: number;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div data-testid={testId} className="flex min-w-0 items-center gap-1 px-1">
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        aria-expanded={expanded}
        onClick={onToggle}
        className="zone-hoverable flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-left text-[11px] font-medium tracking-tight text-muted-foreground/75"
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
        <span className="ml-auto min-w-5 shrink-0 rounded-md border border-border/50 bg-card/45 px-1.5 py-0.5 text-center text-[9px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </button>
      {action}
    </div>
  );
}

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  zoneClass: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
  testId?: string;
}

function NavItem({ to, icon, label, zoneClass, badge, collapsed, onClick, testId }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      data-testid={testId}
      className={({ isActive }) =>
        cn(
          zoneClass,
          'zone-hoverable flex min-h-9 items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-[13px] font-medium transition-[border-color,box-shadow,color]',
          'text-foreground/[0.78] hover:text-foreground',
          isActive
            ? 'zone-active'
            : '',
          collapsed && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div className={cn("flex shrink-0 items-center justify-center", isActive ? "zone-icon" : "text-muted-foreground")}>
            {icon}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
              {badge && (
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {badge}
                </Badge>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function getConversationKeyFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return sessionKey || 'main';
  const parts = sessionKey.split(':');
  return parts.slice(2).join(':') || 'main';
}

function isClusterSubagentSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith('agent:main:subagent:cluster-');
}

function formatSidebarExactTime(value?: string): string {
  if (!value) return '无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '无记录';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sanitizeSidebarText(value?: string | null): string {
  if (!value) return '';
  return value
    .replace(/agent:main:subagent:cluster-[A-Za-z0-9:_-]+/g, 'Agent 子会话')
    .replace(/\brun-[0-9a-fA-F-]{8,}\b/g, '本次运行')
    .replace(/\/Users\/[^\s"'，。；、)）\]}]+/g, '本地路径')
    .replace(/\/(?:Volumes|private|tmp|var|home|workspace|opt|usr|etc)\/[^\s"'，。；、)）\]}]+/g, '本地路径')
    .replace(/[A-Za-z]:\\[^\s"'，。；、)）\]}]+/g, '本地路径');
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentConversationKey = useChatStore((s) => s.currentConversationKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const sessionProjects = useChatStore((s) => s.sessionProjects);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const assignSessionToProject = useChatStore((s) => s.assignSessionToProject);
  const unassignSessionProject = useChatStore((s) => s.unassignSessionProject);
  const unassignSessionsFromProject = useChatStore((s) => s.unassignSessionsFromProject);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const clusters = useAgentClusterStore((s) => s.clusters);
  const loadClusters = useAgentClusterStore((s) => s.loadClusters);
  const renameCluster = useAgentClusterStore((s) => s.renameCluster);
  const deleteCluster = useAgentClusterStore((s) => s.deleteCluster);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions]);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const navigate = useNavigate();
  const location = useLocation();
  const isOnChat = location.pathname === '/';

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    sanitizeSidebarText(sessionLabels[key] ?? label ?? displayName ?? '未命名对话');

  const openDevConsole = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const { t } = useTranslation(['common', 'chat']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [clusterToDelete, setClusterToDelete] = useState<{ id: string; label: string } | null>(null);
  const [projectToRemove, setProjectToRemove] = useState<{ key: string; name: string } | null>(null);
  const [editingItem, setEditingItem] = useState<{ type: 'session' | 'cluster'; id: string; value: string } | null>(null);
  const [draggedSessionKey, setDraggedSessionKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [sectionState, setSectionState] = useState<Record<SidebarSectionKey, boolean>>(
    () => loadStoredRecord(SIDEBAR_SECTION_STATE_KEY, DEFAULT_SECTION_STATE),
  );
  const [projectState, setProjectState] = useState<Record<string, boolean>>(
    () => loadStoredRecord(SIDEBAR_PROJECT_STATE_KEY, {}),
  );
  const [hiddenProjectFolders, setHiddenProjectFolders] = useState<string[]>(loadHiddenProjectFolders);
  const [pinnedAgentClusters, setPinnedAgentClusters] = useState<Record<string, string>>(
    () => loadStringRecord(PINNED_AGENT_CLUSTERS_KEY),
  );

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const navItems = [
    { to: '/models', zoneClass: 'zone-models', icon: <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.models'), testId: 'sidebar-nav-models' },
    { to: '/agents', zoneClass: 'zone-cluster', icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.agents'), testId: 'sidebar-nav-agents' },
    { to: '/agent-clusters', zoneClass: 'zone-cluster', icon: <GitBranch className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.agentClusters'), testId: 'sidebar-nav-agent-clusters' },
    { to: '/channels', zoneClass: 'zone-chat', icon: <Network className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.channels'), testId: 'sidebar-nav-channels' },
    { to: '/skills', zoneClass: 'zone-skills', icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.skills'), testId: 'sidebar-nav-skills' },
    { to: '/cron', zoneClass: 'zone-cron', icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.cronTasks'), testId: 'sidebar-nav-cron' },
  ];
  const sortedClusters = useMemo(
    () => [...clusters].filter((item) => item?.clusterId).sort((a, b) => {
      const pinnedA = pinnedAgentClusters[a.clusterId];
      const pinnedB = pinnedAgentClusters[b.clusterId];
      if (pinnedA || pinnedB) {
        if (!pinnedA) return 1;
        if (!pinnedB) return -1;
        return pinnedB.localeCompare(pinnedA);
      }
      const createdA = a.createdAt || '';
      const createdB = b.createdAt || '';
      if (createdA || createdB) {
        if (!createdA) return 1;
        if (!createdB) return -1;
        const byCreatedAt = createdB.localeCompare(createdA);
        if (byCreatedAt !== 0) return byCreatedAt;
      }
      return (a.clusterName || a.clusterId).localeCompare(b.clusterName || b.clusterId);
    }),
    [clusters, pinnedAgentClusters],
  );
  const ordinarySessions = useMemo(
    () => {
      const groups = new Map<string, typeof sessions>();
      for (const session of sessions.filter((item) => !isClusterSubagentSessionKey(item.key))) {
        const conversationKey = getConversationKeyFromSessionKey(session.key);
        groups.set(conversationKey, [...(groups.get(conversationKey) ?? []), session]);
      }
      return [...groups.entries()]
        .map(([, groupSessions]) => {
          const mainSession = groupSessions.find((session) => getAgentIdFromSessionKey(session.key) === 'main');
          const activeSession = groupSessions.find((session) => session.key === currentSessionKey);
          return activeSession ?? mainSession ?? groupSessions[0];
        })
        .filter(Boolean)
        .sort((a, b) => {
          const newestForConversation = (sessionKey: string) => {
            const conversationKey = getConversationKeyFromSessionKey(sessionKey);
            let newest = 0;
            for (const session of sessions) {
              if (getConversationKeyFromSessionKey(session.key) === conversationKey) {
                newest = Math.max(newest, sessionLastActivity[session.key] ?? 0);
              }
            }
            return newest;
          };
          return newestForConversation(b.key) - newestForConversation(a.key);
        });
    },
    [currentSessionKey, sessionLastActivity, sessions],
  );
  const allProjectFolders = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      name: string;
      path?: string | null;
      sessions: typeof sessions;
    }>();
    for (const cluster of clusters.filter((item) => item?.clusterId)) {
      const key = cluster.projectKey || cluster.sourceFolderPath || cluster.sourcePath || 'unfiled';
      if (!key || key === 'unfiled') continue;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: cluster.projectName || key.split('/').filter(Boolean).at(-1) || key,
          path: cluster.sourceFolderPath || cluster.sourcePath || null,
          sessions: [],
        });
      }
    }
    for (const session of ordinarySessions) {
      const assignment = sessionProjects[session.key];
      if (!assignment) continue;
      const existing = groups.get(assignment.projectKey);
      if (existing) {
        existing.sessions.push(session);
      } else {
        groups.set(assignment.projectKey, {
          key: assignment.projectKey,
          name: assignment.projectName,
          path: assignment.projectPath ?? null,
          sessions: [session],
        });
      }
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        sessions: [...group.sessions].sort((a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)),
      }))
      .sort((a, b) => {
        const newestA = a.sessions[0] ? sessionLastActivity[a.sessions[0].key] ?? 0 : 0;
        const newestB = b.sessions[0] ? sessionLastActivity[b.sessions[0].key] ?? 0 : 0;
        if (newestA !== newestB) return newestB - newestA;
        return a.name.localeCompare(b.name);
      });
  }, [clusters, ordinarySessions, sessionLastActivity, sessionProjects]);
  const projectFolders = useMemo(
    () => allProjectFolders.filter((group) => !hiddenProjectFolders.includes(group.key)),
    [allProjectFolders, hiddenProjectFolders],
  );
  const unfiledSessions = useMemo(
    () => ordinarySessions.filter((session) => !sessionProjects[session.key]),
    [ordinarySessions, sessionProjects],
  );
  const isOnAgentClusters = location.pathname.startsWith('/agent-clusters');

  const toggleSection = (section: SidebarSectionKey) => {
    setSectionState((current) => {
      const next = { ...current, [section]: !current[section] };
      persistLocalState(SIDEBAR_SECTION_STATE_KEY, next);
      return next;
    });
  };

  const togglePinnedAgentCluster = (clusterId: string) => {
    setPinnedAgentClusters((current) => {
      const next = { ...current };
      if (next[clusterId]) {
        delete next[clusterId];
      } else {
        next[clusterId] = new Date().toISOString();
      }
      persistLocalState(PINNED_AGENT_CLUSTERS_KEY, next);
      return next;
    });
  };

  const toggleProject = (projectKey: string) => {
    setProjectState((current) => {
      const next = { ...current, [projectKey]: current[projectKey] === false };
      persistLocalState(SIDEBAR_PROJECT_STATE_KEY, next);
      return next;
    });
  };

  const restoreHiddenProjects = () => {
    setHiddenProjectFolders([]);
    persistLocalState(HIDDEN_PROJECT_FOLDERS_KEY, []);
  };

  const submitRename = async () => {
    if (!editingItem) return;
    const value = editingItem.value.trim();
    if (!value) {
      setEditingItem(null);
      return;
    }
    if (editingItem.type === 'cluster') {
      await renameCluster(editingItem.id, value);
    } else {
      renameSession(editingItem.id, value);
    }
    setEditingItem(null);
  };

  const handleProjectDrop = (project: { key: string; name: string; path?: string | null }) => {
    if (!draggedSessionKey) return;
    assignSessionToProject(draggedSessionKey, {
      projectKey: project.key,
      projectName: project.name,
      projectPath: project.path ?? null,
    });
    if (hiddenProjectFolders.includes(project.key)) {
      const nextHidden = hiddenProjectFolders.filter((key) => key !== project.key);
      setHiddenProjectFolders(nextHidden);
      persistLocalState(HIDDEN_PROJECT_FOLDERS_KEY, nextHidden);
    }
    setDraggedSessionKey(null);
    setDropTargetKey(null);
  };

  const handleUnfiledDrop = () => {
    if (!draggedSessionKey) return;
    unassignSessionProject(draggedSessionKey);
    setDraggedSessionKey(null);
    setDropTargetKey(null);
  };

  const renderSessionItem = (s: typeof sessions[number], options?: { compact?: boolean }) => {
    const agentId = getAgentIdFromSessionKey(s.key);
    const agentName = agentNameById[agentId] || agentId;
    const sessionZoneClass = agentId === 'main' ? 'zone-chat' : 'zone-models';
    const isEditing = editingItem?.type === 'session' && editingItem.id === s.key;
    return (
      <div key={s.key} className="group relative flex items-center">
        <button
          draggable={!isEditing}
          data-testid={`sidebar-chat-session-${s.key}`}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', s.key);
            setDraggedSessionKey(s.key);
          }}
          onDragEnd={() => {
            setDraggedSessionKey(null);
            setDropTargetKey(null);
          }}
          onClick={() => { switchSession(s.key); navigate('/'); }}
          className={cn(
            sessionZoneClass,
            'zone-hoverable w-full rounded-lg border border-transparent px-2.5 py-1.5 pr-7 text-left text-[13px] transition-colors',
            options?.compact && 'py-1 text-[12px]',
            isOnChat && getConversationKeyFromSessionKey(currentConversationKey || currentSessionKey) === getConversationKeyFromSessionKey(s.key)
              ? 'zone-active font-medium'
              : 'text-foreground/75',
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="zone-chip shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">
              {agentName}
            </span>
            {isEditing ? (
              <input
                autoFocus
                value={editingItem.value}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitRename();
                  if (e.key === 'Escape') setEditingItem(null);
                }}
                className="min-w-0 flex-1 rounded-md border border-input/80 bg-card/75 px-1 py-0.5 text-xs"
              />
            ) : (
              <span className="truncate">{getSessionLabel(s.key, s.displayName, s.label)}</span>
            )}
          </div>
        </button>
        {isEditing ? (
          <div className="absolute right-1 flex gap-0.5">
            <button aria-label="Confirm session rename" onClick={(e) => { e.stopPropagation(); void submitRename(); }} className="rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-foreground">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button aria-label="Cancel session rename" onClick={(e) => { e.stopPropagation(); setEditingItem(null); }} className="rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="absolute right-1 flex opacity-0 transition-opacity group-hover:opacity-100">
            <button
              aria-label="Rename session"
              onClick={(e) => {
                e.stopPropagation();
                setEditingItem({ type: 'session', id: s.key, value: getSessionLabel(s.key, s.displayName, s.label) });
              }}
              className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Delete session"
              onClick={(e) => {
                e.stopPropagation();
                setSessionToDelete({
                  key: s.key,
                  label: getSessionLabel(s.key, s.displayName, s.label),
                });
              }}
              className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'sidebar-glass flex shrink-0 flex-col transition-all duration-300',
        window.electron?.platform === 'darwin' ? 'native-window-material' : 'window-material',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Top Header Toggle */}
      <div className={cn("flex h-12 items-center px-2.5", sidebarCollapsed ? "justify-center" : "justify-between")}>
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-2 overflow-hidden">
            <img src={logoSvg} alt="InvestClaw" className="h-5 w-auto shrink-0" />
            <span className="text-sm font-semibold truncate whitespace-nowrap text-foreground/90">
              InvestClaw
            </span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:shadow-sm hover:text-foreground"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-[18px] w-[18px]" />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-2.5">
        <button
          data-testid="sidebar-new-chat"
          onClick={() => {
            const { messages } = useChatStore.getState();
            if (messages.length > 0) newSession();
            navigate('/');
          }}
          className={cn(
            'zone-chat zone-hoverable mb-1.5 flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-[border-color,box-shadow,color]',
            'border border-transparent bg-transparent text-foreground shadow-none',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          <div className="flex shrink-0 items-center justify-center text-foreground/80">
            <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.newChat')}</span>}
        </button>

        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Session list — always keeps the three primary groups visible. */}
      {!sidebarCollapsed && (
        <div className="mt-3 flex-1 space-y-2 overflow-x-hidden overflow-y-auto px-2.5 pb-2">
          <section className="pt-1">
            <SidebarSectionHeader
              testId="sidebar-section-agent-clusters"
              expanded={sectionState.agentClusters}
              label="Agent 集群"
              count={sortedClusters.length}
              onToggle={() => toggleSection('agentClusters')}
            />
            {sectionState.agentClusters && (
              <div className="mt-1 space-y-0.5">
                {sortedClusters.map((cluster) => {
                const activeRun = cluster.runs?.find((run) => run.runId === cluster.activeRunId) ?? cluster.runs?.[0];
                const childSessions = activeRun?.childRuns ?? [];
                const isEditing = editingItem?.type === 'cluster' && editingItem.id === cluster.clusterId;
                return (
                  <div key={cluster.clusterId} className="group/cluster pb-1">
                    <div className="relative flex items-center">
                      <button
                        data-testid={`sidebar-agent-cluster-${cluster.clusterId}`}
                        onClick={() => navigate(`/agent-clusters/${cluster.clusterId}`)}
                        className={cn(
                          'zone-cluster zone-hoverable w-full rounded-lg border border-transparent px-2.5 py-1.5 pr-12 text-left text-[13px] transition-colors',
                          isOnAgentClusters && location.pathname.endsWith(cluster.clusterId)
                            ? 'zone-active font-medium'
                            : 'text-foreground/75',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="zone-chip flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                            <GitBranch className="h-3 w-3" />
                            集群
                          </span>
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editingItem.value}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void submitRename();
                                if (e.key === 'Escape') setEditingItem(null);
                              }}
                              className="min-w-0 flex-1 rounded-md border border-input/80 bg-card/75 px-1 py-0.5 text-xs"
                            />
                          ) : (
                            <span className="truncate">{cluster.clusterName}</span>
                          )}
                        </div>
                        {cluster.projectName && !isEditing && (
                          <div className="mt-0.5 truncate pl-[58px] text-[10px] text-muted-foreground/50">
                            {cluster.projectName}
                          </div>
                        )}
                      </button>
                      {isEditing ? (
                        <div className="absolute right-1 flex gap-0.5">
                          <button aria-label="Confirm rename" onClick={(e) => { e.stopPropagation(); void submitRename(); }} className="rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-foreground">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button aria-label="Cancel rename" onClick={(e) => { e.stopPropagation(); setEditingItem(null); }} className="rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-foreground">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="absolute right-1 top-1.5 flex opacity-0 transition-opacity group-hover/cluster:opacity-100">
                          <button
                            data-testid={`sidebar-agent-cluster-pin-${cluster.clusterId}`}
                            aria-label={pinnedAgentClusters[cluster.clusterId] ? 'Unpin cluster' : 'Pin cluster'}
                            title={pinnedAgentClusters[cluster.clusterId] ? '取消置顶' : '置顶集群'}
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePinnedAgentCluster(cluster.clusterId);
                            }}
                            className={cn(
                              'rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-foreground',
                              pinnedAgentClusters[cluster.clusterId] && 'text-foreground',
                            )}
                          >
                            <Pin className="h-3.5 w-3.5" />
                          </button>
                          <button
                            aria-label="Rename cluster"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingItem({ type: 'cluster', id: cluster.clusterId, value: cluster.clusterName });
                            }}
                            className="rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            aria-label="Delete cluster"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClusterToDelete({ id: cluster.clusterId, label: cluster.clusterName });
                            }}
                            className="rounded p-0.5 text-muted-foreground hover:shadow-sm hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    {childSessions.length > 0 && (
                      <div className="ml-5 mt-0.5 space-y-0.5 border-l pl-2">
                        {childSessions.map((child) => {
                          const agent = cluster.agents.find((item) => item.agentId === child.agentId);
                          const label = sanitizeSidebarText(agent?.name ?? sessionLabels[child.sessionKey] ?? 'Agent 子会话');
                          const lastActivity = child.lastEventAt ?? child.updatedAt ?? child.startedAt;
                          const childTitle = [
                            label,
                            `状态：${child.status}`,
                            `最后活动：${formatSidebarExactTime(lastActivity)}`,
                            `sessionKey：${child.sessionKey}`,
                          ].join('\n');
                          return (
                            <button
                              key={child.sessionKey}
                              onClick={() => { switchSession(child.sessionKey); navigate('/'); }}
                              title={childTitle}
                              className="zone-cluster zone-hoverable flex w-full min-w-0 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              <Bot className="h-3 w-3 shrink-0" />
                              <span className="truncate">{label}</span>
                              <span className="ml-auto shrink-0 text-[9px] opacity-60">{child.status}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
                {sortedClusters.length === 0 && (
                  <div className="mx-1 rounded-md border border-dashed border-border/45 px-2 py-2 text-[11px] text-muted-foreground/55">
                    暂无 Agent 集群
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <SidebarSectionHeader
              testId="sidebar-section-project-folders"
              expanded={sectionState.projectFolders}
              label="项目文件夹"
              count={projectFolders.length}
              onToggle={() => toggleSection('projectFolders')}
              action={hiddenProjectFolders.length > 0 ? (
                <button
                  type="button"
                  data-testid="sidebar-restore-project-folders"
                  aria-label="恢复已移除项目"
                  title="恢复已移除项目"
                  onClick={restoreHiddenProjects}
                  className="zone-hoverable flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              ) : undefined}
            />
            {sectionState.projectFolders && (
              <div className="mt-1 space-y-0.5">
                {projectFolders.map((group) => {
                  const projectExpanded = projectState[group.key] !== false;
                  return (
                    <div
                      key={`project-folder-${group.key}`}
                      data-testid={`sidebar-project-folder-${group.key}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTargetKey(group.key);
                      }}
                      onDragLeave={() => setDropTargetKey((key) => key === group.key ? null : key)}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleProjectDrop(group);
                      }}
                      className={cn(
                        'group/project rounded-lg border border-transparent p-0.5 transition-[border-color,box-shadow]',
                        dropTargetKey === group.key && 'zone-active',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-1">
                        <button
                          type="button"
                          data-testid={`sidebar-project-folder-toggle-${group.key}`}
                          aria-expanded={projectExpanded}
                          onClick={() => toggleProject(group.key)}
                          className="zone-hoverable flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground/75"
                        >
                          {projectExpanded
                            ? <ChevronDown className="h-3 w-3 shrink-0" />
                            : <ChevronRight className="h-3 w-3 shrink-0" />}
                          <Folder className="h-3 w-3 shrink-0" />
                          <span className="truncate">{sanitizeSidebarText(group.name)}</span>
                          <span className="ml-auto shrink-0 text-[9px] tabular-nums opacity-60">
                            {group.sessions.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          data-testid={`sidebar-project-folder-remove-${group.key}`}
                          aria-label={`移除项目文件夹 ${sanitizeSidebarText(group.name)}`}
                          title="从侧边栏移除项目"
                          onClick={() => setProjectToRemove({ key: group.key, name: sanitizeSidebarText(group.name) })}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,box-shadow,color] hover:text-destructive hover:shadow-sm group-hover/project:opacity-100 focus-visible:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {projectExpanded && (
                        <div className="mt-0.5 space-y-0.5 pl-3">
                          {group.sessions.length > 0 ? (
                            group.sessions.map((session) => renderSessionItem(session, { compact: true }))
                          ) : (
                            <div className="rounded-md border border-dashed border-border/45 px-2 py-2 text-[11px] text-muted-foreground/50">
                              拖入对话归档到此项目
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {projectFolders.length === 0 && (
                  <div className="mx-1 rounded-md border border-dashed border-border/45 px-2 py-2 text-[11px] text-muted-foreground/55">
                    {hiddenProjectFolders.length > 0 ? '项目已从侧边栏移除，可点击恢复。' : '暂无项目文件夹'}
                  </div>
                )}
              </div>
            )}
          </section>

          <section
            className={cn(
              'rounded-lg border border-transparent transition-[border-color,box-shadow]',
              dropTargetKey === 'unfiled' && 'zone-active',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropTargetKey('unfiled');
            }}
            onDragLeave={() => setDropTargetKey((key) => key === 'unfiled' ? null : key)}
            onDrop={(e) => {
              e.preventDefault();
              handleUnfiledDrop();
            }}
          >
            <SidebarSectionHeader
              testId="sidebar-section-unfiled-chats"
              expanded={sectionState.unfiledChats}
              label="单独对话"
              count={unfiledSessions.length}
              onToggle={() => toggleSection('unfiledChats')}
            />
            {sectionState.unfiledChats && (
              <div className="mt-1 space-y-0.5">
                {unfiledSessions.length > 0 ? (
                  unfiledSessions.map((session) => renderSessionItem(session))
                ) : (
                  <div className="mx-1 rounded-md border border-dashed border-border/45 px-2 py-2 text-[11px] text-muted-foreground/55">
                    暂无单独对话，可将项目对话拖回这里。
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Footer */}
      <div className="p-2 mt-auto">
        <NavLink
            to="/settings"
            data-testid="sidebar-nav-settings"
            className={({ isActive }) =>
              cn(
                'zone-settings zone-hoverable flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-[14px] font-medium transition-colors',
                'text-foreground/[0.78] hover:text-foreground',
                isActive && 'zone-active',
                sidebarCollapsed ? 'justify-center px-0' : ''
              )
            }
          >
          {({ isActive }) => (
            <>
              <div className={cn("flex shrink-0 items-center justify-center", isActive ? "zone-icon" : "text-muted-foreground")}>
                <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
              {!sidebarCollapsed && <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.settings')}</span>}
            </>
          )}
        </NavLink>

        <Button
          data-testid="sidebar-open-dev-console"
          variant="ghost"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 h-auto text-[14px] font-medium transition-colors w-full mt-1',
            'text-foreground/[0.78] hover:shadow-sm hover:text-foreground',
            sidebarCollapsed ? 'justify-center px-0' : 'justify-start'
          )}
          onClick={openDevConsole}
        >
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            <Terminal className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('common:sidebar.openClawPage')}</span>
              <ExternalLink className="h-3 w-3 shrink-0 ml-auto opacity-50 text-muted-foreground" />
            </>
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate('/');
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />
      <ConfirmDialog
        open={!!clusterToDelete}
        title={t('common:actions.confirm')}
        message={`确定删除 Agent 集群“${clusterToDelete?.label ?? ''}”吗？这只会删除 InvestClaw 的集群记录，不会删除项目目录文件。`}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!clusterToDelete) return;
          await deleteCluster(clusterToDelete.id);
          if (location.pathname.endsWith(clusterToDelete.id)) navigate('/agent-clusters');
          setClusterToDelete(null);
        }}
        onCancel={() => setClusterToDelete(null)}
      />
      <ConfirmDialog
        open={!!projectToRemove}
        title="移除项目文件夹"
        message={`确定从侧边栏移除“${projectToRemove?.name ?? ''}”吗？其中的普通对话会移回“单独对话”，不会删除 Agent 集群或本地目录。`}
        confirmLabel="移除"
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={() => {
          if (!projectToRemove) return;
          unassignSessionsFromProject(projectToRemove.key);
          setHiddenProjectFolders((current) => {
            const next = current.includes(projectToRemove.key)
              ? current
              : [...current, projectToRemove.key];
            persistLocalState(HIDDEN_PROJECT_FOLDERS_KEY, next);
            return next;
          });
          setProjectToRemove(null);
        }}
        onCancel={() => setProjectToRemove(null)}
      />
    </aside>
  );
}
