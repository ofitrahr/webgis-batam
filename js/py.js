// py.js — Memuat Pyodide dan modul analisis Python, lalu menyediakan jembatan pemanggilan.
// Kode Python yang dijalankan = salinan persis folder ANALISIS (disinkronkan alat/bangun_web.py).

export const PYODIDE_VERSI = '0.27.7';
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSI}/full/`;

let pyodide = null;
let jembatan = null;
let antrean = Promise.resolve();

function muatSkrip(src) {
  return new Promise((ok, gagal) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => gagal(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

export async function mulaiPython(manifest, lapor) {
  lapor('Memuat mesin Python (Pyodide ' + PYODIDE_VERSI + ')…', 5);
  await muatSkrip(CDN + 'pyodide.js');
  pyodide = await globalThis.loadPyodide({ indexURL: CDN });

  lapor('Memuat numpy, pandas, shapely, pyproj…', 20);
  await pyodide.loadPackage(['numpy', 'pandas', 'shapely', 'pyproj', 'packaging', 'micropip', 'python-dateutil', 'pytz']);

  // geopandas dipasang tanpa dependensi agar fiona/GDAL (berat, tidak dipakai) tidak ikut dimuat.
  lapor('Memasang geopandas…', 65);
  await pyodide.runPythonAsync(`import micropip\nawait micropip.install("${CDN}geopandas-1.0.1-py3-none-any.whl", deps=False)`);

  lapor('Memuat modul analisis…', 75);
  const berkas = [...manifest.modul_python.map(m => ({ file: m.file, v: m.sha })), { file: 'jembatan.py', v: manifest.jembatan_sha || manifest.dibangun }];
  for (const b of berkas) {
    const teks = await (await fetch(`py/${b.file}?v=${encodeURIComponent(b.v)}`)).text();
    pyodide.FS.writeFile(`/home/pyodide/${b.file}`, teks);
  }
  jembatan = pyodide.pyimport('jembatan');
  return pyodide;
}

export async function muatLayer(id, geojson) {
  return jembatan.muat_layer(id, JSON.stringify(geojson));
}

export async function muatDem(buffer, meta) {
  const arr = pyodide.toPy(new Uint8Array(buffer));
  try { return jembatan.muat_dem(arr, JSON.stringify(meta)); } finally { arr.destroy(); }
}

// Panggilan diantrekan agar tidak tumpang-tindih (Pyodide berjalan di satu utas).
export function jalankan(fungsi, spek = {}) {
  const tugas = antrean.then(async () => {
    if (!jembatan) throw new Error('Mesin Python belum siap.');
    await new Promise(r => setTimeout(r, 0));
    const t0 = performance.now();
    const hasil = JSON.parse(jembatan.jalankan(fungsi, JSON.stringify(spek)));
    hasil._durasi_ms = Math.round(performance.now() - t0);
    return hasil;
  });
  antrean = tugas.catch(() => {});
  return tugas;
}

export function jalankanUji(modul) {
  const tugas = antrean.then(async () => {
    await new Promise(r => setTimeout(r, 0));
    const semua = [];
    for (const m of modul) semua.push(...JSON.parse(jembatan.jalankan_uji(m)));
    return semua;
  });
  antrean = tugas.catch(() => {});
  return tugas;
}

export const siap = () => !!jembatan;
