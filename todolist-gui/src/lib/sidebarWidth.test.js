// 侧栏宽度契约：默认 176、156–240 夹取、落盘 / 清除。
import { afterEach, describe, expect, it } from 'vitest';
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
  clearSidebarWidth,
  hasCustomSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
} from './sidebarWidth.js';

function mockStorage(initial = {}) {
  const mem = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };
  return mem;
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe('侧栏宽度：夹取与默认', () => {
  it('默认 176，没落盘时不算自定义', () => {
    mockStorage();
    expect(loadSidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(hasCustomSidebarWidth()).toBe(false);
  });

  it('156–240 夹取，非数字回默认', () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(240)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth(196.6)).toBe(197);
    expect(clampSidebarWidth('')).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth('abc')).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(null)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});

describe('侧栏宽度：落盘与清除', () => {
  it('保存后读回、hasStored 为真', () => {
    const mem = mockStorage();
    expect(saveSidebarWidth(212)).toBe(true);
    expect(loadSidebarWidth()).toBe(212);
    expect(hasCustomSidebarWidth()).toBe(true);
    expect(JSON.parse(mem.get('worktodolist.sidebar-width'))).toEqual({ width: 212 });
  });

  it('脏落盘值读回归一，不卡死在坏宽度', () => {
    mockStorage({ 'worktodolist.sidebar-width': JSON.stringify({ width: 9999 }) });
    expect(loadSidebarWidth()).toBe(SIDEBAR_WIDTH_MAX);
    mockStorage({ 'worktodolist.sidebar-width': '{oops' });
    expect(loadSidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it('清除后回到默认，回到 CSS 的 176 / 156 口径', () => {
    mockStorage();
    saveSidebarWidth(220);
    expect(clearSidebarWidth()).toBe(true);
    expect(loadSidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(hasCustomSidebarWidth()).toBe(false);
  });
});
