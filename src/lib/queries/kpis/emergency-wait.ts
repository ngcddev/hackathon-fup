import { queryAsAppBackend } from '@/lib/db';
import type { EmergencyWaitByTriage, EmergencyWaitCard, IsoDate } from '@/lib/types/api';

// Espera en urgencias (DAS-02): última semana, de reference_date - 6 a reference_date
// inclusive, por admitted_at (igual que la pregunta 3 de la demo).

export async function getEmergencyWaitCard(): Promise<EmergencyWaitCard> {
  const rows = await queryAsAppBackend<{
    period_start: IsoDate;
    period_end: IsoDate;
    triage_level: number | null;
    is_total: boolean;
    admissions_count: number;
    avg_wait_minutes: number | null;
  }>(
    `SELECT agent.reference_date() - 6 AS period_start,
            agent.reference_date() AS period_end,
            triage_level,
            GROUPING(triage_level) = 1 AS is_total,
            COUNT(*)::int AS admissions_count,
            ROUND(AVG(wait_minutes), 1) AS avg_wait_minutes
       FROM agent.v_emergency_wait_times
      WHERE admitted_at >= agent.reference_date() - 6
        AND admitted_at <  agent.reference_date() + 1
      GROUP BY GROUPING SETS ((triage_level), ())`,
  );
  const total = rows.find((r) => r.is_total);
  const by_triage_level: EmergencyWaitByTriage[] = rows
    .filter((r) => !r.is_total)
    .sort((a, b) => (a.triage_level ?? 99) - (b.triage_level ?? 99))
    .map((r) => ({
      triage_level: r.triage_level,
      avg_wait_minutes: r.avg_wait_minutes ?? 0,
      admissions_count: r.admissions_count,
    }));
  return {
    scope: 'hospital',
    period_start: total?.period_start ?? '',
    period_end: total?.period_end ?? '',
    avg_wait_minutes: total?.avg_wait_minutes ?? 0,
    admissions_count: total?.admissions_count ?? 0,
    by_triage_level,
  };
}
