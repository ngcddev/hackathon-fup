import { queryAsAppBackend } from '@/lib/db';
import { suggestedOrderQuantity } from '@/lib/alerts/stockout';
import { INVENTORY_THRESHOLDS } from '@/lib/alerts/thresholds';
import type { CriticalDrug, CriticalDrugsCard } from '@/lib/types/api';

// Medicamentos críticos (DAS-03): foto más reciente de agent.v_drug_inventory, solo
// item_type = 'medicamento'. Se leen los de menos de 10 días: la tarjeta usa los de menos
// de 5 y ALE-01 usa todos, así que una sola consulta sirve a ambos.

// `run` permite a scripts/insights-check.ts leer dentro de una transacción de prueba.
export type QueryRunner = <T>(sql: string, params: unknown[]) => Promise<T[]>;

export async function getDrugRiskRows(run: QueryRunner = queryAsAppBackend): Promise<CriticalDrug[]> {
  const rows = await run<CriticalDrug>(
    // D2: quiebre estimado = reference_date + días de inventario redondeados hacia abajo.
    `SELECT item_code, item_name, current_stock, avg_daily_consumption,
            days_of_inventory, stock_date, is_simulated,
            agent.reference_date() + FLOOR(days_of_inventory)::int AS estimated_stockout_date
       FROM agent.v_drug_inventory
      WHERE item_type = 'medicamento'
        AND days_of_inventory < $1
      ORDER BY days_of_inventory ASC, item_name ASC`,
    [INVENTORY_THRESHOLDS.warning_days],
  );
  return rows.map((row) => ({
    ...row,
    suggested_order_quantity: suggestedOrderQuantity(row, INVENTORY_THRESHOLDS.restock_target_days),
  }));
}

export function buildCriticalDrugsCard(rows: CriticalDrug[]): CriticalDrugsCard {
  const items = rows.filter((r) => r.days_of_inventory < INVENTORY_THRESHOLDS.critical_days);
  return {
    scope: 'hospital',
    threshold_days: INVENTORY_THRESHOLDS.critical_days,
    target_days: INVENTORY_THRESHOLDS.restock_target_days,
    count: items.length,
    includes_simulated_data: items.some((i) => i.is_simulated),
    items,
  };
}

export async function getCriticalDrugsCard(): Promise<CriticalDrugsCard> {
  return buildCriticalDrugsCard(await getDrugRiskRows());
}
