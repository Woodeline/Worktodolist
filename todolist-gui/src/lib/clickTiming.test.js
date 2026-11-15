import { describe, expect, it } from 'vitest';
import { classifyRowClick, DOUBLE_CLICK_MS, SLOW_DOUBLE_MS } from './clickTiming.js';

describe('列表行点击间隔分流', () => {
  it('两个阈值：常规双击 300ms 封顶，慢速双击 900ms 封顶', () => {
    expect(DOUBLE_CLICK_MS).toBe(300);
    expect(SLOW_DOUBLE_MS).toBe(900);
    expect(SLOW_DOUBLE_MS).toBeGreaterThan(DOUBLE_CLICK_MS);
  });

  it('间隔 ≤300ms = 常规双击 → 打开编辑浮窗', () => {
    expect(classifyRowClick({ elapsedMs: 0, sameRow: true })).toBe('double');
    expect(classifyRowClick({ elapsedMs: 120, sameRow: true })).toBe('double');
    expect(classifyRowClick({ elapsedMs: DOUBLE_CLICK_MS, sameRow: true })).toBe('double');
  });

  it('300~900ms = 慢速双击 → 在列表栏内编辑标题', () => {
    expect(classifyRowClick({ elapsedMs: 301, sameRow: true })).toBe('slow-double');
    expect(classifyRowClick({ elapsedMs: 600, sameRow: true })).toBe('slow-double');
    expect(classifyRowClick({ elapsedMs: SLOW_DOUBLE_MS, sameRow: true })).toBe('slow-double');
  });

  it('超过 900ms 是两次独立单击，只选中', () => {
    expect(classifyRowClick({ elapsedMs: 901, sameRow: true })).toBe('single');
    expect(classifyRowClick({ elapsedMs: 3000, sameRow: true })).toBe('single');
  });

  it('不同行的两次点击永远不算双击', () => {
    expect(classifyRowClick({ elapsedMs: 100, sameRow: false })).toBe('single');
    expect(classifyRowClick({ elapsedMs: 500, sameRow: false })).toBe('single');
  });

  it('脏输入（负数 / NaN / 缺失）退回单击，不误开编辑', () => {
    expect(classifyRowClick({ elapsedMs: -1, sameRow: true })).toBe('single');
    expect(classifyRowClick({ elapsedMs: NaN, sameRow: true })).toBe('single');
    expect(classifyRowClick({ sameRow: true })).toBe('single');
  });
});
