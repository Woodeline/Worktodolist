// 空格完成已撤（2026-11-17）：全局键、App 接线与右键菜单角标三处都不能留旧口径。
// 项目没有 jsdom，useHotkeys 的 window 监听无法在单测里触发，所以这里守源码边界；
// 运行时可见的两处提示由 TaskRow / SettingsPage 的渲染测试覆盖。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

describe('useHotkeys：空格完成快捷键已撤', () => {
  it('全局键不再把空格映射成完成，也不接收 onToggle', () => {
    const src = read('useHotkeys.js');
    expect(src).not.toContain("e.key === ' '");
    expect(src).not.toContain('onToggle');
  });

  it('App 不再向 useHotkeys 传完成回调', () => {
    const app = read('../App.jsx');
    expect(app).not.toContain('onToggle:');
  });

  it('右键菜单的「标记完成」不再挂 Space 角标', () => {
    const row = read('../components/TaskRow.jsx');
    expect(row).not.toContain("accel: 'Space'");
  });

  it('其余列表快捷键仍在', () => {
    const src = read('useHotkeys.js');
    expect(src).toContain("e.key === 'Enter'");
    expect(src).toContain("e.key === 'n'");
    expect(src).toContain("e.key === '/'");
    expect(src).toContain("e.key === 'e'");
  });
});
