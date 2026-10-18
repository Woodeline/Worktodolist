#!/usr/bin/env node
// a11-token-audit.mjs — read-only audit of OUR OWN token layer, to turn report §11.1
// "值得借鉴" into a per-item verdict (已有 / 部分 / 缺失 / 冲突).
//
// Hard rule: this script only READS. It never writes to src.
//
// Usage:
//   node tools/a11-token-audit.mjs "<path to src/index.css>" ["<path to src/components>"]
//
// Checks:
//   1. token inventory: total definition statements, distinct names, family buckets
//   2. state-colour tier coverage: for each of accent/ok/warn/danger, which tiers exist
//   3. border / shadow / radius / selection-alpha ladders
//   4. hard-coded colour literals inside component files (token discipline leak)
//   5. capabilities Trae has that we do not (mask-image fade, scene shadow aliases)
//   6. doc-vs-implementation drift for the row-height constants (comment text vs tokens)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CSS = resolve(process.argv[2] || '');
const COMP = process.argv[3] ? resolve(process.argv[3]) : null;

const src = readFileSync(CSS, 'utf8');
const lines = src.split(/\r?\n/);

// ---------- 1. inventory ----------
const defs = [...src.matchAll(/(--[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*([^;{}]+)/g)];
const names = new Map();
for (const m of defs) {
  const k = m[1];
  if (!names.has(k)) names.set(k, []);
  names.get(k).push(m[2].trim());
}
console.log('=== 1. 令牌清点（只读）===');
console.log('  定义语句:', defs.length, ' 去重令牌名:', names.size);
const fam = {};
for (const k of names.keys()) { const f = k.replace(/^--/, '').split(/-(?=[a-z])/)[0]; fam[f] = (fam[f] || 0) + 1; }
console.log('  族分布 :', JSON.stringify(Object.fromEntries(Object.entries(fam).sort((a, b) => b[1] - a[1]))));

// duplicated names (defined more than once = theme mirror or drift)
const dup = [...names.entries()].filter(([, v]) => v.length > 1);
console.log('  出现多于一次的令牌:', dup.length, '（暗色镜像属正常，列出仅供核查）');
for (const [k, v] of dup.slice(0, 8)) console.log('     ', k.padEnd(20), v.join('  |  ').slice(0, 90));

// ---------- 2. state colour tiers ----------
console.log('\n=== 2. 状态色档位（对齐 Trae status-* 的 default/active/surface/line）===');
for (const base of ['accent', 'ok', 'warn', 'danger']) {
  const hits = [...names.keys()].filter((k) => k === `--${base}` || k.startsWith(`--${base}-`));
  const tiers = hits.map((h) => (h === `--${base}` ? 'default' : h.slice(2 + base.length + 1))).sort();
  const want = ['default', 'hover', 'active', 'fg', 'soft', 'line'];
  console.log(`  --${base}`.padEnd(12), hits.length, '档:', tiers.join(',') || '(无)');
  console.log('       缺:', want.filter((t) => !tiers.includes(t)).join(',') || '（无缺）');
}

// ---------- 3. ladders ----------
console.log('\n=== 3. 层级梯子 ===');
for (const [label, re] of [
  ['border/control-line', /^--(border|control-line|hairline)/],
  ['shadow', /^--sh-/],
  ['radius', /^--r-/],
  ['selection alpha', /^--sel/],
  ['ring', /^--ring/],
  ['font size / line-height', /^--(fs|lh)-/],
  ['spacing', /^--sp-/],
  ['duration', /^--dur-/],
]) {
  const hits = [...names.entries()].filter(([k]) => re.test(k));
  console.log(' ', label.padEnd(24), hits.length, '条:', hits.map(([k, v]) => `${k}=${v}`).join('  ').slice(0, 240));
}
const radiusVals = new Map();
for (const [k, v] of names) if (/^--r-/.test(k)) for (const x of v) radiusVals.set(x, [...(radiusVals.get(x) || []), k]);
console.log('  圆角同值冗余:', [...radiusVals.entries()].filter(([, ks]) => ks.length > 1).map(([val, ks]) => `${val}→${ks.join('/')}`).join('  ') || '无');

// ---------- 4. component literal leak ----------
if (COMP) {
  console.log('\n=== 4. 组件内硬写颜色（令牌纪律核查）===');
  const files = [];
  (function walk(d, dep) {
    if (dep > 4) return;
    let e; try { e = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of e) { const p = join(d, x.name); if (x.isDirectory()) walk(p, dep + 1); else if (/\.(jsx|tsx|js|ts|css)$/.test(x.name)) files.push(p); }
  })(COMP, 0);
  let hex = 0, rgba = 0, hits = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    const h = s.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const r = s.match(/rgba?\([^)]*\)/g) || [];
    hex += h.length; rgba += r.length;
    if (h.length + r.length) hits.push(`${f.replace(COMP, '…')} hex=${h.length} rgba=${r.length} ${[...h, ...r].slice(0, 3).join(' ')}`);
  }
  console.log('  扫描文件:', files.length, ' 硬写 hex:', hex, ' 硬写 rgba():', rgba);
  for (const h of hits.slice(0, 12)) console.log('   ', h);
}

// ---------- 5. capability gaps ----------
console.log('\n=== 5. Trae 有 / 我们有无 ===');
for (const [label, probe] of [
  ['mask-image 渐变遮罩 (M7)', /mask-image/],
  ['-webkit-mask', /-webkit-mask/],
  ['场景 shadow 别名 (--shadow-menu 等)', /--shadow-(menu|modal|card|popover|tooltip)/],
  ['复合字体令牌 (font: 缩写)', /--(text|body|heading)-[a-z0-9-]*\s*:\s*[^;]*\d+px\s*\/\s*[\d.]+/],
  ['z 族命名', /--z-/],
]) console.log(' ', label.padEnd(38), probe.test(src) ? '有' : '无', '(命中', (src.match(new RegExp(probe.source, 'g')) || []).length, ')');

// ---------- 6. doc-vs-code drift on row height ----------
console.log('\n=== 6. 文档口径 vs 实现（行高/分隔线）===');
lines.forEach((l, i) => {
  if (/(38px|42px|44px|发丝线|无行分隔|row-h)/.test(l) && /^\s*(\/\*|\*|\/\/|--row-h|\.task-row|\s*height|\s*min-height)/.test(l)) {
    const t = l.trim().slice(0, 150);
    if (/row-h|task-row|38|42|44|发丝|分隔/.test(t)) console.log('  L' + (i + 1) + ':', t);
  }
});
console.log('\n（本脚本只读；未对 src 做任何写入。）');
