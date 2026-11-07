// peta.js — Peta 3D CesiumJS: peta dasar, layer data, bangunan 3D (3D Tiles), popup atribut,
// layer hasil analisis, dan alat gambar. API kelas Peta sama dengan versi 2D sebelumnya, sehingga
// modul fitur (js/fitur/*.js) tidak bergantung pada pustaka peta.
//
// Tanpa Cesium ion (tanpa token): peta dasar Esri/OSM, globe elipsoid tanpa terrain.
// Alas bangunan 3D Tiles ada di tinggi elipsoid 0 m, jadi globe sengaja dibiarkan datar.
import { esc, fmtAngka } from './ui.js';

const C = () => globalThis.Cesium;

const DASAR = {
  abu: { label: 'Abu-abu terang (Esri)', buat: () => new (C().UrlTemplateImageryProvider)({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    credit: 'Peta dasar © Esri, HERE, Garmin, © OpenStreetMap contributors', maximumLevel: 16 }) },
  osm: { label: 'OpenStreetMap', buat: () => new (C().OpenStreetMapImageryProvider)({ url: 'https://tile.openstreetmap.org/', maximumLevel: 19 }) },
  citra: { label: 'Citra (Esri)', buat: () => new (C().UrlTemplateImageryProvider)({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Citra © Esri, Maxar, Earthstar Geographics', maximumLevel: 19 }) },
};
const DASAR_AWAL = 'abu';
const WARNA_HASIL = '#f39c12';
const WARNA_GAMBAR = '#e84393';
const KAMERA_AWAL = { lon: 104.03, lat: 0.93, tinggi: 26000, heading: 0, pitch: -45 };

// Gaya bangunan 3D menurut tinggi (sama dengan pilot 3D)
const GAYA_BANGUNAN = {
  tinggi: { color: { conditions: [
    ['${tinggi_m} >= 60', "color('#7a0177')"], ['${tinggi_m} >= 30', "color('#c51b8a')"],
    ['${tinggi_m} >= 15', "color('#f768a1')"], ['${tinggi_m} >= 8', "color('#fbb4b9')"], ['true', "color('#fde0dd')"]] } },
  polos: { color: "color('#e9e4da')" },
};

const lebarJalan = p => (p.klasifikasi === 'arteri' ? 3.2 : p.klasifikasi === 'kolektor' ? 2.2 : 1.4);

export class Peta {
  // opsi.mode: '3d' (bawaan) | '2d'. opsi.onMode(mode) dipanggil setiap kali mode selesai berganti.
  constructor(el, opsi = {}) {
    const Cs = C();
    el = typeof el === 'string' ? document.getElementById(el) : el;
    this.onMode = opsi.onMode;
    this.viewer = new Cs.Viewer(el, {
      baseLayer: new Cs.ImageryLayer(DASAR[DASAR_AWAL].buat()),
      baseLayerPicker: false, geocoder: false, timeline: false, animation: false, homeButton: true,
      sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false,
      fullscreenButton: false, terrainProvider: new Cs.EllipsoidTerrainProvider(),
      // Mode 2D memakai Web Mercator seperti peta web pada umumnya (ubin dasar juga Web Mercator).
      mapProjection: new Cs.WebMercatorProjection(),
      sceneMode: opsi.mode === '2d' ? Cs.SceneMode.SCENE2D : Cs.SceneMode.SCENE3D,
    });
    const v = this.viewer, sc = v.scene;
    sc.globe.depthTestAgainstTerrain = true;
    sc.globe.enableLighting = false;
    sc.globe.baseColor = Cs.Color.fromCssColorString('#dfe6ee');
    sc.skyAtmosphere.show = true;
    v.screenSpaceEventHandler.removeInputAction(Cs.ScreenSpaceEventType.LEFT_DOUBLE_CLICK); // jangan lacak entitas
    this.map = v; // kompatibilitas
    const k = KAMERA_AWAL;
    this.awal = { destination: Cs.Cartesian3.fromDegrees(k.lon, k.lat, k.tinggi),
                  orientation: { heading: Cs.Math.toRadians(k.heading), pitch: Cs.Math.toRadians(k.pitch), roll: 0 } };
    this.awal2d = { destination: Cs.Cartesian3.fromDegrees(k.lon, 1.06, 42000) };
    v.camera.setView(this.mode === '2d' ? this.awal2d : this.awal);
    v.homeButton.viewModel.command.beforeExecute.addEventListener(e => {
      e.cancel = true; v.camera.flyTo(this.mode === '2d' ? this.awal2d : this.awal);
    });

    this.layerData = {};     // id -> {meta, geojson, ds (CustomDataSource), perFitur: Map(_i -> [entity])}
    this.filterQuery = {};   // id -> array indeks (U2)
    this.klikDiblok = false;
    this.bangunan = null;    // Cesium3DTileset
    this.dsHasil = this._ds('hasil');
    this.dsLokasi = this._ds('lokasi');
    this.dsGambar = this._ds('gambar');
    this._pasangKlik();
    this._popupEl = Object.assign(document.createElement('div'), { className: 'popup-3d', hidden: true });
    el.appendChild(this._popupEl);
    // Klik itu sendiri bisa memicu moveStart: abaikan sesaat setelah popup dibuka.
    sc.camera.moveStart.addEventListener(() => { if (performance.now() - (this._popupWaktu || 0) > 600) this.tutupPopup(); });
    this.siap = Promise.resolve();
  }

  _ds(nama) { const ds = new (C().CustomDataSource)(nama); this.viewer.dataSources.add(ds); return ds; }

  get dasarDaftar() { return Object.entries(DASAR).map(([id, d]) => ({ id, label: d.label })); }

  gantiDasar(id) {
    const ly = this.viewer.imageryLayers;
    ly.removeAll();
    ly.addImageryProvider(DASAR[id].buat());
  }

  // ---------------------------------------------------------------- layer vektor
  _entitas(ds, f, gaya, meta) {
    const Cs = C(), g = f.geometry, keluar = [];
    if (!g) return keluar;
    const warna = Cs.Color.fromCssColorString(gaya.warna);
    const garis = (koord, lebar, w = warna) => ds.entities.add({ polyline: {
      positions: Cs.Cartesian3.fromDegreesArray(koord.flat()), width: lebar, material: w, arcType: Cs.ArcType.GEODESIC } });
    const tambah = (tipe, c) => {
      if (tipe === 'LineString') keluar.push(garis(c, gaya.lebar(f.properties)));
      else if (tipe === 'MultiLineString') c.forEach(x => keluar.push(garis(x, gaya.lebar(f.properties))));
      else if (tipe === 'Polygon') {
        c.forEach(r => keluar.push(garis(r, gaya.lebarTepi ?? 2)));
        if (gaya.isi) keluar.push(ds.entities.add({ polygon: {
          hierarchy: new Cs.PolygonHierarchy(Cs.Cartesian3.fromDegreesArray(c[0].flat()), c.slice(1).map(h => new Cs.PolygonHierarchy(Cs.Cartesian3.fromDegreesArray(h.flat())))),
          material: warna.withAlpha(gaya.isi), height: 0 } }));
      } else if (tipe === 'MultiPolygon') c.forEach(p => tambah('Polygon', p));
      else if (tipe === 'Point') keluar.push(ds.entities.add({ position: Cs.Cartesian3.fromDegrees(c[0], c[1]),
        point: { pixelSize: gaya.ukuranTitik ?? 7, color: warna, outlineColor: Cs.Color.WHITE, outlineWidth: 1.2,
                 disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
      else if (tipe === 'MultiPoint') c.forEach(p => tambah('Point', p));
    };
    if (g.type === 'GeometryCollection') g.geometries.forEach(x => tambah(x.type, x.coordinates));
    else tambah(g.type, g.coordinates);
    for (const e of keluar) e.sigma = { meta, props: f.properties };
    return keluar;
  }

  tambahLayer(meta, geojson) {
    const ds = this._ds('lyr-' + meta.id), perFitur = new Map();
    const gaya = { warna: meta.warna, lebar: meta.id === 'jalan' ? lebarJalan : () => 1.6, isi: /Polygon/.test(meta.geometri) ? 0.04 : 0, lebarTepi: 2 };
    ds.entities.suspendEvents();
    for (const f of geojson.features) perFitur.set(f.properties._i, this._entitas(ds, f, gaya, meta));
    ds.entities.resumeEvents();
    this.layerData[meta.id] = { meta, geojson, ds, perFitur };
  }

  tampilkan(id, tampak) { const L = this.layerData[id]; if (L) L.ds.show = tampak; }

  opasitas(id, v) {
    const L = this.layerData[id]; if (!L) return;
    const Cs = C(), w = Cs.Color.fromCssColorString(L.meta.warna);
    for (const e of L.ds.entities.values) {
      if (e.polyline) e.polyline.material = w.withAlpha(v);
      if (e.point) e.point.color = w.withAlpha(v);
      if (e.polygon) e.polygon.material = w.withAlpha(0.04 * v);
    }
  }

  // U2: tampilkan hanya objek dengan _i dalam daftar (null = hapus filter)
  setFilter(id, indeks) {
    const L = this.layerData[id]; if (!L) return;
    if (indeks) this.filterQuery[id] = indeks; else delete this.filterQuery[id];
    const lolos = indeks ? new Set(indeks) : null;
    for (const [i, ents] of L.perFitur) for (const e of ents) e.show = !lolos || lolos.has(i);
  }

  // ---------------------------------------------------------------- bangunan 3D
  async muatBangunan(url, opsi = {}) {
    const Cs = C();
    // projectTo2D: bangunan ikut diproyeksikan dengan tepat saat mode 2D (tampil sebagai tapak berwarna tinggi).
    const ts = await Cs.Cesium3DTileset.fromUrl(url, { maximumScreenSpaceError: opsi.sse ?? 16, projectTo2D: true });
    this.viewer.scene.primitives.add(ts);
    this.bangunan = ts;
    this.gayaBangunan('tinggi');
    return ts;
  }

  gayaBangunan(nama, alfa = 1) {
    if (!this.bangunan) return;
    const g = structuredClone(GAYA_BANGUNAN[nama] || GAYA_BANGUNAN.tinggi);
    if (alfa < 1) {
      if (g.color.conditions) g.color.conditions = g.color.conditions.map(([k, c]) => [k, c.replace(/\)$/, `, ${alfa})`)]);
      else g.color = g.color.replace(/\)$/, `, ${alfa})`);
    }
    this.bangunan.style = new (C().Cesium3DTileStyle)(g);
  }

  tampilkanBangunan(tampak) { if (this.bangunan) this.bangunan.show = tampak; }

  // ---------------------------------------------------------------- klik & popup
  _posisi(layar) {
    const Cs = C(), sc = this.viewer.scene;
    let cart = null;
    const pick = sc.pick(layar);
    if (pick && sc.pickPositionSupported) cart = sc.pickPosition(layar);
    if (!cart) cart = this.viewer.camera.pickEllipsoid(layar, sc.globe.ellipsoid);
    if (!cart) return null;
    const c = Cs.Cartographic.fromCartesian(cart);
    return [+Cs.Math.toDegrees(c.longitude).toFixed(7), +Cs.Math.toDegrees(c.latitude).toFixed(7)];
  }

  _pasangKlik() {
    const Cs = C();
    this._penangan = new Cs.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this._penangan.setInputAction(ev => {
      if (this.klikDiblok) return;
      // Di 2D semua objek datar sehingga isian poligon (mis. kecamatan) bisa menutupi bangunan:
      // ambil beberapa objek di bawah kursor dan pilih menurut prioritas titik > garis > bangunan > isian poligon.
      const skor = o => (o instanceof Cs.Cesium3DTileFeature ? 2 : o.id?.point ? 0 : o.id?.polyline ? 1 : o.id?.polygon ? 3 : 4);
      const p = this.viewer.scene.drillPick(ev.position, 6).sort((a, b) => skor(a) - skor(b))[0];
      if (!p) { this.tutupPopup(); return; }
      if (p instanceof Cs.Cesium3DTileFeature) {
        const ids = p.getPropertyIds();
        this._popup(ev.position, 'Bangunan 3D (LOD1 sementara)', Object.fromEntries(ids.map(k => [k, p.getProperty(k)])), new Set(['tinggi_m']), p);
        return;
      }
      const e = p.id;
      if (e?.sigma) {
        const dummy = new Set(String(e.sigma.props.atribut_dummy || '').split(',').map(s => s.split('(')[0].trim()));
        this._popup(ev.position, e.sigma.meta.label, e.sigma.props, dummy.has('semua') ? 'semua' : dummy);
      }
    }, Cs.ScreenSpaceEventType.LEFT_CLICK);
  }

  _popup(layar, judul, props, dummy, fitur3d) {
    const el = this._popupEl, Cs = C();
    this.tutupPopup();
    if (fitur3d) { this._sorot = { f: fitur3d, w: Cs.Color.clone(fitur3d.color) }; fitur3d.color = Cs.Color.YELLOW; }
    const baris = Object.entries(props).filter(([k]) => !k.startsWith('_') && k !== 'atribut_dummy').map(([k, v]) => {
      const d = !fitur3d && (dummy === 'semua' || dummy.has(k));
      const nilai = v === null || v === undefined || v === 'null' ? '—' : typeof v === 'number' ? fmtAngka(v, 2) : v;
      return `<tr><th>${esc(k)}</th><td>${esc(nilai)}${d ? ' <span class="lencana dummy">dummy</span>' : ''}</td></tr>`;
    }).join('');
    const catatan = fitur3d ? '<div class="kecil redup">Tinggi dari Open Buildings 2.5D (perkiraan); asal tapak lihat sumber_tapak.</div>' : '';
    el.innerHTML = `<button class="ikon tutup-popup" title="Tutup">×</button><b>${esc(judul)}</b><table>${baris}</table>${catatan}`;
    el.querySelector('.tutup-popup').onclick = () => this.tutupPopup();
    const w = this.viewer.container.clientWidth;
    el.style.left = Math.min(layar.x + 12, w - 340) + 'px';
    el.style.top = Math.max(layar.y - 20, 8) + 'px';
    el.hidden = false;
    this._popupWaktu = performance.now();
  }

  tutupPopup() {
    if (this._popupEl) this._popupEl.hidden = true;
    if (this._sorot) { this._sorot.f.color = this._sorot.w; this._sorot = null; }
  }

  // ---------------------------------------------------------------- hasil analisis
  _isiDs(ds, fc, gaya) {
    ds.entities.removeAll();
    if (!fc) return;
    ds.entities.suspendEvents();
    for (const f of fc.features || []) this._entitas(ds, f, gaya, null);
    ds.entities.resumeEvents();
  }

  setHasil(fc) { this._isiDs(this.dsHasil, fc, { warna: WARNA_HASIL, lebar: () => 6, isi: 0.35, lebarTepi: 3, ukuranTitik: 13 }); }

  setLokasi(fc) {
    const Cs = C(), ds = this.dsLokasi;
    ds.entities.removeAll();
    for (const f of fc?.features || []) {
      const cincin = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
      for (const r of cincin) ds.entities.add({ polyline: { positions: Cs.Cartesian3.fromDegreesArray(r.flat()), width: 3,
        material: new Cs.PolylineDashMaterialProperty({ color: Cs.Color.BLACK, dashLength: 12 }) } });
    }
  }

  bersihkanHasil() { this.setHasil(null); this.setLokasi(null); this.tandai(null); }

  tandai(lonlat, warna = '#c0392b') {
    const Cs = C();
    if (!lonlat) { if (this._penanda) { this.viewer.entities.remove(this._penanda); this._penanda = null; } return; }
    const pos = Cs.Cartesian3.fromDegrees(lonlat[0], lonlat[1]);
    if (!this._penanda) this._penanda = this.viewer.entities.add({ position: pos,
      point: { pixelSize: 14, color: Cs.Color.fromCssColorString(warna), outlineColor: Cs.Color.WHITE, outlineWidth: 2,
               disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    this._penanda.position = pos;
    this._penanda.point.color = Cs.Color.fromCssColorString(warna);
  }

  // Terbang ke bbox [minx, miny, maxx, maxy] dengan pandangan miring 3D.
  zoomKe(bbox) {
    if (!bbox) return;
    const Cs = C();
    // Panel hasil menutupi bagian bawah peta: titik fokus digeser ke selatan agar objek tampil di bagian atas.
    const geser = document.getElementById('hasil')?.hidden === false ? (bbox[3] - bbox[1]) * 0.55 : 0;
    const titik = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]].map(([x, y]) => Cs.Cartesian3.fromDegrees(x, y - geser));
    const bs = Cs.BoundingSphere.fromPoints(titik);
    this.viewer.camera.flyToBoundingSphere(bs, { duration: 1.2,
      offset: new Cs.HeadingPitchRange(0, Cs.Math.toRadians(-45), Math.max(bs.radius * 2.6, 600)) });
  }

  terbangKe(lonlat, jarak = 900) {
    const Cs = C();
    this.viewer.camera.flyToBoundingSphere(new Cs.BoundingSphere(Cs.Cartesian3.fromDegrees(lonlat[0], lonlat[1]), 10),
      { duration: 1.2, offset: new Cs.HeadingPitchRange(0, Cs.Math.toRadians(-40), jarak) });
  }

  // ---------------------------------------------------------------- mode 2D / 3D
  get mode() { return this.viewer.scene.mode === C().SceneMode.SCENE2D ? '2d' : '3d'; }

  // Ganti globe 3D <-> peta datar 2D tanpa memuat ulang data; area yang sedang dilihat dipertahankan.
  gantiMode(mode, durasi = 0.8) {
    const Cs = C(), v = this.viewer, sc = v.scene, cam = v.camera;
    if (mode === this.mode || sc.mode === Cs.SceneMode.MORPHING) return;
    this.tutupPopup();
    const lebar = v.canvas.clientWidth, tinggiLayar = v.canvas.clientHeight;
    const tengah = this._posisi(new Cs.Cartesian2(lebar / 2, tinggiLayar / 2)) || [KAMERA_AWAL.lon, 1.06];
    // Lebar bentang yang terlihat (meter), dipakai untuk menyamakan skala sesudah berganti mode.
    let bentang;
    if (sc.mode === Cs.SceneMode.SCENE2D) bentang = cam.frustum.right - cam.frustum.left;
    else {
      const jarak = Cs.Cartesian3.distance(cam.positionWC, Cs.Cartesian3.fromDegrees(tengah[0], tengah[1]));
      bentang = 2 * jarak * Math.tan(cam.frustum.fov / 2);
    }
    // Cesium memasang kameranya sendiri sesudah morphComplete: kamera kita dipasang satu frame kemudian.
    const sesudahMorph = () => {
      sc.morphComplete.removeEventListener(sesudahMorph);
      const sekali = () => { sc.postRender.removeEventListener(sekali); sesudah(); };
      sc.postRender.addEventListener(sekali);
      sc.requestRender();
    };
    const sesudah = () => {
      if (mode === '2d') cam.setView({ destination: Cs.Cartesian3.fromDegrees(tengah[0], tengah[1], Math.max(bentang, 300)) });
      else {
        const jarak = Math.max(bentang / (2 * Math.tan(cam.frustum.fov / 2)), 400);
        cam.flyToBoundingSphere(new Cs.BoundingSphere(Cs.Cartesian3.fromDegrees(tengah[0], tengah[1]), 10),
          { duration: 0.8, offset: new Cs.HeadingPitchRange(0, Cs.Math.toRadians(-45), jarak) });
      }
      this.onMode?.(mode);
    };
    sc.morphComplete.addEventListener(sesudahMorph);
    if (mode === '2d') sc.morphTo2D(durasi); else sc.morphTo3D(durasi);
  }

  // Pandangan tegak lurus (atas) <-> miring 45°, mempertahankan titik tengah layar (hanya mode 3D).
  pandangan(mode) {
    if (this.mode === '2d') return;
    const Cs = C(), v = this.viewer, cam = v.camera;
    const tengah = this._posisi(new Cs.Cartesian2(v.canvas.clientWidth / 2, v.canvas.clientHeight / 2)) || [KAMERA_AWAL.lon, 1.08];
    const jarak = Math.max(cam.positionCartographic.height * (mode === 'atas' ? 1 : 1.4), 500);
    cam.flyToBoundingSphere(new Cs.BoundingSphere(Cs.Cartesian3.fromDegrees(tengah[0], tengah[1]), 10),
      { duration: 1, offset: new Cs.HeadingPitchRange(mode === 'atas' ? 0 : cam.heading, Cs.Math.toRadians(mode === 'atas' ? -90 : -45), jarak) });
  }

  // ---------------------------------------------------------------- alat gambar
  // mode: 'titik' | 'garis' | 'poligon'. opsi.onUbah(coords) tiap titik ditambah; opsi.onSelesai(coords).
  gambar(mode, opsi = {}) {
    this.hentikanGambar();
    const Cs = C(), ds = this.dsGambar, titik = [];
    let kursor = null;
    this.klikDiblok = true; this.tutupPopup();
    this.viewer.canvas.style.cursor = 'crosshair';
    const minimal = mode === 'poligon' ? 3 : mode === 'garis' ? 2 : 1;
    const warna = Cs.Color.fromCssColorString(WARNA_GAMBAR);
    const posisi = (pakaiKursor) => Cs.Cartesian3.fromDegreesArray((pakaiKursor && kursor ? [...titik, kursor] : titik).flat());
    const ePratinjau = ds.entities.add({ polyline: { positions: new Cs.CallbackProperty(() => {
      const t = kursor && titik.length ? [titik.at(-1), kursor, ...(mode === 'poligon' && titik.length >= 2 ? [titik[0]] : [])] : [];
      return Cs.Cartesian3.fromDegreesArray(t.flat());
    }, false), width: 2.5, material: new Cs.PolylineDashMaterialProperty({ color: warna, dashLength: 10 }) } });
    const eGaris = ds.entities.add({ polyline: { positions: new Cs.CallbackProperty(() => {
      const p = titik.length >= 2 ? [...titik, ...(mode === 'poligon' && !kursor && titik.length >= 3 ? [titik[0]] : [])] : [];
      return Cs.Cartesian3.fromDegreesArray(p.flat());
    }, false), width: 3, material: warna } });
    const ePoli = mode === 'poligon' ? ds.entities.add({ polygon: { hierarchy: new Cs.CallbackProperty(() =>
      new Cs.PolygonHierarchy(titik.length >= 3 ? posisi(true) : []), false), material: warna.withAlpha(0.18), height: 0 } }) : null;
    const eTitik = [];
    const gambarTitik = () => {
      while (eTitik.length > titik.length) ds.entities.remove(eTitik.pop());
      titik.forEach((c, i) => {
        if (!eTitik[i]) eTitik[i] = ds.entities.add({ point: { pixelSize: 9, color: Cs.Color.WHITE, outlineColor: warna, outlineWidth: 2.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY } });
        eTitik[i].position = Cs.Cartesian3.fromDegrees(c[0], c[1]);
      });
    };
    const selesai = () => {
      if (titik.length < minimal) return;
      kursor = null; this._lepasGambar(false);
      opsi.onSelesai?.(titik.slice());
    };
    const sama = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
    const h = new Cs.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    h.setInputAction(ev => {
      const p = this._posisi(ev.position); if (!p) return;
      titik.push(p); gambarTitik(); opsi.onUbah?.(titik.slice());
      if (mode === 'titik') selesai();
    }, Cs.ScreenSpaceEventType.LEFT_CLICK);
    h.setInputAction(ev => { if (titik.length) kursor = this._posisi(ev.endPosition) || kursor; }, Cs.ScreenSpaceEventType.MOUSE_MOVE);
    h.setInputAction(() => {
      while (titik.length > minimal && sama(titik.at(-1), titik.at(-2))) titik.pop();
      gambarTitik(); opsi.onUbah?.(titik.slice()); selesai();
    }, Cs.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    const tombol = e => {
      if (e.key === 'Escape') { this.hentikanGambar(); opsi.onBatal?.(); }
      else if (e.key === 'Enter') selesai();
      else if (e.key === 'Backspace' && titik.length && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        titik.pop(); gambarTitik(); opsi.onUbah?.(titik.slice());
      }
    };
    document.addEventListener('keydown', tombol);
    this._gambarAktif = { h, tombol, selesai, ePratinjau, eGaris, ePoli };
    return { selesai, batal: () => this.hentikanGambar() };
  }

  _lepasGambar(hapus) {
    const g = this._gambarAktif; if (!g) return;
    g.h.destroy();
    document.removeEventListener('keydown', g.tombol);
    this.viewer.canvas.style.cursor = '';
    this.dsGambar.entities.remove(g.ePratinjau);
    setTimeout(() => { this.klikDiblok = false; }, 300);
    this._gambarAktif = null;
    if (hapus) this.dsGambar.entities.removeAll();
  }

  selesaikanGambar() { this._gambarAktif?.selesai(); }
  hentikanGambar() { this._lepasGambar(true); this.dsGambar.entities.removeAll(); }
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
