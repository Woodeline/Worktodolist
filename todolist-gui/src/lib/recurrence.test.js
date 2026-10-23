import { describe, expect, it } from 'vitest';
import {
  RECURRENCE_CHOICES,
  describeRecurrence,
  formatRecurrence,
  nextDueDate,
  nextOccurrence,
  parseRecurrence,
} from './recurrence';

// 这一组锁的是「时间怎么往前走」。重复规则失效的方式全是静默的：
// 少推进一天、多推进一天、或者干脆不生成 —— 都不会报错，只是某天用户发现
// 「我明明设了每周，怎么两周才来一次」。所以每个边界都单独钉住。

describe('parseRecurrence', () => {
  it('偏移型：天 / 周 / 月', () => {
    expect(parseRecurrence('+1d')).toEqual({ kind: 'days', interval: 1 });
    expect(parseRecurrence('+3d')).toEqual({ kind: 'days', interval: 3 });
    expect(parseRecurrence('+2w')).toEqual({ kind: 'weeks', interval: 2 });
    expect(parseRecurrence('+1m')).toEqual({ kind: 'months', interval: 1 });
  });

  it('星期型：去重、排序、大小写无关', () => {
    expect(parseRecurrence('mon')).toEqual({ kind: 'weekdays', interval: 1, weekdays: [0] });
    // 顺序与写法无关：thu,mon 与 mon,thu 是同一条规则
    expect(parseRecurrence('thu,mon')).toEqual(parseRecurrence('mon,thu'));
    expect(parseRecurrence('MON')).toEqual(parseRecurrence('mon'));
    expect(parseRecurrence('mon,mon')).toEqual({ kind: 'weekdays', interval: 1, weekdays: [0] });
  });

  it('认不出的值一律 null（调用方决定是丢弃还是留作普通标签）', () => {
    expect(parseRecurrence('')).toBe(null);
    expect(parseRecurrence('每周')).toBe(null);
    expect(parseRecurrence('daily')).toBe(null);
    expect(parseRecurrence('+0d')).toBe(null); // 0 天会死循环
    expect(parseRecurrence('d')).toBe(null);
    expect(parseRecurrence('mon,周x')).toBe(null);
    expect(parseRecurrence(null)).toBe(null);
  });

  it('格式互逆：parse → format → parse 结果一致（写回文本不跑形）', () => {
    for (const v of ['+1d', '+12w', '+3m', 'mon', 'mon,wed,fri']) {
      const rule = parseRecurrence(v);
      expect(formatRecurrence(rule)).toBe(v);
      expect(parseRecurrence(formatRecurrence(rule))).toEqual(rule);
    }
  });
});

describe('nextDueDate', () => {
  it('按天推进，且必须严格晚于今天', () => {
    expect(nextDueDate('+1d', '2026-10-22', '2026-10-22')).toBe('2026-10-23');
    expect(nextDueDate('+3d', '2026-10-22', '2026-10-22')).toBe('2026-10-25');
  });

  it('逾期完成：从 due 推进，不是从今天推进', () => {
    // 这是最容易写错的一处：due=10-20，拖到 10-25 才完成。
    // 若从今天推，下次是 10-27（间隔 2 天），规则会被"逾期"悄悄缩短。
    expect(nextDueDate('+1w', '2026-10-20', '2026-10-25')).toBe('2026-10-27');
  });

  it('逾期很久：一次跨过多个周期，落点仍在原节奏上', () => {
    // 荒废了三周的每周任务：下次应该是 due 起的第 4 周（10-27、11-03、11-10、11-17）
    expect(nextDueDate('+1w', '2026-10-20', '2026-11-11')).toBe('2026-11-17');
  });

  it('提前完成：下一次是下一周期，不会当天再来一条', () => {
    expect(nextDueDate('+1w', '2026-10-26', '2026-10-22')).toBe('2026-11-02');
    expect(nextDueDate('+1d', '2026-10-26', '2026-10-22')).toBe('2026-10-27');
  });

  it('每月：号数固定，短月压到月末且不漂移', () => {
    // 1/31 → 2/28 → 3/31。若在上一步结果上累加，2/28 之后会永远停在 28 号。
    expect(nextDueDate('+1m', '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    // 2/28 已过（不严格晚于今天），于是跨到下一个月：必须是 3/31 而不是 3/28
    expect(nextDueDate('+1m', '2026-01-31', '2026-02-28')).toBe('2026-03-31');
    expect(nextDueDate('+3m', '2026-01-15', '2026-01-15')).toBe('2026-04-15');
  });

  it('每周几：落在下一个匹配的星期，且严格晚于今天', () => {
    // 2026-10-22 是周四；规则每周四 → 下周四 10-29
    expect(nextDueDate('thu', '2026-10-22', '2026-10-22')).toBe('2026-10-29');
    // 规则周一、周四 → 10-26（周一）
    expect(nextDueDate('mon,thu', '2026-10-22', '2026-10-22')).toBe('2026-10-26');
  });

  it('锚点不合法时返回 null（不猜、不崩）', () => {
    expect(nextDueDate('+1d', '', '2026-10-22')).toBe(null);
    expect(nextDueDate('+1d', '2026-10-22', '')).toBe(null);
    expect(nextDueDate('乱写', '2026-10-22', '2026-10-22')).toBe(null);
  });
});

describe('nextOccurrence', () => {
  const base = {
    title: '交周报',
    priority: 'B',
    contexts: ['工作'],
    projects: ['投资'],
    dueDate: '2026-10-22',
    thresholdDate: '2026-10-20',
    remindAt: '2026-10-22T09:00',
    recurrence: '+1w',
    completed: false,
    completedAt: null,
    createdAt: '2026-09-01',
  };

  it('推进 due，并把 t: 与 rem: 按同样的天数平移', () => {
    const patch = nextOccurrence(base, '2026-10-22');
    expect(patch.dueDate).toBe('2026-10-29');
    expect(patch.thresholdDate).toBe('2026-10-27'); // 相对 due 提前 2 天的节奏保住了
    expect(patch.remindAt).toBe('2026-10-29T09:00'); // 时刻不变，日期跟着走
  });

  it('新实例是未完成的新任务，创建日期为今天', () => {
    const patch = nextOccurrence(base, '2026-10-22');
    expect(patch.completed).toBe(false);
    expect(patch.completedAt).toBe(null);
    expect(patch.createdAt).toBe('2026-10-22');
  });

  it('不继承 stableId（下一次是另一条任务，继承会造成重复 ID）', () => {
    const patch = nextOccurrence({ ...base, stableId: 'aaa111' }, '2026-10-22');
    expect(patch.stableId).toBeUndefined();
  });

  it('没有 due 时以今天为锚点', () => {
    const patch = nextOccurrence({ ...base, dueDate: null }, '2026-10-22');
    expect(patch.dueDate).toBe('2026-10-29');
  });

  it('没有规则 / 规则非法 → null（不生成下一条）', () => {
    expect(nextOccurrence({ ...base, recurrence: null }, '2026-10-22')).toBe(null);
    expect(nextOccurrence({ ...base, recurrence: '乱写' }, '2026-10-22')).toBe(null);
  });

  it('rem 的偏移跨月也正确', () => {
    const patch = nextOccurrence(
      { ...base, dueDate: '2026-10-30', remindAt: '2026-10-28T08:30', recurrence: '+1m' },
      '2026-10-30'
    );
    expect(patch.dueDate).toBe('2026-11-30');
    expect(patch.remindAt).toBe('2026-11-28T08:30');
  });
});

describe('describeRecurrence', () => {
  it('说得是人话', () => {
    expect(describeRecurrence('+1d')).toBe('每天');
    expect(describeRecurrence('+3d')).toBe('每 3 天');
    expect(describeRecurrence('+1w')).toBe('每周');
    expect(describeRecurrence('+2w')).toBe('每 2 周');
    expect(describeRecurrence('+1m')).toBe('每月');
    expect(describeRecurrence('+3m')).toBe('每 3 个月');
    expect(describeRecurrence('mon')).toBe('每周一');
    expect(describeRecurrence('mon,wed')).toBe('每周一、三');
    expect(describeRecurrence('mon,tue,wed,thu,fri')).toBe('每个工作日');
  });
});

describe('RECURRENCE_CHOICES', () => {
  it('每个预设值都解析得出、且能说清楚（下拉里不会出现空标签）', () => {
    for (const c of RECURRENCE_CHOICES) {
      if (!c.value) continue;
      expect(parseRecurrence(c.value)).not.toBe(null);
      expect(describeRecurrence(c.value)).not.toBe('');
    }
  });
});
