// 任务侧栏的宽度拖拽边界。
//
// 只出现在宽边（≤768 由 CSS 隐藏，折叠侧栏时 App 不渲染）。
// 5px 命中区压在侧栏右边界上；平时是一条透明线，悬停 / 键盘聚焦 / 拖动时染 accent。
// 双击恢复 CSS 默认（176 / 中等屏 156），不把偏好卡死在某个宽度。
import { useRef } from 'react';
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
} from '../lib/sidebarWidth.js';

function currentSidebarWidth() {
  if (typeof document === 'undefined') return SIDEBAR_WIDTH_DEFAULT;
  const el = document.querySelector('.sidebar');
  return el ? Math.round(el.getBoundingClientRect().width) : SIDEBAR_WIDTH_DEFAULT;
}

/** 从当前实际宽度起拖：不允许比当前默认更窄，最大 240。 */
function clampForDrag(value, startWidth) {
  const min = Math.min(
    SIDEBAR_WIDTH_DEFAULT,
    Math.max(SIDEBAR_WIDTH_MIN, Math.round(startWidth))
  );
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(min, Math.round(value)));
}

export default function SidebarResizeHandle({ width = null, onPreview, onCommit, onReset }) {
  const dragRef = useRef(null);

  const start = (e) => {
    if (e.button !== 0) return;
    const startWidth = currentSidebarWidth();
    dragRef.current = { startX: e.clientX, startWidth };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 指针捕获失败也能靠 handle 上的 move/up 继续拖
    }
    document.body.classList.add('is-resizing-sidebar');
    if (onPreview) onPreview(clampForDrag(startWidth, startWidth));
  };

  const move = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (onPreview) onPreview(clampForDrag(drag.startWidth + e.clientX - drag.startX, drag.startWidth));
  };

  const end = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    document.body.classList.remove('is-resizing-sidebar');
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 已松手 / 捕获丢失时忽略
    }
    if (onCommit) onCommit(clampForDrag(drag.startWidth + e.clientX - drag.startX, drag.startWidth));
  };

  const key = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const startWidth = currentSidebarWidth();
    const step = e.key === 'ArrowRight' ? 8 : -8;
    if (onCommit) onCommit(clampForDrag(startWidth + step, startWidth));
  };

  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={width || undefined}
      tabIndex={0}
      title="拖动调整侧栏宽度，双击恢复默认"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={key}
      onDoubleClick={() => onReset && onReset()}
    />
  );
}

export { clampForDrag, currentSidebarWidth, clampSidebarWidth };
