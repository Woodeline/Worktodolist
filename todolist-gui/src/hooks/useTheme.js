// 明暗主题的 React 绑定。
//
// 状态真相在 localStorage（lib/theme.js），这里只是它的投影 + 换档动作。
// 活动栏只有**一枚**主题按钮：点一次按 THEME_CYCLE 轮换（跟随系统 → 深色 → 浅色）；
// 想直接落到某一档走应用菜单「外观」分组，两条入口读同一份档位表。
import { useCallback, useEffect, useState } from 'react';
import { loadThemeMode, nextThemeMode, setThemeMode, subscribeTheme } from '../lib/theme.js';

/**
 * @returns {{mode:string, pick:(m:string)=>void, cycle:()=>void}}
 *   mode  落盘档位：'auto' | 'light' | 'dark'
 *   pick  直接指定档位（应用菜单用）
 *   cycle 轮换到下一档（活动栏按钮用）
 */
export function useTheme() {
  const [mode, setMode] = useState(loadThemeMode);

  useEffect(() => subscribeTheme((m) => setMode(m)), []);

  const pick = useCallback((next) => setThemeMode(next), []);

  // 从落盘值算下一档，而不是用闭包里的 mode：连点两下时 state 还没回流，
  // 用旧值会把第二次点击算成同一档、按钮看起来"点不动"。
  const cycle = useCallback(() => setThemeMode(nextThemeMode(loadThemeMode())), []);

  return { mode, pick, cycle };
}
