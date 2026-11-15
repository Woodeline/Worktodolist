// 列表行的点击间隔分流（纯函数，不依赖浏览器 / 操作系统的双击阈值）。
//
// 旧行为只挂 onDoubleClick，快慢全由系统说了算：间隔一超过阈值，浏览器就把它
// 拆成两次独立单击，第二次什么也不做。现在按「两次点击之间的毫秒数」自己判定，
// 并把原生 onDoubleClick 摘掉 —— 否则同一次快双击会被两套逻辑各处理一遍。
export const DOUBLE_CLICK_MS = 300;
export const SLOW_DOUBLE_MS = 900;

/**
 * @param {object} p
 * @param {number} p.elapsedMs 距上一次点击的毫秒数
 * @param {boolean} p.sameRow  上一次点击是不是同一条任务行
 * @returns {'single'|'double'|'slow-double'}
 *   single      只选中（含两次相隔过久的独立单击）
 *   double      间隔较短的常规双击 → 打开编辑浮窗
 *   slow-double 间隔较长、不构成常规双击的慢速双击 → 行内编辑标题
 */
export function classifyRowClick({ elapsedMs, sameRow }) {
  if (!sameRow || !Number.isFinite(elapsedMs) || elapsedMs < 0) return 'single';
  if (elapsedMs <= DOUBLE_CLICK_MS) return 'double';
  if (elapsedMs <= SLOW_DOUBLE_MS) return 'slow-double';
  return 'single';
}
