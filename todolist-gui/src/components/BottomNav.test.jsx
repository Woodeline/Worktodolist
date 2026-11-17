// 窄屏底部导航（2026-11-15 十一改）的渲染契约。
//
// 这一层的失效方式全是静默的：导航条又退回侧栏、标签菜单又往下弹、
// 侧栏开关又出现 —— 页面都不报错，只是窄屏手机上多了一只点了没反应的手。
// 项目无 jsdom，用 SSR 静态标记 + 源码/样式契约把这几条钉住。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BottomNav, { buildLabelMenu } from './BottomNav.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseFile } from '../lib/todoParser.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function makeStore(text, extra = {}) {
  const entries = parseFile(text);
  return {
    todoEntries: entries,
    doneEntries: [],
    view: 'all',
    sortMode: 'auto',
    selectView: () => {},
    quickAddRef: { current: null },
    ...extra,
  };
}

function nav(store) {
  return renderToStaticMarkup(
    <ContextMenuProvider>
      <BottomNav store={store} listMode="list" onPickListMode={() => {}} />
    </ContextMenuProvider>
  );
}

describe('底部导航：四个按钮，只有图标', () => {
  it('今日 / 即将到期 / 全部 / 标签 —— 日历与日志不再出现', () => {
    const markup = nav(makeStore('写周报 due:2026-11-20 +投资'));
    ['今日', '即将到期', '全部', '标签'].forEach((label) => expect(markup).toContain(label));
    expect(markup).not.toContain('日历');
    expect(markup).not.toContain('日志');
    // 四枚按钮：三视图 + 标签
    expect((markup.match(/class="bnav-item/g) || []).length).toBe(4);
  });

  it('按钮里只有一枚图标，没有可见文字（文字走 aria-label / title）', () => {
    const markup = nav(makeStore('写周报'));
    const buttons = markup.split('<button').slice(1);
    expect(buttons.length).toBe(4);
    for (const b of buttons) {
      expect(b).toContain('<svg');
      // 去掉开标签的属性、svg 与闭合标签之后，不许剩下可见字符
      const inner = b.slice(b.indexOf('>') + 1);
      expect(inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').trim()).toBe('');
    }
  });

  it('当前视图只点亮一枚（aria-current 全局只出现一次）', () => {
    expect((nav(makeStore('写周报')).match(/aria-current="true"/g) || []).length).toBe(1);
  });

  it('按标签筛的时候点亮的是「标签」，不是「全部」', () => {
    const markup = nav(makeStore('写周报 +投资', { view: '+:投资' }));
    expect((markup.match(/aria-current="true"/g) || []).length).toBe(1);
    const labels = markup.split('<button').find((s) => s.includes('aria-label="标签'));
    expect(labels).toContain('aria-current="true"');
    expect(labels).toContain('bnav-labels');
  });

  it('标签按钮声明了 popup 语义（读屏知道它会弹菜单）', () => {
    const markup = nav(makeStore('写周报'));
    const labels = markup.split('<button').find((s) => s.includes('aria-label="标签'));
    expect(labels).toContain('aria-haspopup="menu"');
  });

  it('计算与侧栏同源：aria-label 里的项数是 tasksForView 的数', () => {
    const text = '写周报 due:2099-12-20\n买菜 due:2099-12-21';
    const markup = nav(makeStore(text));
    // 「今日」= 逾期 + 今天到期 + 无日期；两条都在很久以后，所以是 0
    expect(markup).toContain('今日（0 项）');
    expect(markup).toContain('即将到期（2 项）');
    expect(markup).toContain(`全部（${parseFile(text).length} 项）`);
  });
});

describe('「标签」上弹菜单的数据', () => {
  const stats = {
    contexts: [{ name: '办公室', count: 2 }],
    projects: [{ name: '投资', count: 3 }],
  };
  const dot = () => '#123456';

  it('第一项永远是「不按标签筛选」，未按标签筛时打勾', () => {
    const items = buildLabelMenu(stats, 'all', dot, () => {});
    expect(items[0]).toMatchObject({ type: 'item', label: '不按标签筛选', checked: true });
  });

  it('分类在前、标签在后，各带一个分组标题', () => {
    const items = buildLabelMenu(stats, 'all', dot, () => {});
    const labels = items.filter((i) => i.type === 'header').map((i) => i.label);
    expect(labels).toEqual(['分类 @', '标签 +']);
  });

  it('只有 +标签 带色点：@分类 不是标签', () => {
    const items = buildLabelMenu(stats, 'all', dot, () => {});
    const office = items.find((i) => i.label === '办公室');
    const invest = items.find((i) => i.label === '投资');
    expect(office.mark).toBeUndefined();
    expect(invest.mark).not.toBeUndefined();
  });

  it('当前标签打勾，点它把视图切到 `+:名` / `@:名`', () => {
    const picked = [];
    const items = buildLabelMenu(stats, '+:投资', dot, (v) => picked.push(v));
    const invest = items.find((i) => i.label === '投资');
    expect(invest.checked).toBe(true);
    invest.onClick();
    expect(picked).toEqual(['+:投资']);

    const ctx = buildLabelMenu(stats, 'all', dot, (v) => picked.push(v)).find(
      (i) => i.label === '办公室'
    );
    ctx.onClick();
    expect(picked).toEqual(['+:投资', '@:办公室']);
  });

  it('一个标签都没有时给一句交代，而不是弹出一片空白', () => {
    const items = buildLabelMenu({ contexts: [], projects: [] }, 'all', dot, () => {});
    const last = items[items.length - 1];
    expect(last).toMatchObject({ type: 'item', disabled: true });
    expect(last.label).toContain('还没有');
  });
});

describe('版式契约（源码 / 样式）', () => {
  const css = readFileSync(path.join(here, '..', 'index.css'), 'utf8');
  const src = readFileSync(path.join(here, 'BottomNav.jsx'), 'utf8');

  it('宽屏整条不显示，窄屏才出现在窗口底边', () => {
    const base = css.slice(css.indexOf('.bottom-nav {'));
    expect(base.slice(0, base.indexOf('}'))).toContain('display: none');
    // 窄屏媒体里翻成 flex 并给出高度
    expect(css).toContain('height: var(--bottomnav-h)');
  });

  it('底部导航是网格里独立的一行 —— 清单再长也压不到按钮（不靠 padding 让位）', () => {
    expect(css).toContain('grid-template-rows: var(--rail-row-h) minmax(0, 1fr) auto');
    expect(css).toContain('grid-template-rows: var(--titlebar-h) var(--rail-row-h) minmax(0, 1fr) auto');
    expect(css).toContain('.app.has-titlebar .bottom-nav');
  });

  it('窄屏不显示侧栏开关，侧栏本身也退场', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 768px)'));
    expect(narrow.slice(0, narrow.indexOf('@media (pointer: coarse)'))).toContain(
      '.panel-toggle {\n    display: none;'
    );
    expect(narrow).toContain('.sidebar {\n    display: none;');
  });

  it('外壳行高：标题行 / 页签条取 --chrome-row-h(31)，底栏取 1.2 倍（+20%）', () => {
    expect(css).toContain('--chrome-row-h: 31px');
    expect(css).toContain('--rail-row-h: var(--chrome-row-h)');
    expect(css).toContain('--titlebar-h: var(--chrome-row-h)');
    expect(css).toContain('--bottomnav-h: calc(var(--chrome-row-h) * 1.2)');
    // 页签按钮比行高矮 1px，留给选中条 / 边框
    expect(css).toContain('--rail-tab-size: calc(var(--chrome-row-h) - 1px)');
  });

  it('标题行跟着降档，红绿灯位置成对下移', () => {
    expect(css).toContain('--titlebar-h: var(--chrome-row-h)');
    const conf = readFileSync(path.join(here, '..', '..', 'src-tauri', 'tauri.conf.json'), 'utf8');
    expect(conf).toContain('"trafficLightPosition": { "x": 16, "y": 18 }');
  });

  it('图钉 45° 倾斜', () => {
    expect(css).toContain('.pin-tilt {\n  transform: rotate(45deg);');
    expect(src).not.toContain('pin-tilt'); // 倾斜写在 App 的 <Tabs> 里，不在底部导航
  });

  it('标签菜单从下往上弹（不下弹到窗口外）', () => {
    expect(src).toContain("place: 'above'");
  });
});
