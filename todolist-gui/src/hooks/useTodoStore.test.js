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
