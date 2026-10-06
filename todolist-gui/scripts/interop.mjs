// topydo 互操作验证脚本（开发期工具，不参与构建）
// 用法：
//   node scripts/interop.mjs add "任务文本"      # 以 GUI 序列化规则追加一条活跃任务
//   node scripts/interop.mjs verify              # 解析 todo.txt / done.txt 并打印字段
//   node scripts/interop.mjs revert-last-done    # 模拟 GUI 撤销：把 done.txt 最后一条移回 todo.txt
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import dayjs from 'dayjs';
import { parseFile, reviveTask, serializeEntries, serializeTask, taskFromQuickInput } from '../src/lib/todoParser.js';

const DIR = 'C:/Users/王佐成/WorkBuddy/todolist';
const TODO_PATH = `${DIR}/todo.txt`;
const DONE_PATH = `${DIR}/done.txt`;

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const write = (p, text) => writeFileSync(p, text, 'utf8');
// 取本地日历日，绝不能用 new Date().toISOString().slice(0,10)：toISOString 是 UTC，
// 在 UTC+8 的 00:00–08:00 会给出「昨天」，而这个日期会被 taskFromQuickInput 写进
// 用户真实的 todo.txt —— 该时段加任务创建日期就错了。
// 与 src/lib/eventLog.js 的 tsToDate() 同一口径：统一按本地日期归档。
const today = dayjs().format('YYYY-MM-DD');

const cmd = process.argv[2];

if (cmd === 'add') {
  const text = process.argv.slice(3).join(' ');
  const entries = parseFile(read(TODO_PATH));
  const task = taskFromQuickInput(text, today);
  entries.push(task);
  write(TODO_PATH, serializeEntries(entries));
  console.log('added line:', serializeTask(task));
} else if (cmd === 'verify') {
  const todo = parseFile(read(TODO_PATH));
  const done = parseFile(read(DONE_PATH));
  const count = (entries) => entries.filter((e) => e.kind === 'task').length;
  console.log(`todo.txt: ${count(todo)} 条任务 / ${todo.length} 行条目`);
  for (const e of todo) {
    console.log('  -', e.kind === 'task' ? serializeTask(e) : `[${e.kind}] ${e.raw}`);
  }
  console.log(`done.txt: ${count(done)} 条已完成 / ${done.length} 行条目`);
  for (const e of done) {
    console.log('  -', e.kind === 'task' ? serializeTask(e) : `[${e.kind}] ${e.raw}`);
  }
} else if (cmd === 'revert-last-done') {
  const done = parseFile(read(DONE_PATH));
  const taskIdx = done.map((e) => e.kind === 'task');
  const lastIdx = taskIdx.lastIndexOf(true);
  if (lastIdx === -1) {
    console.error('done.txt 中没有可撤销的任务');
    process.exit(1);
  }
  const revived = reviveTask(done[lastIdx]);
  const nextDone = done.filter((_, i) => i !== lastIdx);
  const todo = parseFile(read(TODO_PATH));
  todo.push(revived);
  write(TODO_PATH, serializeEntries(todo));
  write(DONE_PATH, serializeEntries(nextDone));
  console.log('revived line:', serializeTask(revived));
} else {
  console.log('用法: node scripts/interop.mjs add|verify|revert-last-done');
  process.exit(1);
}
