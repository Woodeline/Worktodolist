import { afterEach, describe, expect, it } from 'vitest';
import { hideToTray, listen, platformFromUA, resolveListen, usesCustomTitlebar } from './runtime.js';

describe('platformFromUA', () => {
  it('识别 macOS WebKit', () => {
    expect(
      platformFromUA(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
      )
    ).toBe('macos');
  });

  it('识别 Windows WebView2', () => {
    expect(
      platformFromUA(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
      )
    ).toBe('windows');
  });

  it('识别 Linux', () => {
    expect(platformFromUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')).toBe('linux');
  });

  it('空 UA 归到 web，不误判成 macOS', () => {
    expect(platformFromUA('')).toBe('web');
    expect(platformFromUA(undefined)).toBe('web');
  });
});

describe('usesCustomTitlebar', () => {
  it('macOS 与 Windows 合并标题栏', () => {
    expect(usesCustomTitlebar('macos')).toBe(true);
    expect(usesCustomTitlebar('windows')).toBe(true);
  });

  it('浏览器与 Linux 保留原生窗口框', () => {
    expect(usesCustomTitlebar('web')).toBe(false);
    expect(usesCustomTitlebar('linux')).toBe(false);
  });
});

describe('hideToTray', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });

  function fakeShell(calls) {
    globalThis.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd) => {
            calls.push(cmd);
          },
        },
      },
    };
  }

  it('不在壳内时返回 false，不调 IPC', async () => {
    const calls = [];
    delete globalThis.window;
    expect(await hideToTray()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('壳内先刷盘再隐藏，顺序不可颠倒', async () => {
    const calls = [];
    fakeShell(calls);
    const ok = await hideToTray(async () => {
      calls.push('save');
    });
    expect(ok).toBe(true);
    expect(calls).toEqual(['save', 'app_hide_to_tray']);
  });

  it('刷盘失败也照样隐藏，快捷键不能像失灵', async () => {
    const calls = [];
    fakeShell(calls);
    const ok = await hideToTray(async () => {
      throw new Error('磁盘只读');
    });
    expect(ok).toBe(true);
    expect(calls).toEqual(['app_hide_to_tray']);
  });
});

// ——— R-10：事件通道的解析（关窗握手的前提） ———
// 旧实现拿不到能力时返回 noop：关窗握手在用户完全不知情的情况下退化成
// 「什么都不做」，最后 200ms 的改动静默丢失。现在必须**抛错**，让调用方
// （useNativeShell）显式降级到 pagehide 兜底刷盘。
describe('resolveListen', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });

  it('两级后备：__TAURI__.event 优先，其次 __TAURI_INTERNALS__.event；都拿不到就抛错', async () => {
    // ① 公开面可用
    globalThis.window = {
      __TAURI__: { event: { listen: async () => () => {} } },
    };
    expect(typeof resolveListen()).toBe('function');

    // ② 只有内部通道（注入时机偏晚）：仍能解析出来
    globalThis.window = {
      __TAURI_INTERNALS__: { event: { listen: async () => () => {} } },
    };
    expect(typeof resolveListen()).toBe('function');

    // ③ 只有 invoke、没有 event 通道 —— 不许再退回 noop，必须抛错
    globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => {} } };
    expect(() => resolveListen()).toThrow(/IPC 不可用/);
    await expect(listen('shell://before-close', () => {})).rejects.toThrow(/IPC 不可用/);

    // ④ 浏览器里（没有 window）同样抛错
    delete globalThis.window;
    expect(() => resolveListen()).toThrow(/IPC 不可用/);
  });
});
