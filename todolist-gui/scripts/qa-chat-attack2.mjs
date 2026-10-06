// M2-Chat 第二轮复验攻击脚本（严过关编写）
// 针对「查询前缀优先 + query scope」修复：
//   A. done-scope 查询行为（真的返回 doneEntries 内容）
//   B. complete/delete 路径未被抢占（回归）
//   C. 查询前缀优先「新引入」的抢词风险（重点）
//   D. 会话日志跨日边界（本地日期口径）
// 运行：npm run test:attack-chat2
//       （= node --import ./scripts/register-qa-loader.mjs ./scripts/qa-chat-attack2.mjs）
// 真实 todo.txt / done.txt 全程只读。

import { parseFile, serializeTask } from '../src/lib/todoParser.js';
import { activeTasks, sortTasks } from '../src/lib/sortFilter.js';
import { parseIntent, detectAction } from '../src/lib/nlRules.js';
import { dispatch } from '../src/lib/actions.js';
import { appendEvent, loadEvents, makeEvent, sessionFileName } from '../src/lib/eventLog.js';

const results = [];
let failures = 0;
let observes = 0;
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}
function observe(name, detail) {
  observes += 1;
  results.push({ name, pass: true, observe: true, detail });
  console.log(`OBSERVE | ${name}${detail ? ' | ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TD = '2026-10-01';

const FIXTURE_TODO = [
  '(A) 2026-09-20 逾期任务：季报复核 due:2026-09-25',
  '(B) 2026-09-20 今天到期：写第 10 周回测报告 due:2026-09-30',
  '(C) 2026-09-20 有项目标签的任务 +回测 due:2026-10-10',
  '(D) 2026-09-20 星标任务 star:1',
  '(E) 2026-09-20 未来才开始的任务 t:2026-10-05',
  '(F) 2026-09-20 普通任务没有任何标签',
  '2026-09-30 带上下文的任务 @工作 +量化 due:2026-10-08',
  '2026-09-30 收集箱任务：无任何标记的裸任务',
  '(B) 2026-09-30 带截止日的周线复盘 @投资 +复盘 due:2026-10-04',
].join('\n') + '\n';
const FIXTURE_DONE = [
  'x 2026-09-28 2026-09-27 (A) 已完成的示例：安装 topydo 并跑通三种 UI',
  'x 2026-09-29 2026-09-28 (B) 已完成的示例：编写安装配置指南 @文档',
].join('\n') + '\n';

const TASKS = parseFile(FIXTURE_TODO).filter((e) => e.kind === 'task' && !e.completed);
const R = (t) => parseIntent(t, { tasks: TASKS, today: TD });

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
  globalThis.window = { showDirectoryPicker: async () => dir, addEventListener() {}, removeEventListener() {} };
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
  return fs;
}
const { __beginRender, __flushEffects, __resetHooks } = await import('./qa-react-shim.mjs');
const { useTodoStore } = await import('../src/hooks/useTodoStore.js');

async function bootStore(seed = { 'todo.txt': FIXTURE_TODO, 'done.txt': FIXTURE_DONE }) {
  __resetHooks();
  installBrowserStubs(seed);
  const render = () => { __beginRender(); const api = useTodoStore(); __flushEffects(); return api; };
  let store = render();
  await store.pickDirectory();
  await sleep(5);
  store = render();
  return { store, render };
}

// ───────────────────────── A. done-scope 查询 ─────────────────────────
console.log('\n=== A. done-scope 查询（必须真的返回 doneEntries 内容） ===');
{
  const r = R('有哪些任务已完成');
  check('A1 「有哪些任务已完成」=> intent=query, scope=done', r.intent === 'query' && r.scope === 'done',
    `intent=${r.intent} scope=${r.scope} conf=${r.confidence}`);

  const { store } = await bootStore();
  const tasks = sortTasks(activeTasks(store.todoEntries), store.sortMode);
  const res = dispatch(r, { store, tasks, today: TD });
  const hasDone1 = res.reply.includes('安装 topydo 并跑通三种 UI');
  const hasDone2 = res.reply.includes('编写安装配置指南');
  check('A2 done 查询回复包含 doneEntries 两条内容（非空、非澄清）',
    res.tool.status === 'ok' && hasDone1 && hasDone2 && res.tool.params.scope === 'done',
    `status=${res.tool.status} scope=${res.tool.params.scope} count=${res.tool.params.count} 含两条=${hasDone1 && hasDone2}`);
  check('A2b done 查询未读取/修改活跃任务（reply 只列已完成）',
    !res.reply.includes('季报复核'), `reply 摘要=${JSON.stringify(res.reply.slice(0, 60))}`);

  // 其它 done 前缀
  for (const t of ['列出已完成', '看看已完成的任务', '已完成']) {
    const rr = R(t);
    check(`A3 「${t}」=> query scope=done`, rr.intent === 'query' && rr.scope === 'done', `intent=${rr.intent} scope=${rr.scope}`);
  }

  // 0 条 done 的分支
  const emptyBoot = await bootStore({ 'todo.txt': FIXTURE_TODO, 'done.txt': '' });
  const rEmpty = R('有哪些任务已完成');
  const resEmpty = dispatch(rEmpty, { store: emptyBoot.store, tasks: activeTasks(emptyBoot.store.todoEntries), today: TD });
  check('A4 done 为空 => 合理提示且 status=ok', resEmpty.tool.status === 'ok' && resEmpty.reply.includes('还没有已完成'),
    `reply=${JSON.stringify(resEmpty.reply)}`);

  // active 查询不受影响
  const rAct = R('有哪些任务');
  check('A5 「有哪些任务」=> scope=active', rAct.intent === 'query' && rAct.scope === 'active', `scope=${rAct.scope}`);
}

// ───────────────────────── B. complete/delete 未被抢占（回归） ─────────────────────────
console.log('\n=== B. complete/delete 路径未被查询前缀抢占 ===');
{
  const cases = [
    ['完成 回测报告', 'complete'],
    ['搞定 第2条', 'complete'],
    ['完成 第2条', 'complete'],
    ['完成 第9条', 'complete'],
    ['完成 任务清单整理', 'complete'],
    ['完成 查看报告', 'complete'],
    ['删除 列出 的任务', 'delete'],
    ['取消完成 回测报告', 'uncomplete'],
    ['延期到 下周三 回测报告', 'postpone'],
    ['标为高 回测报告', 'setPriority'],
  ];
  for (const [txt, expect] of cases) {
    const got = detectAction(txt);
    const r = R(txt);
    check(`B 「${txt}」=> ${expect}`, got === expect && r.intent === expect, `detectAction=${got} intent=${r.intent}`);
  }
  // 「完成 任务清单整理」需命中含“完成”的标题本身
  const extra = parseIntent('完成 任务清单整理', {
    tasks: [{ id: 'z1', kind: 'task', title: '完成任务清单整理', completed: false, contexts: [], projects: [] },
            { id: 'z2', kind: 'task', title: '写第 10 周回测报告', completed: false, contexts: [], projects: [] }],
    today: TD,
  });
  check('B2 标题含动作词时目标命中正确（唯一）', extra.intent === 'complete' && extra.matches.length === 1 && extra.matches[0] === 'z1',
    `intent=${extra.intent} matches=${JSON.stringify(extra.matches)}`);
}

// ───────────────────────── C. 查询前缀「新引入」抢词风险 ─────────────────────────
console.log('\n=== C. 查询前缀优先的抢词风险 ===');
{
  // C1 —— 带 add 前缀的句子不得被抢成 query（团队要求：必须仍是 add）
  const mustAdd = ['加一条 列出购物清单', '添加 看看装修方案', '新增 查看体检报告', '记一下 搜索优化方案', '加 查看统计'];
  for (const txt of mustAdd) {
    const got = detectAction(txt);
    const r = R(txt);
    check(`C1 带 add 前缀不得被抢： 「${txt}」=> add`, got === 'add' && r.intent === 'add',
      `detectAction=${got} intent=${r.intent} title=${JSON.stringify(r.slots && r.slots.title)}`);
  }

  // C2 —— 明确命令前缀(删除/完成)不得被抢
  for (const [txt, expect] of [['删除 列出 的任务', 'delete'], ['完成 查看报告', 'complete'], ['勾掉 看看报告', 'complete']]) {
    const got = detectAction(txt);
    check(`C2 「${txt}」=> ${expect}`, got === expect, `detectAction=${got}`);
  }

  // C2b —— 根因隔离：以 add 触发词开头（非查询前缀），仅因标题含查询动词而翻转
  check('C2b 隔离： 「加一条 购物清单」不含量查询动词 => add',
    detectAction('加一条 购物清单') === 'add', `detectAction=${detectAction('加一条 购物清单')}`);
  // C2c —— 【永久回归守卫】缺陷历史：R2-1 修复前，本输入因「句中 contains 型 query 规则早于
  // add 规则」被判为 query，导致标题含查询动词（列出/看看/查看/搜索/逾期…）的新增全部失败；
  // R2-1 已修复（命令触发词优先于句中查询词）→ 现必须为 add。此断言即该缺陷的回归守卫。
  check('C2c 回归守卫： 「加一条 列出购物清单」含量查询动词 => 必须仍是 add（R2-1 已修复）',
    detectAction('加一条 列出购物清单') === 'add', `detectAction=${detectAction('加一条 列出购物清单')}`);

  // C3 —— @分类 紧贴前缀
  const rCtx = R('列出@工作');
  check('C3 「列出@工作」=> query 且识别 context=工作', rCtx.intent === 'query' && rCtx.slots.context === '工作',
    `intent=${rCtx.intent} context=${rCtx.slots.context} scope=${rCtx.scope}`);
  const rCtx2 = R('列出 @投资');
  check('C3b 「列出 @投资」=> query 且 context=投资', rCtx2.intent === 'query' && rCtx2.slots.context === '投资',
    `context=${rCtx2.slots.context}`);

  // C4 —— 观察：纯前缀句被抢（用户可能想新建同名任务）
  for (const txt of ['列出购物清单', '看看装修方案', '查一下体检报告']) {
    const got = detectAction(txt);
    const r = R(txt);
    observe(`C4 「${txt}」实际行为`, `detectAction=${got} intent=${r.intent} scope=${r.scope || '-'}（用户可能想新建该标题任务）`);
  }
  // C4b 观察：已完成 前缀与 complete 语义冲突
  {
    const got = detectAction('已完成 回测报告');
    const r = R('已完成 回测报告');
    observe('C4b 「已完成 回测报告」实际行为', `detectAction=${got} intent=${r.intent} scope=${r.scope || '-'}（用户可能想标记完成）`);
  }
  // C4c 观察：空结果路径（列出 + 不存在的关键词）
  {
    const { store } = await bootStore();
    const tasks = sortTasks(activeTasks(store.todoEntries), store.sortMode);
    const r = R('列出 完全不存在的任务名');
    const res = dispatch(r, { store, tasks, today: TD });
    observe('C4c 「列出 完全不存在的任务名」实际行为',
      `intent=${r.intent} → reply=${JSON.stringify(res.reply.split('\n')[0])}（关键词未被用作过滤，返回全部活跃任务）`);
  }
  // C4d 观察：查看/搜索 等出现在句中（非前缀）
  for (const txt of ['加一条 搜索优化', '记一笔 查看会议室']) {
    const got = detectAction(txt);
    observe(`C4d 「${txt}」实际行为`, `detectAction=${got}（标题含查询动词，可能被句中 contains 规则抢为 query）`);
  }
}

// ───────────────────────── D. 会话日志跨日边界（本地日期口径） ─────────────────────────
console.log('\n=== D. 会话日志跨日边界（本地 UTC+8 日期口径） ===');
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
  // 本地 2026-10-01 23:30 (+08) == UTC 2026-10-01T15:30Z
  // 本地 2026-10-02 00:30 (+08) == UTC 2026-10-01T16:30Z
  const dir = makeDirHandle();
  await appendEvent(dir, makeEvent(1, 'user', { text: 'local-2330' }, '2026-10-01T15:30:00.000Z'));
  await appendEvent(dir, makeEvent(2, 'user', { text: 'local-0030-nextday' }, '2026-10-01T16:30:00.000Z'));
  const f1 = sessionFileName('2026-10-01');
  const f2 = sessionFileName('2026-10-02');
  check('D1 本地 23:30(UTC15:30) 归到本地日期 session-2026-10-01.ndjson', f1 in dir._files, `键=${Object.keys(dir._files).join(',')}`);
  check('D2 本地次日 00:30(UTC16:30) 归到本地日期 session-2026-10-02.ndjson', f2 in dir._files);
  const e1 = await loadEvents(dir, '2026-10-01');
  const e2 = await loadEvents(dir, '2026-10-02');
  check('D3 两日分别可回放（10-01=1 条，10-02=1 条）', e1.length === 1 && e2.length === 1, `d1=${e1.length} d2=${e2.length}`);
  check('D3b ts 仍为 UTC ISO（仅文件名按本地日期）', e1[0].ts === '2026-10-01T15:30:00.000Z', e1[0].ts);
}

// ───────────────────────── 汇总 ─────────────────────────
console.log(`\n=== 汇总：断言 ${results.filter((r) => !r.observe).length} 项，${results.filter((r) => !r.observe).length - failures} 通过，${failures} 失败；观察项 ${observes} ===`);
const summary = { asserts: results.filter((r) => !r.observe).length, passed: results.filter((r) => !r.observe).length - failures, failed: failures, observes, failures: results.filter((r) => !r.pass) };
console.log('QA_CHAT2_SUMMARY ' + JSON.stringify(summary));
process.exitCode = failures === 0 ? 0 : 1;
