// 列表显示模式（列表 / 日历）—— 外观偏好，不是数据。
// 与列表颜色同一条红线：不进 todo.txt、不进数据目录，走 configStore
// （一个能力一个键、可清除、改完立刻生效）。换台机器打开同一份 todo.txt，
// 看到的模式跟这台机器的偏好走。
import { useCallback, useEffect, useState } from 'react';
import { createConfigStore } from './configStore.js';

export const LIST_MODES = ['list', 'calendar'];

/** 唯一允许的两个值；脏值（undefined / 手改 localStorage / 旧版残留）一律回落 list。 */
export function normalizeListMode(mode) {
  return mode === 'calendar' ? 'calendar' : 'list';
}

const listModeStore = createConfigStore({
  key: 'worktodolist.list-mode.v1',
  defaults: { mode: 'list' },
  normalize: (c) => ({ mode: normalizeListMode(c && c.mode) }),
});

export function loadListMode() {
  return listModeStore.loadOr().mode;
}

/** 写入即广播：顶栏、应用菜单、设置页三处入口读的是同一份 localStorage。 */
export function saveListMode(mode) {
  return listModeStore.save({ mode: normalizeListMode(mode) });
}

/** @returns {[string, (mode:string)=>void]} 当前模式 + 切换（写入即广播）。 */
export function useListMode() {
  const [mode, setMode] = useState(loadListMode);

  useEffect(() => {
    const off = listModeStore.subscribe(() => setMode(loadListMode()));
    return () => {
      off();
    };
  }, []);

  const pick = useCallback((m) => saveListMode(m), []);

  return [mode, pick];
}