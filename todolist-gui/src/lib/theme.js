// 明暗主题：三档偏好（跟随系统 / 浅色 / 深色）与它在 DOM 上的投影。
//
// 与「窗口置顶」同一套形状：本机配置是唯一真相，界面状态只是投影。
// 区别是这里没有壳参与 —— 主题纯属样式层的事，Rust 侧不需要知道。
//
// 为什么 CSS 里只剩 `[data-theme="dark"]` 一个暗色块（而不是媒体查询 + 属性两块）：
// 暗色令牌七十多条，抄两份迟早漏改一条。所以由本模块先把「跟随系统」解析成具体的
// light/dark 再落到 <html data-theme> 上，值只有一份。代价是 JS 跑起来之前的那一帧
// 没有属性可依 —— 由 index.html 的内联样式用媒体查询兜住首屏底色。
import { createConfigStore } from './configStore.js';

/** 档位：跟随系统 / 强制浅色 / 强制深色。 */
export const THEME_MODES = ['auto', 'light', 'dark'];

/** 档位的中文说法（按钮提示与菜单项共用一份，避免三处各写各的）。 */
export const THEME_LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };

/** 档位 → 按钮图标（跟随系统用显示器，明暗两档用日月）。 */
export const THEME_ICONS = { auto: 'monitor', light: 'sun', dark: 'moon' };

const themePrefs = createConfigStore({
  key: 'worktodolist.theme',
  defaults: { mode: 'auto' },
  normalize: (c) => ({ mode: clean(c && c.mode) }),
});

/** 脏值一律退回"跟随系统"：这是没有偏好时的默认形态，也是最不会误导的一档。 */
function clean(mode) {
  return THEME_MODES.includes(mode) ? mode : 'auto';
}

/** 落盘的档位（没配过 = auto）。 */
export function loadThemeMode() {
  return themePrefs.loadOr().mode;
}

/** 系统自己偏暗吗。没有 matchMedia 的环境（vitest 的 node、老 WebView）按偏亮处理。 */
export function systemPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
}

/** 档位 → 实际生效的明暗。auto 在这里被解析成具体一档。 */
export function resolveTheme(mode) {
  const m = clean(mode);
  return m === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : m;
}

const listeners = new Set();

function notify(mode, effective) {
  for (const fn of [...listeners]) {
    try {
      fn(mode, effective);
    } catch {
      // 单个订阅者出错不影响其它订阅者，也不影响已经投出去的属性
    }
  }
}

/** 把档位投影到 DOM 并通知订阅者。返回生效的明暗。 */
export function applyTheme(mode) {
  const next = clean(mode);
  const effective = resolveTheme(next);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = effective;
  }
  notify(next, effective);
  return effective;
}

/** 换档：先落盘，再投影。 */
export function setThemeMode(mode) {
  const next = clean(mode);
  themePrefs.save({ mode: next });
  return applyTheme(next);
}

/** 档位或生效色的变化（含 auto 档下的系统深浅切换）。返回取消订阅函数。 */
export function subscribeTheme(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let booted = false;

/**
 * 启动时调用一次：投影落盘档位，并盯住系统深浅变化。
 * 盯系统是为了 auto 档 —— 系统换色时应用要立刻跟着换，而不是等下次启动。
 * 重复调用是安全的（监听只挂一次）。
 */
export function initTheme() {
  applyTheme(loadThemeMode());
  if (booted) return;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  let mq;
  try {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return;
  }
  booted = true;
  const onChange = () => {
    if (loadThemeMode() !== 'auto') return; // 手动档不跟系统走
    applyTheme('auto');
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange);
}
