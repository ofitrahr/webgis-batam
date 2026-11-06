"""
Uji otomatis sigma_umum.py (U1–U5).  Jalankan:  python -m unittest -v test_sigma_umum

Nilai acuan:
  * 1° bujur di ekuator (WGS84) = a·π/180 = 111.319,4908 m
  * Luas sel 1°×1° di ekuator (WGS84) = 12.308,778 km² (Karney 2013; GeographicLib)
"""
import math
import os
import tempfile
import unittest
from pathlib import Path

import sigma_umum as su  # noqa: E402  (mengatur PROJ sebelum rasterio dimuat)
import geopandas as gpd
import numpy as np
from shapely.geometry import LineString, Point, box

try:  # rasterio opsional: di peramban (Pyodide) uji tetap jalan memakai RasterLarik
    import rasterio
    from rasterio.transform import from_origin
except ImportError:  # pragma: no cover
    rasterio = None

AKAR = Path(__file__).resolve().parent if "__file__" in globals() else Path(".")
GPKG = AKAR / "data" / "sigma_contoh.gpkg"
DEM = AKAR / "data" / "dem_dummy.tif"


class UjiU4Jarak(unittest.TestCase):
    def test_satu_derajat_ekuator(self):
        h = su.ukur_jarak([[0, 0], [1, 0]])
        self.assertAlmostEqual(h["panjang_lintasan_m"], 111_319.4908, places=3)

    def test_multi_segmen_dan_jarak_lurus(self):
        h = su.ukur_jarak([[104.0, 1.1], [104.01, 1.1], [104.01, 1.11]])
        self.assertEqual(len(h["segmen"]), 2)
        self.assertAlmostEqual(h["panjang_lintasan_m"], sum(s["panjang_m"] for s in h["segmen"]), places=6)
        self.assertLess(h["jarak_lurus_m"], h["panjang_lintasan_m"])

    def test_pembanding_utm_lebih_pendek(self):
        h = su.ukur_jarak([[104.0, 1.1], [104.05, 1.12]], bandingkan_utm=True)
        self.assertTrue(-0.035 < h["selisih_utm_pct"] < -0.015, h["selisih_utm_pct"])

    def test_lon_lat_tertukar_ditolak_dengan_saran(self):
        with self.assertRaisesRegex(su.GalatAnalisis, "tertukar"):
            su.ukur_jarak([[1.1, 104.0], [1.12, 104.0]])

    def test_peringatan_di_luar_batam(self):
        h = su.ukur_jarak([[106.8, -6.2], [106.81, -6.2]])
        self.assertTrue(any("luar wilayah Batam" in c for c in h["catatan"]))

    def test_galat_titik_kurang(self):
        with self.assertRaises(su.GalatAnalisis):
            su.ukur_jarak([[104, 1.1]])


class UjiU5Luas(unittest.TestCase):
    PERSEGI = [[0, 0], [1, 0], [1, 1], [0, 1]]

    def test_sel_satu_derajat(self):
        h = su.ukur_luas(self.PERSEGI)
        self.assertAlmostEqual(h["luas_km2"], 12_308.778, places=2)

    def test_lubang_dikurangkan_walau_arah_sama(self):
        # Lubang sengaja searah dengan tepi luar: pyproj mentah akan MENAMBAH luas.
        geo = {"type": "Polygon", "coordinates": [
            [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
            [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]]}
        lubang = su.ukur_luas([[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]])["luas_m2"]
        h = su.ukur_luas(geo)
        self.assertAlmostEqual(h["luas_m2"], 12_308_778_361.47 - lubang, delta=1.0)

    def test_arah_putaran_tidak_berpengaruh(self):
        self.assertAlmostEqual(su.ukur_luas(self.PERSEGI)["luas_m2"], su.ukur_luas(self.PERSEGI[::-1])["luas_m2"], places=3)

    def test_dasi_kupu_ditolak_lalu_diperbaiki(self):
        dasi = [[104.0, 1.1], [104.01, 1.11], [104.01, 1.1], [104.0, 1.11]]
        with self.assertRaises(su.GalatAnalisis):
            su.ukur_luas(dasi)
        h = su.ukur_luas(dasi, perbaiki=True)
        self.assertTrue(h["diperbaiki"])
        segitiga = su.ukur_luas([[104.0, 1.1], [104.005, 1.105], [104.0, 1.11]])["luas_m2"]
        self.assertAlmostEqual(h["luas_m2"], 2 * segitiga, delta=1.0)

    def test_pembanding_utm(self):
        h = su.ukur_luas([[104.0, 1.1], [104.02, 1.1], [104.02, 1.12], [104.0, 1.12]], bandingkan_utm=True)
        self.assertTrue(-0.07 < h["selisih_utm_pct"] < -0.03, h["selisih_utm_pct"])


def _layer_uji():
    return gpd.GeoDataFrame({
        "kondisi": ["Rusak Berat", "rusak berat ", "Baik", None, "Sedang"],
        "lebar": [6.0, 7.0, 12.0, 5.0, None],
        "nama": ["Jl. A", "Jl. O'Brien", "Jl. C", "Jl. D", "Jl. E"],
    }, geometry=[LineString([(104 + i * 0.01, 1.1), (104.005 + i * 0.01, 1.1)]) for i in range(5)], crs="EPSG:4326")


class UjiEkspresi(unittest.TestCase):
    def setUp(self):
        self.g = _layer_uji()

    def m(self, e):
        return su.evaluasi_ekspresi(self.g, e)[0].tolist()

    def test_sama_dengan_tidak_peka_huruf(self):
        self.assertEqual(self.m({"kolom": "kondisi", "op": "=", "nilai": "RUSAK BERAT"}), [1, 1, 0, 0, 0])

    def test_null_tidak_lolos_tidak_sama(self):
        self.assertEqual(self.m({"kolom": "kondisi", "op": "!=", "nilai": "Baik"}), [1, 1, 0, 0, 1])

    def test_kosong(self):
        self.assertEqual(self.m({"kolom": "kondisi", "op": "kosong"}), [0, 0, 0, 1, 0])

    def test_angka_dan_antara(self):
        self.assertEqual(self.m({"kolom": "lebar", "op": "antara", "nilai": [5, 7]}), [1, 1, 0, 1, 0])
        self.assertEqual(self.m({"kolom": "lebar", "op": "≥", "nilai": "6,5"}), [0, 1, 1, 0, 0])

    def test_dalam_dan_memuat(self):
        self.assertEqual(self.m({"kolom": "kondisi", "op": "dalam", "nilai": ["Baik", "Sedang"]}), [0, 0, 1, 0, 1])
        self.assertEqual(self.m({"kolom": "nama", "op": "memuat", "nilai": "brien"}), [0, 1, 0, 0, 0])

    def test_grup_bersarang(self):
        e = {"semua": [{"salah_satu": [{"kolom": "kondisi", "op": "=", "nilai": "Baik"},
                                       {"kolom": "kondisi", "op": "=", "nilai": "Rusak Berat"}]},
                       {"kolom": "lebar", "op": ">", "nilai": 6.5}]}
        self.assertEqual(self.m(e), [0, 1, 1, 0, 0])

    def test_bug_prototipe_syarat_kosong_dengan_or(self):
        # Prototipe: syarat kosong = true, sehingga OR meloloskan semua objek.
        e = {"salah_satu": [{"kolom": "kondisi", "op": "=", "nilai": "Baik"}, {"kolom": "lebar", "op": ">", "nilai": ""}]}
        mask, catatan = su.evaluasi_ekspresi(self.g, e)
        self.assertEqual(mask.tolist(), [0, 0, 1, 0, 0])
        self.assertTrue(catatan)

    def test_galat_kolom_dan_tipe(self):
        with self.assertRaises(su.GalatAnalisis):
            self.m({"kolom": "tidak_ada", "op": "=", "nilai": 1})
        with self.assertRaises(su.GalatAnalisis):
            self.m({"kolom": "lebar", "op": "=", "nilai": "lebar"})
        with self.assertRaises(su.GalatAnalisis):
            self.m({"kolom": "nama", "op": ">", "nilai": "a"})
        with self.assertRaises(su.GalatAnalisis):
            self.m({"kolom": "nama", "op": "DROP TABLE", "nilai": "a"})

    def test_cql2_dan_escape(self):
        e = {"semua": [{"kolom": "nama", "op": "=", "nilai": "Jl. O'Brien"}, {"kolom": "lebar", "op": "antara", "nilai": [5, 7]}]}
        self.assertEqual(su.ke_cql2(e), "CASEI(\"nama\") = CASEI('Jl. O''Brien') AND \"lebar\" BETWEEN 5 AND 7")

    def test_query_layer(self):
        h = su.query_layer(self.g, {"kolom": "lebar", "op": "<", "nilai": 7})
        self.assertEqual((h["jumlah"], h["jumlah_total"]), (2, 5))
        self.assertEqual(len(h["fitur"]), 2)

    def test_skema(self):
        s = {x["kolom"]: x for x in su.deteksi_skema(self.g)}
        self.assertEqual(s["lebar"]["tipe"], "angka")
        self.assertEqual(s["kondisi"]["tipe"], "pilihan")


class UjiU1Filter(unittest.TestCase):
    def setUp(self):
        self.wil = gpd.GeoDataFrame({"nama": ["A", "B"]}, geometry=[box(104.0, 1.0, 104.1, 1.1), box(104.1, 1.0, 104.2, 1.1)],
                                    crs="EPSG:4326")
        self.jl = gpd.GeoDataFrame({"kondisi": ["Rusak Berat", "Baik"]},
                                   geometry=[LineString([(104.05, 1.05), (104.15, 1.05)]), LineString([(104.05, 1.06), (104.08, 1.06)])],
                                   crs="EPSG:4326")

    def test_potong_pada_batas_wilayah(self):
        utuh = su.panjang_geodesik(self.jl.geometry[0])
        h = su.filter_lokasi_atribut(self.jl, {"kolom": "kondisi", "op": "=", "nilai": "rusak berat"},
                                     {"tipe": "wilayah", "nilai": ["A"]}, self.wil)
        self.assertEqual(h["jumlah"], 1)
        self.assertAlmostEqual(h["panjang_total_m"], utuh / 2, delta=1.0)
        tanpa = su.filter_lokasi_atribut(self.jl, None, {"tipe": "wilayah", "nilai": ["A"]}, self.wil, potong_geometri=False)
        self.assertAlmostEqual(tanpa["panjang_total_m"], utuh + su.panjang_geodesik(self.jl.geometry[1]), delta=1.0)

    def test_ringkasan_per_wilayah(self):
        h = su.filter_lokasi_atribut(self.jl, {"kolom": "kondisi", "op": "=", "nilai": "Rusak Berat"}, None, self.wil)
        pw = {r["wilayah"]: r["panjang_m"] for r in h["per_wilayah"]}
        self.assertAlmostEqual(pw["A"], pw["B"], delta=1.0)

    def test_hanya_menyentuh_batas_tidak_dihitung(self):
        sentuh = gpd.GeoDataFrame({"kondisi": ["Baik"]}, geometry=[LineString([(104.1, 1.05), (104.15, 1.05)])], crs="EPSG:4326")
        h = su.filter_lokasi_atribut(sentuh, None, {"tipe": "wilayah", "nilai": ["A"]}, self.wil)
        self.assertEqual(h["jumlah"], 0)
        self.assertTrue(h["catatan"])
        h = su.filter_lokasi_atribut(sentuh, None, None, self.wil)
        self.assertEqual([r["wilayah"] for r in h["per_wilayah"]], ["B"])

    def test_within(self):
        h = su.filter_lokasi_atribut(self.jl, None, {"tipe": "wilayah", "nilai": ["A"]}, self.wil, predikat="within")
        self.assertEqual(h["jumlah"], 1)

    def test_radius_meter(self):
        titik = gpd.GeoDataFrame({"id": [1, 2]}, geometry=[Point(104.0, 1.1), Point(104.0045, 1.1)], crs="EPSG:4326")
        h = su.filter_lokasi_atribut(titik, None, {"tipe": "radius", "titik": [104.0, 1.1], "radius_m": 450})
        self.assertEqual(h["jumlah"], 1)  # titik ke-2 berjarak ±501 m
        h = su.filter_lokasi_atribut(titik, None, {"tipe": "radius", "titik": [104.0, 1.1], "radius_m": 550})
        self.assertEqual(h["jumlah"], 2)

    def test_wilayah_tidak_ada(self):
        with self.assertRaises(su.GalatAnalisis):
            su.filter_lokasi_atribut(self.jl, None, {"tipe": "wilayah", "nilai": ["Z"]}, self.wil)


class UjiU3Profil(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        x0, y0 = su._KE_UTM.transform(104.0, 1.1)
        cls.x0, cls.y0 = x0 - 2000, y0 + 2000
        n = 400  # 10 m x 400 = 4 km
        xx = np.arange(n) * 10 + 5
        cls.arr = {
            "bidang": np.tile(10 + 0.01 * xx, (n, 1)).astype("float32"),  # naik 1% ke timur
            "bukit": np.tile(5 + 40 * np.exp(-((xx - 2000) ** 2) / (2 * 300 ** 2)), (n, 1)).astype("float32"),
        }
        cls.arr["bukit"][:, :50] = -9999  # pita nodata di barat
        cls.dem = {k: su.RasterLarik(v, cls.x0, cls.y0, 10, 10, su.CRS_UTM, nodata=-9999, tags={"VERTICAL_DATUM": "UJI"})
                   for k, v in cls.arr.items()}

    def _lonlat(self, dx, dy=-2000):
        return list(su._DARI_UTM.transform(self.x0 + dx, self.y0 + dy))

    @unittest.skipIf(rasterio is None, "rasterio tidak tersedia")
    def test_geotiff_sama_dengan_raster_larik(self):
        tmp = tempfile.mkdtemp()
        f = os.path.join(tmp, "bukit.tif")
        with rasterio.open(f, "w", driver="GTiff", width=400, height=400, count=1, dtype="float32", crs=su.CRS_UTM,
                           transform=from_origin(self.x0, self.y0, 10, 10), nodata=-9999) as d:
            d.write(self.arr["bukit"], 1)
        lin = [self._lonlat(300), self._lonlat(3100, -1500)]
        a = su.profil_elevasi(lin, f)["sampel"]
        b = su.profil_elevasi(lin, self.dem["bukit"])["sampel"]
        self.assertEqual([s["z"] is None for s in a], [s["z"] is None for s in b])
        for sa, sb in zip(a, b):
            if sa["z"] is not None:
                self.assertAlmostEqual(sa["z"], sb["z"], places=9)

    def test_kemiringan_bidang_satu_persen(self):
        h = su.profil_elevasi([self._lonlat(500), self._lonlat(2500)], self.dem["bidang"])
        r = h["ringkasan"]
        self.assertAlmostEqual(r["kemiringan_ujung_ke_ujung_pct"], 1.0, delta=0.005)
        self.assertAlmostEqual(r["rentang_relief_m"], 20.0, delta=0.1)
        self.assertEqual(h["dem"]["datum_vertikal"], "UJI")
        self.assertAlmostEqual(r["interval_sampel_m"], 10.0)

    def test_bukit_bukan_rentang_relief(self):
        h = su.profil_elevasi([self._lonlat(1000), self._lonlat(3000)], self.dem["bukit"])
        r = h["ringkasan"]
        self.assertAlmostEqual(r["kemiringan_ujung_ke_ujung_pct"], 0.0, delta=0.01)  # prototipe akan melaporkan ±2%
        self.assertGreater(r["rentang_relief_m"], 35)
        self.assertAlmostEqual(r["naik_kumulatif_m"], r["turun_kumulatif_m"], delta=0.05)
        self.assertAlmostEqual(r["sta_z_maks_m"], 1000, delta=15)

    def test_multi_titik_dan_segmen(self):
        h = su.profil_elevasi([self._lonlat(500), self._lonlat(1500), self._lonlat(1500, -1000)],
                              self.dem["bidang"])
        seg = h["segmen"]
        self.assertEqual(len(seg), 2)
        self.assertAlmostEqual(seg[0]["kemiringan_pct"], 1.0, delta=0.01)
        self.assertAlmostEqual(seg[1]["kemiringan_pct"], 0.0, delta=0.01)

    def test_nodata_dikecualikan(self):
        h = su.profil_elevasi([self._lonlat(100), self._lonlat(1500)], self.dem["bukit"])
        self.assertLess(h["ringkasan"]["jumlah_sampel_valid"], h["ringkasan"]["jumlah_sampel"])
        self.assertIsNone(h["ringkasan"]["z_awal"])
        self.assertGreater(h["ringkasan"]["z_min"], 0)

    def test_di_luar_dem(self):
        with self.assertRaises(su.GalatAnalisis):
            su.profil_elevasi([[100.0, 0.0], [100.01, 0.0]], self.dem["bidang"])


@unittest.skipUnless(rasterio is not None and GPKG.exists() and DEM.exists(), "butuh rasterio dan data contoh (buat_data_contoh.py)")
class UjiDataContoh(unittest.TestCase):
    def test_filter_jalan_rusak_batam_kota(self):
        jl = su.baca_layer(GPKG, "jalan")
        kec = su.baca_layer(GPKG, "kecamatan")
        e = {"kolom": "kondisi", "op": "dalam", "nilai": ["Rusak Ringan", "Rusak Berat"]}
        a = su.filter_lokasi_atribut(jl, e, {"tipe": "wilayah", "nilai": ["Batam Kota"]}, kec)
        b = su.filter_lokasi_atribut(jl, e, {"tipe": "wilayah", "nilai": ["Batam Kota"]}, kec, potong_geometri=False)
        self.assertGreater(a["jumlah"], 0)
        self.assertLessEqual(a["panjang_total_m"], b["panjang_total_m"] + 1e-6)
        self.assertEqual(a["per_wilayah"][0]["wilayah"], "Batam Kota")

    def test_profil_dem_dummy(self):
        h = su.profil_elevasi([[104.03, 1.12], [104.06, 1.13], [104.09, 1.11]], DEM)
        self.assertEqual(h["dem"]["resolusi_m"], 30.0)
        self.assertGreater(h["ringkasan"]["jumlah_sampel_valid"], 100)


if __name__ == "__main__":
    unittest.main(verbosity=2)
