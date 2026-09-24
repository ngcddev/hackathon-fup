// Conversión tolerante de celdas de texto: réplica en TypeScript de core.clean_text, try_int,
// try_numeric, try_date y try_bool (migración inicial). Devuelven null en vez de fallar.
// El SQL sigue siendo la autoridad final al aplicar; esto adelanta los errores al paso de filas.

export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

export function tryInt(value: string | null | undefined): number | null {
  const text = cleanText(value);
  if (!text || !/^-?\d{1,18}(\.0+)?$/.test(text)) return null;
  return Number(text.split('.')[0]);
}

// Punto o coma decimal; sin separador de miles.
export function tryNumeric(value: string | null | undefined): number | null {
  const text = cleanText(value);
  if (!text || !/^-?\d+([.,]\d+)?$/.test(text)) return null;
  return Number(text.replace(',', '.'));
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const validTime = (h?: string, m?: string, s?: string) =>
  (h === undefined || Number(h) < 24) && (m === undefined || Number(m) < 60) && (s === undefined || Number(s) < 60);

// AAAA-MM-DD[ HH:MI[:SS]], DD/MM/AAAA[ HH:MI[:SS]] o número de serie de Excel. Devuelve AAAA-MM-DD.
export function tryDate(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(text);
  if (m) return validTime(m[4], m[5], m[6]) ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (m) return validTime(m[4], m[5], m[6]) ? isoDate(Number(m[3]), Number(m[2]), Number(m[1])) : null;

  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

const TRUE = new Set(['true', 't', '1', 'si', 'sí', 's', 'yes', 'y', 'activa', 'activo']);
const FALSE = new Set(['false', 'f', '0', 'no', 'n', 'inactiva', 'inactivo']);

export function tryBool(value: string | null | undefined): boolean | null {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return null;
  if (TRUE.has(text)) return true;
  if (FALSE.has(text)) return false;
  return null;
}
