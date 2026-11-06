// U5 — Perhitungan Luas · KAK IV.2.a.2).iv butir 3
import { h, daftarKV, fmtLuas, fmtPanjang, fmtAngka, fmtPersen, catatanBlok, galatBlok, toast } from '../ui.js';

export default {
  kode: 'U5', paket: 'Analisis Umum', nama: 'Perhitungan Luas',
  kak: 'IV.2.a.2).iv butir 3; IV.1.e.3).iii', fungsi: 'sigma_umum.ukur_luas()', status: 'Siap QA',
  ringkas: 'Luas dan keliling poligon, geodesik pada elipsoid WGS84. Poligon yang memotong dirinya sendiri ditolak atau diperbaiki.',
  kelasUji: ['UjiU5Luas'],
  kriteria: [
    'Luas (m², ha, km²) dan keliling tampil dan diperbarui setiap titik ditambah (≥ 3 titik).',
    'Poligon yang memotong dirinya sendiri (bentuk dasi kupu-kupu) DITOLAK dengan pesan yang jelas.',
    'Tombol "Perbaiki otomatis" menghitung ulang poligon yang tidak valid dan menandai bahwa poligon diperbaiki.',
    'Pembanding grid UTM 48N tampil dengan selisih sekitar −0,04 s.d. −0,06%.',
    'Hasil cocok dengan pengukuran elipsoidal QGIS (Measure Area, ellipsoid WGS84) dalam 0,01%.',
  ],

  buka(w, app) {
    this.app = app;
    w.append(
      h('div', { class: 'aksi' }, h('button', { class: 'tombol', 'data-butuh-python': '', onclick: () => this.mulai() }, 'Mulai menggambar poligon'),
        h('button', { class: 'tombol sekunder', onclick: () => { this.tutup(app); app.tutupHasil(); } }, 'Bersihkan')),
      h('div', { class: 'bantu' }, 'Klik titik-titik sudut di peta; hasil diperbarui setiap klik. Klik ganda atau Enter untuk selesai. Coba juga gambar bentuk silang (dasi kupu-kupu) untuk menguji validasi.'));
  },

  mulai() {
    toast('Klik titik-titik sudut poligon');
    this.app.peta.gambar('poligon', { onUbah: c => this.hitung(c), onSelesai: c => this.hitung(c, false, true) });
  },

  async hitung(poligon, perbaiki = false, akhir = false) {
    if (poligon.length < 3) return;
    const r = await this.app.py.jalankan('u5', { poligon, perbaiki });
    if (akhir || perbaiki) this.app.catatRiwayat('U5', { poligon, perbaiki }, r);
    const g = galatBlok(r);
    if (g) {
      this.app.hasil('U5 · Perhitungan Luas', g,
        r.galat ? h('button', { class: 'tombol kecil', onclick: () => this.hitung(poligon, true, true) }, 'Perbaiki otomatis lalu hitung') : null);
      return;
    }
    this.app.hasil(`U5 · Perhitungan Luas — ${r.label}`,
      h('div', { class: 'kartu-ringkas' }, h('div', {}, h('span', { class: 'angka-besar' }, fmtLuas(r.luas_m2))),
        h('div', {}, h('span', { class: 'angka-besar' }, fmtPanjang(r.keliling_m)), h('span', {}, ' keliling'))),
      r.diperbaiki ? h('div', { class: 'peringatan' }, 'Poligon diperbaiki otomatis (semula: ', r.alasan_tidak_valid, ').') : null,
      daftarKV([['Luas (m², presisi)', fmtAngka(r.luas_m2, 2)], ['Luas (ha)', fmtAngka(r.luas_ha, 4)], ['Luas (km²)', fmtAngka(r.luas_km2, 6)],
        ['Jumlah bagian', fmtAngka(r.jumlah_bagian)], ['Grid UTM 48N', `${fmtAngka(r.luas_grid_utm_m2, 2)} m² (selisih ${fmtPersen(r.selisih_utm_pct, 4)})`],
        ['Metode', r.metode, '']]),
      catatanBlok(r.catatan));
  },

  tutup(app) { app.peta.hentikanGambar(); },
};
