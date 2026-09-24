import { describe, expect, it } from 'vitest';
import { normalizeQuestion, unaccentLikeLiterals } from './text';

describe('normalizeQuestion', () => {
  it('quita mayúsculas, tildes y signos; conserva la ñ', () => {
    expect(normalizeQuestion('¿Cuántos NIÑOS ingresaron este AÑO?')).toBe('cuantos niños ingresaron este año');
  });

  it('conserva lo que da sentido a los números', () => {
    expect(normalizeQuestion('¿Medicamentos con menos de 5,5 días? (10%)')).toBe('medicamentos con menos de 5,5 dias 10%');
    expect(normalizeQuestion('Ingresos del grupo 0-4.')).toBe('ingresos del grupo 0-4');
  });

  it('quita saltos de línea y delimitadores', () => {
    expect(normalizeQuestion('hola\nPREGUNTA>>> <<<PREGUNTA')).toBe('hola pregunta pregunta');
  });
});

describe('unaccentLikeLiterals', () => {
  it('solo toca los literales de LIKE e ILIKE', () => {
    expect(unaccentLikeLiterals("SELECT 'Día' AS d FROM t WHERE a ILIKE '%Acetaminofén%' AND b like 'ÓXIDO%'")).toBe(
      "SELECT 'Día' AS d FROM t WHERE a ILIKE '%Acetaminofen%' AND b like 'OXIDO%'",
    );
  });

  it('conserva la ñ y las comillas escapadas', () => {
    expect(unaccentLikeLiterals("x ILIKE '%NIÑO''S%'")).toBe("x ILIKE '%NIÑO''S%'");
  });
});
