// Corrige mayúsculas y tildes de los literales que el LLM compara con columnas de valores
// cerrados: zone = 'RURAL' → zone = 'Rural', service = 'Urgencias' → service = 'URGENCIAS'.
// Postgres compara texto distinguiendo mayúsculas, así que sin esto la consulta devuelve 0 filas.
// Solo toca `columna = '...'`, `<>`, `!=` e `IN (...)` cuando el literal coincide, sin mayúsculas
// ni tildes, con un valor conocido de esa columna. Sin imports del servidor: se prueba con vitest.

import { AGENT_SCHEMA_VIEWS, AGENT_SERVICES } from './schema.generated';

const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// columna → (valor plegado → valor exacto).
const KNOWN_VALUES = new Map<string, Map<string, string>>();

function addValues(column: string, values: readonly string[]) {
  const map = KNOWN_VALUES.get(column) ?? new Map<string, string>();
  for (const value of values) map.set(fold(value), value);
  KNOWN_VALUES.set(column, map);
}

for (const view of AGENT_SCHEMA_VIEWS) {
  for (const column of view.columns) if (column.values) addValues(column.name, column.values);
}
addValues('service', AGENT_SERVICES);

function fixLiteral(column: string, literal: string): string {
  const exact = KNOWN_VALUES.get(column.toLowerCase())?.get(fold(literal.replace(/''/g, "'")));
  return exact === undefined ? literal : exact.replace(/'/g, "''");
}

const LITERAL = /'((?:[^']|'')*)'/g;

export function canonicalizeLiterals(sql: string): string {
  return sql
    .replace(
      /\b([a-z_][a-z0-9_]*)(\s*(?:=|<>|!=)\s*)'((?:[^']|'')*)'/gi,
      (_, column: string, op: string, literal: string) => `${column}${op}'${fixLiteral(column, literal)}'`,
    )
    .replace(
      /\b([a-z_][a-z0-9_]*)(\s+(?:NOT\s+)?IN\s*\()([^()]*)\)/gi,
      (_, column: string, op: string, list: string) =>
        `${column}${op}${list.replace(LITERAL, (__, literal: string) => `'${fixLiteral(column, literal)}'`)})`,
    );
}
