-- agent.v_drug_consumption_daily agrupaba 579 mil dispensaciones en cada consulta (17 s con el
-- filtro por día) y superaba el statement_timeout de agent_ro (5 s) y de app_backend (15 s):
-- el agente no podía responder sobre medicamentos y fallaba la tarjeta de rotación del dashboard.
--
-- El consumo diario pasa a una vista materializada (como core.mv_bed_occupancy_daily) y la vista
-- del esquema agent la lee con el mismo nombre y las mismas columnas. Solo la carga histórica
-- cambia core.drug_dispensations; se refresca en core.refresh_materialized_views() después de
-- mv_item_catalog, de la que depende item_type.
--
-- Idempotente y con los mismos nombres de índice que la migración 20260924180000_daily_aggregate_mvs.sql
-- (PR #32, borrador): las dos se pueden aplicar en cualquier orden sin duplicar objetos.

create materialized view if not exists core.mv_drug_consumption_daily as
select d.dispensed_at::date as day, d.item_code, d.item_name, ic.item_type, d.area_name, d.specialty,
      sum(d.quantity)::int as total_quantity
from core.drug_dispensations d
left join core.mv_item_catalog ic on ic.item_code = d.item_code
group by 1, 2, 3, 4, 5, 6;

-- Único para poder refrescar con concurrently; cubre el filtro por día y por ítem y día.
create unique index if not exists mv_drug_consumption_daily_day_item_code_item_name_item_type_idx
  on core.mv_drug_consumption_daily (day, item_code, item_name, item_type, area_name, specialty);
create index if not exists mv_drug_consumption_daily_item_code_day_idx
  on core.mv_drug_consumption_daily (item_code, day);

create or replace view agent.v_drug_consumption_daily as
select day, item_code, item_name, item_type, area_name, specialty, total_quantity
from core.mv_drug_consumption_daily;

create or replace function core.refresh_materialized_views() returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  refresh materialized view concurrently core.mv_admission_stay;
  refresh materialized view concurrently core.mv_bed_occupancy_daily;
  refresh materialized view concurrently core.mv_item_catalog;
  refresh materialized view concurrently core.mv_drug_consumption_daily;
end $$;
