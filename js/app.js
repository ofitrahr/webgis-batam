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
    h('h4', {}, 'Build'),
    h('ul', { class: 'kecil' }, h('li', {}, 'Dibangun: ' + new Date(m.dibangun).toLocaleString('id-ID')),
      ...m.modul_python.map(x => h('li', {}, h('code', {}, `${x.file}`), ` (${x.paket}) sha ${x.sha}`)),
      h('li', {}, `Pyodide ${py.PYODIDE_VERSI}; MapLibre GL ${maplibregl.getVersion?.() || ''}`)),
    h('h4', {}, 'Status data'),
    h('table', { class: 'tabel kecil' }, h('thead', {}, h('tr', {}, ['Layer', 'Status', 'RFI-01', 'Kolom dummy'].map(x => h('th', {}, x)))),
      h('tbody', {}, m.layer.map(l => h('tr', {}, h('td', {}, l.label), h('td', {}, l.status), h('td', {}, l.rfi), h('td', { class: 'kecil' }, l.kolom_dummy.join(', ') || '—'))),
        h('tr', {}, h('td', {}, 'DEM'), h('td', {}, m.dem.status), h('td', {}, 'A05'), h('td', { class: 'kecil' }, m.dem.sumber)))),
    h('p', { class: 'kecil redup' }, 'Peta dasar © OpenStreetMap contributors, © CARTO, citra © Esri. Data jalan dan sungai © OpenStreetMap contributors (ODbL).'));
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
  app.peta = new Peta('peta');
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
