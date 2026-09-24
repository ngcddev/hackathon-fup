import { queryAsAppBackend } from '@/lib/db';
import type { AdmissionsByService, DemandCard, ServicesBySpecialty } from '@/lib/types/api';

// Demanda (DAS-05): este mes, del primer día del mes de reference_date a reference_date.
// - Ingresos por servicio: agent.v_admissions, pacientes hospitalarios distintos (S-05).
//   Respeta el filtro de servicio.
// - Servicios por especialidad: agent.v_service_demand_daily. No respeta el filtro.
// Son consultas en paralelo (la de especialidades escanea service_lines y es la más lenta).
// Los filtros usan (SELECT agent.reference_date()) para evaluar la función una vez y no por fila.

export async function getDemandCard(service: string | null): Promise<DemandCard> {
  const [period, admissions, specialties] = await Promise.all([
    queryAsAppBackend<{ period_start: string; period_end: string }>(
      `SELECT date_trunc('month', agent.reference_date())::date AS period_start,
              agent.reference_date() AS period_end`,
    ),
    queryAsAppBackend<AdmissionsByService>(
      `SELECT coalesce(a.service, 'SIN SERVICIO') AS service,
              COUNT(DISTINCT a.patient_key)::int AS admissions_count
         FROM agent.v_admissions a
        WHERE a.admission_class = 'Hospitalario'
          AND a.admitted_at >= date_trunc('month', (SELECT agent.reference_date()))
          AND a.admitted_at <  (SELECT agent.reference_date()) + 1
          AND ($1::text IS NULL OR a.service = $1::text)
        GROUP BY a.service
        ORDER BY admissions_count DESC, service ASC`,
      [service],
    ),
    queryAsAppBackend<ServicesBySpecialty>(
      `SELECT coalesce(d.specialty, 'SIN ESPECIALIDAD') AS specialty,
              SUM(d.lines_count)::int AS lines_count
         FROM agent.v_service_demand_daily d
        WHERE d.day >= date_trunc('month', (SELECT agent.reference_date()))::date
          AND d.day <= (SELECT agent.reference_date())
        GROUP BY d.specialty
        ORDER BY lines_count DESC, specialty ASC`,
    ),
  ]);
  return {
    scope: 'service',
    period_start: period[0]?.period_start ?? '',
    period_end: period[0]?.period_end ?? '',
    admissions_by_service: admissions,
    services_by_specialty: specialties,
  };
}
