// Umbrales de las alertas y del dashboard en un solo lugar (ALE-06).

export const OCCUPANCY_THRESHOLDS = {
  warning_pct: 85,
  critical_pct: 95,
} as const;

export const INVENTORY_THRESHOLDS = {
  critical_days: 5, // menos de 5 días: alerta crítica
  warning_days: 10, // menos de 10 días: advertencia (agrupada)
  restock_target_days: 15, // días de consumo que debe cubrir el pedido sugerido
} as const;

// ALE-04: espera promedio de la última semana por nivel de triage, en minutos.
// Triage 1 y 2: Resolución 5596 de 2015. La resolución no fija tiempo para triage 3 y 4.
export const EMERGENCY_WAIT_THRESHOLDS_MIN: Readonly<Record<1 | 2 | 3 | 4, number>> = {
  1: 10,
  2: 30,
  3: 120, // SUPUESTO: validar con el equipo
  4: 240, // SUPUESTO: validar con el equipo
};

// Servicios cuyos subservicios atienden poblaciones distintas: nunca se recomienda
// trasladar pacientes entre ellos (solo abrir camas o reasignar personal).
export const NON_INTERCHANGEABLE_SERVICES: readonly string[] = ['UNIDAD DE CUIDADO INTENSIVO'];
