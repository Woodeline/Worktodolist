// actions 集成测试：用真实解析/序列化函数 + 内存 store 替身验证 AC 语义；
// 并直接驱动【真实 useTodoStore】（经 react 替身）验证 add 的逆操作。
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 文件级替换 react → 极简 hooks 替身（作用域仅限本文件），用于在 node 环境驱动真实 useTodoStore。
vi.mock('react', () => import('../../scripts/qa-react-shim.mjs'));

import { __beginRender, __flushEffects, __resetHooks } from '../../scripts/qa-react-shim.mjs';
import { useTodoStore } from '../hooks/useTodoStore.js';
import { dispatch } from './actions.js';
import { parseIntent } from './nlRules.js';
import { activeTasks } from './sortFilter.js';
import {
  applyPatch,
  completeTask,
  parseFile,
  reviveTask,
  serializeTask,
  taskFromQuickInput,
} from './todoParser.js';

const TODAY = '2026-10-01';

const TODO_FIXTURE = [
  '(A) 2026-09-20 逾期任务：季报复核 due:2026-09-25',
  '(B) 2026-09-20 今天到期：写第 10 周回测报告 due:2026-09-30',
  '(C) 2026-09-20 有项目标签的任务 +回测 due:2026-10-10',
  '(D) 2026-09-20 星标任务 star:1',
  '(E) 2026-09-20 未来才开始的任务 t:2026-10-05',
  '(F) 2026-09-20 普通任务没有任何标签',
  '2026-09-30 带上下文的任务 @工作 +量化 due:2026-10-08',
  '2026-09-30 收集箱任务：无任何标记的裸任务',
  '(B) 2026-09-30 带截止日的周线复盘 @投资 +复盘 due:2026-10-04',
].join('\n');

// 复用真实序列化/解析逻辑的 store 替身。
function makeStore() {
  let todo = parseFile(TODO_FIXTURE);
  let done = [];
  return {
    get todoEntries() {
      return todo;
    },
    get doneEntries() {
      return done;
    },
    addTask(input) {
      const task = taskFromQuickInput(input, TODAY);
      todo = [...todo, task];
      return task;
    },
    toggleComplete(task) {
      if (task.completed) {
        todo = todo.map((e) => (e.id === task.id ? reviveTask(e) : e));
        done = done.filter((e) => e.id !== task.id);
      } else {
        todo = todo.filter((e) => e.id !== task.id);
        done = [...done, completeTask(task, TODAY)];
      }
    },
    deleteTask(task) {
      todo = todo.filter((e) => e.id !== task.id);
    },
    updateTask(id, patch) {
      todo = todo.map((e) => (e.id === id && e.kind === 'task' ? applyPatch(e, patch) : e));
    },
    undo() {},
  };
}

function agent(store) {
  return (text) => {
    const list = activeTasks(store.todoEntries);
    const intent = parseIntent(text, { tasks: list, today: TODAY });
    // 镜像 useChatAgent 的分发策略：unknown 或低置信度（需澄清）时不执行动作。
    const shouldRun = intent.intent !== 'unknown' && intent.confidence === 'high';
    const result = shouldRun ? dispatch(intent, { store, tasks: list, today: TODAY }) : null;
    return { intent, result };
  };
}

describe('actions 集成：AC 语义', () => {
  it('AC-C1 add：不写默认优先级，与列表页 QuickAdd 逐字符同构', () => {
    const store = makeStore();
    const run = agent(store);
    const { result } = run('加一条 明天下午 交周报');
    expect(result.tool.name).toBe('todo.add');
    expect(result.tool.status).toBe('ok');
    const added = store.todoEntries[store.todoEntries.length - 1];
    // 对话新建的行必须与列表页 QuickAdd（taskFromQuickInput）生成的完全一致，且不含 (B)。
    const quick = taskFromQuickInput('交周报 due:2026-10-02', TODAY);
    expect(serializeTask(added)).toBe(serializeTask(quick));
    expect(serializeTask(added)).toBe('2026-10-01 交周报 due:2026-10-02');
  });

  it('AC-C2 complete：done.txt 追加 x 行', () => {
    const store = makeStore();
    const run = agent(store);
    const { intent, result } = run('完成 回测报告');
    expect(intent.confidence).toBe('high');
    expect(result.tool.name).toBe('todo.complete');
    expect(result.tool.params.title).toBe('今天到期：写第 10 周回测报告');
    expect(store.doneEntries).toHaveLength(1);
    expect(serializeTask(store.doneEntries[0])).toContain('x 2026-10-01');
  });

  it('AC-C3 complete 多命中：低置信度不执行', () => {
    const store = makeStore();
    const run = agent(store);
    const { intent } = run('完成 任务');
    expect(intent.confidence).toBe('low');
    expect(intent.matches.length).toBeGreaterThan(1);
    // 未执行任何动作
    expect(store.doneEntries).toHaveLength(0);
    expect(store.todoEntries.filter((e) => e.kind === 'task')).toHaveLength(9);
  });

  it('AC-C4 postpone：due 改为 2026-10-07', () => {
    const store = makeStore();
    const run = agent(store);
    run('把 回测报告 延到下周三');
    const t = store.todoEntries.find((e) => e.title === '今天到期：写第 10 周回测报告');
    expect(t.dueDate).toBe('2026-10-07');
  });

  it('AC-C5 setPriority：优先级变为 A', () => {
    const store = makeStore();
    const run = agent(store);
    const { result } = run('标为高 回测报告');
    expect(result.tool.name).toBe('todo.setPriority');
    const t = store.todoEntries.find((e) => e.title === '今天到期：写第 10 周回测报告');
    expect(t.priority).toBe('A');
  });

  it('AC-C6 query：回复编号列表与快照一致', () => {
    const store = makeStore();
    const run = agent(store);
    const { result } = run('有哪些任务');
    expect(result.tool.name).toBe('todo.query');
    const lines = result.reply.split('\n');
    expect(lines[0]).toBe('共 9 条活跃任务：');
    expect(lines[1].startsWith('1. ')).toBe(true);
    expect(lines).toHaveLength(10);
  });

  it('AC-C8 unknown：无工具调用', () => {
    const store = makeStore();
    const run = agent(store);
    const { intent } = run('今天天气怎么样');
    expect(intent.intent).toBe('unknown');
  });

  it('AC-C10 undo：复用 store.undo 并返回 todo.undo 卡片', () => {
    const store = makeStore();
    let undone = false;
    store.undo = () => {
      undone = true;
    };
    const run = agent(store);
    const { result } = run('撤销');
    expect(result.tool.name).toBe('todo.undo');
    expect(undone).toBe(true);
  });

  it('R2-2 查询残余关键词过滤命中', () => {
    const store = makeStore();
    const run = agent(store);
    const { result } = run('列出 回测');
    expect(result.tool.name).toBe('todo.query');
    expect(result.tool.params.keyword).toBe('回测');
    expect(result.reply).toContain('回测报告');
    expect(result.reply).not.toContain('星标任务');
  });

  it('R2-2 查询 0 命中 → 澄清并带 clarify.create', () => {
    const store = makeStore();
    const run = agent(store);
    const { intent, result } = run('列出 完全不存在的任务名');
    expect(intent.intent).toBe('query');
    expect(intent.slots.keyword).toBeTruthy();
    expect(result.reply).toContain('没找到匹配');
    expect(result.clarify).toEqual({ kind: 'create', keyword: intent.slots.keyword });
  });

  it('R2：带 add 触发词的标题含查询动词仍是 add', () => {
    const store = makeStore();
    const run = agent(store);
    const { intent, result } = run('加一条 列出购物清单');
    expect(intent.intent).toBe('add');
    expect(result.tool.name).toBe('todo.add');
    const added = store.todoEntries.find((e) => e.title === '列出购物清单');
    expect(added).toBeTruthy();
  });
});

// —— 真实 useTodoStore 的“新增”逆操作验证 —— //

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 浏览器 API 替身：目录句柄 / 文件读写 / IndexedDB（与 useTodoStore.test.js 同构，本文件独立作用域）。
function installBrowserStubs(seed) {
  const fs = { ...seed };
  const makeFileHandle = (name, map) => ({
    async getFile() {
      return {
        async text() {
          return map[name] ?? '';
        },
      };
    },
    async createWritable() {
      return {
        async write(t) {
          map[name] = t;
        },
        async close() {},
      };
    },
  });
  const makeDir = (map) => ({
    async getFileHandle(name, opt) {
      if (!(name in map)) {
        if (opt && opt.create) map[name] = '';
        else {
          const e = new Error('NotFound');
          e.name = 'NotFoundError';
          throw e;
        }
      }
      return makeFileHandle(name, map);
    },
    async getDirectoryHandle(name, opt) {
      if (!(name in map) && !(opt && opt.create)) {
        const e = new Error('NotFound');
        e.name = 'NotFoundError';
        throw e;
      }
      if (!(name in map)) map[name] = '__dir__';
      return makeDir({});
    },
    async queryPermission() {
      return 'granted';
    },
    async requestPermission() {
      return 'granted';
    },
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
          const store = {
            put: () => ({ result: undefined }),
            get: () => ({ result: null }),
            delete: () => ({ result: undefined }),
          };
          const tx = { objectStore: () => store, oncomplete: null, onerror: null, onabort: null };
          setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
          return tx;
        },
      };
      setTimeout(() => {
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
  return fs;
}

async function bootRealStore(seed = { 'todo.txt': '', 'done.txt': '' }) {
  __resetHooks();
  installBrowserStubs(seed);
  const render = () => {
    __beginRender();
    const api = useTodoStore();
    __flushEffects();
    return api;
  };
  let store = render();
  await store.pickDirectory();
  await sleep(5);
  store = render();
  return { store, render };
}

describe('store.undo 支持“新增”的逆操作（真实 useTodoStore）', () => {
  beforeEach(() => {
    __resetHooks();
  });

  it('新增 → 撤销 → 任务从 todo 消失', async () => {
    const { store, render } = await bootRealStore();
    const task = store.addTask('交周报');
    expect(task).toBeTruthy();
    let s = render();
    expect(s.todoEntries.filter((e) => e.kind === 'task')).toHaveLength(1);
    s.undo();
    s = render();
    expect(s.todoEntries.filter((e) => e.kind === 'task')).toHaveLength(0);
  });

  it('新增 → 完成 → 撤销 → 不抛异常、不产生重复条目', async () => {
    const { store, render } = await bootRealStore();
    const task = store.addTask('交周报');
    store.toggleComplete(task);
    await sleep(260);
    store.undo();
    await sleep(20);
    const s = render();
    const titles = s.todoEntries.filter((e) => e.kind === 'task').map((e) => e.title);
    expect(titles.filter((t) => t === '交周报')).toHaveLength(1);
    expect(s.doneEntries.filter((e) => e.kind === 'task')).toHaveLength(0);
  });

  it('连续撤销（空栈）不抛异常', async () => {
    const { store, render } = await bootRealStore();
    store.addTask('临时');
    store.undo();
    expect(() => store.undo()).not.toThrow();
    const s = render();
    expect(s.todoEntries.filter((e) => e.kind === 'task')).toHaveLength(0);
  });
});
