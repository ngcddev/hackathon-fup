import { describe, expect, it } from 'vitest';
import { cleanText, tryBool, tryDate, tryInt, tryNumeric } from './parse';

// Mismo comportamiento que core.clean_text, try_int, try_numeric, try_date y try_bool.
describe('parse', () => {
  it('cleanText colapsa espacios y vacía los blancos', () => {
    expect(cleanText('  a   b ')).toBe('a b');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(null)).toBeNull();
  });

  it('tryInt acepta enteros y .0', () => {
    expect(tryInt('42')).toBe(42);
    expect(tryInt('42.00')).toBe(42);
    expect(tryInt('4.5')).toBeNull();
    expect(tryInt('abc')).toBeNull();
  });

  it('tryNumeric acepta punto o coma decimal, no separador de miles', () => {
    expect(tryNumeric('3,5')).toBe(3.5);
    expect(tryNumeric('-2')).toBe(-2);
    expect(tryNumeric('1.234,5')).toBeNull();
    expect(tryNumeric('=1+1')).toBeNull();
  });

  it('tryDate acepta los formatos del SQL y rechaza fechas imposibles', () => {
    expect(tryDate('2026-09-20')).toBe('2026-09-20');
    expect(tryDate('2026-9-5 14:30')).toBe('2026-09-05');
    expect(tryDate('20/09/2026')).toBe('2026-09-20');
    expect(tryDate('20/09/2026 08:15:00')).toBe('2026-09-20');
    expect(tryDate('46285')).toBe('2026-09-20'); // número de serie de Excel
    expect(tryDate('2026-02-30')).toBeNull();
    expect(tryDate('09/20/2026')).toBeNull(); // formato de EE. UU.: mes 20 no existe
    expect(tryDate('ayer')).toBeNull();
  });

  it('tryBool acepta sí/no en español e inglés', () => {
    expect(tryBool('Sí')).toBe(true);
    expect(tryBool('inactiva')).toBe(false);
    expect(tryBool('quizás')).toBeNull();
  });
});
