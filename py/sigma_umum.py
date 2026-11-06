"""
sigma_umum.py — Fitur Analisis Dasar SIGMA Batam (KAK IV.2.a.2).iv)

Pekerjaan Pemetaan dan Pengembangan SIG Infrastruktur Batam TA 2026.
Disusun TA GIS untuk diserahkan ke tim IT sebagai layanan analisis back-end
(KAK IV.1.e.3).iii dan IV.2.a.5).ii "built-in module").

Fitur:
    U1  filter_lokasi_atribut()  Filter berdasarkan lokasi dan atribut
    U2  query_layer()            Query atribut layer (definition query), + ke_cql2()
    U3  profil_elevasi()         Analisis profile (profil elevasi permukaan tanah dari DEM)
    U4  ukur_jarak()             Perhitungan jarak (panjang lintasan geodesik)
    U5  ukur_luas()              Perhitungan luas (luas dan keliling geodesik)

Prinsip:
    * Semua fungsi murni: masukan dict/GeoDataFrame, keluaran dict yang dapat
      diserialisasi ke JSON (kecuali kunci "fitur" yang berupa GeoDataFrame;
      pakai ke_geojson() untuk mengirimnya lewat API).
    * Data disimpan/dipertukarkan dalam EPSG:4326 (SRGI2013 memakai elipsoid WGS84).
    * Jarak, panjang, dan luas dihitung geodesik pada elipsoid WGS84 (Karney 2013),
      setara ST_Length/ST_Area(geography) di PostGIS.
    * Buffer radius dihitung di UTM 48N (meter), bukan di derajat.
    * Kesalahan masukan dilempar sebagai GalatAnalisis (pesan berbahasa Indonesia),
      sehingga API dapat memetakannya ke HTTP 400.

Ketergantungan: geopandas>=1.0, shapely>=2.0, pyproj>=3.4, rasterio>=1.3, numpy, pandas.
Lihat README.md untuk kontrak masukan/keluaran dan padanan SQL PostGIS.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Any, Iterable


def _siapkan_proj() -> None:
    """Cegah bentrok data PROJ/GDAL.

    Di server yang juga memasang PostgreSQL/PostGIS, variabel PROJ_LIB dan GDAL_DATA sering
    menunjuk ke folder PostGIS yang versinya lebih tua, sehingga rasterio gagal membaca kode EPSG
    ("proj.db contains DATABASE.LAYOUT.VERSION.MINOR = 2"). Bila terjadi, pakai data bawaan rasterio.
    """
    try:
        import importlib.util
        spec = importlib.util.find_spec("rasterio")
        if spec is None or not spec.origin:
            return
        akar = os.path.dirname(spec.origin)
        for var, sub in (("PROJ_LIB", "proj_data"), ("PROJ_DATA", "proj_data"), ("GDAL_DATA", "gdal_data")):
            nilai = os.environ.get(var, "")
            bawaan = os.path.join(akar, sub)
            if nilai and ("postgis" in nilai.lower() or "postgresql" in nilai.lower()) and os.path.isdir(bawaan):
                os.environ[var] = bawaan
        if os.environ.get("PROJ_LIB") and not os.environ.get("PROJ_DATA"):
            os.environ["PROJ_DATA"] = os.environ["PROJ_LIB"]
    except Exception:  # noqa: BLE001
        pass


_siapkan_proj()

import geopandas as gpd
import numpy as np
import pandas as pd
from pyproj import Geod, Transformer
from shapely import make_valid
from shapely.geometry import (LineString, MultiLineString, MultiPolygon, Point,
                              Polygon, mapping, shape)
from shapely.ops import transform as shp_transform
from shapely.validation import explain_validity

__version__ = "0.1.0"

CRS_DATA = "EPSG:4326"
CRS_UTM = "EPSG:32648"  # UTM 48N; padanan praktis SRGI2013/UTM 48N (konfirmasi kode EPSG dengan PDSI)
GEOD = Geod(ellps="WGS84")
_KE_UTM = Transformer.from_crs(CRS_DATA, CRS_UTM, always_xy=True)
_DARI_UTM = Transformer.from_crs(CRS_UTM, CRS_DATA, always_xy=True)

# Batas kasar wilayah Kota Batam / wilayah kerja BP Batam, hanya untuk peringatan salah urutan lon/lat.
_BBOX_BATAM = (103.3, 0.2, 104.6, 1.5)


class GalatAnalisis(ValueError):
    """Kesalahan masukan pengguna. Pesan aman ditampilkan ke pengguna (HTTP 400)."""


# =====================================================================================
# Utilitas umum
# =====================================================================================

def _angka(x: Any) -> Any:
    """Ubah tipe numpy/pandas menjadi tipe Python biasa agar dapat di-JSON-kan."""
    if isinstance(x, dict):
        return {k: _angka(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_angka(v) for v in x]
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        return None if (math.isnan(x) or math.isinf(x)) else float(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    if isinstance(x, pd.Timestamp):
        return x.isoformat()
    return x


def fmt_panjang(m: float) -> str:
    """Format panjang gaya Indonesia: 1.234 m atau 12,35 km."""
    if m is None:
        return "—"
    if m < 10_000:
        return _fmt_id(m, 1 if m < 100 else 0) + " m"
    return _fmt_id(m / 1000, 2) + " km"


def fmt_luas(m2: float) -> str:
    """Format luas gaya Indonesia: m² dan ha, atau km² dan ha."""
    if m2 is None:
        return "—"
    if m2 < 1e6:
        return f"{_fmt_id(m2, 0)} m² · {_fmt_id(m2 / 1e4, 2)} ha"
    return f"{_fmt_id(m2 / 1e6, 2)} km² · {_fmt_id(m2 / 1e4, 1)} ha"


def _fmt_id(x: float, des: int) -> str:
    s = f"{x:,.{des}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def _cek_titik(titik: Iterable, minimal: int, nama: str) -> list[tuple[float, float]]:
    try:
        pts = [(float(p[0]), float(p[1])) for p in titik]
    except (TypeError, ValueError, IndexError):
        raise GalatAnalisis(f"{nama}: titik harus berupa daftar [bujur, lintang].")
    if len(pts) < minimal:
        raise GalatAnalisis(f"{nama}: dibutuhkan minimal {minimal} titik, diterima {len(pts)}.")
    for lon, lat in pts:
        if not (math.isfinite(lon) and math.isfinite(lat)):
            raise GalatAnalisis(f"{nama}: koordinat tidak boleh kosong/NaN.")
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            saran = " Urutan koordinat kemungkinan tertukar (harus [bujur, lintang])." if abs(lon) <= 90 < abs(lat) <= 180 else ""
            raise GalatAnalisis(f"{nama}: koordinat ({lon}, {lat}) di luar rentang bujur/lintang.{saran}")
    return pts


def _peringatan_bbox(pts: list[tuple[float, float]]) -> list[str]:
    x0, y0, x1, y1 = _BBOX_BATAM
    luar = [p for p in pts if not (x0 <= p[0] <= x1 and y0 <= p[1] <= y1)]
    if not luar:
        return []
    return [f"{len(luar)} titik berada di luar wilayah Batam; periksa lokasi dan sistem koordinat (harus EPSG:4326)."]


def _ke_geometri(g: Any):
    """Terima shapely, GeoJSON geometry/Feature dict, atau daftar koordinat."""
    if g is None:
        raise GalatAnalisis("Geometri kosong.")
    if hasattr(g, "geom_type"):
        return g
    if isinstance(g, dict):
        if g.get("type") == "Feature":
            g = g.get("geometry")
        try:
            return shape(g)
        except Exception as e:  # noqa: BLE001
            raise GalatAnalisis(f"GeoJSON geometri tidak dapat dibaca: {e}")
    raise GalatAnalisis("Format geometri tidak dikenali.")


def panjang_geodesik(geom) -> float:
    """Panjang geodesik (m) untuk garis; keliling untuk poligon. 0 untuk titik."""
    if geom is None or geom.is_empty:
        return 0.0
    if geom.geom_type in ("Point", "MultiPoint"):
        return 0.0
    if geom.geom_type == "GeometryCollection":
        return sum(panjang_geodesik(g) for g in geom.geoms)
    return float(GEOD.geometry_length(geom))


def luas_geodesik(geom) -> tuple[float, float]:
    """(luas m², keliling luar m) geodesik untuk Polygon/MultiPolygon.

    Lubang dikurangkan secara eksplisit. pyproj menjumlahkan luas bertanda per ring,
    sehingga lubang yang arah putarannya sama dengan tepi luar justru menambah luas.
    """
    if geom is None or geom.is_empty:
        return 0.0, 0.0
    if geom.geom_type == "Polygon":
        a_luar, k_luar = GEOD.polygon_area_perimeter(*geom.exterior.coords.xy)
        a_lubang = sum(abs(GEOD.polygon_area_perimeter(*r.coords.xy)[0]) for r in geom.interiors)
        return abs(a_luar) - a_lubang, k_luar
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        hasil = [luas_geodesik(g) for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        return sum(h[0] for h in hasil), sum(h[1] for h in hasil)
    return 0.0, 0.0


def baca_layer(sumber: Any, layer: str | None = None) -> gpd.GeoDataFrame:
    """Baca layer vektor menjadi GeoDataFrame EPSG:4326.

    sumber: GeoDataFrame, path file (GPKG/GeoJSON/SHP), atau dict GeoJSON FeatureCollection.
    Di produksi, ganti dengan gpd.read_postgis(sql, koneksi) — fungsi analisis tidak berubah.
    """
    if isinstance(sumber, gpd.GeoDataFrame):
        gdf = sumber
    elif isinstance(sumber, dict):
        gdf = gpd.GeoDataFrame.from_features(sumber.get("features", []), crs=CRS_DATA)
    else:
        gdf = gpd.read_file(sumber, layer=layer)
    if gdf.crs is None:
        gdf = gdf.set_crs(CRS_DATA)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(CRS_DATA)
    return gdf


def ke_geojson(gdf: gpd.GeoDataFrame) -> dict:
    """GeoDataFrame -> dict GeoJSON FeatureCollection (EPSG:4326)."""
    if gdf is None:
        return {"type": "FeatureCollection", "features": []}
    return json.loads(gdf.to_crs(CRS_DATA).to_json(na="null", drop_id=True))


# =====================================================================================
# Mesin ekspresi atribut (dipakai U1 dan U2)
# =====================================================================================
#
# Bentuk ekspresi (JSON):
#   syarat  : {"kolom": "kondisi", "op": "=", "nilai": "Rusak Berat"}
#   grup AND: {"semua": [ekspresi, ...]}
#   grup OR : {"salah_satu": [ekspresi, ...]}
#   negasi  : {"bukan": ekspresi}
# Contoh (A atau B) dan C:
#   {"semua": [{"salah_satu": [A, B]}, C]}
#
# Logika NULL mengikuti SQL (tiga nilai, Kleene): nilai kosong tidak lolos =, !=, >, dst.
# Untuk mencari nilai kosong gunakan op "kosong" / "tidak_kosong".

OPERATOR = {
    "=": "sama dengan", "!=": "tidak sama dengan",
    ">": "lebih dari", ">=": "lebih dari atau sama dengan",
    "<": "kurang dari", "<=": "kurang dari atau sama dengan",
    "antara": "di antara [min, maks] (inklusif)",
    "dalam": "salah satu dari daftar", "tidak_dalam": "bukan salah satu dari daftar",
    "memuat": "teks memuat", "diawali": "teks diawali",
    "kosong": "nilai kosong (NULL)", "tidak_kosong": "nilai tidak kosong",
}
_ALIAS_OP = {"==": "=", "≠": "!=", "<>": "!=", "≥": ">=", "≤": "<=", "~": "memuat",
             "between": "antara", "in": "dalam", "not_in": "tidak_dalam",
             "contains": "memuat", "like": "memuat", "starts_with": "diawali",
             "is_null": "kosong", "not_null": "tidak_kosong"}
_TANPA_NILAI = {"kosong", "tidak_kosong"}


def _op(op: str) -> str:
    o = _ALIAS_OP.get(str(op).strip().lower(), str(op).strip().lower())
    if o not in OPERATOR:
        raise GalatAnalisis(f"Operator '{op}' tidak dikenal. Pilihan: {', '.join(OPERATOR)}.")
    return o


def _nilai_kosong(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and v.strip() == "":
        return True
    if isinstance(v, (list, tuple)) and (len(v) == 0 or all(_nilai_kosong(x) for x in v)):
        return True
    return False


def bersihkan_ekspresi(ekspresi: dict | None) -> tuple[dict | None, list[str]]:
    """Buang syarat yang nilainya kosong (perbaikan bug prototipe: syarat kosong dianggap lolos).

    Mengembalikan (ekspresi bersih atau None bila tidak tersisa syarat, daftar catatan).
    """
    catatan: list[str] = []

    def _b(node):
        if node is None:
            return None
        if not isinstance(node, dict):
            raise GalatAnalisis("Ekspresi harus berupa objek JSON.")
        for kunci in ("semua", "salah_satu"):
            if kunci in node:
                anak = [x for x in (_b(n) for n in node[kunci] or []) if x is not None]
                if not anak:
                    return None
                return anak[0] if len(anak) == 1 else {kunci: anak}
        if "bukan" in node:
            a = _b(node["bukan"])
            return None if a is None else {"bukan": a}
        if "kolom" not in node or "op" not in node:
            raise GalatAnalisis("Syarat harus memuat 'kolom' dan 'op'.")
        op = _op(node["op"])
        if op not in _TANPA_NILAI and _nilai_kosong(node.get("nilai")):
            catatan.append(f"Syarat pada kolom '{node['kolom']}' diabaikan karena nilainya kosong.")
            return None
        if op == "antara":
            v = node.get("nilai")
            if not isinstance(v, (list, tuple)) or len(v) != 2 or any(_nilai_kosong(x) for x in v):
                raise GalatAnalisis(f"Operator 'antara' pada '{node['kolom']}' butuh nilai [min, maks].")
        return {**node, "op": op}

    return _b(ekspresi), catatan


def _jenis_kolom(s: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(s):
        return "boolean"
    if pd.api.types.is_numeric_dtype(s):
        return "angka"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "tanggal"
    return "teks"


def _bool_kleene(nilai: np.ndarray, kosong: np.ndarray) -> pd.Series:
    arr = pd.array(nilai.astype(bool), dtype="boolean")
    arr[kosong] = pd.NA
    return pd.Series(arr)


def _uji_syarat(df: pd.DataFrame, s: dict) -> pd.Series:
    kolom, op, nilai = s["kolom"], s["op"], s.get("nilai")
    if kolom not in df.columns:
        raise GalatAnalisis(f"Kolom '{kolom}' tidak ada di layer. Kolom tersedia: {', '.join(map(str, df.columns))}.")
    seri = df[kolom].reset_index(drop=True)
    kosong = seri.isna().to_numpy() | seri.astype(str).str.strip().eq("").to_numpy()
    if op == "kosong":
        return pd.Series(pd.array(kosong, dtype="boolean"))
    if op == "tidak_kosong":
        return pd.Series(pd.array(~kosong, dtype="boolean"))

    jenis = _jenis_kolom(seri)

    def konversi(v):
        if jenis == "angka":
            try:
                return float(str(v).replace(",", ".")) if isinstance(v, str) else float(v)
            except ValueError:
                raise GalatAnalisis(f"Kolom '{kolom}' bertipe angka; nilai '{v}' bukan angka.")
        if jenis == "tanggal":
            try:
                return pd.Timestamp(v)
            except ValueError:
                raise GalatAnalisis(f"Kolom '{kolom}' bertipe tanggal; nilai '{v}' tidak dapat dibaca.")
        return str(v).strip().casefold()

    if jenis == "angka":
        x = pd.to_numeric(seri, errors="coerce")
    elif jenis == "tanggal":
        x = pd.to_datetime(seri, errors="coerce")
    else:
        x = seri.astype(str).str.strip().str.casefold()

    if op in ("memuat", "diawali"):
        teks = seri.astype(str).str.strip().str.casefold()
        v = str(nilai).strip().casefold()
        hasil = teks.str.contains(v, regex=False) if op == "memuat" else teks.str.startswith(v)
        return _bool_kleene(hasil.to_numpy(), kosong)
    if op in ("dalam", "tidak_dalam"):
        daftar = nilai if isinstance(nilai, (list, tuple)) else [nilai]
        daftar = [konversi(v) for v in daftar if not _nilai_kosong(v)]
        hasil = x.isin(daftar).to_numpy()
        return _bool_kleene(hasil if op == "dalam" else ~hasil, kosong)
    if op == "antara":
        a, b = sorted([konversi(nilai[0]), konversi(nilai[1])]) if jenis != "teks" else (konversi(nilai[0]), konversi(nilai[1]))
        return _bool_kleene(((x >= a) & (x <= b)).to_numpy(), kosong)

    v = konversi(nilai)
    if jenis == "teks" and op in (">", ">=", "<", "<="):
        raise GalatAnalisis(f"Operator '{op}' tidak berlaku untuk kolom teks '{kolom}'.")
    banding = {"=": x == v, "!=": x != v, ">": x > v, ">=": x >= v, "<": x < v, "<=": x <= v}[op]
    return _bool_kleene(banding.to_numpy(), kosong)


def _evaluasi(df: pd.DataFrame, node: dict) -> pd.Series:
    if "semua" in node:
        hasil = pd.Series(pd.array([True] * len(df), dtype="boolean"))
        for n in node["semua"]:
            hasil = hasil & _evaluasi(df, n)
        return hasil
    if "salah_satu" in node:
        hasil = pd.Series(pd.array([False] * len(df), dtype="boolean"))
        for n in node["salah_satu"]:
            hasil = hasil | _evaluasi(df, n)
        return hasil
    if "bukan" in node:
        return ~_evaluasi(df, node["bukan"])
    return _uji_syarat(df, node)


def evaluasi_ekspresi(gdf: pd.DataFrame, ekspresi: dict | None) -> tuple[np.ndarray, list[str]]:
    """Kembalikan (mask boolean numpy sepanjang gdf, catatan). Ekspresi None = semua lolos."""
    bersih, catatan = bersihkan_ekspresi(ekspresi)
    if bersih is None:
        return np.ones(len(gdf), dtype=bool), catatan
    return _evaluasi(gdf, bersih).fillna(False).to_numpy(dtype=bool), catatan


def ke_cql2(ekspresi: dict | None) -> str:
    """Terjemahkan ekspresi ke OGC CQL2-text (untuk GeoServer / OGC API Features Part 3).

    Nilai selalu di-escape; nama kolom diapit tanda kutip ganda. Jangan pernah merangkai
    string SQL dari masukan klien secara langsung.
    """
    bersih, _ = bersihkan_ekspresi(ekspresi)
    if bersih is None:
        return ""

    def lit(v):
        if isinstance(v, bool):
            return "TRUE" if v else "FALSE"
        if isinstance(v, (int, float, np.integer, np.floating)):
            return repr(float(v)) if isinstance(v, (float, np.floating)) else str(int(v))
        return "'" + str(v).replace("'", "''") + "'"

    def prop(k):
        return '"' + str(k).replace('"', '""') + '"'

    def _c(n):
        if "semua" in n:
            return "(" + " AND ".join(_c(x) for x in n["semua"]) + ")"
        if "salah_satu" in n:
            return "(" + " OR ".join(_c(x) for x in n["salah_satu"]) + ")"
        if "bukan" in n:
            return "NOT (" + _c(n["bukan"]) + ")"
        k, op, v = prop(n["kolom"]), n["op"], n.get("nilai")
        if op == "kosong":
            return f"{k} IS NULL"
        if op == "tidak_kosong":
            return f"{k} IS NOT NULL"
        if op == "antara":
            return f"{k} BETWEEN {lit(v[0])} AND {lit(v[1])}"
        if op in ("dalam", "tidak_dalam"):
            daftar = v if isinstance(v, (list, tuple)) else [v]
            isi = ", ".join(lit(x) for x in daftar if not _nilai_kosong(x))
            return f"{k} {'NOT ' if op == 'tidak_dalam' else ''}IN ({isi})"
        if op in ("memuat", "diawali"):
            pola = str(v).replace("'", "''").replace("%", "\\%").replace("_", "\\_")
            pola = f"%{pola}%" if op == "memuat" else f"{pola}%"
            return f"CASEI({k}) LIKE CASEI('{pola}')"
        if op in ("=", "!=") and isinstance(v, str):
            return f"CASEI({k}) {'=' if op == '=' else '<>'} CASEI({lit(v)})"
        return f"{k} {'<>' if op == '!=' else op} {lit(v)}"

    teks = _c(bersih)
    return teks[1:-1] if teks.startswith("(") and teks.endswith(")") and ("semua" in bersih or "salah_satu" in bersih) else teks


def deteksi_skema(gdf: pd.DataFrame, kamus: dict | None = None, maks_pilihan: int = 40) -> list[dict]:
    """Daftar kolom beserta tipe untuk membangun form filter/query di front-end.

    kamus: {kolom: {"tipe": "pilihan"|"angka"|..., "domain": [...], "satuan": "m", "label": "..."}}
           Bila kamus tersedia (produksi), kamus dipakai. Tanpa kamus, tipe ditebak:
           angka/tanggal/boolean dari dtype; teks dengan ≤ maks_pilihan nilai unik dianggap pilihan.
    """
    kamus = kamus or {}
    keluar = []
    for k in gdf.columns:
        if k == getattr(gdf, "geometry", pd.Series(name="geometry")).name or str(k).startswith("_"):
            continue
        s = gdf[k]
        info: dict[str, Any] = {"kolom": k}
        if k in kamus:
            info.update(kamus[k])
            info.setdefault("sumber_tipe", "kamus")
        else:
            j = _jenis_kolom(s)
            info["sumber_tipe"] = "tebakan"
            if j == "angka":
                info.update(tipe="angka", min=s.min(), maks=s.max())
            elif j in ("tanggal", "boolean"):
                info.update(tipe=j)
            else:
                unik = sorted({str(v).strip() for v in s.dropna() if str(v).strip()})
                if 0 < len(unik) <= maks_pilihan:
                    info.update(tipe="pilihan", domain=unik)
                else:
                    info.update(tipe="teks")
        info["jumlah_kosong"] = int(s.isna().sum())
        keluar.append(_angka(info))
    return keluar


# =====================================================================================
# U2 — Query atribut layer
# =====================================================================================

def query_layer(gdf: gpd.GeoDataFrame, ekspresi: dict | None) -> dict:
    """U2 — Query atribut layer (definition query).

    Mengembalikan subset objek yang lolos ekspresi atribut, tanpa syarat lokasi.
    Keluaran: jumlah, jumlah_total, bbox [minx, miny, maxx, maxy], cql2, catatan, fitur (GeoDataFrame).
    """
    gdf = baca_layer(gdf)
    mask, catatan = evaluasi_ekspresi(gdf, ekspresi)
    sub = gdf[mask].copy()
    bbox = None if sub.empty else [float(v) for v in sub.total_bounds]
    return {
        "fitur_analisis": "U2 Query Atribut Layer",
        "jumlah": int(mask.sum()),
        "jumlah_total": int(len(gdf)),
        "bbox": bbox,
        "cql2": ke_cql2(ekspresi),
        "catatan": catatan,
        "fitur": sub,
    }


# =====================================================================================
# U1 — Filter berdasarkan lokasi dan atribut
# =====================================================================================

def _geom_lokasi(lokasi: dict, wilayah: gpd.GeoDataFrame | None) -> tuple[Any, str]:
    """Bangun geometri penyaring (EPSG:4326) dari spesifikasi lokasi."""
    tipe = str(lokasi.get("tipe", "")).lower()
    if tipe == "wilayah":
        if wilayah is None:
            raise GalatAnalisis("Lokasi bertipe 'wilayah' membutuhkan layer wilayah (mis. kecamatan).")
        wilayah = baca_layer(wilayah)
        kolom = lokasi.get("kolom", "nama")
        if kolom not in wilayah.columns:
            raise GalatAnalisis(f"Kolom wilayah '{kolom}' tidak ada. Kolom tersedia: {', '.join(wilayah.columns)}.")
        nilai = lokasi.get("nilai")
        nilai = nilai if isinstance(nilai, (list, tuple)) else [nilai]
        kunci = {str(v).strip().casefold() for v in nilai if not _nilai_kosong(v)}
        if not kunci:
            raise GalatAnalisis("Nama wilayah belum diisi.")
        pilih = wilayah[wilayah[kolom].astype(str).str.strip().str.casefold().isin(kunci)]
        tidak_ada = kunci - set(pilih[kolom].astype(str).str.strip().str.casefold())
        if tidak_ada:
            raise GalatAnalisis(f"Wilayah tidak ditemukan: {', '.join(sorted(tidak_ada))}.")
        return make_valid(pilih.geometry.union_all()), "wilayah " + ", ".join(pilih[kolom].astype(str))
    if tipe == "poligon":
        g = make_valid(_ke_geometri(lokasi.get("geometri")))
        if g.geom_type not in ("Polygon", "MultiPolygon", "GeometryCollection") or g.area == 0:
            raise GalatAnalisis("Lokasi bertipe 'poligon' harus berupa Polygon/MultiPolygon.")
        return g, "poligon gambar pengguna"
    if tipe == "radius":
        (lon, lat), = _cek_titik([lokasi.get("titik")], 1, "Titik pusat radius")
        r = lokasi.get("radius_m")
        try:
            r = float(r)
        except (TypeError, ValueError):
            raise GalatAnalisis("radius_m harus berupa angka (meter).")
        if not (0 < r <= 50_000):
            raise GalatAnalisis("radius_m harus antara 0 dan 50.000 m.")
        x, y = _KE_UTM.transform(lon, lat)
        lingkaran = Point(x, y).buffer(r, quad_segs=32)
        return shp_transform(_DARI_UTM.transform, lingkaran), f"radius {fmt_panjang(r)} dari ({lon:.5f}, {lat:.5f})"
    raise GalatAnalisis("tipe lokasi harus 'wilayah', 'poligon', atau 'radius'.")


_DIMENSI = {"Point": 0, "MultiPoint": 0, "LineString": 1, "MultiLineString": 1, "LinearRing": 1,
            "Polygon": 2, "MultiPolygon": 2}
SERPIHAN_PANJANG_M = 0.5   # potongan garis lebih pendek dari ini dianggap hanya menyentuh batas
SERPIHAN_LUAS_M2 = 1.0     # potongan poligon lebih kecil dari ini dianggap serpihan


def _potong_sedimensi(g, g_lok):
    """Potong g dengan g_lok dan pertahankan hanya bagian berdimensi sama dengan g.

    Garis yang hanya menyentuh batas (hasil potong berupa titik atau garis < SERPIHAN_PANJANG_M)
    dan poligon yang hanya bersinggungan dikembalikan None, sehingga tidak ikut dihitung.
    """
    if g is None or g.is_empty:
        return None
    dim = _DIMENSI.get(g.geom_type, 0)
    h = g.intersection(g_lok)
    bagian = [p for p in getattr(h, "geoms", [h]) if not p.is_empty and _DIMENSI.get(p.geom_type, -1) == dim]
    if not bagian:
        return None
    if dim == 0:
        return bagian[0] if len(bagian) == 1 else h
    if dim == 1:
        garis = [q for p in bagian for q in getattr(p, "geoms", [p])]
        hasil = garis[0] if len(garis) == 1 else MultiLineString(garis)
        return hasil if panjang_geodesik(hasil) >= SERPIHAN_PANJANG_M else None
    poli = [q for p in bagian for q in getattr(p, "geoms", [p])]
    hasil = poli[0] if len(poli) == 1 else MultiPolygon(poli)
    return hasil if luas_geodesik(hasil)[0] >= SERPIHAN_LUAS_M2 else None


def _ukur_kolom(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    gdf = gdf.copy()
    gdf["_panjang_m"] = [panjang_geodesik(g) if g is not None and g.geom_type in ("LineString", "MultiLineString") else 0.0
                         for g in gdf.geometry]
    gdf["_luas_m2"] = [luas_geodesik(g)[0] if g is not None else 0.0 for g in gdf.geometry]
    return gdf


def filter_lokasi_atribut(
    gdf: gpd.GeoDataFrame,
    ekspresi: dict | None = None,
    lokasi: dict | None = None,
    wilayah: gpd.GeoDataFrame | None = None,
    predikat: str = "intersects",
    potong_geometri: bool = True,
    ringkas_per_wilayah: bool = True,
    kolom_wilayah: str = "nama",
) -> dict:
    """U1 — Filter berdasarkan lokasi dan atribut.

    gdf       : layer sasaran (jalan, drainase, pipa, titik genangan, ... layer vektor apa pun).
    ekspresi  : ekspresi atribut (lihat bagian mesin ekspresi). None = tanpa syarat atribut.
    lokasi    : None, atau salah satu:
                {"tipe": "wilayah", "kolom": "nama", "nilai": ["Batam Kota"]}
                {"tipe": "poligon", "geometri": <GeoJSON Polygon>}
                {"tipe": "radius", "titik": [lon, lat], "radius_m": 500}
    wilayah   : layer batas (kecamatan/kelurahan/wilayah kerja) untuk lokasi 'wilayah' dan ringkasan.
    predikat  : "intersects" (bawaan; objek yang menyentuh lokasi) atau "within" (seluruhnya di dalam).
    potong_geometri : True = geometri dipotong pada batas lokasi sehingga panjang/luas hanya
                bagian di dalam lokasi (benar untuk "panjang jalan rusak di kecamatan X").
    ringkas_per_wilayah : bila layer wilayah diberikan, hitung jumlah/panjang/luas per wilayah.

    Keluaran dict: jumlah, jumlah_total, panjang_total_m, luas_total_m2, label, per_wilayah,
    kriteria (cql2 atribut + uraian lokasi), catatan, fitur (GeoDataFrame dengan _panjang_m, _luas_m2).
    """
    gdf = baca_layer(gdf)
    if predikat not in ("intersects", "within"):
        raise GalatAnalisis("predikat harus 'intersects' atau 'within'.")
    mask, catatan = evaluasi_ekspresi(gdf, ekspresi)
    hasil = gdf[mask].copy()
    hasil = hasil[hasil.geometry.notna() & ~hasil.geometry.is_empty]
    if len(hasil) < int(mask.sum()):
        catatan.append(f"{int(mask.sum()) - len(hasil)} objek tanpa geometri dikeluarkan.")

    uraian_lokasi = "seluruh wilayah data"
    if lokasi:
        g_lok, uraian_lokasi = _geom_lokasi(lokasi, wilayah)
        geom = hasil.geometry.make_valid()
        lolos = geom.within(g_lok) if predikat == "within" else geom.intersects(g_lok)
        hasil = hasil[lolos.to_numpy()].copy()
        if potong_geometri and predikat == "intersects" and not hasil.empty:
            sebelum = len(hasil)
            hasil["geometry"] = [_potong_sedimensi(g, g_lok) for g in hasil.geometry.make_valid()]
            hasil = hasil[hasil.geometry.notna()].copy()
            if len(hasil) < sebelum:
                catatan.append(f"{sebelum - len(hasil)} objek hanya menyentuh batas lokasi dan tidak dihitung.")

    hasil = _ukur_kolom(hasil)
    per_wilayah = []
    if ringkas_per_wilayah and wilayah is not None and not hasil.empty:
        w = baca_layer(wilayah)
        if kolom_wilayah in w.columns:
            w = w[[kolom_wilayah, "geometry"]].copy()
            w["geometry"] = w.geometry.make_valid()
            dasar = hasil[["geometry"]].reset_index(names="_id")
            pasangan = gpd.sjoin(dasar, w, how="inner", predicate="intersects")
            sil = pasangan.assign(geometry=[_potong_sedimensi(g, w.geometry.loc[i])
                                            for g, i in zip(pasangan.geometry, pasangan["index_right"])])
            sil = _ukur_kolom(gpd.GeoDataFrame(sil[sil.geometry.notna()], geometry="geometry", crs=CRS_DATA))
            for nama, grp in sil.groupby(kolom_wilayah):
                per_wilayah.append({"wilayah": nama, "jumlah": int(grp["_id"].nunique()),
                                    "panjang_m": float(grp["_panjang_m"].sum()), "luas_m2": float(grp["_luas_m2"].sum())})
            per_wilayah.sort(key=lambda r: (-r["panjang_m"], -r["luas_m2"], -r["jumlah"]))

    pt, lt = float(hasil["_panjang_m"].sum()), float(hasil["_luas_m2"].sum())
    label = f"{len(hasil):,} dari {len(gdf):,} objek".replace(",", ".")
    if pt:
        label += f" · total panjang {fmt_panjang(pt)}"
    if lt:
        label += f" · total luas {fmt_luas(lt)}"
    return _angka({
        "fitur_analisis": "U1 Filter Berdasarkan Lokasi dan Atribut",
        "jumlah": int(len(hasil)),
        "jumlah_total": int(len(gdf)),
        "panjang_total_m": pt,
        "luas_total_m2": lt,
        "label": label,
        "per_wilayah": per_wilayah,
        "kriteria": {"atribut_cql2": ke_cql2(ekspresi), "lokasi": uraian_lokasi, "predikat": predikat,
                     "potong_geometri": bool(potong_geometri and lokasi and predikat == "intersects")},
        "catatan": catatan,
    }) | {"fitur": hasil}


# =====================================================================================
# U3 — Analisis profile (profil elevasi permukaan tanah)
# =====================================================================================

def _sampel_lintasan(pts: list[tuple[float, float]], interval: float, maks: int):
    """Sampel geodesik tiap `interval` meter; titik sudut lintasan selalu ikut. -> (lon, lat, sta, idx_sudut)."""
    lon, lat, sta, sudut = [pts[0][0]], [pts[0][1]], [0.0], [0]
    total = 0.0
    panjang_seg = [GEOD.inv(a[0], a[1], b[0], b[1])[2] for a, b in zip(pts[:-1], pts[1:])]
    if sum(panjang_seg) / interval > maks:
        interval = sum(panjang_seg) / maks
    for (a, b), L in zip(zip(pts[:-1], pts[1:]), panjang_seg):
        if L > 0:
            n = int(L // interval)
            jarak = [k * interval for k in range(1, n + 1) if k * interval < L - 1e-6]
            if jarak:
                az = GEOD.inv(a[0], a[1], b[0], b[1])[0]
                x, y, _ = GEOD.fwd([a[0]] * len(jarak), [a[1]] * len(jarak), [az] * len(jarak), jarak)
                lon.extend(x); lat.extend(y); sta.extend(total + d for d in jarak)
        total += L
        lon.append(b[0]); lat.append(b[1]); sta.append(total); sudut.append(len(sta) - 1)
    return np.array(lon), np.array(lat), np.array(sta), sudut, interval


class RasterLarik:
    """DEM di memori (numpy) dengan antarmuka minimal yang dipakai profil_elevasi().

    Dipakai bila rasterio tidak tersedia (mis. di peramban lewat Pyodide) atau bila raster sudah
    dibaca dari sumber lain (PostGIS raster, layanan WCS). Grid utara-atas tanpa rotasi.

    larik : array 2D (baris dari utara ke selatan); nilai `nodata` atau NaN dianggap kosong.
    x0, y0: koordinat pojok kiri-atas piksel pertama dalam `crs`.
    res_x, res_y : ukuran piksel (positif).
    """

    def __init__(self, larik, x0: float, y0: float, res_x: float, res_y: float, crs: str,
                 nodata: float | None = None, tags: dict | None = None):
        from pyproj import CRS
        z = np.asarray(larik, dtype="float64")
        if z.ndim != 2:
            raise GalatAnalisis("RasterLarik membutuhkan array 2 dimensi.")
        if nodata is not None:
            z = np.where(z == nodata, np.nan, z)
        self.larik, self.x0, self.y0 = z, float(x0), float(y0)
        self.res = (float(res_x), float(res_y))
        self.height, self.width = z.shape
        self.crs = CRS.from_user_input(crs)
        self._tags = dict(tags or {})

    def tags(self) -> dict:
        return dict(self._tags)

    def ke_kolom_baris(self, xs, ys):
        return (np.asarray(xs) - self.x0) / self.res[0], (self.y0 - np.asarray(ys)) / self.res[1]

    def baca_blok(self, c0: int, r0: int, lebar: int, tinggi: int) -> np.ndarray:
        return self.larik[r0:r0 + tinggi, c0:c0 + lebar]


def _bilinear(ds, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Interpolasi bilinear pada pusat piksel. Bila salah satu dari 4 tetangga nodata -> NaN."""
    if isinstance(ds, RasterLarik):
        col_f, row_f = ds.ke_kolom_baris(xs, ys)
    else:
        inv = ~ds.transform
        col_f, row_f = inv * (xs, ys)
    col_f, row_f = np.asarray(col_f) - 0.5, np.asarray(row_f) - 0.5
    c0, r0 = np.floor(col_f).astype(int), np.floor(row_f).astype(int)
    hasil = np.full(xs.shape, np.nan)
    di_dalam = (c0 >= 0) & (r0 >= 0) & (c0 + 1 < ds.width) & (r0 + 1 < ds.height)
    if not di_dalam.any():
        return hasil
    cmin, cmax = c0[di_dalam].min(), c0[di_dalam].max() + 1
    rmin, rmax = r0[di_dalam].min(), r0[di_dalam].max() + 1
    if isinstance(ds, RasterLarik):
        blok = ds.baca_blok(cmin, rmin, cmax - cmin + 1, rmax - rmin + 1)
    else:
        from rasterio.windows import Window
        blok = ds.read(1, window=Window(cmin, rmin, cmax - cmin + 1, rmax - rmin + 1), masked=True)
        blok = blok.astype("float64").filled(np.nan)
    c, r = c0[di_dalam] - cmin, r0[di_dalam] - rmin
    fx, fy = col_f[di_dalam] - c0[di_dalam], row_f[di_dalam] - r0[di_dalam]
    z00, z01 = blok[r, c], blok[r, c + 1]
    z10, z11 = blok[r + 1, c], blok[r + 1, c + 1]
    hasil[di_dalam] = (z00 * (1 - fx) * (1 - fy) + z01 * fx * (1 - fy) + z10 * (1 - fx) * fy + z11 * fx * fy)
    return hasil


def profil_elevasi(
    lintasan: Any,
    dem: Any,
    interval_m: float | None = None,
    datum_vertikal: str | None = None,
    jendela_kemiringan_m: float | None = None,
    maks_sampel: int = 5000,
) -> dict:
    """U3 — Analisis profile: profil elevasi PERMUKAAN TANAH sepanjang lintasan.

    Bukan profil dasar saluran/pipa (butuh elevasi invert survei; ditangani modul drainase D4).

    lintasan : daftar [[lon, lat], ...] (≥ 2 titik) atau GeoJSON LineString.
    dem      : path GeoTIFF, dataset rasterio yang sudah terbuka (CRS apa pun), atau RasterLarik.
    interval_m : jarak antarsampel. Bawaan = resolusi DEM (sampel lebih rapat tidak menambah informasi).
    datum_vertikal : mis. "EGM2008 (DEMNAS)". Bila None dibaca dari tag GeoTIFF VERTICAL_DATUM.
    jendela_kemiringan_m : panjang jendela kemiringan lokal. Bawaan = 2 × resolusi DEM.

    Keluaran ringkasan memuat kemiringan ujung-ke-ujung (bukan rentang relief seperti prototipe),
    kemiringan per segmen, kemiringan lokal maksimum, naik/turun kumulatif, dan titik terendah/tertinggi.
    """
    if isinstance(lintasan, dict) or hasattr(lintasan, "geom_type"):
        g = _ke_geometri(lintasan)
        if g.geom_type != "LineString":
            raise GalatAnalisis("Lintasan profil harus berupa LineString.")
        lintasan = list(g.coords)
    pts = _cek_titik(lintasan, 2, "Lintasan profil")
    catatan = _peringatan_bbox(pts)

    buka_sendiri = not (hasattr(dem, "read") or isinstance(dem, RasterLarik))
    if buka_sendiri:
        import rasterio
        ds = rasterio.open(dem)
    else:
        ds = dem
    try:
        if ds.crs is None:
            raise GalatAnalisis("DEM tidak memiliki sistem koordinat.")
        tags = ds.tags()
        if ds.crs.is_geographic:
            lat_tengah = float(np.mean([p[1] for p in pts]))
            res_m = float(min(abs(ds.res[0]) * 111_320 * math.cos(math.radians(lat_tengah)), abs(ds.res[1]) * 110_574))
        else:
            res_m = float(min(abs(ds.res[0]), abs(ds.res[1])))
        interval = float(interval_m) if interval_m else max(res_m, 1.0)
        if interval <= 0:
            raise GalatAnalisis("interval_m harus lebih dari 0.")
        if interval < res_m / 2:
            catatan.append(f"Interval {fmt_panjang(interval)} jauh lebih rapat dari resolusi DEM ({fmt_panjang(res_m)}); "
                           "sampel tambahan hanya hasil interpolasi.")
        lon, lat, sta, sudut, interval_pakai = _sampel_lintasan(pts, interval, maks_sampel)
        if interval_pakai > interval:
            catatan.append(f"Lintasan panjang: interval diperbesar menjadi {fmt_panjang(interval_pakai)} (batas {maks_sampel} sampel).")
        tr = Transformer.from_crs(CRS_DATA, ds.crs, always_xy=True)
        xs, ys = tr.transform(lon, lat)
        z = _bilinear(ds, np.asarray(xs), np.asarray(ys))
        datum = datum_vertikal or tags.get("VERTICAL_DATUM") or "tidak diketahui (wajib dicek di metadata DEM)"
        sumber_dem = tags.get("SUMBER") or tags.get("TIFFTAG_IMAGEDESCRIPTION") or ""
        crs_dem = ds.crs.to_string()
    finally:
        if buka_sendiri:
            ds.close()

    valid = ~np.isnan(z)
    L = float(sta[-1])
    if valid.sum() < 2:
        raise GalatAnalisis("Lintasan hampir seluruhnya di luar cakupan DEM atau di area nodata (mis. laut).")
    if (~valid).any():
        catatan.append(f"{int((~valid).sum())} dari {len(z)} sampel tidak memiliki elevasi (di luar DEM/nodata) "
                       "dan dikecualikan dari statistik.")

    zv, sv = z[valid], sta[valid]
    i_min, i_max = int(np.argmin(zv)), int(np.argmax(zv))
    dz = np.diff(zv)
    z_awal, z_akhir = (float(z[0]) if valid[0] else None), (float(z[-1]) if valid[-1] else None)
    if z_awal is None or z_akhir is None:
        catatan.append("Titik awal/akhir tanpa elevasi; kemiringan ujung-ke-ujung dihitung dari sampel valid pertama/terakhir.")
    za, zb, sa, sb = float(zv[0]), float(zv[-1]), float(sv[0]), float(sv[-1])
    kemiringan_ujung = (zb - za) / (sb - sa) * 100 if sb > sa else None

    jendela = float(jendela_kemiringan_m) if jendela_kemiringan_m else 2 * max(res_m, interval_pakai)
    lokal_maks, lokal_sta = 0.0, None
    j = 0
    for i in range(len(sv)):
        j = max(j, i)
        while j < len(sv) and sv[j] - sv[i] < jendela:
            j += 1
        if j >= len(sv):
            break
        s = (zv[j] - zv[i]) / (sv[j] - sv[i]) * 100
        if abs(s) > abs(lokal_maks):
            lokal_maks, lokal_sta = float(s), float((sv[i] + sv[j]) / 2)

    segmen = []
    for k, (ia, ib) in enumerate(zip(sudut[:-1], sudut[1:]), start=1):
        Ls = float(sta[ib] - sta[ia])
        ok = valid[ia] and valid[ib] and Ls > 0
        segmen.append({"segmen": k, "sta_awal_m": float(sta[ia]), "sta_akhir_m": float(sta[ib]), "panjang_m": Ls,
                       "z_awal": float(z[ia]) if valid[ia] else None, "z_akhir": float(z[ib]) if valid[ib] else None,
                       "kemiringan_pct": float((z[ib] - z[ia]) / Ls * 100) if ok else None})

    panjang_permukaan = float(np.sum(np.hypot(np.diff(sv), dz))) + (L - float(sv[-1] - sv[0]))
    ringkasan = {
        "panjang_lintasan_m": L,
        "panjang_permukaan_m": panjang_permukaan,
        "z_awal": z_awal, "z_akhir": z_akhir,
        "z_min": float(zv[i_min]), "sta_z_min_m": float(sv[i_min]),
        "lon_z_min": float(lon[valid][i_min]), "lat_z_min": float(lat[valid][i_min]),
        "z_maks": float(zv[i_max]), "sta_z_maks_m": float(sv[i_max]),
        "rentang_relief_m": float(zv[i_max] - zv[i_min]),
        "kemiringan_ujung_ke_ujung_pct": kemiringan_ujung,
        "kemiringan_lokal_maks_pct": lokal_maks if lokal_sta is not None else None,
        "sta_kemiringan_lokal_maks_m": lokal_sta,
        "jendela_kemiringan_lokal_m": jendela,
        "naik_kumulatif_m": float(dz[dz > 0].sum()),
        "turun_kumulatif_m": float(-dz[dz < 0].sum()),
        "jumlah_sampel": int(len(z)), "jumlah_sampel_valid": int(valid.sum()),
        "interval_sampel_m": float(interval_pakai),
    }
    catatan.append("Profil permukaan tanah dari DEM, bukan profil dasar saluran/pipa. "
                   "Titik terendah lintasan belum tentu lokasi genangan (lihat modul D5).")
    return _angka({
        "fitur_analisis": "U3 Analisis Profile (profil elevasi)",
        "ringkasan": ringkasan,
        "segmen": segmen,
        "sampel": [{"sta_m": float(s), "lon": float(a), "lat": float(b), "z": (float(c) if not math.isnan(c) else None)}
                   for s, a, b, c in zip(sta, lon, lat, z)],
        "dem": {"resolusi_m": res_m, "crs": crs_dem, "datum_vertikal": datum, "sumber": sumber_dem,
                "interpolasi": "bilinear"},
        "label": (f"Panjang {fmt_panjang(L)} · Δh relief {_fmt_id(ringkasan['rentang_relief_m'], 1)} m · "
                  f"kemiringan ujung-ke-ujung {_fmt_id(kemiringan_ujung, 2) if kemiringan_ujung is not None else '—'}%"),
        "catatan": catatan,
    })


# =====================================================================================
# U4 — Perhitungan jarak
# =====================================================================================

def ukur_jarak(titik: Any, bandingkan_utm: bool = False) -> dict:
    """U4 — Perhitungan jarak: panjang lintasan multi-segmen geodesik (elipsoid WGS84, Karney 2013).

    titik : daftar [[lon, lat], ...] (≥ 2) atau GeoJSON LineString.
    bandingkan_utm : tambahkan panjang grid UTM 48N sebagai pembanding gambar CAD/DED.

    Keluaran: panjang_lintasan_m, jarak_lurus_m (awal–akhir), segmen [{ke, panjang_m, azimut_deg}],
    label (format id-ID), dan bila diminta panjang_grid_utm_m serta selisihnya.
    """
    if isinstance(titik, dict) or hasattr(titik, "geom_type"):
        g = _ke_geometri(titik)
        if g.geom_type != "LineString":
            raise GalatAnalisis("Masukan ukur jarak harus berupa LineString.")
        titik = list(g.coords)
    pts = _cek_titik(titik, 2, "Ukur jarak")
    segmen, total = [], 0.0
    for i, (a, b) in enumerate(zip(pts[:-1], pts[1:]), start=1):
        az, _, d = GEOD.inv(a[0], a[1], b[0], b[1])
        segmen.append({"ke": i, "panjang_m": float(d), "azimut_deg": float(az % 360), "label": fmt_panjang(d)})
        total += d
    lurus = GEOD.inv(pts[0][0], pts[0][1], pts[-1][0], pts[-1][1])[2]
    hasil = {
        "fitur_analisis": "U4 Perhitungan Jarak",
        "panjang_lintasan_m": float(total),
        "jarak_lurus_m": float(lurus),
        "jumlah_titik": len(pts),
        "segmen": segmen,
        "label": fmt_panjang(total),
        "metode": "geodesik elipsoid WGS84 (Karney 2013); jarak horizontal, bukan jarak miring",
        "catatan": _peringatan_bbox(pts),
    }
    if bandingkan_utm:
        utm = LineString([_KE_UTM.transform(*p) for p in pts]).length
        hasil["panjang_grid_utm_m"] = float(utm)
        hasil["selisih_utm_pct"] = float((utm - total) / total * 100) if total else 0.0
    return _angka(hasil)


# =====================================================================================
# U5 — Perhitungan luas
# =====================================================================================

def ukur_luas(poligon: Any, perbaiki: bool = False, bandingkan_utm: bool = False) -> dict:
    """U5 — Perhitungan luas dan keliling geodesik (elipsoid WGS84, Karney 2013).

    poligon : daftar [[lon, lat], ...] (cincin luar, ≥ 3 titik; boleh tidak ditutup),
              GeoJSON Polygon/MultiPolygon, atau shapely.
    perbaiki: False = poligon tidak valid (mis. memotong diri) ditolak dengan pesan;
              True  = diperbaiki dengan make_valid dan hanya bagian poligonal yang dipakai.
    bandingkan_utm : tambahkan luas grid UTM 48N sebagai pembanding.

    Keluaran: luas_m2, luas_ha, luas_km2, keliling_m (tepi luar), valid, diperbaiki, label.
    """
    if isinstance(poligon, (list, tuple)):
        pts = _cek_titik(poligon, 3, "Ukur luas")
        if pts[0] != pts[-1]:
            pts = pts + [pts[0]]
        if len(set(pts)) < 3:
            raise GalatAnalisis("Ukur luas: dibutuhkan minimal 3 titik berbeda.")
        geom = Polygon(pts)
    else:
        geom = _ke_geometri(poligon)
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise GalatAnalisis("Masukan ukur luas harus berupa Polygon/MultiPolygon.")
    catatan = _peringatan_bbox([c for c in (geom.exterior.coords if geom.geom_type == "Polygon"
                                            else geom.geoms[0].exterior.coords)])
    valid, alasan, diperbaiki = geom.is_valid, None, False
    if not valid:
        alasan = explain_validity(geom)
        if not perbaiki:
            raise GalatAnalisis(f"Poligon tidak valid ({alasan}). Poligon yang memotong dirinya sendiri "
                                "menghasilkan luas yang salah. Perbaiki gambar, atau jalankan dengan perbaiki=True.")
        g2 = make_valid(geom)
        bagian = [g for g in getattr(g2, "geoms", [g2]) if g.geom_type in ("Polygon", "MultiPolygon")]
        geom = MultiPolygon([p for b in bagian for p in getattr(b, "geoms", [b])])
        diperbaiki = True
        catatan.append(f"Poligon diperbaiki otomatis (semula: {alasan}).")
    luas, keliling = luas_geodesik(geom)
    if luas <= 0:
        raise GalatAnalisis("Luas poligon nol.")
    hasil = {
        "fitur_analisis": "U5 Perhitungan Luas",
        "luas_m2": float(luas), "luas_ha": float(luas / 1e4), "luas_km2": float(luas / 1e6),
        "keliling_m": float(keliling),
        "jumlah_bagian": 1 if geom.geom_type == "Polygon" else len(geom.geoms),
        "valid": bool(valid), "alasan_tidak_valid": alasan, "diperbaiki": diperbaiki,
        "label": f"{fmt_luas(luas)} · keliling {fmt_panjang(keliling)}",
        "metode": "luas geodesik elipsoid WGS84 (Karney 2013); lubang dikurangkan",
        "catatan": catatan,
    }
    if bandingkan_utm:
        a_utm = shp_transform(_KE_UTM.transform, geom).area
        hasil["luas_grid_utm_m2"] = float(a_utm)
        hasil["selisih_utm_pct"] = float((a_utm - luas) / luas * 100)
    return _angka(hasil)


# =====================================================================================
# Antarmuka baris perintah (untuk uji cepat dan integrasi berbasis proses)
# =====================================================================================

def _muat_json(teks_atau_path: str | None):
    if teks_atau_path is None:
        return None
    t = teks_atau_path.strip()
    if t.startswith(("{", "[")):
        return json.loads(t)
    with open(t, encoding="utf-8") as f:
        return json.load(f)


def _cetak(hasil: dict, keluaran: str | None):
    fitur = hasil.pop("fitur", None)
    if fitur is not None and keluaran:
        fitur.to_file(keluaran, driver="GeoJSON")
        hasil["file_fitur"] = keluaran
    elif fitur is not None:
        hasil["jumlah_fitur_dikembalikan"] = int(len(fitur))
    print(json.dumps(_angka(hasil), ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Fitur Analisis Dasar SIGMA Batam (U1–U5).")
    sub = p.add_subparsers(dest="perintah", required=True)

    s = sub.add_parser("skema", help="Daftar kolom dan tipe layer (untuk form filter)")
    s.add_argument("--data", required=True); s.add_argument("--layer")

    s = sub.add_parser("query", help="U2 query atribut layer")
    s.add_argument("--data", required=True); s.add_argument("--layer")
    s.add_argument("--ekspresi", required=True, help="JSON atau path file JSON")
    s.add_argument("--keluaran", help="Simpan hasil sebagai GeoJSON")

    s = sub.add_parser("filter", help="U1 filter lokasi dan atribut")
    s.add_argument("--spek", required=True, help="JSON/path: {layer, ekspresi, lokasi, predikat, potong_geometri}")
    s.add_argument("--data", required=True, help="GeoPackage berisi layer sasaran dan layer wilayah")
    s.add_argument("--layer-wilayah", default="kecamatan")
    s.add_argument("--keluaran")

    s = sub.add_parser("profil", help="U3 profil elevasi")
    s.add_argument("--lintasan", required=True, help='JSON [[lon,lat],...]')
    s.add_argument("--dem", required=True); s.add_argument("--interval", type=float)
    s.add_argument("--datum"); s.add_argument("--tanpa-sampel", action="store_true")

    s = sub.add_parser("jarak", help="U4 ukur jarak")
    s.add_argument("--titik", required=True); s.add_argument("--utm", action="store_true")

    s = sub.add_parser("luas", help="U5 ukur luas")
    s.add_argument("--poligon", required=True); s.add_argument("--perbaiki", action="store_true")
    s.add_argument("--utm", action="store_true")

    a = p.parse_args(argv)
    for aliran in (sys.stdout, sys.stderr):  # konsol Windows (cp1252) tidak dapat mencetak Δ, ², ·
        if hasattr(aliran, "reconfigure"):
            aliran.reconfigure(encoding="utf-8")
    try:
        if a.perintah == "skema":
            print(json.dumps(deteksi_skema(baca_layer(a.data, a.layer)), ensure_ascii=False, indent=2))
        elif a.perintah == "query":
            _cetak(query_layer(baca_layer(a.data, a.layer), _muat_json(a.ekspresi)), a.keluaran)
        elif a.perintah == "filter":
            spek = _muat_json(a.spek)
            layer = baca_layer(a.data, spek["layer"])
            wilayah = baca_layer(a.data, a.layer_wilayah)
            _cetak(filter_lokasi_atribut(layer, spek.get("ekspresi"), spek.get("lokasi"), wilayah,
                                         spek.get("predikat", "intersects"), spek.get("potong_geometri", True),
                                         kolom_wilayah=spek.get("kolom_wilayah", "nama")), a.keluaran)
        elif a.perintah == "profil":
            h = profil_elevasi(_muat_json(a.lintasan), a.dem, a.interval, a.datum)
            if a.tanpa_sampel:
                h.pop("sampel")
            _cetak(h, None)
        elif a.perintah == "jarak":
            _cetak(ukur_jarak(_muat_json(a.titik), a.utm), None)
        elif a.perintah == "luas":
            _cetak(ukur_luas(_muat_json(a.poligon), a.perbaiki, a.utm), None)
    except GalatAnalisis as e:
        print(json.dumps({"galat": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
