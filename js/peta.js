// peta.js — Peta MapLibre: peta dasar, layer data, popup atribut, layer hasil, dan alat gambar.
import { esc, fmtAngka } from './ui.js';

// Peta dasar tanpa kunci API. (CARTO kini mengembalikan ubin "API KEY REQUIRED".)
const DASAR = {
  abu: { label: 'Abu-abu terang (Esri)', maxzoom: 16, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
         attribution: 'Peta dasar © Esri, HERE, Garmin, © OpenStreetMap contributors' },
  osm: { label: 'OpenStreetMap', maxzoom: 19, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
         attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  citra: { label: 'Citra (Esri)', maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
           attribution: 'Citra © Esri, Maxar, Earthstar Geographics' },
};
const DASAR_AWAL = 'abu';
const KOSONG = { type: 'FeatureCollection', features: [] };
const WARNA_HASIL = '#f39c12';

export class Peta {
  constructor(el) {
    const sources = {}, layers = [];
    for (const [id, d] of Object.entries(DASAR)) {
      sources['dasar-' + id] = { type: 'raster', tiles: d.tiles, tileSize: 256, attribution: d.attribution, maxzoom: d.maxzoom };
      layers.push({ id: 'dasar-' + id, type: 'raster', source: 'dasar-' + id, layout: { visibility: id === DASAR_AWAL ? 'visible' : 'none' } });
    }
    this.map = new maplibregl.Map({
      container: el, style: { version: 8, sources, layers },
      center: [104.03, 1.09], zoom: 10.6, maxZoom: 19, attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    this.layerData = {};      // id -> {meta, geojson}
    this.filterQuery = {};    // id -> array indeks (U2)
    this.klikDiblok = false;
    this.siap = new Promise(r => this.map.on('load', r));
    this.siap.then(() => this._layerHasil());
  }

  get dasarDaftar() { return Object.entries(DASAR).map(([id, d]) => ({ id, label: d.label })); }

  gantiDasar(id) {
    for (const k of Object.keys(DASAR)) this.map.setLayoutProperty('dasar-' + k, 'visibility', k === id ? 'visible' : 'none');
  }

  tambahLayer(meta, geojson) {
    this.layerData[meta.id] = { meta, geojson };
    const src = 'src-' + meta.id, m = this.map;
    m.addSource(src, { type: 'geojson', data: geojson });
    const sebelum = 'hasil-isi';
    const ids = [];
    if (/Polygon/.test(meta.geometri)) {
      m.addLayer({ id: `lyr-${meta.id}-isi`, type: 'fill', source: src, paint: { 'fill-color': meta.warna, 'fill-opacity': 0.05 } }, sebelum);
      m.addLayer({ id: `lyr-${meta.id}`, type: 'line', source: src, paint: { 'line-color': meta.warna, 'line-width': 1.4, 'line-dasharray': [3, 2] } }, sebelum);
      ids.push(`lyr-${meta.id}-isi`, `lyr-${meta.id}`);
    } else if (/LineString/.test(meta.geometri)) {
      m.addLayer({ id: `lyr-${meta.id}`, type: 'line', source: src, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': meta.warna, 'line-opacity': 0.85,
                 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'klasifikasi'], 'arteri', 1.6, 'kolektor', 1.1, 0.7],
                                16, ['match', ['get', 'klasifikasi'], 'arteri', 5, 'kolektor', 3.5, 2.2]] } }, sebelum);
      ids.push(`lyr-${meta.id}`);
    } else {
      m.addLayer({ id: `lyr-${meta.id}`, type: 'circle', source: src,
        paint: { 'circle-color': meta.warna, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
                 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } }, sebelum);
      ids.push(`lyr-${meta.id}`);
    }
    meta._mapIds = ids;
    for (const id of ids) {
      m.on('click', id, e => this._popup(e, meta));
      m.on('mouseenter', id, () => { if (!this.klikDiblok) m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', id, () => { if (!this.klikDiblok) m.getCanvas().style.cursor = ''; });
    }
  }

  _ids(id) { return this.layerData[id]?.meta._mapIds || []; }

  tampilkan(id, tampak) {
    for (const l of this._ids(id)) this.map.setLayoutProperty(l, 'visibility', tampak ? 'visible' : 'none');
  }

  opasitas(id, v) {
    for (const l of this._ids(id)) {
      const t = this.map.getLayer(l).type;
      const prop = t === 'fill' ? 'fill-opacity' : t === 'circle' ? 'circle-opacity' : 'line-opacity';
      this.map.setPaintProperty(l, prop, t === 'fill' ? v * 0.1 : v);
    }
  }

  // U2: tampilkan hanya objek dengan _i dalam daftar (null = hapus filter)
  setFilter(id, indeks) {
    const f = indeks ? ['in', ['get', '_i'], ['literal', indeks]] : null;
    if (indeks) this.filterQuery[id] = indeks; else delete this.filterQuery[id];
    for (const l of this._ids(id)) this.map.setFilter(l, f);
  }

  _popup(e, meta) {
    if (this.klikDiblok) return;
    const f = e.features[0], p = f.properties;
    const dummy = new Set(String(p.atribut_dummy || '').split(',').map(s => s.split('(')[0].trim()));
    const semuaDummy = dummy.has('semua');
    const baris = Object.entries(p).filter(([k]) => !k.startsWith('_') && k !== 'atribut_dummy').map(([k, v]) => {
      const d = semuaDummy || dummy.has(k);
      return `<tr><th>${esc(k)}</th><td>${esc(v === null || v === 'null' ? '—' : typeof v === 'number' ? fmtAngka(v, 2) : v)}${d ? ' <span class="lencana dummy">dummy</span>' : ''}</td></tr>`;
    }).join('');
    new maplibregl.Popup({ maxWidth: '360px' }).setLngLat(e.lngLat)
      .setHTML(`<div class="popup"><b>${esc(meta.label)}</b><table>${baris}</table></div>`).addTo(this.map);
  }

  // ---------------- layer hasil analisis ----------------
  _layerHasil() {
    const m = this.map;
    m.addSource('hasil', { type: 'geojson', data: KOSONG });
    m.addSource('lokasi', { type: 'geojson', data: KOSONG });
    m.addSource('gambar', { type: 'geojson', data: KOSONG });
    m.addLayer({ id: 'hasil-isi', type: 'fill', source: 'hasil', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': WARNA_HASIL, 'fill-opacity': 0.35 } });
    m.addLayer({ id: 'hasil-garis', type: 'line', source: 'hasil', layout: { 'line-cap': 'round', 'line-join': 'round' },
                 paint: { 'line-color': WARNA_HASIL, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 8], 'line-opacity': 0.9 } });
    m.addLayer({ id: 'hasil-titik', type: 'circle', source: 'hasil', filter: ['==', ['geometry-type'], 'Point'],
                 paint: { 'circle-color': WARNA_HASIL, 'circle-radius': 8, 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 } });
    m.addLayer({ id: 'lokasi-garis', type: 'line', source: 'lokasi', paint: { 'line-color': '#111', 'line-width': 2, 'line-dasharray': [2, 2] } });
    m.addLayer({ id: 'gambar-isi', type: 'fill', source: 'gambar', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#e84393', 'fill-opacity': 0.15 } });
    // line-dasharray tidak menerima ekspresi data di MapLibre 4.x: garis tetap dan pratinjau dipisah.
    m.addLayer({ id: 'gambar-garis', type: 'line', source: 'gambar',
                 filter: ['all', ['!=', ['geometry-type'], 'Point'], ['!=', ['get', 'pratinjau'], true]],
                 paint: { 'line-color': '#e84393', 'line-width': 2.5 } });
    m.addLayer({ id: 'gambar-pratinjau', type: 'line', source: 'gambar',
                 filter: ['all', ['!=', ['geometry-type'], 'Point'], ['==', ['get', 'pratinjau'], true]],
                 paint: { 'line-color': '#e84393', 'line-width': 2.5, 'line-dasharray': [2, 2] } });
    m.addLayer({ id: 'gambar-titik', type: 'circle', source: 'gambar', filter: ['==', ['geometry-type'], 'Point'],
                 paint: { 'circle-color': '#fff', 'circle-radius': 4.5, 'circle-stroke-color': '#e84393', 'circle-stroke-width': 2 } });
  }

  setHasil(fc) { this.map.getSource('hasil')?.setData(fc || KOSONG); }
  setLokasi(fc) { this.map.getSource('lokasi')?.setData(fc || KOSONG); }
  bersihkanHasil() { this.setHasil(null); this.setLokasi(null); this.penanda?.remove(); this.penanda = null; }

  tandai(lonlat, warna = '#c0392b') {
    if (!lonlat) { this.penanda?.remove(); this.penanda = null; return; }
    if (!this.penanda) {
      const el = document.createElement('div'); el.className = 'penanda';
      this.penanda = new maplibregl.Marker({ element: el }).setLngLat(lonlat).addTo(this.map);
    }
    this.penanda.getElement().style.background = warna;
    this.penanda.setLngLat(lonlat);
  }

  zoomKe(bbox, maks = 16) {
    if (!bbox) return;
    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, maxZoom: maks, duration: 600 });
  }

  // ---------------- alat gambar ----------------
  // mode: 'titik' | 'garis' | 'poligon'. opsi.onUbah(coords) tiap titik ditambah; opsi.onSelesai(coords).
  gambar(mode, opsi = {}) {
    this.hentikanGambar();
    const m = this.map, titik = [];
    let kursor = null;
    this.klikDiblok = true;
    m.getCanvas().style.cursor = 'crosshair';
    m.doubleClickZoom.disable();
    const minimal = mode === 'poligon' ? 3 : mode === 'garis' ? 2 : 1;
    const gambarUlang = () => {
      const f = titik.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }));
      const jalur = kursor ? [...titik, kursor] : titik;
      if (mode === 'poligon' && jalur.length >= 3) f.push({ type: 'Feature', properties: { pratinjau: !!kursor }, geometry: { type: 'Polygon', coordinates: [[...jalur, jalur[0]]] } });
      else if (jalur.length >= 2) f.push({ type: 'Feature', properties: { pratinjau: !!kursor }, geometry: { type: 'LineString', coordinates: jalur } });
      m.getSource('gambar').setData({ type: 'FeatureCollection', features: f });
    };
    const selesai = () => {
      if (titik.length < minimal) return;
      kursor = null; gambarUlang(); this._lepasGambar(false);
      opsi.onSelesai?.(titik.slice());
    };
    const klik = e => {
      titik.push([+e.lngLat.lng.toFixed(7), +e.lngLat.lat.toFixed(7)]);
      gambarUlang(); opsi.onUbah?.(titik.slice());
      if (mode === 'titik') selesai();
    };
    const gerak = e => { if (titik.length) { kursor = [e.lngLat.lng, e.lngLat.lat]; gambarUlang(); } };
    // Klik ganda memicu dua 'click' di titik yang sama: buang titik kembar di ujung lalu selesai.
    const sama = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
    const dbl = e => {
      e.preventDefault();
      while (titik.length > minimal && sama(titik.at(-1), titik.at(-2))) titik.pop();
      opsi.onUbah?.(titik.slice()); selesai();
    };
    const tombol = e => {
      if (e.key === 'Escape') { this.hentikanGambar(); opsi.onBatal?.(); }
      else if (e.key === 'Enter') selesai();
      else if (e.key === 'Backspace' && titik.length && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        titik.pop(); gambarUlang(); opsi.onUbah?.(titik.slice());
      }
    };
    m.on('click', klik); m.on('mousemove', gerak); m.on('dblclick', dbl);
    document.addEventListener('keydown', tombol);
    this._gambarAktif = { klik, gerak, dbl, tombol, selesai, titik };
    return { selesai, batal: () => this.hentikanGambar() };
  }

  _lepasGambar(hapus) {
    const g = this._gambarAktif; if (!g) return;
    const m = this.map;
    m.off('click', g.klik); m.off('mousemove', g.gerak); m.off('dblclick', g.dbl);
    document.removeEventListener('keydown', g.tombol);
    m.getCanvas().style.cursor = '';
    setTimeout(() => { m.doubleClickZoom.enable(); this.klikDiblok = false; }, 300);
    this._gambarAktif = null;
    if (hapus) m.getSource('gambar')?.setData(KOSONG);
  }

  selesaikanGambar() { this._gambarAktif?.selesai(); }
  hentikanGambar() { this._lepasGambar(true); this.map.getSource('gambar')?.setData(KOSONG); }
  get sedangMenggambar() { return !!this._gambarAktif; }
}

// Lingkaran perkiraan (tampilan saja) untuk menampilkan radius filter.
export function lingkaran(lon, lat, r, n = 64) {
  const R = 6378137, c = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    c.push([lon + (r * Math.sin(a)) / (R * Math.cos((lat * Math.PI) / 180)) * (180 / Math.PI), lat + (r * Math.cos(a)) / R * (180 / Math.PI)]);
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [c] } }] };
}
