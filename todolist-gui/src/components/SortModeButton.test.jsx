// 排序图标钮的渲染契约：自动上下箭头 / 手动抓手；两档都不是文字按钮。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SortModeButton from './SortModeButton.jsx';

const noop = () => {};

function render(sortMode) {
  return renderToStaticMarkup(
    <SortModeButton store={{ sortMode, setSortMode: noop }} />
  );
}

describe('SortModeButton', () => {
  it('自动档画上下箭头，手动档画抓手', () => {
    const auto = render('auto');
    expect(auto).toContain('data-sort="auto"');
    expect(auto).toContain('aria-label="排序：自动"');
    expect(auto).toContain('class="quick-sort"');
    expect(auto).toContain('M17 20V4');

    const manual = render('manual');
    expect(manual).toContain('data-sort="manual"');
    expect(manual).toContain('aria-label="排序：手动"');
    expect((manual.match(/<circle/g) || []).length).toBe(6);
  });

  it('没有 store 时不渲染', () => {
    expect(renderToStaticMarkup(<SortModeButton store={null} />)).toBe('');
  });
});
