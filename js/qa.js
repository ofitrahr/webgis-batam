// qa.js — Tab QA: uji otomatis (unittest Python di peramban), penilaian kriteria penerimaan, ekspor laporan.
import { h, toast, unduh } from './ui.js';
import { FITUR, RENCANA, MODUL_UJI, fiturUntukKelas } from './fitur/index.js';

const KUNCI = 'sigma-qa-v1';
const muat = () => { try { return JSON.parse(localStorage.getItem(KUNCI)) || {}; } catch { return {}; } };
const simpan = d => { try { localStorage.setItem(KUNCI, JSON.stringify(d)); } catch { /* penyimpanan tidak tersedia */ } };

export class TabQA {
  constructor(wadah, app) {
    this.w = wadah; this.app = app; this.data = muat(); this.uji = null;
    this.data.penilaian ??= {}; this.data.penguji ??= '';
  }

  _nilai(kode, i) { return this.data.penilaian[`${kode}:${i}`] || { status: '', catatan: '', build: '' }; }
  _setNilai(kode, i, patch) {
    const k = `${kode}:${i}`;
    this.data.penilaian[k] = { ...this._nilai(kode, i), ...patch, build: this.app.manifest.dibangun, waktu: new Date().toISOString() };
    simpan(this.data); this.render();
  }

  _ringkasUji(kode) {
    if (!this.uji) return null;
    const t = this.uji.filter(u => fiturUntukKelas(u.kelas).includes(kode));
    return { lulus: t.filter(u => u.status === 'lulus').length, gagal: t.filter(u => u.status === 'gagal' || u.status === 'galat').length,
             lewat: t.filter(u => u.status === 'dilewati').length, total: t.length, daftar: t };
  }

  _ringkasManual(f) {
    const n = f.kriteria.map((_, i) => this._nilai(f.kode, i));
    return { sesuai: n.filter(x => x.status === 'sesuai').length, tidak: n.filter(x => x.status === 'tidak').length,
             belum: n.filter(x => !x.status).length, usang: n.filter(x => x.status && x.build !== this.app.manifest.dibangun).length, total: n.length };
  }

  async jalankanUji() {
    if (!this.app.pySiap) { toast('Mesin Python belum siap', 'galat'); return; }
    this.sedangUji = true; this.render();
    try { this.uji = await this.app.py.jalankanUji(MODUL_UJI); this.ujiWaktu = new Date(); }
    catch (e) { toast('Uji gagal dijalankan: ' + e.message, 'galat'); }
    this.sedangUji = false; this.render();
  }

  render() {
    const w = this.w, m = this.app.manifest; w.innerHTML = '';
    const totalUji = this.uji ? { l: this.uji.filter(u => u.status === 'lulus').length, g: this.uji.filter(u => /gagal|galat/.test(u.status)).length, d: this.uji.filter(u => u.status === 'dilewati').length } : null;
    w.append(
      h('div', { class: 'qa-kepala' },
        h('div', { class: 'kecil redup' }, `Build ${new Date(m.dibangun).toLocaleString('id-ID')} · ${m.modul_python.map(x => `${x.file}@${x.sha}`).join(' · ')}`),
        h('label', { class: 'label' }, 'Nama penguji'),
        h('input', { type: 'text', value: this.data.penguji, placeholder: 'nama / peran', onchange: e => { this.data.penguji = e.target.value; simpan(this.data); } }),
        h('div', { class: 'aksi' },
          h('button', { class: 'tombol', 'data-butuh-python': '', disabled: this.sedangUji || !this.app.pySiap, onclick: () => this.jalankanUji() },
            this.sedangUji ? 'Menjalankan uji…' : 'Jalankan uji otomatis'),
          h('button', { class: 'tombol sekunder', onclick: () => this.eksporMd() }, 'Ekspor laporan (.md)'),
          h('button', { class: 'tombol sekunder', onclick: () => this.eksporCsv() }, 'CSV')),
        totalUji ? h('div', { class: 'uji-total ' + (totalUji.g ? 'merah' : 'hijau') },
          `Uji otomatis: ${totalUji.l} lulus · ${totalUji.g} gagal · ${totalUji.d} dilewati (${this.ujiWaktu.toLocaleTimeString('id-ID')})`) : null,
        h('div', { class: 'bantu' }, 'Uji otomatis menjalankan file unittest yang sama dengan yang diserahkan ke tim IT, langsung di peramban. Penilaian kriteria disimpan di peramban ini saja; ekspor laporan untuk dibagikan.')));

    // Ringkasan seluruh katalog
    const semua = [...FITUR, ...RENCANA];
    w.append(h('h3', {}, 'Ringkasan katalog fitur'), h('table', { class: 'tabel kecil' },
      h('thead', {}, h('tr', {}, ['Kode', 'Fitur', 'Status', 'Uji otomatis', 'Kriteria'].map(x => h('th', {}, x)))),
      h('tbody', {}, semua.map(f => {
        const u = f.kriteria ? this._ringkasUji(f.kode) : null, mn = f.kriteria ? this._ringkasManual(f) : null;
        return h('tr', { class: f.kriteria ? '' : 'redup' },
          h('td', { class: 'mono' }, f.kode), h('td', {}, f.nama),
          h('td', {}, h('span', { class: 'lencana ' + (f.kriteria ? 'siap' : 'belum') }, f.status)),
          h('td', { class: 'mono', title: 'lulus / dijalankan (dilewati tidak dihitung)' },
            u ? `${u.lulus}/${u.total - u.lewat}${u.gagal ? ' ✗' + u.gagal : ''}${u.lewat ? ` (+${u.lewat} lewat)` : ''}` : f.kriteria ? '—' : ''),
          h('td', { class: 'mono' }, mn ? `${mn.sesuai}✓ ${mn.tidak}✗ ${mn.belum}·${mn.usang ? ' ⟳' + mn.usang : ''}` : ''));
      }))));

    for (const f of FITUR) w.append(this._kartu(f));
  }

  _kartu(f) {
    const u = this._ringkasUji(f.kode);
    const kartu = h('details', { class: 'qa-kartu', open: this._terbuka?.has(f.kode) },
      h('summary', {}, h('b', {}, `${f.kode} · ${f.nama}`), ' ', h('span', { class: 'kecil redup' }, f.kak)));
    kartu.addEventListener('toggle', () => { (this._terbuka ??= new Set())[kartu.open ? 'add' : 'delete'](f.kode); });
    kartu.append(h('div', { class: 'kecil' }, f.ringkas), h('div', { class: 'kecil redup' }, 'Fungsi Python: ', h('code', {}, f.fungsi)),
      h('button', { class: 'tautan', onclick: () => this.app.bukaFitur(f.kode) }, 'Buka fitur ini →'));
    kartu.append(h('h4', {}, 'Kriteria penerimaan (uji manual)'));
    f.kriteria.forEach((k, i) => {
      const n = this._nilai(f.kode, i), usang = n.status && n.build !== this.app.manifest.dibangun;
      const tombol = (st, label) => h('button', { class: 'pilih ' + st + (n.status === st ? ' aktif' : ''), title: label,
        onclick: () => this._setNilai(f.kode, i, { status: n.status === st ? '' : st }) }, label);
      kartu.append(h('div', { class: 'kriteria' },
        h('div', { class: 'kriteria-teks' }, `${i + 1}. ${k}`, usang ? h('span', { class: 'lencana usang', title: 'Dinilai pada build sebelumnya; cek ulang' }, 'cek ulang') : null),
        h('div', { class: 'kriteria-aksi' }, tombol('sesuai', '✓ Sesuai'), tombol('tidak', '✗ Tidak'),
          h('input', { type: 'text', class: 'catatan-in', placeholder: 'catatan', value: n.catatan || '',
                       onchange: e => this._setNilai(f.kode, i, { catatan: e.target.value }) }))));
    });
    kartu.append(h('h4', {}, 'Uji otomatis (unittest)'));
    if (!u) kartu.append(h('div', { class: 'redup kecil' }, 'Belum dijalankan.'));
    else kartu.append(h('ul', { class: 'uji-daftar' }, u.daftar.map(t => h('li', { class: t.status },
      h('span', { class: 'lencana ' + t.status }, t.status), ' ', h('code', {}, `${t.kelas}.${t.uji}`),
      t.pesan ? h('details', {}, h('summary', {}, 'detail'), h('pre', {}, t.pesan)) : null))));
    return kartu;
  }

  _baris() {
    const keluar = [];
    for (const f of FITUR) f.kriteria.forEach((k, i) => { const n = this._nilai(f.kode, i); keluar.push({ kode: f.kode, no: i + 1, kriteria: k, ...n }); });
    return keluar;
  }

  eksporMd() {
    const m = this.app.manifest, L = [];
    L.push(`# Laporan QA Fitur Analisis — SIGMA Batam`, '',
      `- Penguji: ${this.data.penguji || '(belum diisi)'}`, `- Tanggal: ${new Date().toLocaleString('id-ID')}`,
      `- Build: ${m.dibangun}`, `- Modul: ${m.modul_python.map(x => `${x.file}@${x.sha}`).join(', ')}`,
      `- Data: ${m.layer.map(l => `${l.id} (${l.status})`).join(', ')}; DEM ${m.dem.status}`, '');
    if (this.uji) {
      L.push(`## Uji otomatis`, '', `| Fitur | Uji | Status | Pesan |`, `|---|---|---|---|`);
      for (const t of this.uji) L.push(`| ${fiturUntukKelas(t.kelas).join(', ')} | ${t.kelas}.${t.uji} | ${t.status} | ${(t.pesan || '').split('\n').filter(Boolean).slice(-1)[0]?.replace(/\|/g, '\\|') || ''} |`);
      L.push('');
    } else L.push('_Uji otomatis belum dijalankan pada sesi ini._', '');
    L.push(`## Kriteria penerimaan`, '');
    for (const f of FITUR) {
      const mn = this._ringkasManual(f);
      L.push(`### ${f.kode} · ${f.nama} (${mn.sesuai}/${mn.total} sesuai)`, '', `| No | Kriteria | Hasil | Catatan |`, `|---|---|---|---|`);
      f.kriteria.forEach((k, i) => {
        const n = this._nilai(f.kode, i);
        const hasil = n.status === 'sesuai' ? '✓ Sesuai' : n.status === 'tidak' ? '✗ Tidak sesuai' : '— belum';
        L.push(`| ${i + 1} | ${k.replace(/\|/g, '\\|')} | ${hasil}${n.status && n.build !== m.dibangun ? ' (build lama)' : ''} | ${(n.catatan || '').replace(/\|/g, '\\|')} |`);
      });
      L.push('');
    }
    const r = this.app.riwayat;
    if (r.length) {
      L.push(`## Riwayat pemanggilan analisis (sesi ini, ${r.length} terakhir)`, '');
      for (const x of r) L.push(`- ${x.waktu} · **${x.kode}** · ${x.ringkas}`, '  ```json', '  ' + JSON.stringify(x.spek), '  ```');
    }
    unduh(`QA_SIGMA_${new Date().toISOString().slice(0, 10)}.md`, L.join('\n'), 'text/markdown');
  }

  eksporCsv() {
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['kode', 'no', 'kriteria', 'status', 'catatan', 'build_dinilai', 'waktu'].join(',')];
    for (const b of this._baris()) rows.push([b.kode, b.no, q(b.kriteria), b.status, q(b.catatan), b.build, b.waktu || ''].join(','));
    unduh(`QA_SIGMA_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + rows.join('\n'), 'text/csv');
  }
}
