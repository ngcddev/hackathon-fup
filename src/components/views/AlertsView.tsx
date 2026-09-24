'use client';

import Link from 'next/link';
import { useState } from 'react';
import { KpiGate } from '@/components/app/KpiGate';
import { OriginBadge, SeverityBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/States';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/components/ui/format';
import type { AlertType } from '@/lib/types/api';
import { SuggestButton, SuggestionPanel, useAlertSuggestions } from './AlertSuggestion';
import { ALERT_ROUTE, ALERT_TYPE_LABEL } from './alerts-meta';

type Filter = 'all' | AlertType;
const FILTERS: Filter[] = ['all', 'stockout', 'occupancy', 'emergency_wait', 'surgery_compliance'];
// Alertas visibles antes del desplegable; el resto se muestra al expandirlo.
const VISIBLE_ALERTS = 2;

export function AlertsView() {
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState(false);
  const suggestions = useAlertSuggestions();

  return (
    <KpiGate label="las alertas">
      {(data) => {
        // Las alertas son siempre de todo el hospital, sin importar el filtro de servicio (DAS-10).
        const list = data.alerts.filter((a) => filter === 'all' || a.type === filter);
        const critical = list.filter((a) => a.severity === 'critical').length;
        const warnings = list.length - critical;
        const hidden = list.length - VISIBLE_ALERTS;
        return (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2.5">
              {FILTERS.map((f) => {
                const on = filter === f;
                const n = f === 'all' ? data.alerts.length : data.alerts.filter((a) => a.type === f).length;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setFilter(f);
                      setExpanded(false);
                    }}
                    className={cn(
                      'h-11 cursor-pointer rounded-full border-[1.5px] px-[18px] text-[15px] font-bold',
                      on ? 'border-navy bg-navy text-white' : 'border-slate-300 bg-white text-navy',
                    )}
                  >
                    {f === 'all' ? 'Todas' : ALERT_TYPE_LABEL[f]} ({n})
                  </button>
                );
              })}
              <span className="ml-auto flex gap-4 text-[15px] font-bold">
                <span className="flex items-center gap-1.5 text-danger">
                  <Icon name="alerts" size={16} strokeWidth={2.2} />
                  {critical} críticas
                </span>
                <span className="flex items-center gap-1.5 text-warn">
                  <Icon name="warning" size={16} strokeWidth={2.2} />
                  {warnings} advertencias
                </span>
              </span>
            </div>

            {list.length === 0 ? (
              <EmptyState title="No hay alertas activas">
                Los indicadores están dentro de los umbrales definidos.
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-3">
                {list.slice(0, expanded ? list.length : VISIBLE_ALERTS).map((a) => {
                  const route = ALERT_ROUTE[a.type];
                  const suggestion = suggestions.get(a.id);
                  return (
                    <article
                      key={a.id}
                      className={cn(
                        'grid grid-cols-1 items-center gap-4 rounded-xl border bg-white px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6 sm:py-5',
                        a.severity === 'critical' ? 'border-danger-line' : 'border-warn-line',
                      )}
                    >
                      <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <SeverityBadge severity={a.severity} />
                          <span className="text-[15px] font-semibold text-muted">{ALERT_TYPE_LABEL[a.type]}</span>
                          {a.is_simulated && <OriginBadge origin="Simulado" />}
                        </div>
                        <h3 className="m-0 text-xl font-bold">{a.title}</h3>
                        <div
                          className={cn(
                            'font-extrabold tracking-tight',
                            a.message.length > 70 ? 'text-lg' : 'text-[22px] sm:text-[26px]',
                          )}
                        >
                          {a.message}
                        </div>
                        <div className="text-base text-slate-700">
                          <strong>Acción recomendada:</strong> {a.recommendation}
                        </div>
                        <SuggestButton alertId={a.id} state={suggestion} onClick={() => suggestions.toggle(a.id)} />
                      </div>
                      <Link href={route.href} className="whitespace-nowrap text-[15px] font-bold">
                        Ver en {route.label} →
                      </Link>
                      {suggestion?.open && (
                        <SuggestionPanel alert={a} state={suggestion} onRetry={() => void suggestions.retry(a.id)} />
                      )}
                    </article>
                  );
                })}
                {hidden > 0 && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((v) => !v)}
                    className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-slate-300 bg-white text-[15px] font-bold text-navy"
                  >
                    {expanded ? 'Ocultar alertas' : hidden === 1 ? 'Ver 1 alerta más' : `Ver ${hidden} alertas más`}
                    <span aria-hidden className={cn('inline-block transition-transform', expanded && 'rotate-180')}>
                      ▾
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        );
      }}
    </KpiGate>
  );
}
