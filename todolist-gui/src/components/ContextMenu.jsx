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
import { computeMenuPlacement, computeSubmenuPlacement, VIEWPORT_MARGIN } from '../lib/placement.js';

// 可停靠（能被上下键选中）的项：分隔线与分组标题跳过
const isSelectable = (it) => it && it.type !== 'sep' && it.type !== 'header';

// 子菜单自己「先量后放」：外层只量了主菜单 anchor，管不到往外长的这一层。
// 贴窗口右缘时翻到父行左侧，贴下缘时上移，窗口极窄时再夹回视口 ——
// 否则子菜单右半截（括注、圆角、文字）直接被窗口裁掉，看起来像少了内容。
function Submenu({ items, onClose, onBack }) {
  const ref = useRef(null);
  const [place, setPlace] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const row = el && el.parentElement;
    if (!el || !row) return;
    const menu = el.getBoundingClientRect();
    setPlace(
      computeSubmenuPlacement(
        row.getBoundingClientRect(),
        menu,
        { width: window.innerWidth, height: window.innerHeight },
        VIEWPORT_MARGIN
      )
    );
  }, []);

  // 定位完成（visibility 生效）后把键盘焦点交给二级列表：
  // 否则 → 展开之后方向键 / Enter 仍停在一级，二级项鼠标能点、键盘却够不着。
  useEffect(() => {
    if (!place) return;
    const menu = ref.current && ref.current.querySelector('.ctx-menu');
    if (menu) menu.focus();
  }, [place]);

  // ← 回上层时把焦点还给分组行，别让焦点掉到 body 上。
  const back = () => {
    const row = ref.current && ref.current.parentElement;
    const btn = row && row.querySelector('.ctx-menu-item');
    onBack();
    if (btn) btn.focus();
  };

  // 量完之前先藏着：不然会先在右侧闪一帧，再跳到左侧。
  const style = place
    ? {
        top: place.top,
        left: place.flip ? 'auto' : undefined,
        right: place.flip ? 'calc(100% + 2px)' : undefined,
        transform: place.shiftX ? `translateX(${place.shiftX}px)` : undefined,
      }
    : { visibility: 'hidden' };

  return (
    <div className="ctx-submenu" ref={ref} style={style}>
      <MenuList items={items} onClose={onClose} onBack={back} />
    </div>
  );
}

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
      // 一级分组点一下就是「展开」：悬停已经把它打开了，再按 toggle 收回去，
      // 会让「点分组」看起来像什么都没做。收起交给 ← 或移到别的项。
      setSubOpen(i);
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
                {it.checked ? <Icon name="check" size={16} /> : null}
              </span>
              {/* 优先级子菜单用同一套档位形状：对勾表「当前选中」，记号表「这一档有多急」 */}
              {it.mark}
              <span className="ctx-menu-label">{it.label}</span>
              {it.accel && <span className="ctx-menu-accel">{it.accel}</span>}
              {it.type === 'sub' && (
                <span className="ctx-menu-arrow">
                  <Icon name="chevron-right" size={12} />
                </span>
              )}
            </button>
            {it.type === 'sub' && subOpen === i && (
              <Submenu items={it.items || []} onClose={onClose} onBack={() => setSubOpen(-1)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// x/y 是屏幕坐标；菜单超出视口时先量后放，避免"贴边被截断"。
// place='above'：y 按"锚点上缘"解释，菜单从下往上弹（窗口底部的按钮用）。
export default function ContextMenu({ x, y, items, onClose, place }) {
  const boxRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(
      computeMenuPlacement(
        x,
        y,
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
        place === 'above' ? 'above' : 'below'
      )
    );
  }, [x, y, items, place]);

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
