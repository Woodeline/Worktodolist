#!/usr/bin/env node
// png-measure.mjs - zero-dependency PNG decoder + layout zone boundary probe.
//
// Why: the DOM snapshots for the workbench only reached titlebar/statusbar before
// the node budget ran out, so sidebar/editor/panel widths are NOT in evidence/*.dom.json.
// The screenshots are already on disk, so zone geometry can be measured from pixels
// without relaunching the probe window (zero disturbance to the user's Trae).
//
// Usage:  node tools/png-measure.mjs evidence/E30-project-trusted.png [--row 400] [--col 700]
//         [--gap 24] [--threshold 30] [--csv]
//
// Output: bands along one horizontal scan line (row) and one vertical scan line (col),
//         each band = [start,end) size + median rgb + hex.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const file = argv.find((a) => !a.startsWith('--') || a.endsWith('.png'));
if (!file) { console.error('need a png path'); process.exit(1); }

// ---------- minimal PNG decode ----------
function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let p = 8, W = 0, H = 0, bd = 0, ct = 0, il = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); bd = data[8]; ct = data[9]; il = data[12]; }
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('only bit depth 8 supported, got ' + bd);
  if (il !== 0) throw new Error('interlaced PNG not supported');
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : (() => { throw new Error('color type ' + ct + ' unsupported'); })();
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * ch;
  const out = Buffer.alloc(H * stride);
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = prev && x >= ch ? prev[x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
  }
  return { W, H, ch, data: out };
}

const img = decodePng(readFileSync(resolve(process.cwd(), file)));
const px = (x, y) => { const i = y * img.W * img.ch + x * img.ch; const d = img.data; return [d[i], d[i + 1], d[i + 2]]; };
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

// ---------- boundary detection ----------
function sampleLine(get, n) { const o = []; for (let i = 0; i < n; i++) o.push(get(i)); return o; }
// Background of a strip = most frequent quantised colour. Using the mode instead of the
// raw pixel kills the false cuts that text glyphs / icons create inside one panel.
function modeColor(get, n) {
  const hist = new Map();
  for (let i = 0; i < n; i++) {
    const c = get(i);
    const k = ((c[0] >> 2) << 12) | ((c[1] >> 2) << 8) | ((c[2] >> 2) << 4);
    const e = hist.get(k);
    if (e) { e[0]++; e[1] += c[0]; e[2] += c[1]; e[3] += c[2]; } else hist.set(k, [1, c[0], c[1], c[2]]);
  }
  let best = null;
  for (const v of hist.values()) if (!best || v[0] > best[0]) best = v;
  if (!best) return [0, 0, 0, 0];
  return [Math.round(best[1] / best[0]), Math.round(best[2] / best[0]), Math.round(best[3] / best[0]), best[0] / n];
}
function findBands(vals, threshold, minRun) {
  const cuts = [0];
  for (let i = 1; i < vals.length; i++) if (dist(vals[i], vals[i - 1]) > threshold) cuts.push(i);
  cuts.push(vals.length);
  const bands = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i], e = cuts[i + 1];
    if (e - s < minRun) { // merge hairline slivers into previous band
      if (bands.length) bands[bands.length - 1].e = e; else bands.push({ s, e });
      continue;
    }
    bands.push({ s, e });
  }
  return bands.map((b) => {
    const mid = vals[Math.floor((b.s + b.e) / 2)];
    let sum = 0; for (let i = b.s; i < b.e; i++) sum += vals[i][3];
    return { s: b.s, e: b.e, w: b.e - b.s, color: mid.slice(0, 3), hex: hex(mid.slice(0, 3)), cover: sum / (b.e - b.s) };
  });
}

const TH = Number(arg('threshold', 12)), MIN = Number(arg('gap', 16));
const FROM = Number(arg('from', 60)), WIN = Number(arg('win', 600), 10);
const ROW = arg('row', null), COL = arg('col', null);
const report = [];
console.log(`${file}  ${img.W}x${img.H}  ch=${img.ch}  threshold=${TH} minRun=${MIN} from=${FROM} win=${WIN}`);

// --strip "y=430,x=330..350"  → raw pixel dump, used to see 1px sashes/borders
// --rows  "x=700,y=780..800"  → raw vertical dump
const strip = arg('strip', null), rows = arg('rows', null);
if (strip) {
  const m = /y=(\d+),x=(\d+)\.\.(\d+)/.exec(strip);
  const [, y, x0, x1] = m.map(Number);
  console.log(`\n-- strip y=${y} x=${x0}..${x1} --`);
  for (let x = x0; x <= x1; x++) console.log(`   x=${x} ${hex(px(x, y))}`);
}
if (rows) {
  const m = /x=(\d+),y=(\d+)\.\.(\d+)/.exec(rows);
  const [, x, y0, y1] = m.map(Number);
  console.log(`\n-- strip x=${x} y=${y0}..${y1} --`);
  for (let y = y0; y <= y1; y++) console.log(`   y=${y} ${hex(px(x, y))}`);
}

function cutList(vals, threshold) {
  const out = [];
  for (let i = 1; i < vals.length; i++) { const d = dist(vals[i], vals[i - 1]); if (d > threshold) out.push({ at: i, d, from: hex(vals[i - 1].slice(0, 3)), to: hex(vals[i].slice(0, 3)) }); }
  return out;
}

const cutsArg = arg('cuts', null);
if (cutsArg) {
  const [dir, at] = cutsArg.split(':');
  const lo = Math.max(0, Number(at) - FROM), hi = Math.min(dir === 'row' ? img.H : img.W, lo + WIN);
  const len = dir === 'row' ? img.W : img.H;
  const vals = sampleLine((i) => dir === 'row' ? modeColor((k) => px(i, lo + k), hi - lo) : modeColor((k) => px(lo + k, i), hi - lo), len);
  const cl = cutList(vals, TH);
  let prev = 0;
  console.log(`\n-- cuts (${dir} @ ${at}, window ${lo}..${hi}) --`);
  for (const c of cl) { console.log(`   ${dir === 'row' ? 'x' : 'y'}=${String(c.at).padStart(4)}  d=${String(c.d).padStart(3)}  ${c.from} -> ${c.to}   run=${c.at - prev}`); prev = c.at; }
  console.log(`   end=${len}  last run=${len - prev}`);
}

const TH2 = TH;
if (ROW !== 'auto') {
  const rows = (ROW === null ? [Math.round(img.H * 0.5)] : String(ROW).split(',').map(Number).filter(Number.isFinite));
  for (const y of rows) {
    const lo = Math.max(0, y - FROM), hi = Math.min(img.H, lo + WIN);
    const vals = sampleLine((x) => modeColor((i) => px(x, lo + i), hi - lo), img.W);
    const bands = findBands(vals, TH, MIN);
    console.log(`\n-- horizontal @ y=${y}  (mode colour over x-column, y ${lo}..${hi}) --`);
    for (const b of bands) console.log(`   x ${String(b.s).padStart(4)}..${String(b.e).padStart(4)}  w=${String(b.w).padStart(4)}  ${b.hex}  coverage=${b.cover.toFixed(2)}`);
    report.push({ dir: 'row', at: y, bands: bands.map((b) => ({ s: b.s, e: b.e, w: b.w, hex: b.hex })) });
  }
}
if (COL !== 'auto') {
  const cols = COL === null ? [Math.round(img.W * 0.5)] : String(COL).split(',').map(Number);
  for (const x of cols) {
    const lo = Math.max(0, x - FROM), hi = Math.min(img.W, lo + WIN);
    const vals = sampleLine((y) => modeColor((i) => px(lo + i, y), hi - lo), img.H);
    const bands = findBands(vals, TH, MIN);
    console.log(`\n-- vertical @ x=${x}  (mode colour over y-row, x ${lo}..${hi}) --`);
    for (const b of bands) console.log(`   y ${String(b.s).padStart(4)}..${String(b.e).padStart(4)}  h=${String(b.w).padStart(4)}  ${b.hex}  coverage=${b.cover.toFixed(2)}`);
    report.push({ dir: 'col', at: x, bands: bands.map((b) => ({ s: b.s, e: b.e, w: b.w, hex: b.hex })) });
  }
}
if (arg('csv', null)) console.log('\nCSV\n' + report.map((r) => `${r.dir},${r.at},${r.bands.map((b) => `${b.s}-${b.e}:${b.hex}`).join(' ')}`).join('\n'));
