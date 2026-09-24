// Llena el answer_template del LLM con el resultado de la consulta (RNF-03, AGE-06).
// El LLM nunca ve los datos: escribe marcadores con nombres de columnas y el servidor los reemplaza.
//   {columna}       valor de la primera fila
//   {last.columna}  valor de la última fila (útil con GROUPING SETS, donde el total sale al final)
//   {row_count}     número de filas del resultado
// Si algún marcador no existe en el resultado, se responde con un texto genérico.
// Sin imports del servidor: se prueba con vitest.

import { formatNumber } from './text';

const MARKER = /\{((?:last\.)?[a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const MAX_ANSWER_LENGTH = 500;

export function genericAnswer(rowCount: number): string {
  return rowCount === 1
    ? 'Se encontró 1 resultado. Ver el detalle en la tabla.'
    : `Se encontraron ${formatNumber(rowCount, 0)} resultados. Ver el detalle en la tabla.`;
}

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return formatNumber(value, 1);
  if (typeof value === 'bigint') return formatNumber(Number(value), 0);
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  // pg entrega numeric como texto ("65.2"): se formatea igual que un número.
  return /^-?\d+(\.\d+)?$/.test(text) && text.length < 16 ? formatNumber(Number(text), 1) : text;
}

export function fillAnswerTemplate(
  template: string,
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0 || template.trim() === '') return genericAnswer(rows.length);
  const known = new Set(columns);
  let missing = false;
  const filled = template.replace(MARKER, (_match, name: string) => {
    if (name === 'row_count') return formatNumber(rows.length, 0);
    const last = name.startsWith('last.');
    const column = last ? name.slice(5) : name;
    if (!known.has(column)) {
      missing = true;
      return '';
    }
    const text = formatValue((last ? rows[rows.length - 1] : rows[0])[column]);
    if (text === null) {
      missing = true;
      return '';
    }
    return text;
  });
  if (missing || /[{}]/.test(filled)) return genericAnswer(rows.length);
  return filled.replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER_LENGTH);
}
