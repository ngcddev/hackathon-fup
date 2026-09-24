import { queryAsAppBackend } from '@/lib/db';
import type { SurgeriesByMonth, SurgeriesCard } from '@/lib/types/api';

// Quirófanos (DAS-04): agent.v_surgeries, todos los meses disponibles, por mes del ingreso
// (S-11). El universo N (programaciones con ingreso en el extracto) se devuelve siempre.

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((1000 * part) / total) / 10 : 0;
}

export async function getSurgeriesCard(): Promise<SurgeriesCard> {
  const rows = await queryAsAppBackend<{ month: string; scheduled: number; performed: number }>(
    `SELECT to_char(scheduled_month, 'YYYY-MM') AS month,
            COUNT(*)::int AS scheduled,
            (COUNT(*) FILTER (WHERE is_performed))::int AS performed
       FROM agent.v_surgeries
      WHERE scheduled_month IS NOT NULL
      GROUP BY 1
      ORDER BY 1`,
  );
  const by_month: SurgeriesByMonth[] = rows.map((r) => ({
    month: r.month,
    scheduled: r.scheduled,
    performed: r.performed,
    compliance_pct: pct(r.performed, r.scheduled),
  }));
  const universe_total = rows.reduce((sum, r) => sum + r.scheduled, 0);
  const performed_total = rows.reduce((sum, r) => sum + r.performed, 0);
  return {
    scope: 'hospital',
    universe_total,
    performed_total,
    compliance_pct: pct(performed_total, universe_total),
    by_month,
  };
}
