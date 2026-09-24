import { queryAsAppBackend } from '@/lib/db';
import type { AvgStayCard } from '@/lib/types/api';

// Estancia promedio (DAS-09): en días, por servicio, de los ingresos con cama asignada
// (hospitalized_at) en los 30 días que terminan en reference_date. El egreso es el estimado
// de S-07 (estimated_discharge_at). El levante no fija el periodo: 30 días, como DAS-08.
// Respeta el filtro de servicio.

export async function getAvgStayCard(service: string | null): Promise<AvgStayCard> {
  const rows = await queryAsAppBackend<{
    service: string;
    avg_stay_days: number;
    admissions_count: number;
  }>(
    `SELECT a.service,
            ROUND(AVG(EXTRACT(EPOCH FROM (a.estimated_discharge_at - a.hospitalized_at)) / 86400.0)::numeric, 1)::float8 AS avg_stay_days,
            COUNT(*)::int AS admissions_count
       FROM agent.v_admissions a
      WHERE a.hospitalized_at IS NOT NULL
        AND a.service IS NOT NULL
        AND a.estimated_discharge_at IS NOT NULL
        AND a.hospitalized_at >= (SELECT agent.reference_date()) - 29
        AND a.hospitalized_at <  (SELECT agent.reference_date()) + 1
        AND ($1::text IS NULL OR a.service = $1::text)
      GROUP BY a.service
      ORDER BY avg_stay_days DESC, a.service ASC`,
    [service],
  );
  return { scope: 'service', by_service: rows };
}
