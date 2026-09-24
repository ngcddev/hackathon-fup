import type { AlertType } from '@/lib/types/api';

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  stockout: 'Desabastecimiento',
  occupancy: 'Ocupación',
  emergency_wait: 'Tiempo de espera',
  surgery_compliance: 'Quirófanos',
};

// Pantalla donde se ve el detalle de cada tipo de alerta.
export const ALERT_ROUTE: Record<AlertType, { href: string; label: string }> = {
  stockout: { href: '/drugs', label: 'Medicamentos' },
  occupancy: { href: '/beds', label: 'Camas' },
  emergency_wait: { href: '/patients', label: 'Pacientes e ingresos' },
  surgery_compliance: { href: '/surgeries', label: 'Cirugías' },
};

// Meta de cumplimiento quirúrgico del hospital (S-11).
export const SURGERY_GOAL_PCT = 80;
