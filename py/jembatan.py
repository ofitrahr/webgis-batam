"""
jembatan.py — Perekat antara antarmuka web (JavaScript) dan modul analisis (sigma_*.py) di Pyodide.

File ini khusus prototipe web dan TIDAK diserahkan ke tim IT. Modul analisis yang dijalankan
adalah salinan persis dari folder ANALISIS (lihat alat/bangun_web.py).

Semua fungsi menerima/mengembalikan string JSON agar pertukaran data JS <-> Python sederhana.
"""
import json
import traceback
import unittest

import numpy as np

import sigma_umum as su

LAYER: dict = {}
DEM = None


def muat_layer(nama: str, teks_geojson: str) -> int:
    LAYER[nama] = su.baca_layer(json.loads(teks_geojson))
    return len(LAYER[nama])


def muat_dem(buf, teks_meta: str) -> str:
    global DEM
    m = json.loads(teks_meta)
    data = buf.to_py() if hasattr(buf, "to_py") else buf
    z = np.frombuffer(bytes(data), dtype="<i2").reshape(m["tinggi"], m["lebar"]).astype("float64")
    z[z == m["nodata"]] = np.nan
    z *= m["skala"]
    DEM = su.RasterLarik(z, m["x0"], m["y0"], m["res_x"], m["res_y"], m["crs"],
                         tags={"VERTICAL_DATUM": m.get("datum_vertikal", ""), "SUMBER": m.get("sumber", "")})
    return f"{m['lebar']}x{m['tinggi']}"


def _layer(nama):
    if nama not in LAYER:
        raise su.GalatAnalisis(f"Layer '{nama}' belum dimuat.")
    return LAYER[nama]


def jalankan(fungsi: str, teks_spek: str) -> str:
    """Jalankan satu fitur. Galat masukan -> {"galat": ...}; galat lain -> {"galat_sistem": ..., "jejak": ...}."""
    s = json.loads(teks_spek or "{}")
    try:
        if fungsi == "skema":
            return json.dumps(su.deteksi_skema(_layer(s["layer"])), ensure_ascii=False)
        if fungsi == "u1":
            h = su.filter_lokasi_atribut(_layer(s["layer"]), s.get("ekspresi"), s.get("lokasi"), LAYER.get("kecamatan"),
                                         s.get("predikat", "intersects"), s.get("potong_geometri", True))
        elif fungsi == "u2":
            h = su.query_layer(_layer(s["layer"]), s.get("ekspresi"))
            f = h.pop("fitur")
            h["indeks"] = [int(i) for i in f["_i"]] if "_i" in f.columns else []
        elif fungsi == "u3":
            if DEM is None:
                raise su.GalatAnalisis("DEM belum dimuat.")
            h = su.profil_elevasi(s["lintasan"], DEM, s.get("interval_m") or None)
        elif fungsi == "u4":
            h = su.ukur_jarak(s["titik"], bandingkan_utm=True)
        elif fungsi == "u5":
            h = su.ukur_luas(s["poligon"], perbaiki=bool(s.get("perbaiki")), bandingkan_utm=True)
        else:
            raise su.GalatAnalisis(f"Fungsi '{fungsi}' tidak dikenal.")
        if "fitur" in h:
            h["fitur"] = su.ke_geojson(h["fitur"])
        return json.dumps(su._angka(h), ensure_ascii=False)
    except su.GalatAnalisis as e:
        return json.dumps({"galat": str(e)}, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"galat_sistem": f"{type(e).__name__}: {e}", "jejak": traceback.format_exc()}, ensure_ascii=False)


def _ratakan(s):
    for x in s:
        if isinstance(x, unittest.TestSuite):
            yield from _ratakan(x)
        else:
            yield x


class _HasilPerUji(unittest.TestResult):
    """Mencatat status setiap uji. Suite dijalankan utuh agar setUpClass/tearDownClass ikut berjalan."""

    def __init__(self):
        super().__init__()
        self.catat = {}

    def addSuccess(self, test):
        super().addSuccess(test); self.catat[test.id()] = ("lulus", "")

    def addFailure(self, test, err):
        super().addFailure(test, err); self.catat[test.id()] = ("gagal", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err); self.catat[test.id()] = ("galat", self._exc_info_to_string(err, test))

    def addSkip(self, test, reason):
        super().addSkip(test, reason); self.catat[test.id()] = ("dilewati", reason)


def jalankan_uji(nama_modul: str = "test_sigma_umum") -> str:
    """Jalankan unit test modul analisis dan kembalikan hasil per uji."""
    import importlib
    mod = importlib.reload(importlib.import_module(nama_modul))
    suite = unittest.TestLoader().loadTestsFromModule(mod)
    daftar = list(_ratakan(suite))
    r = _HasilPerUji()
    suite.run(r)
    keluar = []
    for tc in daftar:
        st, pesan = r.catat.get(tc.id(), ("galat", "Uji tidak dijalankan (kemungkinan setUpClass gagal; lihat baris galat kelas)."))
        keluar.append({"modul": nama_modul, "kelas": type(tc).__name__, "uji": tc._testMethodName,
                       "dok": (getattr(tc, tc._testMethodName).__doc__ or "").strip(), "status": st, "pesan": pesan[-1500:]})
    for tid, (st, pesan) in r.catat.items():  # galat di setUpClass/setUpModule tercatat dengan id khusus
        if not any(tc.id() == tid for tc in daftar):
            keluar.append({"modul": nama_modul, "kelas": tid, "uji": "(fixture)", "dok": "", "status": st, "pesan": pesan[-1500:]})
    return json.dumps(keluar, ensure_ascii=False)
