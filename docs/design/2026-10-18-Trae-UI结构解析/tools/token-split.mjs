#!/usr/bin/env node
/**
 * token-split.mjs — 把运行时 CSS 变量拆成「VS Code 血统」与「Trae 自研令牌」两层并归族。
 * 用法：node tools/token-split.mjs evidence/E30-*.tokens.json evidence/E40-*.tokens.json
 * 输出：extracted/token-families.json + 控制台摘要
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'extracted');
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: token-split.mjs <tokens.json>...'); process.exit(1); }

const FAMILIES = ['Spacer', 'Radius', 'heading', 'body', 'code', 'brand', 'bg', 'status', 'z', 'prop-color', 'shadow', 'border', 'font'];
function familyOf(name) {
  const bare = name.replace(/^--/, '');
  for (const f of FAMILIES) {
    if (bare.toLowerCase().startsWith(f.toLowerCase() + '-')) return f;
  }
  if (/^unset---/i.test(bare)) return '(unset 覆盖)';
  return '(其他自研)';
}

const result = {};
for (const f of files) {
  const p = resolve(process.cwd(), f);
  const t = JSON.parse(readFileSync(p, 'utf8'));
  const keys = Object.keys(t.vars || {});
  const vscode = keys.filter(k => k.startsWith('--vscode-'));
  const own = keys.filter(k => !k.startsWith('--vscode-'));
  const fam = {};
  for (const k of own) {
    const g = familyOf(k);
    (fam[g] ||= []).push({ name: k, value: t.vars[k] });
  }
  const groups = new Set(vscode.map(k => k.slice(9).split('-')[0]));
  result[basename(p)] = {
    total: keys.length, vscodeCount: vscode.length, ownCount: own.length,
    vscodeGroups: groups.size,
    ownFamilies: Object.fromEntries(Object.entries(fam).map(([k, v]) => [k, v.length])),
    ownDetail: fam,
    theme: t.theme || '', themeKind: t.themeKind || '',
  };
  const famLine = Object.entries(fam).sort((a, b) => b[1].length - a[1].length)
    .map(([k, v]) => `${k}=${v.length}`).join('  ');
  console.log(`\n== ${basename(p)}`);
  console.log(`   总计 ${keys.length}  =  VS Code ${vscode.length}（${groups.size} 个语义组） + Trae 自研 ${own.length}`);
  console.log(`   自研族: ${famLine}`);
  for (const g of ['Spacer', 'Radius', 'z', 'status', 'brand']) {
    if (fam[g]) console.log(`   ${g} 样例: ${fam[g].slice(0, 5).map(x => `${x.name.replace(/^--/, '')}=${x.value.slice(0, 22)}`).join(' , ')}`);
  }
  const fonts = new Set();
  for (const k of keys) { const v = t.vars[k]; const m = v.match(/'([^']*(?:Pro|Mono|Code|Sans|Hei|YaHei|CJK)[^']*)'/i); if (m) fonts.add(m[1]); }
  console.log(`   出现的字体族: ${[...fonts].slice(0, 8).join(' , ')}`);
}
writeFileSync(join(OUT, 'token-families.json'), JSON.stringify(result, null, 1));
console.log(`\n→ ${join(OUT, 'token-families.json').replace(process.cwd() + '\\', '')}`);
