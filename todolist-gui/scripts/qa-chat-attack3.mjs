// M2-Chat 第三轮复验脚本（严过关编写）
// 独立复验 R2-1（抢词修复）/ R2-2（关键词过滤 + 0命中澄清闭环）/ 已完成三分支。
// 运行：npm run test:attack-chat3
//       （= node --import ./scripts/register-qa-loader.mjs ./scripts/qa-chat-attack3.mjs）
// 真实 todo.txt / done.txt 全程只读（全部在内存 fixture 上进行）。

import dayjs from 'dayjs';
import { parseFile, serializeTask, taskFromQuickInput } from '../src/lib/todoParser.js';
import { activeTasks, sortTasks } from '../src/lib/sortFilter.js';
import { parseIntent, detectAction } from '../src/lib/nlRules.js';
import { dispatch } from '../src/lib/actions.js';

const results = [];
let failures = 0;
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
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
const { useChatAgent } = await import('../src/hooks/useChatAgent.js');

async function bootStore(seed) {
  __resetHooks();
  installBrowserStubs(seed);
  const render = () => { __beginRender(); const api = useTodoStore(); __flushEffects(); return api; };
  let store = render();
  await store.pickDirectory();
  await sleep(5);
  store = render();
  return { store, render };
}
// 同时驱动 store + chat agent
async function bootChat(seed) {
  __resetHooks();
  const fs = installBrowserStubs(seed);
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
  return { r, render, fs };
}
const seed = () => ({ 'todo.txt': FIXTURE_TODO, 'done.txt': FIXTURE_DONE });

// ───────────────────────── E. R2-1 抢词修复（title 与序列化行正确） ─────────────────────────
console.log('\n=== E. R2-1 抢词修复：带 add 前缀 + 标题含查询动词 => add 且标题/序列化正确 ===');
{
  const cases = [
    ['加一条 列出购物清单', '列出购物清单'],
    ['添加 看看装修方案', '看看装修方案'],
    ['新增 查看体检报告', '查看体检报告'],
    ['记一下 搜索优化方案', '搜索优化方案'],
    ['加 查看统计', '查看统计'],
    ['加一条 逾期账单提醒', '逾期账单提醒'],
  ];
  for (const [txt, expectTitle] of cases) {
    const got = detectAction(txt);
    const r = R(txt);
    const title = r.slots && r.slots.title;
    check(`E1 「${txt}」=> add 且 title=「${expectTitle}」（查询动词未被剥除）`,
      got === 'add' && r.intent === 'add' && title === expectTitle,
      `detectAction=${got} intent=${r.intent} title=${JSON.stringify(title)}`);
  }
  // 端到端序列化：经真实 store.addTask 后行内容正确
  const { store, render } = await bootStore(seed());
  const addOne = async (txt) => {
    const tasks = sortTasks(activeTasks(store.todoEntries), store.sortMode);
    const intent = parseIntent(txt, { tasks, today: TD });
    if (intent.intent !== 'add' || intent.confidence === 'low') return null;
    dispatch(intent, { store, tasks, today: TD });
    await sleep(15);
    const s = render();
    return s.todoEntries[s.todoEntries.length - 1];
  };
  const t1 = await addOne('加一条 列出购物清单');
  // 创建日期由 store.addTask 用真实系统时钟（dayjs()）写入 —— 断言必须同源，
  // 不能写死字面量，否则脚本只在"系统日期恰为某天"时才通过（时钟耦合）。
  check('E2 端到端：新增行 = <今天> 列出购物清单（无丢字/无 (B)）',
    t1 && serializeTask(t1) === `${dayjs().format('YYYY-MM-DD')} 列出购物清单`, `line=${t1 && JSON.stringify(serializeTask(t1))}`);
  const t2 = await addOne('添加 逾期账单提醒');
  check('E2b 端到端：新增行 = <今天> 逾期账单提醒',
    t2 && serializeTask(t2) === `${dayjs().format('YYYY-MM-DD')} 逾期账单提醒`, `line=${t2 && JSON.stringify(serializeTask(t2))}`);
}

// ───────────────────────── F. 反向：命令不得被抢 ─────────────────────────
console.log('\n=== F. 反向：明确命令不得被判 query ===');
{
  const cases = [
    ['完成 回测报告', 'complete'],
    ['搞定 第2条', 'complete'],
    ['删除 列出 的任务', 'delete'],
    ['勾掉 看看报告', 'complete'],
    ['延期到明天 回测报告', 'postpone'],
    ['标为高 回测报告', 'setPriority'],
  ];
  for (const [txt, expect] of cases) {
    const got = detectAction(txt);
    const r = R(txt);
    check(`F1 「${txt}」=> ${expect}`, got === expect && r.intent === expect, `detectAction=${got} intent=${r.intent}`);
  }
  const rp = R('延期到明天 回测报告');
  check('F2 postpone 仍解析出时间词 明天=2026-10-02', rp.intent === 'postpone' && rp.slots.dueDate === '2026-10-02',
    `intent=${rp.intent} due=${rp.slots.dueDate}`);
}

// ───────────────────────── G. 「已完成 X」三分支 ─────────────────────────
console.log('\n=== G. 「已完成」三分支 ===');
{
  const g1 = R('已完成');
  check('G1 「已完成」=> query scope=done', g1.intent === 'query' && g1.scope === 'done', `intent=${g1.intent} scope=${g1.scope}`);

  const g2 = R('已完成 回测报告');
  check('G2 「已完成 回测报告」残余词命中活跃任务 => complete',
    g2.intent === 'complete' && g2.matches.length >= 1,
    `intent=${g2.intent} matches=${JSON.stringify(g2.matches)} conf=${g2.confidence}`);

  const g3 = R('有哪些任务已完成');
  check('G3 「有哪些任务已完成」=> query scope=done', g3.intent === 'query' && g3.scope === 'done', `intent=${g3.intent} scope=${g3.scope}`);

  // 端到端：G3 返回 doneEntries 内容
  const { store } = await bootStore(seed());
  const res = dispatch(g3, { store, tasks: activeTasks(store.todoEntries), today: TD });
  check('G3b 端到端：返回 doneEntries 两条内容',
    res.tool.status === 'ok' && res.reply.includes('安装 topydo 并跑通三种 UI') && res.reply.includes('编写安装配置指南'),
    `summary=${JSON.stringify(res.reply.split('\n')[0])} count=${res.tool.params.count}`);
}

// ───────────────────────── H. R2-2 关键词过滤 ─────────────────────────
console.log('\n=== H. R2-2 查询关键词过滤 ===');
{
  const { store } = await bootStore(seed());
  const runQuery = (txt) => {
    const tasks = sortTasks(activeTasks(store.todoEntries), store.sortMode);
    const intent = parseIntent(txt, { tasks, today: TD });
    const res = dispatch(intent, { store, tasks, today: TD });
    return { intent, res, tasks };
  };

  const h1 = runQuery('列出 回测');
  const h1lines = h1.res.reply.split('\n').slice(1);
  // 注意：任务(C)的「+回测」是【项目标签】而非标题，故标题含“回测”的仅 1 条。
  check('H1 「列出 回测」仅返回标题含“回测”的任务（过滤生效，非全部 9 条）',
    h1.res.tool.params.count === 1 && h1lines.length === 1 && h1lines.every((l) => l.includes('回测')),
    `count=${h1.res.tool.params.count} lines=${JSON.stringify(h1lines)}`);

  const h2 = runQuery('列出 @投资');
  check('H2 「列出 @投资」仅 @投资 范围（1 条）',
    h2.res.tool.params.count === 1 && h2.res.reply.includes('带截止日的周线复盘'),
    `count=${h2.res.tool.params.count} context=${h2.res.tool.params.context}`);

  const h3 = runQuery('列出@工作');
  check('H3 「列出@工作」无空格 => context=工作（1 条）',
    h3.intent.slots.context === '工作' && h3.res.tool.params.count === 1 && h3.res.reply.includes('带上下文的任务'),
    `context=${h3.intent.slots.context} count=${h3.res.tool.params.count}`);
}

// ───────────────────────── I. 0命中澄清闭环（端到端，fixture） ─────────────────────────
console.log('\n=== I. 0 命中澄清闭环：列出<不存在> → 澄清 → 是/否 ===');
{
  const KW = '完全不存在的任务名';
  // I-a 回「是」→ 真的新建
  {
    const { render, fs } = await bootChat(seed());
    let r = render();
    const before = r.store.todoEntries.filter((e) => e.kind === 'task').length;
    await r.agent.send(`列出 ${KW}`);
    await sleep(20);
    r = render();
    const pendingOk = r.agent.pending && r.agent.pending.kind === 'create' && r.agent.pending.keyword === KW;
    const lastAgent = [...r.agent.messages].reverse().find((m) => m.role === 'agent');
    check('I1 「列出 <不存在>」=> 澄清文案 + pending(create)',
      pendingOk && lastAgent && lastAgent.text.includes('你是想新建'),
      `pending=${JSON.stringify(r.agent.pending)} reply=${JSON.stringify(lastAgent && lastAgent.text.slice(0, 40))}`);
    await r.agent.send('是');
    await sleep(30);
    r = render();
    const after = r.store.todoEntries.filter((e) => e.kind === 'task');
    const created = after[after.length - 1];
    check('I2 回「是」=> 真的新建同名任务（行数 +1、标题正确）',
      after.length === before + 1 && created && created.title === KW,
      `before=${before} after=${after.length} title=${created && created.title}`);
    // 落盘校验
    await sleep(650);
    const fileLines = fs['todo.txt'].split('\n').filter(Boolean).length;
    check('I2b 新建已落盘（todo.txt 行数 = 原 9 + 1）', fileLines === 10, `fileLines=${fileLines}`);
  }
  // I-b 回「否」→ 取消且无写入
  {
    const { render, fs } = await bootChat(seed());
    let r = render();
    const before = r.store.todoEntries.filter((e) => e.kind === 'task').length;
    await r.agent.send(`列出 ${KW}`);
    await sleep(20);
    r = render();
    const pendingOk = r.agent.pending && r.agent.pending.kind === 'create';
    await r.agent.send('否');
    await sleep(650);
    r = render();
    const after = r.store.todoEntries.filter((e) => e.kind === 'task').length;
    const fileLines = fs['todo.txt'].split('\n').filter(Boolean).length;
    check('I3 回「否」=> 取消、不产生任何写入（行数不变）',
      pendingOk && after === before && fileLines === 9,
      `before=${before} after=${after} fileLines=${fileLines}`);
  }
  // I-c 处于 create 澄清时输入「另一条命令」→ 应作为全新输入重新解析并真正执行。
  //     （旧实现把非"是/否"一律当"未确认"取消，会丢弃新命令；行为已按设计有意改变。）
  {
    const { render } = await bootChat(seed());
    let r = render();
    const before = r.store.todoEntries.filter((e) => e.kind === 'task').length;
    await r.agent.send(`列出 ${KW}`);
    await sleep(20);
    r = render();
    const pendingOk = r.agent.pending && r.agent.pending.kind === 'create';
    await r.agent.send('加一条 明天 交周报');
    await sleep(40);
    r = render();
    const after = r.store.todoEntries.filter((e) => e.kind === 'task');
    const lastAgent = [...r.agent.messages].reverse().find((m) => m.role === 'agent');
    check('I4 create 澄清中输入新命令 => 作为新输入重新解析并真正新建「交周报」（不再当“未确认”丢弃）',
      pendingOk &&
        after.length === before + 1 &&
        after.some((e) => e.title === '交周报') &&
        !/没有?确认/.test(lastAgent.text),
      `pending=${pendingOk} before=${before} after=${after.length} reply=${JSON.stringify(lastAgent.text.slice(0, 30))}`);
  }
  // I-d 反向：明确否认（「不是」）仍必须取消，且不解析新命令、不产生写入。
  {
    const { render, fs } = await bootChat(seed());
    let r = render();
    const before = r.store.todoEntries.filter((e) => e.kind === 'task').length;
    await r.agent.send(`列出 ${KW}`);
    await sleep(20);
    r = render();
    const pendingOk = r.agent.pending && r.agent.pending.kind === 'create';
    await r.agent.send('不是');
    await sleep(650);
    r = render();
    const after = r.store.todoEntries.filter((e) => e.kind === 'task');
    const lastAgent = [...r.agent.messages].reverse().find((m) => m.role === 'agent');
    const fileLines = fs['todo.txt'].split('\n').filter(Boolean).length;
    check('I5 create 澄清中明确否认「不是」=> 取消、不解析、不写入（行数不变）',
      pendingOk &&
        after.length === before &&
        fileLines === 9 &&
        !after.some((e) => e.title === '交周报') &&
        /跳过|取消/.test(lastAgent.text),
      `before=${before} after=${after.length} fileLines=${fileLines} reply=${JSON.stringify(lastAgent.text.slice(0, 30))}`);
  }
}

// ───────────────────────── 汇总 ─────────────────────────
console.log(`\n=== 汇总：${results.length - failures}/${results.length} 通过，${failures} 失败 ===`);
const summary = { total: results.length, passed: results.length - failures, failed: failures, failures: results.filter((r) => !r.pass) };
console.log('QA_CHAT3_SUMMARY ' + JSON.stringify(summary));
process.exitCode = failures === 0 ? 0 : 1;
