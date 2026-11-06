// U2 — Query Atribut Layer (definition query) · KAK IV.1.e.2).iv
import { h, PembangunEkspresi, daftarKV, fmtAngka, catatanBlok, galatBlok, kodeBlok, toast } from '../ui.js';

export default {
  kode: 'U2', paket: 'Analisis Umum', nama: 'Query Atribut Layer',
  kak: 'IV.1.e.2).iv (fitur query) — fitur pendukung, bukan butir analisis', fungsi: 'sigma_umum.query_layer(), ke_cql2()', status: 'Siap QA',
  ringkas: 'Membatasi tampilan satu layer pada objek yang lolos ekspresi atribut (definition query). Filter tetap aktif sampai dihapus.',
  kelasUji: ['UjiEkspresi'],
  kriteria: [
    'Query mengubah tampilan layer di peta (hanya objek lolos yang tampil) dan penanda "query aktif" muncul di daftar layer.',
    'Tombol hapus query mengembalikan seluruh objek.',
    'Grup bersarang lewat mode JSON, misal (A atau B) dan C, memberi hasil yang benar.',
    'Objek dengan nilai kosong tidak lolos operator ≠; operator "kosong" menemukannya.',
    'Pilihan nilai pada kolom pilihan sesuai isi data (domain); kolom angka menerima koma desimal.',
    'Nama kolom atau operator yang tidak dikenal ditolak dengan pesan, bukan galat sistem.',
    'CQL2 yang ditampilkan dapat dipakai di GeoServer / OGC API Features.',
  ],

  buka(w, app) {
    this.app = app;
    this.layer = app.layerMeta[1]?.id || app.layerMeta[0].id;
    this.eksWadah = h('div', { class: 'eks' });
    this.eks = new PembangunEkspresi(this.eksWadah);
    this.aktif = h('div', { class: 'aktif-daftar' });
    w.append(
      h('label', { class: 'label' }, 'Layer'),
      h('select', { onchange: e => { this.layer = e.target.value; this._muatSkema(); } },
        app.layerMeta.map(l => h('option', { value: l.id, selected: l.id === this.layer }, `${l.label} (${fmtAngka(l.jumlah)})`))),
      h('label', { class: 'label' }, 'Ekspresi'), this.eksWadah,
      h('div', { class: 'aksi' }, h('button', { class: 'tombol', 'data-butuh-python': '', onclick: () => this.terapkan() }, 'Terapkan query'),
        h('button', { class: 'tombol sekunder', onclick: () => this.hapus(this.layer) }, 'Hapus query layer ini')),
      h('label', { class: 'label' }, 'Query aktif'), this.aktif);
    this._renderAktif();
    this._muatSkema();
  },

  async _muatSkema() {
    if (!this.app.pySiap) { this.app.saatSiap(() => this._muatSkema()); this.eksWadah.textContent = 'Menunggu mesin Python…'; return; }
    const s = await this.app.py.jalankan('skema', { layer: this.layer });
    this.eks.setSkema(s.filter(k => !['atribut_dummy', 'sumber_geometri', 'klasifikasi_catatan'].includes(k.kolom)));
  },

  async terapkan() {
    let spek;
    try { spek = { layer: this.layer, ekspresi: this.eks.ekspresi() }; } catch (e) { toast(e.message, 'galat'); return; }
    const r = await this.app.py.jalankan('u2', spek);
    this.app.catatRiwayat('U2', spek, r);
    const g = galatBlok(r);
    if (g) { this.app.hasil('U2 · Query Atribut Layer', g); return; }
    this.app.peta.setFilter(this.layer, r.indeks);
    this.app.peta.tampilkan(this.layer, true);
    this.app.segarkanLayer();
    if (r.bbox) this.app.peta.zoomKe(r.bbox, 15);
    const meta = this.app.layerMeta.find(l => l.id === this.layer);
    this.app.hasil(`U2 · Query ${meta.label} — ${fmtAngka(r.jumlah)} dari ${fmtAngka(r.jumlah_total)} objek`,
      daftarKV([['Layer', meta.label, ''], ['Lolos', `${fmtAngka(r.jumlah)} dari ${fmtAngka(r.jumlah_total)}`], ['Waktu proses', r._durasi_ms + ' ms']]),
      kodeBlok('CQL2 (untuk GeoServer / OGC API Features)', r.cql2 || '(tanpa syarat — semua objek)'),
      catatanBlok(r.catatan));
    this._renderAktif();
  },

  hapus(id) {
    this.app.peta.setFilter(id, null); this.app.segarkanLayer(); this._renderAktif();
  },

  _renderAktif() {
    const q = this.app.peta.filterQuery, ids = Object.keys(q);
    this.aktif.innerHTML = '';
    if (!ids.length) { this.aktif.append(h('div', { class: 'redup kecil' }, 'Tidak ada.')); return; }
    for (const id of ids) {
      const meta = this.app.layerMeta.find(l => l.id === id);
      this.aktif.append(h('div', { class: 'baris' }, h('span', {}, `${meta.label}: ${fmtAngka(q[id].length)} objek`),
        h('button', { class: 'tautan', onclick: () => this.hapus(id) }, 'hapus')));
    }
  },

  tutup() {},  // query sengaja tetap aktif setelah panel ditutup (perilaku definition query)
};
