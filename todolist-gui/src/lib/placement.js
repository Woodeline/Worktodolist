// 浮层落点的纯计算（不碰 DOM，方便在 Node 里单测）。
//
// 两个浮层吃过同一个亏：「贴着触发元素写死 top/left」，于是
//   ① 右键菜单的子菜单贴窗口右缘展开，右半截（含括注与圆角）被裁掉；
//   ② 编辑浮窗里的候选清单向上翻，顶部一行被 .drawer-body 的滚动区裁掉。
// 共同的解法是先量后放：量出可用空间，再决定翻向哪边、要不要夹回视口。
// 这里只算数字，组件负责把结果写进 style —— 纯函数单测能守住边界条件。

export const VIEWPORT_MARGIN = 6;
export const TAG_MENU_MAX_HEIGHT = 216;
// 日历「当天任务」弹层的尺码：宽度与旧右栏同档（288），高度给到约 6 行任务。
export const DAY_POPOVER_W = 288;
export const DAY_POPOVER_H = 320;

const SUBMENU_GAP = 2;
const SUBMENU_BASE_TOP = -5;
const TAG_GAP = 4;
const TAG_MARGIN = 8;

/**
 * 子菜单落点。默认贴父行右缘展开、上移 5px 对齐。
 *
 * @param {{left:number,right:number,top:number,height:number}} row 父行矩形
 * @param {{left:number,right:number,top:number,width:number,height:number}} menu 子菜单按默认位置量出的矩形
 * @param {{width:number,height:number}} viewport 视口
 * @param {number} margin 安全边距
 * @returns {{flip:boolean, shiftX:number, top:number}}
 *          flip —— 翻到父行左侧；shiftX —— 翻转后仍顶出左边界时的水平补偿；
 *          top —— 相对父行的垂直偏移（CSS top 的基准）。
 */
export function computeSubmenuPlacement(row, menu, viewport, margin = VIEWPORT_MARGIN) {
  const flip = menu.right > viewport.width - margin;
  // 翻转后右缘贴父行左缘；窗口极窄时用水平位移把左缘夹回来，宁可盖住一点主菜单也不裁字。
  const flippedLeft = row.left - SUBMENU_GAP - menu.width;
  const shiftX = flip && flippedLeft < margin ? margin - flippedLeft : 0;

  let top = SUBMENU_BASE_TOP;
  const bottom = row.top + top + menu.height;
  if (bottom > viewport.height - margin) {
    top -= bottom - (viewport.height - margin);
  }
  // 上移过头会顶出视口上缘，同样夹住。
  const minTop = margin - row.top;
  if (top < minTop) top = minTop;
  return { flip, shiftX, top };
}

/**
 * 通用菜单落点（右键菜单 / 应用菜单 / 窄屏「标签」上弹菜单共用）。
 *
 * place='below'：菜单左上角对齐锚点（右键点在哪儿，菜单就从哪儿长出来）。
 * place='above'：菜单底边贴住锚点上缘 —— 锚点在窗口最下沿时（窄屏底部导航）
 *   往下弹只会被窗口裁掉，或者被夹回来盖住按钮自己。
 *
 * @param {number} x 锚点 x（视口坐标）
 * @param {number} y 锚点 y；place='above' 时按"锚点上缘"解释
 * @param {{width:number,height:number}} menu 量出来的菜单尺寸
 * @param {{width:number,height:number}} viewport 视口
 * @param {'below'|'above'} place
 * @param {number} margin 安全边距
 * @returns {{left:number, top:number}}
 */
export function computeMenuPlacement(x, y, menu, viewport, place = 'below', margin = VIEWPORT_MARGIN) {
  let left = x;
  let top = y;
  if (place === 'above') {
    top = y - menu.height;
  } else if (top + menu.height > viewport.height - margin) {
    top = viewport.height - menu.height - margin;
  }
  if (left + menu.width > viewport.width - margin) {
    left = Math.max(margin, viewport.width - menu.width - margin);
  }
  // 菜单比视口还高（很长的标签清单）时只能夹到上边距，允许它压住锚点。
  if (top < margin) top = margin;
  return { left, top };
}

/**
 * 编辑浮窗里 @分类 / +标签 候选清单的落点。
 * 优先向下；下方不够而上方更宽裕时才向上翻。高度按可用空间收缩，
 * 菜单自身 overflow-y:auto 负责滚动 —— 首行永远完整可见。
 *
 * @param {{left:number,right:number,top:number,bottom:number,width:number}} anchor 触发字段矩形
 * @param {{width:number,height:number}} viewport 视口
 * @param {number} desiredHeight 期望最大高度
 * @param {number} margin 安全边距
 * @returns {{top:number,left:number,width:number,maxHeight:number,dropUp:boolean}}
 */
export function computeTagMenuPlacement(
  anchor,
  viewport,
  desiredHeight = TAG_MENU_MAX_HEIGHT,
  margin = TAG_MARGIN
) {
  const below = viewport.height - margin - (anchor.bottom + TAG_GAP);
  const above = anchor.top - TAG_GAP - margin;
  const dropUp = below < desiredHeight && above > below;
  const available = Math.max(0, dropUp ? above : below);
  const maxHeight = Math.min(desiredHeight, available);
  const top = dropUp
    ? Math.max(margin, anchor.top - TAG_GAP - maxHeight)
    : anchor.bottom + TAG_GAP;
  const width = Math.min(anchor.width, viewport.width - margin * 2);
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width));
  return { top, left, width, maxHeight, dropUp };
}

/**
 * 日历格子 →「当天任务」弹层的落点。
 *
 * 与候选清单同一套先量后放，但锚点是**一整个格子**（宽高都由网格决定），
 * 所以宽度独立给定、不跟锚点走：格子只有 90px 宽，弹层要放得下任务行。
 * 下方装不下就翻到格子上方；两个方向都紧时按可用空间收缩高度（自身滚动），
 * 横向永远夹回视口内 —— 最右一列的弹层不会探出窗口。
 *
 * @param {{left:number,right:number,top:number,bottom:number}} anchor 格子矩形
 * @param {{width:number,height:number}} viewport 视口
 * @param {number} desiredHeight 期望高度（内容多时按它封顶）
 * @param {number} desiredWidth 期望宽度
 * @param {number} margin 安全边距
 * @returns {{top:number,left:number,width:number,maxHeight:number,dropUp:boolean}}
 */
export function computeDayPopoverPlacement(
  anchor,
  viewport,
  desiredHeight = DAY_POPOVER_H,
  desiredWidth = DAY_POPOVER_W,
  margin = VIEWPORT_MARGIN
) {
  const gap = 4;
  const width = Math.max(160, Math.min(desiredWidth, viewport.width - margin * 2));
  const want = Math.min(desiredHeight, Math.max(0, viewport.height - margin * 2));
  const roomBelow = Math.max(0, viewport.height - margin - (anchor.bottom + gap));
  const roomAbove = Math.max(0, anchor.top - gap - margin);
  // 下方差得不多、上方更宽裕时才翻 —— 否则会为了几像素把弹层甩到屏幕另一头。
  const dropUp = roomBelow < want && roomAbove > roomBelow;
  const maxHeight = Math.max(0, Math.min(want, Math.max(roomBelow, roomAbove)));
  const rawTop = dropUp ? anchor.top - gap - maxHeight : anchor.bottom + gap;
  const top = Math.max(margin, Math.min(rawTop, viewport.height - margin - maxHeight));
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width));
  return { top, left, width, maxHeight, dropUp };
}
