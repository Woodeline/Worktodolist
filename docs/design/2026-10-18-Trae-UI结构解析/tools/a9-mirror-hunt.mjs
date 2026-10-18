#!/usr/bin/env node
// a9-mirror-hunt.mjs — where does `--vscode-icube--<name>` come from?
//
// Question (report §9.2 / §13 A9): the workbench :root carries 107 mirror tokens
// (`--vscode-icube--bg-bg-*` etc). Are they
//   (a) build-time naming baked into shipped CSS + a theme color registry, or
//   (b) generated at runtime by string concatenation?
// This script greps the shipped bundles/JSON for the prefix, for concatenation
// sites, and for the bare colour-id form (`icube--bg-bg-...` without `--vscode-`),
// which is what a theme contribution would contain.
//
// Usage: node tools/a9-mirror-hunt.mjs "<Trae resources/app dir>" [--scan-dirs]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(process.argv[2] || '.');
const SCAN = process.argv.includes('--scan-dirs');
const PREFIX = '--vscode-icube--';
const BARE = 'icube--';

const CONCAT_PROBES = [
  '"--vscode-icube--" +', '"--vscode-icube--"+', "'--vscode-icube--' +", "'--vscode-icube--'+",
  '`--vscode-icube--${', '"--vscode-" + "', "'--vscode-' + '", '"vscode-icube--" +',
  '"icube--" +', "'icube--' +", '`--vscode-icube--${', '"-icube--"', "'-icube--'",
  'PREFIX +', '"--vscode-"+"',
];

function count(hay, needle) { let c = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { c++; i += needle.length; } return c; }
function contexts(hay, needle, max = 4, pad = 130) {
  const out = []; let i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0 && out.length < max) { out.push(hay.slice(Math.max(0, i - 60), i + pad).replace(/\s+/g, ' ')); i += needle.length; }
  return out;
}
function walk(dir, depth = 0, cb) {
  if (depth > 6) return;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1, cb);
    else cb(p);
  }
}

console.log('APP =', APP);

// ---- 1. the three main bundles ----
const bundles = [
  'out/vs/workbench/workbench.desktop.main.js',
  'out/vs/workbench/workbench.desktop.main.css',
  'out/vs/workbench/workbench.desktop.main.solo-lite.js',
  'out/vs/workbench/workbench.desktop.main.solo-lite.css',
  'out/vs/workbench/workbench.desktop.main.solo-lite-slim.js',
  'out/vs/workbench/workbench.desktop.main.solo-lite-slim.css',
];
for (const rel of bundles) {
  const p = join(APP, rel);
  let s; try { s = readFileSync(p, 'latin1'); } catch { console.log('MISSING', rel); continue; }
  console.log('\n###', rel, '(' + (s.length / 1048576).toFixed(1) + 'MB)');
  console.log('  前缀命中 :', count(s, PREFIX));
  console.log('  裸 icube--:', count(s, BARE), ' 其中带 --vscode- 的:', count(s, '--vscode-' + BARE.replace('-', '')) , '(reference only)');
  // definitions vs consumers
  const defRe = /--vscode-icube--[a-zA-Z0-9-]+\s*:/g;
  const defs = s.match(defRe);
  console.log('  作为定义出现 (name:) :', defs ? defs.length : 0, defs ? defs.slice(0, 5).join(' , ') : '');
  const useRe = /var\(--vscode-icube--[a-zA-Z0-9-]+\)/g;
  const uses = s.match(useRe);
  console.log('  作为 var() 消费出现 :', uses ? uses.length : 0);
  const uniq = uses ? [...new Set(uses)] : [];
  console.log('  去重后被消费的镜像令牌数:', uniq.length, uniq.slice(0, 8).join(' '));
  for (const probe of CONCAT_PROBES) { const c = count(s, probe); if (c) console.log('  !! 拼接式出现:', JSON.stringify(probe), 'x' + c, contexts(s, probe, 2)); }
}

// ---- 3. --verify <tokens.json>: does static forensics fully explain the runtime mirror set? ----
const vi = process.argv.indexOf('--verify');
if (vi > 0 && process.argv[vi + 1]) {
  const snapFile = resolve(process.argv[vi + 1]);
  const JS = join(APP, 'out/vs/workbench/workbench.desktop.main.js');
  const s = readFileSync(JS, 'latin1');
  const registered = new Set([...s.matchAll(/[\w$.]+\("(icube--[A-Za-z0-9_-]+)"/g)].map((m) => '--vscode-' + m[1]));
  const literal = new Set([...s.matchAll(/(--vscode-icube--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const vars = JSON.parse(readFileSync(snapFile, 'utf8')).vars;
  const snapshot = new Set(Object.keys(vars).filter((k) => /^--vscode-icube--/.test(k)));
  const union = new Set([...registered, ...literal]);
  const fam = {};
  for (const r of registered) { const k = r.replace('--vscode-icube--', '').split('-')[0]; fam[k] = (fam[k] || 0) + 1; }
  console.log('\n### VERIFY', snapFile.replace(/.*\\/,''));
  console.log('  静态：注册式 id =', registered.size, ' 字面量定义 =', literal.size, ' 并集 =', union.size);
  console.log('  运行时快照镜像令牌数 =', snapshot.size);
  console.log('  注册家族分布 :', JSON.stringify(fam));
  const unexplained = [...snapshot].filter((k) => !union.has(k));
  const notInSnapshot = [...union].filter((k) => !snapshot.has(k));
  console.log('  快照有但静态解释不了 :', unexplained.length, unexplained.slice(0, 12).join(' '));
  console.log('  静态有但快照没有     :', notInSnapshot.length, notInSnapshot.slice(0, 12).join(' '));
  console.log('  覆盖率 :', (100 * (snapshot.size - unexplained.length) / snapshot.size).toFixed(1) + '%');

  // bare-name layer: is `--bg-bg-card` (SOLO) also registry-driven?
  for (const rel of ['out/vs/workbench/workbench.desktop.main.solo-lite.js', 'out/vs/code/electron-browser/solo/solo-lite.html']) {
    const p = join(APP, rel); let t; try { t = readFileSync(p, 'latin1'); } catch { continue; }
    console.log('\n  ###', rel, '(' + (t.length / 1048576).toFixed(1) + 'MB)');
    for (const probe of ['"bg-bg-card', '--bg-bg-card', 'setProperty', 'icube--bg-bg-card', 'createElement("style")']) {
      console.log('     ', JSON.stringify(probe).padEnd(24), count(t, probe));
    }
    const c = contexts(t, '"bg-bg-card', 2, 110); for (const x of c) console.log('        …' + x + '…');
  }
}

// ---- 4. --copies: how many shipped copies of the BARE token family exist, and do they agree? ----
// For one token name, print every `name: value` definition found per file (with the
// theme hook that carries it). Two copies of one family with different values = drift.
if (process.argv.includes('--copies')) {
  const token = process.argv[process.argv.indexOf('--copies') + 1] || '--bg-bg-base-secondary';
  const files = [];
  walk(APP, 0, (p) => { if (/\.(css|mjs|js)$/i.test(p)) files.push(p); });
  let n = 0;
  for (const p of files) {
    let s; try { s = readFileSync(p, 'latin1'); } catch { continue; }
    if (!s.includes(token)) continue;
    const defs = [...s.matchAll(new RegExp(token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:\\s*([^;}]+)', 'g'))];
    if (!defs.length) continue;
    n++;
    const byValue = new Map();
    for (const d of defs) { const v = d[1].trim(); byValue.set(v, (byValue.get(v) || 0) + 1); }
    // grab the selector immediately preceding each definition block, best effort
    const hooks = [];
    for (const m of s.matchAll(new RegExp('([^{}]{0,140})\\{[^{}]*' + token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + ':', 'g'))) {
      hooks.push(m[1].replace(/\s+/g, ' ').slice(-90));
    }
    console.log('\n###', p.replace(APP, 'APP'), '定义点=' + defs.length);
    for (const [v, c] of byValue) console.log('     ', v.padEnd(16), 'x' + c);
    for (const h of [...new Set(hooks)].slice(0, 6)) console.log('        钩子:', h);
  }
  console.log('\n含该令牌定义的文件数 =', n, '(令牌', token + ')');
}

// ---- 2. any concatenation anywhere in JS under out/ ----
if (SCAN) {
  console.log('\n### 扫全部 out/ 找拼接点与主题贡献');
  const hits = [];
  walk(APP, 0, (p) => {
    if (!/\.(js|json|css)$/i.test(p)) return;
    let st; try { st = statSync(p); } catch { return; }
    if (st.size > 60 * 1048576) return;
    const s = readFileSync(p, 'latin1');
    if (!s.includes(BARE)) return;
    const concat = CONCAT_PROBES.filter((pr) => s.includes(pr));
    const defLike = (s.match(/"?--?vscode-?icube--[a-zA-Z0-9-]+"?\s*:/g) || []).length;
    const bareId = (s.match(/"icube--[a-zA-Z0-9-]+"/g) || []).length;
    hits.push({ p: p.replace(APP, 'APP'), size: st.size, n: count(s, BARE), concat, defLike, bareId, sample: contexts(s, BARE, 1, 90)[0] || '' });
  });
  hits.sort((a, b) => b.n - a.n);
  for (const h of hits.slice(0, 25)) console.log(`  ${h.p}  size=${(h.size / 1024).toFixed(0)}KB  'icube--'=${h.n}  定义式=${h.defLike}  带引号裸id=${h.bareId}  拼接=${h.concat.length ? h.concat.join(',') : '无'}\n      ${h.sample}`);
  console.log('\n  含 icube-- 的文件总数:', hits.length);
}
