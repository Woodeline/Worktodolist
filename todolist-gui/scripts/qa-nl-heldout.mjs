// 自然语言识别「长尾考卷」 batteries 的总入口。
//
// 背景：这套考卷按项目评测纪律一轮轮累积 —— 每一轮的用例都写于上一轮补齐之后、
// 未参与任何词表/裁决调参，所以每轮首跑的数字才是当时的泛化水平；一旦动手补齐，
// 该轮就退化为「照着规则写的考卷」，此后的满分只证明规则没写坏。
// 各轮文件头都已冻结各自的首跑成绩，禁止回填。
//
// 分工：
//   round-01 ~ 06  探针（能力摸底，恒退出 0，不当门禁用）
//   round-07 ~ 08  硬门（失败即退出 1 —— 它们是当前基线的回归门）
//
// 用法：
//   node scripts/qa-nl-heldout.mjs              # 跑全部八轮，汇总表收尾
//   node scripts/qa-nl-heldout.mjs --round 8    # 只跑第八轮
//   node scripts/qa-nl-heldout.mjs --verbose    # 透传每轮的完整输出
// 退出码：任一硬门轮次未过 → 1，否则 0。

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELD = path.join(HERE, 'heldout');

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const roundArg = argv.indexOf('--round');
const only = roundArg >= 0 && argv[roundArg + 1] ? argv[roundArg + 1] : null;

// 硬门轮次：未过会让整条命令非零退出。新增硬门时在这里登记。
const GATE = new Set(['round-07.mjs', 'round-08.mjs']);

const files = readdirSync(HELD)
  .filter((f) => /^round-\d{2}\.mjs$/.test(f))
  .sort();
if (!files.length) {
  console.error('[nl-heldout] heldout/ 下没有任何 round-*.mjs');
  process.exit(2);
}

const rows = [];
let gateFailed = false;

for (const f of files) {
  if (only && f !== `round-${String(Number(only)).padStart(2, '0')}.mjs`) continue;
  const r = spawnSync(
    process.execPath,
    [path.join(HELD, f), ...(verbose ? ['--verbose'] : [])],
    { encoding: 'utf8', timeout: 120000 },
  );
  const out = ((r.stdout || '') + (r.stderr || '')).trimEnd();
  const ok = r.status === 0;
  const isGate = GATE.has(f);
  if (!ok && isGate) gateFailed = true;
  rows.push({ f, ok, isGate });
  console.log(`\n── ${f} ${ok ? 'PASS' : `FAIL(status=${r.status})`}${isGate ? ' [硬门]' : ' [探针]'}`);
  if (verbose) {
    if (out) console.log(out);
  } else {
    const tail = out.split('\n').filter((l) => l.trim()).slice(-2);
    if (tail.length) console.log(tail.map((l) => `   ${l}`).join('\n'));
  }
}

console.log('\n' + '─'.repeat(64));
for (const r of rows) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.f}  ${r.ok ? 'PASS' : 'FAIL'}  ${r.isGate ? '硬门' : '探针'}`);
}
console.log('─'.repeat(64));
const gates = rows.filter((r) => r.isGate);
const probes = rows.filter((r) => !r.isGate);
console.log(`  硬门 ${gates.filter((r) => r.ok).length}/${gates.length} · 探针 ${probes.filter((r) => r.ok).length}/${probes.length}`);
console.log(`[nl-heldout] ${gateFailed ? '有硬门未过' : '全部通过'}（${rows.length} 轮）\n`);
process.exit(gateFailed ? 1 : 0);
