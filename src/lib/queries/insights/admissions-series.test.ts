import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { buildAdmissionsSeries, parseAdmissionsSeriesParams } from './admissions-series';

vi.mock('@/lib/db', () => ({ queryAsAppBackend: vi.fn() }));

const REFERENCE = '2026-09-21';
const yearRows = [
  { bucket: 2024, admissions_count: 100 },
  { bucket: 2025, admissions_count: 200 },
  { bucket: 2026, admissions_count: 150 },
];
const parse = (query: string) => parseAdmissionsSeriesParams(new URLSearchParams(query));

describe('parseAdmissionsSeriesParams', () => {
  it('usa year por defecto y deja year y month en null', () => {
    expect(parse('')).toEqual({ granularity: 'year', year: null, month: null });
  });

  it('lee granularity, year y month', () => {
    expect(parse('granularity=day&year=2025&month=3')).toEqual({ granularity: 'day', year: 2025, month: 3 });
  });

  it.each(['granularity=week', 'year=abc', 'year=1800', 'month=13', 'month=0', 'month=1.5'])(
    'rechaza %s con VALIDATION_ERROR',
    (query) => {
      expect(() => parse(query)).toThrow(ApiError);
      expect(() => parse(query)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    },
  );
});

describe('buildAdmissionsSeries', () => {
  it('year: un punto por año desde el primero con ingresos, con ceros intermedios', () => {
    const rows = [
      { bucket: 2024, admissions_count: 100 },
      { bucket: 2026, admissions_count: 150 },
    ];
    const r = buildAdmissionsSeries({ granularity: 'year', year: null, month: null }, rows, [], REFERENCE, null);
    expect(r.points).toEqual([
      { period: '2024', admissions_count: 100 },
      { period: '2025', admissions_count: 0 },
      { period: '2026', admissions_count: 150 },
    ]);
    expect(r.available_years).toEqual([2024, 2026]);
    expect(r.total).toBe(250);
    expect(r.year).toBeNull();
    expect(r.scope).toBe('hospital');
  });

  it('year sin datos: sin puntos', () => {
    const r = buildAdmissionsSeries({ granularity: 'year', year: null, month: null }, [], [], REFERENCE, null);
    expect(r.points).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('month: el año de reference_date llega solo hasta el mes de reference_date', () => {
    const detail = [{ bucket: 9, admissions_count: 40 }];
    const r = buildAdmissionsSeries(
      { granularity: 'month', year: null, month: null },
      yearRows,
      detail,
      REFERENCE,
      null,
    );
    expect(r.year).toBe(2026);
    expect(r.points).toHaveLength(9);
    expect(r.points[0]).toEqual({ period: '2026-01', admissions_count: 0 });
    expect(r.points[8]).toEqual({ period: '2026-09', admissions_count: 40 });
  });

  it('month: un año anterior trae los 12 meses', () => {
    const r = buildAdmissionsSeries({ granularity: 'month', year: 2025, month: null }, yearRows, [], REFERENCE, null);
    expect(r.points).toHaveLength(12);
    expect(r.points[11].period).toBe('2025-12');
  });

  it('month: un año posterior a reference_date no trae puntos', () => {
    const r = buildAdmissionsSeries({ granularity: 'month', year: 2027, month: null }, yearRows, [], REFERENCE, null);
    expect(r.points).toEqual([]);
  });

  it('day: el mes de reference_date llega hasta el día de reference_date', () => {
    const detail = [{ bucket: 21, admissions_count: 7 }];
    const r = buildAdmissionsSeries({ granularity: 'day', year: null, month: null }, yearRows, detail, REFERENCE, null);
    expect(r.year).toBe(2026);
    expect(r.month).toBe(9);
    expect(r.points).toHaveLength(21);
    expect(r.points[20]).toEqual({ period: '2026-09-21', admissions_count: 7 });
  });

  it('day: respeta los días del mes (febrero de 2024 tiene 29)', () => {
    const r = buildAdmissionsSeries({ granularity: 'day', year: 2024, month: 2 }, yearRows, [], REFERENCE, null);
    expect(r.points).toHaveLength(29);
    expect(r.points[28].period).toBe('2024-02-29');
  });

  it('day: un mes posterior a reference_date no trae puntos', () => {
    const r = buildAdmissionsSeries({ granularity: 'day', year: 2026, month: 10 }, yearRows, [], REFERENCE, null);
    expect(r.points).toEqual([]);
  });

  it('con filtro de servicio el alcance es service', () => {
    const r = buildAdmissionsSeries({ granularity: 'year', year: null, month: null }, yearRows, [], REFERENCE, 'UCI');
    expect(r.scope).toBe('service');
    expect(r.service_filter).toBe('UCI');
  });
});
