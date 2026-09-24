-- Rendimiento del dashboard: consumo de medicamentos y demanda de servicios se agregaban por día
-- en cada visita, con un escaneo completo de core.drug_dispensations (579 mil filas) y
-- core.service_lines (582 mil). El cast dispensed_at::date / provided_at::date impide usar los
-- índices. Los agregados diarios pasan a vistas materializadas (134 mil y 92 mil filas) y las
-- vistas agent.* leen de ellas. Las columnas y los tipos de las vistas agent.* no cambian.
--
-- Idempotente: core.mv_drug_consumption_daily y agent.v_drug_consumption_daily ya se aplicaron a
-- mano en la base compartida (sin migración en el repositorio). Aquí quedan con la misma
-- definición para que una base nueva termine igual; en la compartida solo se crea lo que falta
-- (demanda por especialidad y el consumo de 30 días de v_drug_inventory).
--
-- Se refrescan en core.refresh_materialized_views() (carga histórica), igual que las demás. La
-- interfaz solo importa bed_inventory, surgery_schedules y drug_stock, que no las alimentan.

create materialized view if not exists core.mv_drug_consumption_daily as
select d.dispensed_at::date as day, d.item_code, d.item_name, ic.item_type,
      d.area_name, d.specialty, sum(d.quantity)::int as total_quantity
from core.drug_dispensations d
left join core.mv_item_catalog ic on ic.item_code = d.item_code
group by 1, 2, 3, 4, 5, 6;
create unique index if not exists mv_drug_consumption_daily_day_item_code_item_name_item_type_idx
  on core.mv_drug_consumption_daily (day, item_code, item_name, item_type, area_name, specialty);
create index if not exists mv_drug_consumption_daily_item_code_day_idx
  on core.mv_drug_consumption_daily (item_code, day);

create materialized view if not exists core.mv_service_demand_daily as
select provided_at::date as day, area_name, specialty, service_code, service_name,
      count(*)::int as lines_count, sum(quantity)::int as total_quantity
from core.service_lines
group by 1, 2, 3, 4, 5;
create unique index if not exists mv_service_demand_daily_day_area_name_specialty_idx
  on core.mv_service_demand_daily (day, area_name, specialty, service_code, service_name);

create or replace view agent.v_drug_consumption_daily as
select day, item_code, item_name, item_type, area_name, specialty, total_quantity
from core.mv_drug_consumption_daily;

create or replace view agent.v_service_demand_daily as
select day, area_name, specialty, service_code, service_name, lines_count, total_quantity
from core.mv_service_demand_daily;

-- v_drug_inventory: el consumo de 30 días (S-10) sale del agregado diario, con el mismo rango
-- (reference_date - 29 a reference_date).
create or replace view agent.v_drug_inventory as
with latest as (
  select distinct on (item_code) item_code, item_name, current_stock, stock_date, data_origin
  from core.drug_stock
  order by item_code, stock_date desc
), consumption as (                                                 -- S-10
  select c.item_code, sum(c.total_quantity) / 30.0 as avg_daily
  from core.mv_drug_consumption_daily c
  cross join (select agent.reference_date() as ref) r
  where c.day >= r.ref - 29
    and c.day <= r.ref
  group by c.item_code
)
select l.item_code, l.item_name, ic.item_type, l.current_stock,
      round(coalesce(c.avg_daily, 0), 2) as avg_daily_consumption,
      case when coalesce(c.avg_daily, 0) > 0 then round(l.current_stock / c.avg_daily, 1) end as days_of_inventory,
      l.stock_date,
      (l.data_origin = 'simulated') as is_simulated
from latest l
left join consumption c on c.item_code = l.item_code
left join core.mv_item_catalog ic on ic.item_code = l.item_code;

-- Refresca las vistas materializadas en orden de dependencia. Las dos de agregados diarios leen de
-- mv_item_catalog (consumo), así que van después. ANALYZE deja estadísticas frescas: sin ellas el
-- plan de la primera consulta sobre una vista recién creada tardaba 1,7 s en vez de decenas de ms.
create or replace function core.refresh_materialized_views() returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  refresh materialized view concurrently core.mv_admission_stay;
  refresh materialized view concurrently core.mv_bed_occupancy_daily;
  refresh materialized view concurrently core.mv_item_catalog;
  refresh materialized view concurrently core.mv_drug_consumption_daily;
  refresh materialized view concurrently core.mv_service_demand_daily;
  analyze core.mv_drug_consumption_daily;
  analyze core.mv_service_demand_daily;
end $$;
