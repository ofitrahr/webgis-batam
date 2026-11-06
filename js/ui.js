// ui.js — Utilitas antarmuka: format Indonesia, elemen, notifikasi, tabel, pembangun ekspresi, grafik profil.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtAngka(x, des = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return Number(x).toLocaleString('id-ID', { minimumFractionDigits: des, maximumFractionDigits: des });
}
export const fmtPanjang = m => (m == null ? '—' : m < 10000 ? fmtAngka(m, m < 100 ? 1 : 0) + ' m' : fmtAngka(m / 1000, 2) + ' km');
export const fmtLuas = a => (a == null ? '—' : a < 1e6 ? `${fmtAngka(a, 0)} m² · ${fmtAngka(a / 1e4, 2)} ha` : `${fmtAngka(a / 1e6, 2)} km² · ${fmtAngka(a / 1e4, 1)} ha`);
export const fmtPersen = (p, des = 2) => (p == null ? '—' : fmtAngka(p, des) + '%');

export function h(tag, attr = {}, ...anak) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const a of anak.flat()) if (a !== null && a !== undefined && a !== false) e.append(a instanceof Node ? a : document.createTextNode(a));
  return e;
}

export function toast(pesan, jenis = 'info', lama = 4000) {
  let wadah = document.getElementById('toast');
  const t = h('div', { class: 'toast ' + jenis }, pesan);
  wadah.append(t);
  setTimeout(() => t.classList.add('pergi'), lama);
  setTimeout(() => t.remove(), lama + 400);
}

export function tabel(kolom, baris, opsi = {}) {
  return h('table', { class: 'tabel' + (opsi.kecil ? ' kecil' : '') },
    h('thead', {}, h('tr', {}, kolom.map(k => h('th', { class: k.kanan ? 'kanan' : '' }, k.label)))),
    h('tbody', {}, baris.length ? baris.map(b => h('tr', {}, kolom.map(k => {
      const v = typeof k.nilai === 'function' ? k.nilai(b) : b[k.nilai];
      return h('td', { class: k.kanan ? 'kanan mono' : '' }, v instanceof Node ? v : String(v ?? '—'));
    }))) : h('tr', {}, h('td', { colspan: kolom.length, class: 'redup' }, 'Tidak ada data'))));
}

export function daftarKV(pasangan) {
  return h('dl', { class: 'kv' }, pasangan.filter(Boolean).flatMap(([k, v, cls]) => [h('dt', {}, k), h('dd', { class: cls || 'mono' }, v instanceof Node ? v : String(v ?? '—'))]));
}

export function catatanBlok(catatan) {
  if (!catatan || !catatan.length) return null;
  return h('div', { class: 'catatan' }, h('b', {}, 'Catatan dari mesin analisis'), h('ul', {}, catatan.map(c => h('li', {}, c))));
}

export function galatBlok(hasil) {
  if (hasil.galat) return h('div', { class: 'galat' }, h('b', {}, 'Masukan ditolak: '), hasil.galat);
  if (hasil.galat_sistem) return h('div', { class: 'galat sistem' }, h('b', {}, 'Galat sistem (bug, laporkan): '), hasil.galat_sistem,
    h('details', {}, h('summary', {}, 'Jejak'), h('pre', {}, hasil.jejak || '')));
  return null;
}

export function kodeBlok(judul, teks) {
  if (!teks) return null;
  return h('div', { class: 'kode-blok' }, h('div', { class: 'kode-judul' }, judul,
    h('button', { class: 'tautan', onclick: () => { navigator.clipboard?.writeText(teks); toast('Disalin'); } }, 'salin')), h('code', {}, teks));
}

// ------------------------------------------------------------------ Pembangun ekspresi (U1, U2)
const OP = {
  angka: [['=', '='], ['!=', '≠'], ['>', '>'], ['>=', '≥'], ['<', '<'], ['<=', '≤'], ['antara', 'antara'], ['kosong', 'kosong'], ['tidak_kosong', 'tidak kosong']],
  pilihan: [['=', '='], ['!=', '≠'], ['dalam', 'salah satu dari'], ['tidak_dalam', 'bukan salah satu dari'], ['memuat', 'memuat'], ['kosong', 'kosong'], ['tidak_kosong', 'tidak kosong']],
  teks: [['=', '='], ['!=', '≠'], ['memuat', 'memuat'], ['diawali', 'diawali'], ['dalam', 'salah satu dari'], ['kosong', 'kosong'], ['tidak_kosong', 'tidak kosong']],
  tanggal: [['=', '='], ['>', 'sesudah'], ['>=', '≥'], ['<', 'sebelum'], ['<=', '≤'], ['antara', 'antara'], ['kosong', 'kosong']],
};

export class PembangunEkspresi {
  constructor(wadah) {
    this.wadah = wadah; this.skema = []; this.baris = []; this.gabung = 'semua'; this.modeJson = false;
  }

  setSkema(skema) {
    this.skema = skema; this.baris = [this._barisBaru()]; this.render();
  }

  _barisBaru() { const k = this.skema[0]; return { kolom: k?.kolom, op: '=', nilai: '' }; }
  _info(kolom) { return this.skema.find(s => s.kolom === kolom) || { tipe: 'teks' }; }

  render() {
    const w = this.wadah; w.innerHTML = '';
    const kepala = h('div', { class: 'eks-kepala' },
      h('label', {}, 'Gabungkan syarat dengan '),
      h('select', { onchange: e => { this.gabung = e.target.value; } },
        h('option', { value: 'semua', selected: this.gabung === 'semua' }, 'DAN (semua syarat)'),
        h('option', { value: 'salah_satu', selected: this.gabung === 'salah_satu' }, 'ATAU (salah satu syarat)')),
      h('button', { class: 'tautan', onclick: () => this._toggleJson() }, this.modeJson ? '← mode formulir' : 'mode lanjutan (JSON) →'));
    w.append(kepala);
    if (this.modeJson) {
      const ta = h('textarea', { class: 'eks-json', rows: 9, spellcheck: 'false' }, JSON.stringify(this._dariFormulir(), null, 2));
      ta.addEventListener('input', () => { this._jsonTeks = ta.value; });
      this._jsonTeks = ta.value;
      w.append(ta, h('div', { class: 'bantu' }, 'Grup: {"semua":[…]} = DAN, {"salah_satu":[…]} = ATAU, {"bukan":…}. Grup boleh bersarang, misal (A atau B) dan C.'));
      return;
    }
    this.baris.forEach((b, i) => w.append(this._renderBaris(b, i)));
    w.append(h('button', { class: 'tombol kecil sekunder', onclick: () => { this.baris.push(this._barisBaru()); this.render(); } }, '+ Tambah syarat'));
  }

  _renderBaris(b, i) {
    const info = this._info(b.kolom);
    const ops = OP[info.tipe] || OP.teks;
    if (!ops.some(o => o[0] === b.op)) b.op = ops[0][0];
    const pilihKolom = h('select', { class: 'eks-kolom', onchange: e => { b.kolom = e.target.value; b.nilai = ''; this.render(); } },
      this.skema.map(s => h('option', { value: s.kolom, selected: s.kolom === b.kolom }, `${s.kolom} (${s.tipe})`)));
    const pilihOp = h('select', { class: 'eks-op', onchange: e => { b.op = e.target.value; b.nilai = ''; this.render(); } },
      ops.map(([v, l]) => h('option', { value: v, selected: v === b.op }, l)));
    let nilai = null;
    if (b.op === 'kosong' || b.op === 'tidak_kosong') nilai = h('span', { class: 'redup kecil' }, '(tanpa nilai)');
    else if (b.op === 'antara') {
      const v = Array.isArray(b.nilai) ? b.nilai : ['', ''];
      const tipe = info.tipe === 'tanggal' ? 'date' : 'number';
      nilai = h('span', { class: 'eks-antara' },
        h('input', { type: tipe, value: v[0], placeholder: info.min ?? 'min', oninput: e => { v[0] = e.target.value; b.nilai = v; } }), '–',
        h('input', { type: tipe, value: v[1], placeholder: info.maks ?? 'maks', oninput: e => { v[1] = e.target.value; b.nilai = v; } }));
      b.nilai = v;
    } else if ((b.op === 'dalam' || b.op === 'tidak_dalam') && info.domain) {
      const sel = new Set(Array.isArray(b.nilai) ? b.nilai : []);
      nilai = h('div', { class: 'eks-multi' }, info.domain.map(d => h('label', {},
        h('input', { type: 'checkbox', checked: sel.has(d), onchange: e => { e.target.checked ? sel.add(d) : sel.delete(d); b.nilai = [...sel]; } }), d)));
      b.nilai = [...sel];
    } else if (info.domain && (b.op === '=' || b.op === '!=')) {
      nilai = h('select', { onchange: e => { b.nilai = e.target.value; } },
        h('option', { value: '' }, '— pilih —'), info.domain.map(d => h('option', { value: d, selected: d === b.nilai }, d)));
    } else {
      nilai = h('input', { type: info.tipe === 'angka' ? 'text' : info.tipe === 'tanggal' ? 'date' : 'text', inputmode: info.tipe === 'angka' ? 'decimal' : null,
                           value: b.nilai, placeholder: info.tipe === 'angka' ? `${info.min ?? ''} … ${info.maks ?? ''}` : 'nilai',
                           oninput: e => { b.nilai = e.target.value; } });
    }
    return h('div', { class: 'eks-baris' }, pilihKolom, pilihOp, nilai,
      h('button', { class: 'ikon', title: 'Hapus syarat', onclick: () => { this.baris.splice(i, 1); if (!this.baris.length) this.baris.push(this._barisBaru()); this.render(); } }, '×'));
  }

  _toggleJson() {
    if (this.modeJson) {
      try { this._kustom = JSON.parse(this._jsonTeks); } catch { toast('JSON tidak valid', 'galat'); return; }
    } else this._kustom = null;
    this.modeJson = !this.modeJson; this.render();
  }

  _dariFormulir() {
    const syarat = this.baris.filter(b => b.kolom).map(b => {
      const info = this._info(b.kolom);
      let v = b.nilai;
      if (info.tipe === 'angka' && typeof v === 'string' && v.trim() !== '' && !isNaN(+v.replace(',', '.'))) v = +v.replace(',', '.');
      if (info.tipe === 'angka' && Array.isArray(v)) v = v.map(x => (x === '' ? x : +String(x).replace(',', '.')));
      return { kolom: b.kolom, op: b.op, ...(b.op === 'kosong' || b.op === 'tidak_kosong' ? {} : { nilai: v }) };
    });
    if (!syarat.length) return null;
    return syarat.length === 1 ? syarat[0] : { [this.gabung]: syarat };
  }

  // Ekspresi dikirim apa adanya, termasuk syarat yang nilainya kosong: mesin Python yang
  // membuangnya dan melaporkannya di catatan (perilaku yang diuji QA).
  ekspresi() {
    if (this.modeJson) {
      try { return JSON.parse(this._jsonTeks); } catch { throw new Error('JSON ekspresi tidak valid'); }
    }
    return this._dariFormulir();
  }
}

// ------------------------------------------------------------------ Grafik profil (SVG)
export function grafikProfil(sampel, ringkasan, onHover) {
  const W = 760, H = 230, p = { l: 52, r: 14, t: 14, b: 32 };
  const valid = sampel.filter(s => s.z !== null);
  const L = sampel.at(-1).sta_m || 1;
  let zmin = Math.min(...valid.map(s => s.z)), zmax = Math.max(...valid.map(s => s.z));
  const pad = Math.max((zmax - zmin) * 0.1, 1); zmin -= pad; zmax += pad;
  const X = d => p.l + (d / L) * (W - p.l - p.r), Y = z => p.t + (1 - (z - zmin) / (zmax - zmin)) * (H - p.t - p.b);
  let d = '', area = '', awal = null;
  const tutupArea = (sAkhir) => { if (awal !== null) area += `L${X(sAkhir).toFixed(1)},${(H - p.b)}L${X(awal).toFixed(1)},${H - p.b}Z`; };
  let sebelum = null;
  for (const s of sampel) {
    if (s.z === null) { if (sebelum) tutupArea(sebelum.sta_m); awal = null; sebelum = null; continue; }
    const xy = `${X(s.sta_m).toFixed(1)},${Y(s.z).toFixed(1)}`;
    if (!sebelum) { d += `M${xy}`; area += `M${X(s.sta_m).toFixed(1)},${H - p.b}L${xy}`; awal = s.sta_m; } else { d += `L${xy}`; area += `L${xy}`; }
    sebelum = s;
  }
  if (sebelum) tutupArea(sebelum.sta_m);
  const gridY = [], n = 4;
  for (let i = 0; i <= n; i++) {
    const z = zmin + ((zmax - zmin) * i) / n, y = Y(z);
    gridY.push(`<line x1="${p.l}" x2="${W - p.r}" y1="${y}" y2="${y}" class="grid"/><text x="${p.l - 6}" y="${y + 4}" text-anchor="end">${fmtAngka(z, 0)}</text>`);
  }
  const gridX = [];
  for (let i = 0; i <= 5; i++) {
    const s = (L * i) / 5;
    gridX.push(`<text x="${X(s)}" y="${H - 10}" text-anchor="middle">${fmtPanjang(s)}</text>`);
  }
  const celah = sampel.some(s => s.z === null);
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="grafik" role="img" aria-label="Profil elevasi">
    ${gridY.join('')}${gridX.join('')}
    <text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">elevasi (m)</text>
    <path d="${area}" class="area"/><path d="${d}" class="garis"/>
    <circle cx="${X(ringkasan.sta_z_min_m)}" cy="${Y(ringkasan.z_min)}" r="4.5" class="titik-min"/>
    <circle cx="${X(ringkasan.sta_z_maks_m)}" cy="${Y(ringkasan.z_maks)}" r="4.5" class="titik-maks"/>
    <line class="kursor" x1="0" x2="0" y1="${p.t}" y2="${H - p.b}" style="display:none"/>
  </svg>`;
  const wadah = h('div', { class: 'grafik-wadah', html: svg });
  if (celah) wadah.append(h('div', { class: 'bantu' }, 'Celah pada grafik = sampel tanpa elevasi (di luar DEM / laut), tidak dibaca sebagai 0 m.'));
  const el = wadah.querySelector('svg'), kursor = el.querySelector('.kursor');
  el.addEventListener('mousemove', e => {
    const r = el.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
    const sta = ((x - p.l) / (W - p.l - p.r)) * L;
    let best = sampel[0];
    for (const s of sampel) if (Math.abs(s.sta_m - sta) < Math.abs(best.sta_m - sta)) best = s;
    kursor.setAttribute('x1', X(best.sta_m)); kursor.setAttribute('x2', X(best.sta_m)); kursor.style.display = '';
    onHover?.(best);
  });
  el.addEventListener('mouseleave', () => { kursor.style.display = 'none'; onHover?.(null); });
  return wadah;
}

export function unduh(namaFile, isi, tipe = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([isi], { type: tipe })), download: namaFile });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
