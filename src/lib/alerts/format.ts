// Formato de cifras en español para los textos de las alertas.

export function fmtNumber(value: number, decimals = 1): string {
  return value.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
