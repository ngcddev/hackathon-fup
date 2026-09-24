// Formato de números, fechas y nombres para la interfaz (es-CO).

const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

export const fmtInt = (n: number) => nf0.format(n);
export const fmtNum = (n: number) => nf1.format(n);
export const fmtPct = (n: number) => `${nf1.format(n)} %`;

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Las fechas del HIS vienen sin zona: se leen como texto para no correrlas por la zona del navegador.
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDayMonth(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

export function fmtTime(iso: string): string {
  return iso.slice(11, 16);
}

export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}

export function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${d} de ${MONTHS[m - 1]} de ${y}`;
}

export function fmtMonthShort(isoMonth: string): string {
  return MONTH_SHORT[Number(isoMonth.slice(5, 7)) - 1] ?? isoMonth;
}

// La API entrega los servicios en mayúsculas y sin tildes; se muestran en formato de título.
const ACCENTED: Record<string, string> = {
  PEDIATRIA: 'Pediatría',
  PEDIATRICO: 'Pediátrico',
  PEDIATRICA: 'Pediátrica',
  HOSPITALIZACION: 'Hospitalización',
  CIRUGIA: 'Cirugía',
  GINECOLOGIA: 'Ginecología',
  ANESTESIOLOGIA: 'Anestesiología',
  NEUROLOGIA: 'Neurología',
  CARDIOLOGIA: 'Cardiología',
  UROLOGIA: 'Urología',
  OBSERVACION: 'Observación',
  ATENCION: 'Atención',
  UNIDAD: 'Unidad',
  ORTOPEDIA: 'Ortopedia',
  RADIOLOGIA: 'Radiología',
  PSICOLOGIA: 'Psicología',
  NUTRICION: 'Nutrición',
  REANIMACION: 'Reanimación',
  QUIROFANO: 'Quirófano',
  QUIROFANOS: 'Quirófanos',
};
const LOWER = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'E', 'EN', 'A']);

export function prettyName(name: string): string {
  return name
    .split(' ')
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (i > 0 && LOWER.has(upper)) return word.toLowerCase();
      if (ACCENTED[upper]) return ACCENTED[upper];
      if (upper.length > 4 && upper.endsWith('CION'))
        return `${word.charAt(0).toUpperCase()}${word.slice(1, -4).toLowerCase()}ción`;
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(' ');
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// Descarga un CSV con BOM para que Excel respete las tildes.
export function downloadCsv(fileName: string, rows: Array<Array<string | number | null | undefined>>): void {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
