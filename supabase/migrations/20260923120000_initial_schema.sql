-- =============================================================================
-- schema.sql · Sistema de Gestión Hospitalaria Inteligente (HSLV)
-- Versión 0.2 · 23-sep-2026 · Deriva de modelo_datos_hslv v0.5 y levante v0.5
-- Formato de origen del HIS (S-12): UTF-8 con BOM, separador |, fechas AAAA-MM-DD HH:MM:SS.
--
-- Desde este archivo, el modelo de datos tiene una sola fuente de verdad: este SQL.
-- Se aplica UNA vez sobre un proyecto Supabase limpio, como migración inicial
-- (supabase/migrations/20260923120000_initial_schema.sql).
--
-- NO contiene contraseñas. Los roles agent_ro, importer y app_backend se crean
-- con LOGIN pero sin contraseña: no pueden conectarse hasta que se les asigne
-- una a mano, fuera del repositorio (ver README, paso "Credenciales de roles").
-- =============================================================================


-- =============================================================================
-- 1. Esquemas
-- =============================================================================
create schema if not exists staging;
create schema if not exists core;
create schema if not exists agent;
create schema if not exists audit;

-- Nadie entra a estos esquemas salvo lo que se concede explícitamente al final.
revoke all on schema staging, core, agent, audit from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema staging, core, agent, audit from anon, authenticated';
  end if;
end $$;


-- =============================================================================
-- 2. Roles de Postgres
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_ro') then
    create role agent_ro with login noinherit nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'importer') then
    create role importer with login noinherit nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_backend') then
    create role app_backend with login noinherit nocreatedb nocreaterole;
  end if;
end $$;

-- SQL del LLM: solo lectura, 5 s máximo (SEG-05) y solo ve el esquema agent.
alter role agent_ro set default_transaction_read_only = on;
alter role agent_ro set statement_timeout = '5s';
alter role agent_ro set idle_in_transaction_session_timeout = '10s';
alter role agent_ro set search_path = agent;

alter role importer set statement_timeout = '60s';
alter role app_backend set statement_timeout = '15s';


-- =============================================================================
-- 3. Configuración y funciones utilitarias
-- =============================================================================

-- Una sola fila. reference_date es "hoy" para todo el sistema; la carga histórica
-- la sobrescribe con REFERENCE_DATE del .env (CAR-08). pseudonym_salt es la sal de
-- patient_key: nunca sale de core (agent_ro no tiene acceso a esta tabla).
create table core.app_settings (
  id               boolean primary key default true check (id),
  reference_date   date not null,
  pseudonym_salt   text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated_at       timestamptz not null default now()
);
insert into core.app_settings (reference_date) values ('2026-09-21');

-- Limpia espacios: recorta, colapsa espacios internos y convierte '' en NULL.
create or replace function core.clean_text(p text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(p, '\s+', ' ', 'g')), '')
$$;

-- Casteos tolerantes: devuelven NULL en vez de fallar. Son la base de la validación.
create or replace function core.try_int(p text) returns bigint
language sql immutable as $$
  select case when core.clean_text(p) ~ '^-?\d{1,18}(\.0+)?$'
  then split_part(core.clean_text(p), '.', 1)::bigint end
$$;

-- Acepta punto o coma decimal. No acepta separadores de miles.
create or replace function core.try_numeric(p text) returns numeric
language sql immutable as $$
  select case when core.clean_text(p) ~ '^-?\d+([.,]\d+)?$'
              then replace(core.clean_text(p), ',', '.')::numeric end
$$;

-- Formatos aceptados: AAAA-MM-DD[ HH:MI[:SS]], DD/MM/AAAA[ HH:MI[:SS]]
-- y número de serie de Excel (días desde 1899-12-30).
create or replace function core.try_timestamp(p text) returns timestamp
language plpgsql stable as $$
declare
  v text := core.clean_text(p);
begin
  if v is null then
    return null;
  end if;
  begin
    if v ~ '^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?)?$' then
      return replace(v, 'T', ' ')::timestamp;
    elsif v ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      return to_date(v, 'DD/MM/YYYY')::timestamp;
    elsif v ~ '^\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}$' then
      return to_timestamp(v, 'DD/MM/YYYY HH24:MI')::timestamp;
    elsif v ~ '^\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}$' then
      return to_timestamp(v, 'DD/MM/YYYY HH24:MI:SS')::timestamp;
    elsif v ~ '^\d{5}(\.\d+)?$' then
      return timestamp '1899-12-30' + (v::numeric * interval '1 day');
    end if;
  exception when others then
    return null;
  end;
  return null;
end $$;

create or replace function core.try_date(p text) returns date
language sql stable as $$
select core.try_timestamp(p)::date
$$;

create or replace function core.try_bool(p text) returns boolean
language sql immutable as $$
select case
when lower(core.clean_text(p)) in ('true','t','1','si','sí','s','yes','y','activa','activo') then true
when lower(core.clean_text(p)) in ('false','f','0','no','n','inactiva','inactivo') then false
end
$$;

-- Nombres de servicio y subservicio: mayúsculas, espacios limpios y los dos
-- errores de digitación del HIS corregidos. Se usa en admissions y bed_inventory
-- para que ambos crucen igual.
create or replace function core.normalize_service(p text) returns text
language sql immutable as $$
select replace(replace(upper(core.clean_text(p)),
'GINECO OBSTRETICIA', 'GINECO OBSTETRICIA'),
'UNIDAD DE CUIDAD BASICO', 'UNIDAD DE CUIDADO BASICO')
$$;

-- Nivel de triage (S-16): el número que sigue a "TRIAGE" en ClasificacionTriage.
create or replace function core.parse_triage_level(p text) returns smallint
language sql immutable as $$
  select substring(upper(p) from 'TRIAGE\s*([1-5])')::smallint
$$;


-- =============================================================================
-- 4. Usuarios (core.user_profiles)
-- =============================================================================
create table core.user_profiles (
  user_id               uuid primary key references auth.users(id) on delete restrict,
  full_name             text not null check (core.clean_text(full_name) is not null),
  role                  text not null check (role in ('director','service_head','administrative','pharmacy','admin')),
  is_active             boolean not null default true,
  must_change_password  boolean not null default true,
  created_by            uuid references core.user_profiles(user_id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- AUT-07 (parte de base de datos): siempre queda al menos un admin activo.
-- La regla "no desactivarse a sí mismo" se valida en el controlador, que conoce al actor.
create or replace function core.tg_user_profiles_guard() returns trigger
language plpgsql as $$
begin
  if old.role = 'admin' and old.is_active
    and (new.role <> 'admin' or not new.is_active)
    and not exists (select 1 from core.user_profiles
    where role = 'admin' and is_active and user_id <> old.user_id) then
    raise exception 'Debe quedar al menos un administrador activo.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger user_profiles_guard
before update on core.user_profiles
for each row execute function core.tg_user_profiles_guard();


-- =============================================================================
-- 5. Auditoría
-- =============================================================================
create table audit.import_batches (
  batch_id              uuid primary key default gen_random_uuid(),
  load_type             text not null check (load_type in ('historical','ui_import','seed_synthetic')),
  target_table          text not null check (target_table in (
                          'patients','admissions','triages','first_attentions','service_lines',
                          'drug_dispensations','surgery_schedules','drug_stock','bed_inventory')),
  file_name             text,
  source_system         text not null,
  imported_by_user_id   uuid references core.user_profiles(user_id),
  imported_at           timestamptz not null default now(),
  rows_read             int not null default 0,
  rows_loaded           int not null default 0,
  rows_rejected         int not null default 0,
  status                text not null default 'pending'
                          check (status in ('pending','validated','applied','rejected','reverted')),
  is_simulated          boolean not null default false,
  reverted_by_user_id   uuid references core.user_profiles(user_id),
  reverted_at           timestamptz,
  constraint ui_import_requires_user
    check (load_type <> 'ui_import' or imported_by_user_id is not null),
  constraint ui_import_only_templates
    check (load_type <> 'ui_import' or target_table in ('drug_stock','bed_inventory','surgery_schedules')),
  constraint seed_only_drug_stock
    check (load_type <> 'seed_synthetic' or target_table = 'drug_stock')      -- CAR-03
);

create table audit.import_errors (
  error_id       bigint generated always as identity primary key,
  batch_id       uuid not null references audit.import_batches(batch_id),
  row_number     int not null,             -- 0 = error del archivo completo
  column_name    text,
  error_message  text not null
);

create table audit.query_log (
  query_log_id   bigint generated always as identity primary key,
  user_id        uuid not null references core.user_profiles(user_id),
  asked_at       timestamptz not null default now(),
  question       text not null,
  generated_sql  text,
  origin         text not null check (origin in ('llm','predefined')),
  llm_provider   text check (llm_provider in ('gemini','groq')),
  status         text not null check (status in ('ok','rejected','error')),
  error_message  text,
  row_count      int,
  duration_ms    int not null
);

create table audit.user_admin_log (
  admin_log_id    bigint generated always as identity primary key,
  actor_user_id   uuid not null references core.user_profiles(user_id),
  target_user_id  uuid not null references core.user_profiles(user_id),
  action          text not null check (action in ('create','role_change','deactivate','reactivate','password_reset')),
  old_value       text,
  new_value       text,
  created_at      timestamptz not null default now()
);


-- =============================================================================
-- 6. Staging: copia fiel del origen, todo texto
-- Columnas comunes: batch_id, source_row_number, loaded_at, validation_status.
-- Las columnas de las tablas HIS son el nombre original en snake_case.
-- =============================================================================
create table staging.stg_paciente (
  tipo_documento text, id_paciente text, nombre_paciente text, fecha_nacimiento text,
  sexo text, asegurador text, regimen text, departamento text, municipio text, zona text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

create table staging.stg_ingresos (
  oid_ingreso text, consecutivo_ingreso text, id_paciente text, clase_ingreso text,
  via_ingreso text, tipo_riesgo text, fecha_ingreso text, fecha_hospitalizacion text,
  oid_triage_a text, codigo_cama text, nombre_cama text, nombre_grupo_cama text,
  nombre_subgrupo_cama text, codigo_diagnostico text, nombre_diagnostico text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

create table staging.stg_triage (
  oid_triage text, fecha_triage text, motivo_consulta text, tension_arterial text,
  frecuencia_cardiaca text, frecuencia_respiratoria text, temperatura text,
  id_paciente2 text, codigo_triage text, clasificacion_triage text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

create table staging.stg_atencion (
  oid_ingreso text, fecha_atencion text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

create table staging.stg_servicios (
  oid_s text, oid_ingreso text, codigo_servicio text, nombre_servicio text, cantidad text,
  fecha_prestacion text, codigo_area_servicio text, area_servicio text, especialidad text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

create table staging.stg_medicamento_insumo (
  oid_mi text, oid_ingreso text, codigo_servicio text, nombre_servicio text, cantidad text,
  fecha_prestacion text, area_servicio text, especialidad text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

create table staging.stg_programacion_cirugia (
  consecutivo_programacion text, id_paciente text, oid_ingreso text, codigo_servicio text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

-- Plantillas del importador
create table staging.stg_drug_stock (
  item_code text, item_name text, current_stock text, unit text, stock_date text, expiration_date text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

create table staging.stg_bed_inventory (
  bed_code text, bed_name text, bed_group text, bed_subgroup text, is_active text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);

create table staging.stg_surgery_schedule (
  schedule_number text, patient_id text, admission_id text, service_code text,
  scheduled_date text, operating_room text,
  batch_id uuid not null references audit.import_batches(batch_id),
  source_row_number int not null,
  loaded_at timestamptz not null default now(),
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid')),
  primary key (batch_id, source_row_number)
);


-- =============================================================================
-- 7. Core: datos del HIS
-- =============================================================================
create table core.patients (
  patient_id     int primary key,
  document_type  text not null,     -- sensible: nunca en vistas del agente
  birth_date     date not null,
  sex            text not null,
  insurer        text not null,
  regime         text not null,
  department     text not null,
  municipality   text not null,
  zone           text not null,
  batch_id       uuid not null references audit.import_batches(batch_id)
);

create table core.triages (
  triage_id              bigint primary key,
  patient_id             int references core.patients(patient_id),
  triaged_at             timestamp,
  triage_code            text,      -- consultorio y área (24 valores), NO es el nivel
  triage_level           smallint check (triage_level between 1 and 5),   -- S-16
  triage_classification  text,      -- p. ej. 'GINECOLOGIA URGENCIA - TRIAGE 2'
  chief_complaint        text,      -- sensible: nunca en vistas del agente
  blood_pressure         text,
  heart_rate             int,
  respiratory_rate       int,
  temperature            numeric(4,1),
  batch_id               uuid not null references audit.import_batches(batch_id)
);

create table core.admissions (
  admission_id      bigint primary key,
  admission_number  int not null,
  patient_id        int not null references core.patients(patient_id),
  admission_class   text not null,
  admission_route   text not null,
  risk_type         text not null,
  admitted_at       timestamp not null,
  hospitalized_at   timestamp,      -- asignación de cama; también la tienen los ambulatorios (S-05, S-08)
  triage_id         bigint references core.triages(triage_id),   -- NULL si OidTriageA no existe en Triage
  bed_code          text not null,  -- ref. lógica a core.bed_inventory
  bed_name          text not null,
  bed_group         text not null,  -- servicio (S-02), normalizado con core.normalize_service
  bed_subgroup      text not null,  -- subservicio, normalizado con core.normalize_service
  diagnosis_code    text,           -- sensible: solo agregado
  diagnosis_name    text,           -- sensible: solo agregado
  batch_id          uuid not null references audit.import_batches(batch_id)
);

create table core.first_attentions (
  admission_id  bigint primary key references core.admissions(admission_id),
  attended_at   timestamp not null,
  batch_id      uuid not null references audit.import_batches(batch_id)
);

create table core.service_lines (
  service_line_id  bigint primary key,
  admission_id     bigint not null references core.admissions(admission_id),
  service_code     text not null,
  service_name     text not null,
  quantity         int not null,
  provided_at      timestamp not null,
  area_code        text not null,
  area_name        text not null,
  specialty        text not null,
  batch_id         uuid not null references audit.import_batches(batch_id)
);

create table core.drug_dispensations (
  dispensation_id  bigint primary key,
  admission_id     bigint not null references core.admissions(admission_id),
  item_code        text not null,   -- ref. lógica a core.drug_stock
  item_name        text not null,
  quantity         int not null,
  dispensed_at     timestamp not null,
  area_name        text not null,
  specialty        text not null,
  batch_id         uuid not null references audit.import_batches(batch_id)
);

create table core.surgery_schedules (
  surgery_schedule_id  bigint generated always as identity primary key,
  schedule_number      text not null,
  patient_id           int not null,     -- ref. lógica a core.patients (65,6 % sin pareja en el extracto)
  admission_id         bigint,           -- ref. lógica a core.admissions (69,2 % sin pareja en el extracto)
  service_code         text not null,
  scheduled_date       date,
  operating_room       text,
  data_origin          text not null check (data_origin in ('historical','imported')),
  batch_id             uuid not null references audit.import_batches(batch_id),
  -- Idempotencia de la carga (CAR-06) y regla de no sobrescribir en la plantilla.
  -- También sirve como índice por schedule_number (columna inicial).
  unique (schedule_number, service_code)
);


-- =============================================================================
-- 8. Core: tablas complementarias
-- =============================================================================
create table core.bed_inventory (
  bed_code      text primary key,
  bed_name      text not null,
  bed_group     text not null,
  bed_subgroup  text not null,
  is_active     boolean not null default true,
  data_origin   text not null check (data_origin in ('derived','imported','simulated')),
  batch_id      uuid not null references audit.import_batches(batch_id)
);

create table core.drug_stock (
  drug_stock_id    bigint generated always as identity primary key,
  item_code        text not null,
  item_name        text not null,
  stock_date       date not null,
  current_stock    numeric not null check (current_stock >= 0),
  unit             text,
  expiration_date  date,
  data_origin      text not null check (data_origin in ('imported','simulated')),
  batch_id         uuid not null references audit.import_batches(batch_id),
  unique (item_code, stock_date)
);


-- =============================================================================
-- 9. Índices
-- =============================================================================
create index on core.admissions (admitted_at);
create index on core.admissions (hospitalized_at);
create index on core.admissions (patient_id);
create index on core.admissions (bed_group);
create index on core.admissions (triage_id);
create index on core.admissions (bed_code, hospitalized_at);   -- S-07: siguiente asignación de la misma cama
create index on core.triages (triaged_at);
create index on core.service_lines (admission_id, provided_at);
create index on core.service_lines (admission_id, service_code);
create index on core.service_lines (provided_at);
create index on core.drug_dispensations (admission_id, dispensed_at);
create index on core.drug_dispensations (item_code, dispensed_at);
create index on core.drug_dispensations (dispensed_at);
create index on core.surgery_schedules (admission_id, service_code);

create index on core.patients (batch_id);
create index on core.triages (batch_id);
create index on core.admissions (batch_id);
create index on core.first_attentions (batch_id);
create index on core.service_lines (batch_id);
create index on core.drug_dispensations (batch_id);
create index on core.surgery_schedules (batch_id);
create index on core.bed_inventory (batch_id);
create index on core.drug_stock (batch_id);

create index on audit.import_errors (batch_id, row_number);
create index on audit.import_batches (imported_at desc);
create index on audit.query_log (user_id, asked_at);
create index on audit.user_admin_log (target_user_id, created_at);


-- =============================================================================
-- 10. Vistas materializadas
-- Se refrescan con REFRESH ... CONCURRENTLY, que exige un índice único en cada una.
-- =============================================================================

-- S-07: egreso estimado = la menor fecha entre la última prestación del ingreso
-- y la siguiente asignación de la misma cama, nunca antes de la propia asignación.
-- Incluye todo ingreso con cama asignada (S-08), no solo los hospitalarios.
create materialized view core.mv_admission_stay as
with last_service as (
  select admission_id, max(provided_at) as last_at
  from core.service_lines group by admission_id
), last_drug as (
  select admission_id, max(dispensed_at) as last_at
  from core.drug_dispensations group by admission_id
), assignments as (
  select a.admission_id, a.bed_code, a.bed_group, a.bed_subgroup, a.hospitalized_at,
        lead(a.hospitalized_at) over (partition by a.bed_code
                                      order by a.hospitalized_at, a.admission_id) as next_assignment_at
  from core.admissions a
  where a.hospitalized_at is not null
), stay as (
  select s.admission_id, s.bed_code, s.bed_group, s.bed_subgroup, s.hospitalized_at,
        -- Sin ninguna prestación, el egreso es la propia asignación (estancia 0).
        -- Sin este caso, LEAST ignoraría el NULL y tomaría la siguiente asignación.
        case when greatest(ls.last_at, ld.last_at) is null then s.hospitalized_at
              else greatest(s.hospitalized_at,
                            least(greatest(ls.last_at, ld.last_at), s.next_assignment_at))
        end as estimated_discharge_at
  from assignments s
  left join last_service ls on ls.admission_id = s.admission_id
  left join last_drug ld on ld.admission_id = s.admission_id
)
select admission_id, bed_code, bed_group, bed_subgroup, hospitalized_at, estimated_discharge_at,
      round((extract(epoch from (estimated_discharge_at - hospitalized_at)) / 86400.0)::numeric, 2) as stay_days
from stay;

create unique index on core.mv_admission_stay (admission_id);

-- S-08: ocupación por día y servicio. Incluye días con 0 camas ocupadas.
create materialized view core.mv_bed_occupancy_daily as
with bounds as (
  select min(hospitalized_at)::date as d0, max(estimated_discharge_at)::date as d1
  from core.mv_admission_stay
), days as (
  select generate_series(d0, d1, interval '1 day')::date as day
  from bounds where d0 is not null
), capacity as (
  select bed_group, bed_subgroup, count(*) filter (where is_active) as capacity
  from core.bed_inventory group by bed_group, bed_subgroup
), occupied as (
  select g.day::date as day, s.bed_group, s.bed_subgroup, count(distinct s.bed_code) as occupied_beds
  from core.mv_admission_stay s
  cross join lateral generate_series(s.hospitalized_at::date, s.estimated_discharge_at::date, interval '1 day') as g(day)
  group by 1, 2, 3
), keys as (
  select bed_group, bed_subgroup from capacity
  union
  select distinct bed_group, bed_subgroup from core.mv_admission_stay
)
select d.day, k.bed_group, k.bed_subgroup,
      coalesce(o.occupied_beds, 0)::int as occupied_beds,
      coalesce(c.capacity, 0)::int as capacity,
      case when coalesce(c.capacity, 0) > 0
            then round(100.0 * coalesce(o.occupied_beds, 0) / c.capacity, 1) end as occupancy_pct
from days d
cross join keys k
left join occupied o on o.day = d.day and o.bed_group = k.bed_group and o.bed_subgroup = k.bed_subgroup
left join capacity c on c.bed_group = k.bed_group and c.bed_subgroup = k.bed_subgroup;

create unique index on core.mv_bed_occupancy_daily (day, bed_group, bed_subgroup);

-- S-15: un ítem es dispositivo si más de la mitad de sus dispensaciones viene
-- de áreas cuyo nombre contiene "DISPOS"; si no, es medicamento.
create materialized view core.mv_item_catalog as
with stats as (
  select item_code,
        count(*)::int as dispensation_rows,
        count(*) filter (where upper(area_name) like '%DISPOS%') as device_rows
  from core.drug_dispensations
  group by item_code
), latest_name as (
  select distinct on (item_code) item_code, item_name
  from core.drug_dispensations
  order by item_code, dispensed_at desc, dispensation_id desc
)
select s.item_code, n.item_name,
       case when s.device_rows * 2 > s.dispensation_rows then 'dispositivo' else 'medicamento' end as item_type,
      s.dispensation_rows
from stats s
join latest_name n on n.item_code = s.item_code;

create unique index on core.mv_item_catalog (item_code);


-- =============================================================================
-- 11. Esquema agent: función de fecha y vistas anonimizadas
-- Vistas sin security_invoker: agent_ro las lee sin permisos sobre core.
-- Ninguna expone triage_code, nombre, documento, motivo de consulta, fecha de
-- nacimiento, id real del paciente ni diagnóstico individual (SEG-03).
-- Las fechas relativas usan agent.reference_date(), nunca CURRENT_DATE.
-- =============================================================================

-- CAR-08: "hoy" para vistas, consultas fijas y SQL del LLM.
-- SECURITY DEFINER: agent_ro puede ejecutarla sin leer core.app_settings.
create or replace function agent.reference_date() returns date
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select reference_date from core.app_settings where id
$$;
comment on function agent.reference_date() is
  'Fecha que el sistema considera "hoy". Usar en lugar de CURRENT_DATE para hoy, esta semana o este mes.';

create view agent.v_admissions as
select a.admission_id,
      left(encode(sha256(convert_to(s.pseudonym_salt || ':pat:' || a.patient_id, 'UTF8')), 'hex'), 16) as patient_key,
      a.admission_class, a.admission_route, a.admitted_at, a.hospitalized_at,
      st.estimated_discharge_at,
      a.bed_group as service, a.bed_subgroup as subservice,
      t.triage_level,
      case when ag.years is null then 'Sin dato'
            when ag.years < 5  then '0-4'
            when ag.years < 18 then '5-17'
            when ag.years < 30 then '18-29'
            when ag.years < 45 then '30-44'
            when ag.years < 60 then '45-59'
            when ag.years < 75 then '60-74'
            else '75+' end as age_group,
      p.sex, p.regime, p.zone
from core.admissions a
join core.patients p on p.patient_id = a.patient_id
left join core.triages t on t.triage_id = a.triage_id
left join core.mv_admission_stay st on st.admission_id = a.admission_id
cross join core.app_settings s
cross join lateral (select extract(year from age(s.reference_date, p.birth_date))::int as years) ag;
comment on view agent.v_admissions is
  'Un registro por ingreso. Pacientes ingresados (S-05): admission_class = ''Hospitalario''; contar con COUNT(DISTINCT patient_key). '
  'hospitalized_at es la asignación de cama y NO indica hospitalización. age_group se calcula a agent.reference_date().';

create view agent.v_bed_occupancy as
select o.day, o.bed_group as service, o.bed_subgroup as subservice,
      o.occupied_beds, o.capacity, o.occupancy_pct,
      coalesce(ci.is_estimated, true) as is_capacity_simulated
from core.mv_bed_occupancy_daily o
left join (
  select bed_group, bed_subgroup, bool_or(data_origin <> 'imported') as is_estimated
  from core.bed_inventory group by bed_group, bed_subgroup
) ci on ci.bed_group = o.bed_group and ci.bed_subgroup = o.bed_subgroup;
comment on view agent.v_bed_occupancy is
  'Camas ocupadas por día y servicio. UCI: service = ''UNIDAD DE CUIDADO INTENSIVO''. '
  'is_capacity_simulated = true si la capacidad es derivada del histórico o simulada.';

create view agent.v_emergency_wait_times as
with base as (
  select a.admission_id, a.admitted_at, t.triaged_at, f.attended_at,
        coalesce(t.triaged_at, a.admitted_at) as start_at,        -- S-06: sin triage, desde el ingreso
        t.triage_level, t.triage_classification
  from core.admissions a
  join core.first_attentions f on f.admission_id = a.admission_id
  left join core.triages t on t.triage_id = a.triage_id
  where a.admission_route = 'Urgencias'                             -- S-04
)
select b.admission_id, b.admitted_at, b.triaged_at, b.attended_at,
      round((extract(epoch from (b.attended_at - b.start_at)) / 60.0)::numeric, 1) as wait_minutes,
      b.triage_level, b.triage_classification,
      case when extract(hour from b.start_at) between 7 and 18 then 'dia' else 'noche' end as shift,
      extract(isodow from b.start_at)::int as weekday,
      extract(hour from b.start_at)::int as hour
from base b
where b.attended_at >= b.start_at
  and b.attended_at <= b.start_at + interval '1440 minutes';       -- S-06
comment on view agent.v_emergency_wait_times is
  'Ingresos por urgencias con espera en minutos (0 a 1440), desde el triage o, si no hay, desde el ingreso. '
  'Filtrar periodos por admitted_at. shift: dia (7:00-18:59) o noche; weekday: 1 lunes a 7 domingo; hour de la llegada.';

create view agent.v_drug_inventory as
with latest as (
  select distinct on (item_code) item_code, item_name, current_stock, stock_date, data_origin
  from core.drug_stock
  order by item_code, stock_date desc
), consumption as (                                                 -- S-10
  select d.item_code, sum(d.quantity) / 30.0 as avg_daily
  from core.drug_dispensations d
  cross join (select agent.reference_date() as ref) r
  where d.dispensed_at >= r.ref - 29
    and d.dispensed_at <  r.ref + 1
  group by d.item_code
)
select l.item_code, l.item_name, ic.item_type, l.current_stock,
      round(coalesce(c.avg_daily, 0), 2) as avg_daily_consumption,
      case when coalesce(c.avg_daily, 0) > 0 then round(l.current_stock / c.avg_daily, 1) end as days_of_inventory,
      l.stock_date,
      (l.data_origin = 'simulated') as is_simulated
from latest l
left join consumption c on c.item_code = l.item_code
left join core.mv_item_catalog ic on ic.item_code = l.item_code;
comment on view agent.v_drug_inventory is
  'Foto más reciente de inventario por ítem. Para medicamentos: item_type = ''medicamento''. '
  'avg_daily_consumption = consumo de los 30 días hasta agent.reference_date() / 30. days_of_inventory NULL = sin consumo.';

create view agent.v_drug_consumption_daily as
select d.dispensed_at::date as day, d.item_code, d.item_name, ic.item_type, d.area_name, d.specialty,
      sum(d.quantity)::int as total_quantity
from core.drug_dispensations d
left join core.mv_item_catalog ic on ic.item_code = d.item_code
group by 1, 2, 3, 4, 5, 6;

create view agent.v_service_demand_daily as
select provided_at::date as day, area_name, specialty, service_code, service_name,
      count(*)::int as lines_count, sum(quantity)::int as total_quantity
from core.service_lines
group by 1, 2, 3, 4, 5;

-- S-11: una fila por programación, solo las que tienen ingreso en el extracto.
create view agent.v_surgeries as
select s.schedule_number,
      date_trunc('month', min(coalesce(s.scheduled_date::timestamp, a.admitted_at)))::date as scheduled_month,
      bool_or(exists (select 1 from core.service_lines l
      where l.admission_id = s.admission_id
      and l.service_code = s.service_code)) as is_performed,
      min(s.data_origin) as data_origin     -- 'historical' si la programación mezcla orígenes
from core.surgery_schedules s
join core.admissions a on a.admission_id = s.admission_id
group by s.schedule_number;
comment on view agent.v_surgeries is
  'Una fila por programación quirúrgica con ingreso en el extracto. scheduled_month: fecha programada o mes del ingreso. '
  'is_performed: al menos un servicio de la programación aparece prestado en ese ingreso.';

create view agent.v_diagnosis_monthly as
select date_trunc('month', admitted_at)::date as month, bed_group as service,
      diagnosis_code, diagnosis_name, count(*)::int as admissions_count
from core.admissions
where diagnosis_code is not null
group by 1, 2, 3, 4
having count(*) >= 5;
comment on view agent.v_diagnosis_monthly is
  'Diagnósticos agregados por mes y servicio. Solo grupos de 5 o más ingresos.';


-- =============================================================================
-- 12. Validación, carga y reversión de lotes
-- =============================================================================

-- Marca cada fila del lote como valid o invalid según audit.import_errors.
create or replace function core._mark_staging_rows(p_table regclass, p_batch_id uuid) returns void
language plpgsql as $$
begin
  execute format($f$
    update %s r
    set validation_status = case when exists (
          select 1 from audit.import_errors e
          where e.batch_id = $1 and e.row_number = r.source_row_number)
        then 'invalid' else 'valid' end
    where r.batch_id = $1 $f$, p_table)
  using p_batch_id;
end $$;

-- Valida el lote en SQL (autoridad final) y devuelve la tabla staging usada.
-- Las reglas viven aquí; el navegador solo revisa estructura, tamaño y fórmulas (SEG-11).
create or replace function core._validate_batch(b audit.import_batches) returns regclass
language plpgsql as $$
declare
  v uuid := b.batch_id;
  t regclass;
begin
  delete from audit.import_errors where batch_id = v;

  if b.target_table = 'drug_stock' then
    t := 'staging.stg_drug_stock';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_drug_stock r
    cross join lateral (values
      ('item_code',       case when core.clean_text(r.item_code) is null then 'Campo obligatorio vacío.' end),
      ('item_name',       case when core.clean_text(r.item_name) is null then 'Campo obligatorio vacío.' end),
      ('current_stock',   case when core.try_numeric(r.current_stock) is null then 'Debe ser un número (sin separador de miles).'
                              when core.try_numeric(r.current_stock) < 0 then 'No puede ser negativo.' end),
      ('stock_date',      case when core.try_date(r.stock_date) is null then 'Fecha inválida. Use AAAA-MM-DD o DD/MM/AAAA.' end),
      ('expiration_date', case when core.clean_text(r.expiration_date) is not null and core.try_date(r.expiration_date) is null
                              then 'Fecha inválida. Use AAAA-MM-DD o DD/MM/AAAA.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, x.source_row_number, 'item_code', 'Medicamento repetido en el archivo para la misma fecha de foto.'
    from (select source_row_number,
                count(*) over (partition by core.clean_text(item_code), core.try_date(stock_date)) as n
          from staging.stg_drug_stock
          where batch_id = v and core.clean_text(item_code) is not null and core.try_date(stock_date) is not null) x
    where x.n > 1;

    -- SEG-12: una foto con fecha ya existente rechaza el lote completo.
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, 'stock_date',
          format('Ya existe una foto de inventario del %s para este medicamento. No se sobrescriben datos.',
                  to_char(d.stock_date, 'YYYY-MM-DD'))
    from staging.stg_drug_stock r
    join core.drug_stock d on d.item_code = core.clean_text(r.item_code) and d.stock_date = core.try_date(r.stock_date)
    where r.batch_id = v;

  elsif b.target_table = 'bed_inventory' then
    t := 'staging.stg_bed_inventory';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_bed_inventory r
    cross join lateral (values
      ('bed_code',     case when core.clean_text(r.bed_code) is null then 'Campo obligatorio vacío.' end),
      ('bed_name',     case when core.clean_text(r.bed_name) is null then 'Campo obligatorio vacío.' end),
      ('bed_group',    case when core.clean_text(r.bed_group) is null then 'Campo obligatorio vacío.' end),
      ('bed_subgroup', case when core.clean_text(r.bed_subgroup) is null then 'Campo obligatorio vacío.' end),
      ('is_active',    case when core.try_bool(r.is_active) is null then 'Use Sí o No.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, x.source_row_number, 'bed_code', 'Cama repetida en el archivo.'
    from (select source_row_number, count(*) over (partition by core.clean_text(bed_code)) as n
          from staging.stg_bed_inventory
          where batch_id = v and core.clean_text(bed_code) is not null) x
    where x.n > 1;

    -- Solo reemplaza camas derivadas o simuladas; una cama ya importada no se sobrescribe.
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, 'bed_code', 'Esta cama ya fue importada en un lote anterior. No se sobrescriben datos.'
    from staging.stg_bed_inventory r
    join core.bed_inventory bi on bi.bed_code = core.clean_text(r.bed_code) and bi.data_origin = 'imported'
    where r.batch_id = v;

  elsif b.target_table = 'surgery_schedules' and b.load_type = 'ui_import' then
    t := 'staging.stg_surgery_schedule';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_surgery_schedule r
    cross join lateral (values
      ('schedule_number', case when core.clean_text(r.schedule_number) is null then 'Campo obligatorio vacío.' end),
      -- patient_id y admission_id son referencias lógicas: se valida el formato, no la existencia.
      ('patient_id',      case when core.try_int(r.patient_id) is null then 'Debe ser un número entero.' end),
      ('admission_id',    case when core.clean_text(r.admission_id) is not null and core.try_int(r.admission_id) is null
                              then 'Debe ser un número entero.' end),
      ('service_code',    case when core.clean_text(r.service_code) is null then 'Campo obligatorio vacío.' end),
      ('scheduled_date',  case when core.try_date(r.scheduled_date) is null then 'Fecha inválida. Use AAAA-MM-DD o DD/MM/AAAA.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, x.source_row_number, 'service_code', 'Servicio repetido en el archivo para la misma programación.'
    from (select source_row_number,
                count(*) over (partition by core.clean_text(schedule_number), core.clean_text(service_code)) as n
          from staging.stg_surgery_schedule
          where batch_id = v and core.clean_text(schedule_number) is not null) x
    where x.n > 1;

    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, 'schedule_number', 'Esta programación y servicio ya existen. No se sobrescriben datos.'
    from staging.stg_surgery_schedule r
    join core.surgery_schedules s on s.schedule_number = core.clean_text(r.schedule_number)
                                and s.service_code = core.clean_text(r.service_code)
    where r.batch_id = v;

  -- ---- Tablas del HIS (carga histórica o semilla): se validan campos clave ----
  elsif b.target_table = 'patients' then
    t := 'staging.stg_paciente';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_paciente r
    cross join lateral (values
      ('id_paciente',      case when core.try_int(r.id_paciente) is null then 'Id de paciente inválido.' end),
      ('fecha_nacimiento', case when core.try_date(r.fecha_nacimiento) is null then 'Fecha inválida.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

  elsif b.target_table = 'triages' then
    t := 'staging.stg_triage';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, 'oid_triage', 'Triage sin identificador (OidTriage nulo o inválido).'
    from staging.stg_triage r
    where r.batch_id = v and core.try_int(r.oid_triage) is null;

  elsif b.target_table = 'admissions' then
    t := 'staging.stg_ingresos';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_ingresos r
    cross join lateral (values
      ('oid_ingreso',         case when core.try_int(r.oid_ingreso) is null then 'Id de ingreso inválido.' end),
      ('consecutivo_ingreso', case when core.try_int(r.consecutivo_ingreso) is null then 'Consecutivo inválido.' end),
      ('id_paciente',         case when core.try_int(r.id_paciente) is null then 'Id de paciente inválido.'
                                  when not exists (select 1 from core.patients p where p.patient_id = core.try_int(r.id_paciente))
                                  then 'El paciente no existe en core.patients.' end),
      ('fecha_ingreso',       case when core.try_timestamp(r.fecha_ingreso) is null then 'Fecha inválida.' end),
      ('codigo_cama',         case when core.clean_text(r.codigo_cama) is null then 'Campo obligatorio vacío.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

  elsif b.target_table = 'first_attentions' then
    t := 'staging.stg_atencion';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_atencion r
    cross join lateral (values
      ('oid_ingreso',    case when core.try_int(r.oid_ingreso) is null then 'Id de ingreso inválido.'
                              when not exists (select 1 from core.admissions a where a.admission_id = core.try_int(r.oid_ingreso))
                              then 'El ingreso no existe en core.admissions.' end),
      ('fecha_atencion', case when core.try_timestamp(r.fecha_atencion) is null then 'Fecha inválida.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

  elsif b.target_table = 'service_lines' then
    t := 'staging.stg_servicios';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_servicios r
    cross join lateral (values
      ('oid_s',            case when core.try_int(r.oid_s) is null then 'Id inválido.' end),
      ('oid_ingreso',      case when core.try_int(r.oid_ingreso) is null then 'Id de ingreso inválido.'
                                when not exists (select 1 from core.admissions a where a.admission_id = core.try_int(r.oid_ingreso))
                                then 'El ingreso no existe en core.admissions.' end),
      ('codigo_servicio',  case when core.clean_text(r.codigo_servicio) is null then 'Campo obligatorio vacío.' end),
      ('cantidad',         case when core.try_int(r.cantidad) is null then 'Cantidad inválida.' end),
      ('fecha_prestacion', case when core.try_timestamp(r.fecha_prestacion) is null then 'Fecha inválida.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

  elsif b.target_table = 'drug_dispensations' then
    t := 'staging.stg_medicamento_insumo';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_medicamento_insumo r
    cross join lateral (values
      ('oid_mi',           case when core.try_int(r.oid_mi) is null then 'Id inválido.' end),
      ('oid_ingreso',      case when core.try_int(r.oid_ingreso) is null then 'Id de ingreso inválido.'
                                when not exists (select 1 from core.admissions a where a.admission_id = core.try_int(r.oid_ingreso))
                                then 'El ingreso no existe en core.admissions.' end),
      ('codigo_servicio',  case when core.clean_text(r.codigo_servicio) is null then 'Campo obligatorio vacío.' end),
      ('cantidad',         case when core.try_int(r.cantidad) is null then 'Cantidad inválida.' end),
      ('fecha_prestacion', case when core.try_timestamp(r.fecha_prestacion) is null then 'Fecha inválida.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

  elsif b.target_table = 'surgery_schedules' then
    t := 'staging.stg_programacion_cirugia';
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, e.col, e.msg
    from staging.stg_programacion_cirugia r
    cross join lateral (values
      ('consecutivo_programacion', case when core.clean_text(r.consecutivo_programacion) is null then 'Campo obligatorio vacío.' end),
      ('id_paciente',             case when core.try_int(r.id_paciente) is null then 'Id de paciente inválido.' end),
      ('oid_ingreso',             case when core.clean_text(r.oid_ingreso) is not null and core.try_int(r.oid_ingreso) is null
                                      then 'Id de ingreso inválido.' end),
      ('codigo_servicio',         case when core.clean_text(r.codigo_servicio) is null then 'Campo obligatorio vacío.' end)
    ) as e(col, msg)
    where r.batch_id = v and e.msg is not null;

  else
    raise exception 'Tabla de destino no soportada: % (%)', b.target_table, b.load_type;
  end if;

  perform core._mark_staging_rows(t, v);
  return t;
end $$;

-- Inserta en core las filas válidas del lote y devuelve cuántas cargó.
-- ON CONFLICT DO NOTHING hace idempotente la carga histórica (CAR-06).
create or replace function core._load_batch(b audit.import_batches) returns int
language plpgsql as $$
declare
  v uuid := b.batch_id;
  n int := 0;
begin
  if b.target_table = 'drug_stock' then
    insert into core.drug_stock (item_code, item_name, stock_date, current_stock, unit, expiration_date, data_origin, batch_id)
    select core.clean_text(item_code), core.clean_text(item_name), core.try_date(stock_date),
          core.try_numeric(current_stock), core.clean_text(unit), core.try_date(expiration_date),
          case when b.is_simulated then 'simulated' else 'imported' end, v
    from staging.stg_drug_stock where batch_id = v and validation_status = 'valid';

  elsif b.target_table = 'bed_inventory' then
    insert into core.bed_inventory as bi (bed_code, bed_name, bed_group, bed_subgroup, is_active, data_origin, batch_id)
    select core.clean_text(bed_code), core.clean_text(bed_name), core.normalize_service(bed_group),
          core.normalize_service(bed_subgroup), core.try_bool(is_active),
          case when b.is_simulated then 'simulated' else 'imported' end, v
    from staging.stg_bed_inventory where batch_id = v and validation_status = 'valid'
    on conflict (bed_code) do update
      set bed_name = excluded.bed_name, bed_group = excluded.bed_group, bed_subgroup = excluded.bed_subgroup,
          is_active = excluded.is_active, data_origin = excluded.data_origin, batch_id = excluded.batch_id
      where bi.data_origin <> 'imported';

  elsif b.target_table = 'surgery_schedules' and b.load_type = 'ui_import' then
    insert into core.surgery_schedules (schedule_number, patient_id, admission_id, service_code, scheduled_date, operating_room, data_origin, batch_id)
    select core.clean_text(schedule_number), core.try_int(patient_id)::int, core.try_int(admission_id),
          core.clean_text(service_code), core.try_date(scheduled_date), core.clean_text(operating_room), 'imported', v
    from staging.stg_surgery_schedule where batch_id = v and validation_status = 'valid';

  elsif b.target_table = 'patients' then
    insert into core.patients (patient_id, document_type, birth_date, sex, insurer, regime, department, municipality, zone, batch_id)
    select core.try_int(id_paciente)::int,
          coalesce(core.clean_text(tipo_documento), 'Sin dato'), core.try_date(fecha_nacimiento),
          coalesce(core.clean_text(sexo), 'Sin dato'), coalesce(core.clean_text(asegurador), 'Sin dato'),
          coalesce(core.clean_text(regimen), 'Sin dato'), coalesce(core.clean_text(departamento), 'Sin dato'),
          coalesce(core.clean_text(municipio), 'Sin dato'), coalesce(core.clean_text(zona), 'Sin dato'), v
    from staging.stg_paciente where batch_id = v and validation_status = 'valid'
    on conflict (patient_id) do nothing;

  elsif b.target_table = 'triages' then
    insert into core.triages (triage_id, patient_id, triaged_at, triage_code, triage_level, triage_classification,
                              chief_complaint, blood_pressure, heart_rate, respiratory_rate, temperature, batch_id)
    select core.try_int(r.oid_triage), p.patient_id, core.try_timestamp(r.fecha_triage),
          core.clean_text(r.codigo_triage), core.parse_triage_level(r.clasificacion_triage),
          core.clean_text(r.clasificacion_triage), core.clean_text(r.motivo_consulta),
          core.clean_text(r.tension_arterial), core.try_int(r.frecuencia_cardiaca)::int,
          core.try_int(r.frecuencia_respiratoria)::int,
          case when core.try_numeric(r.temperatura) between 25 and 45 then round(core.try_numeric(r.temperatura), 1) end,
          v
    from staging.stg_triage r
    left join core.patients p on p.patient_id = core.try_int(r.id_paciente2)
    where r.batch_id = v and r.validation_status = 'valid'
    on conflict (triage_id) do nothing;

  elsif b.target_table = 'admissions' then
    insert into core.admissions (admission_id, admission_number, patient_id, admission_class, admission_route, risk_type,
                                admitted_at, hospitalized_at, triage_id, bed_code, bed_name, bed_group, bed_subgroup,
                                diagnosis_code, diagnosis_name, batch_id)
    select core.try_int(r.oid_ingreso), core.try_int(r.consecutivo_ingreso)::int, core.try_int(r.id_paciente)::int,
          coalesce(core.clean_text(r.clase_ingreso), 'Sin dato'), coalesce(core.clean_text(r.via_ingreso), 'Sin dato'),
          coalesce(core.clean_text(r.tipo_riesgo), 'Sin dato'),
          core.try_timestamp(r.fecha_ingreso), core.try_timestamp(r.fecha_hospitalizacion),
          t.triage_id,
          core.clean_text(r.codigo_cama), coalesce(core.clean_text(r.nombre_cama), 'Sin dato'),
          coalesce(core.normalize_service(r.nombre_grupo_cama), 'SIN DATO'),
          coalesce(core.normalize_service(r.nombre_subgrupo_cama), 'SIN DATO'),
          core.clean_text(r.codigo_diagnostico), core.clean_text(r.nombre_diagnostico), v
    from staging.stg_ingresos r
    left join core.triages t on t.triage_id = core.try_int(r.oid_triage_a)
    where r.batch_id = v and r.validation_status = 'valid'
    on conflict (admission_id) do nothing;
    get diagnostics n = row_count;

    -- Aviso para el reporte de carga (CAR-05): la fila SÍ se cargó, sin triage.
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    select v, r.source_row_number, 'oid_triage_a',
          'Aviso: el triage no existe en el extracto; el ingreso se cargó sin triage.'
    from staging.stg_ingresos r
    where r.batch_id = v and r.validation_status = 'valid'
      and core.try_int(r.oid_triage_a) is not null
      and not exists (select 1 from core.triages t where t.triage_id = core.try_int(r.oid_triage_a));
    return n;

  elsif b.target_table = 'first_attentions' then
    insert into core.first_attentions (admission_id, attended_at, batch_id)
    select distinct on (core.try_int(oid_ingreso)) core.try_int(oid_ingreso), core.try_timestamp(fecha_atencion), v
    from staging.stg_atencion where batch_id = v and validation_status = 'valid'
    order by core.try_int(oid_ingreso), core.try_timestamp(fecha_atencion)
    on conflict (admission_id) do nothing;

  elsif b.target_table = 'service_lines' then
    insert into core.service_lines (service_line_id, admission_id, service_code, service_name, quantity, provided_at,
                                    area_code, area_name, specialty, batch_id)
    select core.try_int(oid_s), core.try_int(oid_ingreso), core.clean_text(codigo_servicio),
          coalesce(core.clean_text(nombre_servicio), 'Sin dato'), core.try_int(cantidad)::int,
          core.try_timestamp(fecha_prestacion), coalesce(core.clean_text(codigo_area_servicio), 'Sin dato'),
          coalesce(core.clean_text(area_servicio), 'Sin dato'), coalesce(core.clean_text(especialidad), 'Sin dato'), v
    from staging.stg_servicios where batch_id = v and validation_status = 'valid'
    on conflict (service_line_id) do nothing;

  elsif b.target_table = 'drug_dispensations' then
    insert into core.drug_dispensations (dispensation_id, admission_id, item_code, item_name, quantity, dispensed_at,
                                        area_name, specialty, batch_id)
    select core.try_int(oid_mi), core.try_int(oid_ingreso), core.clean_text(codigo_servicio),
          coalesce(core.clean_text(nombre_servicio), 'Sin dato'), core.try_int(cantidad)::int,
          core.try_timestamp(fecha_prestacion), coalesce(core.clean_text(area_servicio), 'Sin dato'),
          coalesce(core.clean_text(especialidad), 'Sin dato'), v
    from staging.stg_medicamento_insumo where batch_id = v and validation_status = 'valid'
    on conflict (dispensation_id) do nothing;

  elsif b.target_table = 'surgery_schedules' then
    insert into core.surgery_schedules (schedule_number, patient_id, admission_id, service_code, data_origin, batch_id)
    select core.clean_text(r.consecutivo_programacion), core.try_int(r.id_paciente)::int, core.try_int(r.oid_ingreso),
          core.clean_text(r.codigo_servicio), 'historical', v
    from staging.stg_programacion_cirugia r
    where r.batch_id = v and r.validation_status = 'valid'
    on conflict (schedule_number, service_code) do nothing;
  end if;

  get diagnostics n = row_count;
  return n;
end $$;

-- Refresca las vistas materializadas en orden de dependencia.
create or replace function core.refresh_materialized_views() returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  refresh materialized view concurrently core.mv_admission_stay;
  refresh materialized view concurrently core.mv_bed_occupancy_daily;
  refresh materialized view concurrently core.mv_item_catalog;
end $$;

-- Cierre de la carga histórica (CAR-07, CAR-08). La llama el script al final,
-- después de comparar filas leídas contra el origen (Triage: 17.781):
-- escribe la fecha de referencia, vacía las 7 tablas del HIS en staging,
-- refresca las vistas materializadas y devuelve el tamaño de la base.
-- Las tablas de staging de las plantillas no se tocan.
create or replace function core.finish_historical_load(p_reference_date date) returns text
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_reference_date is null then
    raise exception 'Se requiere la fecha de referencia (REFERENCE_DATE).' using errcode = '22004';
  end if;
  if exists (select 1 from audit.import_batches
            where load_type = 'historical' and status in ('pending', 'validated')) then
    raise exception 'Hay lotes históricos sin aplicar; no se vacía staging.' using errcode = '55000';
  end if;

  update core.app_settings set reference_date = p_reference_date, updated_at = now() where id;

  truncate staging.stg_paciente, staging.stg_ingresos, staging.stg_triage, staging.stg_atencion,
          staging.stg_servicios, staging.stg_medicamento_insumo, staging.stg_programacion_cirugia;

  perform core.refresh_materialized_views();
  return pg_size_pretty(pg_database_size(current_database()));
end $$;

-- Aplica un lote de staging a core (IMP-05).
--   ui_import y seed_synthetic: todo o nada. Una fila inválida => lote 'rejected' sin tocar core.
--   historical: tolerante. Carga las filas válidas y registra las descartadas con
--   su motivo en audit.import_errors (CAR-02, CAR-05); p. ej., los 1.667 triages sin OidTriage.
-- Staging no se borra aquí: las plantillas se conservan para trazar importaciones y
-- el staging del HIS lo vacía core.finish_historical_load (CAR-07).
-- El rol importer solo puede aplicar lotes ui_import.
create or replace function core.apply_batch(p_batch_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  b audit.import_batches%rowtype;
  v_stg regclass;
  v_read int;
  v_invalid int;
  v_loaded int;
begin
  select * into b from audit.import_batches where batch_id = p_batch_id for update;
  if not found then
    raise exception 'El lote % no existe.', p_batch_id using errcode = 'P0002';
  end if;
  if session_user = 'importer' and b.load_type <> 'ui_import' then
    raise exception 'El rol importer solo puede aplicar lotes de importación desde la interfaz.' using errcode = '42501';
  end if;
  if b.status not in ('pending', 'validated') then
    raise exception 'El lote % está en estado % y no se puede aplicar.', p_batch_id, b.status using errcode = '55000';
  end if;
  if b.target_table = 'bed_inventory' and b.load_type = 'historical' then
    raise exception 'Las camas del histórico se derivan con core.derive_bed_inventory.' using errcode = '22023';
  end if;

  -- Evita dos aplicaciones simultáneas sobre la misma tabla (p. ej., dos fotos de inventario).
  perform pg_advisory_xact_lock(hashtext('core.apply_batch:' || b.target_table));

  v_stg := core._validate_batch(b);
  execute format('select count(*), count(*) filter (where validation_status = ''invalid'') from %s where batch_id = $1', v_stg)
    into v_read, v_invalid using p_batch_id;

  if v_read = 0 then
    insert into audit.import_errors (batch_id, row_number, column_name, error_message)
    values (p_batch_id, 0, null, 'El archivo no tiene filas.');
  end if;

  if v_read = 0 or (b.load_type <> 'historical' and v_invalid > 0) then
    update audit.import_batches
    set status = 'rejected', rows_read = v_read, rows_loaded = 0, rows_rejected = v_invalid
    where batch_id = p_batch_id;
    return 'rejected';
  end if;

  v_loaded := core._load_batch(b);

  -- IMP-07: de las importaciones, solo el inventario de camas cambia una vista
  -- materializada. drug_stock alimenta una vista normal. La carga histórica
  -- refresca todo una sola vez en core.finish_historical_load.
  if b.target_table = 'bed_inventory' then
    refresh materialized view concurrently core.mv_bed_occupancy_daily;
  end if;

  update audit.import_batches
  set status = 'applied', rows_read = v_read, rows_loaded = v_loaded, rows_rejected = v_read - v_loaded
  where batch_id = p_batch_id;
  return 'applied';
end $$;

-- Capacidad por defecto (S-09): camas vistas en ingresos hospitalizados.
-- No pisa camas existentes. p_batch_id: lote 'historical' con target_table 'bed_inventory'.
create or replace function core.derive_bed_inventory(p_batch_id uuid) returns int
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  n int;
begin
  if not exists (select 1 from audit.import_batches
                 where batch_id = p_batch_id and load_type = 'historical' and target_table = 'bed_inventory') then
    raise exception 'Se requiere un lote historical con target_table bed_inventory.' using errcode = '22023';
  end if;

  insert into core.bed_inventory (bed_code, bed_name, bed_group, bed_subgroup, is_active, data_origin, batch_id)
  select distinct on (a.bed_code) a.bed_code, a.bed_name, a.bed_group, a.bed_subgroup, true, 'derived', p_batch_id
  from core.admissions a
  where a.hospitalized_at is not null
  order by a.bed_code, a.admitted_at desc
  on conflict (bed_code) do nothing;
  get diagnostics n = row_count;

  update audit.import_batches
  set status = 'applied', rows_read = n, rows_loaded = n, rows_rejected = 0
  where batch_id = p_batch_id and status in ('pending', 'applied');
  return n;
end $$;

-- IMP-08: revierte un lote ui_import aplicado. Solo un admin activo.
create or replace function core.revert_batch(p_batch_id uuid, p_actor_user_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  b audit.import_batches%rowtype;
  v_derive_batch uuid;
begin
  if not exists (select 1 from core.user_profiles
                where user_id = p_actor_user_id and role = 'admin' and is_active) then
    raise exception 'Solo un administrador activo puede revertir lotes.' using errcode = '42501';
  end if;

  select * into b from audit.import_batches where batch_id = p_batch_id for update;
  if not found then
    raise exception 'El lote % no existe.', p_batch_id using errcode = 'P0002';
  end if;
  if b.load_type <> 'ui_import' or b.status <> 'applied' then
    raise exception 'Solo se revierten importaciones de la interfaz en estado applied.' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtext('core.apply_batch:' || b.target_table));

  if b.target_table = 'drug_stock' then
    delete from core.drug_stock where batch_id = p_batch_id;          -- vuelve a regir la foto anterior
  elsif b.target_table = 'surgery_schedules' then
    delete from core.surgery_schedules where batch_id = p_batch_id;
  elsif b.target_table = 'bed_inventory' then
    delete from core.bed_inventory where batch_id = p_batch_id;
    select batch_id into v_derive_batch from audit.import_batches
    where load_type = 'historical' and target_table = 'bed_inventory' and status = 'applied'
    order by imported_at desc limit 1;
    if v_derive_batch is not null then
      perform core.derive_bed_inventory(v_derive_batch);             -- recupera la capacidad derivada
    end if;
    refresh materialized view concurrently core.mv_bed_occupancy_daily;
  end if;

  update audit.import_batches
  set status = 'reverted', reverted_by_user_id = p_actor_user_id, reverted_at = now()
  where batch_id = p_batch_id;
end $$;


-- =============================================================================
-- 13. Permisos
-- =============================================================================

-- Las funciones nacen ejecutables por PUBLIC: se cierra todo y se abre lo necesario.
revoke execute on all functions in schema core from public;
alter default privileges in schema core revoke execute on functions from public;

revoke execute on all functions in schema agent from public;
alter default privileges in schema agent revoke execute on functions from public;

-- agent_ro: SELECT sobre agent y EXECUTE sobre agent.reference_date() (SEG-03).
-- Sin usage en core, staging ni audit.
grant usage on schema agent to agent_ro;
grant select on all tables in schema agent to agent_ro;
grant execute on function agent.reference_date() to agent_ro;
alter default privileges in schema agent grant select on tables to agent_ro;

-- service_role: consultas fijas del dashboard por la Data API (solo agent).
grant usage on schema agent to service_role;
grant select on all tables in schema agent to service_role;
grant execute on function agent.reference_date() to service_role;
alter default privileges in schema agent grant select on tables to service_role;

-- importer: inserta plantillas en staging, crea su lote y lo aplica (SEG-10).
grant usage on schema staging, audit to importer;
grant usage on schema core to importer;
grant insert on staging.stg_drug_stock, staging.stg_bed_inventory, staging.stg_surgery_schedule to importer;
grant select, insert on audit.import_batches to importer;   -- SELECT para RETURNING batch_id
grant select on audit.import_errors to importer;            -- leer el reporte de errores
grant execute on function core.apply_batch(uuid) to importer;

-- app_backend: sesión, usuarios, logs, panel de fuentes y consultas fijas.
grant usage on schema core, agent, audit to app_backend;
grant select on all tables in schema core to app_backend;
revoke select on core.app_settings from app_backend;
grant select (reference_date, updated_at) on core.app_settings to app_backend;  -- la sal no sale
grant select on all tables in schema agent to app_backend;
grant execute on function agent.reference_date() to app_backend;
grant select, insert, update on core.user_profiles to app_backend;
grant select, insert on audit.query_log, audit.user_admin_log to app_backend;
grant select on audit.import_batches, audit.import_errors to app_backend;
grant execute on function core.revert_batch(uuid, uuid) to app_backend;
