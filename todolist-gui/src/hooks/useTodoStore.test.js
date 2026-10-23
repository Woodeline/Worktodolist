// useTodoStore 撤销/竞态回归测试（零新增依赖）
// 通过 vi.mock('react') 注入极简 hooks 替身（scripts/qa-react-shim.mjs），
// 在 vitest 的 node 环境下直接驱动【真实 useTodoStore】，无需 jsdom / testing-library。
// 注意：vi.mock('react') 为文件级替换，作用域仅限本文件，不会泄漏到其它测试文件。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => import('../../scripts/qa-react-shim.mjs'));

import { __beginRender, __flushEffects, __resetHooks } from '../../scripts/qa-react-shim.mjs';
import { useTodoStore } from './useTodoStore.js';

const SEED = {
  'todo.txt': '(A) 2026-09-01 任务A\n(B) 2026-09-01 任务B\n(C) 2026-09-01 任务C\n',
  'done.txt': '',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 浏览器 API 替身：目录句柄 / 文件读写 / IndexedDB / 事件监听（可手动触发）
function installBrowserStubs(seed) {
  const fs = { ...seed };
  const listeners = { win: {}, doc: {} };
  const track = (bucket, type, fn) => {
    if (!bucket[type]) bucket[type] = [];
    bucket[type].push(fn);
  };
  const untrack = (bucket, type, fn) => {
    bucket[type] = (bucket[type] || []).filter((f) => f !== fn);
  };
  const makeFileHandle = (name, map) => ({
    async getFile() {
      return { async text() { return map[name] ?? ''; } };
    },
    async createWritable() {
      return { async write(t) { map[name] = t; }, async close() {} };
    },
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
    addEventListener(type, fn) { track(listeners.win, type, fn); },
    removeEventListener(type, fn) { untrack(listeners.win, type, fn); },
  };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener(type, fn) { track(listeners.doc, type, fn); },
    removeEventListener(type, fn) { untrack(listeners.doc, type, fn); },
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
  const fire = {
    document: (type) => { (listeners.doc[type] || []).forEach((fn) => fn()); },
    window: (type) => { (listeners.win[type] || []).forEach((fn) => fn()); },
  };
  return { fs, fire };
}

function makeRenderer() {
  return () => { __beginRender(); const api = useTodoStore(); __flushEffects(); return api; };
}

async function bootStore(seed = SEED) {
  __resetHooks();
  const { fs, fire } = installBrowserStubs(seed);
  const render = makeRenderer();
  let store = render();
  await store.pickDirectory();
  await sleep(5);
  store = render();
  return { store, render, fs, fire };
}

const byTitle = (entries, title) => entries.find((e) => e.title === title);

beforeEach(() => {
  __resetHooks();
});

describe('useTodoStore 撤销链路 / fade 窗口竞态', () => {
  it('C1 完成后 180ms 内撤销应恢复原任务且 done 清空', async () => {
    const { store, render } = await bootStore();
    const a = store.todoEntries[0];
    store.toggleComplete(a);
    store.undo(); // 在 fade 窗口内撤销
    await sleep(260);
    const s = render();
    expect(s.todoEntries).toHaveLength(3);
    expect(s.doneEntries).toHaveLength(0);
    expect(s.todoEntries.filter((e) => e.id === a.id)).toHaveLength(1);
  });

  it('C2 180ms 内双击完成不应产生重复 done 条目', async () => {
    const { store, render } = await bootStore();
    const a = store.todoEntries[0];
    store.toggleComplete(a);
    store.toggleComplete(a);
    await sleep(320);
    const s = render();
    expect(s.doneEntries).toHaveLength(1);
    const ids = s.doneEntries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('C3 删除A → 完成B → 连续撤销两次应完全还原', async () => {
    const { store, render } = await bootStore();
    const A = store.todoEntries[0];
    store.deleteTask(A);
    let s = render();
    store.toggleComplete(byTitle(s.todoEntries, '任务B'));
    await sleep(260);
    store.undo();
    store.undo();
    await sleep(20);
    s = render();
    expect(s.todoEntries).toHaveLength(3);
    expect(s.doneEntries).toHaveLength(0);
    expect(s.todoEntries.map((e) => e.title).sort()).toEqual(['任务A', '任务B', '任务C']);
  });

  it('C4 handle 为 null 时 resolveConflictKeepLocal 不抛未捕获异常', async () => {
    __resetHooks();
    installBrowserStubs(SEED);
    const store = makeRenderer()(); // 未选择目录
    await expect(store.resolveConflictKeepLocal()).resolves.toBeUndefined();
  });

  it('C5 撤销后（提交前）todo 内不应出现同 id 副本', async () => {
    const { store, render } = await bootStore();
    const a = store.todoEntries[0];
    store.toggleComplete(a);
    store.undo();
    const s = render();
    expect(s.todoEntries.filter((e) => e.id === a.id)).toHaveLength(1);
  });

  it('C6 完成(窗口内) → 删除 → 撤销删除 → 撤销完成 不重复插入', async () => {
    const { store, render } = await bootStore();
    const T = byTitle(store.todoEntries, '任务B');
    store.toggleComplete(T);
    store.deleteTask(T);
    await sleep(260);
    store.undo(); // 撤销删除
    store.undo(); // 再撤销完成
    await sleep(20);
    const s = render();
    expect(s.todoEntries.filter((e) => e.id === T.id)).toHaveLength(1);
    expect(s.todoEntries).toHaveLength(3);
    expect(s.doneEntries).toHaveLength(0);
  });

  it('C7 完成(窗口内) → 删除：done 不得残留被删任务', async () => {
    const { store, render } = await bootStore();
    const T = byTitle(store.todoEntries, '任务B');
    store.toggleComplete(T);
    store.deleteTask(T);
    await sleep(260);
    const s = render();
    expect(s.doneEntries).toHaveLength(0);
    expect(s.todoEntries).toHaveLength(2);
    expect(s.todoEntries.some((e) => e.id === T.id)).toBe(false);
  });

  it('C8 正常完成（已提交）后撤销应移回 todo', async () => {
    const { store, render } = await bootStore();
    const T = byTitle(store.todoEntries, '任务B');
    store.toggleComplete(T);
    await sleep(260);
    let s = render();
    expect(s.doneEntries).toHaveLength(1);
    expect(s.todoEntries.some((e) => e.id === T.id)).toBe(false);
    store.undo();
    await sleep(20);
    s = render();
    expect(s.todoEntries).toHaveLength(3);
    expect(s.doneEntries).toHaveLength(0);
  });

  // —— P0-1：关窗/转后台丢最后一步的回归 ——

  it('C9 改动未落盘时页面转 hidden 应立即刷盘', async () => {
    const { store, render, fs, fire } = await bootStore();
    const a = store.todoEntries[0];
    store.toggleComplete(a);
    await sleep(220); // 越过 fade 窗口(180ms)，commit 已发生、防抖(200ms)未到
    let s = render(); // shim 不会自动重渲染，需手动取新快照
    expect(s.saveStatus).toBe('unsaved');
    expect(fs['done.txt']).not.toContain('任务A'); // 防抖期内确实还没写盘
    globalThis.document.visibilityState = 'hidden';
    fire.document('visibilitychange');
    await sleep(40);
    expect(fs['done.txt']).toContain('任务A'); // flush 生效，不等防抖
    expect(fs['todo.txt']).not.toContain('任务A');
    s = render();
    expect(s.saveStatus).toBe('saved');
    globalThis.document.visibilityState = 'visible';
  });

  it('C10 不转后台时改动也会在防抖窗口后正常落盘', async () => {
    const { store, fs } = await bootStore();
    const a = store.todoEntries[0];
    store.toggleComplete(a);
    await sleep(420); // fade(180) + 防抖(200) + 余量
    expect(fs['done.txt']).toContain('任务A');
    expect(fs['todo.txt']).not.toContain('任务A');
  });
});

// ——— 稳定 ID 的分配时机 ———
// 这三条锁的是「谁在什么时候拿到 ID」。分配太早（一次性改写全文件）会让
// git 记下一次谁也看不懂的大 diff；分配太晚（用到才现编）会让引用关系指空。
describe('useTodoStore 稳定 ID 分配', () => {
  it('新建任务自带 id:，并真的落进 todo.txt', async () => {
    const { store, render, fs } = await bootStore();
    const created = store.addTask('写周报 +投资');
    expect(created.stableId).toMatch(/^[0-9a-z]{6}$/);
    await sleep(320);
    const s = render();
    expect(byTitle(s.todoEntries, '写周报').stableId).toBe(created.stableId);
    expect(fs['todo.txt']).toContain(`id:${created.stableId}`);
  });

  it('编辑一条没有 ID 的老任务时，顺手给它补一个', async () => {
    const { store, render } = await bootStore();
    const a = store.todoEntries[0];
    expect(a.stableId).toBeNull();
    store.updateTask(a.id, { priority: 'A' });
    const s = render();
    expect(s.todoEntries.find((e) => e.id === a.id).stableId).toMatch(/^[0-9a-z]{6}$/);
  });

  it('没被碰过的老任务不会跟着变（渐进补齐，不改写整个文件）', async () => {
    const { store, render, fs } = await bootStore();
    store.addTask('新任务');
    await sleep(320);
    const s = render();
    const untouched = s.todoEntries.filter((e) => e.title.startsWith('任务'));
    expect(untouched).toHaveLength(3);
    expect(untouched.every((e) => e.stableId === null)).toBe(true);
    // 文件里也只有那一条新任务带 id:
    const lines = fs['todo.txt'].split('\n').filter((l) => l.includes('id:'));
    expect(lines).toHaveLength(1);
  });

  it('新建的 ID 不与既有 ID 撞（SEED 里预置一个）', async () => {
    const { store, render } = await bootStore({
      'todo.txt': '老任务 id:aaa111\n',
      'done.txt': '',
    });
    const created = store.addTask('新任务');
    expect(created.stableId).not.toBe('aaa111');
    expect(created.stableId).toMatch(/^[0-9a-z]{6}$/);
    const s = render();
    const ids = s.todoEntries.map((e) => e.stableId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('useTodoStore 子任务', () => {
  it('给没有 ID 的老任务加子任务：父当场补 ID，子挂上去', async () => {
    const { store, render, fs } = await bootStore();
    const parent = store.todoEntries[0];
    expect(parent.stableId).toBeNull();
    const kid = store.addSubtask(parent.id, '子任务一');
    const s = render();
    const parent2 = s.todoEntries.find((e) => e.id === parent.id);
    expect(parent2.stableId).toMatch(/^[0-9a-z]{6}$/);
    expect(kid.parentId).toBe(parent2.stableId);
    await sleep(320);
    expect(fs['todo.txt']).toContain(`id:${parent2.stableId}`);
    expect(fs['todo.txt']).toContain(`parent:${parent2.stableId}`);
  });

  it('父已经有 ID 时直接挂上，不动父的 ID', async () => {
    const { store, render } = await bootStore({ 'todo.txt': '装机 id:aaa111\n', 'done.txt': '' });
    const parent = store.todoEntries[0];
    const kid = store.addSubtask(parent.id, '拆后盖');
    expect(kid.parentId).toBe('aaa111');
    const s = render();
    expect(s.todoEntries.find((e) => e.id === parent.id).stableId).toBe('aaa111');
  });

  it('删父不带走子任务（它们降级为独立任务）', async () => {
    const { store, render, fs } = await bootStore({ 'todo.txt': '装机 id:aaa111\n', 'done.txt': '' });
    const parent = store.todoEntries[0];
    store.addSubtask(parent.id, '拆后盖');
    store.deleteTask(parent);
    await sleep(320);
    const s = render();
    const titles = s.todoEntries.map((e) => e.title);
    expect(titles).toContain('拆后盖'); // 没被连带删掉
    expect(titles).not.toContain('装机');
  });
});

describe('useTodoStore 子任务', () => {
  it('给没有 ID 的老任务加子任务：父当场补 ID，子挂上去', async () => {
    const { store, render, fs } = await bootStore();
    const parent = store.todoEntries[0];
    expect(parent.stableId).toBeNull();
    const kid = store.addSubtask(parent.id, '子任务一');
    const s = render();
    const parent2 = s.todoEntries.find((e) => e.id === parent.id);
    expect(parent2.stableId).toMatch(/^[0-9a-z]{6}$/);
    expect(kid.parentId).toBe(parent2.stableId);
    await sleep(320);
    expect(fs['todo.txt']).toContain(`id:${parent2.stableId}`);
    expect(fs['todo.txt']).toContain(`parent:${parent2.stableId}`);
  });

  it('父已经有 ID 时直接挂上，不动父的 ID', async () => {
    const { store, render } = await bootStore({ 'todo.txt': '装机 id:aaa111\n', 'done.txt': '' });
    const parent = store.todoEntries[0];
    const kid = store.addSubtask(parent.id, '拆后盖');
    expect(kid.parentId).toBe('aaa111');
    const s = render();
    expect(s.todoEntries.find((e) => e.id === parent.id).stableId).toBe('aaa111');
  });

  it('删父不带走子任务（它们降级为独立任务）', async () => {
    const { store, render, fs } = await bootStore({ 'todo.txt': '装机 id:aaa111\n', 'done.txt': '' });
    const parent = store.todoEntries[0];
    store.addSubtask(parent.id, '拆后盖');
    store.deleteTask(parent);
    await sleep(320);
    const s = render();
    const titles = s.todoEntries.map((e) => e.title);
    expect(titles).toContain('拆后盖'); // 没被连带删掉
    expect(titles).not.toContain('装机');
  });
});

// ——— 重复规则：完成时生成下一次 ———
// 这一组锁的是「完成一条之后，仓库里应该剩下什么」。重复最容易出的错是静默的：
// 多生成一条（凭空多出一堆任务）、少生成一条（规则失效）、或者撤销后新实例赖着不走。
const pad2 = (n) => String(n).padStart(2, '0');
function isoOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
const REAL_NOW = new Date();
const TODAY = isoOf(REAL_NOW);
function plusDays(n) {
  return isoOf(new Date(REAL_NOW.getTime() + n * 86400000));
}

describe('useTodoStore 重复规则', () => {
  it('完成重复任务：原任务进 done，下一次自动生成且 due 推进一个周期', async () => {
    const { store, render, fs } = await bootStore({
      'todo.txt': `交周报 due:${TODAY} rec:+1w id:aaa111\n`,
      'done.txt': '',
    });
    store.toggleComplete(store.todoEntries[0]);
    await sleep(320);
    const s = render();
    // 一条走了，一条来了 —— 数量不变，但已经是下一次
    expect(s.todoEntries).toHaveLength(1);
    const spawned = s.todoEntries[0];
    expect(spawned.title).toBe('交周报');
    expect(spawned.dueDate).toBe(plusDays(7));
    expect(spawned.recurrence).toBe('+1w');
    // 下一次是另一条任务：ID 重新分配，绝不能继承（继承会让引用它的人指不准）
    expect(spawned.stableId).not.toBe('aaa111');
    expect(spawned.stableId).toMatch(/^[0-9a-z]{6}$/);
    expect(spawned.id).not.toBe(store.todoEntries[0].id);
    // 原任务进了 done，且带着 rec（历史里它说明这条是重复实例）。
    // 这里断言状态而不是文件内容：fade 后的提交是异步的，
    // 测试替身里的写盘 effect 需要额外 flush，落盘时机不由本用例负责。
    expect(s.doneEntries).toHaveLength(1);
    expect(s.doneEntries[0].raw).toContain('rec:+1w');
    expect(s.doneEntries[0].raw).toContain('id:aaa111');
  });

  it('非重复任务完成不生成任何东西', async () => {
    const { store, render } = await bootStore();
    store.toggleComplete(store.todoEntries[0]);
    await sleep(320);
    expect(render().todoEntries).toHaveLength(2); // 3 条里少了一条，没有多出来的
  });

  it('撤销完成：下一次实例一并撤掉，不留凭空多出来的任务', async () => {
    const { store, render, fs } = await bootStore({
      'todo.txt': `交周报 due:${TODAY} rec:+1d\n`,
      'done.txt': '',
    });
    store.toggleComplete(store.todoEntries[0]);
    await sleep(320);
    expect(render().todoEntries).toHaveLength(1);
    store.undo();
    await sleep(320);
    const s = render();
    expect(s.todoEntries).toHaveLength(1);
    expect(s.todoEntries[0].dueDate).toBe(TODAY); // 原来那条回来了，不是新生成的那条
    expect(fs['done.txt'].trim()).toBe('');
  });

  it('下一次插回原位置，不追加到末尾', async () => {
    const { store, render } = await bootStore({
      'todo.txt': `第一条\n交周报 due:${TODAY} rec:+1w\n最后一条\n`,
      'done.txt': '',
    });
    store.toggleComplete(store.todoEntries[1]);
    await sleep(320);
    const titles = render().todoEntries.map((e) => e.title);
    // 重复任务该在它原来待的地方重新长出来，而不是跑到列表底部
    expect(titles).toEqual(['第一条', '交周报', '最后一条']);
  });
});

// ——— 备注（notes.md）———
// 这一组锁的是「备注挂得住、写得进、不覆盖别人」。备注是唯一放在 todo.txt 之外的数据，
// 所以「读·改·写」是否真的读的是磁盘最新内容，必须有一条断言盯着。
describe('useTodoStore 备注', () => {
  it('保存备注：写进数据目录的 notes.md，正文挂在 stableId 上', async () => {
    const { store, render, fs } = await bootStore({
      'todo.txt': '写周报 id:aaa111\n',
      'done.txt': '',
    });
    await store.saveNote(store.todoEntries[0].id, '记得附上上周的数据');
    await sleep(320);
    expect(fs['notes.md']).toContain('## aaa111');
    expect(fs['notes.md']).toContain('记得附上上周的数据');
    // 内存里也能立刻读到（不用重新加载）
    expect(render().getNote('aaa111')).toContain('上周的数据');
  });

  it('老任务没有 ID 时：先补 ID 再挂备注，备注不会挂空', async () => {
    const { store, render, fs } = await bootStore();
    const task = store.todoEntries[0];
    expect(task.stableId).toBeNull();
    await store.saveNote(task.id, '给老任务的备注');
    await sleep(320);
    const sid = render().todoEntries.find((e) => e.id === task.id).stableId;
    expect(sid).toMatch(/^[0-9a-z]{6}$/);
    expect(fs['notes.md']).toContain(`## ${sid}`);
    expect(fs['notes.md']).toContain('给老任务的备注');
  });

  it('读·改·写：保存一条不动别人同时在外部编辑器改的另一条', async () => {
    const { store, render, fs } = await bootStore({
      'todo.txt': '写周报 id:aaa111\n装机 id:bbb222\n',
      'done.txt': '',
    });
    // 模拟「用户正在外部编辑器里改 notes.md」：磁盘上已经有 bbb222 的一条
    fs['notes.md'] = '# 备注\n\n## bbb222\n\n外部写的内容\n';
    await store.saveNote(store.todoEntries[0].id, '程序写的备注');
    await sleep(320);
    expect(fs['notes.md']).toContain('## aaa111');
    expect(fs['notes.md']).toContain('程序写的备注');
    expect(fs['notes.md']).toContain('外部写的内容'); // 别人的改动没被吃掉
  });

  it('清空备注 = 删掉那一节，不留下空节', async () => {
    const { store, fs } = await bootStore({
      'todo.txt': '写周报 id:aaa111\n',
      'done.txt': '',
    });
    await store.saveNote(store.todoEntries[0].id, '先写点');
    await sleep(320);
    expect(fs['notes.md']).toContain('aaa111');
    await store.saveNote(store.todoEntries[0].id, '');
    await sleep(320);
    expect(fs['notes.md']).not.toContain('aaa111');
  });

  it('启动时把已有的备注读进内存（列表角标靠它）', async () => {
    const { store, render } = await bootStore({
      'todo.txt': '写周报 id:aaa111\n装机 id:bbb222\n',
      'done.txt': '',
      'notes.md': '# 备注\n\n## aaa111\n\n有备注的一条\n',
    });
    const s = render();
    // 只有 aaa111 有备注 —— 角标要按这个集合渲染
    expect(s.noteIds.has('aaa111')).toBe(true);
    expect(s.noteIds.has('bbb222')).toBe(false);
  });
});
