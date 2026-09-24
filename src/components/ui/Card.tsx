import type { ReactNode } from 'react';
import { cn } from './format';
import { OriginBadge, type Origin } from './Badge';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return <section className={cn('rounded-2xl border border-line bg-white shadow-card', className)}>{children}</section>;
}

export function CardTitle({ children, origin }: { children: ReactNode; origin?: Origin }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="m-0 text-[21px] font-bold">{children}</h3>
      {origin && <OriginBadge origin={origin} />}
    </div>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  origin?: Origin;
  tone?: 'default' | 'danger' | 'warn';
  children?: ReactNode;
}

const TONE = {
  default: { border: 'border-line', label: 'text-muted font-semibold', shadow: 'shadow-card' },
  danger: { border: 'border-danger-line', label: 'text-danger font-bold', shadow: '' },
  warn: { border: 'border-warn-line', label: 'text-warn font-bold', shadow: '' },
} as const;

// Tarjeta de cifra: etiqueta, valor grande y texto de apoyo.
export function Stat({ label, value, sub, origin, tone = 'default', children }: StatProps) {
  const t = TONE[tone];
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-2xl border bg-white px-6 py-[22px]', t.border, t.shadow)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-[15px]', t.label)}>{label}</span>
        {origin && <OriginBadge origin={origin} />}
      </div>
      <div className="text-[44px] font-extrabold leading-[1.1] tracking-tight">{value}</div>
      {sub && <span className="text-[15px] text-muted">{sub}</span>}
      {children}
    </div>
  );
}

export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-line', className)}>
      <div className="h-full bg-navy" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

// Barra horizontal fina usada en listados (especialidades, rotación, estancia).
export function MiniBar({ pct, color = 'bg-navy' }: { pct: number; color?: string }) {
  return (
    <div className="h-3 overflow-hidden rounded-full bg-mist">
      <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
