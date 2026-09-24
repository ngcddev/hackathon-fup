import { queryAsAppBackend } from '@/lib/db';
import type { IsoDate, OccupancyTrendCard, OccupancyTrendPoint } from '@/lib/types/api';
import { pct } from './occupancy';

// Ocupación diaria (DAS-08): los 30 días que terminan en reference_date, por día
// suma de camas ocupadas ÷ suma de capacidad. Respeta el filtro de servicio.
// Los días sin filas de ocupación (huecos del histórico) se omiten.

export async function getOccupancyTrendCard(service: string | null): Promise<OccupancyTrendCard> {
  const rows = await queryAsAppBackend<{
    day: IsoDate;
    occupied_beds: number;
    capacity: number;
  }>(
    `SELECT o.day,
            SUM(o.occupied_beds)::int AS occupied_beds,
            SUM(o.capacity)::int AS capacity
       FROM agent.v_bed_occupancy o
      WHERE o.day >= (SELECT agent.reference_date()) - 29
        AND o.day <= (SELECT agent.reference_date())
        AND ($1::text IS NULL OR o.service = $1::text)
      GROUP BY o.day
      ORDER BY o.day`,
    [service],
  );
  const days: OccupancyTrendPoint[] = rows.map((r) => ({
    day: r.day,
    occupied_beds: r.occupied_beds,
    capacity: r.capacity,
    occupancy_pct: pct(r.occupied_beds, r.capacity),
  }));
  return { scope: 'service', days };
}
