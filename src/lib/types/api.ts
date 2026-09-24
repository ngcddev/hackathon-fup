// Tipos exactos del contrato de la API. Fuente: docs/api-contract.md.
// JSON en snake_case. Fechas ISO 8601:
//   - HisTimestamp: datos del HIS, sin zona (hora de Colombia), "2026-09-21T14:33:00".
//   - AuditTimestamp: auditoría, con zona, "2026-09-21T14:33:00-05:00".
//   - IsoDate: solo fecha, "2026-09-21".
//   - IsoMonth: "2026-09".

import type { ApiErrorCode } from '@/lib/api/errors';
import type { Permission, Role } from '@/lib/auth/permissions';

export type HisTimestamp = string;
export type AuditTimestamp = string;
export type IsoDate = string;
export type IsoMonth = string;

// ---------------------------------------------------------------- Errores

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

// ---------------------------------------------------------------- GET /api/me

export interface MeResponse {
  id: string;
  full_name: string;
  role: Role;
  permissions: Permission[];
}

// ---------------------------------------------------------------- POST /api/query

export const AGENT_VIEWS = [
  'v_admissions',
  'v_bed_occupancy',
  'v_emergency_wait_times',
  'v_drug_inventory',
  'v_drug_consumption_daily',
  'v_service_demand_daily',
  'v_surgeries',
  'v_diagnosis_monthly',
] as const;
export type AgentView = (typeof AGENT_VIEWS)[number];

export type QueryOrigin = 'llm' | 'predefined';
export type LlmProvider = 'gemini' | 'groq';
export type QueryCell = string | number | boolean | null;

export interface QueryRequest {
  question: string; // 1 a 500 caracteres
}

export interface QueryResponse {
  question: string;
  answer: string;
  sql: string;
  columns: string[];
  rows: QueryCell[][]; // alineadas con `columns`; nunca incluye patient_key
  row_count: number;
  truncated: boolean; // true si se aplicó el LIMIT de 200
  origin: QueryOrigin;
  llm_provider: LlmProvider | null; // null si respondió el plan B
  views_used: AgentView[];
  includes_simulated_data: boolean;
  reference_date: IsoDate;
  duration_ms: number;
  // Contexto calculado por el servidor a partir de las filas (el LLM nunca las ve).
  highlights: string[]; // frases con cifras del resultado: total, participación, rango, pico, tendencia
  notes: string[]; // advertencias de las vistas usadas (datos simulados, umbrales de privacidad…)
  follow_up_questions: string[]; // hasta 3 preguntas relacionadas para seguir explorando
}

// ---------------------------------------------------------------- GET /api/kpis

export type KpiScope = 'service' | 'hospital';
export type AlertSeverity = 'critical' | 'warning';
export type AlertType = 'stockout' | 'occupancy' | 'emergency_wait' | 'surgery_compliance';

export interface OccupancyFigures {
  occupied_beds: number;
  capacity: number;
  occupancy_pct: number;
}

export interface OccupancyByService extends OccupancyFigures {
  service: string;
}

export interface OccupancyBySubservice extends OccupancyByService {
  subservice: string;
  is_capacity_simulated: boolean;
}

export interface OccupancyCard {
  scope: KpiScope; // 'service'
  day: IsoDate;
  total: OccupancyFigures; // con filtro, es el total del servicio
  by_service: OccupancyByService[];
  by_subservice: OccupancyBySubservice[];
}

export interface EmergencyWaitByTriage {
  triage_level: number | null; // 1 a 5; null si el ingreso no tiene triage
  avg_wait_minutes: number;
  admissions_count: number;
}

export interface EmergencyWaitCard {
  scope: KpiScope; // 'hospital'
  period_start: IsoDate;
  period_end: IsoDate;
  avg_wait_minutes: number;
  admissions_count: number;
  by_triage_level: EmergencyWaitByTriage[];
}

export interface CriticalDrug {
  item_code: string;
  item_name: string;
  current_stock: number;
  avg_daily_consumption: number;
  days_of_inventory: number;
  stock_date: IsoDate;
  is_simulated: boolean;
  estimated_stockout_date?: IsoDate; // D2: reference_date + días de inventario (hacia abajo)
  suggested_order_quantity?: number; // D2: unidades para cubrir `target_days` de consumo (mínimo 0)
}

export interface CriticalDrugsCard {
  scope: KpiScope; // 'hospital'
  threshold_days: number; // 5
  target_days?: number; // D2: días de cobertura usados en suggested_order_quantity
  count: number;
  includes_simulated_data: boolean;
  items: CriticalDrug[]; // solo item_type = medicamento, de menor a mayor días
}

export interface SurgeriesByMonth {
  month: IsoMonth;
  scheduled: number;
  performed: number;
  compliance_pct: number;
}

export interface SurgeriesCard {
  scope: KpiScope; // 'hospital'
  universe_total: number; // programaciones con ingreso en el extracto (S-11)
  performed_total: number;
  compliance_pct: number;
  by_month: SurgeriesByMonth[];
}

export interface AdmissionsByService {
  service: string;
  admissions_count: number;
}

export interface ServicesBySpecialty {
  specialty: string;
  lines_count: number;
}

export interface DemandCard {
  scope: KpiScope; // 'service': admissions_by_service respeta el filtro; services_by_specialty no
  period_start: IsoDate;
  period_end: IsoDate;
  admissions_by_service: AdmissionsByService[];
  services_by_specialty: ServicesBySpecialty[];
}

export interface DrugRotationItem {
  item_code: string;
  item_name: string;
  item_type: 'medicamento' | 'dispositivo';
  total_quantity: number;
}

export interface DrugRotationCard {
  scope: KpiScope; // 'hospital'
  period_start: IsoDate;
  period_end: IsoDate;
  top: DrugRotationItem[]; // 10 de mayor rotación
  bottom: DrugRotationItem[]; // 10 de menor rotación con consumo > 0
}

export interface OccupancyTrendPoint extends OccupancyFigures {
  day: IsoDate;
}

export interface OccupancyTrendCard {
  scope: KpiScope; // 'service'
  days: OccupancyTrendPoint[]; // últimos 30 días
}

export interface AvgStayByService {
  service: string;
  avg_stay_days: number;
  admissions_count: number;
}

export interface AvgStayCard {
  scope: KpiScope; // 'service'
  by_service: AvgStayByService[];
}

export interface KpiAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  recommendation: string;
  is_simulated: boolean;
}

export interface KpisResponse {
  occupancy: OccupancyCard;
  emergency_wait: EmergencyWaitCard;
  critical_drugs: CriticalDrugsCard;
  surgeries: SurgeriesCard;
  demand: DemandCard;
  drug_rotation: DrugRotationCard;
  occupancy_trend?: OccupancyTrendCard; // Should
  avg_stay?: AvgStayCard; // Should
  alerts: KpiAlert[]; // siempre de todo el hospital, críticas primero
  reference_date: IsoDate;
  generated_at: AuditTimestamp;
  service_filter: string | null;
}

// ---------------------------------------------------------------- GET /api/insights/arrivals (D6)

export interface ArrivalsCell {
  weekday: number; // 1 lunes a 7 domingo (ISO)
  hour: number; // 0 a 23, hora de llegada
  avg_arrivals: number; // llegadas ÷ veces que ese día de la semana aparece en el periodo
}

export interface ArrivalsPeak {
  weekday: number;
  weekday_name: string;
  hour_start: number; // franja de 2 horas: hour_start a hour_end (hour_end 24 = medianoche)
  hour_end: number;
  avg_arrivals: number; // llegadas promedio en la franja
  pct_above_average: number; // % sobre el promedio de las 84 franjas de la semana
  shift: 'dia' | 'noche'; // turno donde cae la mayoría de las llegadas de la franja
  recommendation: string;
}

export interface ArrivalsInsightResponse {
  scope: KpiScope; // 'hospital'
  period_start: IsoDate; // primer día con llegadas
  period_end: IsoDate; // reference_date
  days_count: number;
  arrivals_total: number;
  avg_arrivals_per_slot: number; // promedio de las 84 franjas (7 días × 12 franjas de 2 h)
  cells: ArrivalsCell[]; // 168 celdas: día de la semana × hora
  top_slots: ArrivalsPeak[]; // las 3 franjas con más llegadas frente al promedio
  reference_date: IsoDate;
  generated_at: AuditTimestamp;
}

// ---------------------------------------------------------------- GET /api/insights/wait-root-cause (D7)

export interface WaitPeriod {
  start: IsoDate;
  end: IsoDate;
}

export interface WaitOverall {
  current_avg_wait_minutes: number;
  baseline_avg_wait_minutes: number;
  change_pct: number | null; // null si la línea base es 0
  current_volume: number;
  baseline_volume: number;
}

export interface WaitRootCauseSegment {
  shift: 'dia' | 'noche';
  weekday: number; // 1 lunes a 7 domingo (ISO)
  weekday_name: string;
  triage_level: number | null; // null: ingresos sin triage
  current_avg_wait_minutes: number; // última semana
  baseline_avg_wait_minutes: number; // 4 semanas anteriores
  change_minutes: number; // actual − línea base
  change_pct: number | null;
  current_volume: number; // ingresos de la última semana en el segmento
  baseline_volume: number;
  contribution_minutes: number; // cambio × volumen actual (minutos de espera acumulados)
  contribution_share_pct: number | null; // % del cambio total (cambio global × volumen actual global)
}

export interface WaitRootCauseResponse {
  scope: KpiScope; // 'hospital'
  current_period: WaitPeriod; // última semana (reference_date − 6 a reference_date)
  baseline_period: WaitPeriod; // las 4 semanas anteriores (28 días)
  min_segment_volume: number; // segmentos con menos ingresos (en cualquiera de los dos periodos) no se reportan
  overall: WaitOverall;
  top_segments: WaitRootCauseSegment[]; // hasta 3, los que más aportan al cambio
  summary: string; // frase armada con plantilla, sin LLM
  reference_date: IsoDate;
  generated_at: AuditTimestamp;
}

// ---------------------------------------------------------------- GET /api/sources

export type BatchLoadType = 'historical' | 'ui_import' | 'seed_synthetic';
export type BatchStatus = 'pending' | 'validated' | 'applied' | 'rejected' | 'reverted';

export interface SourceTable {
  table: string;
  rows: number;
  simulated_rows: number;
}

export interface SourceBatch {
  batch_id: string;
  load_type: BatchLoadType;
  target_table: string;
  file_name: string | null;
  source_system: string;
  imported_by: { user_id: string; full_name: string } | null; // null: carga por script
  imported_at: AuditTimestamp;
  rows_read: number;
  rows_loaded: number;
  rows_rejected: number;
  status: BatchStatus;
  is_simulated: boolean;
}

export interface SourcesResponse {
  tables: SourceTable[];
  batches: SourceBatch[]; // los 50 más recientes
  last_load_at: AuditTimestamp | null;
  simulated_pct: number; // 0 a 100
}

// ---------------------------------------------------------------- Importación

export const IMPORT_TARGETS = ['drug_stock', 'bed_inventory', 'surgery_schedules'] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

// Columnas de cada plantilla (nombres exactos que espera el servidor).
export const IMPORT_COLUMNS = {
  drug_stock: ['item_code', 'item_name', 'stock_date', 'current_stock', 'unit', 'expiration_date'],
  bed_inventory: ['bed_code', 'bed_name', 'bed_group', 'bed_subgroup', 'is_active'],
  surgery_schedules: [
    'schedule_number',
    'patient_id',
    'admission_id',
    'service_code',
    'scheduled_date',
    'operating_room',
  ],
} as const satisfies Record<ImportTarget, readonly string[]>;

export const IMPORT_LIMITS = {
  max_chunk_bytes: 4_000_000, // cuerpo de cada trozo, estrictamente menor de 4 MB
  recommended_chunk_rows: 1000,
  max_rows_per_batch: 10_000,
} as const;

export interface CreateBatchRequest {
  target: ImportTarget;
  file_name: string;
  source_system: string;
  total_rows: number; // 1 a max_rows_per_batch
}

export interface CreateBatchResponse {
  batch_id: string;
  target: ImportTarget;
  status: 'pending';
  max_chunk_bytes: number;
  max_rows_per_batch: number;
}

// Celdas tal como vienen del archivo (texto). El servidor las valida y convierte.
export interface ImportRow {
  row_number: number; // número de fila en el archivo, sin repetir dentro del lote
  values: Record<string, string | null>;
}

export interface SendRowsRequest {
  rows: ImportRow[];
}

export interface ImportRowError {
  row_number: number;
  column_name: string | null; // null: error de la fila completa
  message: string;
}

export interface SendRowsResponse {
  batch_id: string;
  received_rows: number; // filas de este trozo
  total_received_rows: number; // acumulado del lote
  invalid_rows: number; // acumulado del lote
  row_errors: ImportRowError[]; // errores de este trozo, máximo 100
  errors_truncated: boolean;
}

export interface ApplyBatchResponse {
  batch_id: string;
  status: 'applied';
  rows_loaded: number;
  applied_at: AuditTimestamp;
}

export interface RevertBatchResponse {
  batch_id: string;
  status: 'reverted';
  rows_reverted: number;
}

// ---------------------------------------------------------------- Administración de usuarios

export interface UserSummary {
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: AuditTimestamp;
  created_by: string | null; // null: administrador inicial creado por el script
}

export interface ListUsersResponse {
  users: UserSummary[];
}

export interface CreateUserRequest {
  full_name: string;
  email: string;
  role: Role;
  temporary_password: string; // mínimo 10 caracteres (RNF-15)
}

export interface UserResponse {
  user: UserSummary;
}

// Al menos uno de los dos campos.
export interface UpdateUserRequest {
  role?: Role;
  is_active?: boolean;
}

export interface ResetPasswordRequest {
  temporary_password: string; // mínimo 10 caracteres
}

// ---------------------------------------------------------------- GET /api/admin/logs (Could)

export type LogType = 'queries' | 'admin';
export type QueryLogStatus = 'ok' | 'rejected' | 'error';
export type AdminLogAction = 'create' | 'role_change' | 'deactivate' | 'reactivate' | 'password_reset';

export interface QueryLogEntry {
  query_log_id: number;
  user: { user_id: string; full_name: string };
  asked_at: AuditTimestamp;
  question: string;
  generated_sql: string | null;
  origin: QueryOrigin;
  llm_provider: LlmProvider | null;
  status: QueryLogStatus;
  row_count: number | null;
  duration_ms: number;
}

export interface AdminLogEntry {
  admin_log_id: number;
  actor: { user_id: string; full_name: string };
  target: { user_id: string; full_name: string };
  action: AdminLogAction;
  old_value: string | null;
  new_value: string | null;
  created_at: AuditTimestamp;
}

export interface QueryLogsResponse {
  type: 'queries';
  entries: QueryLogEntry[];
}

export interface AdminLogsResponse {
  type: 'admin';
  entries: AdminLogEntry[];
}

export type LogsResponse = QueryLogsResponse | AdminLogsResponse;
