// Registri fitur analisis.
// Menambah fitur baru: buat js/fitur/<kode>.js (ikuti pola u1.js), impor di bawah, masukkan ke FITUR,
// lalu hapus kodenya dari RENCANA. Uji otomatis Python dihubungkan lewat `kelasUji` (nama kelas unittest).
import u1 from './u1.js';
import u2 from './u2.js';
import u3 from './u3.js';
import u4 from './u4.js';
import u5 from './u5.js';

export const FITUR = [u1, u2, u3, u4, u5];

// Modul unittest yang dijalankan di tab QA (nama file tanpa .py, harus ada di manifest.modul_python).
export const MODUL_UJI = ['test_sigma_umum'];

// Fitur yang belum dikembangkan (dari workbook Bedah Fitur), agar progres seluruh katalog terlihat di tab QA.
export const RENCANA = [
  ['D1', 'Drainase', 'Analisis Bottleneck Jaringan', 'IV.2.a.3).i butir 1'],
  ['D2', 'Drainase', 'Analisis Jaringan (arah aliran ke hilir)', 'IV.2.a.3).i butir 2'],
  ['D3', 'Drainase', 'Analisis Hilir Saluran (penelusuran ke hulu)', 'IV.2.a.3).i butir 3'],
  ['D4', 'Drainase', 'Analisis Dinamika Ketinggian Tampungan/Outlet', 'IV.2.a.3).i butir 4'],
  ['D5', 'Drainase', 'Analisis Lokasi Luapan Drainase', 'IV.2.a.3).i butir 5'],
  ['D6', 'Drainase', 'Analisis Prioritas Penanganan Banjir', 'IV.2.a.3).i butir 6'],
  ['J1', 'Jalan', 'Identifikasi Bottleneck Jaringan Jalan', 'IV.2.a.3).ii butir 1'],
  ['J2', 'Jalan', 'Tingkat Pelayanan Jalan (Indikatif)', 'IV.2.a.3).ii butir 2'],
  ['J3', 'Jalan', 'Prioritas Pengembangan dan Perbaikan Jalan', 'IV.2.a.3).ii butir 3'],
  ['J4', 'Jalan', 'Rute dan Konektivitas Transportasi Publik', 'IV.2.a.3).ii butir 4'],
  ['J5', 'Jalan', 'Kemacetan (Spasial-Tematik)', 'IV.2.a.3).ii butir 5'],
  ['J6', 'Jalan', 'Kelayakan Awal Investasi Jalan (Spasial)', 'IV.2.a.3).ii butir 6'],
  ['S1', 'SPAM', 'Kebutuhan Air (Demand)', 'IV.2.a.3).iii butir 1'],
  ['S2', 'SPAM', 'Kebutuhan Air (Demand) Proyeksi', 'IV.2.a.3).iii butir 4'],
  ['S3', 'SPAM', 'Kebutuhan Air Aktual', 'IV.2.a.3).iii butir 5'],
  ['S4', 'SPAM', 'Kapasitas Jaringan Pipa', 'IV.2.a.3).iii butir 2 & 6'],
  ['S5', 'SPAM', 'Sumber Daya Air (Supply)', 'IV.2.a.3).iii butir 3 & 7'],
  ['SD1', 'SDSS', 'Indikator Prioritas & Metode Pembobotan', 'IV.1.d'],
  ['SD2', 'SDSS', 'Skoring, Peringkat Usulan & Garis Potong Pagu', 'IV.1.d'],
  ['SD3', 'SDSS', 'Analisis Skenario (What-If)', 'IV.1.d'],
  ['SD4', 'SDSS', 'Dashboard & Sistem Rekomendasi', 'IV.1.d'],
  ['AI1', 'Modul AI', 'AI Information Extraction (Incident Layer)', 'IV.2.a.4)'],
  ['AI2', 'Modul AI', 'Klasifikasi Isu & Verifikasi Lokasi', 'IV.2.a.4)'],
  ['AI3', 'Modul AI', 'AI Spatial Assistant', 'IV.2.a.4)'],
  ['AI4', 'Modul AI', 'AI Recommendation', 'IV.2.a.4)'],
].map(([kode, paket, nama, kak]) => ({ kode, paket, nama, kak, status: 'Belum dikembangkan' }));

// Kelas uji yang namanya tidak memuat kode fitur dipetakan lewat `kelasUji` setiap fitur.
export function fiturUntukKelas(kelas) {
  const cocok = FITUR.filter(f => f.kelasUji?.includes(kelas)).map(f => f.kode);
  if (cocok.length) return cocok;
  const m = /^Uji([A-Z]+\d+)/.exec(kelas);
  return m ? [m[1]] : ['Umum'];
}
