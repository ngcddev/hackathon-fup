#!/usr/bin/env python3
"""
Perfilador de los txt de DateBaseHIS (Hackathon HSLV).

Lee los 7 txt, detecta codificacion, separador y formato de fechas, y genera
un reporte AGREGADO (conteos, rangos, categorias) para validar los supuestos
S-01 a S-12 del levante de requerimientos. No imprime filas de pacientes,
nombres, documentos, motivos de consulta ni diagnosticos.

Uso:
    pip install pandas
    python profile_his.py <carpeta_con_los_txt> [--out perfil_his.md]
    Opcionales: --sep "|"  --encoding cp1252  --no-quotes
"""
import argparse
import csv
import sys
import unicodedata
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    sys.exit("Falta pandas. Instalalo con: pip install pandas")

EXPECTED = {
    "Paciente": ["TipoDocumento", "IdPaciente", "NombrePaciente", "FechaNacimiento", "Sexo",
                "Asegurador", "Regimen", "Departamento", "Municipio", "Zona"],
    "Ingresos": ["OidIngreso", "ConsecutivoIngreso", "IdPaciente", "ClaseIngreso", "ViaIngreso",
                "TipoRiesgo", "FechaIngreso", "FechaHospitalizacion", "OidTriageA", "CodigoCama",
                "NombreCama", "NombreGrupoCama", "NombreSubgrupoCama", "CodigoDiagnostico",
                "NombreDiagnostico"],
    "Triage": ["OidTriage", "FechaTriage", "MotivoConsulta", "TensionArterial", "FrecuenciaCardiaca",
            "FrecuenciaRespiratoria", "Temperatura", "IdPaciente2", "CodigoTriage",
            "ClasificacionTriage"],
    "Atencion": ["OidIngreso", "FechaAtencion"],
    "Servicios": ["OidS", "OidIngreso", "CodigoServicio", "NombreServicio", "Cantidad",
                "FechaPrestacion", "CodigoAreaServicio", "AreaServicio", "Especialidad"],
    "MedicamentoInsumo": ["OidMI", "OidIngreso", "CodigoServicio", "NombreServicio", "Cantidad",
                        "FechaPrestacion", "AreaServicio", "Especialidad"],
    "ProgramacionCirugia": ["ConsecutivoProgramacion", "IdPaciente", "OidIngreso", "CodigoServicio"],
}

# Solo estas columnas muestran sus valores (lista blanca, nada sensible)
CATEGORICAL = {
    "Paciente": ["TipoDocumento", "Sexo", "Regimen", "Zona"],
    "Ingresos": ["ClaseIngreso", "ViaIngreso", "TipoRiesgo", "NombreGrupoCama", "NombreSubgrupoCama"],
    "Triage": ["CodigoTriage", "ClasificacionTriage"],
    "Servicios": ["AreaServicio", "Especialidad"],
    "MedicamentoInsumo": ["AreaServicio", "Especialidad"],
}
DATES = {
    "Paciente": ["FechaNacimiento"],
    "Ingresos": ["FechaIngreso", "FechaHospitalizacion"],
    "Triage": ["FechaTriage"],
    "Atencion": ["FechaAtencion"],
    "Servicios": ["FechaPrestacion"],
    "MedicamentoInsumo": ["FechaPrestacion"],
}
NO_DATE_VALUES = {("Paciente", "FechaNacimiento")}  # solo tasa de parseo, sin min/max ni ejemplos
NUMERIC = {
    "Paciente": ["IdPaciente"],
    "Ingresos": ["OidIngreso", "ConsecutivoIngreso", "IdPaciente", "OidTriageA"],
    "Triage": ["OidTriage", "IdPaciente2", "FrecuenciaCardiaca", "FrecuenciaRespiratoria", "Temperatura"],
    "Atencion": ["OidIngreso"],
    "Servicios": ["OidS", "OidIngreso", "Cantidad"],
    "MedicamentoInsumo": ["OidMI", "OidIngreso", "Cantidad"],
    "ProgramacionCirugia": ["IdPaciente", "OidIngreso"],
}
PKS = {"Paciente": "IdPaciente", "Ingresos": "OidIngreso", "Triage": "OidTriage",
    "Atencion": "OidIngreso", "Servicios": "OidS", "MedicamentoInsumo": "OidMI"}

EMPTY = {"", "null", "nan", "none", "n/a", "na", "nat"}
DATE_FORMATS = [
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d",
    "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y %I:%M:%S %p", "%d/%m/%Y %I:%M %p", "%d/%m/%Y",
    "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p", "%m/%d/%Y",
    "%d-%m-%Y %H:%M:%S", "%d-%m-%Y", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d",
]

out = []


def w(line=""):
    out.append(line)


def log(msg):
    print(msg, file=sys.stderr)


def norm(text):
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    return "".join(ch for ch in text.lower() if ch.isalnum())


def table(headers, rows):
    w("| " + " | ".join(headers) + " |")
    w("|" + "|".join("---" for _ in headers) + "|")
    for r in rows:
        w("| " + " | ".join(str(x).replace("|", "/") for x in r) + " |")
    w()


def pct(a, b):
    return f"{100 * a / b:.1f} %" if b else "—"


def is_empty(s):
    return s.str.lower().isin(EMPTY)


def norm_id(s):
    return s.str.strip().str.replace(r"\.0+$", "", regex=True)


def fmt_dt(x):
    return "—" if pd.isna(x) else pd.Timestamp(x).strftime("%Y-%m-%d %H:%M")


def detect_encoding(path):
    raw = path.open("rb").read(4_000_000)
    try:
        raw.decode("utf-8-sig")
        return "utf-8-sig"
    except UnicodeDecodeError as e:
        if e.start >= len(raw) - 4:
            return "utf-8-sig"
        return "cp1252"


def detect_sep(path, enc):
    with path.open(encoding=enc, errors="replace") as f:
        lines = [l for l in (f.readline() for _ in range(50)) if l.strip()]
    best, best_score = "|", (-1, -1)
    for prio, c in enumerate(["|", "\t", ";", ","]):
        counts = [l.count(c) for l in lines]
        if not counts or counts[0] == 0:
            continue
        consistency = sum(1 for x in counts if x == counts[0]) / len(counts)
        score = (round(consistency, 2), -prio)
        if score > best_score:
            best, best_score = c, score
    return best


def count_lines(path):
    n = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            n += chunk.count(b"\n")
    return n


def parse_dates(s):
    """Devuelve (serie datetime, formato detectado, % parseado de los no vacios)."""
    mask = ~is_empty(s)
    vals = s[mask]
    result = pd.Series(pd.NaT, index=s.index, dtype="datetime64[ns]")
    if vals.empty:
        return result, "sin datos", 0.0
    vals = (vals.str.replace(r"\s*a\.?\s*m\.?\s*$", " AM", regex=True, case=False)
                .str.replace(r"\s*p\.?\s*m\.?\s*$", " PM", regex=True, case=False))
    sample = vals.sample(min(3000, len(vals)), random_state=0)
    best, best_rate = None, 0.0
    for f in DATE_FORMATS:
        rate = pd.to_datetime(sample, format=f, errors="coerce").notna().mean()
        if rate > best_rate:
            best, best_rate = f, rate
    if best_rate >= 0.9:
        parsed = pd.to_datetime(vals, format=best, errors="coerce")
        label = best
    else:
        nums = pd.to_numeric(vals.str.replace(",", "."), errors="coerce")
        if nums.notna().mean() > 0.9 and nums.between(20000, 80000).mean() > 0.9:
            parsed = pd.Timestamp("1899-12-30") + pd.to_timedelta(nums, unit="D")
            label = "serial de Excel"
        else:
            try:
                parsed = pd.to_datetime(vals, format="mixed", dayfirst=True, errors="coerce")
                label = f"mixto (mejor formato fijo {best} al {best_rate:.0%})"
            except Exception:
                parsed = pd.to_datetime(vals, format=best, errors="coerce")
                label = best
    result.loc[vals.index] = parsed
    return result, label, parsed.notna().mean() * 100


def find_files(folder):
    files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in (".txt", ".csv")]
    found, unmatched = {}, []
    for p in files:
        stem = norm(p.stem)
        match = next((t for t in EXPECTED if norm(t) == stem), None)
        if match is None:
            match = next((t for t in sorted(EXPECTED, key=len, reverse=True) if norm(t) in stem), None)
        if match and match not in found:
            found[match] = p
        else:
            unmatched.append(p.name)
    return found, unmatched


def load(name, path, args):
    enc = args.encoding or detect_encoding(path)
    sep = args.sep or detect_sep(path, enc)
    quoting = csv.QUOTE_NONE if args.no_quotes else csv.QUOTE_MINIMAL
    df = pd.read_csv(path, sep=sep, encoding=enc, dtype=str, keep_default_na=False, na_filter=False,
                    quoting=quoting, on_bad_lines="warn",
                    engine="c" if len(sep) == 1 else "python")
    df.columns = [str(c).strip().lstrip("﻿") for c in df.columns]
    df = df.apply(lambda col: col.str.strip())
    expected_by_norm = {norm(c): c for c in EXPECTED[name]}
    rename, extra = {}, []
    for c in df.columns:
        if norm(c) in expected_by_norm:
            rename[c] = expected_by_norm[norm(c)]
        else:
            extra.append(c)
    df = df.rename(columns=rename)
    missing = [c for c in EXPECTED[name] if c not in df.columns]
    meta = {"enc": enc, "sep": sep, "lines": count_lines(path), "mb": path.stat().st_size / 1e6,
            "extra": extra, "missing": missing}
    return df, meta


def profile_table(name, path, df, meta, parsed):
    w(f"## {name} (`{path.name}`)")
    w()
    sep_label = {"\t": "tabulador", "|": "barra vertical |", ";": "punto y coma", ",": "coma"}.get(meta["sep"], meta["sep"])
    w(f"- Tamano: {meta['mb']:.1f} MB · codificacion: {meta['enc']} · separador: {sep_label}")
    w(f"- Lineas fisicas: {meta['lines']:,} · filas leidas: {len(df):,}")
    w(f"- Columnas leidas ({len(df.columns)}): {', '.join(df.columns)}")
    if meta["missing"]:
        w(f"- **Faltan frente al diccionario:** {', '.join(meta['missing'])}")
    if meta["extra"]:
        w(f"- **Columnas extra (no estan en el diccionario):** {', '.join(meta['extra'])}")
    w()
    rows = []
    for c in df.columns:
        s = df[c]
        empty = is_empty(s)
        lens = s[~empty].str.len()
        notes = []
        if c in NUMERIC.get(name, []):
            num = pd.to_numeric(s[~empty].str.replace(",", "."), errors="coerce")
            notes.append(f"numerico {num.notna().mean() * 100:.1f} %" if len(num) else "")
        if (name, c) in parsed:
            p, label, rate = parsed[(name, c)]
            notes.append(f"formato {label}, parseado {rate:.1f} %")
            if (name, c) not in NO_DATE_VALUES and p.notna().any():
                midnight = (p.dropna().dt.normalize() == p.dropna()).mean() * 100
                notes.append(f"min {fmt_dt(p.min())}, max {fmt_dt(p.max())}, hora 00:00 en {midnight:.1f} %")
                ex = s[~empty].drop_duplicates().head(3).tolist()
                notes.append("ej.: " + " / ".join(f"`{e}`" for e in ex))
        rows.append([c, pct(empty.sum(), len(s)), f"{s[~empty].nunique():,}",
                    f"{lens.min() if len(lens) else 0}–{lens.max() if len(lens) else 0}",
                    "; ".join(n for n in notes if n)])
    table(["Columna", "Vacios", "Distintos", "Longitud", "Notas"], rows)
    for c in CATEGORICAL.get(name, []):
        if c not in df.columns:
            continue
        vc = df[c].replace("", "(vacio)").value_counts()
        w(f"**{c}** ({len(vc)} valores distintos{', se muestran 40' if len(vc) > 40 else ''})")
        w()
        table(["Valor", "Filas", "%"], [[k, f"{v:,}", pct(v, len(df))] for k, v in vc.head(40).items()])


def safe(title, fn):
    w(f"### {title}")
    w()
    try:
        fn()
    except Exception as e:  # el perfil no debe caerse por un chequeo
        w(f"No se pudo calcular: `{type(e).__name__}: {e}`")
        w()


def main():
    ap = argparse.ArgumentParser(description="Perfilador de los txt del HIS")
    ap.add_argument("folder")
    ap.add_argument("--out", default="perfil_his.md")
    ap.add_argument("--sep")
    ap.add_argument("--encoding")
    ap.add_argument("--no-quotes", action="store_true", help="ignorar comillas si hay filas pegadas")
    args = ap.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"No existe la carpeta {folder}")
    found, unmatched = find_files(folder)

    w("# Perfil de datos HIS (agregado, sin datos de pacientes)")
    w()
    w(f"Archivos reconocidos: {', '.join(f'{k} → {v.name}' for k, v in found.items()) or 'ninguno'}")
    if unmatched:
        w(f"Archivos no reconocidos: {', '.join(unmatched)}")
    missing_tables = [t for t in EXPECTED if t not in found]
    if missing_tables:
        w(f"**Tablas sin archivo:** {', '.join(missing_tables)}")
    w(f"Tamano total: {sum(p.stat().st_size for p in found.values()) / 1e6:.1f} MB")
    w()

    T, parsed = {}, {}
    for name, path in found.items():
        log(f"Leyendo {path.name}...")
        try:
            df, meta = load(name, path, args)
        except Exception as e:
            w(f"## {name}: error al leer `{type(e).__name__}: {e}`")
            w()
            continue
        for c in DATES.get(name, []):
            if c in df.columns:
                parsed[(name, c)] = parse_dates(df[c])
        profile_table(name, path, df, meta, parsed)
        T[name] = df

    w("# Validacion de supuestos")
    w()
    D = lambda t, c: parsed[(t, c)][0]

    ing = T.get("Ingresos")
    ref = None
    if ing is not None and ("Ingresos", "FechaIngreso") in parsed:
        ref = D("Ingresos", "FechaIngreso").max()
        ref_day = ref.normalize()
        w(f"**Fecha de referencia sugerida (S-01): {fmt_dt(ref)}** (maximo de FechaIngreso)")
        w()

    def s_volume():
        adm = D("Ingresos", "FechaIngreso")
        by_month = adm.dt.to_period("M").value_counts().sort_index()
        table(["Mes", "Ingresos"], [[str(k), f"{v:,}"] for k, v in by_month.tail(24).items()])
        last = adm[adm >= ref_day - pd.Timedelta(days=13)].dt.date.value_counts().sort_index()
        w("Ultimos 14 dias:")
        w()
        table(["Dia", "Ingresos"], [[str(k), v] for k, v in last.items()])
    if ref is not None:
        safe("Volumen de ingresos por mes y ultimos dias (S-01, cobertura de 'hoy' y 'este mes')", s_volume)

    def s_dates_vs_ref():
        rows = []
        for (t, c), (p, label, rate) in parsed.items():
            if (t, c) in NO_DATE_VALUES:
                continue
            rows.append([f"{t}.{c}", fmt_dt(p.min()), fmt_dt(p.max()),
                        f"{(p > ref).sum():,}" if ref is not None else "—"])
        table(["Columna", "Min", "Max", "Filas posteriores a la fecha de referencia"], rows)
    safe("Rango de fechas por tabla (S-01, S-12)", s_dates_vs_ref)

    def s_pks():
        rows = []
        for t, c in PKS.items():
            if t in T and c in T[t].columns:
                s = norm_id(T[t][c])
                rows.append([f"{t}.{c}", f"{is_empty(s).sum():,}", f"{s[~is_empty(s)].duplicated().sum():,}"])
        table(["Llave", "Vacios", "Duplicados"], rows)
    safe("Llaves primarias", s_pks)

    def s_fks():
        rows = []
        checks = [("Ingresos", "IdPaciente", "Paciente", "IdPaciente"),
                ("Ingresos", "OidTriageA", "Triage", "OidTriage"),
                ("Triage", "IdPaciente2", "Paciente", "IdPaciente"),
                ("Atencion", "OidIngreso", "Ingresos", "OidIngreso"),
                ("Servicios", "OidIngreso", "Ingresos", "OidIngreso"),
                ("MedicamentoInsumo", "OidIngreso", "Ingresos", "OidIngreso"),
                ("ProgramacionCirugia", "OidIngreso", "Ingresos", "OidIngreso"),
                ("ProgramacionCirugia", "IdPaciente", "Paciente", "IdPaciente")]
        for t, c, rt, rc in checks:
            if t in T and rt in T and c in T[t].columns and rc in T[rt].columns:
                s = norm_id(T[t][c])
                filled = s[~is_empty(s)]
                ok = filled.isin(set(norm_id(T[rt][rc])))
                rows.append([f"{t}.{c} → {rt}.{rc}", f"{len(filled):,} de {len(s):,}",
                            pct(ok.sum(), len(filled))])
        table(["Relacion", "Con valor", "Encuentran pareja"], rows)
    safe("Integridad referencial", s_fks)

    def s_class_route():
        ct = pd.crosstab(ing["ViaIngreso"].replace("", "(vacio)"), ing["ClaseIngreso"].replace("", "(vacio)"))
        table(["ViaIngreso \\ ClaseIngreso"] + list(ct.columns),
            [[i] + [f"{v:,}" for v in r] for i, r in ct.iterrows()])
        hosp = D("Ingresos", "FechaHospitalizacion").notna()
        g = hosp.groupby(ing["ClaseIngreso"].replace("", "(vacio)")).agg(["sum", "count"])
        w("Ingresos con FechaHospitalizacion por clase:")
        w()
        table(["ClaseIngreso", "Con hospitalizacion", "Total", "%"],
            [[k, f"{r['sum']:,}", f"{r['count']:,}", pct(r["sum"], r["count"])] for k, r in g.iterrows()])
    if ing is not None:
        safe("Clase y via de ingreso (S-04, S-05)", s_class_route)

    def s_services():
        df = ing.assign(hosp=D("Ingresos", "FechaHospitalizacion").notna())
        g = df.groupby(["NombreGrupoCama", "NombreSubgrupoCama"]).agg(
            camas=("CodigoCama", "nunique"), ingresos=("OidIngreso", "count"), hospitalizados=("hosp", "sum"))
        table(["Grupo (servicio)", "Subgrupo", "Camas distintas", "Ingresos", "Con hospitalizacion"],
            [[a, b, r["camas"], f"{r['ingresos']:,}", f"{int(r['hospitalizados']):,}"]
            for (a, b), r in g.sort_values("ingresos", ascending=False).head(80).iterrows()])
        multi = ing.groupby("CodigoCama")["NombreGrupoCama"].nunique()
        w(f"Camas que aparecen en mas de un grupo: {(multi > 1).sum():,} de {len(multi):,}")
        w()
    if ing is not None:
        safe("Servicios, subservicios y capacidad observada (S-02, S-03, S-09)", s_services)

    def build_waits():
        base = ing[["OidIngreso", "OidTriageA", "ViaIngreso", "ClaseIngreso"]].copy()
        base["OidIngreso"] = norm_id(base["OidIngreso"])
        base["OidTriageA"] = norm_id(base["OidTriageA"])
        base["admitted"] = D("Ingresos", "FechaIngreso")
        at = T["Atencion"][["OidIngreso"]].copy()
        at["OidIngreso"] = norm_id(at["OidIngreso"])
        at["attended"] = D("Atencion", "FechaAtencion")
        at = at.drop_duplicates("OidIngreso")
        tr = T["Triage"][["OidTriage", "CodigoTriage"]].copy()
        tr["OidTriage"] = norm_id(tr["OidTriage"])
        tr["triaged"] = D("Triage", "FechaTriage")
        tr = tr[~is_empty(tr["OidTriage"])].drop_duplicates("OidTriage")
        m = base.merge(at, on="OidIngreso", how="left").merge(
            tr, left_on="OidTriageA", right_on="OidTriage", how="left")
        m["start"] = m["triaged"].fillna(m["admitted"])
        m["wait"] = (m["attended"] - m["start"]).dt.total_seconds() / 60
        m["triage_minus_admit"] = (m["admitted"] - m["triaged"]).dt.total_seconds() / 60
        return m

    waits = {}

    def s_waits():
        m = build_waits()
        waits["m"] = m
        rows = []
        for via, g in m.groupby(m["ViaIngreso"].replace("", "(vacio)")):
            wv = g["wait"].dropna()
            valid = wv[(wv >= 0) & (wv <= 1440)]
            q = wv.quantile([0.1, 0.5, 0.9]) if len(wv) else pd.Series([None] * 3, index=[0.1, 0.5, 0.9])
            rows.append([via, f"{len(g):,}", pct(g["triaged"].notna().sum(), len(g)),
                        pct(g["attended"].notna().sum(), len(g)), pct((wv < 0).sum(), len(wv)),
                        pct((wv > 1440).sum(), len(wv)),
                        " / ".join("—" if pd.isna(x) else f"{x:.0f}" for x in q),
                        f"{valid.mean():.1f}" if len(valid) else "—"])
        table(["ViaIngreso", "Ingresos", "Con triage", "Con atencion", "Espera < 0", "Espera > 1440",
            "p10 / p50 / p90 (min)", "Promedio valido (min)"], rows)
        tma = m["triage_minus_admit"].dropna()
        if len(tma):
            q = tma.quantile([0.1, 0.5, 0.9])
            w(f"FechaIngreso − FechaTriage (min), p10/p50/p90: {q[0.1]:.0f} / {q[0.5]:.0f} / {q[0.9]:.0f}. "
            f"Negativos (ingreso antes del triage): {pct((tma < 0).sum(), len(tma))}")
            w()
        urg = m[m["ViaIngreso"].map(norm).str.contains("urgen", na=False)]
        if len(urg):
            rows = []
            for code, g in urg.groupby(urg["CodigoTriage"].fillna("(sin triage)").replace("", "(vacio)")):
                wv = g["wait"][(g["wait"] >= 0) & (g["wait"] <= 1440)]
                rows.append([code, f"{len(g):,}", f"{len(wv):,}",
                            f"{wv.mean():.1f}" if len(wv) else "—", f"{wv.median():.1f}" if len(wv) else "—"])
            w("Solo vias que contienen 'urgen', por triage:")
            w()
            table(["CodigoTriage", "Ingresos", "Esperas validas", "Promedio (min)", "Mediana (min)"], rows)
    if all(t in T for t in ("Ingresos", "Atencion", "Triage")):
        safe("Tiempos de espera (S-04, S-06)", s_waits)

    stay = {}

    def s_stay():
        parts = []
        for t in ("Servicios", "MedicamentoInsumo"):
            if t in T and (t, "FechaPrestacion") in parsed:
                parts.append(pd.DataFrame({"OidIngreso": norm_id(T[t]["OidIngreso"]),
                                        "at": D(t, "FechaPrestacion")}))
        last = pd.concat(parts).dropna().groupby("OidIngreso")["at"].max()
        h = pd.DataFrame({"OidIngreso": norm_id(ing["OidIngreso"]), "bed": ing["CodigoCama"],
                        "group": ing["NombreGrupoCama"], "subgroup": ing["NombreSubgrupoCama"],
                        "hosp": D("Ingresos", "FechaHospitalizacion")})
        h = h[h["hosp"].notna()]
        h["disc"] = h["OidIngreso"].map(last)
        h["days"] = (h["disc"] - h["hosp"]).dt.total_seconds() / 86400
        stay["h"] = h
        d = h["days"].dropna()
        q = d.quantile([0.1, 0.5, 0.9, 0.99])
        w(f"- Ingresos con hospitalizacion: {len(h):,}; sin ninguna prestacion registrada: {pct(h['disc'].isna().sum(), len(h))}")
        w(f"- Estancia estimada (dias) p10/p50/p90/p99: {q[0.1]:.1f} / {q[0.5]:.1f} / {q[0.9]:.1f} / {q[0.99]:.1f}; maximo {d.max():.1f}")
        w(f"- Estancias negativas (ultima prestacion antes de hospitalizar): {pct((d < 0).sum(), len(d))}; mayores a 60 dias: {pct((d > 60).sum(), len(d))}")
        w()
        by = h.groupby("group")["days"].median().sort_values(ascending=False)
        table(["Servicio", "Mediana estancia (dias)"], [[k, f"{v:.1f}"] for k, v in by.head(30).items()])
    if ing is not None and ("Ingresos", "FechaHospitalizacion") in parsed:
        safe("Estancia y egreso estimado (S-07)", s_stay)

    def s_occupancy():
        h = stay["h"]
        active = h[(h["hosp"].dt.normalize() <= ref_day) & (h["disc"].dt.normalize() >= ref_day)]
        cap = ing.groupby(["NombreGrupoCama", "NombreSubgrupoCama"])["CodigoCama"].nunique()
        occ = active.groupby(["group", "subgroup"])["bed"].nunique()
        rows = []
        for (g, sg), c in cap.sort_values(ascending=False).items():
            o = int(occ.get((g, sg), 0))
            rows.append([g, sg, o, c, pct(o, c)])
        table(["Servicio", "Subservicio", "Camas ocupadas", "Capacidad observada", "Ocupacion"], rows[:80])
        dup = active.groupby("bed")["OidIngreso"].nunique()
        w(f"Camas con mas de un ingreso activo el mismo dia: {(dup > 1).sum():,} (indica egresos estimados muy tardios)")
        w()
    if ref is not None and "h" in stay:
        safe(f"Ocupacion en la fecha de referencia {ref_day.date()} (S-08, S-09)", s_occupancy)

    def s_demo():
        h = stay.get("h")
        if h is not None:
            active = h[(h["hosp"].dt.normalize() <= ref_day) & (h["disc"].dt.normalize() >= ref_day)]
            uci = lambda s: s.map(norm).str.contains("uci|intensiv", regex=True, na=False)
            a = active[uci(active["group"]) | uci(active["subgroup"])]
            cap = ing[uci(ing["NombreGrupoCama"]) | uci(ing["NombreSubgrupoCama"])]["CodigoCama"].nunique()
            w(f"- **P1 UCI hoy:** {a['bed'].nunique()} camas ocupadas de {cap} observadas "
            f"(grupos/subgrupos que contienen 'UCI' o 'intensiv')")
        m = waits.get("m")
        if m is not None:
            last7 = m[(m["admitted"] > ref_day - pd.Timedelta(days=6)) & (m["admitted"] < ref_day + pd.Timedelta(days=1))]
            urg = last7[last7["ViaIngreso"].map(norm).str.contains("urgen", na=False)]
            wv = urg["wait"][(urg["wait"] >= 0) & (urg["wait"] <= 1440)]
            w(f"- **P3 espera urgencias ultima semana:** {wv.mean():.1f} min promedio sobre {len(wv):,} esperas validas "
              f"de {len(urg):,} ingresos" if len(wv) else f"- **P3:** sin esperas validas ({len(urg):,} ingresos de urgencias en 7 dias)")
        month = ing[(D("Ingresos", "FechaIngreso") >= ref_day.replace(day=1)) &
                    (D("Ingresos", "FechaIngreso") < ref_day + pd.Timedelta(days=1))]
        hosp_class = month[month["ClaseIngreso"].map(norm).str.contains("hosp", na=False)]
        top = hosp_class.groupby("NombreGrupoCama")["IdPaciente"].nunique().sort_values(ascending=False).head(5)
        w(f"- **P4 servicio con mas pacientes este mes** (ClaseIngreso contiene 'hosp', {len(hosp_class):,} ingresos):")
        w()
        table(["Servicio", "Pacientes distintos"], [[k, v] for k, v in top.items()])
        w("- **P2 medicamentos < 5 dias:** no se puede calcular con el HIS (no hay stock); depende de drug_stock.")
        w()
    if ref is not None:
        safe("Vista previa de las 4 preguntas de la demo (con los supuestos por defecto)", s_demo)

    def s_drugs():
        mi = T["MedicamentoInsumo"]
        at = D("MedicamentoInsumo", "FechaPrestacion")
        last30 = mi[(at > ref_day - pd.Timedelta(days=30)) & (at < ref_day + pd.Timedelta(days=1))]
        qty = pd.to_numeric(mi["Cantidad"].str.replace(",", "."), errors="coerce")
        w(f"- Filas en los ultimos 30 dias: {len(last30):,}; codigos distintos con consumo en ese periodo: {last30['CodigoServicio'].nunique():,} de {mi['CodigoServicio'].nunique():,}")
        w(f"- Cantidad: min {qty.min()}, max {qty.max()}, negativas o cero: {pct((qty <= 0).sum(), qty.notna().sum())} (devoluciones?)")
        w()
    if "MedicamentoInsumo" in T and ref is not None:
        safe("Consumo de medicamentos (S-10)", s_drugs)

    def s_surgery():
        pc = T["ProgramacionCirugia"]
        w(f"- Filas: {len(pc):,}; programaciones distintas: {pc['ConsecutivoProgramacion'].nunique():,}")
        w(f"- Con OidIngreso: {pct((~is_empty(pc['OidIngreso'])).sum(), len(pc))}")
        date_cols = [c for c in pc.columns if "fecha" in norm(c)]
        for c in date_cols:
            p, label, rate = parse_dates(pc[c])
            w(f"- Columna de fecha `{c}`: formato {label}, parseado {rate:.1f} %, rango {fmt_dt(p.min())} a {fmt_dt(p.max())}")
        if "Servicios" in T:
            sv = set(zip(norm_id(T["Servicios"]["OidIngreso"]), T["Servicios"]["CodigoServicio"]))
            pairs = list(zip(norm_id(pc["OidIngreso"]), pc["CodigoServicio"]))
            hit = sum(1 for p in pairs if p in sv)
            w(f"- Filas cuyo (OidIngreso, CodigoServicio) aparece en Servicios (realizada, S-11): {pct(hit, len(pairs))}")
        w()
    if "ProgramacionCirugia" in T:
        safe("Programacion quirurgica (S-11)", s_surgery)

    Path(args.out).write_text("\n".join(out), encoding="utf-8")
    log(f"Listo: {args.out}")


if __name__ == "__main__":
    main()
