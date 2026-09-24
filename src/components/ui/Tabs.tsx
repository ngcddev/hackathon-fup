import type { ReactNode } from 'react';
import { cn } from './format';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
}

interface TabsProps<K extends string> {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  size?: 'lg' | 'md';
}

export function Tabs<K extends string>({ tabs, active, onChange, size = 'lg' }: TabsProps<K>) {
  return (
    <div role="tablist" className="flex flex-wrap gap-2 border-b border-line">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px flex cursor-pointer items-center gap-2 border-0 border-b-[3px] border-solid bg-transparent',
              size === 'lg' ? 'px-[18px] py-3 text-[17px]' : 'px-4 py-3 text-base',
              on ? 'border-navy font-extrabold text-navy' : 'border-transparent font-semibold text-muted',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function CountBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-danger-line bg-danger-bg px-2 text-[13px] font-extrabold text-danger">
      {n}
    </span>
  );
}
