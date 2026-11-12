// 区间语义的纯函数层：五态、校验、跨天/跨月/重叠/无效边界都在这里钉死。
// 日期一律相对真实今天生成，不写死年月日。
import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import {
  RANGE_MAX_DAYS,
  rangeOf,
  rangeReadout,
  rangeOverlay,
  setRangeStart,
  spanDates,
} from './taskRange.js';
import { monthGrid, monthKey, shiftDate } from './calendar.js';

const TODAY = dayjs().format('YYYY-MM-DD');
const task = (id, extra = {}) => ({ id, title: id, ...extra });

describe('rangeOf 五种状态', () => {
  it('两个日期都没有 → none', () => {
    expect(rangeOf(task('a')).kind).toBe('none');
  });

  it('只有截止日 → point，不产生区间（避免普通任务刷屏）', () => {
    const r = rangeOf(task('a', { dueDate: TODAY }));
    expect(r).toMatchObject({ kind: 'point', days: 1, start: null });
  });

  it('只有起点 → open', () => {
    expect(rangeOf(task('a', { thresholdDate: TODAY })).kind).toBe('open');
  });

  it('起止齐全 → range，天数含两端', () => {
    const r = rangeOf(task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 2) }));
    expect(r).toMatchObject({ kind: 'range', days: 3 });
  });

  it('起点晚于截止 → invalid 并给出原因', () => {
    const r = rangeOf(task('a', { thresholdDate: shiftDate(TODAY, 2), dueDate: TODAY }));
    expect(r.kind).toBe('invalid');
    expect(r.reason).toBe('开始晚于截止');
  });

  it('非法日期字符串被忽略（解析器对 t:/due: 不校验）', () => {
    expect(rangeOf(task('a', { thresholdDate: '2026-13-45', dueDate: TODAY })).kind).toBe('point');
    expect(rangeOf(task('a', { thresholdDate: TODAY, dueDate: 'not-a-date' })).kind).toBe('open');
  });
});

describe('rangeReadout 读数', () => {
  it('区间给「起 → 止 · N 天」', () => {
    const r = rangeOf(task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 2) }));
    expect(rangeReadout(r)).toBe(`${TODAY.slice(5)} → ${shiftDate(TODAY, 2).slice(5)} · 3 天`);
  });

  it('开放起点 / 无效区间各有明确文案，none 与 point 不刷屏', () => {
    expect(rangeReadout(rangeOf(task('a')))).toBe('');
    expect(rangeReadout(rangeOf(task('a', { dueDate: TODAY })))).toBe('');
    expect(rangeReadout(rangeOf(task('a', { thresholdDate: TODAY })))).toContain('无截止');
    expect(rangeReadout(rangeOf(task('a', {
      thresholdDate: shiftDate(TODAY, 2),
      dueDate: TODAY,
    })))).toContain('区间无效');
  });
});

describe('spanDates 展开边界', () => {
  it('跨月不跳日，含两端', () => {
    expect(spanDates('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ]);
  });

  it('起止同日只一天', () => {
    expect(spanDates(TODAY, TODAY)).toEqual([TODAY]);
  });

  it('超长区间不展开（只给读数，不撑爆 42 格）', () => {
    const far = dayjs(TODAY).add(RANGE_MAX_DAYS, 'day').format('YYYY-MM-DD');
    expect(spanDates(TODAY, far)).toEqual([]);
  });

  it('无效区间不展开', () => {
    expect(spanDates(shiftDate(TODAY, 2), TODAY)).toEqual([]);
  });
});

describe('rangeOverlay 覆盖与裁切', () => {
  it('跨 3 天：起 / 中 / 止三段', () => {
    const d1 = shiftDate(TODAY, 1);
    const d2 = shiftDate(TODAY, 2);
    const map = rangeOverlay([task('a', { thresholdDate: TODAY, dueDate: d2 })], [TODAY, d1, d2]);
    expect(map.get(TODAY)).toEqual([{ id: 'a', role: 'start' }]);
    expect(map.get(d1)).toEqual([{ id: 'a', role: 'mid' }]);
    expect(map.get(d2)).toEqual([{ id: 'a', role: 'end' }]);
  });

  it('起点不在网格内：首段是 mid，不伪造起点', () => {
    const d1 = shiftDate(TODAY, 1);
    const map = rangeOverlay([task('a', { thresholdDate: shiftDate(TODAY, -2), dueDate: d1 })], [TODAY, d1]);
    expect(map.get(TODAY)).toEqual([{ id: 'a', role: 'mid' }]);
    expect(map.get(d1)).toEqual([{ id: 'a', role: 'end' }]);
  });

  it('同日多个区间并行保留：待办没有资源互斥，重叠不是错误', () => {
    const map = rangeOverlay([
      task('a', { thresholdDate: TODAY, dueDate: TODAY }),
      task('b', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 1) }),
    ], [TODAY]);
    expect(map.get(TODAY)).toEqual([
      { id: 'a', role: 'single' },
      { id: 'b', role: 'start' },
    ]);
  });

  it('point / open 之外，none 与 invalid 都不展开', () => {
    const map = rangeOverlay([
      task('a', { dueDate: TODAY }),
      task('b'),
      task('c', { thresholdDate: shiftDate(TODAY, 2), dueDate: TODAY }),
    ], [TODAY]);
    expect(map.size).toBe(0);
  });

  it('月网格 42 格裁切：只落在可见日期上', () => {
    const dates = monthGrid(monthKey(TODAY)).map((c) => c.date);
    const map = rangeOverlay([task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 3) })], dates);
    for (const d of map.keys()) expect(dates).toContain(d);
  });
});

describe('setRangeStart 写盘补丁', () => {
  it('无变化不写盘', () => {
    expect(setRangeStart(task('a', { thresholdDate: TODAY }), TODAY)).toBeNull();
    expect(setRangeStart(task('a'), null)).toBeNull();
  });

  it('设置 / 清除起点各给一个补丁', () => {
    expect(setRangeStart(task('a'), TODAY)).toEqual({ thresholdDate: TODAY });
    expect(setRangeStart(task('a', { thresholdDate: TODAY }), null)).toEqual({ thresholdDate: null });
  });

  it('非法目标不写盘', () => {
    expect(setRangeStart(task('a'), '2026-13-45')).toBeNull();
  });
});
