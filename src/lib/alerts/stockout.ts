import type { CriticalDrug } from '@/lib/types/api';
import { fmtNumber } from './format';
import { INVENTORY_THRESHOLDS } from './thresholds';
import type { RankedAlert } from './occupancy';

// ALE-01: una alerta crítica por medicamento con menos de 5 días; los de 5 a 10 días van
// en una sola advertencia agrupada (el contrato no tiene campo de detalle: la lista va en message).
export function buildStockoutAlerts(rows: CriticalDrug[]): RankedAlert[] {
  const { critical_days, warning_days, restock_target_days } = INVENTORY_THRESHOLDS;
  const critical = rows.filter((r) => r.days_of_inventory < critical_days);
  const warning = rows.filter((r) => r.days_of_inventory >= critical_days);

  const result: RankedAlert[] = critical.map((drug) => {
    const suggested = Math.ceil(drug.avg_daily_consumption * restock_target_days - drug.current_stock);
    return {
      gravity: drug.days_of_inventory,
      alert: {
        id: `stockout:${drug.item_code}`,
        type: 'stockout',
        severity: 'critical',
        title: `Riesgo de desabastecimiento: ${drug.item_name}`,
        message:
          `Quedan ${fmtNumber(drug.days_of_inventory)} días de inventario ` +
          `(stock ${fmtNumber(drug.current_stock, 0)}, consumo ${fmtNumber(drug.avg_daily_consumption, 2)} por día). ` +
          'Inventario simulado.',
        recommendation: `Pedir ${fmtNumber(Math.max(suggested, 0), 0)} unidades para cubrir ${restock_target_days} días de consumo.`,
        is_simulated: drug.is_simulated,
      },
    };
  });

  if (warning.length > 0) {
    const list = warning.map((d) => `${d.item_name} (${fmtNumber(d.days_of_inventory)} días)`).join('; ');
    result.push({
      gravity: warning[0].days_of_inventory,
      alert: {
        id: 'stockout:warning-group',
        type: 'stockout',
        severity: 'warning',
        title: `${warning.length} medicamentos con inventario bajo`,
        message:
          `${warning.length} medicamentos tienen entre ${critical_days} y ${warning_days} días de inventario: ${list}. ` +
          'Inventario simulado.',
        recommendation: 'Programar la reposición de estos medicamentos esta semana.',
        is_simulated: warning.some((d) => d.is_simulated),
      },
    });
  }
  return result;
}
