-- =============================================================================
-- demo_reference.sql · SQL de referencia de las 4 preguntas de la demo (levante v0.5, §12)
-- Se copian tal cual al plan B (consultas predefinidas). Reglas:
--   - Solo vistas del esquema agent y agent.reference_date(); nunca core, CURRENT_DATE ni now().
--   - Una sola sentencia SELECT por pregunta, con LIMIT explícito.
--   - Corren como agent_ro (probado con SET LOCAL ROLE agent_ro y con runAgentQuery).
--   - Sin punto y coma dentro de la sentencia; el de cierre es solo del archivo.
-- Cada bloque empieza con "-- Q<n>" y termina en el punto y coma.
-- =============================================================================

-- Q1 · ¿Cuántas camas de UCI están ocupadas hoy?
-- Total y desglose por subservicio en una sola consulta (S-03, S-08). El total sale al final.
SELECT CASE WHEN GROUPING(subservice) = 1 THEN 'TOTAL UCI' ELSE subservice END AS subservicio,
       SUM(occupied_beds)::int AS ocupadas,
       SUM(capacity)::int AS capacidad,
       ROUND(100.0 * SUM(occupied_beds) / NULLIF(SUM(capacity), 0), 1) AS porcentaje_ocupacion
FROM agent.v_bed_occupancy
WHERE service = 'UNIDAD DE CUIDADO INTENSIVO'
  AND day = agent.reference_date()
GROUP BY GROUPING SETS ((subservice), ())
ORDER BY GROUPING(subservice), subservice
LIMIT 10;

-- Q2 · ¿Cuáles son los medicamentos con menos de 5 días de inventario?
-- Solo medicamentos (S-15), de menor a mayor. is_simulated marca la foto simulada (CAR-03).
SELECT item_name AS nombre,
       current_stock AS stock,
       avg_daily_consumption AS consumo_diario,
       days_of_inventory AS dias_restantes,
       is_simulated
FROM agent.v_drug_inventory
WHERE item_type = 'medicamento'
  AND days_of_inventory < 5
ORDER BY days_of_inventory ASC, item_name ASC
LIMIT 100;

-- Q3 · ¿Cuál es el tiempo de espera promedio en urgencias en la última semana?
-- Ingresos del 15 al 21 de septiembre (reference_date - 6 hasta reference_date inclusive, S-01, S-06).
-- Promedio total y por nivel de triage en una sola consulta.
SELECT CASE WHEN GROUPING(triage_level) = 1 THEN 'TOTAL'
            WHEN triage_level IS NULL THEN 'Sin triage'
            ELSE triage_level::text END AS triage_level,
       COUNT(*) AS ingresos,
       ROUND(AVG(wait_minutes), 1) AS espera_promedio_min
FROM agent.v_emergency_wait_times
WHERE admitted_at >= agent.reference_date() - 6
  AND admitted_at < agent.reference_date() + 1
GROUP BY GROUPING SETS ((triage_level), ())
ORDER BY GROUPING(triage_level), triage_level
LIMIT 10;

-- Q4 · ¿Qué servicio tiene más pacientes ingresados este mes?
-- Pacientes distintos con admission_class = 'Hospitalario' (S-05), del día 1 del mes de
-- reference_date hasta reference_date inclusive. Top 5. patient_key no sale en el resultado.
SELECT service AS servicio,
       COUNT(DISTINCT patient_key) AS pacientes
FROM agent.v_admissions
WHERE admission_class = 'Hospitalario'
  AND admitted_at >= agent.reference_date() - (EXTRACT(DAY FROM agent.reference_date())::int - 1)
  AND admitted_at < agent.reference_date() + 1
GROUP BY service
ORDER BY pacientes DESC, service ASC
LIMIT 5;
