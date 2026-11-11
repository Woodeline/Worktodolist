// 窄边自动降级：用户偏好 / 运行时宽度 / 本次显式覆盖，三层分开。
//
// 2026-11-11 评估结论的落地。关键一条：**偏好永不因窗口宽度被改写**。
// 显示模式是 configStore 单键的持久化外观偏好（worktodolist.list-mode.v1），
// 窄边写盘等于把「窗口一时变窄」记成「用户永久选了列表」，宽边也不会自动还原。
// 所以这里只算「此刻该用哪种布局」，不改偏好、不落盘、不广播。
// 宽边自动还原不是靠记忆状态，而是因为偏好从头到尾没动过。
//
// 优先级：用户显式覆盖 > 窄边自动降级 > 持久化偏好。

/** 主区可用宽度：低于 480 进入列表布局，高于 560 才回日历。
 *  480 对应 CSS 里「日详情 / 托盘纵摞、chip 退化成 8px 色块」那一档 ——
 *  截图里任务标题被截断、托盘文字读不出的就是它。
 *  退出阈值刻意高于进入阈值：中间这段是滞回带，避免拖窗口时反复翻转。 */
export const NARROW_ENTER_PX = 480;
export const NARROW_EXIT_PX = 560;

/**
 * 双阈值迟滞。width 为 null（主区还没挂载 / 设置页覆盖）时保持上一次判定，
 * 避免布局切换过程中把窄边状态误重置成宽边。
 */
export function hysteresisNarrow(currentNarrow, width, enter = NARROW_ENTER_PX, exit = NARROW_EXIT_PX) {
  if (width == null || !Number.isFinite(width)) return Boolean(currentNarrow);
  if (width < enter) return true;
  if (width > exit) return false;
  return Boolean(currentNarrow);
}

/** 有效布局：真正决定渲染 CalendarView 还是 MainList 的那个值。 */
export function resolveEffectiveMode({ preferred, narrow, override = null }) {
  if (override === 'calendar' || override === 'list') return override;
  const base = preferred === 'calendar' ? 'calendar' : 'list';
  if (!narrow) return base;
  return base === 'calendar' ? 'list' : base;
}

/**
 * 提示条状态。窄边且偏好为日历时才可能出现，两种：
 *   auto-list        —— 已自动降级，给「仍用日历」入口
 *   manual-calendar  —— 用户显式覆盖，给「恢复自动」入口
 * 其余（宽边 / 偏好本来就是列表）不显示提示。
 */
export function noticeState({ preferred, narrow, override = null, effective }) {
  if (!narrow || preferred !== 'calendar') return null;
  if (override === 'calendar') return 'manual-calendar';
  if (effective === 'list') return 'auto-list';
  return null;
}
