// 自绘窗控的结构冒烟：按钮标签与缩放命中区数量。
// 行为（IPC 调用）在 lib/windowChrome.test.js 里守；这里只确保
// Windows 用户真的能看到三个可点的按钮，以及八个角/边没被漏画。
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WindowControls, WindowResizeHandles } from './WindowChrome.jsx';

vi.mock('../lib/runtime.js', () => ({ invoke: vi.fn(() => Promise.resolve()) }));

describe('WindowControls', () => {
  it('三个窗控按钮都带中文标签，关闭键有独立样式钩子', () => {
    const html = renderToStaticMarkup(<WindowControls />);
    expect(html).toContain('aria-label="最小化"');
    expect(html).toContain('aria-label="最大化"');
    expect(html).toContain('aria-label="关闭"');
    expect(html).toContain('win-caption-btn is-close');
  });

  it('最大化按钮初始文案是「最大化」，还原图标只在最大化后出现', () => {
    const html = renderToStaticMarkup(<WindowControls />);
    expect(html).toContain('title="最大化"');
    expect(html).not.toContain('title="还原"');
  });
});

describe('WindowResizeHandles', () => {
  it('画满 8 个命中区（4 边 + 4 角）', () => {
    const html = renderToStaticMarkup(<WindowResizeHandles />);
    expect((html.match(/class="resize-handle resize-/g) || []).length).toBe(8);
  });

  it('命中区对读屏隐藏：它们只是鼠标/触屏的窗口边框', () => {
    const html = renderToStaticMarkup(<WindowResizeHandles />);
    expect((html.match(/aria-hidden="true"/g) || []).length).toBe(8);
  });
});
