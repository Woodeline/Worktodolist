// QA 独立验证脚本（由严过关编写，不依赖工程师范刚的测试用例）
// 运行：node --import ./scripts/register-qa-loader.mjs ./scripts/qa-independent.mjs
//
// 三个部分：
//   A. 对真实 todoParser.js 做往返等价 + 畸形输入攻击
//   B. 对真实 sortFilter.js 做边界/稳定性/安全性攻击
//   C. 通过极简 React hooks 替身驱动【真实未改动的 useTodoStore.js】，攻击撤销链路

import { existsSync, readFileSync } from 'node:fs';
import { parseFile, serializeEntries, serializeTask, parseSingleLine } from '../src/lib/todoParser.js';
import { compareAuto, searchMatch, sortTasks, todayGroups } from '../src/lib/sortFilter.js';

const DIR = 'C:/Users/王佐成/WorkBuddy/todolist';
const results = [];
let failures = 0;
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── A. 真实数据往返等价 ─────────────────────────
console.log('\n=== A. todoParser 真实数据往返等价 ===');
const TODO_REAL = readFileSync(`${DIR}/todo.txt`, 'utf8');
const DONE_REAL = readFileSync(`${DIR}/done.txt`, 'utf8');

const SEMANTIC = [
  'kind', 'completed', 'completedAt', 'createdAt', 'priority', 'title',
  'contexts', 'projects', 'dueDate', 'thresholdDate', 'starValue', 'extraTags',
];
const semantic = (t) => Object.fromEntries(SEMANTIC.map((k) => [k, t[k]]));

for (const [label, rawText] of [['todo.txt', TODO_REAL], ['done.txt', DONE_REAL]]) {
  const entries = parseFile(rawText);
  const serialized = serializeEntries(entries);
  const reparsed = parseFile(serialized);
  const sameCount = entries.length === reparsed.length;
  const fieldsEqual = sameCount && entries.every((e, i) => JSON.stringify(semantic(e)) === JSON.stringify(semantic(reparsed[i])));
  check(`[${label}] parse→serialize→parse 条目数不变 (${entries.length})`, sameCount);
  check(`[${label}] parse→serialize→parse 字段级语义等价`, fieldsEqual);

  // 逐行对照：原始非空行与序列化输出应逐字节一致（该数据集为规范行）
  const origLines = rawText.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const outLines = serialized.split('\n').filter((l) => l !== '');
  const byteEqual = origLines.length === outLines.length && origLines.every((l, i) => l === outLines[i]);
  check(`[${label}] 序列化输出与原始行逐字节一致`, byteEqual,
    byteEqual ? '' : `orig=${JSON.stringify(origLines)} out=${JSON.stringify(outLines)}`);
}

// ───────────────────────── A2. 畸形输入攻击 ─────────────────────────
console.log('\n=== A2. 畸形输入（不崩/不丢字符/无异常字段） ===');
const MALFORMED = [
  { name: '空行 ""', line: '' },
  { name: '纯空白 "   "', line: '   ' },
  { name: '注释 "# 注释"', line: '# 注释' },
  { name: '仅完成标记 "x"', line: 'x' },
  { name: '仅优先级 "(A)"', line: '(A)' },
  { name: '完成无内容 "x 2026-09-30"', line: 'x 2026-09-30' },
  { name: '仅日期 "2026-09-30"', line: '2026-09-30' },
  { name: '超长行(20000 字符)', line: `${'甲'.repeat(20000)} 尾部` },
  { name: 'emoji 行', line: '2026-09-20 修复🎉登录 +核心 @后端 due:2026-10-01' },
  { name: '制表符行', line: '2026-09-20\t制表符任务' },
  { name: 'CRLF 行(经 parseFile)', line: '2026-09-20 第一行\r\n2026-09-21 第二行', viaFile: true },
  { name: 'BOM 行(经 parseFile)', line: '\uFEFF2026-09-20 带BOM', viaFile: true },
  { name: '只有 @分类 "@工作"', line: '@工作' },
  { name: '只有 +项目 "+项目"', line: '+项目' },
  { name: '纯标签 "due:2026-10-01"', line: 'due:2026-10-01' },
  { name: '反斜杠与引号', line: '2026-09-20 C:\\path "引号" \'单引号\'' },
];

for (const c of MALFORMED) {
  let error = null;
  let entries = null;
  try {
    if (c.viaFile) {
      entries = parseFile(c.line);
    } else {
      entries = [parseSingleLine(c.line)];
    }
  } catch (e) {
    error = e;
  }
  if (error) {
    check(`[畸形] ${c.name} 不抛异常`, false, `抛出 ${error.message}`);
    continue;
  }
  // 序列化不崩
  let serError = null;
  try {
    serializeEntries(entries);
  } catch (e) {
    serError = e;
  }
  // 字段健全性
  const fieldOk = entries.every(
    (e) =>
      typeof e.id === 'string' &&
      typeof e.raw === 'string' &&
      (e.kind !== 'task' || (Array.isArray(e.extraTags) && Array.isArray(e.contexts) && Array.isArray(e.projects)))
  );
  check(`[畸形] ${c.name} 不抛异常且序列化成功`, !serError && fieldOk,
    serError ? `序列化抛 ${serError.message}` : `→ kind=${entries.map((e) => e.kind).join(',')}`);
}

// 规范行"零字符损失"：serialize(parse(line)) === line
console.log('\n=== A3. 规范行零字符损失 ===');
const CANONICAL = [
  '(A) 2026-09-20 逾期任务：季报复核 due:2026-09-25',
  '(B) 2026-09-20 今天到期：写第 10 周回测报告 due:2026-09-30',
  'x 2026-09-28 2026-09-27 (A) 已完成的示例：安装 topydo 并跑通三种 UI',
  '2026-09-30 带上下文的任务 @工作 +量化 due:2026-10-08',
  '(D) 2026-09-20 星标任务 star:1',
  '(E) 2026-09-20 未来才开始的任务 t:2026-10-05',
  '2026-09-20 调研 effort:2h owner:alex',
  '(B) 2026-09-20 星标🌟任务 +项目',
];
for (const line of CANONICAL) {
  const out = serializeTask(parseSingleLine(line));
  check(`[零损失] ${line.slice(0, 24)}…`, out === line, out === line ? '' : `got ${JSON.stringify(out)}`);
}

// 制表符/CRLF 归一化观察（非致命）
const tabOut = serializeTask(parseSingleLine('2026-09-20\t制表符任务'));
check('[观察] 制表符被归一化为空格（语义等价，非字节等价）', tabOut === '2026-09-20 制表符任务', `got ${JSON.stringify(tabOut)}`);

// ───────────────────────── B. sortFilter 边界攻击 ─────────────────────────
console.log('\n=== B. sortFilter 边界与安全 ===');
const mk = (o) => ({
  id: o.title, kind: 'task', raw: o.title, completed: false, completedAt: null,
  createdAt: null, priority: null, title: '', contexts: [], projects: [],
  dueDate: null, thresholdDate: null, starValue: null, extraTags: [], ...o,
});

// 稳定性：全 null 键，排序后应保持输入顺序
{
  const list = [mk({ title: 'a' }), mk({ title: 'b' }), mk({ title: 'c' }), mk({ title: 'd' })];
  const sorted = sortTasks(list, 'auto').map((t) => t.title);
  check('[稳定] compareAuto 全 null 键保持稳定（不重排）', JSON.stringify(sorted) === JSON.stringify(['a', 'b', 'c', 'd']), sorted.join(','));
}
// 优先级 null vs 字母，due null vs 日期 组合
{
  const list = [
    mk({ title: 'pB-null' , priority: 'B' }),
    mk({ title: 'pnull-due', priority: null, dueDate: '2026-10-01' }),
    mk({ title: 'pA-null', priority: 'A' }),
    mk({ title: 'pnull-null', priority: null }),
    mk({ title: 'pA-due', priority: 'A', dueDate: '2026-10-01' }),
  ];
  const sorted = sortTasks(list, 'auto').map((t) => t.title);
  // 期望：A 组在前（A 有 due 先于 A 无 due），B 其次，null 组最后，null 组内有 due 先于无 due
  const ok = sorted[0] === 'pA-due' && sorted[1] === 'pA-null' && sorted[2] === 'pB-null'
    && sorted[3] === 'pnull-due' && sorted[4] === 'pnull-null';
  check('[排序] priority/due 为 null 的组合有序且确定', ok, sorted.join(','));
}
// searchMatch 正则特殊字符安全
{
  const t = mk({ title: '写报告', raw: '写报告 @工作 (A)' });
  let threw = null;
  const queries = ['.*', '(', ')', '[', ']', '\\', '?', '+', '*', '^', '$', '|', '{2,3}'];
  try { queries.forEach((q) => searchMatch(t, q)); } catch (e) { threw = e; }
  check('[安全] searchMatch 正则特殊字符不抛异常', !threw, threw ? threw.message : '');
  check('[安全] searchMatch 大小写不敏感(中文/英文混合)',
    searchMatch(mk({ title: 'Write Report 报告', raw: '' }), 'write report') && searchMatch(mk({ title: '报告', raw: '' }), '报告'));
  check('[安全] searchMatch 空查询返回全部', searchMatch(t, '') === true);
}
// todayGroups 归组
{
  const groups = todayGroups(
    [mk({ title: '逾期', dueDate: '2026-09-25' }), mk({ title: '今日', dueDate: '2026-09-30' }), mk({ title: '无日期' })],
    '2026-09-30'
  );
  check('[分组] todayGroups 无 dueDate → noDate',
    groups.noDate.map((t) => t.title).join(',') === '无日期' &&
    groups.overdue.map((t) => t.title).join(',') === '逾期' &&
    groups.dueToday.map((t) => t.title).join(',') === '今日');
  // 观察：未来到期任务会被塞进 noDate（函数命名语义应为"未来"）
  const future = todayGroups([mk({ title: '未来', dueDate: '2026-12-31' })], '2026-09-30');
  check('[观察] todayGroups 未来到期任务被归入 noDate（命名/语义观察点）', future.noDate.length === 1, `overdue=${future.overdue.length} dueToday=${future.dueToday.length} noDate=${future.noDate.length}`);
}

// ───────────────────────── C. useTodoStore 撤销链路 ─────────────────────────
console.log('\n=== C. useTodoStore 撤销链路（真实 hook + hooks 替身） ===');

// ---- 浏览器环境替身 ----
function installBrowserStubs(seed) {
  const fs = { ...seed };
  const makeFileHandle = (name, map) => ({
    async getFile() { return { async text() { return map[name] ?? ''; } }; },
    async createWritable() { return { async write(t) { map[name] = t; }, async close() {} }; },
  });
  const makeDir = (map) => ({
    async getFileHandle(name, opt) {
      if (!(name in map)) {
        if (opt && opt.create) map[name] = '';
        else { const e = new Error('NotFound'); e.name = 'NotFoundError'; throw e; }
      }
      return makeFileHandle(name, map);
    },
    async getDirectoryHandle(name, opt) {
      if (!(name in map) && !(opt && opt.create)) { const e = new Error('NotFound'); e.name = 'NotFoundError'; throw e; }
      if (!(name in map)) map[name] = '__dir__';
      return makeDir({});
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async *entries() {},
  });
  const dir = makeDir(fs);
  globalThis.window = {
    showDirectoryPicker: async () => dir,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.indexedDB = {
    open() {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      req.result = {
        objectStoreNames: { contains: () => true },
        close() {},
        transaction() {
          const store = { put: () => ({ result: undefined }), get: () => ({ result: null }), delete: () => ({ result: undefined }) };
          const tx = { objectStore: () => store, oncomplete: null, onerror: null, onabort: null };
          setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
          return tx;
        },
      };
      setTimeout(() => { if (req.onupgradeneeded) req.onupgradeneeded(); if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    },
  };
  return fs;
}

const { __beginRender, __flushEffects, __resetHooks } = await import('./qa-react-shim.mjs');
const { useTodoStore } = await import('../src/hooks/useTodoStore.js');

const SEED = {
  'todo.txt': '(A) 2026-09-01 任务A\n(B) 2026-09-01 任务B\n(C) 2026-09-01 任务C\n',
  'done.txt': '',
};

async function bootStore() {
  __resetHooks();
  installBrowserStubs(SEED);
  const render = () => { __beginRender(); const api = useTodoStore(); __flushEffects(); return api; };
  let store = render();
  await store.pickDirectory();
  await sleep(5);
  store = render();
  return { store, render };
}

// Scenario 1：完成 → 180ms 内立刻撤销
{
  const { store, render } = await bootStore();
  const a = store.todoEntries[0];
  const before = store.todoEntries.length;
  store.toggleComplete(a);          // 立即把 fade/commit 定时器挂到 +180ms，并压入 undo 栈
  store.undo();                     // 用户在 fade 窗口内点“撤销”
  await sleep(260);                 // 等挂起的定时器触发
  const s = render();
  const todoIds = s.todoEntries.map((e) => e.id);
  const ok = s.todoEntries.length === before && s.doneEntries.length === 0 && todoIds.filter((id) => id === a.id).length === 1;
  check('[C1] 完成后 180ms 内撤销应恢复原任务且 done 清空', ok,
    `todo=${s.todoEntries.length}(期望${before}) done=${s.doneEntries.length}(期望0) 重复id=${todoIds.filter((id) => id === a.id).length}`);
}

// Scenario 2：180ms 内双击同一任务完成
{
  const { store, render } = await bootStore();
  const a = store.todoEntries[0];
  store.toggleComplete(a);
  store.toggleComplete(a);
  await sleep(320);
  const s = render();
  const doneIds = s.doneEntries.map((e) => e.id);
  const dup = new Set(doneIds).size !== doneIds.length;
  const ok = s.doneEntries.length === 1 && !dup;
  check('[C2] 180ms 内双击完成不应产生重复 done 条目', ok,
    `done=${s.doneEntries.length}(期望1) 重复id=${dup} 内容=${JSON.stringify(s.doneEntries.map((e) => serializeTask(e)))}`);
}

// Scenario 3：删除 A → 完成 B → 连续撤销两次
{
  const { store, render } = await bootStore();
  const A = store.todoEntries[0];
  store.deleteTask(A);
  let s = render();
  const B = s.todoEntries.find((t) => t.title === '任务B');
  store.toggleComplete(B);
  await sleep(260);                 // 等 B 的完成提交
  store.undo();
  store.undo();
  await sleep(20);
  s = render();
  const titles = s.todoEntries.map((e) => e.title).sort();
  const ok = s.todoEntries.length === 3 && s.doneEntries.length === 0 &&
    JSON.stringify(titles) === JSON.stringify(['任务A', '任务B', '任务C']);
  check('[C3] 删除A→完成B→撤销两次应完全还原', ok,
    `todo=[${titles}] done=${s.doneEntries.length}(期望0)`);
}

// Scenario 4：handle 为 null 时 resolveConflictKeepLocal
{
  __resetHooks();
  installBrowserStubs(SEED);
  const render = () => { __beginRender(); const api = useTodoStore(); __flushEffects(); return api; };
  const store = render();           // 未选择目录，dirHandleRef.current === null
  let threw = null;
  try { await store.resolveConflictKeepLocal(); } catch (e) { threw = e; }
  check('[C4] handle 为 null 时 resolveConflictKeepLocal 不抛未捕获异常', !threw,
    threw ? `抛出 ${threw.message}` : `toast=${store.toast ? store.toast.message : 'null'}`);
}

// Scenario 5：setTimeout 完成提交是否与撤销共用同一 id（幽灵任务根因确认）
{
  const { store, render } = await bootStore();
  const a = store.todoEntries[0];
  store.toggleComplete(a);
  store.undo();
  const s = render();
  const dup = s.todoEntries.filter((e) => e.id === a.id);
  check('[C5] 撤销后（提交前）todo 内出现同 id 副本（幽灵任务根因）',
    dup.length <= 1, `同 id 条目数=${dup.length}（>1 即重复/幽灵）`);
}

// Scenario 6：完成(fade 窗口内) → 删除 → 撤销删除 → 再撤销完成（工程师补充的边缘）
{
  const { store, render } = await bootStore();
  const T = store.todoEntries.find((t) => t.title === '任务B');
  store.toggleComplete(T);          // 登记 pending complete + 压入 complete 动作
  store.deleteTask(T);              // 窗口内删除：应清挂起定时器并从 undo 栈移除陈旧 complete
  await sleep(260);                 // 定时器应已被清，不再提交
  store.undo();                     // 撤销删除 → T 复原
  store.undo();                     // 再撤销完成 → 不应重复插入 T
  await sleep(20);
  const s = render();
  const tCount = s.todoEntries.filter((e) => e.id === T.id).length;
  const ok = tCount === 1 && s.doneEntries.length === 0 && s.todoEntries.length === 3;
  check('[C6] 完成(窗口内)→删除→撤销删除→撤销完成 不重复插入', ok,
    `T出现${tCount}次(期望1) todo=${s.todoEntries.length}(期望3) done=${s.doneEntries.length}(期望0)`);
}

// Scenario 7：完成(fade 窗口内) → 删除：done 不得残留该任务
{
  const { store, render } = await bootStore();
  const T = store.todoEntries.find((t) => t.title === '任务B');
  store.toggleComplete(T);
  store.deleteTask(T);
  await sleep(260);
  const s = render();
  const ok = s.doneEntries.length === 0 && s.todoEntries.length === 2 && !s.todoEntries.some((e) => e.id === T.id);
  check('[C7] 完成(窗口内)→删除：done 不得残留被删任务', ok,
    `todo=${s.todoEntries.length}(期望2) done=${s.doneEntries.length}(期望0)`);
}

// Scenario 8：正常路径（等待提交完成）撤销仍应把任务移回 todo
{
  const { store, render } = await bootStore();
  const T = store.todoEntries.find((t) => t.title === '任务B');
  store.toggleComplete(T);
  await sleep(260);                 // 等提交真正完成
  let s = render();
  const notYet = s.todoEntries.some((e) => e.id === T.id) === false && s.doneEntries.length === 1;
  store.undo();                     // 此时走提交分支
  await sleep(20);
  s = render();
  const ok = notYet && s.todoEntries.length === 3 && s.doneEntries.length === 0;
  check('[C8] 正常完成（已提交）后撤销应移回 todo', ok,
    `提交后done=${notYet ? 1 : '?'} → 撤销后 todo=${s.todoEntries.length}(期望3) done=${s.doneEntries.length}(期望0)`);
}

// ───────────────────────── 汇总 ─────────────────────────
console.log(`\n=== 汇总：${results.length - failures}/${results.length} 通过，${failures} 失败 ===`);
const summary = { total: results.length, passed: results.length - failures, failed: failures, failures: results.filter((r) => !r.pass) };
console.log('QA_SUMMARY_JSON ' + JSON.stringify(summary));
process.exitCode = failures === 0 ? 0 : 1;
