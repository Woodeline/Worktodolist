// QuickAdd chips 折叠的纯函数单测。
//
// 组件本身驱动不了（SSR 没有输入事件），所以折叠逻辑放在 quickChips 里，
// 这里直接驱动它。守的是一条静默失败：chips 超过容器宽度时旧行为是
// overflow:hidden 裁掉 —— 界面不报错，只是用户看不到解析结果。
import { describe, expect, it } from 'vitest';
import { MAX_QUICK_CHIPS, quickChips } from './QuickAdd.jsx';
import { parseQuickInput } from '../lib/todoParser.js';

describe('quickChips（快速添加的 chips 预览）', () => {
  it('没有输入时返回空三件套', () => {
    expect(quickChips(null)).toEqual({ all: [], shown: [], extra: 0 });
  });

  it('不超过上限时全部露出、没有折叠计数', () => {
    const { shown, extra } = quickChips(parseQuickInput('交周报 @工作 due:2026-10-25'));
    expect(shown.map((c) => c.label)).toEqual(['@工作', '截止 2026-10-25']);
    expect(extra).toBe(0);
  });

  it('超过上限时只露前 N 个，其余折叠成 +N', () => {
    const parsed = parseQuickInput('(A) 交周报 @工作 @生活 +回测 +量化 due:2026-10-25 star:1');
    const { all, shown, extra } = quickChips(parsed);
    expect(all.length).toBeGreaterThan(MAX_QUICK_CHIPS);
    expect(shown).toHaveLength(MAX_QUICK_CHIPS);
    expect(extra).toBe(all.length - MAX_QUICK_CHIPS);
    // 露出的永远是前 N 个（优先级在最前），不是随机的 N 个
    expect(shown[0].label).toBe('(A)');
  });

  it('星标与未识别标签都占一个 chip 位', () => {
    const { all } = quickChips(parseQuickInput('写周报 star:1 foo:bar'));
    expect(all.map((c) => c.label)).toContain('★');
    expect(all.map((c) => c.label)).toContain('foo:bar');
  });
});
