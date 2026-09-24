-- Verifica que la migración 20260924180000_daily_aggregate_mvs.sql no cambia lo que devuelven las
-- vistas agent.v_drug_inventory, v_drug_consumption_daily y v_service_demand_daily.
--
-- Cómo correrlo (editor SQL de Supabase, una sola ejecución):
--   1. Pega este archivo completo.
--   2. Reemplaza la línea "-- PEGA AQUÍ LA MIGRACIÓN" por el contenido de la migración.
--   3. Ejecuta. Termina a propósito con un error "RESULTADO: ..." que aborta la transacción: no
--      queda nada creado ni cambiado. Cada línea trae igual=true/false, filas y milisegundos.
--
-- Al final compara cada vista materializada contra la agregación directa de su tabla de origen,
-- para detectar una MV desactualizada o distinta (la de consumo ya existía en la base compartida).
--
-- Son las consultas de la API (critical-drugs, demanda, rotación), las 4 del plan B del agente que
-- usan estas vistas y 4 típicas del LLM. Corren antes y después de la migración, y se compara el
-- resultado completo (ordenado, sin depender del orden). Corren con el rol del editor: los datos
-- no dependen del rol. Los permisos de agent_ro y app_backend se prueban aparte: leen las vistas
-- agent.* (sin security_invoker) y no pueden leer core.mv_* directamente.

create temp table qs as select * from (values
 ('app_critical_drugs', $q$SELECT item_code, item_name, current_stock, avg_daily_consumption, days_of_inventory, stock_date, is_simulated, agent.reference_date() + FLOOR(days_of_inventory)::int AS estimated_stockout_date FROM agent.v_drug_inventory WHERE item_type = 'medicamento' AND days_of_inventory < 10 ORDER BY days_of_inventory ASC, item_name ASC$q$),
 ('app_demand_specialties', $q$SELECT coalesce(d.specialty, 'SIN ESPECIALIDAD') AS specialty, SUM(d.lines_count)::int AS lines_count FROM agent.v_service_demand_daily d WHERE d.day >= date_trunc('month', (SELECT agent.reference_date()))::date AND d.day <= (SELECT agent.reference_date()) GROUP BY d.specialty ORDER BY lines_count DESC, specialty ASC$q$),
 ('app_drug_rotation', $q$WITH agg AS (SELECT c.item_code, min(c.item_name) AS item_name, coalesce(min(c.item_type), 'dispositivo') AS item_type, SUM(c.total_quantity)::int AS total_quantity FROM agent.v_drug_consumption_daily c WHERE c.day >= (SELECT agent.reference_date()) - 29 AND c.day <= (SELECT agent.reference_date()) GROUP BY c.item_code HAVING SUM(c.total_quantity) > 0) SELECT 'period' AS kind, NULL AS item_code, NULL AS item_name, NULL AS item_type, 0 AS total_quantity, (agent.reference_date() - 29)::text AS period_start, agent.reference_date()::text AS period_end UNION ALL (SELECT 'top', item_code, item_name, item_type, total_quantity, NULL, NULL FROM agg ORDER BY total_quantity DESC, item_code LIMIT 10) UNION ALL (SELECT 'bottom', item_code, item_name, item_type, total_quantity, NULL, NULL FROM agg ORDER BY total_quantity ASC, item_code LIMIT 10)$q$),
 ('planb_drugs_below_5', $q$SELECT item_name AS nombre, current_stock AS stock, avg_daily_consumption AS consumo_diario, days_of_inventory AS dias_restantes, is_simulated FROM agent.v_drug_inventory WHERE item_type = 'medicamento' AND days_of_inventory < 5 ORDER BY days_of_inventory ASC, item_name ASC LIMIT 100$q$),
 ('planb_drugs_5_to_10', $q$SELECT item_name AS nombre, current_stock AS stock, avg_daily_consumption AS consumo_diario, days_of_inventory AS dias_restantes, is_simulated FROM agent.v_drug_inventory WHERE item_type = 'medicamento' AND days_of_inventory >= 5 AND days_of_inventory < 10 ORDER BY days_of_inventory ASC, item_name ASC LIMIT 100$q$),
 ('planb_top_specialties', $q$SELECT specialty AS especialidad, SUM(lines_count)::int AS servicios FROM agent.v_service_demand_daily WHERE day >= date_trunc('month', (SELECT agent.reference_date()))::date AND day <= (SELECT agent.reference_date()) AND specialty IS NOT NULL GROUP BY specialty ORDER BY servicios DESC, specialty ASC LIMIT 10$q$),
 ('planb_top_dispensed_30d', $q$SELECT item_name AS nombre, SUM(total_quantity) AS cantidad_dispensada FROM agent.v_drug_consumption_daily WHERE item_type = 'medicamento' AND day >= (SELECT agent.reference_date()) - 29 AND day <= (SELECT agent.reference_date()) GROUP BY item_name ORDER BY cantidad_dispensada DESC, item_name ASC LIMIT 10$q$),
 ('llm_ilike_drug', $q$SELECT item_name, item_type, SUM(total_quantity) AS total FROM agent.v_drug_consumption_daily WHERE item_name ILIKE '%acetaminof%' GROUP BY 1, 2 ORDER BY 1$q$),
 ('llm_demand_by_month', $q$SELECT date_trunc('month', day)::date AS mes, SUM(lines_count) AS lineas, SUM(total_quantity) AS cantidad FROM agent.v_service_demand_daily GROUP BY 1 ORDER BY 1$q$),
 ('llm_demand_by_area', $q$SELECT area_name, specialty, service_name, SUM(lines_count) AS lineas FROM agent.v_service_demand_daily GROUP BY 1, 2, 3 ORDER BY lineas DESC, 1, 2, 3 LIMIT 50$q$),
 ('llm_inventory_all', $q$SELECT item_code, item_name, item_type, current_stock, avg_daily_consumption, days_of_inventory, stock_date, is_simulated FROM agent.v_drug_inventory$q$)
) as x(k, s);
create temp table res(k text, phase text, ms numeric, n int, data jsonb);

do $before$
declare q record; v jsonb; t timestamptz;
begin
  for q in select * from qs loop
    t := clock_timestamp();
    execute 'select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from (' || q.s || ') t' into v;
    insert into res values (q.k, 'before', round(extract(epoch from clock_timestamp()-t)*1000), jsonb_array_length(v), v);
  end loop;
end $before$;

-- PEGA AQUÍ LA MIGRACIÓN (supabase/migrations/20260924180000_daily_aggregate_mvs.sql)

do $after$
declare q record; v jsonb; t timestamptz; msg text := ''; r record; n bigint;
begin
  for q in select * from qs loop
    t := clock_timestamp();
    execute 'select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from (' || q.s || ') t' into v;
    insert into res values (q.k, 'after', round(extract(epoch from clock_timestamp()-t)*1000), jsonb_array_length(v), v);
  end loop;
  for r in select b.k, b.n as filas_antes, a.n as filas_despues, (b.data = a.data) as igual, b.ms as ms_antes, a.ms as ms_despues
           from res b join res a on a.k = b.k and a.phase = 'after' where b.phase = 'before' order by b.k loop
    msg := msg || format(E'\n%s | igual=%s | filas %s->%s | %s ms -> %s ms', r.k, r.igual, r.filas_antes, r.filas_despues, r.ms_antes, r.ms_despues);
  end loop;
  select count(*) into n from ((select d.dispensed_at::date, d.item_code, d.item_name, ic.item_type, d.area_name, d.specialty, sum(d.quantity)::int
         from core.drug_dispensations d left join core.mv_item_catalog ic on ic.item_code = d.item_code group by 1, 2, 3, 4, 5, 6
         except select day, item_code, item_name, item_type, area_name, specialty, total_quantity from core.mv_drug_consumption_daily)
       union all (select day, item_code, item_name, item_type, area_name, specialty, total_quantity from core.mv_drug_consumption_daily
         except select d.dispensed_at::date, d.item_code, d.item_name, ic.item_type, d.area_name, d.specialty, sum(d.quantity)::int
         from core.drug_dispensations d left join core.mv_item_catalog ic on ic.item_code = d.item_code group by 1, 2, 3, 4, 5, 6)) x;
  msg := msg || format(E'
mv_drug_consumption_daily vs drug_dispensations | igual=%s (%s filas distintas)', n = 0, n);
  select count(*) into n from ((select provided_at::date, area_name, specialty, service_code, service_name, count(*)::int, sum(quantity)::int
         from core.service_lines group by 1, 2, 3, 4, 5
         except select day, area_name, specialty, service_code, service_name, lines_count, total_quantity from core.mv_service_demand_daily)
       union all (select day, area_name, specialty, service_code, service_name, lines_count, total_quantity from core.mv_service_demand_daily
         except select provided_at::date, area_name, specialty, service_code, service_name, count(*)::int, sum(quantity)::int
         from core.service_lines group by 1, 2, 3, 4, 5)) x;
  msg := msg || format(E'
mv_service_demand_daily vs service_lines | igual=%s (%s filas distintas)', n = 0, n);
  raise exception 'RESULTADO:%', msg;
end $after$;
