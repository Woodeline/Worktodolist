import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME,
  describeDueRel,
  formatDateShort,
  formatDateValue,
  formatISODate,
  isDueOverdue,
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

describe('describeDueRel', () => {
  const base = new Date(2026, 10, 18, 15, 30);
  it('近三天与昨天用人话，更远报天数', () => {
    expect(describeDueRel('2026-11-18', base)).toBe('今天');
    expect(describeDueRel('2026-11-19', base)).toBe('明天');
    expect(describeDueRel('2026-11-20', base)).toBe('后天');
    expect(describeDueRel('2026-11-17', base)).toBe('昨天');
    expect(describeDueRel('2026-11-25', base)).toBe('7 天后');
    expect(describeDueRel('2026-11-10', base)).toBe('逾期 8 天');
  });

  it('base 的时刻不影响日差；无日期与脏值返回空串', () => {
    expect(describeDueRel('2026-11-19', new Date(2026, 10, 18, 23, 59))).toBe('明天');
    expect(describeDueRel('', base)).toBe('');
    expect(describeDueRel('2026-02-30', base)).toBe('');
    expect(describeDueRel('not-a-date', base)).toBe('');
  });

  it('跨月按真实日差算，不按 30 天估', () => {
    expect(describeDueRel('2026-12-01', base)).toBe('13 天后');
  });
});

describe('isDueOverdue', () => {
  const base = new Date(2026, 10, 18, 9, 0);
  it('严格早于今天才算逾期，今天与将来都不算', () => {
    expect(isDueOverdue('2026-11-17', base)).toBe(true);
    expect(isDueOverdue('2026-11-18', base)).toBe(false);
    expect(isDueOverdue('2026-11-19', base)).toBe(false);
  });

  it('无日期 / 脏值不算逾期', () => {
    expect(isDueOverdue('', base)).toBe(false);
    expect(isDueOverdue('2026-13-01', base)).toBe(false);
  });
});
