// 右键菜单的渲染冒烟 + 子菜单定位约束。
//
// 项目没有 jsdom，量矩形 / 翻转只能在真浏览器里发生，所以这里守两件事：
// 菜单本身画得出来，以及子菜单确实交给「先量后放」的 Submenu 组件，
// 不许退回 `left: 100%` 那种贴窗口右缘就被裁掉一半的纯 CSS 定位。
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import ContextMenu from './ContextMenu.jsx';

describe('ContextMenu 渲染', () => {
  it('主菜单项、分隔线与带子菜单的项都画得出来', () => {
    // ContextMenu 只在客户端挂载（要靠 getBoundingClientRect 量位置），
    // SSR 冒烟里 useLayoutEffect 的警告没有意义，静音以免污染测试输出。
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const markup = renderToStaticMarkup(
        <ContextMenu
          x={20}
          y={30}
          items={[
            { type: 'item', label: '编辑…', accel: 'E' },
            { type: 'sep' },
            { type: 'sub', label: '优先级', items: [{ type: 'item', label: '高 (A)' }] },
          ]}
          onClose={() => {}}
        />
      );
      expect(markup).toContain('ctx-anchor');
      expect(markup).toContain('ctx-menu-item');
      expect(markup).toContain('编辑…');
      expect(markup).toContain('ctx-menu-accel">E<');
      expect(markup).toContain('优先级');
      expect(markup).toContain('ctx-menu-arrow');
    } finally {
      spy.mockRestore();
    }
  });

  it('两级菜单：一级只列带箭头的分组，不再平铺分组标题', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const markup = renderToStaticMarkup(
        <ContextMenu
          x={20}
          y={30}
          items={[
            { type: 'sub', label: '页面', items: [{ type: 'item', label: '列表' }] },
            { type: 'sub', label: '排序', items: [{ type: 'item', label: '手动' }] },
            { type: 'sub', label: '外观', items: [{ type: 'item', label: '浅色' }] },
          ]}
          onClose={() => {}}
        />
      );
      expect(markup.match(/ctx-menu-arrow/g)).toHaveLength(3);
      expect(markup).not.toContain('ctx-menu-header');
      expect(markup).toContain('页面');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ContextMenu 子菜单定位约束', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ContextMenu.jsx'),
    'utf8'
  );

  it('子菜单交给 Submenu 先量后放，翻转 / 上移都走纯函数', () => {
    expect(src).toContain('<Submenu');
    expect(src).toContain('computeSubmenuPlacement');
    expect(src).toContain('useLayoutEffect');
    expect(src).toContain('place.flip');
    expect(src).toContain('place.shiftX');
  });

  it('量完之前先隐藏，避免先在右侧闪一帧再跳到左侧', () => {
    expect(src).toContain("visibility: 'hidden'");
  });

  it('点已展开的一级分组保持展开（不做 toggle 收起）', () => {
    expect(src).toContain('setSubOpen(i)');
    expect(src).not.toContain('cur === i ? -1 : i');
  });

  it('二级菜单定位后接管键盘焦点，← 回上层把焦点还给分组行', () => {
    expect(src).toContain('menu.focus()');
    expect(src).toContain('btn.focus()');
    expect(src).toContain('onBack={back}');
  });
});
