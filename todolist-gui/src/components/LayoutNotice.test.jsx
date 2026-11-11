// 提示条是降级方案里唯一的「可见解释」，失效是静默的：
// 用户只看到画面变了、开关没变，却不知道为什么、也不知道怎么切回来。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LayoutNotice from './LayoutNotice.jsx';

const render = (props) => renderToStaticMarkup(<LayoutNotice {...props} />);

describe('LayoutNotice 窄边降级提示', () => {
  it('没有降级时不占任何 DOM', () => {
    expect(render({ state: null })).toBe('');
  });

  it('自动降级时说明是列表口径，并给「仍用日历」', () => {
    const html = render({ state: 'auto-list' });
    expect(html).toContain('layout-notice');
    expect(html).toContain('已按列表排布');
    expect(html).toContain('列表口径');
    expect(html).toContain('仍用日历');
    expect(html).toContain('role="status"');
  });

  it('用户显式覆盖时给「恢复自动」', () => {
    const html = render({ state: 'manual-calendar' });
    expect(html).toContain('仍按日历排布');
    expect(html).toContain('恢复自动');
    expect(html).not.toContain('仍用日历');
  });
});
