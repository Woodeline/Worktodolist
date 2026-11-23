// 任务侧栏宽度：本机偏好。
//
// 默认 176（中等屏由 CSS 收到 156）；用户只能在宽边模式拖动边界，小幅调增到 240。
// 不写进 todo.txt：这是外观，不是数据；也不影响设置页自己的分类侧栏（它读根令牌）。
import { createConfigStore } from './configStore.js';

export const SIDEBAR_WIDTH_DEFAULT = 176;
export const SIDEBAR_WIDTH_MIN = 156;
export const SIDEBAR_WIDTH_MAX = 240;

/** 把宽度收进可用区间；非数字回默认。 */
export function clampSidebarWidth(value) {
  if (value === '' || value === null || value === undefined) return SIDEBAR_WIDTH_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)));
}

const prefs = createConfigStore({
  key: 'worktodolist.sidebar-width',
  defaults: { width: SIDEBAR_WIDTH_DEFAULT },
  normalize: (c) => ({ width: clampSidebarWidth(c && c.width) }),
});

/** 落盘宽度（没配过 = 176）。 */
export function loadSidebarWidth() {
  return prefs.loadOr().width;
}

/** 是否真的拖过（决定要不要覆盖中等屏的 156 默认）。 */
export function hasCustomSidebarWidth() {
  return prefs.hasStored();
}

export function saveSidebarWidth(width) {
  return prefs.save({ width: clampSidebarWidth(width) });
}

/** 双击恢复默认：清掉本机键，让 CSS 的 176 / 156 重新生效。 */
export function clearSidebarWidth() {
  return prefs.clear();
}
