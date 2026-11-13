// 区间语义的纯函数层：五态、校验、跨天/跨月/重叠/无效边界都在这里钉死。
// 日期一律相对真实今天生成，不写死年月日。
import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import {
  RANGE_MAX_DAYS,
  MAX_BAR_LANES,
  rangeOf,
  rangeReadout,
  rangeOverlay,
  setRangeStart,
  setRangeEnd,
  resizeRange,
  moveRange,
  rescheduleWithRange,
  rangeBars,
  barSegments,
  rangesCovering,
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

describe('setRangeEnd 写盘补丁', () => {
  it('无变化不写盘', () => {
    expect(setRangeEnd(task('a', { dueDate: TODAY }), TODAY)).toBeNull();
    expect(setRangeEnd(task('a'), null)).toBeNull();
  });

  it('设置 / 清除终点各给一个补丁', () => {
    expect(setRangeEnd(task('a'), TODAY)).toEqual({ dueDate: TODAY });
    expect(setRangeEnd(task('a', { dueDate: TODAY }), null)).toEqual({ dueDate: null });
  });

  it('非法目标不写盘', () => {
    expect(setRangeEnd(task('a'), '2026-13-45')).toBeNull();
  });
});

describe('resizeRange 端点钳制（永不产出 invalid）', () => {
  const range = (s, e) => task('a', { thresholdDate: s, dueDate: e });

  it('range 拖起点：正常写 t:，越过终点被钳到终点', () => {
    const t = range(TODAY, shiftDate(TODAY, 4));
    expect(resizeRange(t, 'start', shiftDate(TODAY, 2))).toEqual({ thresholdDate: shiftDate(TODAY, 2) });
    expect(resizeRange(t, 'start', shiftDate(TODAY, 9))).toEqual({ thresholdDate: shiftDate(TODAY, 4) });
  });

  it('range 拖终点：正常写 due:，越过起点被钳到起点', () => {
    const t = range(TODAY, shiftDate(TODAY, 4));
    expect(resizeRange(t, 'end', shiftDate(TODAY, 6))).toEqual({ dueDate: shiftDate(TODAY, 6) });
    expect(resizeRange(t, 'end', shiftDate(TODAY, -3))).toEqual({ dueDate: TODAY });
  });

  it('range 无变化零写入', () => {
    const t = range(TODAY, shiftDate(TODAY, 4));
    expect(resizeRange(t, 'start', TODAY)).toBeNull();
    expect(resizeRange(t, 'end', shiftDate(TODAY, 4))).toBeNull();
  });

  it('point 拖左缘长出区间（写 t:），拖回当日零写入', () => {
    const t = task('a', { dueDate: TODAY });
    expect(resizeRange(t, 'start', shiftDate(TODAY, -2))).toEqual({ thresholdDate: shiftDate(TODAY, -2) });
    expect(resizeRange(t, 'start', TODAY)).toBeNull();
    expect(resizeRange(t, 'start', shiftDate(TODAY, 3))).toBeNull(); // 钳到 anchor=当日
  });

  it('point 拖右缘自动补 t: 起点再延终点，左拖被钳零写入', () => {
    const t = task('a', { dueDate: TODAY });
    expect(resizeRange(t, 'end', shiftDate(TODAY, 3))).toEqual({ thresholdDate: TODAY, dueDate: shiftDate(TODAY, 3) });
    expect(resizeRange(t, 'end', shiftDate(TODAY, -2))).toBeNull();
    expect(resizeRange(t, 'end', TODAY)).toBeNull();
  });

  it('62 天上限：两端都被钳制', () => {
    const t = range(TODAY, shiftDate(TODAY, 4));
    const far = shiftDate(TODAY, RANGE_MAX_DAYS + 10);
    expect(resizeRange(t, 'end', far)).toEqual({ dueDate: shiftDate(TODAY, RANGE_MAX_DAYS - 1) });
    const back = shiftDate(TODAY, -(RANGE_MAX_DAYS + 10));
    expect(resizeRange(t, 'start', back)).toEqual({ thresholdDate: shiftDate(shiftDate(TODAY, 4), -(RANGE_MAX_DAYS - 1)) });
  });

  it('超长现值可拖回合法', () => {
    const t = range(TODAY, shiftDate(TODAY, RANGE_MAX_DAYS + 10));
    // 起点拖到 TODAY+62：与终点 TODAY+72 构成 11 天合法区间，目标原样接受
    const patch = resizeRange(t, 'start', shiftDate(TODAY, RANGE_MAX_DAYS));
    expect(patch).toEqual({ thresholdDate: shiftDate(TODAY, RANGE_MAX_DAYS) });
    // 起点拖到极左：被 62 天上限钳到 终点-61
    const far = resizeRange(t, 'start', shiftDate(TODAY, -(RANGE_MAX_DAYS + 10)));
    expect(far).toEqual({ thresholdDate: shiftDate(shiftDate(TODAY, RANGE_MAX_DAYS + 10), -(RANGE_MAX_DAYS - 1)) });
  });

  it('invalid / open / none 一律零写入（UI 同时禁手柄）', () => {
    expect(resizeRange(range(shiftDate(TODAY, 2), TODAY), 'start', TODAY)).toBeNull();
    expect(resizeRange(task('a', { thresholdDate: TODAY }), 'end', shiftDate(TODAY, 2))).toBeNull();
    expect(resizeRange(task('a'), 'start', TODAY)).toBeNull();
  });

  it('非法目标零写入', () => {
    expect(resizeRange(range(TODAY, shiftDate(TODAY, 4)), 'start', '2026-13-45')).toBeNull();
  });
});

describe('moveRange 条身保时长平移', () => {
  it('range 双端同移，时长不变', () => {
    const t = task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 3) });
    expect(moveRange(t, 2)).toEqual({ thresholdDate: shiftDate(TODAY, 2), dueDate: shiftDate(TODAY, 5) });
  });

  it('point 只移 due', () => {
    expect(moveRange(task('a', { dueDate: TODAY }), 2)).toEqual({ dueDate: shiftDate(TODAY, 2) });
  });

  it('Δ=0 / none / open 零写入', () => {
    expect(moveRange(task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 3) }), 0)).toBeNull();
    expect(moveRange(task('a'), 2)).toBeNull();
    expect(moveRange(task('a', { thresholdDate: TODAY }), 2)).toBeNull();
  });
});

describe('rescheduleWithRange 落点防 invalid', () => {
  it('无起点任务与 dropReschedule 逐字段一致', () => {
    expect(rescheduleWithRange(task('a', { dueDate: TODAY }), shiftDate(TODAY, 2))).toEqual({ dueDate: shiftDate(TODAY, 2) });
    expect(rescheduleWithRange(task('a', { dueDate: TODAY }), TODAY)).toBeNull();
  });

  it('起点晚于新终点时钳起点', () => {
    const t = task('a', { thresholdDate: shiftDate(TODAY, 5), dueDate: shiftDate(TODAY, 8) });
    expect(rescheduleWithRange(t, shiftDate(TODAY, 2))).toEqual({ dueDate: shiftDate(TODAY, 2), thresholdDate: shiftDate(TODAY, 2) });
  });

  it('清 due 保留 t:（锚点警示交给 UI）', () => {
    const t = task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 3) });
    expect(rescheduleWithRange(t, null)).toEqual({ dueDate: null });
  });
});

describe('rangeBars 全局车道分配', () => {
  it('不重叠复用同车道，重叠分车道', () => {
    const bars = rangeBars([
      task('a', { dueDate: TODAY }),
      task('b', { dueDate: shiftDate(TODAY, 1) }),
      task('c', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 2) }),
    ]);
    const byId = Object.fromEntries(bars.map((b) => [b.id, b.lane]));
    expect(byId.c).toBe(0); // 最长区间先占车道 0
    expect(byId.a).toBe(1); // 与 c 重叠
    expect(byId.b).toBe(1); // 与 c 重叠，但 a 已结束（TODAY < TODAY+1）可复用
  });

  it('输入乱序结果一致（确定性）', () => {
    const t1 = task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 2) });
    const t2 = task('b', { dueDate: TODAY });
    const l1 = rangeBars([t1, t2]).map((b) => [b.id, b.lane]);
    const l2 = rangeBars([t2, t1]).map((b) => [b.id, b.lane]);
    expect(l1).toEqual(l2);
  });

  it('同一任务集换可见窗口车道号不变（跨月稳定）', () => {
    const tasks = [
      task('a', { thresholdDate: shiftDate(TODAY, -3), dueDate: shiftDate(TODAY, 3) }),
      task('b', { dueDate: TODAY }),
    ];
    const lanes = rangeBars(tasks).map((b) => [b.id, b.lane]);
    expect(rangeBars(tasks).map((b) => [b.id, b.lane])).toEqual(lanes);
  });

  it('五种 kind 的有效区间：超长折叠 / open 用起点 / none 跳过', () => {
    const bars = rangeBars([
      task('over', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, RANGE_MAX_DAYS + 5) }),
      task('open', { thresholdDate: TODAY }),
      task('none'),
      task('inv', { thresholdDate: shiftDate(TODAY, 2), dueDate: TODAY }),
    ]);
    const byId = Object.fromEntries(bars.map((b) => [b.id, b]));
    expect(byId.over.kind).toBe('overlong');
    expect(byId.over.start).toBe(byId.over.end); // 折叠到 due
    expect(byId.open.start).toBe(TODAY);
    expect(byId.inv.kind).toBe('invalid');
    expect(byId.none).toBeUndefined();
  });
});

describe('barSegments 周行分段', () => {
  const cells = monthGrid(monthKey(TODAY));
  const dates = cells.map((c) => c.date);

  it('单日条出 1 段，真起点真终点，无续刻痕', () => {
    const bars = rangeBars([task('a', { dueDate: TODAY })]);
    const { weeks } = barSegments(bars, cells);
    const segs = weeks.flatMap((w) => w.segments).filter((s) => s.id === 'a');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ trueStart: true, trueEnd: true, contLeft: false, contRight: false, showTitle: true });
    expect(segs[0].colStart).toBe(segs[0].colEnd);
  });

  it('跨周条分段：首段真起点+右续，末段真终点+左续，同车道', () => {
    // 找一个必然跨周行的区间：今天起 8 天
    const bars = rangeBars([task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 8) })]);
    const { weeks } = barSegments(bars, cells);
    const segs = weeks.flatMap((w) => w.segments).filter((s) => s.id === 'a');
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0].trueStart).toBe(true);
    expect(segs[0].contRight).toBe(true);
    expect(segs[segs.length - 1].trueEnd).toBe(true);
    expect(segs[segs.length - 1].contLeft).toBe(true);
    expect(new Set(segs.map((s) => s.lane)).size).toBe(1);
    expect(segs.filter((s) => s.showTitle)).toHaveLength(1);
  });

  it('起点被上月裁掉：首可见段无真起点手柄、带左续刻痕、仍显示标题', () => {
    const bars = rangeBars([task('a', { thresholdDate: shiftDate(dates[0], -5), dueDate: dates[2] })]);
    const { weeks } = barSegments(bars, cells);
    const segs = weeks.flatMap((w) => w.segments).filter((s) => s.id === 'a');
    expect(segs[0].trueStart).toBe(false);
    expect(segs[0].contLeft).toBe(true);
    expect(segs[0].showTitle).toBe(true);
  });

  it('laneCap 溢出进 hidden 按日计数', () => {
    const tasks = [];
    for (let i = 0; i < MAX_BAR_LANES + 2; i += 1) {
      tasks.push(task(`t${i}`, { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 2) }));
    }
    const bars = rangeBars(tasks);
    const { weeks } = barSegments(bars, cells, MAX_BAR_LANES);
    const week = weeks.find((w) => w.hidden.size > 0);
    expect(week).toBeTruthy();
    expect(week.hidden.get(TODAY)).toBe(2); // 超出 3 车道的 2 条
    const col = dates.indexOf(TODAY) % 7;
    const visible = week.segments.filter((s) => s.colStart <= col && col <= s.colEnd);
    expect(visible).toHaveLength(MAX_BAR_LANES);
  });
});

describe('rangesCovering 日详情覆盖列表', () => {
  it('区间中途日列出覆盖任务，due 当日不重复列', () => {
    const t = task('a', { thresholdDate: TODAY, dueDate: shiftDate(TODAY, 3) });
    expect(rangesCovering([t], shiftDate(TODAY, 1))).toEqual([t]);
    expect(rangesCovering([t], shiftDate(TODAY, 3))).toEqual([]); // due 当日已在 dayTasks
    expect(rangesCovering([t], shiftDate(TODAY, 5))).toEqual([]);
  });

  it('open 起点日列出，point/none 不列', () => {
    expect(rangesCovering([task('a', { thresholdDate: TODAY })], TODAY)).toHaveLength(1);
    expect(rangesCovering([task('a', { dueDate: TODAY })], TODAY)).toEqual([]);
    expect(rangesCovering([task('a')], TODAY)).toEqual([]);
  });
});
