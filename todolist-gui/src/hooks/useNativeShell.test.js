// useNativeShell 关窗握手回归测试（R-10）。
//
// 用 scripts/qa-react-shim.mjs 驱动【真实 useNativeShell】，不需要 jsdom ——
// 与 useTodoStore.test.js 同一套替身思路：只替换 `react` 的 hooks 运行时，
// 被测代码一行不改。
//
// 这两条用例锁的是「关窗时最后 200ms 的改动去哪了」：
//   10.1 壳没暴露事件通道（runtime.listen 抛错）→ 必须降级到 pagehide 兜底刷盘，
//        且**不许**替 Rust 调 app_confirm_close；
//   10.2 正常链路 → 先刷盘再 app_confirm_close，且监听只注册一次。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => import('../../scripts/qa-react-shim.mjs'));

import { __beginRender, __flushEffects, __resetHooks } from '../../scripts/qa-react-shim.mjs';
import { useNativeShell } from './useNativeShell.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 装一套最小壳环境。
 * @param {{ event?: boolean }} opts event=true 表示 `__TAURI__.event.listen` 可用
 */
function installShell({ event = false } = {}) {
  const buckets = { win: {}, doc: {} };
  const add = (bucket, type, fn) => {
    if (!bucket[type]) bucket[type] = [];
    bucket[type].push(fn);
  };
  const remove = (bucket, type, fn) => {
    bucket[type] = (bucket[type] || []).filter((f) => f !== fn);
  };
  const calls = [];
  const handlers = [];

  globalThis.window = {
    addEventListener(type, fn) { add(buckets.win, type, fn); },
    removeEventListener(type, fn) { remove(buckets.win, type, fn); },
  };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener(type, fn) { add(buckets.doc, type, fn); },
    removeEventListener(type, fn) { remove(buckets.doc, type, fn); },
  };

  const listen = async (type, handler) => {
    handlers.push({ type, handler });
    return () => {};
  };
  const invoke = async (cmd) => {
    calls.push(cmd);
    return undefined;
  };

  if (event) {
    globalThis.window.__TAURI__ = { event: { listen }, core: { invoke } };
  } else {
    // 只有内部通道：isTauri() 仍为 true，但 resolveListen 拿不到 event → 抛错
    globalThis.window.__TAURI_INTERNALS__ = { invoke };
  }

  const fire = {
    window: (type) => (buckets.win[type] || []).forEach((fn) => fn()),
    document: (type) => (buckets.doc[type] || []).forEach((fn) => fn()),
    windowListenerCount: (type) => (buckets.win[type] || []).length,
  };
  return { calls, handlers, fire };
}

function mountShell(saveNow) {
  const store = { dirReady: false, saveNow };
  const render = () => {
    __beginRender();
    useNativeShell(store);
    __flushEffects();
  };
  render();
  return render;
}

beforeEach(() => {
  __resetHooks();
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe('useNativeShell 关窗握手（R-10）', () => {
  it('10.1 拿不到事件通道时降级：pagehide 仍会刷盘，且不替 Rust 放行关窗', async () => {
    const { calls, handlers, fire } = installShell({ event: false });
    const saved = [];
    mountShell(() => saved.push('save'));
    await sleep(0); // 让 listen 的 reject 落进 catch 分支，再把兜底监听挂上

    expect(handlers).toHaveLength(0); // 拿不到能力 → 一个监听都没注册
    fire.window('pagehide');

    expect(saved).toEqual(['save']); // 兜底刷盘生效
    // 降级路径绝不调 app_confirm_close：关窗确认权在 Rust，前端替它放行会让
    // lib.rs 的 3 秒超时保护失效。
    expect(calls).toEqual([]);
  });

  it('10.2 正常链路：先刷盘再 app_confirm_close，且重复渲染不重复注册', async () => {
    const { calls, handlers, fire } = installShell({ event: true });
    const saved = [];
    const render = mountShell(async () => {
      saved.push('save');
      calls.push('save');
    });
    await sleep(0);

    expect(handlers).toHaveLength(1);
    expect(handlers[0].type).toBe('shell://before-close');

    render(); // 再渲染一次：effect deps 为空，不许重复注册
    await sleep(0);
    expect(handlers).toHaveLength(1);

    await handlers[0].handler({});
    expect(calls).toEqual(['save', 'app_confirm_close']);
    expect(saved).toEqual(['save']);

    // 正常链路下不挂降级监听（挂了也只是重复刷盘，但语义必须清晰）
    expect(fire.windowListenerCount('pagehide')).toBe(0);
  });
});
