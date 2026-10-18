#!/usr/bin/env node
/**
 * css-mine.mjs — 从明文 CSS 产物反查设计令牌与类名，并与 CDP 采到的运行时变量对账。
 *
 * 用法：
 *   node tools/css-mine.mjs <css路径>... [--runtime evidence/E30-project-trusted.tokens.json] [--top 40]
 *
 * 输出：extracted/<css文件名>.json + 控制台摘要
 * 注意：这是「静态可执行事实」，与截图冲突时以截图为准。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, basename, extname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'extracted');
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
// 位置参数里要剔掉选项的值（否则 --runtime 的 json 会被当成待挖掘 CSS）
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { i++; continue; }
  files.push(argv[i]);
}
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const TOP = Number(opt('top', 40));
const RUNTIME = opt('runtime', '');
if (!files.length) { console.error('usage: css-mine.mjs <css...> [--runtime tokens.json] [--top 40]'); process.exit(1); }

const KNOWN_PREFIX = ['icube', 'trae', 'aha', 'solo', 'cube', 'monaco', 'vscode', 'context-view', 'action', 'part', 'composite'];
const count = (map, k) => map.set(k, (map.get(k) || 0) + 1);

function mine(css) {
  const varDefs = new Map();      // 变量名 -> 出现次数
  const varValues = new Map();    // 变量名 -> 首个值
  for (const m of css.matchAll(/(--[A-Za-z][\w-]*)\s*:\s*([^;{}]+)/g)) {
    const [, name, raw] = m;
    count(varDefs, name);
    if (!varValues.has(name)) varValues.set(name, raw.trim().slice(0, 120));
  }
  const cls = new Map();
  for (const m of css.matchAll(/\.([A-Za-z_][\w-]*)/g)) count(cls, m[1]);
  const prefixes = new Map();   // 前缀 -> 去重类名数
  const prefixUses = new Map(); // 前缀 -> 总出现次数
  for (const [k, n] of cls) {
    const p = KNOWN_PREFIX.find(x => k === x || k.startsWith(x + '-')) || (k.includes('-') ? k.slice(0, k.indexOf('-')) : '(裸名)');
    prefixes.set(p, (prefixes.get(p) || 0) + 1);
    prefixUses.set(p, (prefixUses.get(p) || 0) + n);
  }
  const numDist = prop => {
    const dist = new Map();
    for (const m of css.matchAll(new RegExp('(?:[;{}]|^|\\s)' + prop + '\\s*:\\s*([^;{}]+)', 'g'))) {
      for (const v of m[1].split(/[\s,]+/)) { if (/^[0-9.]+(px|rem|em|%)$/.test(v)) count(dist, v); }
    }
    return [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  };
  const zDist = [...css.matchAll(/z-index\s*:\s*(-?\d+)/g)].map(m => Number(m[1]));
  const dur = new Map();
  for (const m of css.matchAll(/(?:transition|animation)-?[a-z-]*\s*:\s*([^;{}]+)/g)) {
    for (const v of m[1].matchAll(/\d+(?:\.\d+)?m?s\b/g)) count(dur, v[0]);
  }
  const famDist = new Map();
  for (const m of css.matchAll(/font-family\s*:\s*([^;{}]+)/g)) count(famDist, m[1].trim().slice(0, 90));
  const selParts = new Map();
  for (const m of css.matchAll(/\.part\.([A-Za-z][\w-]*)/g)) count(selParts, m[1]);
  return {
    bytes: css.length,
    lines: css.split('\n').length,
    rules: (css.match(/\{/g) || []).length,
    varDefs: [...varDefs.entries()].sort((a, b) => b[1] - a[1]),
    varValueOf: Object.fromEntries(varValues),
    classTop: [...cls.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP),
    classTotal: cls.size,
    prefixTotals: [...prefixes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)
      .map(([k, v]) => [k, v, prefixUses.get(k)]),
    fontSize: numDist('font-size'),
    radius: numDist('border-radius'),
    gap: numDist('gap'),
    zIndexTop: [...new Set(zDist)].sort((a, b) => b - a).slice(0, 12),
    transitionSamples: [...dur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    fontFamilies: [...famDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    layoutParts: [...selParts.entries()].sort((a, b) => b[1] - a[1]),
    atMedia: (css.match(/@media/g) || []).length,
    atKeyframes: [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]),
    shadowUses: (css.match(/box-shadow/g) || []).length,
  };
}

let runtimeVars = null;
const RT = resolve(process.cwd(), RUNTIME); // 用户传的路径按 cwd 解析，工具内文件才按 HERE 解析
if (RUNTIME && existsSync(RT)) {
  runtimeVars = Object.keys(JSON.parse(readFileSync(RT, 'utf8')).vars || {});
} else if (RUNTIME) {
  console.error('RUNTIME_NOT_FOUND: ' + RT);
}

for (const f of files) {
  const p = resolve(f);
  const r = mine(readFileSync(p, 'utf8'));
  r.source = basename(p);
  if (runtimeVars) {
    const staticSet = new Set(r.varDefs.map(x => x[0]));
    const rtSet = new Set(runtimeVars);
    r.reconcile = {
      runtimeCount: runtimeVars.length,
      staticCount: staticSet.size,
      runtimeOnly: runtimeVars.filter(v => !staticSet.has(v)).slice(0, 60),
      runtimeOnlyCount: runtimeVars.filter(v => !staticSet.has(v)).length,
      staticOnlyCount: [...staticSet].filter(v => !rtSet.has(v)).length,
      bothCount: [...staticSet].filter(v => rtSet.has(v)).length,
    };
  }
  const out = join(OUT, basename(p, extname(p)) + '.json');
  writeFileSync(out, JSON.stringify(r, null, 1));
  console.log(`\n=== ${r.source}  ${(r.bytes / 1048576).toFixed(2)}MB  ${r.rules} 个规则块 ===`);
  console.log(`变量定义: ${r.varDefs.length} 个名字 / 类名: ${r.classTotal} 个 / @media: ${r.atMedia} / 动画: ${r.atKeyframes.length} / box-shadow 用量: ${r.shadowUses}`);
  console.log(`前缀分布: ${r.prefixTotals.slice(0, 10).map(([k, u, n]) => `${k}=${u}名/${n}次`).join('  ')}`);
  console.log(`字号 Top: ${r.fontSize.slice(0, 8).map(([k, v]) => k + '×' + v).join('  ')}`);
  console.log(`圆角 Top: ${r.radius.slice(0, 8).map(([k, v]) => k + '×' + v).join('  ')}`);
  console.log(`z-index 峰值: ${r.zIndexTop.slice(0, 8).join(' ')}`);
  console.log(`布局 part: ${r.layoutParts.slice(0, 14).map(([k, v]) => k + '×' + v).join('  ')}`);
  console.log(`字体族: ${r.fontFamilies.slice(0, 3).map(([k, v]) => k.slice(0, 50) + '×' + v).join('  ||  ')}`);
  if (r.reconcile) console.log(`对账: 运行时 ${r.reconcile.runtimeCount} / 静态 ${r.reconcile.staticCount} / 两者都有 ${r.reconcile.bothCount} / 仅运行时 ${r.reconcile.runtimeOnlyCount} / 仅静态 ${r.reconcile.staticOnlyCount}`);
  console.log(`→ ${out.replace(process.cwd() + '/', '')}`);
}
