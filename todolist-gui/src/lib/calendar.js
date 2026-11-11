// 日历视图：把清单按日期摊开的纯投影（无 DOM、无 store，node 环境可直接单测）。
// 日期一律 YYYY-MM-DD 字符串、月份一律 YYYY-MM —— 与 sortFilter 同一条字典序比较口径。
import dayjs from 'dayjs';
import { compareAuto, searchMatch, tasksForView } from './sortFilter';

// 周一首列（中文周惯例，与 TaskRow.nextMonday 的口径一致）。
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthKey(date) {
  return String(date).slice(0, 7);
}

/** 月份迁移（跨年自动进位）。'2026-12' + 1 → '2027-01' */
export function shiftMonth(month, delta) {
  return dayjs(`${month}-01`).add(delta, 'month').format('YYYY-MM');
}

/** 日期迁移（跨月/跨年自动进位）。 */
export function shiftDate(date, days) {
  return dayjs(date).add(days, 'day').format('YYYY-MM-DD');
}

/**
 * 月网格：固定 42 格（6 行 × 7 列），月与月之间网格高度不变，翻月时视线不跳。
 *  leading/trailing 的跨月格也画出来 —— 空白格会让"这一周从哪天开始"失去参照。
 */
export function monthGrid(month) {
  const first = dayjs(`${month}-01`);
  const lead = (first.day() + 6) % 7; // dayjs 周日=0 → 周一首列需要 6 个前置格
  const start = first.subtract(lead, 'day');
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = start.add(i, 'day');
    const date = d.format('YYYY-MM-DD');
    cells.push({
      date,
      day: d.date(),
      inMonth: monthKey(date) === month,
      weekend: d.day() === 0 || d.day() === 6,
    });
  }
  return cells;
}

/**
 * 日历的数据源：与侧栏共用 tasksForView 的过滤口径，只有两处刻意的例外 ——
 * ① 「今天」视图是紧急度过滤（只留 due<=今天），会把未来日期全部清空；
 *    日历天生是"按日期规划"的镜头，所以 today 在日历里放宽为全部未完成。
 * ② 「已完成」视图改按**完成日期**锚定（done.txt 只读），看"每天做完了什么"。
 * t:（阈值日期）不参与：日历就是用来提前看未来任务的，阈值只约束"今天"视图。
 */
export function calendarSource(todoEntries, doneEntries, view, today) {
  if (view === 'done') {
    return {
      tasks: doneEntries.filter((e) => e.kind === 'task'),
      dateKey: 'completedAt',
      readonly: true,
    };
  }
  const listView = view === 'today' ? 'all' : view;
  return {
    tasks: tasksForView(todoEntries, listView, today).filter((t) => !t.completed),
    dateKey: 'dueDate',
    readonly: false,
  };
}

/** 按日期聚拢：Map<'YYYY-MM-DD', task[]>，组内走自动排序（与列表同一条 compareAuto）。 */
export function groupByDate(tasks, dateKey) {
  const map = new Map();
  for (const t of tasks) {
    const d = t[dateKey];
    if (!d) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(t);
  }
  for (const list of map.values()) list.sort(compareAuto);
  return map;
}

/** 无日期任务（只有 dueDate 口径下才有意义 —— 完成日期缺失的行不进托盘）。 */
export function undatedTasks(tasks, dateKey) {
  return tasks.filter((t) => !t[dateKey]).sort(compareAuto);
}

/**
 * 月统计：本月到期 N + 逾期 M。
 * 逾期是**全库**口径（与今日概览一致）：翻到任何一个月都应该看到欠账总数，
 * 而不是"这个月里逾期了几条" —— 欠账不会因为翻月就消失。
 */
export function monthStats(tasks, dateKey, month, today) {
  let inMonth = 0;
  let overdue = 0;
  for (const t of tasks) {
    const d = t[dateKey];
    if (!d) continue;
    if (monthKey(d) === month) inMonth += 1;
    if (dateKey === 'dueDate' && !t.completed && d < today) overdue += 1;
  }
  return { inMonth, overdue };
}

/**
 * 日历投影的唯一入口：主区渲染与页眉计数都走它，两处的"有几条"不会分叉。
 * 返回 { tasks, byDate, undated, dateKey, readonly, stats }。
 */
export function calendarProjection(todoEntries, doneEntries, view, query, today) {
  const month = monthKey(today);
  return projectionForMonth(todoEntries, doneEntries, view, query, today, month);
}

/** 同上，但统计锚定到指定月份（翻月时页眉计数跟着月份走）。 */
export function projectionForMonth(todoEntries, doneEntries, view, query, today, month) {
  const src = calendarSource(todoEntries, doneEntries, view, today);
  const tasks = src.tasks.filter((t) => searchMatch(t, query));
  return {
    tasks,
    byDate: groupByDate(tasks, src.dateKey),
    undated: src.readonly ? [] : undatedTasks(tasks, src.dateKey),
    dateKey: src.dateKey,
    readonly: src.readonly,
    stats: monthStats(tasks, src.dateKey, month, today),
  };
}

/** '2026-11' → '2026年11月' */
export function monthTitle(month) {
  const d = dayjs(`${month}-01`);
  return `${d.year()}年${d.month() + 1}月`;
}

/** '2026-11-08' → '11月8日 · 周六'；今天追加 ' · 今天'。 */
export function dayTitle(date, today) {
  const d = dayjs(date);
  const base = `${d.month() + 1}月${d.date()}日 · 周${WEEKDAY_NAMES[d.day()]}`;
  return date === today ? `${base} · 今天` : base;
}

/**
 * 日历格子上的按键 → 意图。渲染层只负责分派（readonly 丢掉 create），
 * 键位语义留在纯函数里，node 环境就能钉死 —— 不必为了测一个键去装 DOM。
 * ↑↓ 不在这里：跨周移动由 App 的全局 moveSelection 统一处理（在日详情里改成移行）。
 * 返回 null = 这个键不归日历管，照旧冒泡给全局快捷键。
 */
export function calendarKeyAction(key, date) {
  switch (key) {
    case 'ArrowLeft':
      return { type: 'day', date: shiftDate(date, -1) };
    case 'ArrowRight':
      return { type: 'day', date: shiftDate(date, 1) };
    case 'PageUp':
      return { type: 'month', delta: -1 };
    case 'PageDown':
      return { type: 'month', delta: 1 };
    case 'Home':
      return { type: 'today' };
    case 'Enter':
      return { type: 'create', date };
    case ' ':
      return { type: 'select', date };
    default:
      return null;
  }
}

/**
 * 拖放改期的结果：返回要写回的字段，null = 这次拖放是空操作（不该写盘）。
 * targetDate 为 null 表示拖进「无日期」托盘。落点比「有没有动过」更重要 ——
 * 同一天松手、把本来就没日期的任务拖进托盘，都必须是零写入。
 */
export function dropReschedule(task, targetDate) {
  if (!task) return null;
  if (targetDate == null) return task.dueDate ? { dueDate: null } : null;
  return task.dueDate === targetDate ? null : { dueDate: targetDate };
}