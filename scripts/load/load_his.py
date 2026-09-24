#!/usr/bin/env python3
"""
Carga histórica del HIS (CAR-01 a CAR-08).

Lee los 7 txt, los sube a staging con COPY, llama a core.apply_batch, deriva las
camas, genera la foto simulada de drug_stock y cierra con core.finish_historical_load.

Uso (desde la raíz del repo):
    pip install -r scripts/load/requirements.txt
    python scripts/load/load_his.py --dry-run          # solo lee y valida, sin base
    python scripts/load/load_his.py                    # carga completa
    python scripts/load/load_his.py --only triages     # recarga una sola tabla

Variables (.env.local): HIS_LOAD_DATABASE_URL, HIS_DATA_DIR, REFERENCE_DATE,
HIS_ENCODING (utf-8-sig), HIS_SEPARATOR (|). Nunca se imprimen.
Nunca se imprimen datos de pacientes: solo conteos y mensajes.
"""
import argparse
import math
import os
import random
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260923120000_initial_schema.sql"
REPORT_PATH = Path(__file__).resolve().parent / "output" / "load_report.md"
CHUNK = 100_000

# Orden obligatorio por las llaves foráneas: (target_table, archivo, tabla de staging)
TABLES = [
    ("patients", "Paciente.txt", "stg_paciente"),
    ("triages", "Triage.txt", "stg_triage"),
    ("admissions", "Ingresos.txt", "stg_ingresos"),
    ("first_attentions", "Atencion.txt", "stg_atencion"),
    ("service_lines", "Servicios.txt", "stg_servicios"),
    ("drug_dispensations", "MedicamentoInsumo.txt", "stg_medicamento_insumo"),
    ("surgery_schedules", "ProgramacionCirugia.txt", "stg_programacion_cirugia"),
]
HIS_TARGETS = [t[0] for t in TABLES]
EXTRA_TARGETS = ["bed_inventory", "drug_stock"]
DROP_COLUMNS = {"nombre_paciente"}  # minimización: va vacía en staging
EXPECTED_TRIAGE = 17_781
STAGING_COMMON = {"batch_id", "source_row_number", "loaded_at", "validation_status", "primary"}


class LoadError(Exception):
    """Error controlado: el mensaje es seguro de imprimir (sin datos de pacientes)."""


def snake(name: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name).lower()


def staging_columns() -> dict[str, list[str]]:
    """Columnas propias de cada tabla de staging, leídas de la migración."""
    sql = MIGRATION.read_text(encoding="utf-8")
    cols: dict[str, list[str]] = {}
    for m in re.finditer(r"create table staging\.(\w+) \((.*?)\n\);", sql, re.S):
        own: list[str] = []
        for line in m.group(2).splitlines():
            for part in line.split(","):
                word = part.strip().split(" ")[0]
                if word in STAGING_COMMON:
                    break
                if word and word.isidentifier():
                    own.append(word)
            else:
                continue
            break
        cols[m.group(1)] = own
    return cols


class HisFile:
    """Lector sin interpretar comillas: una línea = un registro."""

    def __init__(self, path: Path, encoding: str, sep: str, stg_cols: list[str]):
        self.path, self.encoding, self.sep = path, encoding, sep
        with open(path, encoding=encoding, newline="\n") as f:
            header = f.readline().rstrip("\n").rstrip("\r")
        self.headers = header.split(sep)
        self.columns = [snake(h) for h in self.headers]
        unknown = [h for h, c in zip(self.headers, self.columns) if c not in stg_cols]
        if unknown:
            raise LoadError(f"{path.name}: encabezados sin columna en staging: {', '.join(unknown)}")
        self.physical_lines = 0
        self.records = 0

    def rows(self):
        """Genera (source_row_number, [valores]); el encabezado es la línea 1."""
        n = len(self.headers)
        self.physical_lines = self.records = 0
        empty_line = None  # una línea vacía solo se tolera si es la última del archivo
        with open(self.path, encoding=self.encoding, newline="\n") as f:
            for lineno, raw in enumerate(f, start=1):
                self.physical_lines = lineno
                if lineno == 1:
                    continue
                if empty_line is not None:
                    raise LoadError(f"{self.path.name}: línea {empty_line} con 1 columnas; "
                                    f"se esperaban {n}.")
                line = raw.rstrip("\n").rstrip("\r")
                if line == "":
                    empty_line = lineno
                    continue
                parts = line.split(self.sep)
                if len(parts) != n:
                    raise LoadError(f"{self.path.name}: línea {lineno} con {len(parts)} columnas; "
                                    f"se esperaban {n}.")
                self.records += 1
                yield lineno, [p.replace("\x00", "") for p in parts]


def load_env():
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env.local")
    except ImportError:
        pass  # en dry-run no se exige python-dotenv
    data_dir = Path(os.environ.get("HIS_DATA_DIR", "data/his"))
    if not data_dir.is_absolute():
        data_dir = ROOT / data_dir
    return {
        "url": os.environ.get("HIS_LOAD_DATABASE_URL"),
        "data_dir": data_dir,
        "ref_date": os.environ.get("REFERENCE_DATE", "2026-09-21"),
        "encoding": os.environ.get("HIS_ENCODING", "utf-8-sig"),
        "sep": os.environ.get("HIS_SEPARATOR", "|"),
    }


def open_files(env, targets):
    cols = staging_columns()
    files = {}
    for target, fname, stg in TABLES:
        if target not in targets:
            continue
        path = env["data_dir"] / fname
        if not path.exists():
            raise LoadError(f"No existe {fname} en la carpeta de datos (HIS_DATA_DIR).")
        files[target] = HisFile(path, env["encoding"], env["sep"], cols[stg])
    return files


def validate_files(files):
    """Recorre cada archivo completo; lanza LoadError si alguna fila no cuadra."""
    for hf in files.values():
        for _ in hf.rows():
            pass


# ---------------------------------------------------------------- dry-run

def dry_run(env):
    files = open_files(env, HIS_TARGETS)
    validate_files(files)
    print(f"{'archivo':26} {'líneas físicas':>15} {'registros':>10} {'columnas':>9}")
    for target, fname, _ in TABLES:
        hf = files[target]
        print(f"{fname:26} {hf.physical_lines:>15,} {hf.records:>10,} {len(hf.headers):>9}")
    tri = files["triages"].records
    ok = tri == EXPECTED_TRIAGE
    print(f"\nTriage: {tri:,} registros (esperado {EXPECTED_TRIAGE:,}) -> {'OK' if ok else 'NO COINCIDE'}")
    if not ok:
        raise LoadError("Triage no coincide; no cargues y revisa la lectura.")


# ---------------------------------------------------------------- carga

def new_batch(conn, load_type, target, file_name, source, simulated=False):
    return conn.execute(
        "insert into audit.import_batches (load_type, target_table, file_name, source_system,"
        " imported_by_user_id, is_simulated) values (%s, %s, %s, %s, NULL, %s) returning batch_id",
        (load_type, target, file_name, source, simulated),
    ).fetchone()[0]


def chunks(it, size):
    buf = []
    for item in it:
        buf.append(item)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


def apply_or_stop(conn, batch_id, label):
    status = conn.execute("select core.apply_batch(%s)", (batch_id,)).fetchone()[0]
    if status != "applied":
        raise LoadError(f"{label}: apply_batch devolvió '{status}'. Revisa audit.import_errors.")


def load_table(conn, target, hf, stg, batch_ids):
    print(f"[{target}] {hf.path.name}")
    cols = hf.columns
    copy_sql = (f"copy staging.{stg} ({', '.join(cols)}, batch_id, source_row_number) from stdin")
    total = 0
    for part, block in enumerate(chunks(hf.rows(), CHUNK), start=1):
        batch_id = new_batch(conn, "historical", target, hf.path.name, "HIS")
        batch_ids.append(batch_id)
        try:
            with conn.cursor() as cur, cur.copy(copy_sql) as cp:
                for rownum, vals in block:
                    cp.write_row([("" if c in DROP_COLUMNS else v) for c, v in zip(cols, vals)]
                                 + [batch_id, rownum])
            apply_or_stop(conn, batch_id, target)
        except Exception:
            conn.execute("update audit.import_batches set status = 'rejected'"
                         " where batch_id = %s and status in ('pending','validated')", (batch_id,))
            conn.execute(f"truncate staging.{stg}")
            raise
        conn.execute(f"truncate staging.{stg}")
        total += len(block)
        print(f"    bloque {part}: {len(block):,} filas")
    print(f"    total leído: {total:,}")


def drug_snapshot(conn, ref_date, batch_ids):
    print("[drug_stock] foto simulada")
    if conn.execute("select 1 from core.drug_stock where stock_date = %s limit 1", (ref_date,)).fetchone():
        print("    ya existe una foto con esa fecha: se omite")
    else:
        pool = conn.execute(
            "select d.item_code, c.item_name, sum(d.quantity) / 30.0"
            " from core.drug_dispensations d join core.mv_item_catalog c using (item_code)"
            " where c.item_type = 'medicamento'"
            "   and d.dispensed_at >= %s::date - 29 and d.dispensed_at < %s::date + 1"
            " group by d.item_code, c.item_name having sum(d.quantity) > 0 order by d.item_code",
            (ref_date, ref_date),
        ).fetchall()
        rng = random.Random(42)
        eligible = [r for r in pool if r[2] >= 1]
        rng.shuffle(eligible)
        low, mid = eligible[:10], eligible[10:22]
        chosen = {r[0] for r in low + mid}
        rest = [r for r in pool if r[0] not in chosen]
        rows = []
        for group, lo, hi in ((low, 1.0, 3.9), (mid, 5.5, 8.9), (rest, 15, 90)):
            for code, name, daily in group:
                cov = round(rng.uniform(lo, hi), 1)
                rows.append((code, name, str(math.ceil(float(daily) * cov))))
        batch_id = new_batch(conn, "seed_synthetic", "drug_stock", None, "synthetic", True)
        batch_ids.append(batch_id)
        copy_sql = ("copy staging.stg_drug_stock (item_code, item_name, current_stock, unit,"
                    " stock_date, expiration_date, batch_id, source_row_number) from stdin")
        with conn.cursor() as cur, cur.copy(copy_sql) as cp:
            for i, (code, name, stock) in enumerate(rows, start=2):
                cp.write_row([code, name, stock, "", ref_date, "", batch_id, i])
        apply_or_stop(conn, batch_id, "drug_stock")
        print(f"    {len(rows):,} ítems (candidatos {len(pool):,}, con consumo >= 1: {len(eligible):,})")
    lt5, b5_10 = conn.execute(
        "select count(*) filter (where days_of_inventory < 5),"
        "       count(*) filter (where days_of_inventory >= 5 and days_of_inventory < 10)"
        " from agent.v_drug_inventory where item_type = 'medicamento'"
    ).fetchone()
    print(f"    verificación: {lt5} con < 5 días (8-12), {b5_10} con 5 a 10 días (10-15)")
    if not (8 <= lt5 <= 12 and 10 <= b5_10 <= 15):
        raise LoadError("La foto simulada no cumple los rangos de CAR-03.")


def build_report(conn, batch_ids):
    lines = ["# Reporte de carga histórica del HIS", "",
             "Solo conteos y mensajes; sin datos de pacientes.", "",
             "| Tabla | Filas leídas | Cargadas | Descartadas |", "|---|---:|---:|---:|"]
    rows = conn.execute(
        "select target_table, sum(rows_read), sum(rows_loaded), sum(rows_rejected)"
        " from audit.import_batches where batch_id = any(%s) group by target_table", (batch_ids,)
    ).fetchall()
    by_t = {r[0]: r for r in rows}
    for t in HIS_TARGETS + EXTRA_TARGETS:
        if t in by_t:
            _, r, ld, d = by_t[t]
            lines.append(f"| {t} | {r:,} | {ld:,} | {d:,} |")
    lines += ["", "## Motivos de descarte y avisos", ""]
    errs = conn.execute(
        "select b.target_table, e.error_message, count(*) from audit.import_errors e"
        " join audit.import_batches b using (batch_id) where b.batch_id = any(%s)"
        " group by 1, 2 order by 1, 3 desc", (batch_ids,)
    ).fetchall()
    if errs:
        lines += ["| Tabla | Motivo | Conteo |", "|---|---|---:|"]
        lines += [f"| {t} | {m.replace('|', '/')} | {c:,} |" for t, m, c in errs]
    else:
        lines.append("Sin errores registrados.")
    return "\n".join(lines) + "\n"


def full_run(env, only):
    if only and only not in HIS_TARGETS + EXTRA_TARGETS:
        raise LoadError(f"--only debe ser uno de: {', '.join(HIS_TARGETS + EXTRA_TARGETS)}")
    if not env["url"]:
        raise LoadError("Falta HIS_LOAD_DATABASE_URL en .env.local.")
    ref = env["ref_date"]
    date.fromisoformat(ref)
    try:
        import psycopg
    except ImportError:
        raise LoadError("Falta psycopg: pip install -r scripts/load/requirements.txt") from None

    targets = [only] if only in HIS_TARGETS else ([] if only else HIS_TARGETS)
    files = open_files(env, targets)
    validate_files(files)  # todo el archivo se valida antes de tocar la base
    if not only and files["triages"].records != EXPECTED_TRIAGE:
        raise LoadError("Triage no coincide con 17.781 registros; ejecuta --dry-run.")

    try:
        conn = psycopg.connect(env["url"], autocommit=True)
    except psycopg.Error:
        raise LoadError("No se pudo conectar a la base (revisa HIS_LOAD_DATABASE_URL).") from None
    with conn:
        conn.execute("set statement_timeout = 0")
        batch_ids: list = []
        for target, _, stg in TABLES:
            if target in files:
                load_table(conn, target, files[target], stg, batch_ids)
        if not only or only == "bed_inventory":
            print("[bed_inventory] derivando camas")
            bid = new_batch(conn, "historical", "bed_inventory", None, "HIS")
            batch_ids.append(bid)
            n = conn.execute("select core.derive_bed_inventory(%s)", (bid,)).fetchone()[0]
            print(f"    {n:,} camas nuevas")
        print("Refrescando vistas materializadas")
        conn.execute("select core.refresh_materialized_views()")
        if not only or only == "drug_stock":
            drug_snapshot(conn, ref, batch_ids)
        report = build_report(conn, batch_ids)
        if not only:
            size = conn.execute("select core.finish_historical_load(%s)", (ref,)).fetchone()[0]
            report += f"\nTamaño de la base: {size}\n"
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        REPORT_PATH.write_text(report, encoding="utf-8")
        print(report)
        print(f"Reporte guardado en {REPORT_PATH.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser(description="Carga histórica del HIS")
    ap.add_argument("--dry-run", action="store_true", help="lee y valida los archivos sin conectarse")
    ap.add_argument("--only", metavar="TARGET_TABLE", help="recarga una sola tabla")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # consola de Windows (cp1252) rompe las tildes
    env = load_env()
    try:
        if args.dry_run:
            dry_run(env)
        else:
            full_run(env, args.only)
    except LoadError as e:
        sys.exit(f"ERROR: {e}")
    except Exception as e:  # psycopg u otros: el mensaje puede traer datos de la fila
        code = getattr(e, "sqlstate", None)
        msg = ""
        if code and not code.startswith(("22", "23")):
            msg = ": " + (getattr(getattr(e, "diag", None), "message_primary", "") or "")
        sys.exit(f"ERROR ({type(e).__name__}, sqlstate={code}){msg}")


if __name__ == "__main__":
    main()
