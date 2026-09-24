import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function LoadingState({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sgh-pulse h-[132px] rounded-2xl bg-mist" />
        ))}
      </div>
      <div className="sgh-pulse h-[260px] rounded-2xl bg-mist" />
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="sgh-pulse h-11 rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="text-[15px] text-muted">Cargando {label}…</div>
    </div>
  );
}

export function ErrorState({ label, message, onRetry }: { label: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3.5 rounded-2xl border border-line bg-white px-6 py-16 text-center">
      <Icon name="info" size={40} strokeWidth={1.5} className="text-navy" />
      <div className="text-[22px] font-bold">No pudimos cargar {label}</div>
      <div className="max-w-[520px] text-base leading-normal text-muted">
        {message ?? 'Revise su conexión e intente de nuevo. Si el problema continúa, avise al área de Sistemas.'}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-[46px] cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-[22px] text-[15px] font-bold"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <Icon name="fuentes" size={40} strokeWidth={1.5} className="text-muted" />
      <div className="text-[22px] font-bold">{title}</div>
      {children && <div className="max-w-[520px] text-base leading-normal text-muted">{children}</div>}
    </div>
  );
}

// Aviso discreto para secciones que aún no tienen datos en el servidor.
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-[15px] leading-normal text-slate-700">
      <Icon name="shield" className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
