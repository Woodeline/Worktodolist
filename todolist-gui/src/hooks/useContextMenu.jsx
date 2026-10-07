// 应用外壳行为（桌面化）：
//   1. 统一接管 contextmenu —— 任何位置都不再弹浏览器的默认右键菜单；
//   2. 屏蔽 Chromium 的「网页」快捷键与手势（打印、查找、缩放、文件拖放导航）；
//   3. 提供 useContextMenu() 给各组件挂自己的上下文动作。
//
// 判断标准：桌面应用不会有"页面被打印""整页缩放""把文件拖进来变成一次跳转"。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ContextMenu from '../components/ContextMenu.jsx';

const MenuContext = createContext(null);

// 能承载"剪切/复制/全选"的输入类型（checkbox / date / range 之类不算）
const TEXT_INPUT_TYPES = new Set(['', 'text', 'password', 'search', 'email', 'url', 'tel', 'number']);

export function useContextMenu() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error('useContextMenu 必须在 <ContextMenuProvider> 内使用');
  return ctx;
}

// 输入类控件的标准编辑菜单。粘贴走系统快捷键（Ctrl+V），浏览器不允许网页程序
// 主动读剪贴板后再写回受控输入框，硬做会让 React 的受控值失同步。
export function inputMenu(getInput) {
  const el = () => {
    const node = typeof getInput === 'function' ? getInput() : getInput;
    return node && node.focus ? node : null;
  };
  const run = (cmd) => {
    const node = el();
    if (!node) return;
    node.focus();
    try {
      document.execCommand(cmd);
    } catch {
      /* 无选区时忽略 */
    }
  };
  return [
    { type: 'item', label: '剪切', accel: 'Ctrl+X', onClick: () => run('cut') },
    { type: 'item', label: '复制', accel: 'Ctrl+C', onClick: () => run('copy') },
    { type: 'sep' },
    {
      type: 'item',
      label: '全选',
      accel: 'Ctrl+A',
      onClick: () => {
        const node = el();
        if (node && node.select) node.select();
      },
    },
  ];
}

// 只读文本（对话消息、任务行、快照项）的菜单：复制当前选中的内容。
export function copyMenu(getText) {
  return [
    {
      type: 'item',
      label: '复制',
      accel: 'Ctrl+C',
      onClick: () => {
        const text = typeof getText === 'function' ? getText() : getText;
        if (!text) return;
        const sel = typeof window !== 'undefined' ? window.getSelection() : null;
        const picked = sel && String(sel).trim() ? String(sel) : text;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(picked).catch(() => {});
        }
      },
    },
  ];
}

export function ContextMenuProvider({ children }) {
  const [menu, setMenu] = useState(null); // { x, y, items }
  // 菜单会抢走焦点（键盘导航需要），关掉之后要把焦点还给原来的控件
  const prevFocusRef = useRef(null);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenu(null);
    const el = prevFocusRef.current;
    prevFocusRef.current = null;
    // 选了菜单项 / 按了 Esc → 焦点还给原控件；
    // 用户点到别处 → 不抢回来（那会打断他刚点的那一下）。
    if (restoreFocus && el && el.isConnected && typeof el.focus === 'function') {
      // 等菜单卸载完再还焦点，否则会被移除节点的默认焦点处理覆盖掉
      setTimeout(() => el.focus({ preventScroll: true }), 0);
    }
  }, []);

  const openAt = useCallback((x, y, items) => {
    if (!items || items.length === 0) return;
    setMenu((cur) => {
      if (!cur && typeof document !== 'undefined') prevFocusRef.current = document.activeElement;
      return { x, y, items };
    });
  }, []);

  // 组件绑定的右键入口：e 为 React 合成事件
  const openMenu = useCallback(
    (e, items) => {
      if (!items || items.length === 0) return;
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      // 键盘唤出（Shift+F10 / 菜单键）时 clientX/Y 为 0，落到触发元素的左下角
      if (e && e.clientX === 0 && e.clientY === 0 && e.currentTarget) {
        const r = e.currentTarget.getBoundingClientRect();
        openAt(r.left + 12, r.bottom - 6, items);
        return;
      }
      openAt(e ? e.clientX : 0, e ? e.clientY : 0, items);
    },
    [openAt]
  );

  // 兜底策略（两级）：
  //   1. 任何位置都不再弹浏览器的默认右键菜单 —— 那是"网页"最强的信号；
  //   2. 落在文本框上的右键自动获得标准编辑菜单，省得每个输入框各挂一遍。
  // 组件若自己接管了右键会 stopPropagation，走不到这里，不会重复弹菜单。
  useEffect(() => {
    const isTextField = (t) =>
      t &&
      (t.tagName === 'TEXTAREA' ||
        (t.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(String(t.type || '').toLowerCase())));
    const onCtx = (e) => {
      e.preventDefault();
      const t = e.target;
      if (isTextField(t)) setMenu({ x: e.clientX, y: e.clientY, items: inputMenu(() => t) });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

  // 网页专属的快捷键与手势
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      // 保留 Ctrl+R / F5（重载数据是有意义的操作），屏蔽纯网页行为
      if (k === 'p' || k === 'f' || k === 'g' || k === 'u' || k === 'j') {
        e.preventDefault();
      }
      if (k === '+' || k === '-' || k === '=' || k === '0') e.preventDefault();
    };
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    // 把文件拖进窗口不该变成一次页面跳转
    const swallow = (e) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  // 关闭时机：点到菜单外、Esc、滚动、窗口尺寸变化或失焦
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('.ctx-menu')) return;
      closeMenu(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
      }
    };
    const onDismiss = () => closeMenu(false);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('blur', onDismiss);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('blur', onDismiss);
    };
  }, [menu, closeMenu]);

  const value = useMemo(() => ({ openMenu, openAt, closeMenu, isOpen: Boolean(menu) }), [openMenu, openAt, closeMenu, menu]);

  return (
    <MenuContext.Provider value={value}>
      {children}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </MenuContext.Provider>
  );
}
