// 页眉（TopBar）的渲染契约。
//
// 这一层出事不报错，只会悄悄退回旧样子：搜索框又常驻、排序又变回「排序 · 手动」那枚
// 文字按钮、面包屑又长出「/ 到期与逾期」。项目无 jsdom，用 SSR 静态标记补最后一公里。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TopBar from './TopBar.jsx';

const noop = () => {};

function bar({ store: extra = {}, ...props } = {}) {
  const store = {
    view: 'today',
    search: '',
    setSearch: noop,
    searchRef: { current: null },
    sortMode: 'auto',
    setSortMode: noop,
    ...extra,
  };
  return renderToStaticMarkup(
    <TopBar
      store={store}
      tab="list"
      sidebarCollapsed={false}
      onToggleSidebar={noop}
      listMode="list"
      effectiveMode="list"
      onPickListMode={noop}
      searchOpen={false}
      onOpenSearch={noop}
      onCloseSearch={noop}
      {...props}
    />
  );
}

// 按 <button 切段：每段含该按钮的完整开标签 + 内部 SVG + tip 文字。
const chunk = (html, needle) => html.split('<button').find((s) => s.includes(needle)) || '';
const svgOf = (c) => (c.match(/<svg[\s\S]*?<\/svg>/) || [''])[0];

describe('页眉：搜索平时只有一个按钮', () => {
  it('收起时只有放大镜按钮，没有输入框', () => {
    const html = bar();
    expect(html).toContain('aria-label="搜索任务"');
    expect(html).not.toContain('placeholder="搜索任务"');
    expect(html).not.toContain('class="search"');
  });

  it('点开后才长出输入框与关闭键（输入框不再是常驻控件）', () => {
    const html = bar({ searchOpen: true });
    expect(html).toContain('class="search"');
    expect((html.match(/placeholder="搜索任务"/g) || []).length).toBe(1);
    expect(html).toContain('class="search-close"');
  });

  it('有关键词时按钮亮起（筛选生效要有痕迹）', () => {
    const html = bar({ store: { search: 'UL' } });
    expect(chunk(html, 'aria-label="搜索任务"')).toContain('is-on');
  });
});

describe('页眉：排序是一枚图标钮', () => {
  it('自动档画上下箭头，手动档画抓手，两者都不是文字按钮', () => {
    const auto = chunk(bar({ store: { sortMode: 'auto' } }), 'data-sort="auto"');
    expect(auto).toContain('aria-label="排序：自动"');
    expect(svgOf(auto)).toContain('M17 20V4');
    expect(auto).not.toContain('排序 ·');

    const manual = chunk(bar({ store: { sortMode: 'manual' } }), 'data-sort="manual"');
    expect(manual).toContain('aria-label="排序：手动"');
    expect((svgOf(manual).match(/<circle/g) || []).length).toBe(6);
  });

  it('日历里不给排序钮（那里没有作用对象）', () => {
    const html = bar({ listMode: 'calendar', effectiveMode: 'calendar' });
    expect(html).not.toContain('data-sort');
  });
});

describe('页眉：只留「我在哪」', () => {
  it('面包屑只剩标题，不带计数与描述段', () => {
    const html = bar();
    const crumb = (html.match(/<div class="crumb"[\s\S]*?<\/div>/) || [''])[0];
    expect(crumb).toContain('<b>今日</b>');
    expect(crumb).not.toContain('项');
    ['到期与逾期', '分类过滤', 'todo.txt', '只读'].forEach((s) => expect(crumb).not.toContain(s));
  });

  it('项目视图保留色点，但同样不带描述文字', () => {
    const html = bar({ store: { view: '+:材料开发' } });
    expect(html).toContain('class="nav-dot"');
    expect(html).not.toContain('项目过滤');
  });
});

describe('页眉：左「开关 + 视图」/ 右「搜索 + 排序」', () => {
  it('DOM 顺序就是视觉顺序', () => {
    const html = bar();
    const iToggle = html.indexOf('aria-label="折叠侧栏"');
    const iCrumb = html.indexOf('class="crumb"');
    const iSearch = html.indexOf('aria-label="搜索任务"');
    const iSort = html.indexOf('data-sort=');
    expect(iToggle).toBeGreaterThan(-1);
    expect(iToggle).toBeLessThan(iCrumb);
    expect(iCrumb).toBeLessThan(iSearch);
    expect(iSearch).toBeLessThan(iSort);
  });

  it('列表/日历切换控件已移除 —— 日历降为侧栏入口，页眉不再有 mode-switch', () => {
    const html = bar();
    expect(html).not.toContain('mode-switch');
    expect(html).not.toContain('mode-btn');
    expect(html).not.toContain('列表显示模式');
  });

  it('侧栏开关画 panel-left 面板图形（不再是自绘折叠箭头）', () => {
    const html = bar();
    const toggle = chunk(html, 'aria-label="折叠侧栏"');
    expect(svgOf(toggle)).toContain('M9 3v18');
  });

  it('三枚图标钮同一个类名（同族 = 同尺寸同悬停）', () => {
    const html = bar();
    ['aria-label="折叠侧栏"', 'aria-label="搜索任务"', 'data-sort='].forEach((needle) => {
      expect(chunk(html, needle)).toContain('class="ctx-btn ctx-btn-icon');
    });
  });
});
