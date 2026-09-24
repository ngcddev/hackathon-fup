import { describe, expect, it } from 'vitest';
import { canonicalizeLiterals } from './literals';

describe('canonicalizeLiterals', () => {
  it('corrige mayúsculas y tildes de valores conocidos', () => {
    expect(canonicalizeLiterals("SELECT 1 FROM agent.v_admissions WHERE zone = 'RURAL' AND admission_class='hospitalario' LIMIT 1")).toBe(
      "SELECT 1 FROM agent.v_admissions WHERE zone = 'Rural' AND admission_class='Hospitalario' LIMIT 1",
    );
    expect(canonicalizeLiterals("WHERE a.service <> 'Unidad de Cuidado Intensivo'")).toBe(
      "WHERE a.service <> 'UNIDAD DE CUIDADO INTENSIVO'",
    );
  });

  it('distingue columnas con valores parecidos', () => {
    expect(canonicalizeLiterals("WHERE service = 'urgencias' AND admission_route = 'URGENCIAS'")).toBe(
      "WHERE service = 'URGENCIAS' AND admission_route = 'Urgencias'",
    );
  });

  it('corrige listas IN', () => {
    expect(canonicalizeLiterals("WHERE sex IN ('FEMENINO', 'masculino') AND regime NOT IN ('subsidiado')")).toBe(
      "WHERE sex IN ('Femenino', 'Masculino') AND regime NOT IN ('Subsidiado')",
    );
  });

  it('deja igual lo desconocido', () => {
    const sql = "SELECT 'RURAL' AS x FROM t WHERE zone = 'Selva' AND item_name = 'omeprazol' AND day = '2026-09-21'";
    expect(canonicalizeLiterals(sql)).toBe(sql);
  });
});
