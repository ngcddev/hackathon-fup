# DICCIONARIO DE DATOS HIS

**DateBaseHIS.xlsx — 7 tablas**  
**22 de septiembre de 2026**

## Paciente (14.502 filas)

| Campo | Tipo de dato | Longitud máxima | Acepta nulos | Clave | Descripción |
|---|---|---:|:---:|---|---|
| TipoDocumento | texto | 3 | No | — | Tipo de documento de identidad del paciente (CC, TI, CE, RC, PA, etc.). |
| IdPaciente | entero | 6 | No | PK | Identificador único del paciente. |
| NombrePaciente | texto | 3 | No | — | Iniciales o nombre anonimizado del paciente. |
| FechaNacimiento | fecha | 10 | No | — | Fecha de nacimiento del paciente. |
| Sexo | texto | 9 | No | — | Sexo biológico del paciente (Masculino / Femenino). |
| Asegurador | texto | 148 | No | — | Entidad aseguradora (EPS/ARL) a la que está afiliado el paciente. |
| Regimen | texto | 12 | No | — | Régimen de afiliación al sistema de salud. |
| Departamento | texto | 18 | No | — | Departamento de residencia del paciente. |
| Municipio | texto | 29 | No | — | Municipio de residencia del paciente. |
| Zona | texto | 6 | No | — | Zona de residencia (Urbana / Rural). |

## Ingresos (17.781 filas)

| Campo | Tipo de dato | Longitud máxima | Acepta nulos | Clave | Descripción |
|---|---|---:|:---:|---|---|
| OidIngreso | entero | 7 | No | PK | Identificador único de la admisión o episodio de atención. |
| ConsecutivoIngreso | entero | 7 | No | — | Número consecutivo interno asignado a la admisión. |
| IdPaciente | entero | 6 | No | FK → Paciente | Paciente al que corresponde la admisión. |
| ClaseIngreso | texto | 12 | No | — | Clase de ingreso (Ambulatorio u Hospitalario). |
| ViaIngreso | texto | 20 | No | — | Vía por la que el paciente ingresó a la institución. |
| TipoRiesgo | texto | 37 | No | — | Tipo de riesgo u origen del evento que motivó el ingreso. |
| FechaIngreso | fecha/hora | 19 | No | — | Fecha y hora en que se registró el ingreso. |
| FechaHospitalizacion | fecha/hora | 19 | Sí | — | Fecha y hora en que se efectuó la hospitalización. |
| OidTriageA | entero | 7 | Sí | FK → Triage | Evento de triage asociado a la admisión. |
| CodigoCama | texto | 8 | No | — | Código de la cama asignada. |
| NombreCama | texto | 50 | No | — | Nombre o descripción de la cama. |
| NombreGrupoCama | texto | 28 | No | — | Grupo de camas al que pertenece la cama asignada. |
| NombreSubgrupoCama | texto | 39 | No | — | Subgrupo de camas al que pertenece la cama asignada. |
| CodigoDiagnostico | texto | 4 | Sí | — | Código CIE-10 del diagnóstico principal. |
| NombreDiagnostico | texto | 173 | Sí | — | Descripción del diagnóstico principal. |

## Triage (17.781 filas)

| Campo | Tipo de dato | Longitud máxima | Acepta nulos | Clave | Descripción |
|---|---|---:|:---:|---|---|
| OidTriage | entero | 7 | Sí | PK | Identificador único del evento de triage. |
| FechaTriage | fecha/hora | 19 | Sí | — | Fecha y hora en que se realizó el triage. |
| MotivoConsulta | texto | 2564 | Sí | — | Descripción del motivo de consulta registrado en el triage. |
| TensionArterial | texto | 8 | Sí | — | Tensión arterial del paciente al momento del triage. |
| FrecuenciaCardiaca | texto | 4 | Sí | — | Frecuencia cardiaca del paciente, en latidos por minuto. |
| FrecuenciaRespiratoria | texto | 4 | Sí | — | Frecuencia respiratoria del paciente, en respiraciones por minuto. |
| Temperatura | texto | 5 | Sí | — | Temperatura corporal del paciente, en grados Celsius. |
| IdPaciente2 | entero | 6 | Sí | FK → Paciente | Paciente al que corresponde el triage. |
| CodigoTriage | texto | 2 | Sí | — | Código de la categoría de clasificación de triage. |
| ClasificacionTriage | texto | 58 | Sí | — | Descripción de la clasificación o prioridad asignada en el triage. |

## Atencion (17.375 filas)

| Campo | Tipo de dato | Longitud máxima | Acepta nulos | Clave | Descripción |
|---|---|---:|:---:|---|---|
| OidIngreso | entero | 7 | No | PK, FK → Ingresos | Admisión a la que corresponde el registro de atención. |
| FechaAtencion | fecha/hora | 19 | No | — | Fecha y hora de la primera atención médica. |

## Servicios (582.357 filas)

| Campo | Tipo de dato | Longitud máxima | Acepta nulos | Clave | Descripción |
|---|---|---:|:---:|---|---|
| OidS | entero | 6 | No | PK | Identificador único de la línea de servicio prestado. |
| OidIngreso | entero | 7 | No | FK → Ingresos | Admisión a la que pertenece el servicio. |
| CodigoServicio | texto | 10 | No | — | Código del servicio o procedimiento (CUPS). |
| NombreServicio | texto | 252 | No | — | Descripción del servicio o procedimiento. |
| Cantidad | entero | 3 | No | — | Cantidad de unidades del servicio prestadas. |
| FechaPrestacion | fecha/hora | 19 | No | — | Fecha y hora en que se prestó el servicio. |
| CodigoAreaServicio | texto | 5 | No | — | Código del área hospitalaria que prestó el servicio. |
| AreaServicio | texto | 65 | No | — | Nombre del área hospitalaria que prestó el servicio. |
| Especialidad | texto | 36 | No | — | Especialidad médica que ordenó el servicio. |

## MedicamentoInsumo (579.465 filas)

| Campo | Tipo de dato | Longitud máxima | Acepta nulos | Clave | Descripción |
|---|---|---:|:---:|---|---|
| OidMI | entero | 6 | No | PK | Identificador único de la línea de medicamento o insumo dispensado. |
| OidIngreso | entero | 7 | No | FK → Ingresos | Admisión a la que pertenece el consumo. |
| CodigoServicio | texto | 15 | No | — | Código del medicamento o insumo dispensado. |
| NombreServicio | texto | 300 | No | — | Descripción del medicamento o insumo dispensado. |
| Cantidad | entero | 5 | No | — | Cantidad dispensada. |
| FechaPrestacion | fecha/hora | 19 | No | — | Fecha y hora en que se dispensó el medicamento o insumo. |
| AreaServicio | texto | 58 | No | — | Área que realizó la dispensación (farmacia, UCI, etc.). |
| Especialidad | texto | 36 | No | — | Especialidad médica que prescribió el medicamento o insumo. |

## ProgramacionCirugia (13.046 filas)

| Campo | Tipo de dato | Longitud máxima | Acepta nulos | Clave | Descripción |
|---|---|---:|:---:|---|---|
| ConsecutivoProgramacion | texto | 20 | No | — | Número de la programación quirúrgica; agrupa los servicios de una misma cirugía. |
| IdPaciente | entero | 6 | No | FK → Paciente | Paciente para quien se programó la cirugía. |
| OidIngreso | entero | 7 | Sí | FK → Ingresos | Admisión asociada a la cirugía programada. |
| CodigoServicio | texto | 6 | No | — | Código del servicio quirúrgico programado. |
