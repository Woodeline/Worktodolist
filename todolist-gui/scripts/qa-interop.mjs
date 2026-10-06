// QA 互操作复验（真实 todo.txt / done.txt 全程只读，仅操作 .qa-tmp 副本）。
// 用法（topydo 由外层 bash 调用，避免 Node 在沙箱内 spawn 被拦）：
//   node scripts/qa-interop.mjs prepare                 # 生成 GUI 序列化行并写入 .qa-tmp/todo.txt
//   (bash) topydo -t .qa-tmp/todo.txt -d .qa-tmp/done.txt ls   > .qa-tmp/ls1.txt
//   (bash) topydo -t ... add '(B) 从命令行添加的任务 @cli +集成 due:2026-12-01'
//   (bash) topydo -t ... ls > .qa-tmp/ls2.txt
//   node scripts/qa-interop.mjs verify                  # 读回 ls1/ls2/todo.txt 做断言
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseFile, serializeEntries, serializeTask, taskFromQuickInput } from '../src/lib/todoParser.js';

const DIR = 'C:/Users/王佐成/WorkBuddy/todolist';
const TMP = `${DIR}/.qa-tmp`;
const today = '2026-09-30';
const SAMPLES = ['复核季报 (A) due:2026-10-15 @财务 +季报', '写方案 @工作 due:2026-11-01', '无标记的裸任务', '内联星标 (C) star:1'];
const generated = SAMPLES.map((s) => taskFromQuickInput(s, today));

const mode = process.argv[2];
let failed = 0;
const ok = (name, cond, detail = '') => { if (!cond) failed += 1; console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`); };

if (mode === 'prepare') {
  const base = parseFile(readFileSync(`${TMP}/todo.txt`, 'utf8'));
  writeFileSync(`${TMP}/todo.txt`, serializeEntries([...base, ...generated]), 'utf8');
  console.log('GUI 生成行：');
  generated.forEach((t) => console.log('  ' + serializeTask(t)));
} else if (mode === 'verify') {
  const ls1 = existsSync(`${TMP}/ls1.txt`) ? readFileSync(`${TMP}/ls1.txt`, 'utf8') : '';
  const ls2 = existsSync(`${TMP}/ls2.txt`) ? readFileSync(`${TMP}/ls2.txt`, 'utf8') : '';
  console.log('--- topydo ls1（GUI 追加后）---\n' + ls1);
  for (const t of generated) ok(`topydo ls 识别 GUI 生成行：${t.title}`, ls1.includes(t.title));
  ok('topydo 识别优先级 (A)/(C) 与 due', /\(A\)/.test(ls1) && /\(C\)/.test(ls1) && ls1.includes('2026-10-15'));

  const tempText = readFileSync(`${TMP}/todo.txt`, 'utf8');
  const addedLine = tempText.split('\n').find((l) => l.includes('从命令行添加的任务'));
  console.log('--- topydo add 写入行 ---\n' + (addedLine || '(未找到)'));
  const parsed = parseFile(tempText).find((e) => e.kind === 'task' && e.title === '从命令行添加的任务');
  ok('解析器读到 topydo 新增任务', Boolean(parsed));
  if (parsed) {
    ok('  优先级=B', parsed.priority === 'B', `got ${parsed.priority}`);
    ok('  有自动创建日期', /^\d{4}-\d{2}-\d{2}$/.test(parsed.createdAt || ''), `got ${parsed.createdAt}`);
    ok('  dueDate=2026-12-01', parsed.dueDate === '2026-12-01', `got ${parsed.dueDate}`);
    ok('  @cli 归类', parsed.contexts.includes('cli'), parsed.contexts.join(','));
    ok('  +集成 归类', parsed.projects.includes('集成'), parsed.projects.join(','));
  }
  ok('二次 ls 仍含 GUI 生成行', generated.every((t) => ls2.includes(t.title)));
  console.log(`\n互操作汇总：${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
  process.exitCode = failed === 0 ? 0 : 1;
} else {
  console.log('用法: node scripts/qa-interop.mjs prepare|verify');
  process.exitCode = 1;
}
