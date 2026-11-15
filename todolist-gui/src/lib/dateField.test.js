import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME,
  formatDateShort,
  formatDateValue,
  formatISODate,
  makePresets,
  parseDateValue,
} from './dateField.js';

describe('parseDateValue', () => {
  it('due 形状解析成本地日期，不带时刻', () => {
    const { date, time } = parseDateValue('2026-11-14');
    expect(formatISODate(date)).toBe('2026-11-14');
    expect(time).toBe('');
  });

  it('rem 形状拆成日期 + HH:mm', () => {
    const { date, time } = parseDateValue('2026-11-14T15:30');
    expect(formatISODate(date)).toBe('2026-11-14');
    expect(time).toBe('15:30');
  });

  it('空值、非字符串、非 ISO 都当空值', () => {
    for (const v of ['', null, undefined, 42, '明天', '25:99']) {
      expect(parseDateValue(v)).toEqual({ date: null, time: '' });
    }
  });

  it('2 月 30 日会被挡掉，不靠 Date 自动进位', () => {
    expect(parseDateValue('2026-02-30').date).toBeNull();
    expect(parseDateValue('2026-13-01').date).toBeNull();
  });

  it('带秒的 datetime 仍能读出 HH:mm', () => {
    expect(parseDateValue('2026-10-23T15:00:00').time).toBe('15:00');
  });
});

describe('formatDateValue', () => {
  it('不带时刻写 due 形状', () => {
    const d = new Date(2026, 10, 14);
    expect(formatDateValue(d, '', false)).toBe('2026-11-14');
  });

  it('带时刻写 rem 形状，缺省补 09:00', () => {
    const d = new Date(2026, 10, 14);
    expect(formatDateValue(d, '15:30', true)).toBe('2026-11-14T15:30');
    expect(formatDateValue(d, '', true)).toBe(`2026-11-14T${DEFAULT_TIME}`);
  });

  it('没有日期就写空串（清除）', () => {
    expect(formatDateValue(null, '09:00', true)).toBe('');
  });

  it('往返无损', () => {
    for (const v of ['2026-01-01', '2026-12-31', '2028-02-29', '2026-11-14T09:00']) {
      const { date, time } = parseDateValue(v);
      expect(formatDateValue(date, time, v.includes('T'))).toBe(v);
    }
  });
});

describe('formatDateShort', () => {
  it('短日期 YYYY/MM/DD，月日补零保留；带时刻时补 HH:mm', () => {
    expect(formatDateShort('2026-01-05', false)).toBe('2026/01/05');
    expect(formatDateShort('2026-10-19', false)).toBe('2026/10/19');
    expect(formatDateShort('2026-11-14T15:30', true)).toBe('2026/11/14 15:30');
  });

  it('非法值不把原文露到界面读数上', () => {
    expect(formatDateShort('25:99', false)).toBe('');
    expect(formatDateShort('', false)).toBe('');
  });

  it('形状合法但日历非法的脏值也不显示（与 parseDateValue 同口径）', () => {
    expect(formatDateShort('2026-13-45', false)).toBe('');
    expect(formatDateShort('2026-02-30', true)).toBe('');
    expect(formatDateShort('2028-02-29', false)).toBe('2028/02/29');
  });
});

describe('makePresets', () => {
  it('周五时给出今天 / 明天 / 下周一', () => {
    const presets = makePresets(new Date(2026, 10, 13));
    expect(presets.map((p) => p.label)).toEqual(['今天', '明天', '下周一']);
    expect(presets.map((p) => formatISODate(p.date))).toEqual([
      '2026-11-13', '2026-11-14', '2026-11-16',
    ]);
  });

  it('周日时明天就是周一', () => {
    const presets = makePresets(new Date(2026, 10, 15));
    expect(formatISODate(presets[2].date)).toBe('2026-11-16');
  });
});
