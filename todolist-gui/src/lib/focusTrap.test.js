// 焦点陷阱的纯函数单测。
//
// 为什么不放在组件测试里：组件测试走 renderToStaticMarkup（服务端渲染），
// useEffect / focus 这些浏览器行为一次都不会执行，只能静态守结构。
// 真正的陷阱逻辑因此被抽成 lib/focusTrap.js 里的纯函数，在这里直接驱动。
import { describe, expect, it } from 'vitest';
import { isRowRestorable, nextInTrap, pickRestoreTarget } from './focusTrap.js';

describe('nextInTrap（Tab 在浮窗内的落点）', () => {
  const list = ['a', 'b', 'c'];

  it('正向到头循环到第一个', () => {
    expect(nextInTrap(list, 'c', false)).toBe('a');
  });

  it('反向到头循环到最后一个', () => {
    expect(nextInTrap(list, 'a', true)).toBe('c');
  });

  it('名单中间正常前进 / 后退', () => {
    expect(nextInTrap(list, 'a', false)).toBe('b');
    expect(nextInTrap(list, 'c', true)).toBe('b');
  });

  it('焦点不在名单里（初始态）时，正向给第一个、反向给最后一个', () => {
    expect(nextInTrap(list, 'x', false)).toBe('a');
    expect(nextInTrap(list, 'x', true)).toBe('c');
  });

  it('空名单 / null 返回 null（没有可聚焦项时不拦按键）', () => {
    expect(nextInTrap([], 'a', false)).toBeNull();
    expect(nextInTrap(null, 'a', false)).toBeNull();
    expect(nextInTrap(undefined, undefined, true)).toBeNull();
  });
});

// 假行：只带 pickRestoreTarget 会碰的三个成员（isConnected / classList / 高度）。
// 用假对象而不是真 DOM —— 这个项目跑在 node 环境，没有 document。
const fakeRow = (over = {}) => ({
  isConnected: over.connected !== false,
  classList: { contains: (c) => (over.fading ? c === 'fading' : false) },
  getBoundingClientRect: () => ({ height: over.zero ? 0 : 42 }),
});

describe('isRowRestorable（一行能不能当焦点去处）', () => {
  it('正常在列表里的行可以', () => {
    expect(isRowRestorable(fakeRow())).toBe(true);
  });

  it('正在退场（fading）的不行 —— 它马上就会从 DOM 消失', () => {
    expect(isRowRestorable(fakeRow({ fading: true }))).toBe(false);
  });

  it('已经不在文档里的不行', () => {
    expect(isRowRestorable(fakeRow({ connected: false }))).toBe(false);
    expect(isRowRestorable(null)).toBe(false);
  });

  it('高度被折叠到 0 的不行（视觉上已经没了）', () => {
    expect(isRowRestorable(fakeRow({ zero: true }))).toBe(false);
  });
});

describe('pickRestoreTarget（关闭浮窗后的焦点去处）', () => {
  it('来源行还活着就还给它', () => {
    const origin = fakeRow();
    expect(pickRestoreTarget(origin, [origin], null)).toBe(origin);
  });

  it('来源行正在退场时顺延到后面的活行', () => {
    const origin = fakeRow({ fading: true });
    const next = fakeRow();
    expect(pickRestoreTarget(origin, [origin, next], null)).toBe(next);
  });

  it('后面没有活行时顺延到前面的活行', () => {
    const prev = fakeRow();
    const origin = fakeRow({ fading: true });
    expect(pickRestoreTarget(origin, [prev, origin], null)).toBe(prev);
  });

  it('来源行整个不在文档里时，给第一个活行', () => {
    const dead = fakeRow({ connected: false });
    const first = fakeRow();
    expect(pickRestoreTarget(dead, [dead, first], null)).toBe(first);
  });

  it('整列表都接不住时退回快速添加框', () => {
    const quickAdd = { focus() {} };
    const dead = fakeRow({ connected: false });
    expect(pickRestoreTarget(dead, [dead], quickAdd)).toBe(quickAdd);
  });

  it('连快速添加框都没有时返回 null（调用方据此不硬聚焦）', () => {
    expect(pickRestoreTarget(null, [], null)).toBeNull();
    expect(pickRestoreTarget(fakeRow({ fading: true }), [], null)).toBeNull();
  });
});
