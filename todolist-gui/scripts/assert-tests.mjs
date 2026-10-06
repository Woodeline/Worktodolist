#!/usr/bin/env node
/**
 * 测试完整性守卫 —— 防止「静默丢掉测试文件」被当成绿色通过。
 *
 * 背景（真实事故）：vitest 写 %TEMP% 下的 SSR 缓存时偶发 EPERM，
 * 抛未处理异常，把那个 worker 里的整个测试文件丢掉；其余文件照常跑完，
 * 汇总只显示「N passed」—— 例如 6 个文件里 todoParser.test.js（26 个用例）
 * 直接消失、总数从 95 变 69，但没有任何一处报错。
 * 这种"假绿"会掩盖真实回归，所以加一层独立校验。
 *
 * 做法：以磁盘上的 *.test.js 数量为基准，跑一遍 vitest 的 JSON reporter，
 * 比对实际参与的文件数/用例数；不足即失败退出。
 *
 * 用法：node scripts/assert-tests.mjs
 *   （package.json 里映射为 npm run test:guard）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const srcDir = path.join(root, 'src');
const tmpDir = path.join(root, '.tmp');
const reportFile = path.join(tmpDir, 'vitest-report.json');

function collectTestFiles(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectTestFiles(full, acc);
    } else if (/\.test\.jsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const rel = (p) => path.relative(root, p).split(path.sep).join('/');

const onDisk = collectTestFiles(srcDir).map(rel).sort();
if (onDisk.length === 0) {
  console.error('[guard] 没在 src/ 下找到任何 *.test.js，先确认项目结构。');
  process.exit(1);
}

fs.mkdirSync(tmpDir, { recursive: true });
const vitestEntry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');

const run = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--reporter=json', '--outputFile=' + reportFile],
  { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
);

const stdout = run.stdout || '';
const stderr = run.stderr || '';
const combined = stdout + '\n' + stderr;

if (!fs.existsSync(reportFile)) {
  console.error('[guard] vitest 没有产出 JSON 报告，测试进程可能整体崩了。');
  console.error(combined.trim());
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
} catch (err) {
  console.error('[guard] JSON 报告解析失败：' + err.message);
  process.exit(1);
}

const ran = (report.testResults || []).map((t) => rel(t.name)).sort();
const ranSet = new Set(ran);
const missing = onDisk.filter((f) => !ranSet.has(f));
const extra = ran.filter((f) => !onDisk.includes(f));

const totalTests = report.numTotalTests || 0;
const failedTests = (report.numFailedTests || 0) + (report.numFailedTestSuites || 0);

const unhandled = /Unhandled Error/i.test(combined);
const ephem = /EPERM/i.test(combined);

console.log('[guard] 磁盘测试文件 : ' + onDisk.length + ' 个');
console.log('[guard] 实际参与    : ' + ran.length + ' 个 / ' + totalTests + ' 个用例');
console.log('[guard] 退出码      : ' + run.status);
if (ephem) console.log('[guard] 注意        : 输出里出现 EPERM（本机 %TEMP% 写入偶发被拒）');
if (unhandled) console.log('[guard] 注意        : 出现 Unhandled Error');

let bad = false;

if (run.status !== 0) {
  console.error('[guard] ✗ vitest 退出码非 0');
  bad = true;
}
if (failedTests > 0) {
  console.error('[guard] ✗ 有 ' + failedTests + ' 个失败');
  bad = true;
}
if (missing.length) {
  console.error('[guard] ✗ 这些测试文件没被跑到（静默丢失）：');
  for (const f of missing) console.error('        - ' + f);
  bad = true;
}
if (extra.length) {
  console.error('[guard] ✗ 出现了预期外的测试文件：' + extra.join(', '));
  bad = true;
}
if (unhandled) {
  console.error('[guard] ✗ 存在 Unhandled Error —— 即使全部用例"通过"也不可信');
  bad = true;
}

if (bad) {
  console.error('');
  console.error('[guard] 结果：不通过。重跑一次通常能恢复（EPERM 是偶发的），');
  console.error('        但若反复出现，必须查清而不是忽略。');
  process.exit(1);
}

console.log('[guard] ✓ 完整性校验通过：' + onDisk.length + ' 个文件 / ' + totalTests + ' 个用例，全部跑到且全部通过');
process.exit(0);
