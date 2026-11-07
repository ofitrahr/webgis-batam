// app.js — Orkestrasi prototipe QA SIGMA Batam.
import * as py from './py.js';
import { Peta } from './peta.js';
import { h, toast, fmtAngka } from './ui.js';
import { FITUR } from './fitur/index.js';
import { TabQA } from './qa.js';

const $ = s => document.querySelector(s);

const app = {
  py, manifest: null, layerMeta: [], pySiap: false, riwayat: [], _antreSiap: [], fiturAktif: null,

  saatSiap(cb) { if (this.pySiap) cb(); else this._antreSiap.push(cb); },

  hasil(judul, ...isi) {
    const d = $('#hasil');
    d.querySelector('.hasil-judul').textContent = judul;
    const badan = d.querySelector('.hasil-badan'); badan.innerHTML = '';
    badan.append(...isi.filter(Boolean));
    d.hidden = false; d.classList.remove('kecil');
  },
  tutupHasil() { $('#hasil').hidden = true; },

  catatRiwayat(kode, spek, r) {
    const ringkas = r.galat ? 'DITOLAK: ' + r.galat : r.galat_sistem ? 'GALAT SISTEM: ' + r.galat_sistem : (r.label || 'ok');
    this.riwayat.unshift({ waktu: new Date().toLocaleTimeString('id-ID'), kode, spek, ringkas });
    this.riwayat.length = Math.min(this.riwayat.length, 50);
    if (r.galat_sistem) console.error('[galat sistem]', r.galat_sistem, r.jejak);
  },

  bukaFitur(kode) {
    gantiTab('analisis');
    const f = FITUR.find(x => x.kode === kode);
    if (this.fiturAktif && this.fiturAktif !== f) this.fiturAktif.tutup?.(this);
    this.fiturAktif = f;
    document.querySelectorAll('.fitur-item').forEach(el => el.classList.toggle('aktif', el.dataset.kode === kode));
    const w = $('#panel-fitur'); w.innerHTML = '';
    w.append(h('div', { class: 'fitur-kepala' },
      h('div', {}, h('span', { class: 'kode' }, f.kode), h('b', {}, f.nama)),
      h('div', { class: 'kecil redup' }, 'KAK ', f.kak),
      h('div', { class: 'kecil' }, f.ringkas)));
    const isi = h('div', { class: 'fitur-isi' }); w.append(isi);
    f.buka(isi, this);
    sinkronTombolPython();
    try { history.replaceState(null, '', '#' + kode); } catch { /* abaikan */ }
  },

  segarkanLayer() { renderLayer(); },
};
window.sigmaApp = app; // untuk debugging di konsol

// ------------------------------------------------------------------ tab
function gantiTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('aktif', t.dataset.tab === id));
  document.querySelectorAll('.tab-isi').forEach(t => { t.hidden = t.id !== 'tab-' + id; });
  if (id === 'qa') app.qa.render();
}

function sinkronTombolPython() {
  document.querySelectorAll('[data-butuh-python]').forEach(b => {
    b.disabled = !app.pySiap; b.title = app.pySiap ? '' : 'Menunggu mesin Python siap…';
  });
}

// ------------------------------------------------------------------ panel layer
function renderLayer() {
  const w = $('#tab-layer'); w.innerHTML = '';
  w.append(h('label', { class: 'label' }, 'Peta dasar'), h('select', { onchange: e => app.peta.gantiDasar(e.target.value) },
    app.peta.dasarDaftar.map(d => h('option', { value: d.id }, d.label))));
  const b = app.manifest.bangunan;
  if (b) {
    const st = app.bangunanState ??= { tampak: true, gaya: 'tinggi', alfa: 1 };
    w.append(h('label', { class: 'label' }, 'Bangunan 3D'), h('div', { class: 'layer-item' },
      h('div', { class: 'layer-baris' },
        h('label', { class: 'cek' }, h('input', { type: 'checkbox', checked: st.tampak, onchange: e => { st.tampak = e.target.checked; app.peta.tampilkanBangunan(st.tampak); } }),
          h('span', { class: 'swatch blok' }), b.label),
        h('span', { class: 'kecil redup mono' }, app.bangunanSiap ? fmtAngka(b.jumlah) : 'memuat…')),
      h('div', { class: 'layer-info' }, h('span', { class: 'lencana osm' }, b.status), h('span', { class: 'kecil redup' }, ' ' + b.sumber)),
      h('div', { class: 'opsi' }, h('label', { class: 'kecil' }, 'Warna '), h('select', { onchange: e => { st.gaya = e.target.value; app.peta.gayaBangunan(st.gaya, st.alfa); } },
        h('option', { value: 'tinggi', selected: st.gaya === 'tinggi' }, 'menurut tinggi'), h('option', { value: 'polos', selected: st.gaya === 'polos' }, 'polos'))),
      st.gaya === 'tinggi' ? h('div', { class: 'legenda-tinggi' },
        h('div', { class: 'leg' }, ['#fde0dd', '#fbb4b9', '#f768a1', '#c51b8a', '#7a0177'].map(c => h('span', { style: `background:${c}` }))),
        h('div', { class: 'legt' }, ['<8', '8', '15', '30', '≥60 m'].map(t => h('span', {}, t)))) : null,
      h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: st.alfa, class: 'opasitas', title: 'Transparansi bangunan',
                   oninput: e => { st.alfa = +e.target.value; app.peta.gayaBangunan(st.gaya, st.alfa); } })));
  }
  w.append(h('label', { class: 'label' }, 'Layer data'));
  for (const l of app.layerMeta) {
    const tampak = l._tampak ?? true, q = app.peta.filterQuery[l.id];
    w.append(h('div', { class: 'layer-item' },
      h('div', { class: 'layer-baris' },
        h('label', { class: 'cek' }, h('input', { type: 'checkbox', checked: tampak, onchange: e => { l._tampak = e.target.checked; app.peta.tampilkan(l.id, e.target.checked); } }),
          h('span', { class: 'swatch ' + (/Line/.test(l.geometri) ? 'garis' : /Point/.test(l.geometri) ? 'titik' : 'poli'), style: `--w:${l.warna}` }), l.label),
        h('span', { class: 'kecil redup mono' }, fmtAngka(l.jumlah))),
      h('div', { class: 'layer-info' },
        h('span', { class: 'lencana ' + (l.status === 'Dummy' ? 'dummy' : 'osm') }, l.status),
        h('span', { class: 'kecil redup' }, ' RFI-01 ' + l.rfi),
        q ? h('span', { class: 'lencana query' }, `query aktif: ${fmtAngka(q.length)}`) : null),
      h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: l._opasitas ?? 0.85, class: 'opasitas',
                   oninput: e => { l._opasitas = +e.target.value; app.peta.opasitas(l.id, +e.target.value); } })));
  }
  const d = app.manifest.dem;
  w.append(h('div', { class: 'layer-item' }, h('div', { class: 'layer-baris' }, h('span', {}, 'DEM (untuk U3)'), h('span', { class: 'kecil redup mono' }, `${d.lebar}×${d.tinggi} @${d.res_x} m`)),
    h('div', { class: 'layer-info' }, h('span', { class: 'lencana ' + (d.status === 'Dummy' ? 'dummy' : 'osm') }, d.status), h('span', { class: 'kecil redup' }, ' RFI-01 A05 · datum: ' + d.datum_vertikal))));
  w.append(h('div', { class: 'bantu' }, 'Klik objek di peta untuk melihat atributnya. Atribut bertanda ', h('span', { class: 'lencana dummy' }, 'dummy'),
    ' adalah nilai sintetis dan akan diganti data BP Batam lewat RFI.'));
}

// ------------------------------------------------------------------ panel analisis
function renderAnalisis() {
  const w = $('#daftar-fitur'); w.innerHTML = '';
  const paket = [...new Set(FITUR.map(f => f.paket))];
  for (const p of paket) {
    w.append(h('div', { class: 'paket-judul' }, p));
    for (const f of FITUR.filter(x => x.paket === p)) {
      w.append(h('button', { class: 'fitur-item', 'data-kode': f.kode, onclick: () => app.bukaFitur(f.kode) },
        h('span', { class: 'kode' }, f.kode), h('span', {}, f.nama)));
    }
  }
}

function renderInfo() {
  const m = app.manifest, w = $('#tab-info');
  w.innerHTML = '';
  w.append(
    h('h3', {}, 'Tentang prototipe ini'),
    h('p', {}, 'Prototipe QA fitur analisis WebGIS Infrastruktur BP Batam (SIGMA). Semua analisis dijalankan oleh modul Python yang sama dengan yang diserahkan ke tim IT, di dalam peramban melalui Pyodide; tidak ada server.'),
    h('p', { class: 'peringatan' }, 'Data contoh: geometri sebagian dari OpenStreetMap, sebagian besar atribut dan DEM adalah DUMMY. Hasil hanya untuk menguji alur dan perilaku fitur, BUKAN untuk keputusan.'),
    h('p', { class: 'kecil' }, 'Bangunan 3D LOD1 sementara dari sumber terbuka (tapak OSM/Overture, ditambah Microsoft ML Building Footprints dan Google Open Buildings v3 di Batu Aji & Sagulung; tinggi Google Open Buildings 2.5D 2023). Bukan tapak RBI BP Batam; nanti diganti hasil survei LiDAR.'),
    h('h4', {}, 'Build'),
    h('ul', { class: 'kecil' }, h('li', {}, 'Dibangun: ' + new Date(m.dibangun).toLocaleString('id-ID')),
      ...m.modul_python.map(x => h('li', {}, h('code', {}, `${x.file}`), ` (${x.paket}) sha ${x.sha}`)),
      h('li', {}, `Pyodide ${py.PYODIDE_VERSI}; CesiumJS ${globalThis.Cesium?.VERSION || ''}`)),
    h('h4', {}, 'Status data'),
    h('table', { class: 'tabel kecil' }, h('thead', {}, h('tr', {}, ['Layer', 'Status', 'RFI-01', 'Kolom dummy'].map(x => h('th', {}, x)))),
      h('tbody', {}, m.layer.map(l => h('tr', {}, h('td', {}, l.label), h('td', {}, l.status), h('td', {}, l.rfi), h('td', { class: 'kecil' }, l.kolom_dummy.join(', ') || '—'))),
        h('tr', {}, h('td', {}, 'DEM'), h('td', {}, m.dem.status), h('td', {}, 'A05'), h('td', { class: 'kecil' }, m.dem.sumber)),
        m.bangunan ? h('tr', {}, h('td', {}, 'Bangunan 3D'), h('td', {}, m.bangunan.status), h('td', {}, 'A07–A08'), h('td', { class: 'kecil' }, `${m.bangunan.sumber}; ${fmtAngka(m.bangunan.jumlah)} bangunan, ${fmtAngka(m.bangunan.mb, 0)} MB`)) : null)),
    h('p', { class: 'kecil redup' }, 'Peta dasar © Esri, HERE, Garmin, © OpenStreetMap contributors; citra © Esri. Data jalan, sungai, dan tapak bangunan © OpenStreetMap contributors / Overture Maps / Microsoft (ODbL), Google Open Buildings v3 (CC-BY 4.0); tinggi bangunan Google Open Buildings 2.5D (CC-BY 4.0).'));
}

// ------------------------------------------------------------------ awal
function lapor(teks, persen) {
  $('#py-status').textContent = teks;
  $('#py-bar').style.width = persen + '%';
}

async function mulai() {
  app.manifest = await (await fetch('data/manifest.json', { cache: 'no-cache' })).json();
  app.layerMeta = app.manifest.layer;
  $('#versi').textContent = 'build ' + new Date(app.manifest.dibangun).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  // Mode peta: ?mode=2d|3d di URL, lalu pilihan terakhir pengguna, bawaan 3D.
  let modeAwal = new URLSearchParams(location.search).get('mode');
  if (!['2d', '3d'].includes(modeAwal)) { try { modeAwal = localStorage.getItem('sigma-mode-peta'); } catch { modeAwal = null; } }
  const tandaiMode = mode => {
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('aktif', b.dataset.mode === mode));
    document.querySelectorAll('.kontrol-pandangan .hanya-3d').forEach(b => { b.hidden = mode === '2d'; });
    try { localStorage.setItem('sigma-mode-peta', mode); } catch { /* penyimpanan tidak tersedia */ }
  };
  app.peta = new Peta('peta', { mode: modeAwal === '2d' ? '2d' : '3d', onMode: tandaiMode });
  tandaiMode(app.peta.mode);
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => app.peta.gantiMode(b.dataset.mode)));
  app.qa = new TabQA($('#tab-qa'), app);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => gantiTab(t.dataset.tab)));
  $('#hasil .tutup').addEventListener('click', () => app.tutupHasil());
  $('#hasil .lipat').addEventListener('click', () => $('#hasil').classList.toggle('kecil'));
  renderAnalisis(); renderInfo();

  const v = encodeURIComponent(app.manifest.dibangun);
  const dataLayer = Promise.all(app.layerMeta.map(async l => [l, await (await fetch(`${l.file}?v=${v}`)).json()]));
  const dataDem = fetch(`${app.manifest.dem.file}?v=${v}`).then(r => r.arrayBuffer());
  const mesin = py.mulaiPython(app.manifest, lapor);

  // Data dan panel tidak menunggu peta selesai dirender (tab latar / panel tersembunyi menunda event 'load').
  const layer = await dataLayer;
  for (const [, gj] of layer) gj.features.forEach((f, i) => { f.properties._i = i; });
  app.data = Object.fromEntries(layer.map(([m, gj]) => [m.id, gj]));
  renderLayer();
  const awal = location.hash.slice(1);
  app.bukaFitur(FITUR.some(f => f.kode === awal) ? awal : 'U1');
  app.peta.siap.then(() => { for (const [meta, gj] of layer) app.peta.tambahLayer(meta, gj); renderLayer(); });
  document.querySelectorAll('[data-pandangan]').forEach(b => b.addEventListener('click', () => app.peta.pandangan(b.dataset.pandangan)));
  if (app.manifest.bangunan) {
    app.peta.muatBangunan(`${app.manifest.bangunan.url}?v=${encodeURIComponent(app.manifest.bangunan.versi || v)}`)
      .then(() => { app.bangunanSiap = true; renderLayer(); })
      .catch(e => { console.error(e); toast('Gagal memuat bangunan 3D: ' + e.message, 'galat', 8000); });
  }

  try {
    await mesin;
    lapor('Memuat data ke mesin Python…', 85);
    for (const [meta, gj] of layer) await py.muatLayer(meta.id, gj);
    await py.muatDem(await dataDem, app.manifest.dem);
    lapor('Mesin Python siap', 100);
    app.pySiap = true;
    $('#py-pill').classList.add('siap');
    setTimeout(() => $('#py-muat').classList.add('selesai'), 600);
    sinkronTombolPython();
    app._antreSiap.splice(0).forEach(cb => cb());
    toast('Mesin analisis Python siap', 'sukses');
  } catch (e) {
    console.error(e);
    lapor('Gagal memuat mesin Python: ' + e.message, 100);
    $('#py-pill').classList.add('gagal');
    toast('Gagal memuat mesin Python. Periksa koneksi internet (Pyodide dimuat dari CDN).', 'galat', 10000);
  }
}

mulai().catch(e => { console.error(e); toast('Gagal memulai: ' + e.message, 'galat', 10000); });
