-- =============================================================================
-- load_check.sql · Verificación de la carga histórica (levante v0.5, CAR-01 a CAR-08)
-- Solo lectura. Se ejecuta como propietario/postgres (lee core, staging y audit).
-- Devuelve una fila por prueba: seccion, prueba, esperado, obtenido, estado (OK | FALLO | INFO).
-- Esperados de filas: docs/perfil_his.md (filas leídas por archivo) y reporte de carga.
-- =============================================================================
with checks(seccion, prueba, esperado, obtenido, ok) as (

  -- 1. Filas por tabla frente al perfil ---------------------------------------
  select '1 filas', 'core.patients (Paciente)', '14502', count(*)::text, count(*) = 14502 from core.patients
  union all select '1 filas', 'core.admissions (Ingresos)', '17781', count(*)::text, count(*) = 17781 from core.admissions
  union all select '1 filas', 'Triage leído (audit.import_batches.rows_read, P-01)', '17781',
         coalesce(max(rows_read), 0)::text, coalesce(max(rows_read), 0) = 17781
         from audit.import_batches where target_table = 'triages' and load_type = 'historical'
  union all select '1 filas', 'Triage descartados sin OidTriage (audit.import_errors)', '1675',
         count(*)::text, count(*) = 1675
         from audit.import_errors e join audit.import_batches b using (batch_id) where b.target_table = 'triages'
  union all select '1 filas', 'core.triages (leídos - descartados)', '16106', count(*)::text, count(*) = 16106 from core.triages
  union all select '1 filas', 'core.first_attentions (Atencion)', '17375', count(*)::text, count(*) = 17375 from core.first_attentions
  union all select '1 filas', 'core.service_lines (Servicios)', '582357', count(*)::text, count(*) = 582357 from core.service_lines
  union all select '1 filas', 'core.drug_dispensations (MedicamentoInsumo)', '579465', count(*)::text, count(*) = 579465 from core.drug_dispensations
  -- 13.046 filas leídas; 276 son duplicados exactos de (schedule_number, service_code) y se omiten (CAR-06).
  union all select '1 filas', 'core.surgery_schedules (ProgramacionCirugia 13046 - 276 duplicados)', '12770', count(*)::text, count(*) = 12770 from core.surgery_schedules
  union all select '1 filas', 'Programaciones distintas (perfil)', '6156', count(distinct schedule_number)::text, count(distinct schedule_number) = 6156 from core.surgery_schedules
  union all select '1 filas', 'Lotes históricos no aplicados', '0', count(*)::text, count(*) = 0
         from audit.import_batches where load_type = 'historical' and status <> 'applied'

  -- 2. Staging vacío (CAR-07) y tamaño ---------------------------------------
  union all select '2 tamaño', 'Filas en staging del HIS (7 tablas)', '0',
         ((select count(*) from staging.stg_paciente) + (select count(*) from staging.stg_ingresos)
        + (select count(*) from staging.stg_triage) + (select count(*) from staging.stg_atencion)
        + (select count(*) from staging.stg_servicios) + (select count(*) from staging.stg_medicamento_insumo)
        + (select count(*) from staging.stg_programacion_cirugia))::text,
         ((select count(*) from staging.stg_paciente) + (select count(*) from staging.stg_ingresos)
        + (select count(*) from staging.stg_triage) + (select count(*) from staging.stg_atencion)
        + (select count(*) from staging.stg_servicios) + (select count(*) from staging.stg_medicamento_insumo)
        + (select count(*) from staging.stg_programacion_cirugia)) = 0
  union all select '2 tamaño', 'pg_database_size (MB), meta < 400', '< 400',
         round(pg_database_size(current_database()) / 1048576.0)::text,
         pg_database_size(current_database()) < 400 * 1048576
  -- Las 10 relaciones más pesadas (tablas, índices o vistas materializadas), informativo.
  union all select '2 tamaño', 'Top ' || lpad(rn::text, 2, '0') || ': ' || rel, 'INFO', mb || ' MB', null
         from (select row_number() over (order by pg_relation_size(c.oid) desc) as rn,
                      n.nspname || '.' || c.relname as rel,
                      round(pg_relation_size(c.oid) / 1048576.0, 1) as mb
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname in ('core', 'staging', 'audit') and c.relkind in ('r', 'i', 'm')
               order by pg_relation_size(c.oid) desc limit 10) t

  -- 3. Fecha de referencia y vistas materializadas (CAR-08) ------------------
  union all select '3 referencia', 'core.app_settings.reference_date', '2026-09-21', reference_date::text, reference_date = date '2026-09-21' from core.app_settings
  union all select '3 referencia', 'mv_admission_stay con filas (17774 con cama asignada)', '17774', count(*)::text, count(*) = 17774 from core.mv_admission_stay
  union all select '3 referencia', 'mv_bed_occupancy_daily con filas', '> 0', count(*)::text, count(*) > 0 from core.mv_bed_occupancy_daily
  union all select '3 referencia', 'mv_item_catalog con filas (1327 códigos)', '1327', count(*)::text, count(*) = 1327 from core.mv_item_catalog

  -- 4. S-07 -------------------------------------------------------------------
  union all select '4 S-07', 'Estancias negativas', '0', count(*)::text, count(*) = 0
         from core.mv_admission_stay where estimated_discharge_at < hospitalized_at
  -- Solape con hora: dos ingresos de la misma cama con intervalos que se cruzan.
  union all select '4 S-07', 'Solapes de estancia en la misma cama (histórico completo)', '0', count(*)::text, count(*) = 0
         from core.mv_admission_stay a join core.mv_admission_stay b
           on a.bed_code = b.bed_code and a.admission_id < b.admission_id
          and a.hospitalized_at < b.estimated_discharge_at and b.hospitalized_at < a.estimated_discharge_at
  -- Un relevo el mismo día (sale uno, entra otro) no es doble ocupación: se compara con hora.
  union all select '4 S-07', 'Camas con dos ingresos activos al mismo tiempo el 2026-09-21', '0', count(*)::text, count(*) = 0
         from core.mv_admission_stay a join core.mv_admission_stay b
           on a.bed_code = b.bed_code and a.admission_id < b.admission_id
          and a.hospitalized_at < b.estimated_discharge_at and b.hospitalized_at < a.estimated_discharge_at
          and a.estimated_discharge_at >= date '2026-09-21' and b.hospitalized_at < date '2026-09-22'

  -- 5. bed_inventory -----------------------------------------------------------
  union all select '5 camas', 'Camas derived', '712', count(*)::text, count(*) = 712 from core.bed_inventory where data_origin = 'derived'
  union all select '5 camas', 'UCI total (UNIDAD DE CUIDADO INTENSIVO)', '46', count(*)::text, count(*) = 46 from core.bed_inventory where bed_group = 'UNIDAD DE CUIDADO INTENSIVO'
  union all select '5 camas', 'UCI adultos', '19', count(*)::text, count(*) = 19 from core.bed_inventory where bed_group = 'UNIDAD DE CUIDADO INTENSIVO' and bed_subgroup like '%ADULTOS'
  union all select '5 camas', 'UCI neonatal', '18', count(*)::text, count(*) = 18 from core.bed_inventory where bed_group = 'UNIDAD DE CUIDADO INTENSIVO' and bed_subgroup like '%NEONATAL'
  union all select '5 camas', 'UCI pediátrica', '9', count(*)::text, count(*) = 9 from core.bed_inventory where bed_group = 'UNIDAD DE CUIDADO INTENSIVO' and bed_subgroup like '%PEDIATRICO'

  -- 6. Triage ------------------------------------------------------------------
  union all select '6 triage', 'Niveles distintos presentes', '1,2,3,4', string_agg(triage_level::text, ',' order by triage_level),
         string_agg(triage_level::text, ',' order by triage_level) = '1,2,3,4' from (select distinct triage_level from core.triages) t
  union all select '6 triage', 'Triages con nivel nulo o 5', '0', count(*)::text, count(*) = 0 from core.triages where triage_level is null or triage_level = 5
  union all select '6 triage', 'Nivel ' || triage_level, 'INFO', count(*)::text, null from core.triages where triage_level is not null group by triage_level
  union all select '6 triage', 'Ingresos con triage_id nulo', '1675 (= descartados)', count(*)::text, count(*) = 1675 from core.admissions where triage_id is null

  -- 7. CAR-03: foto simulada de inventario -------------------------------------
  union all select '7 inventario', 'Medicamentos con < 5 días de inventario', '8 a 12', count(*)::text, count(*) between 8 and 12
         from agent.v_drug_inventory where item_type = 'medicamento' and days_of_inventory < 5
  union all select '7 inventario', 'Medicamentos con 5 a 10 días', '10 a 15', count(*)::text, count(*) between 10 and 15
         from agent.v_drug_inventory where item_type = 'medicamento' and days_of_inventory >= 5 and days_of_inventory <= 10
  union all select '7 inventario', 'Filas de drug_stock que no son simulated', '0', count(*)::text, count(*) = 0 from core.drug_stock where data_origin <> 'simulated'
  union all select '7 inventario', 'Ítems de v_drug_inventory con is_simulated = false', '0', count(*)::text, count(*) = 0 from agent.v_drug_inventory where not is_simulated

  -- 8. Esperas en urgencias -------------------------------------------------------
  union all select '8 esperas', 'wait_minutes mínimo (>= 0)', '0 a 1440', min(wait_minutes)::text, min(wait_minutes) >= 0 from agent.v_emergency_wait_times
  union all select '8 esperas', 'wait_minutes máximo (<= 1440)', '0 a 1440', max(wait_minutes)::text, max(wait_minutes) <= 1440 from agent.v_emergency_wait_times
)
select seccion, prueba, esperado, obtenido,
       case when ok is null then 'INFO' when ok then 'OK' else 'FALLO' end as estado
from checks
order by seccion, prueba;
