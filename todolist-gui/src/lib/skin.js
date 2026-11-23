// 外观主题（皮肤）：原版 / 素纸 / 夜航 三档，与明暗档位正交。
//
// 与 theme.js 同一套形状：本机配置是唯一真相，界面只是投影 ——
// 偏好落 configStore（一个能力一个键），DOM 上投 <html data-skin>，
// 令牌与版式差异全部由样式层按属性接管，Rust 壳不需要知道。
// 明暗仍归 theme.js：每档皮肤在 CSS 里各备明暗两套令牌，
// 于是「夜航 + 浅色」也是成立的一档（骨白纸面 + 琥珀），不是只有深色。
import { useCallback, useEffect, useState } from 'react';
import { createConfigStore } from './configStore.js';

/** 档位：原版（现行登记簿）/ 素纸 / 夜航。 */
export const SKINS = ['classic', 'paper', 'night'];

/** 档位的中文说法（设置页按钮与样张署名共用一份）。 */
export const SKIN_LABELS = { classic: '原版', paper: '素纸', night: '夜航' };

const skinPrefs = createConfigStore({
  key: 'worktodolist.skin',
  defaults: { skin: 'classic' },
  normalize: (c) => ({ skin: clean(c && c.skin) }),
});

/** 脏值一律退回原版：没配过偏好时的默认形态，也是最不会误导的一档。 */
export function clean(skin) {
  return SKINS.includes(skin) ? skin : 'classic';
}

/** 落盘的档位（没配过 = classic）。 */
export function loadSkin() {
  return skinPrefs.loadOr().skin;
}

const listeners = new Set();

function notify(skin) {
  for (const fn of [...listeners]) {
    try {
      fn(skin);
    } catch {
      // 单个订阅者出错不影响其它订阅者，也不影响已经投出去的属性
    }
  }
}

/** 把档位投影到 DOM 并通知订阅者。返回归一后的档位。 */
export function applySkin(skin) {
  const next = clean(skin);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.skin = next;
  }
  notify(next);
  return next;
}

/** 换档：先落盘，再投影。 */
export function setSkin(skin) {
  const next = clean(skin);
  skinPrefs.save({ skin: next });
  return applySkin(next);
}

/** 档位变化。返回取消订阅函数。 */
export function subscribeSkin(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 启动时调用一次：投影落盘档位。重复调用安全（只是再投一次属性）。 */
export function initSkin() {
  applySkin(loadSkin());
}

/** 设置页用：当前档 + 换档函数，订阅落盘变化（与 useListMode 同形状）。 */
export function useSkin() {
  const [skin, setLocal] = useState(loadSkin);
  useEffect(() => subscribeSkin(() => setLocal(loadSkin())), []);
  const pick = useCallback((s) => setSkin(s), []);
  return [skin, pick];
}