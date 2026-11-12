// 任务区间：把 todo.txt 里已有的 t:（可开始日）与 due:（截止日）读成一个区间。
//
// 数据层零改动 —— 这里只做投影 / 校验 / 展示用的跨度展开，不新增字段、不写盘，
// 也不改 groupByDate 的单 key 聚合：任务仍按 dueDate 落在唯一那一天，
// 区间只是叠在 42 格上的一层中性视觉与一行读数。
import dayjs from 'dayjs';
import { shiftDate } from './calendar.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 手打 / 外部编辑器可能写出很长的区间，展开上限之外只给读数、不画跨度。
export const RANGE_MAX_DAYS = 62;

// t: / due: 解析器不校验格式（原样保留字符串），所以这里必须自己挡一道：
// 正则 + 格式化回环，'2026-13-45' 这类会被 dayjs 悄悄修正的日期一律不认。
function iso(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const d = dayjs(value);
  return d.isValid() && d.format('YYYY-MM-DD') === value ? value : null;
}

/**
 * 一条任务的区间状态。kind 五种：
 *   none 无日期 / point 只有截止（普通任务，不产生区间，避免刷屏）
 *   open 只有起点 / range 起止齐全且有效 / invalid 起点晚于截止
 */
export function rangeOf(task) {
  const start = iso(task && task.thresholdDate);
  const end = iso(task && task.dueDate);
  if (!start && !end) return { start: null, end: null, kind: 'none', days: 0, reason: null };
  if (start && !end) return { start, end: null, kind: 'open', days: 0, reason: null };
  if (!start) return { start: null, end, kind: 'point', days: 1, reason: null };
  if (start > end) return { start, end, kind: 'invalid', days: 0, reason: '开始晚于截止' };
  return {
    start,
    end,
    kind: 'range',
    days: dayjs(end).diff(dayjs(start), 'day') + 1,
    reason: null,
  };
}

/** 日详情里的一行读数；point / none 返回空串，不打扰绝大多数普通任务。 */
export function rangeReadout(range) {
  const short = (d) => (d ? d.slice(5) : '');
  switch (range.kind) {
    case 'range':
      return `${short(range.start)} → ${short(range.end)} · ${range.days} 天`;
    case 'open':
      return `起点 ${short(range.start)} · 无截止`;
    case 'invalid':
      return `区间无效：${range.reason}`;
    default:
      return '';
  }
}

/** 展开成逐日数组；超长 / 无效区间返回 []（只显示读数，不画跨度）。 */
export function spanDates(start, end, maxDays = RANGE_MAX_DAYS) {
  if (!start || !end || start > end) return [];
  const total = dayjs(end).diff(dayjs(start), 'day') + 1;
  if (total > maxDays) return [];
  const out = [];
  let d = start;
  for (let i = 0; i < total; i += 1) {
    out.push(d);
    d = shiftDate(d, 1);
  }
  return out;
}

/**
 * 42 格上的区间覆盖：Map<'YYYY-MM-DD', [{ id, role }]>。
 * role = start | mid | end | single，端点只用来决定描边在哪一侧收口。
 * visibleDates 之外的日期直接裁掉；起点被裁掉时首段仍是 mid，不伪造一个假起点。
 * 同日多个区间并行保留 —— 待办没有资源互斥，重叠不是错误。
 */
export function rangeOverlay(tasks, visibleDates) {
  const allowed = new Set(visibleDates || []);
  const map = new Map();
  for (const t of tasks || []) {
    const r = rangeOf(t);
    if (r.kind !== 'range' && r.kind !== 'open') continue;
    const dates = r.kind === 'open' ? [r.start] : spanDates(r.start, r.end);
    if (!dates.length) continue;
    dates.forEach((date, i) => {
      if (!allowed.has(date)) return;
      const role =
        dates.length === 1 ? 'single' : i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'mid';
      if (!map.has(date)) map.set(date, []);
      map.get(date).push({ id: t.id, role });
    });
  }
  return map;
}

/** 右键菜单的写盘补丁；返回 null = 这次操作不该写盘（与 dropReschedule 同一口径）。 */
export function setRangeStart(task, date) {
  const current = iso(task && task.thresholdDate);
  const next = date == null ? null : iso(String(date));
  if (date != null && !next) return null;
  return current === next ? null : { thresholdDate: next };
}
