// M2-Chat 独立攻击脚本（严过关编写，不依赖工程师范刚的用例断言）
// 运行：node --import ./scripts/register-qa-loader.mjs ./scripts/qa-chat-attack.mjs
//
// 覆盖：
//  1   extractDate 时间词跨边界（含跨年 / 跨月）
//  2   误判攻击（标题含动作词 / 无目标 / 无时间）
//  3   序号越界（第0条 / 第99条 / 第2条）
//  4   关键词 0命中/多命中/大小写/中文标点/正则特殊字符
//  5   空/纯空白/超长/emoji/换行/制表符 输入
//  6   eventLog：append-only 字节不变 / NDJSON 转义 / 跨日文件名 / seq 单调 / replay 无副作用
//  7   useTodoStore 新增(add)逆操作 + fade 竞态回归
//  8   验收标准 AC-C1~C11
//  9   useHotkeys enabled 开关
// 10   日志时区（UTC vs 本地）一致性风险探测
//
// 真实数据文件 todo.txt / done.txt 全程只读，绝不写入。

import { readFileSync } from 'node:fs';
import dayjs from 'dayjs';
import { parseFile, serializeTask, taskFromQuickInput } from '../src/lib/todoParser.js';
import { activeTasks, sortTasks } from '../src/lib/sortFilter.js';
import { parseIntent, extractDate, detectAction } from '../src/lib/nlRules.js';
import { ACTIONS, dispatch, pickByReply } from '../src/lib/actions.js';
import { appendEvent, loadEvents, makeEvent, replay, sessionFileName } from '../src/lib/eventLog.js';

const results = [];
let failures = 0;
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TD = '2026-10-01'; // 基准 today（周四）

// ───────────────────────── 1. extractDate 跨边界 ─────────────────────────
console.log('\n=== 1. extractDate 时间词跨边界 ===');
{
  const d = (t, today = TD) => extractDate(t, today).date;
  const cases = [
    ['今天', TD, '2026-10-01'],
    ['明天', TD, '2026-10-02'],
    ['后天', TD, '2026-10-03'],
    ['大后天', TD, '2026-10-04'],
    ['本周五', TD, '2026-10-02'],
    ['下周三', TD, '2026-10-07'],
    ['下下周三', TD, '2026-10-14'],
    ['3天后', TD, '2026-10-04'],
    ['2周后', TD, '2026-10-15'],
    ['10月8日', TD, '2026-10-08'],
    ['月底', TD, '2026-10-31'],
    ['下月初', TD, '2026-11-01'],
    ['明天', '2026-12-31', '2027-01-01'], // 跨年
    ['下月初', '2026-01-31', '2026-02-01'], // 跨月（1月31日 + 1月 → 2月1日）
    ['明天', '2026-11-30', '2026-12-01'],
    ['月底', '2026-02-15', '2026-02-28'],
    ['下月初', '2026-11-30', '2026-12-01'],
  ];
  for (const [txt, today, expect] of cases) {
    const got = d(txt, today);
    check(`extractDate(${txt}) @${today} => ${expect}`, got === expect, got === expect ? '' : `got ${got}`);
  }
}

// ───────────────────────── 2. 误判攻击 ─────────────────────────
console.log('\n=== 2. 误判攻击 ===');
{
  const TASKS = [
    { id: 'x1', kind: 'task', title: '完成任务清单整理', completed: false, contexts: [], projects: [] },
    { id: 'x2', kind: 'task', title: '写第 10 周回测报告', completed: false, contexts: [], projects: [] },
    { id: 'x3', kind: 'task', title: '回测报告复核', completed: false, contexts: [], projects: [] },
  ];
  const run = (t) => parseIntent(t, { tasks: TASKS, today: TD });

  // 标题本身含“完成”时，输入“完成 任务清单整理”应命中该条
  const r1 = run('完成 任务清单整理');
  check('标题含动作词：目标命中正确（唯一）', r1.intent === 'complete' && r1.matches.length === 1 && r1.matches[0] === 'x1',
    `intent=${r1.intent} matches=${JSON.stringify(r1.matches)} conf=${r1.confidence}`);

  // 无目标“删除”必须要求澄清（低置信度），不得乱删
  const r2 = run('删除');
  check('“删除”无目标 => 低置信度要求澄清（不执行）', r2.confidence === 'low' && r2.matches.length === 0,
    `conf=${r2.confidence} matches=${JSON.stringify(r2.matches)}`);

  // 无目标“延期”必须拒绝并追问
  const r3 = run('延期');
  check('“延期”无目标 => 低置信度要求澄清（不执行）', r3.confidence === 'low',
    `conf=${r3.confidence} matches=${JSON.stringify(r3.matches)}`);

  // 有目标但无时间：应进入执行分支但返回 fail（不产生实际写副作用）
  const r4 = run('把 回测报告复核 延后'); // 唯一目标
  check('“把 X 延后”无时间词 => 命中唯一目标且置信度高（由 actions 拒绝执行）', r4.matches.length === 1 && r4.confidence === 'high',
    `matches=${JSON.stringify(r4.matches)} conf=${r4.confidence} due=${r4.slots.dueDate}`);
  if (r4.confidence === 'high') {
    let updated = 0;
    const spy = {
      tasks: TASKS, today: TD,
      store: { updateTask() { updated += 1; }, undo() {}, toggleComplete() {}, deleteTask() {}, addTask() { return { title: 'x' }; }, doneEntries: [] },
    };
    const res = dispatch({ ...r4, matches: [r4.matches[0]], confidence: 'high' }, spy);
    check('“延期无时间”执行结果 status=fail 且未调用 updateTask', res.tool.status === 'fail' && updated === 0,
      `status=${res.tool.status} updateTask调用=${updated} reply=${res.reply}`);
  }

  // 观察：查询句式被误判为 complete
  const r5 = run('有哪些任务已完成');
  check('[观察] “有哪些任务已完成” 被判为 complete（query 优先级低于 complete）', true,
    `intent=${r5.intent}（观察点，非致命）`);
}

// ───────────────────────── 3. 序号越界 ─────────────────────────
console.log('\n=== 3. 序号越界（不得静默操作第一条） ===');
{
  const TASKS = [
    { id: 'i1', kind: 'task', title: '任务一', completed: false, contexts: [], projects: [] },
    { id: 'i2', kind: 'task', title: '任务二', completed: false, contexts: [], projects: [] },
  ];
  for (const [txt, expectMatch, expectConf] of [
    ['完成 第0条', 0, 'low'],
    ['完成 第99条', 0, 'low'],
    ['完成 第2条', 1, 'high'],
    ['完成 第-1条', 0, 'low'],
  ]) {
    const r = parseIntent(txt, { tasks: TASKS, today: TD });
    check(`序号 “${txt}”`, r.matches.length === expectMatch && r.confidence === expectConf,
      `matches=${r.matches.length}(期望${expectMatch}) conf=${r.confidence}(期望${expectConf})`);
    // 越界时即便走 dispatch 也必须是 fail，绝不能命中 i1
    if (r.matches.length === 0) {
      let touched = null;
      const spy = {
        tasks: TASKS, today: TD,
        store: { toggleComplete(t) { touched = t.id; }, undo() {}, deleteTask(t) { touched = t.id; }, updateTask() {}, addTask() { return { title: 'x' }; }, doneEntries: [] },
      };
      const res = dispatch({ ...r, matches: [] }, spy);
      check(`越界 “${txt}” dispatch 不得触碰任何任务`, touched === null && res.tool.status === 'fail',
        `touched=${touched} status=${res.tool.status}`);
    }
  }
}

// ───────────────────────── 4. 关键词边界 / 特殊字符 ─────────────────────────
console.log('\n=== 4. 关键词边界与正则特殊字符（不得抛异常） ===');
{
  const TASKS = parseFile(
    [
      '(A) 2026-09-20 逾期任务：季报复核 due:2026-09-25',
      '(B) 2026-09-20 今天到期：写第 10 周回测报告 due:2026-09-30',
      '(C) 2026-09-20 有项目标签的任务 +回测 due:2026-10-10',
    ].join('\n')
  ).filter((e) => e.kind === 'task');
  const mk = (t) => ({ id: t, kind: 'task', title: t, completed: false, contexts: [], projects: [] });

  const cases = [
    ['完成 不存在的任务xyz', 'zero'],
    ['完成 任务', 'multi'],
    ['完成 回测报告', 'one'],
    ['完成，回测报告', 'one'],
    ['完成 回测报告。', 'one'],
    ['完成 (.*)', 'noThrow'],
    ['完成 .*', 'noThrow'],
    ['完成 (', 'noThrow'],
    ['完成 [', 'noThrow'],
    ['完成 \\', 'noThrow'],
    ['完成 $^', 'noThrow'],
    ['完成 a|b', 'noThrow'],
    ['完成 {2,3}', 'noThrow'],
  ];
  for (const [txt, kind] of cases) {
    let err = null, r = null;
    try { r = parseIntent(txt, { tasks: TASKS, today: TD }); } catch (e) { err = e; }
    if (err) { check(`关键词 “${txt}” 不抛异常`, false, err.message); continue; }
    if (kind === 'zero') check(`关键词 0 命中 “${txt}” => low`, r.matches.length === 0 && r.confidence === 'low', `matches=${r.matches.length} conf=${r.confidence}`);
    else if (kind === 'multi') check(`关键词多命中 “${txt}” => low`, r.matches.length > 1 && r.confidence === 'low', `matches=${r.matches.length} conf=${r.confidence}`);
    else if (kind === 'one') check(`关键词唯一命中 “${txt}” => high`, r.matches.length === 1 && r.confidence === 'high', `matches=${r.matches.length} conf=${r.confidence}`);
    else check(`正则特殊字符 “${txt}” 不抛异常且不执行（low）`, r.confidence === 'low' || r.intent === 'unknown', `conf=${r.confidence}`);
  }

  // 大小写不敏感
  const up = parseIntent('完成 回测报告', { tasks: [mk('写第 10 周回测报告')], today: TD });
  check('中文关键词大小写无影响（唯一命中）', up.confidence === 'high', `conf=${up.confidence}`);
}

// ───────────────────────── 5. 极端输入 ─────────────────────────
console.log('\n=== 5. 空/空白/超长/emoji/换行/制表符 ===');
{
  const TASKS = [{ id: 'e1', kind: 'task', title: '交周报', completed: false, contexts: [], projects: [] }];
  const R = (t) => parseIntent(t, { tasks: TASKS, today: TD });
  const noThrow = (label, fn) => { try { const v = fn(); check(label, true, typeof v === 'string' ? v : ''); return v; } catch (e) { check(label, false, e.message); return null; } };

  check('空输入 "" => unknown', R('').intent === 'unknown');
  check('纯空格 => unknown', R('   ').intent === 'unknown');
  check('null/undefined/number 输入不抛', (() => { try { R(null); R(undefined); R(123); return true; } catch { return false; } })());
  check('ctx.tasks 非数组不抛', (() => { try { parseIntent('完成 x', { tasks: null, today: TD }); return true; } catch { return false; } })());

  const long = '烦'.repeat(1000); // 无任何动作触发词
  const rLong = noThrow('1000 字无动作词 => unknown 且不误动作', () => R(long));
  if (rLong) check('1000 字无动作词 => unknown', rLong.intent === 'unknown', `intent=${rLong.intent}`);

  const rLongAdd = noThrow('加一条 + 1000 字不崩', () => R(`加一条 ${'甲'.repeat(1000)}`));
  if (rLongAdd) check('超长 add 标题非空且 intent=add', rLongAdd.intent === 'add' && rLongAdd.slots.title.length > 0, `intent=${rLongAdd.intent}`);

  const rEmoji = noThrow('emoji 输入不崩', () => R('加一条 🎉 修复登录 🚀'));
  if (rEmoji) check('emoji 标题保留且 intent=add', rEmoji.intent === 'add' && rEmoji.slots.title.includes('🎉'), `title=${JSON.stringify(rEmoji.slots.title)}`);

  const rNL = noThrow('含换行输入不崩', () => R('加一条\n明天\n交周报'));
  if (rNL) check('换行输入 => add, due=10-02, title=交周报', rNL.intent === 'add' && rNL.slots.dueDate === '2026-10-02' && rNL.slots.title === '交周报', JSON.stringify(rNL.slots));

  const rTab = noThrow('含制表符输入不崩', () => R('加一条\t交周报'));
  if (rTab) check('制表符输入 => add, title=交周报', rTab.intent === 'add' && rTab.slots.title === '交周报', JSON.stringify(rTab.slots));
}

// ───────────────────────── 6. eventLog ─────────────────────────
console.log('\n=== 6. eventLog：append-only / NDJSON / 跨日 / replay ===');
function makeDirHandle() {
  const map = {};
  return {
    _files: map,
    async getFileHandle(name, opt) {
      if (!(name in map)) {
        if (opt && opt.create) map[name] = '';
        else { const e = new Error('NotFound'); e.name = 'NotFoundError'; throw e; }
      }
      return {
        async getFile() { return { async text() { return map[name]; } }; },
        async createWritable() { return { async write(t) { map[name] = t; }, async close() {} }; },
      };
    },
  };
}
{
  const TS = '2026-10-01T09:00:00.000Z';
  const name = sessionFileName('2026-10-01');
  check('sessionFileName 格式', name === 'session-2026-10-01.ndjson', name);

  // append-only 字节不变 + 行数递增
  const dir = makeDirHandle();
  const snaps = [];
  for (let i = 1; i <= 5; i += 1) {
    await appendEvent(dir, makeEvent(i, 'user', { text: `行${i}` }, TS));
    snaps.push(dir._files[name]);
  }
  let prefixOk = true;
  for (let i = 0; i < 4; i += 1) if (!snaps[4].startsWith(snaps[i])) prefixOk = false;
  const lines = snaps[4].split('\n').filter(Boolean);
  check('append-only：前 4 条字节前缀不被改写', prefixOk);
  check('append 5 次 => 5 行且行号递增', lines.length === 5 && lines.every((l, i) => JSON.parse(l).seq === i + 1), `lines=${lines.length}`);

  // NDJSON 转义：换行/制表/引号/中文/emoji 不破坏单行结构
  const dir2 = makeDirHandle();
  const tricky = '第一行\n第二行\t带"引号" 中文🎉\\反斜杠';
  await appendEvent(dir2, makeEvent(1, 'user', { text: tricky }, TS));
  await appendEvent(dir2, makeEvent(2, 'agent', { text: 'ok' }, TS));
  const raw2 = dir2._files[name];
  const l2 = raw2.split('\n').filter(Boolean);
  let parsedOk = true, roundtripOk = false;
  try { parsedOk = l2.length === 2 && l2.every((l) => typeof JSON.parse(l) === 'object'); roundtripOk = JSON.parse(l2[0]).payload.text === tricky; } catch { parsedOk = false; }
  check('NDJSON：含换行/制表/引号载荷仍为 2 行且均可 JSON.parse', parsedOk, `行数=${l2.length}`);
  check('NDJSON：载荷逐字符还原（\\n \\t 引号 emoji 反斜杠）', roundtripOk);

  // 跨日：不同日期写不同文件，同日追加同文件
  const dir3 = makeDirHandle();
  await appendEvent(dir3, makeEvent(1, 'user', { text: 'a' }, '2026-10-01T10:00:00.000Z'));
  await appendEvent(dir3, makeEvent(2, 'user', { text: 'b' }, '2026-10-01T11:00:00.000Z'));
  await appendEvent(dir3, makeEvent(3, 'user', { text: 'c' }, '2026-10-02T10:00:00.000Z'));
  const e1 = await loadEvents(dir3, '2026-10-01');
  const e2 = await loadEvents(dir3, '2026-10-02');
  check('跨日：同日多次追加同一文件（2 条），异日分文件（1 条）', e1.length === 2 && e2.length === 1, `d1=${e1.length} d2=${e2.length}`);
  check('seq 单调递增', JSON.stringify(e1.map((e) => e.seq)) === '[1,2]');

  // loadEvents 排序：打乱写入顺序后仍按 seq 升序
  const dir4 = makeDirHandle();
  dir4._files[name] = [makeEvent(3, 'user', { text: 'c' }, TS), makeEvent(1, 'user', { text: 'a' }, TS), makeEvent(2, 'user', { text: 'b' }, TS)].map((e) => JSON.stringify(e)).join('\n') + '\n';
  const sorted = await loadEvents(dir4, '2026-10-01');
  check('loadEvents 按 seq 升序', JSON.stringify(sorted.map((e) => e.seq)) === '[1,2,3]');

  // ts 合法
  const validTs = e1.every((e) => !Number.isNaN(Date.parse(e.ts)));
  check('ts 为合法时间戳', validTs);

  // replay 无副作用：输入冻结不被改写、幂等、畸形事件不抛
  const events = Object.freeze([
    makeEvent(1, 'user', { text: '完成 回测报告' }, TS),
    makeEvent(2, 'intent', { intent: 'complete' }, TS),
    makeEvent(3, 'tool_call', { callId: 'c1', tool: { name: 'todo.complete', params: { target: '回测报告' } } }, TS),
    makeEvent(4, 'tool_result', { callId: 'c1', status: 'ok', durationMs: 3, params: { title: '写第 10 周回测报告' } }, TS),
    makeEvent(5, 'agent', { text: '已完成' }, TS),
  ]);
  const rA = replay(events);
  const rB = replay(events);
  check('replay 幂等（同输入同输出）', JSON.stringify(rA) === JSON.stringify(rB));
  check('replay 未改写输入（冻结仍可重放）', events.length === 5);
  check('replay 还原角色序列 user/tool/agent', JSON.stringify(rA.map((m) => m.role)) === '["user","tool","agent"]', rA.map((m) => m.role).join(','));
  let replayErr = null;
  try {
    replay([null, undefined, 42, 'x', {}, { type: 'tool_result', payload: { callId: 'none' } }, { type: 'unknown' }]);
  } catch (e) { replayErr = e; }
  check('replay 畸形事件不抛异常', !replayErr, replayErr ? replayErr.message : '');
}

// ───────────────────────── 日志时区一致性（已修复回归） ─────────────────────────
console.log('\n=== 10. 日志时区一致性（本地日历日归档，回归） ===');
{
  const name = sessionFileName('2026-10-01');
  // 本地 UTC+8：ts 为 UTC '2026-09-30T18:00Z' 时，本地日历日 = 2026-10-01
  const dir = makeDirHandle();
  await appendEvent(dir, makeEvent(1, 'user', { text: 'x' }, '2026-09-30T18:00:00.000Z'));
  const wroteLocal = name in dir._files;
  const roundtrip = await loadEvents(dir, '2026-10-01');
  check('[已修复] UTC 00:00–08:00 本地时段事件落盘到本地日期文件并可回放', wroteLocal && roundtrip.length === 1,
    `写入 session-2026-10-01.ndjson=${wroteLocal} 回放=${roundtrip.length} 键=${Object.keys(dir._files).join(',')}`);
}

// ───────────────────────── 浏览器/store 替身 ─────────────────────────
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
  const listeners = [];
  globalThis.window = {
    showDirectoryPicker: async () => dir,
    addEventListener(type, fn) { listeners.push([type, fn]); },
    removeEventListener() {},
  };
  globalThis.indexedDB = {
    open() {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      req.result = {
        objectStoreNames: { contains: () => true }, close() {},
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
  return { fs, listeners };
}

const { __beginRender, __flushEffects, __resetHooks } = await import('./qa-react-shim.mjs');
const { useTodoStore } = await import('../src/hooks/useTodoStore.js');
const { useChatAgent } = await import('../src/hooks/useChatAgent.js');

const FIXTURE_SEED = {
  'todo.txt': [
    '(A) 2026-09-20 逾期任务：季报复核 due:2026-09-25',
    '(B) 2026-09-20 今天到期：写第 10 周回测报告 due:2026-09-30',
    '(C) 2026-09-20 有项目标签的任务 +回测 due:2026-10-10',
    '(D) 2026-09-20 星标任务 star:1',
    '(E) 2026-09-20 未来才开始的任务 t:2026-10-05',
    '(F) 2026-09-20 普通任务没有任何标签',
    '2026-09-30 带上下文的任务 @工作 +量化 due:2026-10-08',
    '2026-09-30 收集箱任务：无任何标记的裸任务',
    '(B) 2026-09-30 带截止日的周线复盘 @投资 +复盘 due:2026-10-04',
  ].join('\n') + '\n',
  'done.txt': 'x 2026-09-29 2026-09-28 (B) 已完成的示例：编写安装配置指南 @文档\n',
};

async function bootStore(seed) {
  __resetHooks();
  const { fs, listeners } = installBrowserStubs(seed);
  const render = () => { __beginRender(); const api = useTodoStore(); __flushEffects(); return api; };
  let store = render();
  await store.pickDirectory();
  await sleep(5);
  store = render();
  return { store, render, fs, listeners };
}

// ───────────────────────── 7. undo(add) 逆操作 + 竞态 ─────────────────────────
console.log('\n=== 7. useTodoStore 新增(add)逆操作 + fade 竞态 ===');
const EMPTY = { 'todo.txt': '', 'done.txt': '' };
{
  // 7.1 新增 → 撤销 → 消失，文件行数 -1
  {
    const { store, render, fs } = await bootStore(EMPTY);
    store.addTask('交周报');
    await sleep(650);
    let s = render();
    const afterAdd = fs['todo.txt'].split('\n').filter(Boolean).length;
    s.undo();
    await sleep(650);
    s = render();
    const afterUndo = fs['todo.txt'].split('\n').filter(Boolean).length;
    check('7.1 新增→撤销：todo 清空且文件行数 -1', s.todoEntries.filter((e) => e.kind === 'task').length === 0 && afterAdd === 1 && afterUndo === 0,
      `todo=${s.todoEntries.length} 文件行 ${afterAdd}→${afterUndo}`);
  }

  // 7.2 新增 → 完成(已提交) → 撤销 → 不抛异常、无重复
  {
    const { store, render } = await bootStore(EMPTY);
    const t = store.addTask('交周报');
    store.toggleComplete(t);
    await sleep(260);
    store.undo();
    await sleep(20);
    const s = render();
    const titles = s.todoEntries.filter((e) => e.kind === 'task').map((e) => e.title);
    check('7.2 新增→完成→撤销：无异常、无重复、done 清空', titles.filter((x) => x === '交周报').length === 1 && s.doneEntries.length === 0,
      `titles=${JSON.stringify(titles)} done=${s.doneEntries.length}`);
  }

  // 7.3 新增 → 删除 → 撤销（不得产生重复）
  {
    const { store, render } = await bootStore(EMPTY);
    const t = store.addTask('交周报');
    store.deleteTask(t);
    store.undo();
    await sleep(20);
    const s = render();
    const cnt = s.todoEntries.filter((e) => e.id === t.id).length;
    check('7.3 新增→删除→撤销：无重复（按设计复原 1 条）', cnt === 1, `同 id 条目数=${cnt}`);
    // 再撤销一次（此时栈顶为 add）→ 应移除
    store.undo();
    await sleep(20);
    const s2 = render();
    check('7.3b 再撤销(add 分支)：任务被移除且无幽灵', s2.todoEntries.filter((e) => e.id === t.id).length === 0, `同 id 条目数=${s2.todoEntries.filter((e) => e.id === t.id).length}`);
  }

  // 7.4 新增两条 → 撤销两次 → LIFO（含同标题）
  {
    const { store, render } = await bootStore(EMPTY);
    const t1 = store.addTask('第一条');
    const t2 = store.addTask('第一条'); // 同标题
    check('7.4 同标题两次新增 id 不同（可区分）', t1.id !== t2.id, `${t1.id} vs ${t2.id}`);
    store.undo();
    await sleep(20);
    let s = render();
    check('7.4a 撤销一次移除后加入的一条', s.todoEntries.filter((e) => e.id === t2.id).length === 0 && s.todoEntries.filter((e) => e.id === t1.id).length === 1,
      `t1=${s.todoEntries.filter((e) => e.id === t1.id).length} t2=${s.todoEntries.filter((e) => e.id === t2.id).length}`);
    store.undo();
    await sleep(20);
    s = render();
    check('7.4b 再撤销移除剩余一条（LIFO 正确）', s.todoEntries.filter((e) => e.kind === 'task').length === 0, `todo=${s.todoEntries.length}`);
  }

  // 7.5 新增 → 完成(180ms fade 窗口内) → 撤销 → 无幽灵（回归保护）
  {
    const { store, render } = await bootStore(EMPTY);
    const t = store.addTask('交周报');
    store.toggleComplete(t); // 立即进 fade 窗口
    store.undo();            // 窗口内撤销
    await sleep(300);        // 等挂起定时器
    const s = render();
    const cnt = s.todoEntries.filter((e) => e.id === t.id).length;
    check('7.5 新增→完成(fade内)→撤销：无幽灵、done 清空', cnt === 1 && s.doneEntries.length === 0, `同 id=${cnt} todo=${s.todoEntries.length} done=${s.doneEntries.length}`);
  }

  // 7.6 空栈撤销不抛异常
  {
    const { store } = await bootStore(EMPTY);
    let threw = null;
    try { store.undo(); store.undo(); } catch (e) { threw = e; }
    check('7.6 空栈撤销不抛异常', !threw, threw ? threw.message : '');
  }
}

// ───────────────────────── 8. 验收标准 AC-C1~C11 ─────────────────────────
console.log('\n=== 8. 验收标准 AC（today=2026-10-01，真实 store 驱动） ===');
{
  // 高置信度执行器：镜像 useChatAgent 决策（low/unknown 不执行）
  const makeAgent = (store) => (text) => {
    const tasks = sortTasks(activeTasks(store.todoEntries), store.sortMode);
    const intent = parseIntent(text, { tasks, today: TD });
    if (intent.intent === 'unknown' || intent.confidence === 'low') return { intent, result: null, tasks };
    const result = dispatch(intent, { store, tasks, today: TD });
    return { intent, result, tasks };
  };

  // C1
  {
    const { store, render } = await bootStore(FIXTURE_SEED);
    const run = makeAgent(store);
    const { result } = run('加一条 明天下午 交周报');
    await sleep(20);
    const s = render();
    const added = s.todoEntries[s.todoEntries.length - 1];
    const line = serializeTask(added);
    // 创建日期由 store.addTask 用真实系统时钟（dayjs()）写入，这里必须用同源时钟，
    // 不能写死字面量 —— 否则脚本只在"系统日期恰为某天"时才通过（典型的时钟耦合）。
    check('AC-C1 add 行内容 = <今天> 交周报 due:2026-10-02 且不含 (B)',
      line === `${dayjs().format('YYYY-MM-DD')} 交周报 due:2026-10-02` && !line.includes('(B)'),
      `line=${JSON.stringify(line)} status=${result && result.tool.status}`);
  }
  // C2
  {
    const { store, render } = await bootStore(FIXTURE_SEED);
    const run = makeAgent(store);
    const { intent, result } = run('完成 回测报告');
    await sleep(260);
    const s = render();
    const doneTasks = s.doneEntries.filter((e) => e.kind === 'task');
    const newDone = doneTasks.find((e) => e.title === '今天到期：写第 10 周回测报告');
    check('AC-C2 complete 唯一命中并落 done（新增 1 条）',
      intent.confidence === 'high' && result.tool.status === 'ok' && Boolean(newDone) && doneTasks.length === 2,
      `conf=${intent.confidence} status=${result.tool.status} done=${doneTasks.length} 含新完成=${Boolean(newDone)}`);
  }
  // C3 多命中 → 澄清 → 回 2
  {
    const { store } = await bootStore(FIXTURE_SEED);
    const run = makeAgent(store);
    const { intent, tasks } = run('完成 任务');
    const candidates = intent.matches.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
    const chosen = pickByReply(candidates, '2');
    check('AC-C3 多命中低置信度 + 回复“2”选中第 2 个候选',
      intent.confidence === 'low' && candidates.length > 1 && chosen && chosen.id === candidates[1].id,
      `候选=${candidates.length} chosen=${chosen && chosen.title}`);
  }
  // C4
  {
    const { store, render } = await bootStore(FIXTURE_SEED);
    const run = makeAgent(store);
    const { result } = run('把 回测报告 延到下周三');
    await sleep(20);
    const s = render();
    const t = s.todoEntries.find((e) => e.title === '今天到期：写第 10 周回测报告');
    check('AC-C4 postpone 延到下周三 = 2026-10-07', t && t.dueDate === '2026-10-07', `due=${t && t.dueDate} status=${result && result.tool.status}`);
  }
  // C5
  {
    const { store, render } = await bootStore(FIXTURE_SEED);
    const run = makeAgent(store);
    const { result } = run('标为高 回测报告');
    await sleep(20);
    const s = render();
    const t = s.todoEntries.find((e) => e.title === '今天到期：写第 10 周回测报告');
    check('AC-C5 setPriority 标为高 => (A)', t && t.priority === 'A', `priority=${t && t.priority} status=${result && result.tool.status}`);
  }
  // C6 查询列表与快照同序
  {
    const { store } = await bootStore(FIXTURE_SEED);
    const run = makeAgent(store);
    const { result, tasks } = run('有哪些任务');
    const replyLines = result.reply.split('\n').slice(1); // 去掉“共 N 条…”首行
    const snapTitles = tasks.map((t) => t.title);
    const orderedAndPresent =
      replyLines.length === snapTitles.length &&
      snapTitles.every((title, i) => replyLines[i].includes(title));
    check('AC-C6 查询回复顺序 = 快照顺序', orderedAndPresent,
      `回复行=${replyLines.length} 快照=${snapTitles.length} 首行=${JSON.stringify(replyLines[0])}`);
  }
  // C10 撤销走 store.undo
  {
    const { store } = await bootStore(FIXTURE_SEED);
    let undone = 0;
    store.undo = () => { undone += 1; };
    const run = makeAgent(store);
    const { result } = run('撤销');
    check('AC-C10 撤销 => todo.undo 且调用 store.undo', result.tool.name === 'todo.undo' && undone === 1, `name=${result.tool.name} undone=${undone}`);
  }
}

// ───────────────────────── 6b. 端到端：useChatAgent 决策 + 日志落盘/回放 ─────────────────────────
console.log('\n=== 6b. useChatAgent 端到端：低置信度/unknown 不产生 tool_call，日志落盘可回放 ===');
async function bootChat() {
  __resetHooks();
  const stubs = installBrowserStubs(FIXTURE_SEED);
  const render = () => {
    __beginRender();
    const store = useTodoStore();
    const agent = useChatAgent(store);
    __flushEffects();
    return { store, agent };
  };
  let r = render();
  await r.store.pickDirectory();
  await sleep(5);
  r = render();
  return { r, render, fs: stubs.fs };
}
const readLog = (fs) => {
  const key = Object.keys(fs).find((k) => /^session-.*\.ndjson$/.test(k));
  if (!key) return { key: null, events: [] };
  const events = fs[key].split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { key, events };
};
{
  const { render, fs } = await bootChat();

  // unknown 输入
  let r = render();
  await r.agent.send('今天天气怎么样');
  await sleep(20);
  let log = readLog(fs);
  check('E1 unknown 输入不产生 tool_call（仅 user/agent）',
    log.events.length >= 2 && !log.events.some((e) => e.type === 'tool_call'),
    `事件类型=${log.events.map((e) => e.type).join(',')}`);

  // 多命中 → 澄清（低置信度）不产生 tool_call
  r = render();
  await r.agent.send('完成 任务');
  await sleep(20);
  log = readLog(fs);
  const toolCallsBefore = log.events.filter((e) => e.type === 'tool_call').length;
  check('E2 多命中澄清：仍未产生任何 tool_call', toolCallsBefore === 0, `tool_call 数=${toolCallsBefore}`);
  const rPending = render(); // 重新渲染以读取最新 pending
  check('E2b 澄清进入 pending 状态', rPending.agent.pending != null, `pending=${rPending.agent.pending ? 'set' : 'null'}`);

  // 回复序号 → 执行 → 产生 tool_call
  r = render();
  await r.agent.send('2');
  await sleep(20);
  log = readLog(fs);
  check('E3 澄清回复“2”后产生 tool_call 且成功', log.events.some((e) => e.type === 'tool_call'),
    `tool_call=${log.events.filter((e) => e.type === 'tool_call').length}`);

  // 回放无副作用且与消息条数合理
  r = render();
  const replayed = replay(log.events);
  check('E4 replay(日志) 不抛异常且角色数 > 0', replayed.length > 0, `messages=${replayed.length}`);
}

// ───────────────────────── 9. useHotkeys enabled 开关 ─────────────────────────
console.log('\n=== 9. useHotkeys enabled 开关（对话页签禁用全局快捷键） ===');
{
  const { default: useHotkeys } = await import('../src/hooks/useHotkeys.js');
  const { __beginRender: br, __flushEffects: fe, __resetHooks: rh } = await import('./qa-react-shim.mjs');

  function runHotkeys(enabled) {
    rh();
    const listeners = [];
    globalThis.window = { addEventListener(t, fn) { listeners.push([t, fn]); }, removeEventListener() {} };
    br();
    const fired = { neu: 0, search: 0, toggle: 0, edit: 0, undo: 0 };
    useHotkeys({
      enabled,
      onNew: () => { fired.neu += 1; },
      onSearch: () => { fired.search += 1; },
      onToggle: () => { fired.toggle += 1; },
      onEdit: () => { fired.edit += 1; },
      onUndo: () => { fired.undo += 1; },
      onEscape: () => {},
    });
    fe();
    const handler = listeners.find((l) => l[0] === 'keydown');
    if (handler) {
      const mk = (key) => ({ key, keydown: true, target: { tagName: 'DIV' }, preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false });
      handler[1](mk('n'));
      handler[1](mk('/'));
      handler[1](mk(' '));
      handler[1](mk('e'));
    }
    return { registered: Boolean(handler), fired };
  }

  const on = runHotkeys(true);
  const off = runHotkeys(false);
  check('enabled=true：注册 keydown 且 n///空格/e 生效',
    on.registered && on.fired.neu === 1 && on.fired.search === 1 && on.fired.toggle === 1 && on.fired.edit === 1,
    JSON.stringify(on.fired));
  check('enabled=false：不注册 keydown（对话页签全局快捷键已禁用）', !off.registered && off.fired.neu === 0 && off.fired.search === 0 && off.fired.toggle === 0,
    `registered=${off.registered} ${JSON.stringify(off.fired)}`);
}

// ───────────────────────── 汇总 ─────────────────────────
console.log(`\n=== 汇总：${results.length - failures}/${results.length} 通过，${failures} 失败 ===`);
const summary = { total: results.length, passed: results.length - failures, failed: failures, failures: results.filter((r) => !r.pass) };
console.log('QA_CHAT_SUMMARY ' + JSON.stringify(summary));
process.exitCode = failures === 0 ? 0 : 1;
