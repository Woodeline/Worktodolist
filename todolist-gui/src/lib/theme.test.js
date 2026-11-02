// 主题档位的契约测试。
//
// 这一层最容易出的三种事故都不会抛错：档位存进去了但没投到 DOM（用户看不到变化）、
// auto 档不跟系统变化（要重启才生效）、手动档被系统带着走（选了浅色又自己变深）。
// 还有一个环境边界：vitest 跑在 node 里，没有 document —— 投影必须静默跳过而不是崩。
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 一个能翻面的系统偏好 + 一个记着监听者的 matchMedia。 */
function makeDom({ dark = false, withDocument = true } = {}) {
  const listeners = new Set();
  const state = { dark };
  globalThis.window = {
    matchMedia: () => ({
      get matches() {
        return state.dark;
      },
      addEventListener: (_type, fn) => listeners.add(fn),
      removeEventListener: (_type, fn) => listeners.delete(fn),
    }),
  };
  if (withDocument) globalThis.document = { documentElement: { dataset: {} } };
  else delete globalThis.document;
  globalThis.localStorage = {
    _map: new Map(),
    getItem(k) {
      return this._map.has(k) ? this._map.get(k) : null;
    },
    setItem(k, v) {
      this._map.set(k, String(v));
    },
    removeItem(k) {
      this._map.delete(k);
    },
  };
  return {
    dataset: withDocument ? globalThis.document.documentElement.dataset : null,
    flipSystem: (v) => {
      state.dark = v;
      for (const fn of [...listeners]) fn();
    },
  };
}

/** theme.js 里挂着"监听只挂一次"的模块状态，每个用例都要拿到一份干净的它。 */
async function freshTheme() {
  vi.resetModules();
  return import('./theme.js');
}

describe('主题档位', () => {
  beforeEach(() => {
    delete globalThis.window;
    delete globalThis.document;
  });

  it('light / dark 原样生效，auto 取系统的色', async () => {
    const theme = await freshTheme();
    makeDom({ dark: true });
    expect(theme.resolveTheme('light')).toBe('light');
    expect(theme.resolveTheme('dark')).toBe('dark');
    expect(theme.resolveTheme('auto')).toBe('dark');
    expect(theme.resolveTheme('没这个档位')).toBe('dark'); // 脏值按 auto 处理
  });

  it('没落盘过时默认跟随系统，脏值也退回跟随系统', async () => {
    const theme = await freshTheme();
    makeDom({ dark: false });
    expect(theme.loadThemeMode()).toBe('auto');
    localStorage.setItem('worktodolist.theme', JSON.stringify({ mode: 'midnight' }));
    expect(theme.loadThemeMode()).toBe('auto');
  });

  it('选档会落盘、投影到 <html data-theme>，并通知订阅者', async () => {
    const theme = await freshTheme();
    const dom = makeDom({ dark: true });
    const seen = [];
    theme.subscribeTheme((mode, effective) => seen.push([mode, effective]));

    expect(theme.setThemeMode('light')).toBe('light');
    expect(dom.dataset.theme).toBe('light');
    expect(JSON.parse(localStorage.getItem('worktodolist.theme'))).toEqual({ mode: 'light' });
    expect(theme.loadThemeMode()).toBe('light');
    expect(seen).toEqual([['light', 'light']]);
  });

  it('跟随系统时，系统翻面会立刻重新投影', async () => {
    const theme = await freshTheme();
    const dom = makeDom({ dark: false });
    theme.initTheme();
    expect(dom.dataset.theme).toBe('light');

    dom.flipSystem(true);
    expect(dom.dataset.theme).toBe('dark');
  });

  it('手动档不被系统带着走', async () => {
    const theme = await freshTheme();
    const dom = makeDom({ dark: false });
    theme.setThemeMode('dark');
    theme.initTheme();
    expect(dom.dataset.theme).toBe('dark');

    dom.flipSystem(true);
    dom.flipSystem(false);
    expect(dom.dataset.theme).toBe('dark');
    expect(theme.loadThemeMode()).toBe('dark');
  });

  it('启动时把上次选的档位投出来（落盘是 dark、系统是亮色，也该是深色）', async () => {
    const theme = await freshTheme();
    const dom = makeDom({ dark: false });
    localStorage.setItem('worktodolist.theme', JSON.stringify({ mode: 'dark' }));
    theme.initTheme();
    expect(dom.dataset.theme).toBe('dark');
  });

  it('订阅者抛错不影响别人，也不影响已经投出去的属性', async () => {
    const theme = await freshTheme();
    const dom = makeDom();
    let late = 0;
    theme.subscribeTheme(() => {
      throw new Error('订阅者炸了');
    });
    theme.subscribeTheme(() => (late += 1));
    theme.applyTheme('dark');
    expect(late).toBe(1);
    expect(dom.dataset.theme).toBe('dark');
  });

  it('没有 DOM 的环境里不崩，只按系统偏好返回生效色', async () => {
    const theme = await freshTheme();
    makeDom({ dark: true, withDocument: false });
    expect(theme.applyTheme('auto')).toBe('dark');
    expect(theme.setThemeMode('light')).toBe('light');
    expect(() => theme.initTheme()).not.toThrow();
  });

  it('完全没有 window 时按亮色处理（老 WebView / 纯 node）', async () => {
    const theme = await freshTheme();
    delete globalThis.window;
    delete globalThis.document;
    expect(theme.systemPrefersDark()).toBe(false);
    expect(theme.resolveTheme('auto')).toBe('light');
    expect(theme.applyTheme('auto')).toBe('light');
  });
});
