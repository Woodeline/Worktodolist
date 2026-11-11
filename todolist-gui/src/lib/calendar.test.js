// 日历投影的逻辑层断言：月网格 / 月份迁移 / 视图映射 / 按日聚合 / 统计。
// 渲染层的最后一公里在 CalendarView.test.jsx。
import { describe, expect, it } from 'vitest';
import {
  WEEKDAY_LABELS,
  monthKey,
  shiftMonth,
  shiftDate,
  monthGrid,
  calendarSource,
  groupByDate,
  undatedTasks,
  monthStats,
  calendarProjection,
  projectionForMonth,
  monthTitle,
  dayTitle,
  calendarKeyAction,
  dropReschedule,
} from './calendar.js';
import { parseSingleLine } from './todoParser.js';

const T = (line) => parseSingleLine(line);
const entries = (...lines) => lines.map(T);
const TODAY = '2026-11-08';

describe('月网格', () => {
  it('周一首列，固定 42 格', () => {
    const cells = monthGrid('2026-11');
    expect(cells).toHaveLength(42);
    expect(WEEKDAY_LABELS).toEqual(['一', '二', '三', '四', '五', '六', '日']);
    // 2026-11-01 是周日 → 周一首列需要 6 个前置格，第一格是 10-26（周一）
    expect(cells[0].date).toBe('2026-10-26');
    expect(cells[6].date).toBe('2026-11-01');
  });

  it('本月格与跨月格分得清', () => {
    const cells = monthGrid('2026-11');
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(30);
    expect(inMonth[0].date).toBe('2026-11-01');
    expect(inMonth[29].date).toBe('2026-11-30');
    expect(cells.filter((c) => !c.inMonth)).toHaveLength(12);
  });

  it('周末标记落在周六周日', () => {
    const cells = monthGrid('2026-11');
    const weekend = cells.filter((c) => c.weekend).map((c) => c.date);
    expect(weekend).toContain('2026-11-07'); // 周六
    expect(weekend).toContain('2026-11-08'); // 周日
    expect(weekend).not.toContain('2026-11-09'); // 周一
  });

  it('恰好 28 天的二月也补满 42 格', () => {
    const cells = monthGrid('2026-02');
    expect(cells).toHaveLength(42);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(28);
  });

  it('闰年二月有 29 天', () => {
    const cells = monthGrid('2028-02');
    expect(cells.filter((c) => c.inMonth)).toHaveLength(29);
    expect(cells.some((c) => c.date === '2028-02-29')).toBe(true);
  });

  it('月初是周一时不需要前置格', () => {
    // 2026-06-01 是周一
    const cells = monthGrid('2026-06');
    expect(cells[0].date).toBe('2026-06-01');
    expect(cells[0].inMonth).toBe(true);
  });
});

describe('月份 / 日期迁移', () => {
  it('跨年进位', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });

  it('日期跨月跨年', () => {
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDate('2026-11-08', 7)).toBe('2026-11-15');
  });

  it('monthKey 截取年月', () => {
    expect(monthKey('2026-11-08')).toBe('2026-11');
  });
});

describe('数据源映射', () => {
  const todo = entries(
    '(A) 逾期任务 due:2026-11-01',
    '今天到期 due:2026-11-08',
    '未来任务 due:2026-12-01',
    '无日期任务',
    '有分类 @工作 due:2026-11-10',
    '有项目 +回测 due:2026-11-12',
    '未到期阈值 t:2026-12-01 due:2026-12-05'
  );
  const done = entries('x 2026-11-07 已完成任务 due:2026-11-06');

  it('today 视图放宽为全部未完成（日历要看得见未来）', () => {
    const src = calendarSource(todo, done, 'today', TODAY);
    expect(src.dateKey).toBe('dueDate');
    expect(src.readonly).toBe(false);
    expect(src.tasks).toHaveLength(7);
    expect(src.tasks.some((t) => t.dueDate === '2026-12-01')).toBe(true);
  });

  it('all 视图不混入已完成', () => {
    const src = calendarSource(todo, done, 'all', TODAY);
    expect(src.tasks.every((t) => !t.completed)).toBe(true);
  });

  it('done 视图改按完成日期锚定，且只读', () => {
    const src = calendarSource(todo, done, 'done', TODAY);
    expect(src.dateKey).toBe('completedAt');
    expect(src.readonly).toBe(true);
    expect(src.tasks).toHaveLength(1);
    expect(src.tasks[0].completedAt).toBe('2026-11-07');
  });

  it('项目 / 分类 / 收集箱过滤与侧栏同口径', () => {
    expect(calendarSource(todo, done, '+:回测', TODAY).tasks).toHaveLength(1);
    expect(calendarSource(todo, done, '@:工作', TODAY).tasks).toHaveLength(1);
    // 收集箱 = 无分类：7 条里只有 @工作 那条被排除
    expect(calendarSource(todo, done, 'inbox', TODAY).tasks).toHaveLength(6);
  });
});

describe('按日聚合与无日期托盘', () => {
  const tasks = [
    T('(B) 乙 due:2026-11-10'),
    T('(A) 甲 due:2026-11-10'),
    T('丙 due:2026-11-12'),
    T('无日期'),
    T('也无日期'),
  ];

  it('同一天的任务按优先级聚拢', () => {
    const map = groupByDate(tasks, 'dueDate');
    expect(map.get('2026-11-10').map((t) => t.title)).toEqual(['甲', '乙']);
    expect(map.get('2026-11-12')).toHaveLength(1);
    expect(map.has('2026-11-11')).toBe(false);
  });

  it('无日期任务进托盘，有日期的不进', () => {
    const und = undatedTasks(tasks, 'dueDate');
    expect(und.map((t) => t.title)).toEqual(['无日期', '也无日期']);
  });

  it('完成日期口径下缺失日期的行不进托盘（由调用方置空）', () => {
    const doneTasks = [T('x 2026-11-07 完成于昨天'), T('x 无完成日期')];
    const map = groupByDate(doneTasks, 'completedAt');
    expect(map.get('2026-11-07')).toHaveLength(1);
  });
});

describe('月统计', () => {
  const tasks = [
    T('本月逾期 due:2026-11-01'),
    T('本月今天 due:2026-11-08'),
    T('本月未来 due:2026-11-20'),
    T('上月逾期 due:2026-10-15'),
    T('下月 due:2026-12-01'),
    T('无日期'),
  ];

  it('本月计数只数本月，逾期是全库口径', () => {
    const stats = monthStats(tasks, 'dueDate', '2026-11', TODAY);
    expect(stats.inMonth).toBe(3);
    expect(stats.overdue).toBe(2); // 11-01 与 10-15，翻月也不消账
  });

  it('完成日期口径不报逾期', () => {
    const doneTasks = [T('x 2026-10-01 旧完成'), T('x 2026-11-02 本月完成')];
    const stats = monthStats(doneTasks, 'completedAt', '2026-11', TODAY);
    expect(stats.inMonth).toBe(1);
    expect(stats.overdue).toBe(0);
  });
});

describe('投影入口', () => {
  const todo = entries(
    '写周报 due:2026-11-09 +工作',
    '买网线 due:2026-11-09',
    '整理策略 due:2026-11-10',
    '无日期杂事'
  );

  it('搜索过滤同时作用于网格与托盘', () => {
    const p = calendarProjection(todo, [], 'all', '网线', TODAY);
    expect(p.tasks).toHaveLength(1);
    expect(p.byDate.get('2026-11-09')).toHaveLength(1);
    expect(p.undated).toHaveLength(0);
  });

  it('翻月时统计锚定到显示的月份', () => {
    const p = projectionForMonth(todo, [], 'all', '', TODAY, '2026-12');
    expect(p.stats.inMonth).toBe(0);
    const nov = projectionForMonth(todo, [], 'all', '', TODAY, '2026-11');
    expect(nov.stats.inMonth).toBe(3);
  });

  it('只读投影没有托盘', () => {
    const done = entries('x 2026-11-07 做完的事');
    const p = calendarProjection(todo, done, 'done', '', TODAY);
    expect(p.readonly).toBe(true);
    expect(p.undated).toEqual([]);
    expect(p.byDate.get('2026-11-07')).toHaveLength(1);
  });
});

describe('标题文案', () => {
  it('月份标题', () => {
    expect(monthTitle('2026-11')).toBe('2026年11月');
    expect(monthTitle('2027-01')).toBe('2027年1月');
  });

  it('日期标题带星期，今天追加标记', () => {
    expect(dayTitle('2026-11-08', TODAY)).toBe('11月8日 · 周日 · 今天');
    expect(dayTitle('2026-11-09', TODAY)).toBe('11月9日 · 周一');
  });
});

// 交互语义抽成纯函数后，键位与改期不必依赖 DOM 也能钉死。
describe('calendarKeyAction（格子键盘）', () => {
  it('左右移一天、上下翻月、Home 回今天', () => {
    expect(calendarKeyAction('ArrowLeft', '2026-11-01')).toEqual({ type: 'day', date: '2026-10-31' });
    expect(calendarKeyAction('ArrowRight', '2026-12-31')).toEqual({ type: 'day', date: '2027-01-01' });
    expect(calendarKeyAction('PageUp', TODAY)).toEqual({ type: 'month', delta: -1 });
    expect(calendarKeyAction('PageDown', TODAY)).toEqual({ type: 'month', delta: 1 });
    expect(calendarKeyAction('Home', TODAY)).toEqual({ type: 'today' });
  });

  it('Enter 在这天新建、空格只选中；两者语义不能互换', () => {
    expect(calendarKeyAction('Enter', TODAY)).toEqual({ type: 'create', date: TODAY });
    expect(calendarKeyAction(' ', TODAY)).toEqual({ type: 'select', date: TODAY });
  });

  it('不归日历管的键返回 null（↑↓ 交给全局 moveSelection，Esc / e 照旧）', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Escape', 'e', 'n', '/', 'Tab', 'Shift']) {
      expect(calendarKeyAction(key, TODAY)).toBeNull();
    }
  });
});

describe('dropReschedule（拖放改期）', () => {
  it('拖到新日期 = 写 dueDate', () => {
    expect(dropReschedule({ dueDate: TODAY }, '2026-11-20')).toEqual({ dueDate: '2026-11-20' });
  });

  it('拖进无日期托盘 = 清日期', () => {
    expect(dropReschedule({ dueDate: TODAY }, null)).toEqual({ dueDate: null });
  });

  it('同一天松手 / 本来就没日期再拖进托盘 / 找不到任务，都是零写入', () => {
    expect(dropReschedule({ dueDate: TODAY }, TODAY)).toBeNull();
    expect(dropReschedule({ dueDate: null }, null)).toBeNull();
    expect(dropReschedule(undefined, '2026-11-20')).toBeNull();
  });
});