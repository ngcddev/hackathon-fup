import { queryAsAppBackend } from '@/lib/db';
import type {
  IsoDate,
  OccupancyByService,
  OccupancyBySubservice,
  OccupancyCard,
  OccupancyFigures,
} from '@/lib/types/api';

// Ocupación (DAS-01): el día agent.reference_date(), leída de agent.v_bed_occupancy.
// La misma lectura sirve a la tarjeta (con filtro) y a ALE-02 (siempre todo el hospital).

export interface OccupancyRow {
  service: string;
  subservice: string;
  occupied_beds: number;
  capacity: number;
  is_capacity_simulated: boolean;
}

export interface OccupancySnapshot {
  day: IsoDate;
  rows: OccupancyRow[];
}

export function pct(occupied: number, capacity: number): number {
  return capacity > 0 ? Math.round((1000 * occupied) / capacity) / 10 : 0;
}

export async function getOccupancySnapshot(): Promise<OccupancySnapshot> {
  const rows = await queryAsAppBackend<{
    day: IsoDate;
    service: string | null;
    subservice: string | null;
    occupied_beds: number | null;
    capacity: number | null;
    is_capacity_simulated: boolean | null;
  }>(
    `SELECT r.day, o.service, coalesce(o.subservice, o.service) AS subservice,
            o.occupied_beds::int AS occupied_beds, o.capacity::int AS capacity,
            o.is_capacity_simulated
       FROM (SELECT agent.reference_date() AS day) r
       LEFT JOIN agent.v_bed_occupancy o ON o.day = r.day
      ORDER BY o.service, o.subservice`,
  );
  const day = rows[0]?.day ?? '';
  return {
    day,
    rows: rows.flatMap((r) =>
      r.service === null
        ? []
        : [
            {
              service: r.service,
              subservice: r.subservice ?? r.service,
              occupied_beds: r.occupied_beds ?? 0,
              capacity: r.capacity ?? 0,
              is_capacity_simulated: r.is_capacity_simulated ?? true,
            },
          ],
    ),
  };
}

function figures(rows: OccupancyRow[]): OccupancyFigures {
  const occupied_beds = rows.reduce((sum, r) => sum + r.occupied_beds, 0);
  const capacity = rows.reduce((sum, r) => sum + r.capacity, 0);
  return { occupied_beds, capacity, occupancy_pct: pct(occupied_beds, capacity) };
}

// `service` null: todo el hospital. Con servicio, el total y los detalles son solo de ese servicio.
export function buildOccupancyCard(snapshot: OccupancySnapshot, service: string | null): OccupancyCard {
  const rows = service === null ? snapshot.rows : snapshot.rows.filter((r) => r.service === service);

  const byServiceMap = new Map<string, OccupancyRow[]>();
  for (const row of rows) {
    const list = byServiceMap.get(row.service) ?? [];
    list.push(row);
    byServiceMap.set(row.service, list);
  }
  const by_service: OccupancyByService[] = [...byServiceMap].map(([name, list]) => ({
    service: name,
    ...figures(list),
  }));
  const by_subservice: OccupancyBySubservice[] = rows.map((r) => ({
    service: r.service,
    subservice: r.subservice,
    occupied_beds: r.occupied_beds,
    capacity: r.capacity,
    occupancy_pct: pct(r.occupied_beds, r.capacity),
    is_capacity_simulated: r.is_capacity_simulated,
  }));

  return { scope: 'service', day: snapshot.day, total: figures(rows), by_service, by_subservice };
}

export async function getOccupancyCard(service: string | null): Promise<OccupancyCard> {
  return buildOccupancyCard(await getOccupancySnapshot(), service);
}

// Servicios válidos para el filtro (DAS-10).
export async function listServices(): Promise<string[]> {
  const rows = await queryAsAppBackend<{ service: string }>(
    'SELECT DISTINCT service FROM agent.v_bed_occupancy WHERE service IS NOT NULL ORDER BY service',
  );
  return rows.map((r) => r.service);
}
