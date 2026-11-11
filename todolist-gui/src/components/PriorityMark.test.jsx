// 四档徽章的渲染冒烟。
//
// 逻辑层（priority.test.js）已经钉死值域，这里只补最后一公里：
// 「档位真的变成了类名」「中文真的出现在 badge 里」「mark 形态真的不带字」
// 「无优先级真的是空框」。这几种失效同样是静默的 —— 类名写错、prop 传漏，
// 界面不会报错，只是四档又悄悄退化成三档。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PriorityMark from './PriorityMark.jsx';

const badge = (priority) => renderToStaticMarkup(<PriorityMark priority={priority} />);
const mark = (priority) => renderToStaticMarkup(<PriorityMark priority={priority} variant="mark" />);

describe('badge 形态（任务行 / 对话快照）', () => {
  it('四档各自带独立档位类，形状不是同一个样子', () => {
    expect(badge('A')).toContain('prio-badge prio-high');
    expect(badge('B')).toContain('prio-badge prio-mid');
    expect(badge('C')).toContain('prio-badge prio-low');
    expect(badge(null)).toContain('prio-badge prio-none');
    expect(badge('D')).toContain('prio-badge prio-other');
  });

  it('中文分级读数，文件原文只在 title 里', () => {
    expect(badge('A')).toContain('>高</span>');
    expect(badge('A')).toContain('todo.txt 写作 (A)');
    expect(badge('B')).toContain('>中</span>');
    expect(badge('C')).toContain('>低</span>');
    expect(badge('A')).not.toContain('>(A)</span>');
  });

  it('「无」是空框：没有字、读屏跳过、绝不画成「中」', () => {
    const html = badge(null);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('>中</span>');
    expect(html).not.toContain('>低</span>');
    expect(html).not.toContain('>高</span>');
    expect(html).not.toContain('>无</span>');
  });

  it('附加类名能传给快照列，用于收窄尺寸', () => {
    const html = renderToStaticMarkup(
      <PriorityMark priority="A" className="snapshot-prio" />
    );
    expect(html).toContain('snapshot-prio');
    expect(html).toContain('prio-high');
  });
});

describe('mark 形态（日历 / 写入行 / 选择器 / 菜单）', () => {
  it('是纯形状记号：不带中文、读屏跳过', () => {
    const html = mark('A');
    expect(html).toContain('prio-mark prio-high');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('高');
  });

  it('「无」也有自己的形状，不借其他字母的档位', () => {
    expect(mark(null)).toContain('prio-mark prio-none');
    expect(mark(null)).not.toContain('prio-other');
    expect(mark('B')).toContain('prio-mark prio-mid');
  });
});
