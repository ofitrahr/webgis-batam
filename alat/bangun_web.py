"""
bangun_web.py — Menyinkronkan script analisis dan data ke prototipe WebGIS QA (GitHub Pages).

Jalankan setiap kali ada fitur/script/data baru:
    python alat/bangun_web.py
    python alat/bangun_web.py --analisis "D:/WEBGIS BATAM/INTERNAL-WEBGIS BATAM/ANALISIS"

Yang dilakukan:
  1. Menyalin modul Python setiap paket (ANALISIS/NN_*/{sigma_*.py, test_sigma_*.py}) ke py/.
     Peramban menjalankan salinan ini lewat Pyodide, jadi QA menguji kode yang sama dengan
     yang diserahkan ke tim IT.
  2. Mengekspor layer GeoPackage data contoh ke data/<layer>.geojson (koordinat 6 desimal).
  3. Mengekspor DEM ke data/dem.bin (int16, desimeter, little-endian) + data/dem.json (metadata),
     dipotong ke cakupan layer jalan agar ringan dimuat peramban.
  4. Menulis data/manifest.json (daftar layer, status data, versi build, daftar modul Python).

Sumber kebenaran tetap folder ANALISIS. Jangan menyunting py/ secara langsung.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ANALISIS_BAWAAN = REPO.parent / "INTERNAL-WEBGIS BATAM" / "ANALISIS"

# Gaya & keterangan layer. Tambahkan baris di sini saat ada layer baru.
GAYA = {
    "kecamatan": {"label": "Batas Kecamatan", "warna": "#1f3a5f", "urut": 1, "rfi": "A02"},
    "jalan": {"label": "Jaringan Jalan", "warna": "#7f8c8d", "urut": 2, "rfi": "C01–C03"},
    "drainase": {"label": "Jaringan Drainase", "warna": "#2e86de", "urut": 3, "rfi": "D01, D02, D06"},
    "pipa_spam": {"label": "Pipa SPAM", "warna": "#c0392b", "urut": 4, "rfi": "E01"},
    "genangan": {"label": "Titik Genangan", "warna": "#8e44ad", "urut": 5, "rfi": "D07"},
}


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:10]


def salin_modul(analisis: Path) -> list[dict]:
    tujuan = REPO / "py"
    tujuan.mkdir(exist_ok=True)
    modul = []
    for paket in sorted(p for p in analisis.iterdir() if p.is_dir() and p.name[:2].isdigit()):
        for f in sorted(list(paket.glob("sigma_*.py")) + list(paket.glob("test_sigma_*.py"))):
            shutil.copy2(f, tujuan / f.name)
            modul.append({"paket": paket.name, "file": f.name, "sha": _sha(f)})
            print(f"  py/{f.name:28s} <- {paket.name}")
    return modul


def ekspor_layer(gpkg: Path) -> list[dict]:
    import geopandas as gpd
    import pyogrio

    keluar = []
    for nama, *_ in pyogrio.list_layers(gpkg):
        gdf = gpd.read_file(gpkg, layer=nama).to_crs("EPSG:4326")
        for k in gdf.columns:
            if str(gdf[k].dtype).startswith("datetime"):
                gdf[k] = gdf[k].dt.strftime("%Y-%m-%d")
        f = REPO / "data" / f"{nama}.geojson"
        f.write_text(gdf.to_json(na="drop", drop_id=True, to_wgs84=True).replace("NaN", "null"), encoding="utf-8")
        _bulatkan(f)
        dummy = sorted({x.split("(")[0].strip() for s in gdf.get("atribut_dummy", []).dropna() for x in str(s).split(",") if x.strip()})
        sumber = sorted(gdf["sumber_geometri"].dropna().unique().tolist()) if "sumber_geometri" in gdf else []
        g = GAYA.get(nama, {"label": nama, "warna": "#555555", "urut": 99, "rfi": ""})
        keluar.append({"id": nama, **g, "file": f"data/{nama}.geojson", "jumlah": int(len(gdf)),
                       "geometri": gdf.geom_type.mode().iat[0], "kolom": [c for c in gdf.columns if c != "geometry"],
                       "kolom_dummy": dummy, "sumber_geometri": sumber,
                       "status": "Dummy" if all("DUMMY" in s for s in sumber) or "semua" in dummy
                       else ("Riil sementara (OSM) + atribut dummy" if dummy else "Riil sementara (OSM)"),
                       "ukuran_kb": round(f.stat().st_size / 1024)})
        print(f"  data/{nama}.geojson  {len(gdf)} fitur  {f.stat().st_size / 1e6:.2f} MB")
    return sorted(keluar, key=lambda x: x["urut"])


def _bulatkan(f: Path, des: int = 6):
    d = json.loads(f.read_text(encoding="utf-8"))

    def r(c):
        return [r(x) for x in c] if isinstance(c[0], list) else [round(c[0], des), round(c[1], des)]

    for ft in d["features"]:
        g = ft.get("geometry")
        if g and g.get("coordinates"):
            g["coordinates"] = r(g["coordinates"])
        for k, v in list(ft["properties"].items()):
            if isinstance(v, float):
                ft["properties"][k] = round(v, 4)
    f.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def ekspor_dem(tif: Path, gpkg: Path) -> dict:
    import geopandas as gpd
    import numpy as np
    import rasterio
    from rasterio.windows import Window, from_bounds

    jl = gpd.read_file(gpkg, layer="jalan")
    with rasterio.open(tif) as ds:
        x0, y0, x1, y1 = jl.to_crs(ds.crs).total_bounds
        m = 1000
        w = from_bounds(x0 - m, y0 - m, x1 + m, y1 + m, ds.transform).round_offsets().round_lengths()
        # Jendela harus di dalam raster: bila melewati tepi, rasterio memotong data tetapi
        # window_transform tetap memakai offset di luar tepi sehingga DEM bergeser.
        w = w.intersection(Window(0, 0, ds.width, ds.height))
        z = ds.read(1, window=w, masked=True)
        tr = ds.window_transform(w)
        nod = -32768
        dm = np.where(z.mask, nod, np.round(z.filled(0) * 10)).astype("<i2")
        (REPO / "data" / "dem.bin").write_bytes(dm.tobytes())
        meta = {"file": "data/dem.bin", "dtype": "int16-le", "skala": 0.1, "nodata": nod,
                "lebar": int(dm.shape[1]), "tinggi": int(dm.shape[0]), "x0": tr.c, "y0": tr.f,
                "res_x": tr.a, "res_y": -tr.e, "crs": ds.crs.to_string(),
                "datum_vertikal": ds.tags().get("VERTICAL_DATUM", "tidak diketahui"),
                "sumber": ds.tags().get("SUMBER", tif.name), "status": "Dummy" if "DUMMY" in ds.tags().get("SUMBER", "").upper() else "Riil",
                "catatan": "Dipotong ke cakupan layer jalan + 1 km dan dikuantisasi 0,1 m untuk peramban."}
    # Verifikasi: nilai di beberapa titik harus sama dengan GeoTIFF sumber (toleransi kuantisasi 0,05 m).
    with rasterio.open(tif) as ds:
        rng = np.random.default_rng(0)
        rr, cc = rng.integers(0, dm.shape[0], 200), rng.integers(0, dm.shape[1], 200)
        xs, ys = meta["x0"] + (cc + 0.5) * meta["res_x"], meta["y0"] - (rr + 0.5) * meta["res_y"]
        asli = np.array([v[0] for v in ds.sample(zip(xs, ys))])
        web = dm[rr, cc].astype(float)
        ok = (web == nod) == (asli == ds.nodata)
        sama = np.abs(web[web != nod] * 0.1 - asli[web != nod]) <= 0.051
        if not (ok.all() and sama.all()):
            raise SystemExit("Verifikasi DEM web gagal: nilai tidak sama dengan GeoTIFF sumber.")
    (REPO / "data" / "dem.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  data/dem.bin  {dm.shape[1]}x{dm.shape[0]} px  {(REPO / 'data' / 'dem.bin').stat().st_size / 1e6:.2f} MB")
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analisis", type=Path, default=ANALISIS_BAWAAN)
    ap.add_argument("--paket-data", default="01_ANALISIS_UMUM", help="paket yang data/ contohnya diekspor")
    a = ap.parse_args()
    if not a.analisis.exists():
        sys.exit(f"Folder ANALISIS tidak ditemukan: {a.analisis}")
    sys.path.insert(0, str(a.analisis / a.paket_data))
    import sigma_umum  # noqa: F401  (memperbaiki PROJ_LIB/GDAL_DATA bila menunjuk ke PostGIS)

    (REPO / "data").mkdir(exist_ok=True)
    print("1) Modul Python");  modul = salin_modul(a.analisis)
    data_dir = a.analisis / a.paket_data / "data"
    print("2) Layer");  layer = ekspor_layer(data_dir / "sigma_contoh.gpkg")
    print("3) DEM");  dem = ekspor_dem(data_dir / "dem_dummy.tif", data_dir / "sigma_contoh.gpkg")
    manifest = {"dibangun": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                "modul_python": modul, "jembatan_sha": _sha(REPO / "py" / "jembatan.py"), "layer": layer, "dem": dem}
    (REPO / "data" / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print("4) data/manifest.json ditulis")


if __name__ == "__main__":
    main()
