import type { EmergencyWaitCard } from '@/lib/types/api';
import type { EmergencyWaitShiftRow } from '@/lib/queries/kpis/emergency-wait';
import { fmtNumber } from './format';
import { EMERGENCY_WAIT_THRESHOLDS_MIN } from './thresholds';
import type { RankedAlert } from './occupancy';

const SHIFT_LABEL = { dia: 'día', noche: 'noche' } as const;

// ALE-04: por nivel de triage, sobre la misma semana de DAS-02, siempre de todo el hospital.
// Críticas en triage 1 y 2 (Resolución 5596 de 2015); advertencia en 3 y 4 (umbrales supuestos).
// La recomendación nombra el turno con mayor espera en ese nivel.
export function buildEmergencyWaitAlerts(card: EmergencyWaitCard, byShift: EmergencyWaitShiftRow[]): RankedAlert[] {
  const result: RankedAlert[] = [];
  for (const level of card.by_triage_level) {
    const triage = level.triage_level;
    if (triage === null || !(triage in EMERGENCY_WAIT_THRESHOLDS_MIN)) continue;
    const threshold = EMERGENCY_WAIT_THRESHOLDS_MIN[triage as 1 | 2 | 3 | 4];
    if (level.avg_wait_minutes <= threshold) continue;

    const worst = byShift
      .filter((r) => r.triage_level === triage && r.admissions_count > 0)
      .sort((a, b) => b.avg_wait_minutes - a.avg_wait_minutes)[0];
    const recommendation = worst
      ? `Reforzar la atención de triage ${triage} en el turno ${SHIFT_LABEL[worst.shift]}.`
      : `Reforzar la atención de triage ${triage}.`;

    result.push({
      // El contrato ordena por gravedad ascendente fuera de ocupación: exceso mayor primero.
      gravity: -(level.avg_wait_minutes / threshold),
      alert: {
        id: `emergency_wait:triage-${triage}`,
        type: 'emergency_wait',
        severity: triage <= 2 ? 'critical' : 'warning',
        title: `Espera alta en urgencias: triage ${triage}`,
        message:
          `En la última semana la espera promedio en triage ${triage} fue de ${fmtNumber(level.avg_wait_minutes)} min ` +
          `(umbral ${threshold} min; ${level.admissions_count} ingresos).` +
          (worst
            ? ` El turno ${SHIFT_LABEL[worst.shift]} tuvo la mayor espera: ${fmtNumber(worst.avg_wait_minutes)} min.`
            : ''),
        recommendation,
        is_simulated: false,
      },
    });
  }
  return result;
}
