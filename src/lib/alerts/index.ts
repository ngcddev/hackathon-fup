import type { CriticalDrug, EmergencyWaitCard, KpiAlert } from '@/lib/types/api';
import type { OccupancyRow } from '@/lib/queries/kpis/occupancy';
import type { EmergencyWaitShiftRow } from '@/lib/queries/kpis/emergency-wait';
import { buildEmergencyWaitAlerts } from './emergency-wait';
import { buildOccupancyAlerts, type RankedAlert } from './occupancy';
import { buildStockoutAlerts } from './stockout';

// ALE-03: críticas antes que advertencias y, dentro de cada severidad, por gravedad.
// Ocupación primero (mayor % primero) y luego inventario (menos días primero), para que
// las advertencias de inventario no entierren las de ocupación. Siempre de todo el hospital.
const TYPE_ORDER: Record<KpiAlert['type'], number> = {
  occupancy: 0,
  stockout: 1,
  emergency_wait: 2,
  surgery_compliance: 3,
};

function compare(a: RankedAlert, b: RankedAlert): number {
  if (a.alert.severity !== b.alert.severity) return a.alert.severity === 'critical' ? -1 : 1;
  if (a.alert.type !== b.alert.type) return TYPE_ORDER[a.alert.type] - TYPE_ORDER[b.alert.type];
  // Ocupación: mayor primero. Inventario: menos días primero.
  return a.alert.type === 'occupancy' ? b.gravity - a.gravity : a.gravity - b.gravity;
}

export function buildAlerts(
  occupancyRows: OccupancyRow[],
  drugRiskRows: CriticalDrug[],
  waitCard: EmergencyWaitCard,
  waitByShift: EmergencyWaitShiftRow[],
): KpiAlert[] {
  return [
    ...buildOccupancyAlerts(occupancyRows),
    ...buildStockoutAlerts(drugRiskRows),
    ...buildEmergencyWaitAlerts(waitCard, waitByShift),
  ]
    .sort(compare)
    .map((ranked) => ranked.alert);
}
