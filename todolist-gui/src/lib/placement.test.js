// 浮层「先量后放」的边界条件。
//
// 这两类 bug 纯靠肉眼看截图才会发现，而截图只能拍一个窗口尺寸；
// 把落点算成纯函数，就能把贴右缘、贴下缘、窗口极窄这些情况钉成断言。
import { describe, expect, it } from 'vitest';
import {
  computeDayPopoverPlacement,
  computeMenuPlacement,
  computeSubmenuPlacement,
  computeTagMenuPlacement,
  DAY_POPOVER_H,
  DAY_POPOVER_W,
  TAG_MENU_MAX_HEIGHT,
  VIEWPORT_MARGIN,
} from './placement.js';

const rect = (left, top, width, height) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe('右键菜单的子菜单落点', () => {
  it('右侧放得下：不翻、不位移，维持原来的 -5px 对齐', () => {
    const row = rect(300, 200, 184, 26);
    const menu = rect(486, 195, 184, 120);
    expect(computeSubmenuPlacement(row, menu, { width: 1000, height: 700 })).toEqual({
      flip: false,
      shiftX: 0,
      top: -5,
    });
  });

  it('贴窗口右缘：翻到父行左侧，右半截不再被裁', () => {
    const row = rect(500, 200, 184, 26);
    const menu = rect(686, 195, 184, 120); // right = 870 > 700 - 6
    const p = computeSubmenuPlacement(row, menu, { width: 700, height: 700 });
    expect(p.flip).toBe(true);
    expect(p.shiftX).toBe(0);
    expect(row.left - 2 - menu.width).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it('窗口窄到左右都不够：翻转后再夹回视口左缘', () => {
    const row = rect(100, 200, 150, 26);
    const menu = rect(252, 195, 184, 120);
    const p = computeSubmenuPlacement(row, menu, { width: 360, height: 700 });
    expect(p.flip).toBe(true);
    expect(p.shiftX).toBeGreaterThan(0);
    expect(row.left - 2 - menu.width + p.shiftX).toBe(VIEWPORT_MARGIN);
  });

  it('贴窗口下缘：整体上移，底边落在安全边距内', () => {
    const row = rect(300, 250, 184, 26);
    const menu = rect(486, 245, 184, 120);
    const viewport = { width: 1000, height: 300 };
    const p = computeSubmenuPlacement(row, menu, viewport);
    expect(p.top).toBeLessThan(-5);
    expect(row.top + p.top + menu.height).toBeLessThanOrEqual(viewport.height - VIEWPORT_MARGIN);
  });

  it('窗口极矮：上移也不能把菜单顶出上缘', () => {
    const row = rect(300, 50, 184, 26);
    const menu = rect(486, 45, 184, 120);
    const p = computeSubmenuPlacement(row, menu, { width: 1000, height: 100 });
    expect(row.top + p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });
});

describe('编辑浮窗候选清单落点', () => {
  it('下方空间够：向下展开，高度不缩', () => {
    const anchor = rect(100, 480, 400, 70);
    const p = computeTagMenuPlacement(anchor, { width: 1200, height: 900 });
    expect(p.dropUp).toBe(false);
    expect(p.top).toBe(anchor.bottom + 4);
    expect(p.maxHeight).toBe(TAG_MENU_MAX_HEIGHT);
  });

  it('下方不够、上方够：向上翻，顶边完整（首行不被裁）', () => {
    const anchor = rect(100, 500, 400, 50);
    const p = computeTagMenuPlacement(anchor, { width: 1200, height: 700 });
    expect(p.dropUp).toBe(true);
    expect(p.top).toBe(280);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(700 - 8);
  });

  it('上下都紧：高度收缩到可用空间，仍可滚动读完', () => {
    const anchor = rect(100, 140, 400, 50);
    const p = computeTagMenuPlacement(anchor, { width: 1200, height: 300 });
    expect(p.maxHeight).toBe(128);
    expect(p.top).toBe(8);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(300 - 8);
  });

  it('触发框贴右缘：左缘夹回视口，菜单右缘不出界', () => {
    const anchor = rect(420, 480, 300, 50);
    const p = computeTagMenuPlacement(anchor, { width: 500, height: 900 });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + p.width).toBeLessThanOrEqual(500 - 8);
  });
});

// 2026-11-15：窗口底部的「标签」按钮往上弹菜单。往下弹在窄屏上等于灾难 ——
// 菜单被窗口下缘裁掉一半，夹回来又会盖住按钮自己。
describe('通用菜单落点（含往上弹）', () => {
  const menu = { width: 220, height: 160 };

  it('默认向下：左上角对齐锚点', () => {
    expect(computeMenuPlacement(120, 200, menu, { width: 1000, height: 800 })).toEqual({
      left: 120,
      top: 200,
    });
  });

  it("place='above'：菜单底边贴住锚点上缘", () => {
    const p = computeMenuPlacement(120, 800, menu, { width: 400, height: 844 }, 'above');
    expect(p.top).toBe(640); // 800 - 160
    expect(p.top + menu.height).toBe(800); // 底边正好压在按钮上缘
  });

  it('向下弹贴到窗口下缘：夹回视口内，不裁内容', () => {
    const p = computeMenuPlacement(120, 760, menu, { width: 400, height: 844 });
    expect(p.top + menu.height).toBeLessThanOrEqual(844 - VIEWPORT_MARGIN);
  });

  it('贴右缘：左缘夹回来，右缘不出界', () => {
    const p = computeMenuPlacement(300, 200, menu, { width: 400, height: 844 });
    expect(p.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(p.left + menu.width).toBeLessThanOrEqual(400 - VIEWPORT_MARGIN);
  });

  it('菜单比视口还高：夹到上边距，允许它压住锚点', () => {
    const tall = { width: 220, height: 900 };
    expect(computeMenuPlacement(120, 800, tall, { width: 400, height: 844 }, 'above').top).toBe(
      VIEWPORT_MARGIN
    );
  });
});

// 2026-11-15：日历改成「点一天 → 弹当天任务」。弹层锚在格子上，
// 而格子宽只有 ~90px、最右一列贴着窗口右缘 —— 三个边界都得钉住。
describe('日历当天任务弹层落点', () => {
  const viewport = { width: 1280, height: 800 };

  it('网格中部：贴着格子下缘展开，宽度不跟格子走', () => {
    const p = computeDayPopoverPlacement(rect(400, 300, 90, 60), viewport);
    expect(p.dropUp).toBe(false);
    expect(p.top).toBe(364);
    expect(p.left).toBe(400);
    expect(p.width).toBe(DAY_POPOVER_W);
    expect(p.maxHeight).toBe(DAY_POPOVER_H);
  });

  it('最后一行：下方不够就翻到格子上方，底边贴着格子上缘', () => {
    const anchor = rect(400, 720, 90, 60);
    const p = computeDayPopoverPlacement(anchor, viewport);
    expect(p.dropUp).toBe(true);
    expect(p.top + p.maxHeight).toBe(716);
    expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it('最右一列：左缘夹回视口，右缘不出界', () => {
    const p = computeDayPopoverPlacement(rect(1180, 300, 90, 60), viewport);
    expect(p.left + p.width).toBeLessThanOrEqual(viewport.width - VIEWPORT_MARGIN);
  });

  it('窄屏：宽度收到视口内，不会横向溢出', () => {
    const p = computeDayPopoverPlacement(rect(300, 300, 52, 60), { width: 360, height: 780 });
    expect(p.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(p.left + p.width).toBeLessThanOrEqual(360 - VIEWPORT_MARGIN);
  });

  it('矮窗：高度按可用空间收缩，底边仍在视口内', () => {
    const p = computeDayPopoverPlacement(rect(400, 120, 90, 60), { width: 1000, height: 260 });
    expect(p.maxHeight).toBeLessThan(DAY_POPOVER_H);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(260 - VIEWPORT_MARGIN);
  });
});
