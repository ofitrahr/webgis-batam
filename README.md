# SIGMA Batam — Prototipe QA Fitur Analisis

Prototipe WebGIS untuk **quality assurance** fitur analisis WebGIS Infrastruktur BP Batam
(Pekerjaan Pemetaan dan Pengembangan SIG Infrastruktur Batam TA 2026).

Situs: `https://ofitrahr.github.io/webgis-batam/` (setelah GitHub Pages diaktifkan)

## Kenapa prototipe ini

Setiap fitur analisis dikembangkan TA GIS sebagai modul Python (`sigma_*.py`) yang nantinya
diserahkan ke tim IT. Prototipe ini menjalankan **modul Python yang sama persis** langsung di
peramban lewat [Pyodide](https://pyodide.org) (Python di WebAssembly), tanpa server. Jadi yang
di-QA adalah perilaku kode yang benar-benar akan dipakai, bukan tiruan JavaScript-nya.

| Tab | Isi |
|---|---|
| Analisis | Panel setiap fitur (U1–U5 saat ini): formulir, menggambar di peta, hasil, grafik |
| Layer | Layer data contoh, status data (OSM sementara / dummy), kode RFI-01 |
| QA | Uji otomatis (unittest Python dijalankan di peramban), daftar kriteria penerimaan per fitur (✓/✗ + catatan), ekspor laporan `.md` / `.csv` |
| Info | Versi build, hash modul Python, status data |

> **Data contoh bukan data resmi.** Geometri jalan dan sungai dari OpenStreetMap; atribut kondisi,
> drainase tepi jalan, pipa, genangan, dan DEM adalah **dummy**. Hasil hanya untuk menguji alur dan
> perilaku fitur, bukan untuk keputusan.

## Struktur

```
index.html            halaman tunggal
css/app.css
js/app.js             orkestrasi (tab, panel hasil, pemuatan)
js/py.js              memuat Pyodide + modul Python, antrean pemanggilan
js/peta.js            MapLibre: layer, popup (menandai atribut dummy), alat gambar
js/ui.js              utilitas UI, pembangun ekspresi, grafik profil
js/qa.js              tab QA
js/fitur/index.js     REGISTRI fitur + daftar fitur yang belum dikembangkan
js/fitur/u1.js … u5.js  satu file per fitur (panel + kriteria penerimaan)
py/jembatan.py        perekat JS <-> Python (khusus web, tidak diserahkan ke tim IT)
py/sigma_*.py         DISALIN dari folder ANALISIS (jangan disunting di sini)
py/test_sigma_*.py    DISALIN dari folder ANALISIS
data/                 hasil ekspor alat/bangun_web.py (GeoJSON, DEM biner, manifest.json)
alat/bangun_web.py    sinkronisasi modul + ekspor data
alat/server_lokal.py  server pratinjau lokal tanpa cache
```

## Alur update setiap ada fitur baru

Sumber kebenaran tetap di `INTERNAL-WEBGIS BATAM/ANALISIS/NN_<PAKET>/` (di luar repo ini).

1. **Kembangkan dan uji di desktop** (folder ANALISIS):
   ```bash
   python -m unittest -v test_sigma_<paket>
   ```
2. **Sinkronkan ke repo web** (menyalin `sigma_*.py` + `test_sigma_*.py` semua paket, mengekspor data, menulis manifest):
   ```bash
   python alat/bangun_web.py
   ```
3. **Hubungkan fitur ke web**:
   - `py/jembatan.py` → tambahkan cabang di `jalankan()` untuk fungsi baru (mis. `"d1"`).
   - `js/fitur/<kode>.js` → salin pola `u4.js` (paling sederhana) atau `u1.js` (dengan formulir ekspresi). Isi `kode`, `nama`, `kak`, `kriteria` (kriteria penerimaan dari dokumen kritik), dan `kelasUji` (nama kelas unittest).
   - `js/fitur/index.js` → impor dan masukkan ke `FITUR`, hapus kodenya dari `RENCANA`, tambahkan modul uji ke `MODUL_UJI` bila file test baru.
   - Layer baru → tambahkan gaya di `GAYA` pada `alat/bangun_web.py`.
4. **Pratinjau lokal**, lalu jalankan uji otomatis di tab QA:
   ```bash
   python alat/server_lokal.py
   ```
   Buka `http://localhost:8780`.
5. **Commit dan push.** GitHub Pages memperbarui situs dalam ±1 menit. Pages menyimpan cache file ±10 menit; bila versi lama masih tampil, muat ulang paksa (Ctrl+F5). Versi build tampil di pojok kanan atas.

## Cara melakukan QA

1. Buka tab **QA**, isi nama penguji, klik **Jalankan uji otomatis**. Semua uji harus lulus (uji yang butuh rasterio/GeoPackage dilewati di peramban; itu wajar).
2. Untuk setiap fitur, buka **Buka fitur ini →**, coba sesuai kriteria, lalu tandai ✓ Sesuai / ✗ Tidak dan beri catatan.
3. Klik **Ekspor laporan (.md)**. Laporan memuat versi build, hash modul, hasil uji otomatis, penilaian kriteria, dan riwayat pemanggilan analisis (spesifikasi JSON yang bisa diulang tim IT).
4. Penilaian disimpan di peramban penguji (localStorage). Penilaian dari build lama ditandai **cek ulang**.

## Teknologi

- Pyodide 0.27.7 (numpy, pandas, shapely 2.0, pyproj 3.6, geopandas 1.0.1; geopandas dipasang tanpa fiona/GDAL agar ringan)
- MapLibre GL JS 4.7.1
- Peta dasar (tanpa kunci API): Esri World Light Gray Canvas, OpenStreetMap, Esri World Imagery

Muat pertama ±25–40 MB (paket Python, di-cache peramban setelahnya). Peta dan data tampil lebih dulu;
tombol analisis aktif setelah mesin Python siap.

## Atribusi

Data jalan dan sungai © OpenStreetMap contributors (ODbL). Peta dasar © OpenStreetMap contributors,
Esri, HERE, Garmin; citra © Esri, Maxar, Earthstar Geographics.
