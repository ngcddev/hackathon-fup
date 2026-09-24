'use client';

import { KpiGate } from '@/components/app/KpiGate';
import { OriginBadge, SeverityBadge } from '@/components/ui/Badge';
import { Card, MiniBar, Stat } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtDate, fmtInt, fmtNum } from '@/components/ui/format';
import { EmptyState } from '@/components/ui/States';
import { INVENTORY_THRESHOLDS } from '@/lib/alerts/thresholds';
import type { CriticalDrug, DrugRotationItem, KpisResponse } from '@/lib/types/api';
import { EntityView } from './EntityView';

const columns: Column<CriticalDrug>[] = [
  { key: 'code', label: 'Código', mono: true, value: (d) => d.item_code },
  { key: 'name', label: 'Nombre', bold: true, value: (d) => d.item_name },
  { key: 'stock', label: 'Stock actual', align: 'right', value: (d) => d.current_stock, render: (d) => fmtInt(d.current_stock) },
  { key: 'use', label: 'Consumo diario', align: 'right', value: (d) => d.avg_daily_consumption, render: (d) => fmtNum(d.avg_daily_consumption) },
  {
    key: 'days',
    label: 'Días de inventario',
    align: 'right',
    value: (d) => d.days_of_inventory,
    render: (d) => (
      <span className="inline-flex flex-col items-end gap-1">
        <SeverityBadge severity="critical" small />
        <span className="font-bold">{fmtNum(d.days_of_inventory)} días</span>
        {d.suggested_order_quantity !== undefined && d.suggested_order_quantity > 0 && (
          <span className="text-sm font-bold text-danger">Pedir {fmtInt(d.suggested_order_quantity)} unidades</span>
        )}
      </span>
    ),
  },
  {
    key: 'out',
    label: 'Agotamiento estimado',
    value: (d) => d.estimated_stockout_date ?? null,
    render: (d) => (d.estimated_stockout_date ? fmtDate(d.estimated_stockout_date) : '—'),
  },
  { key: 'date', label: 'Fecha foto', value: (d) => d.stock_date, render: (d) => fmtDate(d.stock_date) },
  {
    key: 'origin',
    label: 'Origen',
    value: (d) => (d.is_simulated ? 'Simulado' : 'Importado'),
    render: (d) => (d.is_simulated ? <OriginBadge origin="Simulado" /> : <span className="text-muted">Importado</span>),
  },
];

function Rotation({ title, items }: { title: string; items: DrugRotationItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.total_quantity));
  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[21px] font-bold">{title}</h3>
        <span className="text-sm text-muted">unidades dispensadas</span>
      </div>
      {items.map((item, i) => (
        <div key={item.item_code} className="grid grid-cols-[24px_minmax(0,1.6fr)_minmax(0,1fr)_72px] items-center gap-3">
          <span className="text-sm font-bold text-muted">{i + 1}</span>
          <span className="truncate text-[15px] font-semibold" title={item.item_name}>
            {item.item_name}
          </span>
          <MiniBar pct={(item.total_quantity / max) * 100} />
          <span className="text-right text-[15px] font-extrabold">{fmtInt(item.total_quantity)}</span>
        </div>
      ))}
    </Card>
  );
}

function Estado({ data }: { data: KpisResponse }) {
  const drugs = data.critical_drugs;
  const rotation = data.drug_rotation;
  const photo = drugs.items[0]?.stock_date;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
        <Stat
          label={`Stock crítico (< ${drugs.threshold_days} días)`}
          value={fmtInt(drugs.count)}
          sub="medicamentos"
          tone="danger"
          origin={drugs.includes_simulated_data ? 'Simulado' : undefined}
        />
        <Stat
          label="Última foto de inventario"
          value={<span className="text-4xl">{photo ? fmtDate(photo) : '—'}</span>}
          sub={`Pedido sugerido para cubrir ${drugs.target_days ?? INVENTORY_THRESHOLDS.restock_target_days} días de consumo`}
        />
      </div>

      {drugs.items.length === 0 ? (
        <EmptyState title="No hay medicamentos con stock crítico">Todos tienen más de {drugs.threshold_days} días de inventario.</EmptyState>
      ) : (
        <DataTable
          title={`Medicamentos con menos de ${drugs.threshold_days} días de inventario`}
          columns={columns}
          rows={drugs.items}
          rowKey={(d) => d.item_code}
          searchPlaceholder="Buscar por código o nombre"
          initialSort={{ key: 'days', dir: 1 }}
          unit="referencias"
          pageSize={12}
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] gap-5">
        <Rotation title="Top 10 mayor rotación" items={rotation.top} />
        <Rotation title="Top 10 menor rotación" items={rotation.bottom} />
      </div>
      <div className="text-sm text-muted">
        Rotación del {fmtDate(rotation.period_start)} al {fmtDate(rotation.period_end)}, siempre de todo el hospital.
      </div>
    </div>
  );
}

export function MedicamentosView() {
  return (
    <EntityView target="drug_stock" note="Una foto nueva no reemplaza la anterior; revertir el lote restaura la foto previa.">
      <KpiGate label="medicamentos">{(data) => <Estado data={data} />}</KpiGate>
    </EntityView>
  );
}
