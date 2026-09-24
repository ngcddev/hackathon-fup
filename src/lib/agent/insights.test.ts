import { describe, expect, it } from 'vitest';
import { detectHelp } from './help';
import { buildFinding, INSIGHT_CHECKS, isInsightsQuestion, summarizeInsights, type Finding } from './insights';
import { PLAN_B } from './plan-b';

describe('isInsightsQuestion', () => {
  it.each([
    '¿Qué encontraste de novedoso en los datos que tienes?',
    'dime que encontraste de novedoso en los datos que tienes?',
    'cuéntame algo novedoso que miraste en los registros que tú tienes',
    '¿Cómo vamos?',
    'dame un resumen general del hospital',
    '¿Qué hallazgos tienes?',
    '¿Hay algo interesante en los datos?',
    '¿Qué debo saber hoy?',
    'algo curioso que hayas visto',
  ])('reconoce: %s', (q) => {
    expect(isInsightsQuestion(q)).toBe(true);
    expect(detectHelp(q)).toBeNull(); // no la toma la ayuda
  });

  it.each([
    '¿Cuáles son los diagnósticos más relevantes este mes?',
    '¿Cuántas camas de UCI están ocupadas hoy?',
    '¿Qué puedo consultar contigo?',
    'medicamentos más importantes por consumo',
    '',
  ])('no intercepta: %s', (q) => {
    expect(isInsightsQuestion(q)).toBe(false);
  });
});

const check = (id: string) => INSIGHT_CHECKS.find((c) => c.id === id)!;

describe('indicadores', () => {
  it('cada indicador apunta a una pregunta del plan B', () => {
    for (const c of INSIGHT_CHECKS)
      expect(
        PLAN_B.some((e) => e.id === c.followUp),
        c.id,
      ).toBe(true);
  });

  it('UCI: compara con hace una semana y con el promedio de 30 días', () => {
    const f = buildFinding(check('uci_trend'), [{ hoy: 30, capacidad: 46, hace_7_dias: 6, promedio_30d_pct: 18.8 }])!;
    expect(f.text).toBe(
      'La UCI tiene 30 de 46 camas ocupadas (65,2 %), frente a 6 hace una semana; su promedio de los últimos 30 días es 18,8 %.',
    );
    expect(f.score).toBeGreaterThan(4);
    expect(f.followUp).toBe('¿Cuántas camas de UCI están ocupadas hoy?');
  });

  it('servicio sobre el umbral de 90 %', () => {
    const f = buildFinding(check('top_occupancy_service'), [{ servicio: 'GINECO OBSTETRICIA', pct: '90.9' }])!;
    expect(f.text).toBe(
      'Gineco obstetricia es el servicio más ocupado hoy, al 90,9 %, por encima del umbral de alerta de 90 %.',
    );
  });

  it('variación de ingresos y espera', () => {
    expect(buildFinding(check('admissions_trend'), [{ semana: 821, semana_anterior: 874 }])!.text).toBe(
      'Hubo 821 ingresos en la última semana, un 6,1 % menos que la semana anterior (874).',
    );
    expect(buildFinding(check('emergency_wait_trend'), [{ semana: 62.1, semana_anterior: 63.6 }])!.text).toContain(
      'casi igual que la semana anterior',
    );
  });

  it('sin filas o sin datos no hay hallazgo', () => {
    expect(buildFinding(check('critical_drugs'), [])).toBeNull();
    expect(buildFinding(check('admissions_trend'), [{ semana: 10, semana_anterior: 0 }])).toBeNull();
  });
});

describe('summarizeInsights', () => {
  const findings: Finding[] = [
    { topic: 'B', text: 'Poco llamativo.', score: 0.5 },
    { topic: 'A', text: 'Muy llamativo.', score: 5, followUp: '¿a?' },
    { topic: 'C', text: 'Medio.', score: 2, followUp: '¿c?' },
  ];

  it('abre con lo más llamativo y ordena la tabla por puntaje', () => {
    const s = summarizeInsights(findings, '2026-09-21')!;
    expect(s.answer).toBe(
      'Revisé 3 indicadores del hospital con corte al 21/09/2026. Lo más llamativo: Muy llamativo.',
    );
    expect(s.highlights).toEqual(['Medio.', 'Poco llamativo.']);
    expect(s.rows.map((r) => r.tema)).toEqual(['A', 'C', 'B']);
    expect(s.followUps).toEqual(['¿a?', '¿c?']);
  });

  it('sin hallazgos devuelve null', () => {
    expect(summarizeInsights([], '2026-09-21')).toBeNull();
  });
});
