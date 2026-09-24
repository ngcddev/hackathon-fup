// Utilidades de texto compartidas por privacidad y plan B. Sin dependencias del servidor:
// los módulos puros de /lib/agent se prueban con vitest sin arrancar Next.js.

// Minúsculas, sin tildes, sin signos y con espacios simples.
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Forma de la pregunta que ve el LLM y que usa la caché de decisiones: minúsculas, sin tildes
// (conserva la ñ), sin ¿?¡! ni comillas, con espacios simples. A diferencia de normalizeText,
// conserva lo que cambia el sentido de un número ("5,5", "10%", "0-4").
// Así "¿Cuántos pacientes...?" y "cuantos pacientes..." llegan idénticas al modelo.
export function normalizeQuestion(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-̂̄-ͯ]/g, '') // quita tildes y diéresis; deja la virgulilla de la ñ
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9ñ.,%\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,-]+|[\s.,-]+$/g, '');
}

// Quita tildes de los literales de LIKE/ILIKE del SQL del LLM: los textos del HIS están en
// mayúsculas y sin tildes, así que '%apendícitis%' nunca coincidiría. Conserva la ñ.
export function unaccentLikeLiterals(sql: string): string {
  return sql.replace(/(\bI?LIKE\s+)'((?:[^']|'')*)'/gi, (_, op: string, literal: string) => {
    const clean = literal
      .normalize('NFD')
      .replace(/[̀-̂̄-ͯ]/g, '')
      .normalize('NFC');
    return `${op}'${clean}'`;
  });
}

// Formato colombiano: coma decimal y punto de miles ("1.234,5"). Sin depender de ICU.
export function formatNumber(value: number, maxDecimals = 1): string {
  const rounded = Number(value.toFixed(maxDecimals));
  const [int, dec] = String(rounded).split('.');
  const sign = int.startsWith('-') ? '-' : '';
  const digits = int.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${digits}${dec ? `,${dec}` : ''}`;
}
