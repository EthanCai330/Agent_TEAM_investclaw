import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';
import { GLM_5_1_BASE_MODEL, useBaseModelStore, type BaseModelConfig } from '@/stores/base-model';
import { useProviderStore } from '@/stores/providers';
import { cn } from '@/lib/utils';

interface BaseModelButtonProps {
  compact?: boolean;
  className?: string;
}

export function BaseModelButton({ compact = false, className }: BaseModelButtonProps) {
  const selectedModel = useBaseModelStore((state) => state.selectedModel);
  const setSelectedModel = useBaseModelStore((state) => state.setSelectedModel);
  const accounts = useProviderStore((state) => state.accounts);
  const statuses = useProviderStore((state) => state.statuses);
  const vendors = useProviderStore((state) => state.vendors);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const accountOptions = useMemo<BaseModelConfig[]>(() => {
    const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
    const statusMap = new Map(statuses.map((status) => [status.id, status]));
    return accounts
      .filter((account) => account.enabled !== false)
      .map((account) => {
        const vendor = vendorMap.get(account.vendorId);
        const status = statusMap.get(account.id);
        const model = account.model || status?.model || vendor?.defaultModelId || vendor?.model || account.vendorId;
        const baseUrl = account.baseUrl || status?.baseUrl || vendor?.defaultBaseUrl || '';
        return {
          id: `account:${account.id}`,
          label: `${account.label}${model ? ` · ${model}` : ''}`,
          provider: 'provider-account' as const,
          accountId: account.id,
          baseUrl,
          model,
        };
      });
  }, [accounts, statuses, vendors]);

  const options = useMemo(
    () => [GLM_5_1_BASE_MODEL, ...accountOptions],
    [accountOptions],
  );

  const handleSelect = (model: BaseModelConfig) => {
    setSelectedModel(model);
    setOpen(false);
  };

  return (
    <div ref={menuRef} className="relative inline-flex max-w-full">
      <button
        type="button"
        data-testid="base-model-button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border border-black/10 bg-background px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors',
          'hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5',
          className,
        )}
        title={`${selectedModel.label} · ${selectedModel.baseUrl || selectedModel.accountId || 'provider account'}`}
      >
        <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{compact ? selectedModel.label : `基模：${selectedModel.label}`}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-black/10 bg-background p-1.5 shadow-xl dark:border-white/10">
          <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground">
            选择基模
          </div>
          <div className="max-h-72 overflow-y-auto">
            {options.map((model) => {
              const selected = model.id === selectedModel.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  data-testid={`base-model-option-${model.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                  onClick={() => handleSelect(model)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors',
                    selected ? 'bg-black/[0.06] dark:bg-white/[0.08]' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                  )}
                >
                  <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{model.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {model.baseUrl || (model.accountId ? `Provider account: ${model.accountId}` : '未配置 baseUrl')}
                    </span>
                  </span>
                  {selected && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
