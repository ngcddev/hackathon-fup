import type { KpiAlert } from '@/lib/types/api';
import type { OccupancyRow } from '@/lib/queries/kpis/occupancy';
import { pct } from '@/lib/queries/kpis/occupancy';
import { fmtNumber } from './format';
import { NON_INTERCHANGEABLE_SERVICES, OCCUPANCY_THRESHOLDS } from './thresholds';

// ALE-02: por subservicio en reference_date, siempre sobre todo el hospital.
// Devuelve las alertas con su porcentaje para poder ordenarlas (ALE-03).
export interface RankedAlert {
  alert: KpiAlert;
  gravity: number; // ocupación (%) o días de inventario, según el tipo
}

export function buildOccupancyAlerts(rows: OccupancyRow[]): RankedAlert[] {
  const result: RankedAlert[] = [];
  for (const row of rows) {
    if (row.capacity <= 0) continue;
    const occupancy = pct(row.occupied_beds, row.capacity);
    const severity =
      occupancy >= OCCUPANCY_THRESHOLDS.critical_pct
        ? 'critical'
        : occupancy >= OCCUPANCY_THRESHOLDS.warning_pct
          ? 'warning'
          : null;
    if (severity === null) continue;

    let recommendation = 'Abrir camas adicionales o reasignar personal a este subservicio.';
    if (!NON_INTERCHANGEABLE_SERVICES.includes(row.service)) {
      const target = rows
        .filter(
          (o) =>
            o.service === row.service &&
            o.subservice !== row.subservice &&
            o.capacity > 0 &&
            o.occupied_beds < o.capacity &&
            pct(o.occupied_beds, o.capacity) < OCCUPANCY_THRESHOLDS.warning_pct,
        )
        .sort((a, b) => pct(a.occupied_beds, a.capacity) - pct(b.occupied_beds, b.capacity))[0];
      if (target) {
        recommendation =
          `Evaluar trasladar pacientes a ${target.subservice} ` +
          `(${fmtNumber(pct(target.occupied_beds, target.capacity))} % de ocupación, ` +
          `${target.capacity - target.occupied_beds} camas libres).`;
      }
    }

    result.push({
      gravity: occupancy,
      alert: {
        id: `occupancy:${row.service}:${row.subservice}`,
        type: 'occupancy',
        severity,
        title: `${severity === 'critical' ? 'Ocupación crítica' : 'Ocupación alta'}: ${row.subservice}`,
        message:
          `${row.subservice} está al ${fmtNumber(occupancy)} % de ocupación ` +
          `(${row.occupied_beds} de ${row.capacity} camas).`,
        recommendation,
        is_simulated: row.is_capacity_simulated,
      },
    });
  }
  return result;
}
