import { queryAsAppBackend } from '@/lib/db';
import type { DrugRotationCard, DrugRotationItem } from '@/lib/types/api';

// Rotación (DAS-06): últimos 30 días hasta reference_date (reference_date - 29 a reference_date),
// desde agent.v_drug_consumption_daily. Top 10 de mayor y 10 de menor consumo (mayor a 0).
// Una sola consulta con UNION ALL para no gastar conexiones del pool. El filtro de fechas usa
// (SELECT agent.reference_date()) directo (no un JOIN): así Postgres baja el filtro hasta la vista
// y, al ser un InitPlan, evalúa la función una sola vez y no una vez por fila.

export async function getDrugRotationCard(): Promise<DrugRotationCard> {
  const rows = await queryAsAppBackend<{
    kind: 'period' | 'top' | 'bottom';
    item_code: string | null;
    item_name: string | null;
    item_type: DrugRotationItem['item_type'] | null;
    total_quantity: number;
    period_start: string | null;
    period_end: string | null;
  }>(
    `WITH agg AS (
       SELECT c.item_code, min(c.item_name) AS item_name,
              coalesce(min(c.item_type), 'dispositivo') AS item_type,
              SUM(c.total_quantity)::int AS total_quantity
         FROM agent.v_drug_consumption_daily c
        WHERE c.day >= (SELECT agent.reference_date()) - 29 AND c.day <= (SELECT agent.reference_date())
        GROUP BY c.item_code
       HAVING SUM(c.total_quantity) > 0
     )
     SELECT 'period' AS kind, NULL AS item_code, NULL AS item_name, NULL AS item_type,
            0 AS total_quantity, (agent.reference_date() - 29)::text AS period_start,
            agent.reference_date()::text AS period_end
     UNION ALL
     (SELECT 'top', item_code, item_name, item_type, total_quantity, NULL, NULL
        FROM agg ORDER BY total_quantity DESC, item_code LIMIT 10)
     UNION ALL
     (SELECT 'bottom', item_code, item_name, item_type, total_quantity, NULL, NULL
        FROM agg ORDER BY total_quantity ASC, item_code LIMIT 10)`,
  );
  const toItem = (r: (typeof rows)[number]): DrugRotationItem => ({
    item_code: r.item_code ?? '',
    item_name: r.item_name ?? '',
    item_type: r.item_type ?? 'dispositivo',
    total_quantity: r.total_quantity,
  });
  const period = rows.find((r) => r.kind === 'period');
  return {
    scope: 'hospital',
    period_start: period?.period_start ?? '',
    period_end: period?.period_end ?? '',
    top: rows.filter((r) => r.kind === 'top').map(toItem),
    bottom: rows.filter((r) => r.kind === 'bottom').map(toItem),
  };
}
