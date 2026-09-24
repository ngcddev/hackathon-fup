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

// Formato colombiano: coma decimal y punto de miles ("1.234,5"). Sin depender de ICU.
export function formatNumber(value: number, maxDecimals = 1): string {
  const rounded = Number(value.toFixed(maxDecimals));
  const [int, dec] = String(rounded).split('.');
  const sign = int.startsWith('-') ? '-' : '';
  const digits = int.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${digits}${dec ? `,${dec}` : ''}`;
}
