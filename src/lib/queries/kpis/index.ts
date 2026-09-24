import { buildAlerts } from '@/lib/alerts';
import { ApiError } from '@/lib/api/errors';
import type { KpisResponse } from '@/lib/types/api';
import { buildCriticalDrugsCard, getDrugRiskRows } from './critical-drugs';
import { getDemandCard } from './demand';
import { getDrugRotationCard } from './drug-rotation';
import { getEmergencyWaitCard } from './emergency-wait';
import { buildOccupancyCard, getOccupancySnapshot, listServices } from './occupancy';
import { getSurgeriesCard } from './surgeries';

// Orquesta todas las consultas en paralelo. `service` filtra solo las tarjetas con scope
// 'service'; las alertas son siempre de todo el hospital (DAS-10, ALE-03).
export async function getKpis(service: string | null): Promise<KpisResponse> {
  const [snapshot, drugRows, emergency_wait, surgeries, demand, drug_rotation, services] =
    await Promise.all([
      getOccupancySnapshot(),
      getDrugRiskRows(),
      getEmergencyWaitCard(),
      getSurgeriesCard(),
      getDemandCard(service),
      getDrugRotationCard(),
      service === null ? Promise.resolve<string[] | null>(null) : listServices(),
    ]);

  if (services !== null && service !== null && !services.includes(service)) {
    throw new ApiError('VALIDATION_ERROR', 'El servicio indicado no existe.');
  }

  return {
    occupancy: buildOccupancyCard(snapshot, service),
    emergency_wait,
    critical_drugs: buildCriticalDrugsCard(drugRows),
    surgeries,
    demand,
    drug_rotation,
    alerts: buildAlerts(snapshot.rows, drugRows),
    reference_date: snapshot.day,
    generated_at: new Date().toISOString(),
    service_filter: service,
  };
}
