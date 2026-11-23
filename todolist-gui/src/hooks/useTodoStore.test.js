// useTodoStore 撤销/竞态回归测试（零新增依赖）
// 通过 vi.mock('react') 注入极简 hooks 替身（scripts/qa-react-shim.mjs），
// 在 vitest 的 node 环境下直接驱动【真实 useTodoStore】，无需 jsdom / testing-library。
// 注意：vi.mock('react') 为文件级替换，作用域仅限本文件，不会泄漏到其它测试文件。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => import('../../scripts/qa-react-shim.mjs'));

import { __beginRender, __flushEffects, __resetHooks } from '../../scripts/qa-react-shim.mjs';
import { useTodoStore } from './useTodoStore.js';
import { serializeEntries } from '../lib/todoParser.js';

const SEED = {
  'todo.txt': '(A) 2026-09-01 任务A\n(B) 2026-09-01 任务B\n(C) 2026-09-01 任务C\n',
  'done.txt': '',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 浏览器 API 替身：目录句柄 / 文件读写 / IndexedDB / 事件监听（可手动触发）
//
// 2026-11-21（B1 / R-14）替身改造：写入从「直写」改成「write 暂存、close 才提交」。
// 旧替身是 `async write(t) { map[name] = t }` —— 直写、永远成功、永远原子。
// 那正是「I/O 替身永远成功」的根因：真实链路上 `createWritable()` 的失败点在
// `close()`（Chromium 先写交换文件、close 时原子提交），而旧替身连一个失败点
// 都没有，于是「写盘失败」这条路径在单测里从未被走到过。
//
// hooks（可选，测试可以中途改同一个对象的字段）：
//   failOn(name, phase) —— 返回 true 时该次写入失败（phase = 'write' | 'close'）
//   delayMs             —— 每次 close 前等这么久（模拟慢盘）
// control（返回值第三个成员）：
//   hold() / release()  —— 卡住 / 放行所有 close（模拟「写盘在飞」）
//   writes              —— 成功提交的记录 [{ name, text }]，按提交顺序
//   attempts            —— 每次尝试 [{ name, phase, ok }]，按发生顺序（含失败）
//   maxConcurrent       —— 同时打开的写入句柄峰值（串行闸门的直接证据）
//   resetConcurrency()  —— 清零峰值计数
function installBrowserStubs(seed, hooks = {}) {
  const fs = { ...seed };
  const listeners = { win: {}, doc: {} };
  const state = {
    hold: false,
    pending: [],
    writes: [],
    attempts: [],
    inflight: 0,
    maxConcurrent: 0,
  };
  const shouldFail = (name, phase) =>
    typeof hooks.failOn === 'function' && Boolean(hooks.failOn(name, phase));
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
      state.inflight += 1;
      if (state.inflight > state.maxConcurrent) state.maxConcurrent = state.inflight;
      const staged = [];
      let settled = false;
      // 句柄的「关闭」只结算一次：close 抛错也算结束，否则并发计数会漏减。
      const settle = () => {
        if (settled) return;
        settled = true;
        state.inflight -= 1;
      };
      return {
        async write(chunk) {
          const failed = shouldFail(name, 'write');
          state.attempts.push({ name, phase: 'write', ok: !failed });
          if (failed) {
            settle();
            throw new Error(`模拟写入失败：${name} (write)`);
          }
          staged.push(chunk);
        },
        async close() {
          if (hooks.delayMs) await sleep(hooks.delayMs);
          if (state.hold) await new Promise((resolve) => state.pending.push(resolve));
          const failed = shouldFail(name, 'close');
          state.attempts.push({ name, phase: 'close', ok: !failed });
          settle();
          if (failed) throw new Error(`模拟写入失败：${name} (close)`);
          // 提交：只有 close 成功，内容才真正落到 map 上。
          const text = staged.join('');
          map[name] = text;
          state.writes.push({ name, text });
        },
        async abort() {
          settle();
        },
      };
    },
  });
  const makeDir = (map) => {
    const dirs = {};
    return {
      async getFileHandle(name, opt) {
        if (!(name in map)) {
          if (opt && opt.create) map[name] = '';
          else { const e = new Error('NotFound'); e.name = 'NotFoundError'; throw e; }
        }
        return makeFileHandle(name, map);
      },
      async getDirectoryHandle(name, opt) {
        // 子目录状态跟着目录实例走（而不是每次调用都返回全新空目录）——
        // 否则「启动恢复 + 手动 pickDirectory」两条启动链各自创建一个互不可见的
        // backup 目录，ensureDailyBackup 会判两次「今天没备份」，弹两条迟滞不定的
        // toast，任何带时间断言的用例都会被那条晚到的顶掉。
        if (!(name in dirs)) {
          if (!(opt && opt.create)) { const e = new Error('NotFound'); e.name = 'NotFoundError'; throw e; }
          dirs[name] = makeDir({});
        }
        return dirs[name];
      },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async *entries() {},
    };
  };
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
  const control = {
    hold() { state.hold = true; },
    release() {
      state.hold = false;
      state.pending.splice(0).forEach((resolve) => resolve());
    },
    writes: state.writes,
    attempts: state.attempts,
    get maxConcurrent() { return state.maxConcurrent; },
    resetConcurrency() { state.maxConcurrent = state.inflight; },
  };
  return { fs, fire, control };
}

function makeRenderer() {
  return () => { __beginRender(); const api = useTodoStore(); __flushEffects(); return api; };
}

async function bootStore(seed = SEED, hooks = {}) {
  __resetHooks();
  const { fs, fire, control } = installBrowserStubs(seed, hooks);
  const render = makeRenderer();
  let store = render();
  await store.pickDirectory();
  await sleep(5);
  store = render();
  return { store, render, fs, fire, control };
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

// ——— toast 自动消失 ————
// 以前 showToast 只 setToast 不设定时器：提示会一直挂在右下角，
// 直到下一条 toast 把它挤掉、或用户手动去点那个小叉。撤销类值得多留一会儿。
describe('useTodoStore toast 自动消失', () => {
  // 这三个用例的本质就是「等它到点」，总时长 3.6s / 6.4s —— 显式给超时，
  // 否则撞上 vitest 默认的 5s 上限，被测的其实是超时而不是行为。
  it('普通提示 3.4s 后自动消失', async () => {
    const { store, render } = await bootStore();
    store.updateTask(store.todoEntries[0].id, { title: '   ' }); // 空标题 → 提示
    expect(render().toast).not.toBeNull();
    await sleep(3600);
    expect(render().toast).toBeNull();
  }, 9000);

  it('带「撤销」的提示 6s 后才消失（3.4s 时还在）', async () => {
    const { store, render } = await bootStore();
    store.toggleComplete(store.todoEntries[0]);
    expect(render().toast?.actionLabel).toBe('撤销');
    await sleep(3600);
    expect(render().toast).not.toBeNull();
    await sleep(2800); // 累计 6.4s
    expect(render().toast).toBeNull();
  }, 12000);

  it('新 toast 顶掉旧 toast 时旧定时器不残留（不会把新提示提前清掉）', async () => {
    const { store, render } = await bootStore();
    const a = store.todoEntries[0];
    store.toggleComplete(a); // 撤销类：6s
    store.updateTask(a.id, { title: ' ' }); // 紧跟一条普通提示：3.4s
    await sleep(3600);
    expect(render().toast).toBeNull(); // 新的到点消失，没被旧定时器提前/延后
  }, 9000);

  it('手动关闭会取消挂起的定时器（不会再把之后的新 toast 清掉）', async () => {
    const { store, render } = await bootStore();
    store.updateTask(store.todoEntries[0].id, { title: ' ' });
    render().dismissToast();
    expect(render().toast).toBeNull();
    store.updateTask(store.todoEntries[0].id, { title: ' ' });
    await sleep(200);
    expect(render().toast).not.toBeNull(); // 新提示还在
  });
});

// ——— 行级动效状态：退场类名 / 删除窗口 / 高亮闪光 ————
// 这些是纯 UI 状态：类名到期自动收回，不碰 todo.txt、不落盘。
describe('useTodoStore 行级动效状态', () => {
  it('完成：窗口期内行在 fadingIds 里（退场动画有类名可挂）', async () => {
    const { store, render } = await bootStore();
    const a = store.todoEntries[0];
    store.toggleComplete(a);
    expect(render().fadingIds).toContain(a.id);
    await sleep(260);
    expect(render().fadingIds).not.toContain(a.id);
  });

  it('删除：窗口期内同样在 fadingIds，且可撤销', async () => {
    const { store, render } = await bootStore();
    const A = store.todoEntries[0];
    store.deleteTask(A);
    expect(render().fadingIds).toContain(A.id);
    store.undo(); // 窗口内撤销：定时器取消，行原地回来
    await sleep(260);
    const s = render();
    expect(s.fadingIds).not.toContain(A.id);
    expect(s.todoEntries).toHaveLength(3);
    expect(s.todoEntries.some((e) => e.id === A.id)).toBe(true);
  });

  it('删除：窗口内重复触发只算一次（不重复压撤销栈）', async () => {
    const { store, render } = await bootStore();
    const A = store.todoEntries[0];
    store.deleteTask(A);
    store.deleteTask(A);
    await sleep(260);
    expect(render().todoEntries).toHaveLength(2);
    store.undo();
    await sleep(20);
    expect(render().todoEntries).toHaveLength(3);
  });

  it('删除退场窗口内不接受完成 —— 两条退场不打架', async () => {
    const { store, render } = await bootStore();
    const A = store.todoEntries[0];
    store.deleteTask(A);
    store.toggleComplete(A); // 窗口内完成：应被守卫忽略
    await sleep(260);
    let s = render();
    expect(s.todoEntries.some((e) => e.id === A.id)).toBe(false);
    expect(s.doneEntries).toHaveLength(0); // 没有凭空多出的 done 条目
    store.undo(); // 只撤得掉删除这一件事
    await sleep(20);
    s = render();
    expect(s.todoEntries.some((e) => e.id === A.id)).toBe(true);
    expect(s.doneEntries).toHaveLength(0);
  });

  it('完成重复任务：新生行带 spawned 高亮，1400ms 后收回', async () => {
    const { store, render } = await bootStore({
      'todo.txt': `交周报 due:${TODAY} rec:+1w id:aaa111\n`,
      'done.txt': '',
    });
    const T = store.todoEntries[0];
    store.toggleComplete(T);
    await sleep(220); // 越过 fade(180ms)，新生行已生成
    const s = render();
    const spawned = s.todoEntries.find((e) => e.id !== T.id);
    expect(spawned).toBeTruthy();
    expect(s.spawnedIds).toContain(spawned.id);
    // 交接期间要把「排到哪一天」说出来 —— 只说「已完成」会被读成「没反应」：
    // 新生行与原行标题 / 优先级 / 位置全同，只有折起来的 due 变了。
    expect(s.toast.message).toContain('已为你排到');
    expect(s.toast.message).toContain(spawned.dueDate);
    await sleep(1600); // 越过 SPAWN_FLASH_MS(1400ms)
    expect(render().spawnedIds).not.toContain(spawned.id);
  });

  it('重复任务排到明天时用「明天」，不逼用户去读日期', async () => {
    const { store, render } = await bootStore({
      'todo.txt': `交周报 due:${TODAY} rec:+1d id:aaa111\n`,
      'done.txt': '',
    });
    store.toggleComplete(store.todoEntries[0]);
    await sleep(220);
    expect(render().toast.message).toContain('已为你排到明天');
  });

  it('新任务：带 entering 入场高亮，220ms 后收回', async () => {
    const { store, render } = await bootStore();
    const created = store.addTask('新任务');
    expect(render().enteringIds).toContain(created.id);
    await sleep(300);
    expect(render().enteringIds).not.toContain(created.id);
  });
});

// ——— 拖拽排序的落点语义 ————
// 落点指示线画在目标行的前缘 / 后缘，落点必须与那条线一致 ——
// 「线画在前面、人落到后面」比没有线更糟。
describe('useTodoStore 拖拽排序', () => {
  it('默认（前缘）插到目标行前面 —— 保持原有语义', async () => {
    const { store, render } = await bootStore();
    store.reorder(store.todoEntries[2].id, store.todoEntries[0].id);
    expect(render().todoEntries[0].title).toBe('任务C');
  });

  it('after: true（后缘）插到目标行后面', async () => {
    const { store, render } = await bootStore();
    store.reorder(store.todoEntries[0].id, store.todoEntries[2].id, { after: true });
    expect(render().todoEntries.map((e) => e.title)).toEqual(['任务B', '任务C', '任务A']);
  });

  it('拖到自己头上不产生任何变化', async () => {
    const { store, render } = await bootStore();
    const a = store.todoEntries[0].id;
    store.reorder(a, a);
    expect(render().todoEntries.map((e) => e.title)).toEqual(['任务A', '任务B', '任务C']);
  });
});

// 编辑浮窗的子任务列的是 todo + done 两份：已完成的子任务也住在浮窗里，
// 「再点一次取消完成」和「就地改标题」都必须真的落到 done.txt 那一行，
// 不能只扫 todo 然后什么都没发生（删除线收不回去就是这么来的）。
describe('useTodoStore 编辑浮窗里的已完成子任务', () => {
  const withDoneKid = () => bootStore({
    'todo.txt': '父任务 id:aaa111\n',
    'done.txt': 'x 2026-11-14 子任务B parent:aaa111 id:bbb222\n',
  });

  it('再次点复选框：从 done.txt 复活回 todo.txt，删除线可收回', async () => {
    const { store, render } = await withDoneKid();
    const kid = store.doneEntries.find((e) => e.title === '子任务B');
    expect(kid.completed).toBe(true);
    store.toggleComplete(kid);
    const s = render();
    expect(s.doneEntries).toHaveLength(0);
    const revived = s.todoEntries.find((e) => e.title === '子任务B');
    expect(revived).toBeTruthy();
    expect(revived.completed).toBe(false);
  });

  it('就地改标题会写回 done.txt，不是只在 todo 上空转', async () => {
    const { store, render } = await withDoneKid();
    const kid = store.doneEntries.find((e) => e.title === '子任务B');
    store.updateTask(kid.id, { title: '子任务B（改过）' });
    const s = render();
    expect(s.doneEntries.find((e) => e.id === kid.id).title).toBe('子任务B（改过）');
    expect(s.todoEntries.find((e) => e.title === '父任务').title).toBe('父任务');
  });
});

// 取消完成不是「可撤销的一步」：完成动作入栈的那条记录若留着，下一次
// Ctrl+Z 会走 dropSpawned 把「下一次」实例删掉，还谎报「已撤销」。
describe('useTodoStore 取消完成与撤销栈', () => {
  it('取消完成后再撤销，不会误删重复规则生成的下一次实例', async () => {
    const { store, render } = await bootStore({
      'todo.txt': '交周报 rec:mon id:aaa111\n',
      'done.txt': '',
    });
    const a = store.todoEntries[0];
    store.toggleComplete(a);
    await sleep(260);
    let s = render();
    const doneA = s.doneEntries.find((e) => e.id === a.id);
    expect(doneA).toBeTruthy();
    expect(s.todoEntries.length).toBeGreaterThanOrEqual(1); // 「下一次」已生成

    store.toggleComplete(doneA);
    s = render();
    expect(s.doneEntries).toHaveLength(0);
    expect(s.todoEntries.find((e) => e.id === a.id)).toBeTruthy();
    const countBefore = s.todoEntries.length;

    store.undo();
    expect(render().todoEntries).toHaveLength(countBefore);
  });
});

// ——— B1 · 保存/关窗状态机（R-01 / R-02 / R-14 失败注入） ———
//
// 这一组全部是「写盘失败 / 写盘在飞」的注入用例。修复前它们应当红，修复后应当绿。
// 它们锁的四件事：
//   ① 写序「先 done 后 todo」—— 中断时最坏是重复，不是丢失；
//   ② 失败终态是 `unsaved`，绝不报 `saved`（SettingsPage 只认 `unsaved`）；
//   ③ `revision` 门控 —— 写盘期间进来的新改动不许被上一次 saveNow 标成已保存；
//   ④ 串行闸门「排队不拒绝」—— 同一时刻最多一次写盘在飞，且后面的改动不丢。
describe('B1 保存状态机（写盘失败 / 在飞竞态）', () => {
  it('1.1 done.txt 写失败：内存仍含改动、状态 unsaved、磁盘不含（不得谎称已保存）', async () => {
    const hooks = { failOn: (name) => name === 'done.txt' };
    const { store, render, fs } = await bootStore(SEED, hooks);
    const a = store.todoEntries[0];
    store.toggleComplete(a);
    await sleep(420); // fade 180 + 防抖 200 + 余量

    // 最坏结果是「两处都没有」：旧实现先写 todo（成功、任务从清单里被删掉）
    // 再写 done（失败），于是这条任务当场从两份文件里一起消失。
    expect(fs['todo.txt']).toContain('任务A');
    expect(fs['done.txt']).not.toContain('任务A');

    const s = render();
    // A 语义（方案 §8.1）：失败**不回滚**内存 —— 改动仍在本机内存，等下一次保存机会自愈。
    // 这也是那句 toast「改动仍在本机内存」唯一为真的前提。
    expect(s.doneEntries.some((e) => e.id === a.id)).toBe(true);
    expect(s.saveStatus).toBe('unsaved'); // 灯必须诚实，不许报 saved
    expect(s.toast.message).toContain('仍在本机内存');
    expect(s.toast.message).not.toContain('已回滚');
  });

  it('1.2 todo.txt 写失败：先 done 后 todo，且 done 被补偿写回（不出现「两处都没有」）', async () => {
    const hooks = { failOn: (name) => name === 'todo.txt' };
    const { store, render, fs, control } = await bootStore(SEED, hooks);
    store.toggleComplete(store.todoEntries[0]);
    await sleep(420);

    // 写序证据：第一次 done.txt 的尝试必须早于第一次 todo.txt 的尝试。
    const firstDone = control.attempts.findIndex((x) => x.name === 'done.txt');
    const firstTodo = control.attempts.findIndex((x) => x.name === 'todo.txt');
    expect(firstDone).toBeGreaterThanOrEqual(0);
    expect(firstTodo).toBeGreaterThan(firstDone);

    // 补偿证据：done.txt 一度写进了已完成条目，todo.txt 失败后必须写回旧内容。
    expect(fs['done.txt']).not.toContain('任务A');
    expect(fs['todo.txt']).toContain('任务A');
    expect(render().saveStatus).toBe('unsaved');
  });

  it('1.3 批量中途失败：第二次写盘失败时，第一条已完成记录与第二条任务都不丢', async () => {
    let failing = false;
    const hooks = { failOn: (name) => failing && name === 'done.txt' };
    const { store, render, fs } = await bootStore(SEED, hooks);

    store.toggleComplete(store.todoEntries.find((e) => e.title === '任务A'));
    await sleep(420);
    expect(fs['done.txt']).toContain('任务A'); // 第一条已落盘

    failing = true;
    const s0 = render();
    const B = s0.todoEntries.find((e) => e.title === '任务B');
    s0.toggleComplete(B);
    await sleep(460);

    // 已落盘的第一条不许被这次失败带走
    expect(fs['done.txt']).toContain('任务A');
    // 第二条也不许从两份文件里同时消失
    expect(fs['todo.txt']).toContain('任务B');
    expect(fs['done.txt']).not.toContain('任务B');
    expect(render().saveStatus).toBe('unsaved');
  });

  it('1.4 串行闸门：并发两次 saveNow 同一时刻最多一次写盘在飞', async () => {
    const { store, render, control } = await bootStore();
    store.addTask('闸门验证');
    control.hold();
    control.resetConcurrency();

    const p1 = store.saveNow(); // 卡在 close
    const p2 = store.saveNow(); // 必须排队，而不是也开一个写句柄
    await sleep(20);
    expect(control.maxConcurrent).toBe(1);

    control.release();
    await Promise.all([p1, p2]);
    // 排队不拒绝：第二次进来时内容已经不脏了，靠内容比对短路成 no-op。
    expect(control.maxConcurrent).toBe(1);
    expect(render().saveStatus).toBe('saved');
  });

  it('1.5 写盘失败后按撤销：任务只出现一行（stale undo 不得再插一次）', async () => {
    // delete 分支的幂等守卫（`todo.some(id) → return`）的守门人 / 回归基线。
    //   · 当前 A 语义（失败**不回滚**内存）下，「内存里已有 A + 撤销记录里也有 A」
    //     这个组合不会出现，所以删掉守卫这条用例**仍然是绿的** —— 它是**基线**；
    //   · 若将来恢复「失败回滚内存」（B 语义，2026-11-21 曾短暂采用并实测过），
    //     该组合立刻复活，守卫被删则这条用例变红（B 版实测 length 1 vs 2）。
    // 两种语义都写在这里，免得下次改语义又要翻一次口径。
    const hooks = { failOn: (name) => name === 'todo.txt' };
    const { store, render, fs } = await bootStore(SEED, hooks);
    const A = store.todoEntries[0];
    store.deleteTask(A);
    await sleep(420); // 删除已提交，但写盘失败
    const failed = render();
    expect(failed.saveStatus).toBe('unsaved');
    // A 语义：不回滚 → A 仍处于「已删除」（不在 todo 列表里），只是磁盘上还在
    expect(failed.todoEntries.some((e) => e.id === A.id)).toBe(false);
    expect(fs['todo.txt']).toContain('任务A');

    hooks.failOn = () => false; // 磁盘恢复
    store.undo(); // 用户点 toast 上的「撤销」
    await sleep(560);

    const s = render();
    expect(s.todoEntries.filter((e) => e.id === A.id)).toHaveLength(1);
    expect(s.todoEntries.map((e) => e.title).sort()).toEqual(['任务A', '任务B', '任务C']);
    expect(fs['todo.txt'].split('\n').filter((l) => l.includes('任务A'))).toHaveLength(1);
    expect(s.saveStatus).toBe('saved');
  });

  it('2.1 写盘在飞时的新改动不得被旧的 saveNow 标成 saved（revision 门控）', async () => {
    const { store, render, control } = await bootStore();
    store.addTask('第一条');
    control.hold();
    const saving = store.saveNow();
    await sleep(20);
    store.addTask('第二条'); // 写盘途中来了新改动
    control.release();
    await saving;

    // 旧实现会在这里写 'saved'：状态灯说「已保存」，而「第二条」还在内存里。
    expect(render().saveStatus).toBe('unsaved');
    expect(render().todoEntries.some((e) => e.title === '第二条')).toBe(true);

    // 让排队的那次接力落盘
    await sleep(300);
    expect(render().saveStatus).toBe('saved');
  });

  it('2.2 没有 dirty 时 saveNow 不得点亮 lastSavedAt（否则每次切窗都触发 git 自动提交）', async () => {
    const { store, render } = await bootStore();
    await store.saveNow(); // 刚载入完，内存与磁盘一致
    expect(render().lastSavedAt).toBeNull();

    store.addTask('有改动');
    await store.saveNow();
    const first = render().lastSavedAt;
    expect(first).toBeInstanceOf(Date);

    await sleep(5);
    await store.saveNow(); // 这次没有 dirty
    expect(render().lastSavedAt).toBe(first);
  });

  it('2.3 转 hidden 时无条件兜底刷盘：旧实现会把未落盘改动误标成 saved 而跳过这一步', async () => {
    const { store, render, fs, fire, control } = await bootStore();
    store.addTask('晚到的改动');
    control.hold();
    const saving = store.saveNow();
    await sleep(20);
    store.addTask('写盘途中新增');
    control.release();
    await saving; // 旧实现：这一刻状态被置成 saved → 下面的 flush 直接跳过

    globalThis.document.visibilityState = 'hidden';
    fire.document('visibilitychange');
    await sleep(60);
    globalThis.document.visibilityState = 'visible';

    // 页面关掉时磁盘上必须含有最后那一条改动
    expect(fs['todo.txt']).toContain('写盘途中新增');
    expect(render().saveStatus).toBe('saved');
  });
  it('2.4 冲突覆盖期间来了新改动：不得把新改动标成已保存（与 runSave 同一套门控）', async () => {
    const { store, render, control } = await bootStore();
    store.addTask('第一条');
    control.hold();
    const overwriting = store.resolveConflictKeepLocal(); // 卡在 close
    await sleep(20);
    store.addTask('第二条'); // 覆盖途中来了新改动
    control.release();
    await overwriting;

    // 写进磁盘的是「第一条」那个快照，不能宣称已保存
    expect(render().saveStatus).toBe('unsaved');
    await sleep(320);
    expect(render().saveStatus).toBe('saved');
  });
});

// ——— B1 · R-05a：重载后重置状态 ———
// 重载意味着「内存换成了磁盘的另一份真相」：上一份数据留下的撤销栈 / 快照 /
// 挂起定时器全部作废。否则 Ctrl+Z 会按不存在的下标插回任务（磁盘上已经有的那一条
// 会变成两份），挂起的 fade 提交也会在重载之后再写一次盘。
//
// 取证要点：撤销记录里的 task 是整个对象快照（delete 分支），插回时不靠 id 匹配，
// 所以「重载后 undo 仍然生效」一定能被观察到 —— 这比「靠 id 失效自然变成 no-op」
// 可靠得多（运行时 id 由行文本现算、带序号，重解析本来就会变，那会让用例假绿）。
describe('B1 重载后重置（R-05a）', () => {
  it('5.1 重载后撤销栈为空：Ctrl+Z 不改 todo / done 任何一行', async () => {
    const { store, render, fs } = await bootStore();
    const A = store.todoEntries[0];
    store.deleteTask(A);
    await sleep(420); // fade 180 + 防抖 200 + 余量
    expect(fs['todo.txt']).not.toContain('任务A');
    expect(render().todoEntries).toHaveLength(2);

    await store.manualReload();
    expect(render().todoEntries).toHaveLength(2);

    store.undo(); // 栈已清空 → 什么都不该发生
    await sleep(260); // 若真的插回了，这里还会连带写一次盘
    const final = render();
    expect(final.todoEntries).toHaveLength(2);
    expect(final.todoEntries.some((e) => e.title === '任务A')).toBe(false);
    expect(fs['todo.txt']).not.toContain('任务A');
  });

  it('5.3 重载会清掉 fade 窗口里挂起的提交（重载后不得再写盘）', async () => {
    const { store, render, control } = await bootStore();
    store.toggleComplete(store.todoEntries[0]); // 180ms 后才 commit，此刻还在 fade 窗口内
    await store.manualReload();
    expect(render().saveStatus).toBe('saved');

    const attemptsAfterReload = control.attempts.length;
    await sleep(320); // 原定时器(180)若没被清掉，会在这里 commit → 防抖 200ms 后写盘

    // 挂起的提交若还活着，就会在重载之后把状态改回 unsaved 并再写一次盘。
    expect(render().saveStatus).toBe('saved');
    expect(control.attempts.length).toBe(attemptsAfterReload);
    expect(render().todoEntries).toHaveLength(3);
    expect(render().doneEntries).toHaveLength(0);
  });
});

// ——— B1 稳态与自愈（A 语义：失败不回滚内存） ———
// QA 与 team-lead 各自实测确认的三件事（决定了这里每个期望值的方向）：
//   · 坏盘时状态灯**全程** unsaved（因为内存 != 磁盘，dirty 一直为真）；
//   · `MAX_SAVE_RETRIES` **真生效**：1 次首发 + 至多 3 次重试，约 920ms 后停止；
//   · 磁盘恢复后**不需要用户重做**，下一次保存机会就把改动补写进去。
describe('B1 稳态与自愈（1.6a / 1.6b）', () => {
  it('1.6a 坏盘稳态：1200ms 后仍 unsaved，改动在内存、磁盘始终没有', async () => {
    const hooks = { failOn: (name) => name === 'done.txt' };
    const { store, render, fs, control } = await bootStore(SEED, hooks);
    const base = control.attempts.length;
    const task = store.todoEntries[0];
    store.toggleComplete(task);
    await sleep(1200);

    const s = render();
    // 无条件断言：A 语义下这里必须仍是 unsaved。写成 `if (saved)` 分支会在
    // 回归成「永远 saved」时被静默跳过 —— 正是我们这一轮在抓的那类漏洞。
    expect(s.saveStatus).toBe('unsaved');
    expect(s.doneEntries.some((e) => e.id === task.id)).toBe(true); // 内存【含】
    expect(fs['done.txt']).not.toContain('任务A'); // 磁盘【不含】
    expect(s.toast.message).not.toContain('已回滚'); // 文案不得声称回滚
    // 内存 ≠ 磁盘：这正是 A 的设计，也是它能自愈的前提。
    expect(serializeEntries(s.doneEntries)).not.toBe(fs['done.txt']);

    // 有界重试真的在重试：1 次首发 + 至多 3 次重试，之后必须停下来（无写入风暴）。
    const attempts = control.attempts.length - base;
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(attempts).toBeLessThanOrEqual(5);
    await sleep(600); // 再等一段，确认已经停止
    expect(control.attempts.length - base).toBe(attempts);
  });

  it('1.6b 磁盘恢复后无需用户重做：下一次保存机会即自动补写', async () => {
    const hooks = { failOn: (name) => name === 'done.txt' };
    const { store, render, fs } = await bootStore(SEED, hooks);
    const task = store.todoEntries[0];
    store.toggleComplete(task);
    await sleep(1200);
    expect(render().saveStatus).toBe('unsaved');
    expect(fs['done.txt']).not.toContain('任务A');

    hooks.failOn = () => false; // 盘恢复，用户什么都没做
    await store.saveNow(); // 「下一次保存机会」
    await sleep(80);

    const s = render();
    expect(s.saveStatus).toBe('saved');
    expect(fs['done.txt']).toContain('任务A'); // 改动自己补写进去了，没有重做
    expect(serializeEntries(s.todoEntries)).toBe(fs['todo.txt']);
    expect(serializeEntries(s.doneEntries)).toBe(fs['done.txt']);
    expect(s.lastSavedAt).toBeInstanceOf(Date);
  });
});
