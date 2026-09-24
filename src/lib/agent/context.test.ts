import { describe, expect, it } from 'vitest';
import { describeResult, followUpQuestions, viewNotes } from './context';

describe('describeResult', () => {
  it('ranking sumable: total, participación de los primeros y líder destacado', () => {
    const rows = [
      { servicio: 'PEDIATRIA', pacientes: 405 },
      { servicio: 'HOSPITALIZACION', pacientes: 120 },
      { servicio: 'URGENCIAS', pacientes: 50 },
      { servicio: 'SALA PARTOS', pacientes: 25 },
    ];
    const h = describeResult(['servicio', 'pacientes'], rows);
    expect(h[0]).toBe('Entre los 4 resultados suman 600 pacientes.');
    expect(h[1]).toBe('Los 3 primeros concentran el 95,8 %: Pediatria (405), Hospitalizacion (120) y Urgencias (50).');
    expect(h[2]).toContain('Pediatria está 2,7 veces por encima del promedio');
  });

  it('con pocas filas no compara contra el promedio', () => {
    const h = describeResult(
      ['d', 'ingresos'],
      [
        { d: 'A', ingresos: 254 },
        { d: 'B', ingresos: 10 },
      ],
    );
    expect(h.join(' ')).not.toContain('promedio');
  });

  it('acepta fechas como objeto Date', () => {
    const rows = [
      new Date('2026-09-15T05:00:00Z'),
      new Date('2026-09-16T05:00:00Z'),
      new Date('2026-09-17T05:00:00Z'),
    ].map((dia, i) => ({ dia, ingresos: [3, 9, 6][i] }));
    expect(describeResult(['dia', 'ingresos'], rows)[0]).toContain('9 (16/09/2026)');
  });

  it('medida no sumable ordenada: rango en vez de total', () => {
    const rows = [
      { nombre: 'LOSARTAN 50 mg', stock: 54, dias_restantes: 1.8 },
      { nombre: 'OMEPRAZOL 20 mg', stock: 20, dias_restantes: 2.9 },
      { nombre: 'ESOMEPRAZOL 40 mg', stock: 210, dias_restantes: 4 },
    ];
    expect(describeResult(['nombre', 'stock', 'dias_restantes'], rows)).toEqual([
      'Rango de dias restantes: de 1,8 (Losartan 50 mg) a 4 (Esomeprazol 40 mg); promedio: 2,9.',
    ]);
  });

  it('serie de tiempo: pico, tendencia y total', () => {
    const rows = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].map((dia, i) => ({
      dia,
      ingresos: [10, 12, 20, 22][i],
    }));
    const h = describeResult(['dia', 'ingresos'], rows);
    expect(h[0]).toBe('Pico de ingresos: 22 (18/09/2026); mínimo: 10 (15/09/2026); promedio: 16 por dia.');
    expect(h[1]).toBe('Tendencia: la segunda mitad del periodo está un 90,9 % por encima de la primera.');
    expect(h[2]).toBe('Total del periodo: 64 ingresos.');
  });

  it('las horas numéricas cuentan como serie de tiempo', () => {
    const rows = [0, 1, 2].map((hora) => ({ hora, llegadas: [5, 9, 3][hora] }));
    expect(describeResult(['hora', 'llegadas'], rows)[0]).toBe(
      'Pico de llegadas: 9 (1); mínimo: 3 (2); promedio: 5,7 por hora.',
    );
  });

  it('ignora la fila TOTAL de GROUPING SETS', () => {
    const rows = [
      { subservicio: 'UCI NEONATAL', ocupadas: 15 },
      { subservicio: 'UCI ADULTOS', ocupadas: 9 },
      { subservicio: 'TOTAL UCI', ocupadas: 24 },
    ];
    expect(describeResult(['subservicio', 'ocupadas'], rows)[0]).toBe('Entre los 2 resultados suman 24 ocupadas.');
  });

  it('sin nada que resumir: una fila o sin medidas', () => {
    expect(describeResult(['pacientes'], [{ pacientes: 10 }])).toEqual([]);
    expect(
      describeResult(
        ['a', 'b'],
        [
          { a: 'x', b: 'y' },
          { a: 'z', b: 'w' },
        ],
      ),
    ).toEqual([]);
  });
});

describe('viewNotes', () => {
  it('advierte según la vista y no repite lo que ya dice la respuesta', () => {
    expect(viewNotes(['v_diagnosis_monthly'], 'Hubo 10 ingresos.', false)[0]).toContain('5 o más ingresos');
    expect(viewNotes(['v_drug_inventory'], 'Los datos de inventario son simulados.', false)).toEqual([]);
    expect(viewNotes(['v_admissions'], '', true)[0]).toContain('200 filas');
  });
});

describe('followUpQuestions', () => {
  it('prioriza las del LLM, completa con el plan B y no repite la pregunta hecha', () => {
    const out = followUpQuestions(
      '¿Cuántas camas de UCI están ocupadas hoy?',
      ['v_bed_occupancy'],
      ['¿Cuál es la ocupación de la UCI neonatal?'],
    );
    expect(out[0]).toBe('¿Cuál es la ocupación de la UCI neonatal?');
    expect(out).toContain('¿Cuál es la ocupación de camas por servicio hoy?');
    expect(out).not.toContain('¿Cuántas camas de UCI están ocupadas hoy?');
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it('limpia lo que propone el LLM', () => {
    const out = followUpQuestions('x', [], ['ocupación por servicio', 'a', 'x'.repeat(200), '<script>¿hola?</script>']);
    expect(out[0]).toBe('¿ocupación por servicio?');
    expect(out).toHaveLength(2);
    expect(out[1]).not.toMatch(/[<>]/);
  });

  it('descarta sugerencias que dependen del resultado', () => {
    expect(followUpQuestions('x', [], ['¿Cuál es la distribución por edad en ese servicio?'])).toEqual([]);
  });
});
