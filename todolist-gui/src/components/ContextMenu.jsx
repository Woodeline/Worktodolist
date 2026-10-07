// 自定义上下文菜单（右键菜单 / 应用菜单共用一个渲染器）。
//
// 为什么必须自己画：浏览器默认右键菜单是这个应用里最强的"网页信号"——
// 菜单顶上是「返回 / 重新加载 / 另存为 / 检查」，跟待办毫无关系。
// 桌面应用的右键菜单只包含「当前这个东西能做什么」。
//
// 键盘契约（对齐系统菜单）：
//   ↑↓ 移动 · Enter 执行 · → 进子菜单 · ← 回上层 · Esc 关闭 · Home/End 首尾
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const VIEWPORT_MARGIN = 6;

// 可停靠（能被上下键选中）的项：分隔线与分组标题跳过
const isSelectable = (it) => it && it.type !== 'sep' && it.type !== 'header';

function MenuList({ items, onClose, onBack }) {
  // 初始不高亮任何项 —— 系统菜单打开时就是"什么都不选"，
  // 第一次按方向键或鼠标移入才产生选中项（避免误按 Enter 触发首项）。
  const [active, setActive] = useState(-1);
  const [subOpen, setSubOpen] = useState(-1);
  const ref = useRef(null);

  const step = (dir) => {
    const idxs = items.map((_, i) => i).filter((i) => isSelectable(items[i]) && !items[i].disabled);
    if (idxs.length === 0) return;
    const cur = idxs.indexOf(active);
    const next =
      cur === -1
        ? idxs[dir > 0 ? 0 : idxs.length - 1]
        : idxs[(cur + dir + idxs.length) % idxs.length];
    setActive(next);
    setSubOpen(-1);
  };

  const run = (it, i) => {
    if (!it || it.disabled) return;
    if (it.type === 'sub') {
      setSubOpen((cur) => (cur === i ? -1 : i));
      return;
    }
    onClose();
    if (it.onClick) it.onClick();
  };

  const onKeyDown = (e) => {
    // 菜单内的按键不再外泄给全局快捷键（否则空格会被当成"完成任务"）
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(items.findIndex((it) => isSelectable(it) && !it.disabled));
    } else if (e.key === 'End') {
      e.preventDefault();
      const idxs = items.map((_, i) => i).filter((i) => isSelectable(items[i]) && !items[i].disabled);
      setActive(idxs[idxs.length - 1]);
    } else if (e.key === 'ArrowRight') {
      if (items[active] && items[active].type === 'sub') {
        e.preventDefault();
        setSubOpen(active);
      }
    } else if (e.key === 'ArrowLeft') {
      if (onBack) {
        e.preventDefault();
        onBack();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run(items[active], active);
    }
  };

  return (
    <div className="ctx-menu" role="menu" ref={ref} tabIndex={-1} onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        if (it.type === 'sep') return <div key={`sep-${i}`} className="ctx-menu-sep" role="separator" />;
        if (it.type === 'header') {
          return (
            <div key={`h-${i}`} className="ctx-menu-header" role="presentation">
              {it.label}
            </div>
          );
        }
        const cls =
          'ctx-menu-item' +
          (i === active ? ' is-active' : '') +
          (it.danger ? ' is-danger' : '') +
          (it.type === 'sub' && subOpen === i ? ' is-open' : '');
        return (
          <div key={`i-${i}`} className="ctx-menu-row">
            <button
              type="button"
              role="menuitem"
              className={cls}
              disabled={Boolean(it.disabled)}
              tabIndex={-1}
              onMouseEnter={() => {
                setActive(i);
                // 悬停到带子菜单的项上直接展开（系统菜单的行为）；
                // 移到别的项则收起，避免菜单一直挂在屏幕上。
                setSubOpen(it.type === 'sub' ? i : -1);
              }}
              onClick={() => run(it, i)}
            >
              <span className="ctx-menu-check">
                {it.checked ? <Icon name="check" size={13} /> : null}
              </span>
              <span className="ctx-menu-label">{it.label}</span>
              {it.accel && <span className="ctx-menu-accel">{it.accel}</span>}
              {it.type === 'sub' && (
                <span className="ctx-menu-arrow">
                  <Icon name="chevron-right" size={12} />
                </span>
              )}
            </button>
            {it.type === 'sub' && subOpen === i && (
              <div className="ctx-submenu">
                <MenuList items={it.items || []} onClose={onClose} onBack={() => setSubOpen(-1)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// x/y 是屏幕坐标；菜单超出视口时先量后翻，避免"贴边被截断"。
export default function ContextMenu({ x, y, items, onClose }) {
  const boxRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - r.width - VIEWPORT_MARGIN);
    }
    if (top + r.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, window.innerHeight - r.height - VIEWPORT_MARGIN);
    }
    setPos({ left, top });
  }, [x, y, items]);

  // 菜单必须自己拿到焦点：否则方向键 / Enter 会漏给全局快捷键，
  // 菜单看起来能用、键盘却毫无反应。
  // 用 useEffect（绘制后）而不是 useLayoutEffect —— 定位就位前元素是
  // visibility:hidden，而隐藏元素无法聚焦；这里必须等样式真正生效。
  useEffect(() => {
    if (!pos) return;
    const menu = boxRef.current && boxRef.current.querySelector('.ctx-menu');
    if (!menu) return;
    // 单次 focus() 在部分环境下会被随后的提交抢走，重试到拿稳为止（最多 4 帧）
    let tries = 0;
    const grab = () => {
      menu.focus();
      if (document.activeElement !== menu && menu.isConnected && tries++ < 4) {
        requestAnimationFrame(grab);
      }
    };
    grab();
  }, [pos]);

  return (
    <div
      className="ctx-anchor"
      ref={boxRef}
      style={{
        left: pos ? pos.left : x,
        top: pos ? pos.top : y,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}
