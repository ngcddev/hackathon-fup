import { ApiError } from '@/lib/api/errors';
import { queryAsAppBackend } from '@/lib/db';
import type { AdmissionsGranularity, AdmissionsSeriesPoint, AdmissionsSeriesResponse, IsoDate } from '@/lib/types/api';

// Serie de ingresos por año, mes o día para la vista Pacientes.
// Ingresos = pacientes hospitalarios distintos (S-05) de agent.v_admissions, por admitted_at, igual que
// la tarjeta de demanda. Respeta el filtro de servicio. Los periodos sin ingresos salen con 0 y no hay
// periodos posteriores a reference_date.
// - year: un punto por año, desde el primer año con ingresos hasta el de reference_date.
// - month: los 12 meses de `year`.
// - day: los días de `month` de `year`.

const GRANULARITIES: readonly AdmissionsGranularity[] = ['year', 'month', 'day'];
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export interface AdmissionsSeriesParams {
  granularity: AdmissionsGranularity;
  year: number | null; // null: el año de reference_date
  month: number | null; // null: el mes de reference_date
}

export interface BucketRow {
  bucket: number; // año, mes (1 a 12) o día del mes, según la granularidad
  admissions_count: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function parseInteger(raw: string | null, name: string, min: number, max: number): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError('VALIDATION_ERROR', `El parámetro ${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

// granularity: year (por defecto), month o day. year y month son opcionales y solo aplican a
// month (year) y day (year y month).
export function parseAdmissionsSeriesParams(searchParams: URLSearchParams): AdmissionsSeriesParams {
  const raw = searchParams.get('granularity')?.trim() || 'year';
  if (!(GRANULARITIES as readonly string[]).includes(raw)) {
    throw new ApiError('VALIDATION_ERROR', 'El parámetro granularity debe ser year, month o day.');
  }
  return {
    granularity: raw as AdmissionsGranularity,
    year: parseInteger(searchParams.get('year'), 'year', MIN_YEAR, MAX_YEAR),
    month: parseInteger(searchParams.get('month'), 'month', 1, 12),
  };
}

export function buildAdmissionsSeries(
  params: AdmissionsSeriesParams,
  yearRows: BucketRow[],
  detailRows: BucketRow[],
  reference_date: IsoDate,
  service: string | null,
): AdmissionsSeriesResponse {
  const [refYear, refMonth, refDay] = reference_date.slice(0, 10).split('-').map(Number);
  const available_years = yearRows.filter((r) => r.admissions_count > 0).map((r) => r.bucket);
  const { granularity } = params;
  const year = granularity === 'year' ? null : (params.year ?? refYear);
  const month = granularity === 'day' ? (params.month ?? refMonth) : null;
  const counts = new Map((granularity === 'year' ? yearRows : detailRows).map((r) => [r.bucket, r.admissions_count]));
  const count = (bucket: number) => counts.get(bucket) ?? 0;

  const points: AdmissionsSeriesPoint[] = [];
  if (granularity === 'year') {
    for (let y = available_years[0] ?? refYear + 1; y <= refYear; y++) {
      points.push({ period: String(y), admissions_count: count(y) });
    }
  } else if (granularity === 'month' && year !== null && year <= refYear) {
    const last = year === refYear ? refMonth : 12;
    for (let m = 1; m <= last; m++) {
      points.push({ period: `${year}-${pad(m)}`, admissions_count: count(m) });
    }
  } else if (
    granularity === 'day' &&
    year !== null &&
    month !== null &&
    (year < refYear || (year === refYear && month <= refMonth))
  ) {
    const last = year === refYear && month === refMonth ? refDay : daysInMonth(year, month);
    for (let d = 1; d <= last; d++) {
      points.push({ period: `${year}-${pad(month)}-${pad(d)}`, admissions_count: count(d) });
    }
  }

  return {
    scope: service === null ? 'hospital' : 'service',
    service_filter: service,
    granularity,
    year,
    month,
    available_years,
    points,
    total: points.reduce((sum, p) => sum + p.admissions_count, 0),
    reference_date,
    generated_at: new Date().toISOString(),
  };
}

// $1 = servicio (o null). El año y el mes por defecto salen de reference_date, en la misma consulta.
const admissionsBy = (bucket: string, range = '') => `
  SELECT ${bucket} AS bucket, COUNT(DISTINCT a.patient_key)::int AS admissions_count
    FROM agent.v_admissions a
   WHERE a.admission_class = 'Hospitalario'
     AND a.admitted_at < (SELECT agent.reference_date()) + 1
     AND ($1::text IS NULL OR a.service = $1::text)${range}
   GROUP BY 1
   ORDER BY 1`;

const YEAR_OF_REFERENCE = 'COALESCE($2::int, EXTRACT(YEAR FROM (SELECT agent.reference_date()))::int)';
const MONTH_OF_REFERENCE = 'COALESCE($3::int, EXTRACT(MONTH FROM (SELECT agent.reference_date()))::int)';

export async function getAdmissionsSeries(
  params: AdmissionsSeriesParams,
  service: string | null,
): Promise<AdmissionsSeriesResponse> {
  const { granularity, year, month } = params;

  // Los años disponibles salen siempre para llenar el selector; el detalle solo en month y day.
  const detail = (): Promise<BucketRow[]> => {
    if (granularity === 'month') {
      return queryAsAppBackend<BucketRow>(
        admissionsBy(
          'EXTRACT(MONTH FROM a.admitted_at)::int',
          `
     AND a.admitted_at >= make_date(${YEAR_OF_REFERENCE}, 1, 1)
     AND a.admitted_at <  make_date(${YEAR_OF_REFERENCE} + 1, 1, 1)`,
        ),
        [service, year],
      );
    }
    if (granularity === 'day') {
      return queryAsAppBackend<BucketRow>(
        admissionsBy(
          'EXTRACT(DAY FROM a.admitted_at)::int',
          `
     AND a.admitted_at >= make_date(${YEAR_OF_REFERENCE}, ${MONTH_OF_REFERENCE}, 1)
     AND a.admitted_at <  make_date(${YEAR_OF_REFERENCE}, ${MONTH_OF_REFERENCE}, 1) + interval '1 month'`,
        ),
        [service, year, month],
      );
    }
    return Promise.resolve([]);
  };

  const [refRows, yearRows, detailRows] = await Promise.all([
    queryAsAppBackend<{ reference_date: IsoDate }>('SELECT agent.reference_date() AS reference_date'),
    queryAsAppBackend<BucketRow>(admissionsBy('EXTRACT(YEAR FROM a.admitted_at)::int'), [service]),
    detail(),
  ]);
  return buildAdmissionsSeries(params, yearRows, detailRows, refRows[0]?.reference_date ?? '', service);
}
