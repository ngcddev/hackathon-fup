# Levante de requerimientos: Sistema de Gestión Hospitalaria Inteligente

**Hospital Susana López de Valencia (Popayán) · Hackathon Campus Party FUP 2026**
Versión 0.5 · 23 de septiembre de 2026 · Estado: borrador. Los supuestos de datos quedaron validados con el perfil de los txt reales (`perfil_his.md`); los pendientes están en la sección 15.

**Equipo**
- Nicolás: arquitectura, alcance, requerimientos, integración, seguridad básica y QA.
- Sebastián: lógica de negocio, Supabase y backend.
- Andrés: frontend, Figma y design system.

**Cambios frente a la versión 0.4:**
- Llegaron los datos reales (7 txt, 196 MB, del 1 de mayo al 21 de septiembre de 2026) y se perfilaron. Los supuestos de datos pasan a validados, con su evidencia en la sección 8, y la sección 6 resume los hallazgos.
- Se retiran los datos semilla sintéticos: CAR-04 pasa a Won't. El único dato simulado es la foto de inventario de medicamentos (`drug_stock`), con la regla de CAR-03.
- `REFERENCE_DATE` = 2026-09-21: "hoy" es el 21 de septiembre, "este mes" va del 1 al 21 y "la última semana" del 15 al 21. La fecha vive también en la base (`core.app_settings` y `agent.reference_date()`), para que vistas, consultas fijas y SQL del LLM usen la misma (CAR-08).
- UCI es el grupo UNIDAD DE CUIDADO INTENSIVO (adultos, neonatal y pediátrica; 46 camas observadas). Cuidado intermedio y cuidado básico no cuentan como UCI (S-03).
- El nivel de triage no es `CodigoTriage` (24 códigos por consultorio y área) sino el número que aparece en `ClasificacionTriage`. Se agrega `triage_level` (S-16), que usan DAS-02, ALE-04 y D7.
- `FechaHospitalizacion` es la asignación de cama: la tiene el 99,9 % de los ingresos ambulatorios. "Pacientes ingresados" se define solo por `ClaseIngreso` (S-05) y la ocupación incluye toda cama asignada (S-08).
- El egreso estimado se corta cuando la misma cama recibe el siguiente ingreso y nunca queda antes de la asignación de cama (S-07).
- Cirugías: el 69 % de las filas de ProgramacionCirugia apunta a ingresos que no están en el extracto y no hay fecha. El cumplimiento se calcula solo sobre programaciones con ingreso en el extracto, por mes del ingreso (S-11), y sus referencias a pacientes e ingresos pasan a lógicas.
- Se distingue medicamento de dispositivo médico con `item_type`, derivado del área de dispensación (S-15), para que la pregunta 2 hable solo de medicamentos.
- La alerta de ocupación (ALE-02) se evalúa por subservicio y recomienda el subservicio del mismo servicio con más disponibilidad.
- Nuevo CAR-07: vaciar el staging del HIS después de aplicar la carga, por el límite de 500 MB de Supabase.
- La sección 12 incluye valores de referencia preliminares para las 4 preguntas de la demo.

**Cambios de la versión 0.4 (frente a la 0.3):**
- El panel de fuentes integradas (antes diferenciador D4) pasa a **Must** como DAS-12.
- El filtro del dashboard por servicio pasa a **Must** (DAS-10); el filtro por rango de fechas queda como Should (DAS-13).
- Importación todo o nada: si un lote tiene al menos una fila inválida, no se aplica ninguna (IMP-05). Los lotes tienen un nuevo estado, `rejected`.
- Una foto de inventario de medicamentos con una fecha que ya existe se rechaza completa (SEG-12, ahora Must). El reemplazo con confirmación pasa a SEG-16 (Should).
- Si el SQL generado falla al ejecutarse (error o timeout), responde el plan B (AGE-05).
- Formato de error único para toda la API (RNF-16).
- Se agrega la pantalla de logs para `admin` como Could (AUT-15).
- En la matriz de permisos, el resumen del día (D5) queda separado del dashboard y condicionado a que se implemente.
- Aclaraciones: el jurado no es un rol del sistema, y `must_change_password` solo tiene efecto si se implementa AUT-10.

---

## 1. Problema

El hospital atiende en promedio 500 pacientes diarios en urgencias, hospitalización y consulta externa. La información sobre ocupación de camas, tiempos de espera, quirófanos, medicamentos y citas está dispersa en sistemas y hojas de cálculo desconectados (Historia Clínica, Farmacia, Admisiones).

Por eso no hay una visión integrada de la operación, los directivos dependen de reportes manuales de TI y las decisiones sobre capacidad, tiempos de espera y abastecimiento llegan tarde. Eso afecta la calidad de atención y la eficiencia del gasto.

## 2. Antecedentes y necesidades derivadas

| Antecedente | Necesidad | Cómo la atiende el MVP |
|---|---|---|
| El hospital creció, pero sus sistemas de información no. | Integrar las fuentes en un solo punto. | Carga centralizada de las 7 tablas del HIS en una base única, con panel de fuentes integradas. |
| La información vive en hojas de cálculo y sistemas distintos. | Incorporar esos datos sin depender de TI. | Importador de hojas de cálculo con plantillas, validación y trazabilidad de la fuente y del usuario que cargó. |
| Directivos y jefes pasan horas pidiendo reportes a TI o revisando hojas de cálculo. | Autoservicio de información sin depender de TI. | Agente conversacional que responde preguntas en español en segundos. |
| Hacen falta datos en tiempo real para gestionar la capacidad en alta demanda. | Visibilidad inmediata de la capacidad y alertas tempranas, incluso ante fallas de conexión. | Dashboard de KPIs, alertas con recomendaciones y modo contingencia sin conexión. |
| La información está atrapada en bases separadas. | Consultar de forma ágil a través de todas las fuentes. | Modelo de datos unificado y consultas que cruzan admisiones, triage, servicios, farmacia y cirugía. |
| Directivos, jefes, administrativos y farmacia usan la información de forma distinta, y no todos deben poder cargar datos. | Controlar quién entra y qué puede hacer cada perfil. | Inicio de sesión obligatorio, roles con permisos por función y página de administración de usuarios. |

## 3. Objetivo del MVP y criterios de éxito

**Objetivo:** construir un prototipo funcional que centralice los datos del HIS y de las hojas de cálculo del hospital, y que permita a directivos y jefes de servicio consultarlos en lenguaje natural, ver los KPIs clave en un dashboard y recibir alertas con recomendaciones, con acceso controlado por usuario y rol.

**El MVP se considera exitoso si:**
1. Las 4 preguntas obligatorias de la demo se responden correctamente, en menos de 10 segundos, incluso si falla el proveedor de IA.
2. El dashboard muestra los 5 grupos de KPIs del reto: ocupación, tiempos de espera, quirófanos, medicamentos y demanda.
3. La carga de datos se puede reproducir desde cero siguiendo el README.
4. Una hoja de cálculo de inventario se importa desde la interfaz y las alertas se actualizan.
5. Ninguna respuesta del agente expone datos identificables de un paciente.
6. La solución queda desplegada en una URL pública y funciona el día de la presentación.
7. Ninguna página ni endpoint de datos responde sin sesión válida, y cada rol solo puede usar las funciones que le permite la matriz de permisos, verificado en el servidor.

## 4. Usuarios y roles

| Usuario | Rol en el sistema | Qué necesita | Uso principal |
|---|---|---|---|
| Directivo o gerente | `director` | Visión global y decisiones rápidas sobre capacidad y recursos. | Dashboard, alertas, resumen del día y agente. |
| Jefe de servicio (UCI, urgencias, hospitalización) | `service_head` | Estado de su servicio: camas, esperas, demanda. | Preguntas al agente y KPIs filtrados por servicio. |
| Personal médico | `medic` | Consultar el estado del hospital y la demanda de su servicio. | Dashboard, alertas y preguntas al agente (solo lectura). |
| Administrador del sistema (TI) | `admin` | Gestionar cuentas y cuidar la calidad de los datos cargados. | Administración de usuarios, historial y reversión de importaciones, logs. |
| Jurado (usuario de la demo) | Cuentas demo por rol | Ver que la solución resuelve el reto de forma segura. | Las 4 preguntas de la demo, importación, dashboard, alertas y control de acceso. |

Cada usuario tiene un solo rol. La matriz de permisos está en el requerimiento AUT-03 (sección 9.8). El jurado no es un rol del sistema: usa las cuentas demo de los roles anteriores, según el guion de la sección 12.

## 5. Alcance

**Dentro del alcance:**
- Carga de datos históricos del HIS (admisiones, triage, atención, servicios, farmacia y cirugía) y generación de tablas complementarias.
- Importador de hojas de cálculo (CSV y XLSX) con plantillas, validación y vista previa.
- Agente NL2SQL con plan B de preguntas predefinidas.
- Dashboard de KPIs con filtro por servicio.
- Panel de fuentes integradas con la trazabilidad de cada carga.
- Alertas y recomendaciones basadas en reglas.
- Autenticación con correo y contraseña (Supabase Auth), roles con permisos por función y página de administración de usuarios.
- Modo contingencia sin conexión (PWA) con los últimos KPIs, alertas y respuestas predefinidas en caché.
- Seguridad básica: solo lectura para el agente, validación de SQL, anonimización, control de acceso por rol y protección del importador.
- Despliegue en Vercel y README completo.

**Fuera del alcance:**
- Integración en tiempo real con la historia clínica electrónica.
- Edición manual de datos desde la aplicación.
- Modelos de machine learning entrenados.
- Consultas nuevas al agente sin conexión y sincronización bidireccional de datos offline.
- Importación de archivos de más de 4 MB desde la interfaz (esos se cargan por script).
- Autorregistro de usuarios, recuperación de contraseña por correo e inicio de sesión con proveedores externos (Google, Microsoft).
- Restricción de datos por servicio: el jefe de servicio ve la información de todo el hospital y filtra por su servicio en la interfaz.
- Dashboards con contenido distinto según el rol.
- Aplicación móvil nativa y soporte para varios hospitales.

## 6. Fuentes de datos y brechas identificadas

La fuente es DateBaseHIS, con 7 tablas exportadas como txt: Paciente, Ingresos, Triage, Atencion, Servicios, MedicamentoInsumo y ProgramacionCirugia. Formato real: UTF-8 con BOM, separador `|` y fechas `AAAA-MM-DD HH:MM:SS`. Cubren del 1 de mayo al 21 de septiembre de 2026; Servicios y MedicamentoInsumo llegan hasta la madrugada del 22. El perfil agregado está en `perfil_his.md`.

| Necesidad del reto | Dato disponible | Brecha | Solución adoptada |
|---|---|---|---|
| Camas ocupadas hoy y % de ocupación | Ingresos: CodigoCama, grupo y subgrupo de cama, FechaHospitalizacion (asignación de cama) | No hay fecha de egreso ni inventario de camas. | Egreso estimado según S-07. Capacidad: camas observadas en el histórico (712, `derived`) hasta que se importe la plantilla de camas. |
| Días de inventario de medicamentos | MedicamentoInsumo (solo consumo; mezcla medicamentos y dispositivos) | No hay stock, vencimiento ni tipo de ítem. | Foto simulada de `drug_stock` (CAR-03), reemplazable con el importador; `item_type` derivado (S-15). |
| Tiempo de espera en urgencias por triage | Triage, Atencion, Ingresos.ViaIngreso | El nivel de triage viene dentro de un texto. | Espera = FechaAtencion − FechaTriage (S-06); nivel extraído de ClasificacionTriage (S-16). No hay esperas negativas ni mayores a 24 horas. |
| Uso de quirófanos (programadas vs. realizadas) | ProgramacionCirugia: 4 columnas, sin fecha | Sin fecha ni estado, y el 69 % de las filas apunta a ingresos fuera del extracto. | Cumplimiento sobre programaciones con ingreso en el extracto, por mes del ingreso (S-11). La plantilla quirúrgica del importador puede completar fecha y quirófano. |
| Demanda de servicios y especialidades | Ingresos, Servicios (AreaServicio, Especialidad) | Ninguna crítica. | Consulta directa. |
| Preguntas de "hoy", "última semana" y "este mes" | Fechas de todas las tablas | Los datos terminan el 21 de septiembre. | REFERENCE_DATE = 2026-09-21 (S-01). |

**Decisión del equipo:** los datos que el HIS no trae se cargan como tablas complementarias, derivadas de los datos reales o importadas desde hojas de cálculo. Todo dato simulado se identifica como tal en la base de datos, en la interfaz y en el pitch.

**Datos reales:** llegaron el 23 de septiembre y el desarrollo trabaja directamente con ellos; los datos sintéticos se retiran (CAR-04 pasa a Won't). Los hallazgos del perfil que afectan el diseño son:

| Hallazgo | Evidencia | Consecuencia |
|---|---|---|
| Triage es un export unido a Ingresos: una fila por ingreso, vacía cuando el ingreso no tuvo triage. | 17.781 filas; 1.667 sin OidTriage (9,4 %). | Las filas vacías se descartan y se registran en el reporte de carga. |
| Al leer Triage respetando comillas se pierden 60 filas y un MotivoConsulta llega a 8.640 caracteres (el diccionario dice 2.564). | Se leyeron 17.721 de 17.781 filas; el 0,3 % de OidTriageA no encuentra su triage. | CAR-01 debe cargar exactamente 17.781 filas. Pendiente P-01. |
| CodigoTriage no es el nivel de triage. | 24 códigos por consultorio y área, por ejemplo "PEDIATRIA DIFERIDO CONSULTORIO UNO-TRIAGE 3 (VERDE)". Niveles presentes: 1 a 4. | Nuevo `triage_level` (S-16). Las vistas del agente no exponen CodigoTriage. |
| En urgencias, los niveles 1 y 2 superan la referencia normativa. | Espera promedio de todo el periodo, calculada a partir del perfil: cerca de 27 min en triage 1 y 48 min en triage 2 (Resolución 5596 de 2015: triage 1 inmediato, triage 2 máximo 30 min). | ALE-04 y D7 tienen un hallazgo real para la demo. ALE-04 es el primer Should a construir. |
| FechaHospitalizacion está en casi todos los ingresos. | 99,9 % de los ambulatorios y 100 % de los hospitalarios. | S-05 y S-08 ajustados. |
| El 96,2 % de los ingresos entra por urgencias. | ViaIngreso. | La vía de ingreso no sirve para segmentar la demanda; se segmenta por servicio y especialidad. |
| El egreso estimado a veces queda antes de la asignación de cama o se cruza con el siguiente paciente de la misma cama. | 6,9 % de estancias negativas; 65 camas con dos ingresos activos el 21 de septiembre. | S-07 ajustado. |
| ProgramacionCirugia cubre pacientes e ingresos que no están en el extracto. | Solo el 30,8 % de sus OidIngreso y el 34,4 % de sus IdPaciente existen en el extracto. | S-11 ajustado y referencias lógicas en el modelo. |
| MedicamentoInsumo mezcla medicamentos y dispositivos médicos. | Las áreas de farmacia de dispositivos suman el 33 % de las filas. | `item_type` (S-15). |
| Dos nombres de servicio tienen errores de digitación. | "GINECO OBSTRETICIA" y "UNIDAD DE CUIDAD BASICO NEONATAL". | Se corrigen en la transformación con un mapeo fijo; el valor original queda en el txt de origen. |
| Los txt pesan 196 MB. | Servicios y MedicamentoInsumo, unos 90 MB cada uno. | CAR-07 y riesgo de almacenamiento en la sección 13. |

## 7. Modelo de datos

El detalle de columnas está en los diagramas del modelo de base de datos y del modelo entidad-relación. Esta sección resume la estructura y las decisiones.

### 7.1 Esquemas

| Esquema | Contenido | Quién accede |
|---|---|---|
| `staging` | Copia fiel de las 7 tablas del HIS y de las 3 plantillas del importador, todo como texto, con `batch_id`, número de fila de origen y estado de validación. | Rol `importer` (solo inserción) y script de carga histórica. |
| `core` | Tablas limpias en inglés (`patients`, `admissions`, `triages`, `first_attentions`, `service_lines`, `drug_dispensations`, `surgery_schedules`), complementarias (`bed_inventory`, `drug_stock`), vistas materializadas (`mv_admission_stay`, `mv_bed_occupancy_daily`, `mv_item_catalog`), configuración (`app_settings`, con la fecha de referencia) y perfiles de usuario (`user_profiles`). | Rol `app_backend` y la función `core.apply_batch`. |
| `agent` | Vistas anonimizadas: `v_admissions`, `v_bed_occupancy`, `v_emergency_wait_times`, `v_drug_inventory`, `v_drug_consumption_daily`, `v_service_demand_daily`, `v_surgeries`, `v_diagnosis_monthly`; función `agent.reference_date()`. | Rol `agent_ro` (SQL del LLM) y consultas fijas del dashboard. |
| `audit` | `import_batches`, `import_errors`, `query_log` y `user_admin_log`. | Rol `app_backend` e `importer` (solo lotes y errores). |
| `auth` | Cuentas y credenciales, administradas por Supabase Auth. | Supabase Auth. El backend crea y desactiva cuentas con la service role key. |

### 7.2 Roles de Postgres

| Rol | Permisos | Lo usa |
|---|---|---|
| `agent_ro` | Solo SELECT sobre el esquema `agent`, EXECUTE sobre `agent.reference_date()`, transacciones de solo lectura y `statement_timeout` de 5 segundos. | POST /api/query (SQL generado por el LLM). |
| `importer` | INSERT en `staging`, `audit.import_batches` y `audit.import_errors`; EXECUTE sobre `core.apply_batch`. | POST /api/import. |
| `app_backend` | Lectura de `core` y `agent`; escritura en `core.user_profiles`, `audit.query_log` y `audit.user_admin_log`. | Sesión, administración de usuarios, logs y consultas fijas que no pasan por supabase-js. |

supabase-js se usa para Supabase Auth y para las consultas fijas del dashboard sobre el esquema `agent`, que es el único expuesto en la Data API. Ese esquema no tiene permisos para `anon` ni `authenticated`; el servidor lo lee con la service role key. Todo lo que toca `core` y `audit` va por la conexión pg con el rol que corresponda.

### 7.3 Usuarios

- `auth.users` (Supabase Auth): correo y contraseña. El equipo no guarda contraseñas en tablas propias.
- `core.user_profiles`: `user_id` (PK y FK a `auth.users`), `full_name`, `role` (`director`, `service_head`, `medic`, `admin`), `is_active`, `must_change_password`, `created_by`, `created_at` y `updated_at`.
- `audit.user_admin_log`: quién hizo qué sobre qué cuenta (crear, cambiar rol, desactivar, reactivar, restablecer contraseña), con valor anterior, valor nuevo y fecha.
- `audit.import_batches.imported_by_user_id` (FK a `user_profiles`; nulo solo para cargas por script) y `audit.query_log.user_id`.
- La matriz de permisos vive en un solo archivo de código (`/lib/auth/permissions.ts`), versionado en Git, no en la base de datos. La base solo guarda el rol de cada usuario.

Los perfiles contienen datos personales del personal del hospital. No están en el esquema `agent`, por lo que el agente nunca puede consultarlos.

### 7.4 Decisiones del modelo

| Decisión | Motivo |
|---|---|
| `NombrePaciente` no pasa a `core`; se queda en staging solo mientras se transforma. | Minimización: ninguna consulta lo necesita. |
| `document_type`, `chief_complaint` (MotivoConsulta) y los diagnósticos quedan en `core`, pero ninguna vista del agente los expone. Los diagnósticos solo se exponen en `v_diagnosis_monthly`, agregados por mes y servicio, en grupos de 5 o más casos. | Cumplir SEG-03 sin perder el análisis de diagnósticos. |
| Las vistas del agente usan `patient_key` (hash del id) en lugar de `patient_id`. | La pregunta 4 necesita contar pacientes distintos, pero el agente no debe poder listar ids cruzables con el HIS. |
| `drug_stock` guarda una foto por fecha (`stock_date`); la vista toma la más reciente. | Una importación no pisa la anterior (SEG-12) y un lote se puede revertir (IMP-08). |
| `surgery_schedules` tiene llave sustituta y sus referencias a pacientes e ingresos son lógicas; `scheduled_date` y `operating_room` son nulos salvo que se importe la plantilla. | ProgramacionCirugia no tiene llave primaria ni fecha, y el 69 % de sus filas apunta a ingresos fuera del extracto: una llave foránea física rechazaría la mayoría. |
| Las relaciones por `bed_code` e `item_code` son lógicas, sin llave foránea física. | Si la plantilla de camas o de inventario llega incompleta, una llave foránea rompería la carga histórica. |
| El egreso estimado y la ocupación diaria son vistas materializadas que se refrescan al final de cada carga o importación. | Evitar recalcular sobre más de 580.000 filas en cada consulta (IMP-07, RNF-01). |
| Las filas de Triage sin `OidTriage` se descartan y se registran en `audit.import_errors`. | El export trae una fila vacía por cada ingreso sin triage (1.667). |
| Si `OidTriageA` no existe en Triage, `triage_id` queda nulo y el caso se cuenta en el reporte de carga. | La llave foránea física a `triages` rechazaría el ingreso completo. |
| `triage_level` se extrae de `ClasificacionTriage` al transformar y se guarda en `core.triages`. | CodigoTriage identifica consultorio y área, no el nivel (S-16). |
| El egreso estimado es la última prestación, recortada por la siguiente asignación de la misma cama y nunca anterior a la propia asignación. | Evita estancias negativas y camas con dos pacientes el mismo día (S-07). |
| `item_type` (medicamento o dispositivo) se calcula en la vista materializada `mv_item_catalog`. | La pregunta 2 y DAS-03 hablan de medicamentos, y el HIS mezcla ambos (S-15). |
| Los nombres de servicio con errores de digitación se corrigen con un mapeo fijo en la transformación. | El dashboard y el agente muestran los nombres tal como se proyectan al jurado. |
| La fecha de referencia se guarda en `core.app_settings` y se lee con `agent.reference_date()`. | Vistas, consultas fijas y SQL del LLM deben usar la misma "hoy" que el .env. |
| Las tablas de staging del HIS se vacían después de aplicar la carga histórica; las de las plantillas se conservan. | El staging duplica 196 MB de texto y el plan gratuito de Supabase permite 500 MB. |
| El paso de staging a `core` lo hace la función `core.apply_batch(batch_id)` con SECURITY DEFINER, que el rol `importer` puede ejecutar pero no modificar. | El importador solo puede insertar en staging (SEG-10), pero los datos validados tienen que llegar a `core` (IMP-05). |
| `core.apply_batch` aplica todo o nada: con una sola fila inválida, o con una foto de inventario de fecha repetida, el lote queda `rejected` sin tocar `core`. | Evita inventarios a medias y sobrescrituras silenciosas (IMP-05, SEG-12). |

## 8. Supuestos y su validación

Validados con el perfil de los txt reales. Estado: **Confirmado** (el valor por defecto se mantiene), **Ajustado** (la regla cambió por los datos) o **Pendiente**.

| ID | Regla vigente | Evidencia del perfil | Estado |
|---|---|---|---|
| S-01 | "Hoy" es REFERENCE_DATE = 2026-09-21. "Este mes" = 1 al 21 de septiembre; "última semana" = 15 al 21 de septiembre. | Máximo de FechaIngreso: 2026-09-21 14:33. Ninguna fecha de Ingresos o Triage es posterior. | Confirmado |
| S-02 | "Servicio" es NombreGrupoCama (9 valores); "subservicio" es NombreSubgrupoCama (19 valores). | Ninguna de las 712 camas aparece en más de un grupo. | Confirmado |
| S-03 | UCI es el grupo UNIDAD DE CUIDADO INTENSIVO, con tres subgrupos: adultos, neonatal y pediátrica. Cuidado intermedio y cuidado básico no son UCI. Se reporta el total y el desglose por subgrupo. | 46 camas observadas: 19 adultos, 18 neonatal y 9 pediátrica. | Ajustado |
| S-04 | Un ingreso es de urgencias si ViaIngreso = 'Urgencias'. | 4 valores; 'Urgencias' es el 96,2 %. | Confirmado |
| S-05 | "Pacientes ingresados" son pacientes distintos con ClaseIngreso = 'Hospitalario' en el periodo. FechaHospitalizacion no sirve para esto. | 'Hospitalario' es el 62,1 %; el 99,9 % de los ambulatorios también tiene FechaHospitalizacion. | Ajustado |
| S-06 | Espera = FechaAtencion − FechaTriage en minutos; si no hay triage, desde FechaIngreso. Se excluyen valores menores a 0 o mayores a 1.440 min. | 0 % de esperas negativas o mayores a 1.440 min; mediana de 53 min en urgencias. El triage ocurre en promedio 2 min antes del ingreso. | Confirmado |
| S-07 | Egreso estimado = la menor fecha entre la última prestación del ingreso (Servicios o MedicamentoInsumo) y la siguiente asignación de la misma cama; nunca anterior a la propia asignación. | Con la regla anterior: 6,9 % de estancias negativas y 65 camas con dos ingresos activos el mismo día. | Ajustado |
| S-08 | Una cama está ocupada en la fecha F si tiene un ingreso con FechaHospitalizacion ≤ F ≤ egreso estimado. Incluye urgencias, recuperación y sala de partos, porque FechaHospitalizacion es la asignación de cama. | 17.774 de 17.781 ingresos tienen cama asignada. | Ajustado |
| S-09 | La capacidad de cada subservicio son las camas observadas en el histórico, salvo que se importe la plantilla de camas. | 712 camas, de las cuales 189 son de urgencias y 34 de recuperación. | Confirmado (capacidad `derived`) |
| S-10 | Consumo diario promedio = SUM(Cantidad) de los 30 días hasta REFERENCE_DATE ÷ 30, por ítem. | 973 de 1.327 códigos tuvieron consumo en esos 30 días; ninguna cantidad es negativa o cero. | Confirmado |
| S-11 | El universo son las programaciones (ConsecutivoProgramacion) cuyo OidIngreso existe en el extracto. Una programación es realizada si al menos uno de sus servicios aparece prestado para ese ingreso. El mes es el del ingreso. | No hay columna de fecha; solo el 30,8 % de los OidIngreso existe en el extracto; el 17,1 % de todas las filas cruza con Servicios. | Ajustado |
| S-12 | Fechas en hora de Colombia, sin zona horaria. UTF-8 con BOM, separador `|`, formato `AAAA-MM-DD HH:MM:SS`. | 100 % de las fechas parseadas con ese formato; ninguna a las 00:00. | Confirmado |
| S-13 | La matriz de permisos de AUT-03 refleja lo que necesita cada perfil del hospital. | No depende de los datos. | Pendiente (equipo) |
| S-14 | Cada usuario tiene un solo rol. | No depende de los datos. | Confirmado |
| S-15 | Un ítem es dispositivo si la mayoría de sus dispensaciones viene de áreas cuyo nombre contiene "DISPOS"; si no, es medicamento. | Las áreas de dispositivos suman el 33 % de las filas de MedicamentoInsumo. | Pendiente (revisar 10 códigos de cada tipo) |
| S-16 | El nivel de triage es el número que sigue a "TRIAGE" en ClasificacionTriage. | Los 24 textos siguen ese patrón; hay niveles 1 a 4 y ninguno 5. | Confirmado |

## 9. Requerimientos funcionales

Prioridad según MoSCoW: **Must** (obligatorio), **Should** (importante), **Could** (si hay tiempo), **Won't** (no se hará en el MVP).

### 9.1 Carga de datos históricos (CAR)

| ID | Requerimiento | Prioridad |
|---|---|---|
| CAR-01 | Script que carga los 7 txt en tablas staging con las mismas columnas del origen. Por defecto UTF-8 con BOM y separador `|`, ambos configurables. Verifica que las filas cargadas coincidan con las del origen (Triage: 17.781). | Must |
| CAR-02 | Transformación de staging a tablas limpias: tipos correctos, fechas normalizadas, manejo de nulos y duplicados, y nombres en inglés. | Must |
| CAR-03 | Generación de tablas complementarias: `bed_inventory` con las camas observadas (`derived`), egreso estimado (S-07) y una foto simulada de `drug_stock` con `stock_date` = REFERENCE_DATE para los medicamentos con consumo en los últimos 30 días. Existencias = consumo diario × días de cobertura aleatorios con semilla fija, de modo que entre 8 y 12 medicamentos queden por debajo de 5 días y entre 10 y 15 entre 5 y 10 días. Todo marcado `simulated`. | Must |
| CAR-04 | Datos semilla sintéticos con estructura idéntica al diccionario. Ya no hacen falta: los datos reales llegaron. | Won't |
| CAR-05 | Reporte de carga por tabla: filas leídas, cargadas y descartadas, con el motivo. | Should |
| CAR-06 | Carga idempotente: se puede repetir sin duplicar datos. | Should |
| CAR-07 | Después de aplicar la carga histórica, vaciar las tablas de staging del HIS y medir el tamaño de la base. Meta: menos de 400 MB (el plan gratuito permite 500 MB). | Must |
| CAR-08 | Al final de la carga, escribir REFERENCE_DATE del .env en `core.app_settings` y refrescar las vistas materializadas. | Must |

### 9.2 Agente conversacional NL2SQL (AGE)

| ID | Requerimiento | Prioridad |
|---|---|---|
| AGE-01 | Campo de chat para escribir preguntas en español. | Must |
| AGE-02 | Generación de SQL para PostgreSQL mediante un LLM. El prompt incluye el esquema de las vistas autorizadas, los 9 servicios con sus sinónimos (por ejemplo, UCI = UNIDAD DE CUIDADO INTENSIVO), ejemplos few-shot y la instrucción de usar `agent.reference_date()` en lugar de CURRENT_DATE. | Must |
| AGE-03 | Validación del SQL antes de ejecutarlo, según las reglas de seguridad (SEG). | Must |
| AGE-04 | Ejecución con el rol de solo lectura. La respuesta JSON incluye: pregunta, SQL, columnas, filas, respuesta en texto y origen (LLM o predefinida). | Must |
| AGE-05 | Plan B: si el LLM falla, se agota la cuota, el SQL no pasa la validación o falla al ejecutarse (error o timeout), se busca la pregunta en un diccionario de preguntas predefinidas (mínimo las 4 de la demo más 10 adicionales). | Must |
| AGE-06 | Respuesta en lenguaje natural, corta, que empieza con el dato principal. | Must |
| AGE-07 | Mensajes claros cuando la pregunta está fuera de alcance, no hay datos o se piden datos sensibles. | Must |
| AGE-08 | Resultado mostrado como tabla y, cuando aplique, como gráfico automático de barras o línea. | Should |
| AGE-09 | SQL ejecutado visible en una sección plegable. | Should |
| AGE-10 | Preguntas sugeridas como botones, incluidas las 4 de la demo. | Should |
| AGE-11 | Historial de preguntas de la sesión. | Could |
| AGE-12 | Preguntas de seguimiento con contexto, por ejemplo "¿y en pediatría?". | Could |

### 9.3 Dashboard de KPIs (DAS)

| ID | Requerimiento | Prioridad |
|---|---|---|
| DAS-01 | Tarjeta de ocupación de camas: % total y % por servicio en la fecha de referencia. | Must |
| DAS-02 | Tarjeta de tiempo de espera promedio en urgencias de la última semana (minutos), con desglose por nivel de triage (`triage_level`). | Must |
| DAS-03 | Tarjeta de medicamentos (`item_type` = medicamento) con stock crítico (menos de 5 días), con conteo y tabla de detalle. | Must |
| DAS-04 | Gráfico de uso de quirófanos: programaciones con ingreso en el extracto vs. realizadas, por mes del ingreso (S-11). Muestra el universo ("sobre N programaciones"). | Must |
| DAS-05 | Gráfico de demanda: ingresos por servicio y servicios prestados por especialidad. | Must |
| DAS-06 | Medicamentos e insumos con mayor y menor rotación (top 10 de cada uno). | Must |
| DAS-07 | Datos del dashboard servidos por GET /api/kpis, precalculados con vistas o consultas fijas. | Must |
| DAS-08 | Evolución de la ocupación diaria en los últimos 30 días (gráfico de línea). | Should |
| DAS-09 | Estancia promedio por servicio (días). | Should |
| DAS-10 | Filtro por servicio, como parámetro de GET /api/kpis. Aplica a ocupación, demanda de ingresos y estancia; las tarjetas sin servicio asociado (espera en urgencias, medicamentos y quirófanos) se muestran como "Todo el hospital". | Must |
| DAS-11 | Tabla de ingresos sin datos sensibles: servicio, fecha, triage y especialidad. | Could |
| DAS-12 | Panel de fuentes integradas (antes D4): tablas cargadas con filas por tabla, historial de lotes con área de origen, usuario, fecha y estado, fecha de la última carga y % de datos simulados. Solo lectura para todos los roles. | Must |
| DAS-13 | Filtro por rango de fechas. | Should |

### 9.4 Alertas y recomendaciones (ALE)

| ID | Requerimiento | Prioridad |
|---|---|---|
| ALE-01 | Alerta de desabastecimiento: crítica con menos de 5 días de inventario, advertencia con menos de 10. Recomienda la cantidad a pedir. | Must |
| ALE-02 | Alerta de ocupación por subservicio: advertencia desde 85 % y crítica desde 95 %. La recomendación nombra el subservicio del mismo servicio con menor ocupación (por ejemplo, trasladar de HOSPITALIZACION 2 a HOSPITALIZACION 3); si no hay uno disponible, sugiere abrir camas o reasignar personal. | Must |
| ALE-03 | Panel de alertas ordenado por severidad, cada una con su texto de acción. | Must |
| ALE-04 | Alerta de tiempo de espera por nivel de triage (`triage_level`) por encima del umbral. Referencia: triage 1 atención inmediata (umbral práctico configurable, por defecto 10 minutos) y triage 2 máximo 30 minutos (Resolución 5596 de 2015); 3 y 4 con umbral configurable. | Should |
| ALE-05 | Recomendación quirúrgica: si el cumplimiento de las programaciones con ingreso en el extracto baja de 80 %, se sugiere revisar la asignación de quirófanos. | Should |
| ALE-06 | Todos los umbrales configurables en un solo archivo. | Should |

### 9.5 Importador de datos (IMP)

| ID | Requerimiento | Prioridad |
|---|---|---|
| IMP-01 | Página de importación, visible solo para roles con permiso de importación, que acepta archivos CSV y XLSX de hasta 4 MB. El archivo se lee en el navegador. Cada rol solo ve las plantillas que puede importar. | Must |
| IMP-02 | Plantillas descargables para: inventario de medicamentos (drug_stock), inventario de camas (bed_inventory) y programación quirúrgica. | Must |
| IMP-03 | Vista previa de las primeras 20 filas antes de confirmar. | Must |
| IMP-04 | Validación por fila: columnas obligatorias, tipos, formato de fechas, valores permitidos y duplicados. Muestra un reporte de errores por fila y columna. | Must |
| IMP-05 | Los datos se envían al servidor (POST /api/import) en lotes de menos de 4 MB y se insertan primero en staging. Solo pasan a las tablas limpias después de validarse, mediante `core.apply_batch`. Todo o nada: si el lote tiene al menos una fila inválida, no se aplica ninguna, el lote queda en estado `rejected` y el usuario corrige el archivo con el reporte de errores. | Must |
| IMP-06 | Cada fila importada registra su origen: nombre del archivo, sistema o área de origen, usuario autenticado que la cargó (id y nombre), fecha y hora, e id del lote. | Must |
| IMP-07 | Al terminar una importación se recalculan los KPIs y alertas afectados. | Must |
| IMP-08 | Revertir un lote completo desde el historial del panel de fuentes (DAS-12), solo `admin`. | Should |
| IMP-09 | Mapeo de columnas: si el archivo no usa los nombres de la plantilla, el usuario asigna cada columna del archivo a un campo del sistema. Sirve para archivos exportados de otros sistemas. | Should |
| IMP-10 | Importación incremental de datos de las tablas del HIS (Ingresos, Servicios, MedicamentoInsumo, etc.) usando la misma estructura del diccionario (solo `admin`). | Could |
| IMP-11 | Plantilla de importación con su mapeo guardado por fuente, para reutilizarla en el siguiente archivo del mismo sistema. | Could |

### 9.6 Modo contingencia sin conexión (OFF)

| ID | Requerimiento | Prioridad |
|---|---|---|
| OFF-01 | La aplicación se puede instalar como PWA (manifest, ícono y nombre) en escritorio y celular. | Should |
| OFF-02 | La interfaz (dashboard, alertas y chat) abre sin conexión gracias a la caché del service worker. | Should |
| OFF-03 | Se guarda en el dispositivo el último snapshot de GET /api/kpis y de las alertas, y se muestra sin conexión. | Should |
| OFF-04 | Aviso visible del estado: "Sin conexión, datos del [fecha y hora]". Al volver la conexión, los datos se actualizan solos. | Should |
| OFF-05 | Sin conexión, las preguntas predefinidas del plan B responden desde la caché con su fecha. Las preguntas libres muestran que el agente requiere conexión. | Should |
| OFF-06 | En el dispositivo solo se guardan datos agregados (KPIs, conteos, alertas), nunca filas a nivel de paciente. | Must (si se implementa OFF) |
| OFF-07 | Las preguntas hechas sin conexión quedan en cola y se envían al volver la conexión. | Could |
| OFF-08 | Importación sin conexión. | Won't |
| OFF-09 | Sin conexión, el snapshot solo se muestra si en ese dispositivo hubo una sesión válida no vencida. Cerrar sesión borra la caché de datos del dispositivo. | Must (si se implementa OFF) |

### 9.7 Seguridad (SEG)

| ID | Requerimiento | Prioridad |
|---|---|---|
| SEG-01 | Solo se ejecuta SELECT (incluido WITH … SELECT) y una única sentencia. Se bloquean INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, COPY y los punto y coma intermedios. La única función propia permitida es `agent.reference_date()`. | Must |
| SEG-02 | LIMIT forzado de máximo 200 filas si la consulta no lo trae o pide más. | Must |
| SEG-03 | El agente solo consulta vistas anonimizadas en el esquema `agent`. Esas vistas no incluyen NombrePaciente, TipoDocumento, MotivoConsulta, el id real del paciente ni diagnósticos a nivel de paciente; los diagnósticos solo se exponen agregados. | Must |
| SEG-04 | Las preguntas sobre una persona identificable se rechazan con un mensaje explicativo. | Must |
| SEG-05 | statement_timeout de 5 segundos en el rol del agente. | Must |
| SEG-06 | Log de cada consulta: usuario, pregunta, SQL y resultado (éxito o error), sin guardar las filas devueltas. | Should |
| SEG-07 | Límite de solicitudes por usuario en /api/query. | Could |
| SEG-08 | Login con JWT y roles. | Reemplazado por AUT (Must) |
| SEG-09 | La página y el endpoint de importación exigen sesión y permiso de importación para la plantilla enviada. Reemplaza la clave de administrador de la v0.2. | Must |
| SEG-10 | Las importaciones usan un rol de Postgres exclusivo con permiso solo para insertar en staging y ejecutar `core.apply_batch`. El agente nunca usa ese rol y el rol de solo lectura se mantiene intacto. | Must |
| SEG-11 | Validación del archivo: extensión, tipo, tamaño, número máximo de filas, y texto sin fórmulas (celdas que empiezan por =, +, − o @ se tratan como texto). | Must |
| SEG-12 | Las importaciones no sobrescriben datos existentes. Un lote de inventario de medicamentos con una fecha de foto (`stock_date`) que ya existe para alguno de sus medicamentos se rechaza completo, con un mensaje que indica la fecha repetida. | Must |
| SEG-13 | El autorregistro está deshabilitado en la configuración de Supabase Auth; las cuentas solo se crean desde la página de administración o el script de arranque. | Must |
| SEG-14 | La service role key de Supabase solo existe en el servidor, en una variable sin prefijo `NEXT_PUBLIC_`, y nunca llega al navegador. | Must |
| SEG-15 | Los permisos se verifican en el servidor (middleware y cada controlador). Ocultar botones en la interfaz no cuenta como control de acceso. | Must |
| SEG-16 | Reemplazar una foto de inventario existente con confirmación explícita del usuario. | Should |

### 9.8 Autenticación y usuarios (AUT)

| ID | Requerimiento | Prioridad |
|---|---|---|
| AUT-01 | Inicio de sesión con correo y contraseña mediante Supabase Auth. Todas las páginas y endpoints (/api/query, /api/kpis, /api/import, /api/admin/*) exigen sesión válida: sin sesión, las páginas redirigen a /login y los endpoints responden 401. | Must |
| AUT-02 | Cuatro roles: `director`, `service_head`, `medic` y `admin`. Cada usuario tiene un solo rol, guardado en `core.user_profiles`. | Must |
| AUT-03 | Matriz de permisos por función definida en un solo archivo (`/lib/auth/permissions.ts`) y aplicada en el servidor. Una acción sin permiso responde 403. Ver la matriz abajo. | Must |
| AUT-04 | Página de administración de usuarios (solo `admin`): listar usuarios, crear usuario con nombre, correo, rol y contraseña temporal, cambiar el rol y desactivar o reactivar una cuenta. | Must |
| AUT-05 | Un usuario desactivado pierde el acceso en su siguiente solicitud: el servidor verifica `is_active` en cada request, no solo el token. | Must |
| AUT-06 | Script de arranque idempotente que crea el primer usuario `admin` con los datos definidos en .env. Sin él no hay quién cree las demás cuentas. | Must |
| AUT-07 | Un administrador no puede desactivarse ni quitarse el rol `admin` a sí mismo, y siempre debe quedar al menos un `admin` activo. | Must |
| AUT-08 | Cierre de sesión visible en toda la aplicación y nombre y rol del usuario en la barra superior. | Must |
| AUT-09 | Restablecer la contraseña de un usuario desde la página de administración (nueva contraseña temporal). | Should |
| AUT-10 | Cambio de contraseña obligatorio en el primer ingreso y después de un restablecimiento. Si no se implementa, `must_change_password` se conserva en el modelo, pero la aplicación no lo usa. | Should |
| AUT-11 | Registro en `audit.user_admin_log` de cada acción de administración (crear, cambiar rol, desactivar, reactivar, restablecer) con actor, cuenta afectada, valor anterior, valor nuevo y fecha. | Should |
| AUT-12 | Expiración de la sesión tras 8 horas de inactividad. | Should |
| AUT-13 | Autorregistro, recuperación de contraseña por correo e inicio de sesión con Google o Microsoft. | Won't |
| AUT-14 | Restricción de datos por servicio para el jefe de servicio. | Won't |
| AUT-15 | Pantalla de logs (solo `admin`, solo lectura): consultas del agente (`audit.query_log`) y acciones de administración (`audit.user_admin_log`), con filtro por usuario y fecha. | Could |

**Matriz de permisos (AUT-03)**

| Función | Directivo | Jefe de servicio | Administrativo | Farmacia | Administrador |
|---|:---:|:---:|:---:|:---:|:---:|
| Dashboard y alertas | ✓ | ✓ | ✓ | ✓ | ✓ |
| Resumen del día (solo si se implementa D5) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Agente conversacional | ✓ | ✓ | ✓ | ✓ | ✓ |
| Panel de fuentes e historial de importaciones, solo lectura (DAS-12) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Importar inventario de camas | — | — | ✓ | — | ✓ |
| Importar programación quirúrgica | — | — | ✓ | — | ✓ |
| Importar inventario de medicamentos | — | — | — | ✓ | ✓ |
| Revertir un lote de importación | — | — | — | — | ✓ |
| Importación incremental de tablas del HIS | — | — | — | — | ✓ |
| Gestionar usuarios | — | — | — | — | ✓ |
| Ver log de consultas del agente y de administración (AUT-15, Could) | — | — | — | — | ✓ |

## 10. Requerimientos no funcionales

| ID | Categoría | Requerimiento |
|---|---|---|
| RNF-01 | Rendimiento | El agente responde en menos de 10 segundos y el dashboard carga en menos de 3. |
| RNF-02 | Disponibilidad | Desplegado en Vercel con URL pública. La demo funciona aunque falle el LLM, gracias al plan B. |
| RNF-03 | Privacidad | El LLM solo recibe el esquema, la pregunta y, si hace falta redactar la respuesta, datos agregados. Nunca recibe filas a nivel de paciente ni datos de usuarios, porque el plan gratuito del proveedor puede usar esos datos. |
| RNF-04 | Seguridad | Credenciales solo en .env, que está en .gitignore. Se publica un .env.example sin valores. La API key del LLM y la service role key de Supabase solo existen en el servidor. |
| RNF-05 | Usabilidad | Interfaz en español, en blanco y negro, legible en proyector. Desde el dashboard se llega al chat en máximo un clic. Las opciones sin permiso no se muestran en el menú. |
| RNF-06 | Mantenibilidad | Arquitectura MVC: vistas en /app, controladores en /app/api y lógica en /lib. Código en inglés; documentación y comentarios en español. |
| RNF-07 | Portabilidad | README con instalación desde cero, variables de entorno, carga de datos, creación del administrador inicial y ejecución local. |
| RNF-08 | Costo | 0 USD, usando los planes gratuitos de Supabase (base de datos y Auth), Vercel, Gemini (principal) y Groq (respaldo). |
| RNF-09 | Transparencia de datos | Todo dato simulado o derivado queda identificado en la base de datos y en la interfaz. |
| RNF-10 | Resiliencia del LLM | Ante un error 429 o de cuota: un reintento, luego el proveedor de respaldo y luego el plan B. Se usa una API key dedicada a la demo. |
| RNF-11 | Compatibilidad | Navegadores modernos de escritorio. El diseño responsive es opcional (Could). |
| RNF-12 | Importación | Un archivo de 5.000 filas se valida e importa en menos de 30 segundos. |
| RNF-13 | Offline | Instalada la PWA, sin conexión abre en menos de 3 segundos con el último snapshot disponible. |
| RNF-14 | Trazabilidad | Todo dato del sistema se puede rastrear hasta su fuente: carga histórica, importación (archivo, lote y usuario) o dato simulado. |
| RNF-15 | Autenticación | Contraseñas de mínimo 10 caracteres. La verificación de sesión y permisos agrega menos de 200 ms a cada solicitud. |
| RNF-16 | Consistencia de errores | Todos los endpoints responden los errores con el mismo formato, `{ error: { code, message } }`, y el código HTTP que corresponda (400, 401, 403, 413, 422, 500 o 503). `message` va en español, listo para mostrar al usuario. El detalle por caso se define en el contrato de API. |

## 11. Definición de KPIs y reglas de negocio

| KPI | Fórmula | Fuente |
|---|---|---|
| Ocupación por servicio y subservicio (%) | Camas ocupadas en la fecha F ÷ capacidad × 100 (S-08) | Ingresos, egreso estimado, bed_inventory |
| Promedio de camas ocupadas (diario y mensual) | Promedio de las camas ocupadas cada día del periodo | Igual al anterior |
| Tiempo de espera promedio por triage (min) | Promedio de FechaAtencion − FechaTriage, agrupado por `triage_level` (S-06, S-16) | Triage, Atencion, Ingresos |
| Cumplimiento quirúrgico (%) | Programaciones realizadas ÷ programaciones con ingreso en el extracto × 100, por mes del ingreso (S-11) | ProgramacionCirugia, Servicios, Ingresos |
| Consumo diario promedio | Suma de Cantidad de los 30 días hasta REFERENCE_DATE ÷ 30, por ítem | MedicamentoInsumo |
| Días de inventario | Stock actual ÷ consumo diario promedio; la pregunta 2 y DAS-03 solo incluyen `item_type` = medicamento | drug_stock, MedicamentoInsumo |
| Rotación de medicamentos | Cantidad dispensada en el periodo: top 10 mayor y menor (solo con consumo mayor a 0) | MedicamentoInsumo |
| Demanda por servicio | Ingresos por NombreGrupoCama en el periodo | Ingresos |
| Demanda por especialidad | Servicios prestados por Especialidad en el periodo | Servicios |
| Estancia promedio (días) | Egreso estimado − FechaHospitalizacion (S-07) | Ingresos, egreso estimado |

## 12. Criterios de aceptación de la demo

| Pregunta | Lógica esperada | Forma de la respuesta | Valor de referencia preliminar |
|---|---|---|---|
| ¿Cuántas camas de UCI están ocupadas hoy? | Camas del grupo UNIDAD DE CUIDADO INTENSIVO ocupadas el 2026-09-21 (S-03, S-08). | "Hay X de Y camas UCI ocupadas (Z %)", con desglose por subgrupo. | 30 de 46 (65,2 %): adultos 9 de 19, neonatal 15 de 18, pediátrica 6 de 9. Puede bajar con la regla nueva de S-07. |
| ¿Cuáles son los medicamentos con menos de 5 días de inventario? | Medicamentos (`item_type` = medicamento) con días de inventario menores a 5, ordenados de menor a mayor. | Tabla con nombre, stock, consumo diario y días restantes, más el conteo total y la etiqueta de dato simulado. | Entre 8 y 12 medicamentos, por construcción de la foto simulada (CAR-03). |
| ¿Cuál es el tiempo de espera promedio en urgencias en la última semana? | Promedio de espera de los ingresos por urgencias del 15 al 21 de septiembre. | "El tiempo promedio fue de X minutos", con desglose por nivel de triage. | 62,1 minutos sobre 796 ingresos. |
| ¿Qué servicio tiene más pacientes ingresados este mes? | Pacientes distintos con ClaseIngreso = 'Hospitalario' ingresados del 1 al 21 de septiembre, agrupados por servicio. | "El servicio con más pacientes es X, con N pacientes", más una tabla del top 5. | Pediatría, con 405 pacientes. Top 5: Pediatría 405, Hospitalización 394, Recuperación 235, Gineco-obstetricia 153 y Urgencias 95. |

Los valores preliminares salen del perfil y se recalculan con el SQL del plan B una vez cargados los datos; esos resultados quedan como valores esperados en QA.

Cada pregunta se acepta si cumple tres condiciones: el resultado coincide con el SQL de referencia del plan B, responde en menos de 10 segundos y sigue respondiendo con el LLM desactivado.

**Control de acceso en la demo:** las 4 preguntas se hacen con una cuenta `director`. Además se muestra que la cuenta `admin` puede importar el inventario de medicamentos y que la cuenta `director` no ve el importador; y que un intento directo a POST /api/import con la cuenta `director` responde 403. Las cuentas demo se crean desde la página de administración y se verifican en la fase de QA.

## 13. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La carga de Triage pierde filas por comillas dentro de MotivoConsulta. | Medio | CAR-01 valida el conteo (17.781) y lee sin comillas si hace falta (P-01). |
| Los datos reales difieren del diccionario (ya pasó con el nivel de triage y con ProgramacionCirugia). | Medio | Capa staging y de mapeo; los cambios quedan en la transformación y en las vistas. |
| Las fechas históricas dejan vacías las preguntas de "hoy", o el LLM usa CURRENT_DATE. | Alto | REFERENCE_DATE = 2026-09-21, guardada en la base y expuesta con `agent.reference_date()`; los few-shot la usan. |
| El LLM genera SQL incorrecto. | Alto | Vistas simples con nombres claros, few-shot con las 4 preguntas de la demo, validación previa y plan B. |
| Se agota la cuota del LLM durante la demo. | Alto | API key exclusiva para la demo, Groq como respaldo, plan B y caché de las 4 preguntas. |
| Fuga de datos personales. | Alto | Vistas anonimizadas, `patient_key` en lugar del id, validación de columnas y una prueba con pregunta trampa en QA. |
| Consultas lentas sobre tablas de más de 580.000 filas. | Medio | Índices en fechas y llaves, vistas materializadas para los KPIs y statement_timeout. |
| El pooler de Supabase en modo transaction no admite prepared statements. | Medio | Configurar el cliente pg sin prepared statements; se prueba en la fase de setup. |
| Los datos superan los 500 MB del plan gratuito de Supabase: los txt suman 196 MB y el staging los duplica. | Alto | CAR-07 vacía el staging del HIS tras la carga y mide el tamaño. Si aún excede, se pasan los nombres de servicios y medicamentos a catálogos y, como último recurso, se cargan solo julio a septiembre en las tablas de detalle. |
| El LLM usa CodigoTriage como nivel de triage. | Alto | Las vistas del agente solo exponen `triage_level` y `triage_classification`. |
| Las cifras de ocupación dependen del egreso estimado y el jurado puede cuestionarlas. | Medio | Regla S-07 documentada, respuesta transparente (D1) y mención en el pitch. |
| El KPI de quirófanos cubre solo una parte de la programación. | Medio | La tarjeta y la respuesta muestran el universo ("sobre N programaciones con ingreso en el periodo"). |
| Los archivos grandes superan el límite de las funciones de Vercel. | Medio | Lectura en el navegador y envío por lotes; los archivos históricos grandes se cargan por script. |
| Alguien con la URL importa datos basura antes o durante la demo. | Alto | Login obligatorio, permiso de importación por rol, autorregistro deshabilitado, rol que solo inserta en staging y reversión por lote. |
| Las hojas reales no siguen la plantilla (columnas distintas, formatos de fecha variados). | Medio | Validación con reporte de errores y mapeo de columnas (IMP-09). |
| El service worker muestra datos viejos estando en línea. | Medio | Estrategia de caché que primero intenta la red y siempre muestra la fecha del dato. |
| El modo offline consume tiempo necesario para lo Must. | Alto | OFF queda como Should y solo se inicia con los Must funcionando. |
| El login entra en la ruta crítica y retrasa el agente y el dashboard. | Alto | Supabase Auth en lugar de autenticación propia; middleware, matriz de permisos y script del administrador se hacen en la fase 3 (setup), antes del core; la página de administración arranca con lo mínimo (listar, crear, cambiar rol, desactivar). |
| Los permisos solo se aplican en la interfaz y un endpoint queda abierto. | Alto | Verificación en el servidor (SEG-15) y pruebas por rol contra cada endpoint en QA. |
| Se filtra la service role key al navegador o al repositorio. | Alto | Variable sin prefijo `NEXT_PUBLIC_`, uso solo en /lib del servidor y revisión del bundle en QA. |
| El día de la demo nadie recuerda las credenciales o el administrador queda bloqueado. | Medio | Script de arranque idempotente que recrea el `admin` desde .env, regla de al menos un `admin` activo (AUT-07) y cuentas demo verificadas en QA. |
| Iniciar sesión frente al jurado consume tiempo o falla. | Medio | Sesión abierta antes de presentar, cuentas demo por rol anotadas en el guion y expiración de 8 horas. |
| El alcance crece más de lo que da el tiempo. | Alto | Prioridad MoSCoW; los diferenciadores solo se trabajan cuando todo lo Must esté completo. |
| El Must crece con DAS-10 y DAS-12 en la versión 0.4. | Medio | Versiones mínimas: el filtro por servicio es un solo parámetro de GET /api/kpis y el panel de fuentes es una tabla y cuatro cifras leídas de `audit.import_batches`, sin gráficos. |

## 14. Funcionalidades diferenciadoras sugeridas

Para elegirlas se usaron tres criterios: que ataquen directamente un antecedente del caso, que sean baratas de construir sobre lo que ya existe y que se vean en la demo. Todas se trabajan en la fase 5, cuando lo Must esté terminado.

| # | Funcionalidad | Qué problema ataca | Por qué suma en la hackathon | Esfuerzo | Recomendación |
|---|---|---|---|---|---|
| D1 | **Respuesta transparente:** cada respuesta muestra el SQL, las tablas usadas, cómo se calculó y una etiqueta si incluye datos simulados. | Desconfianza en los datos; hoy dependen de TI para validar los reportes. | El jurado ve que la IA no "inventa" y que el sistema es auditable. | Bajo | Hacer |
| D2 | **Pronóstico de agotamiento:** para cada medicamento crítico, fecha estimada de quiebre y cantidad sugerida a pedir para cubrir N días. | Alertas tempranas de desabastecimiento, que el reto pide explícitamente. | Pasa de mostrar un dato a recomendar una acción concreta. | Bajo | Hacer |
| D3 | **Guardrail de privacidad demostrable:** en la demo se pide el nombre de un paciente y el agente se niega explicando por qué. | Confidencialidad, un requisito explícito del reto. | Demuestra seguridad en 10 segundos de demo; la funcionalidad ya existe por SEG-04. | Bajo | Hacer (guion de demo) |
| D4 | **Panel "fuente única de verdad":** fuentes integradas, filas cargadas, cada lote importado con su área de origen, usuario y fecha, fecha de la última carga y % de datos simulados. | Información fragmentada en hojas de cálculo y bases separadas. | Es la prueba visible de que el sistema centraliza hojas y sistemas dispersos. | Bajo | Incorporado como DAS-12 (Must) |
| D5 | **Resumen ejecutivo del día:** un botón genera un resumen de 5 líneas (ocupación, alertas críticas, espera, stock) a partir de los KPIs ya calculados. | Directivos que pierden horas armando reportes. | Muy vistoso para un jurado no técnico y el LLM solo recibe agregados. | Bajo a medio | Hacer |
| D6 | **Mapa de calor de llegadas a urgencias** por hora y día de la semana, con recomendación de refuerzo de personal por turno. | Recomendación de reasignar personal, que el reto pide. | Convierte datos históricos en una decisión de personal. | Bajo a medio | Hacer |
| D7 | **Análisis de causa raíz de los tiempos de espera:** desglose por turno (día y noche), día de la semana y triage, con una frase automática como "el aumento se concentra en triage 3 del turno noche". | Es exactamente el ejemplo de innovación que da el reto. | Alto impacto porque el jurado lo reconoce del enunciado. | Medio | Hacer si hay tiempo |
| D8 | **Proyección de ingresos y ocupación a 7 días** con promedio móvil por día de la semana, más alerta anticipada. | Alertas predictivas y picos de demanda. | Cubre el componente "predictivo" sin entrenar modelos. | Medio | Opcional |
| D9 | **Exportar respuesta o tabla a CSV.** | Dependencia de TI para obtener reportes. | Útil y rápido de construir, pero poco vistoso. | Bajo | Opcional |
| D10 | **Preguntas de seguimiento conversacionales** ("¿y en pediatría?"). | Agilidad en la consulta. | Mejora la experiencia de conversación, pero aumenta el riesgo de SQL incorrecto. | Medio | Opcional |
| D11 | **Dictado por voz** con la API de voz del navegador. | Rapidez de uso. | Llamativo, pero riesgoso en la demo por el ruido del auditorio y la compatibilidad del navegador. | Bajo | No priorizar |
| D12 | **Dashboards con contenido distinto por rol.** Los roles y permisos ya existen por AUT; lo que queda fuera es personalizar qué muestra el dashboard a cada rol. | Necesidades distintas según el usuario. | Demasiado costoso para el tiempo disponible. | Medio a alto | No priorizar |

**Orden de implementación recomendado:** Must, empezando por autenticación, roles y script del administrador en la fase de setup, y siguiendo con agente, dashboard, alertas, importador, panel de fuentes y página de administración de usuarios → ALE-04 → D1 → D3 → D2 → modo offline (OFF) → D5 → D6 → D7.

La autenticación va primero porque todos los endpoints dependen de ella: construirla al final obliga a retocar cada controlador. D1 a D3 se construyen casi por completo reutilizando lo que exigen los requerimientos Must; D4 ya forma parte del Must como DAS-12. El modo offline va después porque es Should y no debe competir con lo obligatorio. D5 y D6 aportan el mayor efecto visual frente al jurado. D7 es el que más puntos puede dar, porque corresponde literalmente al ejemplo de innovación del enunciado, y los datos lo permiten: las fechas de triage y atención están completas, con hora y sin esperas negativas. ALE-04 va antes que los diferenciadores porque es barata y el perfil ya muestra esperas de triage 1 y 2 por encima de la norma.

## 15. Pendientes y próximos pasos

1. **P-01:** comprobar que Triage se lee completo. Correr `python profile_his.py data/his --no-quotes --out perfil_sin_comillas.md` y ver si Triage llega a 17.781 filas sin cambiar las demás tablas. El resultado define cómo lee CAR-01.
2. Revisar S-15: 10 códigos al azar clasificados como medicamento y 10 como dispositivo.
3. Validar la matriz de permisos (S-13) con el equipo.
4. Actualizar los diagramas del modelo de base de datos y del modelo entidad-relación a la v0.5: `triage_level`, `app_settings`, `mv_item_catalog`, `agent.reference_date()` y referencias lógicas de `surgery_schedules`.
5. Fase 1: contrato de API (POST /api/query, GET /api/kpis con filtro por servicio, POST /api/import, el endpoint del panel de fuentes, /api/admin/users y, si se hace AUT-15, el de logs; todo con el formato de error de RNF-16), `schema.sql` con los cambios de esta versión y CLAUDE.md con las reglas del proyecto y la matriz de permisos.
6. En Supabase: deshabilitar el autorregistro en Auth, exponer solo el esquema `agent` en la Data API y definir la longitud mínima de contraseña.
7. Crear las API keys de Gemini y Groq y revisar en AI Studio los límites reales del proyecto.
8. Actualizar el documento de contexto del proyecto con el login obligatorio, los endpoints nuevos, REFERENCE_DATE = 2026-09-21 y la precisión sobre supabase-js de la sección 7.2.
