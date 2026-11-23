// useAlwaysOnTop 的「事件通道缺失」降级回归（QA 复核 P1-④）。
//
// 背景：`runtime.listen` 从「拿不到能力就返回 noop」改成**抛错**之后，
// 任何一个 `await listen(...)` 没有 try/catch 的地方都会变成未捕获的 rejection。
// 这类 rejection 不会让页面白屏，只会让那段功能静默失效 —— 正是最难发现的那种坏法。
// 所以这条用例除了断言功能，还直接**监听 process 的 unhandledRejection**。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => import('../../scripts/qa-react-shim.mjs'));

import { __beginRender, __flushEffects, __resetHooks } from '../../scripts/qa-react-shim.mjs';
import { useAlwaysOnTop } from './useAlwaysOnTop.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 装一个最小壳环境。
 * @param {{ event?: boolean }} opts event=true 表示 `__TAURI__.event.listen` 可用
 */
function installShell({ event = false } = {}) {
  const calls = [];
  const handlers = [];
  const listen = async (type, handler) => {
    handlers.push({ type, handler });
    return () => {};
  };
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return undefined;
  };
  globalThis.window = event
    ? { __TAURI__: { event: { listen }, core: { invoke } } }
    : { __TAURI_INTERNALS__: { invoke } };
  return { calls, handlers };
}

/** 捕获窗口期内出现的未处理 rejection。 */
function watchUnhandled() {
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  return {
    seen,
    stop() {
      process.off('unhandledRejection', onUnhandled);
    },
  };
}

const mount = () => {
  __beginRender();
  const api = useAlwaysOnTop();
  __flushEffects();
  return api;
};

beforeEach(() => {
  __resetHooks();
});

afterEach(() => {
  delete globalThis.window;
});

describe('useAlwaysOnTop 事件通道降级（R-10 的连带影响）', () => {
  it('半壳环境（isTauri 真、__TAURI__.event 缺失）：不留未捕获 rejection，按钮仍能置顶', async () => {
    const { calls } = installShell({ event: false });
    const watch = watchUnhandled();
    let api = mount();
    await sleep(10); // 让 async IIFE 里的 await listen(...) 走完 reject → catch
    watch.stop();

    expect(watch.seen).toEqual([]); // 关键断言：没有未捕获 rejection

    api = mount();
    api.toggle();
    expect(calls).toEqual([{ cmd: 'app_set_always_on_top', args: { enabled: true } }]);
    expect(mount().onTop).toBe(true);
  });

  it('正常壳：注册一次广播监听，壳推来的值同步到界面与偏好', async () => {
    const { calls, handlers } = installShell({ event: true });
    mount();
    await sleep(0);

    expect(handlers).toHaveLength(1);
    expect(handlers[0].type).toBe('shell://always-on-top');

    handlers[0].handler({ payload: true });
    expect(mount().onTop).toBe(true);
    expect(calls).toEqual([]); // 广播只更新投影，不回打命令（避免自激循环）
  });
});
