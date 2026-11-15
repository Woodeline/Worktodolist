// 活动栏 Tabs 的渲染冒烟。
//
// 纯函数单测盯不到「设置按钮有没有真的删掉」「主题是不是只剩一枚轮换按钮」
// 「置顶态是不是实心图标」—— 这些写错界面不报错，只会悄悄退回旧样子。
// 项目无 jsdom，用 SSR 静态标记补最后一公里，不为此装 DOM 依赖。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { TABS, Tabs } from './App.jsx';
import { ContextMenuProvider } from './hooks/useContextMenu.jsx';

const noop = () => {};

function rail(props = {}) {
  return renderToStaticMarkup(
    <ContextMenuProvider>
      <Tabs
        tab="list"
        onChange={noop}
        store={{}}
        onOpenSettings={noop}
        alwaysOnTop={false}
        onToggleTop={noop}
        themeMode="auto"
        onPickTheme={noop}
        onCycleTheme={noop}
        {...props}
      />
    </ContextMenuProvider>
  );
}

// 按 <button 切段：每段含该按钮的完整开标签 + 内部 SVG + tip 文字。
const buttonChunk = (html, needle) =>
  html.split('<button').find((s) => s.includes(needle)) || '';
const themeChunk = (html) => buttonChunk(html, 'data-mode=');
const svgOf = (chunk) => (chunk.match(/<svg[\s\S]*?<\/svg>/) || [''])[0];

describe('活动栏：页签与设置入口', () => {
  it('两个页签仍在 .tabs-group，文字就是页签名', () => {
    const html = rail();
    expect(html).toContain('class="tabs-group"');
    expect((html.match(/role="tab"/g) || []).length).toBe(TABS.length);
    TABS.forEach(([, label]) => expect(html).toContain(`>${label}</span>`));
  });

  it('不再有设置按钮，应用菜单按钮仍在', () => {
    const html = rail();
    expect(html).not.toContain('title="设置（Ctrl+,）"');
    expect(html).not.toContain('设置 · Ctrl+,');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('>应用菜单</span>');
  });
});

describe('活动栏：置顶靠实心图标表态', () => {
  it('非置顶是描边针、普通 tab；置顶是实心针，但都不套底色块', () => {
    const off = buttonChunk(rail({ alwaysOnTop: false }), 'title="窗口置顶（总在最前）"');
    expect(off).toContain('class="tab"');
    expect(off).not.toContain('is-solid');
    expect(off).not.toContain('is-pinned');
    expect(off).toContain('aria-pressed="false"');
    expect(svgOf(off)).toContain('fill="none"');

    const on = buttonChunk(rail({ alwaysOnTop: true }), 'title="取消窗口置顶"');
    expect(on).toContain('class="tab is-pinned"');
    expect(on).not.toContain('is-solid'); // 旧的黑/白底块，用户明确否掉了
    expect(on).toContain('aria-pressed="true"');
    expect(svgOf(on)).toContain('fill="currentColor"');
  });
});

describe('活动栏：主题只有一枚轮换按钮', () => {
  it('只有一枚按钮，不是三枚', () => {
    const html = rail();
    expect((html.match(/data-mode=/g) || []).length).toBe(1);
  });

  it('按钮图标随当前档变：自动=显示器 / 深色=太阳 / 浅色=月亮', () => {
    const auto = svgOf(themeChunk(rail({ themeMode: 'auto' })));
    expect(auto).toContain('<rect');     // 显示器
    expect(auto).toContain('<path');     // 支架

    const dark = svgOf(themeChunk(rail({ themeMode: 'dark' })));
    expect(dark).toContain('<circle');   // 太阳（圆 + 光芒）

    const light = svgOf(themeChunk(rail({ themeMode: 'light' })));
    expect(light).not.toContain('<circle'); // 月亮：一个闭合路径
    expect(light).toContain('<path');

    expect(new Set([auto, dark, light]).size).toBe(3);
  });

  it('data-mode 与 tip 都读当前档，且不套实心底（不是开关按钮）', () => {
    const html = rail({ themeMode: 'dark' });
    const c = themeChunk(html);
    expect(c).toContain('data-mode="dark"');
    expect(c).toContain('主题 · 深色');
    expect(c).toContain('>深色</span>');
    expect(c).not.toContain('is-solid');
    expect(c).not.toContain('aria-pressed');
  });

  it('点按接的是轮换动作，不是三档各自的落档', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8'
    );
    expect(src).toContain('onCycleTheme={cycleThemeMode}');
    expect(src).toContain('onClick={onCycleTheme}');
  });
});

// 折叠态必须一份状态三处共用：主列表渲染、↑↓ 导航、顶栏「共 N 项」。
// 曾经 MainList 自己 useState、App 用 displayOrder 另算一套，收起父项后
// 键盘会选中一个 DOM 里不存在的行，计数也虚高。
describe('列表折叠的数据流', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8'
  );

  it('状态在 App、下发给 MainList，导航与渲染用同一个 filterCollapsed', () => {
    expect(src).toContain('useRowCollapse()');
    expect(src).toContain('collapsed={collapsed}');
    expect(src).toContain('toggleExpand={toggleExpand}');
    expect(src).toContain('filterCollapsed(nestChildren(visible, nesting), nesting, collapsed)');
    expect(src).toContain('filterCollapsed(nested, nesting, collapsed)');
    expect(src).not.toContain('notCollapsed');
  });
});
