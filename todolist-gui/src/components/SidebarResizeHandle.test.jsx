// 侧栏宽度拖拽边界的静态契约：可聚焦的分隔器、aria 区间、自定义宽度读数。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SidebarResizeHandle, { clampForDrag } from './SidebarResizeHandle.jsx';

describe('SidebarResizeHandle', () => {
  it('渲染成可聚焦的垂直分隔器，带 156–240 的 aria 区间', () => {
    const markup = renderToStaticMarkup(<SidebarResizeHandle />);
    expect(markup).toContain('class="sidebar-resize"');
    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('aria-label="调整侧栏宽度"');
    expect(markup).toContain('aria-valuemin="156"');
    expect(markup).toContain('aria-valuemax="240"');
    expect(markup).toContain('tabindex="0"');
    // 没拖过时不报一个假的具体宽度
    expect(markup).not.toContain('aria-valuenow');
  });

  it('拖过的宽度进 aria-valuenow', () => {
    const markup = renderToStaticMarkup(<SidebarResizeHandle width={212} />);
    expect(markup).toContain('aria-valuenow="212"');
  });

  it('拖动夹取：不低于当前默认，不超过 240', () => {
    expect(clampForDrag(120, 176)).toBe(176);
    expect(clampForDrag(200, 176)).toBe(200);
    expect(clampForDrag(999, 176)).toBe(240);
    // 中等屏从 156 起拖时允许留在 156，不逼着跳回 176
    expect(clampForDrag(150, 156)).toBe(156);
    expect(clampForDrag(170, 156)).toBe(170);
  });
});
