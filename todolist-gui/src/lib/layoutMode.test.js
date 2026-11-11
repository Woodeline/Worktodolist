// 窄边降级的决策层单测。
//
// 这一层的失效全是「不报错的错」：偏好被改写、宽边不还原、临界点反复翻转、
// 用户在窄边点了日历却没反应 —— 界面照常渲染，只是行为悄悄不对。
// 项目没有 jsdom / testing-library，所以把交互语义抽成纯函数在这里钉死。
import { describe, expect, it } from 'vitest';
import {
  NARROW_ENTER_PX,
  NARROW_EXIT_PX,
  hysteresisNarrow,
  noticeState,
  resolveEffectiveMode,
} from './layoutMode.js';

describe('阈值与迟滞', () => {
  it('进入阈值低于退出阈值，中间是滞回带', () => {
    expect(NARROW_ENTER_PX).toBe(480);
    expect(NARROW_EXIT_PX).toBe(560);
    expect(NARROW_ENTER_PX).toBeLessThan(NARROW_EXIT_PX);
  });

  it('宽边不进窄态', () => {
    expect(hysteresisNarrow(false, 1058)).toBe(false);
    expect(hysteresisNarrow(false, NARROW_EXIT_PX + 1)).toBe(false);
  });

  it('低于进入阈值进入窄态', () => {
    expect(hysteresisNarrow(false, 390)).toBe(true);
    expect(hysteresisNarrow(false, NARROW_ENTER_PX - 1)).toBe(true);
  });

  it('滞回带内保持上一次判定 —— 拖窗口不会反复翻转', () => {
    const band = (NARROW_ENTER_PX + NARROW_EXIT_PX) / 2;
    expect(hysteresisNarrow(true, band)).toBe(true);
    expect(hysteresisNarrow(false, band)).toBe(false);
    expect(hysteresisNarrow(true, NARROW_ENTER_PX)).toBe(true);
    expect(hysteresisNarrow(true, NARROW_EXIT_PX)).toBe(true);
  });

  it('只有高于退出阈值才回宽态', () => {
    expect(hysteresisNarrow(true, NARROW_EXIT_PX)).toBe(true);
    expect(hysteresisNarrow(true, NARROW_EXIT_PX + 1)).toBe(false);
  });

  it('主区未挂载 / 宽度未知时保持上一次，不把窄边误重置', () => {
    expect(hysteresisNarrow(true, null)).toBe(true);
    expect(hysteresisNarrow(true, undefined)).toBe(true);
    expect(hysteresisNarrow(false, Number.NaN)).toBe(false);
  });
});

describe('有效布局的三层优先级', () => {
  it('宽边直接用偏好 —— 还原不需要任何记忆状态', () => {
    expect(resolveEffectiveMode({ preferred: 'calendar', narrow: false })).toBe('calendar');
    expect(resolveEffectiveMode({ preferred: 'list', narrow: false })).toBe('list');
  });

  it('窄边且偏好日历时临时用列表，偏好列表时不变', () => {
    expect(resolveEffectiveMode({ preferred: 'calendar', narrow: true })).toBe('list');
    expect(resolveEffectiveMode({ preferred: 'list', narrow: true })).toBe('list');
  });

  it('用户显式覆盖优先级最高', () => {
    expect(resolveEffectiveMode({ preferred: 'calendar', narrow: true, override: 'calendar' }))
      .toBe('calendar');
    expect(resolveEffectiveMode({ preferred: 'calendar', narrow: false, override: 'list' }))
      .toBe('list');
  });

  it('脏覆盖值不生效，回落到降级规则', () => {
    expect(resolveEffectiveMode({ preferred: 'calendar', narrow: true, override: 'bogus' }))
      .toBe('list');
    expect(resolveEffectiveMode({ preferred: 123, narrow: false })).toBe('list');
  });

  it('恢复宽边：清掉覆盖后自然回到用户原本选的日历', () => {
    const preferred = 'calendar';
    const narrowNow = resolveEffectiveMode({ preferred, narrow: true });
    expect(narrowNow).toBe('list');
    // 模拟「宽边清 override」后的计算 —— 偏好从未被写过，无需 storedMode 之类的记忆
    expect(resolveEffectiveMode({ preferred, narrow: false, override: null })).toBe('calendar');
  });
});

describe('提示条状态', () => {
  it('宽边、或偏好本来就是列表时不显示', () => {
    expect(noticeState({ preferred: 'calendar', narrow: false, effective: 'calendar' })).toBeNull();
    expect(noticeState({ preferred: 'list', narrow: true, effective: 'list' })).toBeNull();
  });

  it('自动降级时给「仍用日历」', () => {
    expect(noticeState({ preferred: 'calendar', narrow: true, effective: 'list' }))
      .toBe('auto-list');
  });

  it('用户显式覆盖时给「恢复自动」', () => {
    expect(noticeState({ preferred: 'calendar', narrow: true, override: 'calendar', effective: 'calendar' }))
      .toBe('manual-calendar');
  });
});
