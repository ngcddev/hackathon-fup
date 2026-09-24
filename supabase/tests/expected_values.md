# Valores esperados de la carga y de la demo

Generado el 23 de septiembre de 2026 sobre el proyecto Supabase `hackathon-fup`, con `reference_date = 2026-09-21`.
Fuentes: `supabase/tests/load_check.sql` (carga) y `supabase/tests/demo_reference.sql` (demo).

Las consultas se ejecutaron como propietario (el rol del MCP no puede hacer `SET ROLE agent_ro`). Solo tocan vistas de `agent` y `agent.reference_date()`, y se comprobó que `agent_ro` tiene SELECT sobre `v_bed_occupancy`, `v_drug_inventory`, `v_emergency_wait_times` y `v_admissions`, EXECUTE sobre `agent.reference_date()`, y ningún permiso sobre `core.patients`. Los tiempos son `EXPLAIN ANALYZE` en el servidor, sin latencia de red. La verificación con el rol real está más abajo.

## 1. Verificación de la carga

Resultado de `load_check.sql`: **todas las pruebas OK**, sin ningún FALLO.

### Filas por tabla frente al perfil

| Tabla | Esperado | Obtenido |
|---|---:|---:|
| Triage leído (P-01) | 17.781 | 17.781 |
| Triage descartados sin `OidTriage` | 1.675 (ver nota) | 1.675 |
| `core.triages` | 16.106 | 16.106 |
| `core.patients` | 14.502 | 14.502 |
| `core.admissions` | 17.781 | 17.781 |
| `core.first_attentions` | 17.375 | 17.375 |
| `core.service_lines` | 582.357 | 582.357 |
| `core.drug_dispensations` | 579.465 | 579.465 |
| `core.surgery_schedules` | 12.770 | 12.770 |
| Programaciones distintas | 6.156 | 6.156 |

**Nota sobre los descartados de Triage:** el levante y el modelo dicen 1.667, pero el `Triage.txt` original tiene exactamente 1.675 filas con `OidTriage` vacío (9,4 % de 17.781). Es una cifra mal transcrita en los documentos; no falta ningún dato. Los 1.675 ingresos sin triage coinciden con `admissions.triage_id` nulo.

**Nota sobre cirugías:** el perfil lee 13.046 filas; 276 son duplicados exactos de `(schedule_number, service_code)` y la carga los omite por idempotencia (CAR-06).

### Staging y tamaño (CAR-07)

- Staging del HIS: 0 filas en las 7 tablas.
- `pg_database_size`: **391 MB** (meta: menos de 400 MB; el margen es de solo 9 MB).
- Las 10 relaciones más pesadas:

| # | Relación | MB |
|---:|---|---:|
| 1 | `core.drug_dispensations` | 111,4 |
| 2 | `core.service_lines` | 110,5 |
| 3 | `core.drug_dispensations_item_code_dispensed_at_idx` | 30,2 |
| 4 | `core.service_lines_admission_id_service_code_idx` | 14,6 |
| 5 | `core.service_lines_pkey` | 13,8 |
| 6 | `core.service_lines_admission_id_provided_at_idx` | 13,5 |
| 7 | `core.drug_dispensations_pkey` | 13,4 |
| 8 | `core.drug_dispensations_admission_id_dispensed_at_idx` | 13,3 |
| 9 | `core.service_lines_provided_at_idx` | 12,0 |
| 10 | `core.drug_dispensations_dispensed_at_idx` | 11,0 |

### Referencia y vistas materializadas (CAR-08)

- `core.app_settings.reference_date`: 2026-09-21.
- `mv_admission_stay`: 17.774 filas (ingresos con cama asignada). `mv_bed_occupancy_daily`: 2.755. `mv_item_catalog`: 1.327 (921 medicamentos y 406 dispositivos).

### S-07

- Estancias negativas: 0.
- Solapes de estancia en la misma cama, comparando con hora: 0 en todo el histórico y 0 el 2026-09-21.
- Si se compara solo por fecha salen 22 camas el 21 de septiembre. Son relevos el mismo día (sale un paciente y entra otro a otra hora) y no doble ocupación; la ocupación cuenta camas distintas, por lo que no se duplican.

### Camas

- 712 camas `derived`.
- UCI (`bed_group = 'UNIDAD DE CUIDADO INTENSIVO'`): 46 = 19 adultos + 18 neonatal + 9 pediátrica.

### Triage

| Nivel | Triages |
|---:|---:|
| 1 | 443 |
| 2 | 1.560 |
| 3 | 11.891 |
| 4 | 2.212 |
| 5 | 0 |

Ningún triage tiene `triage_level` nulo. Ingresos con `triage_id` nulo: **1.675**.

### CAR-03: inventario simulado

- Medicamentos con menos de 5 días: **10** (esperado 8 a 12).
- Medicamentos entre 5 y 10 días: **12** (esperado 10 a 15).
- Las 647 filas de `drug_stock` son `simulated`, y ninguna fila de `v_drug_inventory` tiene `is_simulated = false`.

### Esperas en urgencias

`v_emergency_wait_times.wait_minutes`: mínimo **3,1**, máximo **1.349,6** (dentro de 0 a 1.440).

## 2. Las cuatro preguntas de la demo

Los valores de la sección 12 del levante eran preliminares, calculados con el perfil. **Los cuatro coinciden con el resultado de la base.**

### Pregunta 1 · Camas de UCI ocupadas hoy

```sql
SELECT CASE WHEN GROUPING(subservice) = 1 THEN 'TOTAL UCI' ELSE subservice END AS subservicio,
       SUM(occupied_beds)::int AS ocupadas,
       SUM(capacity)::int AS capacidad,
       ROUND(100.0 * SUM(occupied_beds) / NULLIF(SUM(capacity), 0), 1) AS porcentaje_ocupacion
FROM agent.v_bed_occupancy
WHERE service = 'UNIDAD DE CUIDADO INTENSIVO'
  AND day = agent.reference_date()
GROUP BY GROUPING SETS ((subservice), ())
ORDER BY GROUPING(subservice), subservice
LIMIT 10
```

| subservicio | ocupadas | capacidad | % |
|---|---:|---:|---:|
| UNIDAD DE CUIDADO INTENSIVO NEONATAL | 15 | 18 | 83,3 |
| UNIDAD DE CUIDADO INTENSIVO PEDIATRICO | 6 | 9 | 66,7 |
| UNIDAD DE CUIDADOS INTENSIVOS ADULTOS | 9 | 19 | 47,4 |
| **TOTAL UCI** | **30** | **46** | **65,2** |

- **Preliminar:** 30 de 46 (65,2 %): adultos 9 de 19, neonatal 15 de 18, pediátrica 6 de 9.
- **Diferencia:** ninguna. El levante avisaba que podía bajar con la regla nueva de S-07, pero el egreso estimado recortado por la siguiente asignación no cambió la ocupación de la UCI el 21 de septiembre.
- **Tiempo:** 0,7 ms.

### Pregunta 2 · Medicamentos con menos de 5 días de inventario

```sql
SELECT item_name AS nombre,
       current_stock AS stock,
       avg_daily_consumption AS consumo_diario,
       days_of_inventory AS dias_restantes,
       is_simulated
FROM agent.v_drug_inventory
WHERE item_type = 'medicamento'
  AND days_of_inventory < 5
ORDER BY days_of_inventory ASC, item_name ASC
LIMIT 100
```

Resultado: **10 medicamentos**, todos `is_simulated = true`.

| Medicamento | Stock | Consumo diario | Días |
|---|---:|---:|---:|
| LOSARTAN 50 mg TABLETA | 56 | 39,53 | 1,4 |
| ALIMENTO LIQUIDO PARA PROPOSITOS MEDICOS ESPECIALES… ENSURE CLINICAL FCO x 220 mL | 39 | 21,57 | 1,8 |
| PREGABALINA 75 mg CAPSULA LYRICA | 58 | 25,93 | 2,2 |
| DAPAGLIFLOZINA 10 mg TABLETA FORXIGA | 46 | 19,80 | 2,3 |
| CLORURO DE SODIO AL 0.9 PORCIENTO SOLUCION INYECTABLE 500 ML | 973 | 374,20 | 2,6 |
| RIFAMPICINA 150MG CAPSULAS-SECRETARIA | 10 | 3,07 | 3,3 |
| CALCITRIOL 0.25 MCG CAPSULA | 14 | 4,10 | 3,4 |
| ACIDO VALPROICO 250 mg CAPSULA | 80 | 20,87 | 3,8 |
| PROGESTERONA MICRONIZADA 200 mg CAPSULA | 7 | 1,73 | 4,0 |
| CEFTAZIDIMA 1 g POLVO ESTERIL PARA INYECCION | 5 | 1,23 | 4,1 |

- **Preliminar:** entre 8 y 12 medicamentos.
- **Diferencia:** ninguna; 10 está en el rango, por construcción de la foto simulada (CAR-03).
- **Observación:** el ítem del Ensure está clasificado como medicamento porque menos de la mitad de sus dispensaciones sale de áreas de dispositivos (S-15, pendiente de revisión manual).
- **Tiempo:** 145 ms. La mayor parte es el escaneo de 132.221 dispensaciones de los últimos 30 días en `v_drug_inventory`.

### Pregunta 3 · Espera promedio en urgencias, última semana

```sql
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
LIMIT 10
```

| triage_level | ingresos | espera (min) |
|---|---:|---:|
| 1 | 20 | 30,5 |
| 2 | 72 | 47,1 |
| 3 | 554 | 59,7 |
| 4 | 115 | 60,6 |
| Sin triage | 35 | 153,8 |
| **TOTAL** | **796** | **62,1** |

- **Preliminar:** 62,1 minutos sobre 796 ingresos.
- **Diferencia:** ninguna.
- **Observación para la demo:** el nivel 1 espera 30,5 min y el nivel 2, 47,1 min, por encima de la referencia normativa (ALE-04). Los 35 ingresos sin triage se miden desde el ingreso (S-06) y espera casi 154 min; suben el promedio total.
- **Tiempo:** 11 ms.

### Pregunta 4 · Servicio con más pacientes ingresados este mes

```sql
SELECT service AS servicio,
       COUNT(DISTINCT patient_key) AS pacientes
FROM agent.v_admissions
WHERE admission_class = 'Hospitalario'
  AND admitted_at >= agent.reference_date() - (EXTRACT(DAY FROM agent.reference_date())::int - 1)
  AND admitted_at < agent.reference_date() + 1
GROUP BY service
ORDER BY pacientes DESC, service ASC
LIMIT 5
```

| Servicio | Pacientes |
|---|---:|
| PEDIATRIA | 405 |
| HOSPITALIZACION | 394 |
| RECUPERACION | 235 |
| GINECO OBSTETRICIA | 153 |
| URGENCIAS | 95 |

- **Preliminar:** Pediatría con 405; top 5: Pediatría 405, Hospitalización 394, Recuperación 235, Gineco-obstetricia 153 y Urgencias 95.
- **Diferencia:** ninguna. `patient_key` no aparece en el resultado.
- **Tiempo:** 195 ms. Se calcula el hash de `patient_key` para las 1.488 filas del mes.

## Verificación como `agent_ro` (con `runAgentQuery`)

Las cuatro consultas se ejecutaron después por el pooler, con el rol `agent_ro` real y `runAgentQuery`. Devuelven las mismas filas de arriba (4, 10, 6 y 5).

| Pregunta | Primera ejecución | Ejecución en caliente |
|---|---:|---:|
| 1 | 620 ms | 595 ms |
| 2 | 2.053 ms | 709 ms |
| 3 | 1.342 ms | 608 ms |
| 4 | 924 ms | 783 ms |

Los tiempos incluyen la latencia de red desde el equipo de desarrollo (unos 600 ms por consulta hacia sa-east-1).

**Riesgo para la demo:** la pregunta 2 con la caché fría superó los 5 s de `statement_timeout` en una ejecución (error 57014), aunque en la siguiente tardó 2 s. Ejecutar las 4 consultas una vez antes de presentar deja la caché caliente.

## Pendiente

- Corregir el 1.667 por 1.675 en el levante y en el modelo (los documentos quedan fuera de mi alcance).
