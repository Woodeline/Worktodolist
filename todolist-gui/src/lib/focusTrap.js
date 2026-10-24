// 浮窗的焦点契约：进得来（打开即聚焦）、出不去（Tab 在窗内循环）、
// 关得掉之后还回得去（关闭时把焦点还给打开它的那一行）。
//
// 桌面浮窗与网页浮层的区别就在这里：背后整个应用还在，焦点不锁的话
// Tab 会一路跳到背后的列表上，看起来浮窗开着、其实已经"穿透"了它。
//
// 这个文件只放纯函数 + 一个薄 DOM 查询 —— node 环境的单测直接驱动纯函数，
// DOM 查询只在浏览器里被调用。

export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// 容器内当前可聚焦的元素，按 DOM 序。不可见的（整棵子树 display:none）不算 ——
// 把它们算进去会让 Tab"跳进"一个看不见的地方。
export function queryFocusable(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0
  );
}

// Tab / Shift+Tab 在陷阱里的落点：到头循环；焦点不在名单里（初始态）时
// 正向给第一个、反向给最后一个。
export function nextInTrap(list, active, shift) {
  if (!list || list.length === 0) return null;
  const idx = Array.isArray(list) ? list.indexOf(active) : -1;
  if (idx === -1) return shift ? list[list.length - 1] : list[0];
  const next = shift ? (idx - 1 + list.length) % list.length : (idx + 1) % list.length;
  return list[next];
}

// 一行还在「体面退场」中（删除 / 完成的高度折叠动画）时，不能当焦点去处：
// 它几十毫秒后就会从 DOM 里消失，焦点跟着它一起蒸发，之后按 Tab 会从工具栏
// 第一个按钮开始 —— 用户看到的就是「焦点跑丢了 / 跑进了工具栏」。
export function isRowRestorable(el) {
  if (!el || el.isConnected === false) return false;
  if (el.classList && el.classList.contains('fading')) return false;
  if (typeof el.getBoundingClientRect === 'function' && el.getBoundingClientRect().height === 0) {
    return false;
  }
  return true;
}

// 关闭浮窗后的焦点去处，按优先级：
//   ① 来源行（活着才算 —— 见 isRowRestorable）；
//   ② 来源行后面的第一个活行 → 前面的第一个活行（删除后顺延，绝不撒手）；
//   ③ 快速添加框（列表页永远在，调用方传 store.quickAddRef.current）。
// 都接不住返回 null —— 那意味着焦点会落到 body，下一个 Tab 从工具栏开始。
// allRows 是文档里全部任务行（DOM 序，含正在退场的），用来定位「相邻」。
export function pickRestoreTarget(originRow, allRows, quickAdd) {
  if (isRowRestorable(originRow)) return originRow;
  if (Array.isArray(allRows)) {
    const at = allRows.indexOf(originRow);
    if (at >= 0) {
      const after = allRows.slice(at + 1).find(isRowRestorable);
      if (after) return after;
      const before = allRows.slice(0, at).reverse().find(isRowRestorable);
      if (before) return before;
    }
    const first = allRows.find(isRowRestorable);
    if (first) return first;
  }
  return quickAdd || null;
}
