// Etiquetas compartidas por los insights (D6, D7).

// ISO: 1 lunes a 7 domingo (igual que weekday en agent.v_emergency_wait_times).
export const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? String(weekday);
}

// Turno según la hora de llegada, igual que agent.v_emergency_wait_times: día 7:00 a 18:59.
export type ShiftKey = 'dia' | 'noche';
export const SHIFT_LABEL: Record<ShiftKey, string> = { dia: 'día', noche: 'noche' };

export function shiftOfHour(hour: number): ShiftKey {
  return hour >= 7 && hour <= 18 ? 'dia' : 'noche';
}
