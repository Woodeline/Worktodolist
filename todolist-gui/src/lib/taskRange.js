// 任务区间：把 todo.txt 里已有的 t:（可开始日）与 due:（截止日）读成一个区间。
//
// 数据层零改动 —— 不新增字段、不改 groupByDate 的单 key 聚合：任务仍按 dueDate
// 落在唯一那一天，区间是叠在 42 格上的一层独立投影。这里提供三类纯函数：
//   ① 投影 / 校验 / 跨度展开（rangeOf / spanDates / rangeOverlay / rangeBars / barSegments）
//   ② 读数（rangeReadout）
//   ③ 区间编辑补丁（setRangeStart / setRangeEnd / resizeRange / moveRange / rescheduleWithRange）
//      —— 只返回要写回的字段或 null（零写入），真正写盘由 store.updateTask 完成。
import dayjs from 'dayjs';
import { shiftDate, dropReschedule } from './calendar.js';

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

/** 终点的写盘补丁，镜像 setRangeStart。 */
export function setRangeEnd(task, date) {
  const current = iso(task && task.dueDate);
  const next = date == null ? null : iso(String(date));
  if (date != null && !next) return null;
  return current === next ? null : { dueDate: next };
}

const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);

/**
 * 拖动区间条端点的写盘补丁（核心）。钳制在函数内做 —— 预览与提交共用它，预览即所得：
 *   · 起点最多拖到终点、终点最多拖到起点，永不产出 invalid（start>end）。
 *   · 单日任务（point）拖左缘长出区间（写 t:）、拖右缘自动补 t: 起点再延终点。
 *   · 叠加 62 天上限钳制；超长现值可借此拖回合法。
 * edge = 'start' | 'end'；非法目标 / invalid / open / none / 无变化 → null（零写入）。
 */
export function resizeRange(task, edge, date) {
  const target = iso(String(date));
  if (!target) return null;
  const r = rangeOf(task);
  const span = RANGE_MAX_DAYS - 1;
  if (r.kind === 'point') {
    const anchor = r.end;
    if (edge === 'start') {
      const clamped = maxDate(minDate(target, anchor), shiftDate(anchor, -span));
      return clamped === anchor ? null : { thresholdDate: clamped };
    }
    const clamped = minDate(maxDate(target, anchor), shiftDate(anchor, span));
    return clamped === anchor ? null : { thresholdDate: anchor, dueDate: clamped };
  }
  if (r.kind === 'range') {
    if (edge === 'start') {
      const clamped = maxDate(minDate(target, r.end), shiftDate(r.end, -span));
      return clamped === r.start ? null : { thresholdDate: clamped };
    }
    const clamped = minDate(maxDate(target, r.start), shiftDate(r.start, span));
    return clamped === r.end ? null : { dueDate: clamped };
  }
  return null;
}

/**
 * 拖动条身整体平移（保时长）。range 双端同移；point 只移 due；
 * invalid 只移 due（t: 原样保留，读数继续警示）；Δ=0 / none / open → null。
 * 与 rescheduleWithRange 刻意不同：条身拖保时长，chip/托盘拖只改终点。
 */
export function moveRange(task, deltaDays) {
  if (!deltaDays) return null;
  const r = rangeOf(task);
  if (r.kind === 'range') {
    return { thresholdDate: shiftDate(r.start, deltaDays), dueDate: shiftDate(r.end, deltaDays) };
  }
  if (r.kind === 'point' || r.kind === 'invalid') return { dueDate: shiftDate(r.end, deltaDays) };
  return null;
}

/**
 * HTML5 落点（托盘→格子 / 窄屏 chip 拖放）的防 invalid 升级：
 * 在 dropReschedule（只改终点）基础上，若合法起点晚于新终点则把起点钳到新终点。
 * date=null（清 due）保留 t:，锚点警示交给 UI。零写入语义与 dropReschedule 一致。
 */
export function rescheduleWithRange(task, date) {
  const base = dropReschedule(task, date);
  if (!base) return null;
  if (date == null) return base;
  const start = iso(task && task.thresholdDate);
  if (start && base.dueDate && start > base.dueDate) {
    return { ...base, thresholdDate: base.dueDate };
  }
  return base;
}

/** 宽屏车道上限；超出进「+N」溢出计数。laneCap 由组件按行高动态钳制。 */
export const MAX_BAR_LANES = 3;

/**
 * 全局车道分配（跨月稳定的关键）：对全量任务分配，而非可见窗口 —— 翻月时只要任务集
 * 不变车道号就不变。贪心区间分区：start↑ end↓ id↑ 全序排序（id 兜底保证确定性），
 * 每条取第一个「上一占用结束 < 本条起点」的车道（日期含两端故严格小于），否则开新车道。
 * 有效区间：range→[t,due]；point/invalid→[due,due]；超长 range 折叠为 [due,due]；open→[t,t]；none 跳过。
 */
export function rangeBars(tasks) {
  const bars = [];
  for (const t of tasks || []) {
    const r = rangeOf(t);
    let start;
    let end;
    let kind;
    if (r.kind === 'range') {
      if (r.days > RANGE_MAX_DAYS) {
        start = r.end;
        end = r.end;
        kind = 'overlong';
      } else {
        start = r.start;
        end = r.end;
        kind = 'range';
      }
    } else if (r.kind === 'point' || r.kind === 'invalid') {
      start = r.end;
      end = r.end;
      kind = r.kind;
    } else if (r.kind === 'open') {
      start = r.start;
      end = r.start;
      kind = 'open';
    } else {
      continue;
    }
    bars.push({ id: t.id, task: t, kind, start, end, lane: 0 });
  }
  bars.sort((a, b) => {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (a.end !== b.end) return a.end > b.end ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const laneEnds = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end < bar.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bar.end);
    } else {
      laneEnds[lane] = bar.end;
    }
    bar.lane = lane;
  }
  return bars;
}

/**
 * 把车道条切成 6 周行 × 跨列段。每周取条与周的交集；trueStart/trueEnd 决定手柄
 * （只挂真实端点，被裁切的续段不放假手柄）；contLeft/contRight 决定续刻痕；
 * showTitle 只在网格内第一个可见段为真。lane≥maxLanes 的段不进 segments，按覆盖日累加进 hidden。
 */
export function barSegments(bars, cells, maxLanes = MAX_BAR_LANES) {
  const indexOf = new Map(cells.map((c, i) => [c.date, i]));
  const laneCount = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  const seenTitle = new Set();
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const weekCells = cells.slice(w * 7, w * 7 + 7);
    const weekStart = weekCells[0].date;
    const weekEnd = weekCells[6].date;
    const segments = [];
    const hidden = new Map();
    for (const bar of bars) {
      const s = maxDate(bar.start, weekStart);
      const e = minDate(bar.end, weekEnd);
      if (s > e) continue;
      // 条容器内层是 7 列网格：列号取周内列（全局索引 % 7），不是 42 格全局索引。
      const colStart = indexOf.get(s) % 7;
      const colEnd = indexOf.get(e) % 7;
      if (colStart == null || colEnd == null) continue;
      if (bar.lane >= maxLanes) {
        for (let i = colStart; i <= colEnd; i += 1) {
          const d = weekCells[i].date;
          hidden.set(d, (hidden.get(d) || 0) + 1);
        }
        continue;
      }
      const showTitle = !seenTitle.has(bar.id);
      if (showTitle) seenTitle.add(bar.id);
      segments.push({
        id: bar.id,
        task: bar.task,
        lane: bar.lane,
        colStart,
        colEnd,
        kind: bar.kind,
        trueStart: bar.start >= weekStart,
        trueEnd: bar.end <= weekEnd,
        contLeft: bar.start < weekStart,
        contRight: bar.end > weekEnd,
        showTitle,
      });
    }
    weeks.push({ segments, hidden });
  }
  return { weeks, laneCount };
}

/**
 * 日详情覆盖列表：区间中途日（due 不在选中日）也能看到覆盖当天的任务，
 * 补上「宽屏 +N 隐藏的是覆盖条、日详情却只列 due 条」的 discoverability 缺口。
 * range 且 start≤day≤end 且 due≠day（超长条用真实区间判定）；open 且 t:=day。
 */
export function rangesCovering(tasks, day) {
  const out = [];
  for (const t of tasks || []) {
    const r = rangeOf(t);
    if (r.kind === 'range' && r.start <= day && day <= r.end && r.end !== day) out.push(t);
    else if (r.kind === 'open' && r.start === day) out.push(t);
  }
  return out;
}
