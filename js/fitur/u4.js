// U4 — Perhitungan Jarak · KAK IV.2.a.2).iv butir 4
import { h, daftarKV, tabel, fmtPanjang, fmtAngka, fmtPersen, catatanBlok, galatBlok, toast } from '../ui.js';

export default {
  kode: 'U4', paket: 'Analisis Umum', nama: 'Perhitungan Jarak',
  kak: 'IV.2.a.2).iv butir 4; IV.1.e.3).iii', fungsi: 'sigma_umum.ukur_jarak()', status: 'Siap QA',
  ringkas: 'Panjang lintasan multi-segmen dan jarak lurus awal–akhir, geodesik pada elipsoid WGS84 (Karney 2013).',
  kelasUji: ['UjiU4Jarak'],
  kriteria: [
    'Panjang total dan panjang per segmen tampil dan diperbarui setiap titik ditambah.',
    'Jarak lurus awal–akhir tampil terpisah dari panjang lintasan.',
    'Format Indonesia: < 10 km dalam meter dengan titik ribuan, ≥ 10 km dalam km dengan koma desimal.',
    'Pembanding grid UTM 48N tampil dengan selisih sekitar −0,02 s.d. −0,03% (wajar, faktor skala).',
    'Hasil cocok dengan pengukuran elipsoidal QGIS (Measure Line, ellipsoid WGS84) dalam 0,01%.',
  ],

  buka(w, app) {
    this.app = app;
    w.append(
      h('div', { class: 'aksi' }, h('button', { class: 'tombol', 'data-butuh-python': '', onclick: () => this.mulai() }, 'Mulai mengukur'),
        h('button', { class: 'tombol sekunder', onclick: () => { this.tutup(app); app.tutupHasil(); } }, 'Bersihkan')),
      h('div', { class: 'bantu' }, 'Klik titik-titik di peta; hasil diperbarui setiap klik. Klik ganda atau Enter untuk selesai, Backspace untuk membatalkan titik terakhir.'));
  },

  mulai() {
    toast('Klik titik-titik di peta');
    this.app.peta.gambar('garis', { onUbah: c => this.hitung(c), onSelesai: c => this.hitung(c, true) });
  },

  async hitung(titik, akhir = false) {
    if (titik.length < 2) return;
    const r = await this.app.py.jalankan('u4', { titik });
    if (akhir) this.app.catatRiwayat('U4', { titik }, r);
    const g = galatBlok(r);
    if (g) { this.app.hasil('U4 · Perhitungan Jarak', g); return; }
    this.app.hasil(`U4 · Perhitungan Jarak — ${r.label}`,
      h('div', { class: 'kartu-ringkas' }, h('div', {}, h('span', { class: 'angka-besar' }, fmtPanjang(r.panjang_lintasan_m)), h('span', {}, ' panjang lintasan')),
        h('div', {}, h('span', { class: 'angka-besar' }, fmtPanjang(r.jarak_lurus_m)), h('span', {}, ' jarak lurus awal–akhir'))),
      daftarKV([['Jumlah titik', fmtAngka(r.jumlah_titik)], ['Panjang (m, presisi)', fmtAngka(r.panjang_lintasan_m, 3)],
        ['Grid UTM 48N', `${fmtAngka(r.panjang_grid_utm_m, 3)} m (selisih ${fmtPersen(r.selisih_utm_pct, 4)})`], ['Metode', r.metode, '']]),
      tabel([{ label: 'Segmen', nilai: 'ke' }, { label: 'Panjang', nilai: x => fmtPanjang(x.panjang_m), kanan: true },
             { label: 'Panjang (m)', nilai: x => fmtAngka(x.panjang_m, 3), kanan: true }, { label: 'Azimut', nilai: x => fmtAngka(x.azimut_deg, 2) + '°', kanan: true }], r.segmen, { kecil: true }),
      catatanBlok(r.catatan));
  },

  tutup(app) { app.peta.hentikanGambar(); },
};
