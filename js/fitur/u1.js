// U1 — Filter Berdasarkan Lokasi dan Atribut (KAK IV.2.a.2).iv butir 1)
import { h, PembangunEkspresi, daftarKV, tabel, fmtPanjang, fmtLuas, fmtAngka, catatanBlok, galatBlok, kodeBlok, toast } from '../ui.js';
import { lingkaran } from '../peta.js';

export default {
  kode: 'U1', paket: 'Analisis Umum', nama: 'Filter Berdasarkan Lokasi dan Atribut',
  kak: 'IV.2.a.2).iv butir 1; IV.1.e.2).iv', fungsi: 'sigma_umum.filter_lokasi_atribut()', status: 'Siap QA',
  ringkas: 'Menyaring objek satu layer menurut syarat atribut dan lokasi (kecamatan, radius, atau poligon), lalu menghitung jumlah, panjang, dan luas — dipotong pada batas lokasi.',
  kelasUji: ['UjiU1Filter', 'UjiEkspresi'],
  kriteria: [
    'Filter atribut berjalan pada semua layer vektor (jalan, drainase, pipa, genangan, kecamatan), bukan hanya 3 layer seperti prototipe lama.',
    'Operator =, ≠, >, ≥, <, ≤, antara, salah satu dari, memuat, kosong berfungsi dan sesuai tipe kolom.',
    'Syarat yang nilainya dikosongkan diabaikan dan muncul catatan; dengan gabungan ATAU, hasil TIDAK berubah menjadi semua objek.',
    'Filter kecamatan memotong ruas pada batas: total panjang hanya bagian di dalam kecamatan (bandingkan dengan opsi potong dimatikan).',
    'Ruas yang hanya menyentuh batas kecamatan tidak ikut dihitung.',
    'Filter radius memakai meter: objek di luar lingkaran tidak terpilih.',
    'Filter poligon gambar berfungsi; poligon tidak valid ditangani tanpa galat sistem.',
    'Ringkasan per kecamatan, total panjang/luas tampil dengan format Indonesia (titik ribuan, koma desimal).',
    'Kriteria yang dipakai ditampilkan dalam CQL2 dan sama dengan yang dimasukkan.',
  ],

  buka(w, app) {
    this.app = app;
    const layerPilih = app.layerMeta.filter(l => l.id !== 'kecamatan').concat(app.layerMeta.filter(l => l.id === 'kecamatan'));
    this.state = { layer: layerPilih[0].id, lokasi: 'wilayah', kec: new Set(['Batam Kota']), titik: null, radius: 1000, poligon: null };
    const selLayer = h('select', { onchange: e => { this.state.layer = e.target.value; this._muatSkema(); } },
      layerPilih.map(l => h('option', { value: l.id }, `${l.label} (${fmtAngka(l.jumlah)})`)));
    this.eksWadah = h('div', { class: 'eks' });
    this.eks = new PembangunEkspresi(this.eksWadah);
    const kecNama = app.data.kecamatan.features.map(f => f.properties.nama).sort();
    this.lokasiWadah = h('div', { class: 'lokasi-isi' });
    const radio = (v, l) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'u1lok', value: v, checked: this.state.lokasi === v,
      onchange: () => { this.state.lokasi = v; this._renderLokasi(kecNama); } }), l);
    this.cekPotong = h('input', { type: 'checkbox', checked: true });
    this.selPredikat = h('select', {}, h('option', { value: 'intersects' }, 'bersinggungan (intersects)'), h('option', { value: 'within' }, 'seluruhnya di dalam (within)'));
    w.append(
      h('label', { class: 'label' }, 'Layer sasaran'), selLayer,
      h('label', { class: 'label' }, 'Syarat atribut'), this.eksWadah,
      h('label', { class: 'label' }, 'Syarat lokasi'),
      h('div', { class: 'radio-grup' }, radio('tanpa', 'Tanpa'), radio('wilayah', 'Kecamatan'), radio('radius', 'Radius'), radio('poligon', 'Poligon')),
      this.lokasiWadah,
      h('div', { class: 'opsi' }, h('label', {}, 'Predikat '), this.selPredikat),
      h('label', { class: 'cek' }, this.cekPotong, 'Potong geometri pada batas lokasi (panjang hanya bagian di dalam)'),
      h('div', { class: 'aksi' }, h('button', { class: 'tombol', 'data-butuh-python': '', onclick: () => this.jalankan() }, 'Jalankan filter'),
        h('button', { class: 'tombol sekunder', onclick: () => this.reset() }, 'Bersihkan')));
    this._renderLokasi(kecNama);
    this._muatSkema();
  },

  async _muatSkema() {
    if (!this.app.pySiap) { this.app.saatSiap(() => this._muatSkema()); this.eksWadah.textContent = 'Menunggu mesin Python…'; return; }
    const s = await this.app.py.jalankan('skema', { layer: this.state.layer });
    this.eks.setSkema(s.filter(k => !['atribut_dummy', 'sumber_geometri', 'klasifikasi_catatan'].includes(k.kolom)));
  },

  _renderLokasi(kecNama) {
    const w = this.lokasiWadah, st = this.state, peta = this.app.peta;
    w.innerHTML = ''; peta.setLokasi(null); peta.hentikanGambar();
    if (st.lokasi === 'wilayah') {
      w.append(h('div', { class: 'eks-multi kolom2' }, kecNama.map(n => h('label', {},
        h('input', { type: 'checkbox', checked: st.kec.has(n), onchange: e => { e.target.checked ? st.kec.add(n) : st.kec.delete(n); } }), n))));
    } else if (st.lokasi === 'radius') {
      const info = h('span', { class: 'redup kecil' }, st.titik ? `${st.titik[0].toFixed(5)}, ${st.titik[1].toFixed(5)}` : 'belum dipilih');
      const tampil = () => { if (st.titik) peta.setLokasi(lingkaran(st.titik[0], st.titik[1], st.radius)); };
      w.append(h('div', { class: 'baris' },
        h('button', { class: 'tombol kecil sekunder', onclick: () => {
          toast('Klik satu titik pusat di peta'); peta.gambar('titik', { onSelesai: c => { st.titik = c[0]; info.textContent = `${c[0][0].toFixed(5)}, ${c[0][1].toFixed(5)}`; tampil(); } });
        } }, 'Pilih titik pusat'), info),
        h('div', { class: 'baris' }, h('label', {}, 'Radius (m) '), h('input', { type: 'number', value: st.radius, min: 1, max: 50000, step: 50, class: 'pendek',
          oninput: e => { st.radius = +e.target.value; tampil(); } })));
      tampil();
    } else if (st.lokasi === 'poligon') {
      const info = h('span', { class: 'redup kecil' }, st.poligon ? `${st.poligon.length} titik` : 'belum digambar');
      w.append(h('div', { class: 'baris' }, h('button', { class: 'tombol kecil sekunder', onclick: () => {
        toast('Klik titik-titik poligon, klik ganda / Enter untuk selesai');
        peta.gambar('poligon', { onSelesai: c => { st.poligon = c; info.textContent = `${c.length} titik`; } });
      } }, 'Gambar poligon'), info));
    }
  },

  _lokasi() {
    const st = this.state;
    if (st.lokasi === 'wilayah') return { tipe: 'wilayah', kolom: 'nama', nilai: [...st.kec] };
    if (st.lokasi === 'radius') return st.titik ? { tipe: 'radius', titik: st.titik, radius_m: st.radius } : (() => { throw new Error('Pilih titik pusat radius dulu.'); })();
    if (st.lokasi === 'poligon') return st.poligon ? { tipe: 'poligon', geometri: { type: 'Polygon', coordinates: [[...st.poligon, st.poligon[0]]] } } : (() => { throw new Error('Gambar poligon dulu.'); })();
    return null;
  },

  async jalankan() {
    const app = this.app;
    let spek;
    try {
      spek = { layer: this.state.layer, ekspresi: this.eks.ekspresi(), lokasi: this._lokasi(), predikat: this.selPredikat.value, potong_geometri: this.cekPotong.checked };
    } catch (e) { toast(e.message, 'galat'); return; }
    const r = await app.py.jalankan('u1', spek);
    app.catatRiwayat('U1', spek, r);
    const galat = galatBlok(r);
    if (galat) { app.hasil('U1 · Filter Lokasi dan Atribut', galat); return; }
    app.peta.setHasil(r.fitur);
    if (r.fitur.features.length) {
      const b = r.fitur.features.reduce((a, f) => { const bb = bboxFitur(f); return [Math.min(a[0], bb[0]), Math.min(a[1], bb[1]), Math.max(a[2], bb[2]), Math.max(a[3], bb[3])]; }, [180, 90, -180, -90]);
      app.peta.zoomKe(b, 15);
    }
    app.hasil(`U1 · Filter Lokasi dan Atribut — ${r.label}`,
      h('div', { class: 'kartu-ringkas' },
        h('div', {}, h('span', { class: 'angka-besar' }, fmtAngka(r.jumlah)), h('span', {}, ` dari ${fmtAngka(r.jumlah_total)} objek`)),
        r.panjang_total_m ? h('div', {}, h('span', { class: 'angka-besar' }, fmtPanjang(r.panjang_total_m)), h('span', {}, ' total panjang')) : null,
        r.luas_total_m2 ? h('div', {}, h('span', { class: 'angka-besar' }, fmtLuas(r.luas_total_m2)), h('span', {}, ' total luas')) : null),
      daftarKV([['Lokasi', r.kriteria.lokasi, ''], ['Predikat', r.kriteria.predikat], ['Potong geometri', r.kriteria.potong_geometri ? 'ya' : 'tidak'], ['Waktu proses', r._durasi_ms + ' ms']]),
      kodeBlok('Kriteria atribut (CQL2)', r.kriteria.atribut_cql2 || '(tanpa syarat atribut)'),
      catatanBlok(r.catatan),
      r.per_wilayah.length ? h('div', {}, h('h4', {}, 'Per kecamatan'), tabel([
        { label: 'Kecamatan', nilai: 'wilayah' }, { label: 'Jumlah', nilai: x => fmtAngka(x.jumlah), kanan: true },
        { label: 'Panjang', nilai: x => fmtPanjang(x.panjang_m), kanan: true }, { label: 'Luas', nilai: x => (x.luas_m2 ? fmtLuas(x.luas_m2) : '—'), kanan: true }], r.per_wilayah, { kecil: true })) : null);
  },

  reset() { this.app.peta.bersihkanHasil(); this.app.peta.hentikanGambar(); this.state.titik = null; this.state.poligon = null; this.app.tutupHasil(); this._muatSkema(); },
  tutup(app) { app.peta.bersihkanHasil(); app.peta.hentikanGambar(); },
};

function bboxFitur(f) {
  const b = [180, 90, -180, -90];
  const jelajah = c => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(jelajah); };
  const g = f.geometry; if (g.type === 'GeometryCollection') g.geometries.forEach(x => jelajah(x.coordinates)); else jelajah(g.coordinates);
  return b;
}
