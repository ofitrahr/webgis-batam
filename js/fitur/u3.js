// U3 — Analisis Profile (profil elevasi permukaan tanah) · KAK IV.2.a.2).iv butir 2
import { h, daftarKV, tabel, fmtPanjang, fmtAngka, fmtPersen, catatanBlok, galatBlok, grafikProfil, toast } from '../ui.js';

export default {
  kode: 'U3', paket: 'Analisis Umum', nama: 'Analisis Profil Elevasi',
  kak: 'IV.2.a.2).iv butir 2; dipakai IV.2.a.3).i (luapan drainase)', fungsi: 'sigma_umum.profil_elevasi()', status: 'Siap QA',
  ringkas: 'Profil elevasi PERMUKAAN TANAH dari DEM sepanjang lintasan multi-titik. Bukan profil dasar saluran/pipa.',
  kelasUji: ['UjiU3Profil'],
  kriteria: [
    'Lintasan multi-titik dapat digambar (klik, klik ganda/Enter untuk selesai, Backspace menghapus titik terakhir).',
    'Grafik profil tampil; arahkan kursor ke grafik menampilkan posisi di peta.',
    'Tidak ada label "kemiringan rata-rata" dari rentang relief; yang tampil: kemiringan ujung-ke-ujung, per segmen, lokal maksimum, naik/turun kumulatif, rentang relief.',
    'Lintasan naik lalu turun ke elevasi yang sama menghasilkan kemiringan ujung-ke-ujung ≈ 0%.',
    'Datum vertikal dan sumber DEM tampil di hasil.',
    'Teks "profil permukaan tanah, bukan dasar saluran" tampil.',
    'Lintasan yang melewati laut menampilkan celah pada grafik, bukan elevasi 0 m.',
    'Interval sampel bawaan sama dengan resolusi DEM; interval terlalu rapat memunculkan catatan.',
    'Titik terendah dan tertinggi ditandai pada grafik dan titik terendah dapat ditampilkan di peta.',
  ],

  buka(w, app) {
    this.app = app;
    this.lintasan = null;
    this.inInterval = h('input', { type: 'number', min: 1, step: 1, placeholder: `bawaan = resolusi DEM (${app.manifest.dem.res_x} m)`, class: 'panjang' });
    this.info = h('span', { class: 'redup kecil' }, 'belum digambar');
    const dem = app.manifest.dem;
    w.append(
      h('div', { class: 'peringatan' }, 'Profil permukaan tanah dari DEM, bukan profil dasar saluran/pipa.'),
      daftarKV([['DEM', `${dem.status} · ${dem.res_x} m · ${dem.crs}`, ''], ['Datum vertikal', dem.datum_vertikal, '']]),
      h('div', { class: 'baris' }, h('button', { class: 'tombol sekunder', onclick: () => this.gambar() }, 'Gambar lintasan'), this.info),
      h('label', { class: 'label' }, 'Interval sampel (m)'), this.inInterval,
      h('div', { class: 'aksi' }, h('button', { class: 'tombol', 'data-butuh-python': '', onclick: () => this.jalankan() }, 'Hitung profil'),
        h('button', { class: 'tombol sekunder', onclick: () => { this.tutup(app); app.tutupHasil(); this.lintasan = null; this.info.textContent = 'belum digambar'; } }, 'Bersihkan')),
      h('div', { class: 'bantu' }, 'Klik titik-titik lintasan di peta. Klik ganda atau Enter untuk selesai; profil langsung dihitung.'));
  },

  gambar() {
    this.app.peta.bersihkanHasil();
    toast('Klik titik-titik lintasan; klik ganda / Enter untuk selesai');
    this.app.peta.gambar('garis', {
      onUbah: c => { this.info.textContent = `${c.length} titik`; },
      onSelesai: c => { this.lintasan = c; this.info.textContent = `${c.length} titik`; this.jalankan(); },
    });
  },

  async jalankan() {
    const app = this.app;
    if (!this.lintasan) { toast('Gambar lintasan dulu', 'galat'); return; }
    const spek = { lintasan: this.lintasan, interval_m: this.inInterval.value ? +this.inInterval.value : null };
    const r = await app.py.jalankan('u3', spek);
    app.catatRiwayat('U3', spek, { ...r, sampel: r.sampel ? `(${r.sampel.length} sampel)` : undefined });
    const g = galatBlok(r);
    if (g) { app.hasil('U3 · Profil Elevasi', g); return; }
    const s = r.ringkasan;
    app.hasil(`U3 · Profil Elevasi — ${r.label}`,
      h('div', { class: 'peringatan' }, 'Profil permukaan tanah dari DEM, bukan profil dasar saluran/pipa. Datum vertikal: ', h('b', {}, r.dem.datum_vertikal)),
      grafikProfil(r.sampel, s, b => app.peta.tandai(b ? [b.lon, b.lat] : null, '#e84393')),
      h('div', { class: 'dua-kolom' },
        daftarKV([
          ['Panjang lintasan', fmtPanjang(s.panjang_lintasan_m)], ['Panjang permukaan', fmtPanjang(s.panjang_permukaan_m)],
          ['Elevasi awal → akhir', `${fmtAngka(s.z_awal, 1)} → ${fmtAngka(s.z_akhir, 1)} m`],
          ['Kemiringan ujung-ke-ujung', fmtPersen(s.kemiringan_ujung_ke_ujung_pct)],
          ['Kemiringan lokal maks.', `${fmtPersen(s.kemiringan_lokal_maks_pct)} di STA ${fmtPanjang(s.sta_kemiringan_lokal_maks_m)} (jendela ${fmtAngka(s.jendela_kemiringan_lokal_m)} m)`],
        ]),
        daftarKV([
          ['Terendah', h('span', {}, `${fmtAngka(s.z_min, 1)} m · STA ${fmtPanjang(s.sta_z_min_m)} `,
            h('button', { class: 'tautan', onclick: () => { app.peta.tandai([s.lon_z_min, s.lat_z_min]); app.peta.terbangKe([s.lon_z_min, s.lat_z_min]); } }, 'lihat'))],
          ['Tertinggi', `${fmtAngka(s.z_maks, 1)} m · STA ${fmtPanjang(s.sta_z_maks_m)}`],
          ['Rentang relief Δh', `${fmtAngka(s.rentang_relief_m, 1)} m`],
          ['Naik / turun kumulatif', `${fmtAngka(s.naik_kumulatif_m, 1)} / ${fmtAngka(s.turun_kumulatif_m, 1)} m`],
          ['Sampel', `${fmtAngka(s.jumlah_sampel_valid)} valid dari ${fmtAngka(s.jumlah_sampel)} · tiap ${fmtAngka(s.interval_sampel_m, 1)} m · ${r._durasi_ms} ms`],
        ])),
      h('h4', {}, 'Kemiringan per segmen lintasan'),
      tabel([{ label: 'Segmen', nilai: 'segmen' }, { label: 'STA awal', nilai: x => fmtPanjang(x.sta_awal_m), kanan: true },
             { label: 'Panjang', nilai: x => fmtPanjang(x.panjang_m), kanan: true },
             { label: 'z awal → akhir (m)', nilai: x => `${fmtAngka(x.z_awal, 1)} → ${fmtAngka(x.z_akhir, 1)}`, kanan: true },
             { label: 'Kemiringan', nilai: x => fmtPersen(x.kemiringan_pct), kanan: true }], r.segmen, { kecil: true }),
      daftarKV([['Sumber DEM', r.dem.sumber, ''], ['Interpolasi', r.dem.interpolasi, '']]),
      catatanBlok(r.catatan));
  },

  tutup(app) { app.peta.hentikanGambar(); app.peta.bersihkanHasil(); },
};
