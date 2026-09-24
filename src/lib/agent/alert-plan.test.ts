import { describe, expect, it } from 'vitest';
import type { KpiAlert } from '../types/api';
import { actionSteps, buildAlertPlan, isAlertPlanQuestion, shortName } from './alert-plan';
import { relatedModules } from './context';
import { isInsightsQuestion } from './insights';

const alert = (over: Partial<KpiAlert>): KpiAlert => ({
  id: 'x',
  type: 'occupancy',
  severity: 'critical',
  title: 'Ocupación crítica: UCI NEONATAL',
  message: 'UCI NEONATAL está al 100 % de ocupación (18 de 18 camas).',
  recommendation: 'Abrir camas adicionales o reasignar personal a este subservicio.',
  is_simulated: false,
  ...over,
});

describe('isAlertPlanQuestion', () => {
  it.each([
    '¿Cómo soluciono las alertas?',
    'que hago con las alertas del modulo',
    'dame sugerencias para resolver las alertas',
    '¿Qué alertas hay?',
    'plan de acción para hoy',
    '¿Qué debo atender primero?',
  ])('reconoce: %s', (q) => expect(isAlertPlanQuestion(q)).toBe(true));

  it.each(['¿Cuántas camas de UCI están ocupadas hoy?', '¿Qué encontraste de novedoso?'])('no intercepta: %s', (q) =>
    expect(isAlertPlanQuestion(q)).toBe(false),
  );

  it('"resumen de alertas" va al plan, no a hallazgos (se revisa primero)', () => {
    expect(isAlertPlanQuestion('resumen general de las alertas')).toBe(true);
    expect(isInsightsQuestion('resumen general de las alertas')).toBe(true);
  });
});

describe('actionSteps', () => {
  it('ocupación crítica: recomendación del módulo, altas, frenar ingresos y seguimiento', () => {
    const steps = actionSteps(alert({}));
    expect(steps[0]).toBe('Abrir camas adicionales o reasignar personal a este subservicio.');
    expect(steps.join(' ')).toContain('Frenar los ingresos programados no urgentes a UCI NEONATAL');
    expect(steps).toHaveLength(4);
  });

  it('inventario crítico simulado pide confirmar el stock físico', () => {
    const steps = actionSteps(
      alert({
        type: 'stockout',
        title: 'Riesgo de desabastecimiento: LOSARTAN',
        recommendation: 'Pedir 300 unidades.',
        is_simulated: true,
      }),
    );
    expect(steps[0]).toBe('Pedir 300 unidades.');
    expect(steps[1]).toContain('stock físico');
    expect(steps.join(' ')).toContain('sustituto terapéutico');
  });

  it('espera crítica cita la Resolución 5596', () => {
    const steps = actionSteps(
      alert({ type: 'emergency_wait', recommendation: 'Reforzar triage 2 en el turno noche.' }),
    );
    expect(steps.join(' ')).toContain('Resolución 5596');
  });
});

describe('buildAlertPlan', () => {
  it('prioriza en el orden del módulo y arma la tabla', () => {
    const plan = buildAlertPlan([
      alert({}),
      alert({
        type: 'stockout',
        title: 'Riesgo de desabastecimiento: LOSARTAN',
        recommendation: 'Pedir 300 unidades.',
        is_simulated: true,
      }),
      alert({
        type: 'emergency_wait',
        severity: 'warning',
        title: 'Espera alta en urgencias: triage 3',
        recommendation: 'Reforzar triage 3.',
      }),
    ]);
    expect(plan.answer).toBe(
      'Hay 3 alertas activas (2 críticas y 1 advertencia). Empiece por la más urgente, Ocupación crítica: UCI NEONATAL: Abrir camas adicionales o reasignar personal a este subservicio.',
    );
    expect(plan.highlights).toEqual([
      'Ocupación de camas: 1 alerta, 1 crítica. La más urgente es UCI NEONATAL: Abrir camas adicionales o reasignar personal a este subservicio.',
      'Inventario de medicamentos: 1 alerta, 1 crítica. La más urgente es LOSARTAN: Pedir 300 unidades.',
      'Espera en urgencias: 1 advertencia. La más urgente es triage 3: Reforzar triage 3.',
    ]);
    expect(plan.rows[0]).toMatchObject({ prioridad: '1', severidad: 'Crítica' });
    expect(plan.rows[0].que_hacer.startsWith('1) Abrir camas')).toBe(true);
    expect(plan.notes[0]).toContain('simulados');
    expect(relatedModules(plan.views, plan.modules)).toEqual(['alerts', 'beds', 'drugs', 'patients']);
  });

  it('acorta nombres muy largos del HIS', () => {
    expect(
      shortName(
        'ALIMENTO LIQUIDO PARA PROPOSITOS MEDICOS ESPECIALES, POLIMERICO, HIPERPROTEICO, HIPERCALORICO -ENSURE CLINICAL',
      ),
    ).toBe('ALIMENTO LIQUIDO PARA PROPOSITOS MEDICOS ESPECIALES…');
    expect(shortName('LOSARTAN 50 mg TABLETA')).toBe('LOSARTAN 50 mg TABLETA');
  });

  it('sin alertas lo dice y enlaza al módulo', () => {
    const plan = buildAlertPlan([]);
    expect(plan.answer.startsWith('No hay alertas activas')).toBe(true);
    expect(plan.modules).toEqual(['alerts']);
  });
});
