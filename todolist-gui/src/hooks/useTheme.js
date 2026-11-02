// 明暗主题的 React 绑定。
//
// 状态真相在 localStorage（lib/theme.js），这里只是它的投影 + 两个动作：
// 点按钮切浅↔深，菜单/右键选档（含"跟随系统"）。
//
// 点按刻意不是三档循环：从肉眼看到的这一屏出发取反，用户永远知道按下会发生什么；
// 想回"跟随系统"走右键或应用菜单，那里三档并列，档位含义写在label上。
import { useCallback, useEffect, useState } from 'react';
import { loadThemeMode, resolveTheme, setThemeMode, subscribeTheme } from '../lib/theme.js';

/**
 * @returns {{mode:string, effective:string, pick:(m:string)=>void, toggle:()=>void}}
 *   mode       落盘档位：'auto' | 'light' | 'dark'
 *   effective  当前真正生效的明暗（auto 已解析）
 *   pick       直接指定档位
 *   toggle     在当前生效色与另一色之间切换（auto 档下等于"离开跟随系统"）
 */
export function useTheme() {
  const [mode, setMode] = useState(loadThemeMode);

  useEffect(() => subscribeTheme((m) => setMode(m)), []);

  const pick = useCallback((next) => setThemeMode(next), []);

  const toggle = useCallback(() => {
    setThemeMode(resolveTheme(loadThemeMode()) === 'dark' ? 'light' : 'dark');
  }, []);

  return { mode, effective: resolveTheme(mode), pick, toggle };
}
