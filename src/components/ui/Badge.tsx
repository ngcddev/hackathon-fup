import type { BatchStatus } from '@/lib/types/api';
import { Icon, type IconName } from './Icon';
import { cn } from './format';

export type Origin = 'Derivado' | 'Simulado';

// Los datos simulados o derivados siempre se marcan (borde punteado).
export function OriginBadge({ origin, label }: { origin: Origin; label?: string }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-dashed border-slate-500 px-2 py-0.5 text-xs font-bold text-muted">
      {label ?? origin}
    </span>
  );
}

export type Severity = 'critical' | 'warning';

const SEVERITY: Record<Severity, { label: string; icon: IconName; box: string; text: string }> = {
  critical: { label: 'Crítica', icon: 'alerts', box: 'border-danger-line bg-danger-bg', text: 'text-danger' },
  warning: { label: 'Advertencia', icon: 'warning', box: 'border-warn-line bg-warn-bg', text: 'text-warn' },
};

// La severidad se comunica con ícono y texto, no solo con color.
export function SeverityBadge({ severity, small = false }: { severity: Severity; small?: boolean }) {
  const s = SEVERITY[severity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-extrabold',
        small ? 'px-2 py-px text-xs' : 'px-3 py-1 text-sm',
        s.box,
        s.text,
      )}
    >
      <Icon name={s.icon} size={small ? 12 : 15} strokeWidth={2.4} />
      {s.label}
    </span>
  );
}

const BATCH_STATUS: Record<BatchStatus, { label: string; icon?: IconName; box: string }> = {
  applied: { label: 'Aplicado', icon: 'check', box: 'border-ok bg-white text-ok' },
  rejected: { label: 'Rechazado', icon: 'close', box: 'border-danger-line bg-danger-bg text-danger' },
  reverted: { label: 'Revertido', icon: 'undo', box: 'border-slate-300 bg-slate-100 text-muted' },
  pending: { label: 'Pendiente', box: 'border-warn-line bg-warn-bg text-warn' },
  validated: { label: 'Validado', icon: 'check', box: 'border-slate-300 bg-white text-muted' },
};

export function batchStatusLabel(status: BatchStatus): string {
  return BATCH_STATUS[status].label;
}

export function StatusBadge({ status, simulated = false }: { status: BatchStatus; simulated?: boolean }) {
  if (simulated && status === 'applied') {
    return (
      <span className="inline-flex items-center rounded-full border border-dashed border-slate-500 bg-white px-2.5 py-0.5 text-[13px] font-bold text-muted">
        Simulado
      </span>
    );
  }
  const s = BATCH_STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-bold',
        s.box,
      )}
    >
      {s.icon && <Icon name={s.icon} size={14} strokeWidth={2.2} />}
      {s.label}
    </span>
  );
}
