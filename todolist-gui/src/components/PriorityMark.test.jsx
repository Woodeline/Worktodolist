// 优先级的渲染冒烟。
//
// 逻辑层（priority.test.js）钉死值域，这里补最后一公里：
// 「档位真的变成颜色类名」「中空旗不是实心」「列表不写汉字」
// 「菜单样张不带第二层提示」「mark 形态（日历 / 写入行）仍是紧凑记号」。
// 这几种失效同样静默：类名写错、prop 传漏，界面不会报错，只是悄悄少一档。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PriorityMark from './PriorityMark.jsx';

const badge = (priority) => renderToStaticMarkup(<PriorityMark priority={priority} />);
const flag = (priority) => renderToStaticMarkup(<PriorityMark priority={priority} variant="flag" />);
const mark = (priority) => renderToStaticMarkup(<PriorityMark priority={priority} variant="mark" />);

describe('badge 形态（任务行标题左侧的旗标）', () => {
  it('五档各有独立类名：旗形不变，只换颜色', () => {
    const tones = [
      ['A', 'high'],
      ['B', 'mid'],
      ['C', 'low'],
      [null, 'none'],
      ['D', 'other'],
    ];
    for (const [priority, tone] of tones) {
      const html = badge(priority);
      expect(html).toContain(`prio-badge prio-${tone}`);
      expect(html).toContain('M4 22V4'); // flag 路径
      expect(html).toContain('fill="none"'); // 中空旗，不是实心
    }
  });

  it('列表不写汉字，文件原文只留在 title / aria-label 里', () => {
    const html = badge('A');
    expect(html).toContain('todo.txt 写作 (A)');
    expect(html).toContain('aria-label=');
    expect(html).not.toContain('>高</span>');
    expect(html).not.toContain('>中</span>');
    expect(html).not.toContain('>低</span>');
    expect(html).not.toContain('>无</span>');
  });

  it('旗的形状没有档次差别 —— 档位只由颜色表达，不靠枚数', () => {
    const count = (html) => (html.match(/<svg/g) || []).length;
    expect(count(badge('A'))).toBe(1);
    expect(count(badge('B'))).toBe(1);
    expect(count(badge('C'))).toBe(1);
  });
});

describe('flag 形态（菜单 / 选择器里的样张）', () => {
  it('不带第二层提示：读屏跳过，也没有 tooltip', () => {
    const html = flag('A');
    expect(html).toContain('prio-badge prio-high');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('aria-label');
  });

  it('「无」也画（菜单里那枚黑旗是给「清除优先级」用的）', () => {
    expect(flag(null)).toContain('prio-badge prio-none');
  });
});

describe('mark 形态（日历 / 写入行 / 选择器）', () => {
  it('是纯形状记号：不带中文、不带图标、读屏跳过', () => {
    const html = mark('A');
    expect(html).toContain('prio-mark prio-high');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('高');
    expect(html).not.toContain('<svg');
  });

  it('「无」也有自己的形状，不借其他字母的档位', () => {
    expect(mark(null)).toContain('prio-mark prio-none');
    expect(mark(null)).not.toContain('prio-other');
    expect(mark('B')).toContain('prio-mark prio-mid');
  });
});
