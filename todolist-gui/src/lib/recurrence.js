// 重复规则（rec: 标签）—— 语法解析、下次到期计算、下一次实例的字段推导。
//
// 只做提醒事项里真正高频的那几种，不抄全 EKRecurrenceRule（每月最后一个周五、
// 每三个月的第二个周二……语法复杂度和出错面远超收益，真需要的人手写一行也就一行）：
//   rec:+1d      每天
//   rec:+3d      每 3 天
//   rec:+2w      每 2 周
//   rec:+1m      每月（按「号数」走；遇短月压到月末，且不漂移：1/31 → 2/28 → 3/31）
//   rec:mon,thu  每周一、周四
//
// 两条硬规矩：
//  1. 下一次到期以 **due 为锚点**推进，而不是以「今天」推进。逾期三天才完成的任务，
//     下一次仍是 due + 一个周期（而不是今天 + 一个周期），否则每完成一次就往后滑一点，
//     时间久了「每周」会变成「每两周」。
//  2. 算出来的日期必须 **严格晚于今天**。提前完成的重复任务不应该当天再冒出来一条。
import dayjs from 'dayjs';

const OFFSET_RE = /^\+(\d{1,3})(d|w|m)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REMIND_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
// mon..sun → 0..6，与输入顺序无关，输出时按周内顺序排好，
// 这样 `rec:thu,mon` 与 `rec:mon,thu` 是同一条规则（文本上也长得一样）。
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];
const MAX_STEPS = 600; // 防死循环：任何一个周期都够在 600 步内跨过今天

/**
 * 解析 rec: 的值。
 * @returns {object|null} { kind:'days'|'weeks'|'months', interval } 或
 *                        { kind:'weekdays', interval:1, weekdays:[0..6] }；
 *          无法识别一律返回 null —— 调用方负责决定是丢弃还是留作普通标签。
 */
export function parseRecurrence(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const off = OFFSET_RE.exec(v);
  if (off) {
    const n = Number(off[1]);
    if (!Number.isInteger(n) || n < 1 || n > 999) return null;
    if (off[2] === 'd') return { kind: 'days', interval: n };
    if (off[2] === 'w') return { kind: 'weeks', interval: n };
    return { kind: 'months', interval: n };
  }
  const days = [];
  for (const part of v.split(',')) {
    const i = WEEKDAY_KEYS.indexOf(part);
    if (i === -1) return null;
    if (!days.includes(i)) days.push(i);
  }
  if (days.length === 0) return null;
  days.sort((a, b) => a - b);
  return { kind: 'weekdays', interval: 1, weekdays: days };
}

/** 规则 → rec: 的字面值（与 parseRecurrence 互为逆运算，用于写回文本）。 */
export function formatRecurrence(rule) {
  if (!rule) return null;
  if (rule.kind === 'weekdays') {
    if (!Array.isArray(rule.weekdays) || rule.weekdays.length === 0) return null;
    return rule.weekdays.map((i) => WEEKDAY_KEYS[i]).join(',');
  }
  if (rule.kind === 'days') return `+${rule.interval}d`;
  if (rule.kind === 'weeks') return `+${rule.interval}w`;
  if (rule.kind === 'months') return `+${rule.interval}m`;
  return null;
}

/** 中文描述，用于界面上「这个任务多久来一次」。 */
export function describeRecurrence(value) {
  const rule = typeof value === 'string' ? parseRecurrence(value) : value;
  if (!rule) return '';
  if (rule.kind === 'days') return rule.interval === 1 ? '每天' : `每 ${rule.interval} 天`;
  if (rule.kind === 'weeks') return rule.interval === 1 ? '每周' : `每 ${rule.interval} 周`;
  if (rule.kind === 'months') return rule.interval === 1 ? '每月' : `每 ${rule.interval} 个月`;
  const days = rule.weekdays.map((i) => WEEKDAY_CN[i]);
  const all = rule.weekdays.join(',');
  if (all === '0,1,2,3,4') return '每个工作日';
  if (all === '0,1,2,3,4,5,6') return '每天';
  return `每周${days.join('、')}`;
}

/**
 * 下一次到期日。
 * @param {object|string} rule  规则（或 rec: 的原始字符串）
 * @param {string} base   锚点：原任务的 due（没有 due 时用今天）
 * @param {string} today  今天（YYYY-MM-DD），结果必须严格晚于它
 * @returns {string|null}
 */
export function nextDueDate(rule, base, today) {
  const r = typeof rule === 'string' ? parseRecurrence(rule) : rule;
  if (!r || !DATE_RE.test(base) || !DATE_RE.test(today)) return null;
  const anchor = dayjs(base);
  const todayD = dayjs(today);

  if (r.kind === 'weekdays') {
    // 1=周一 … 7=周日（dayjs 的 .day() 是 0=周日，这里换成正序好看懂）
    const want = new Set(r.weekdays.map((i) => i + 1));
    for (let i = 1; i <= 400; i += 1) {
      const d = anchor.add(i, 'day');
      const iso = d.day() === 0 ? 7 : d.day();
      if (want.has(iso) && d.isAfter(todayD, 'day')) return d.format('YYYY-MM-DD');
    }
    return null;
  }

  if (r.kind === 'months') {
    const dom = anchor.date();
    for (let n = 1; n <= MAX_STEPS; n += 1) {
      // 每一步都从 anchor 重新算，而不是在上一步的结果上加一个月：
      // 否则 1/31 → 2/28 → 3/28，「每月 31 号」会被短月永久拽成 28 号。
      const first = anchor.add(n * r.interval, 'month').startOf('month');
      const lastDay = first.add(1, 'month').subtract(1, 'day').date();
      const d = first.date(Math.min(dom, lastDay));
      if (d.isAfter(todayD, 'day')) return d.format('YYYY-MM-DD');
    }
    return null;
  }

  const step = r.kind === 'weeks' ? r.interval * 7 : r.interval;
  for (let n = 1; n <= MAX_STEPS; n += 1) {
    const d = anchor.add(n * step, 'day');
    if (d.isAfter(todayD, 'day')) return d.format('YYYY-MM-DD');
  }
  return null;
}

function shiftDate(v, shift) {
  if (!v || !DATE_RE.test(v)) return v || null;
  return dayjs(v).add(shift, 'day').format('YYYY-MM-DD');
}

// 提醒时刻跟着 due 一起平移：rem 相对 due 提前多少天，是用户定下的节奏，
// 下一次实例应当保持（「每周一 9 点提醒」不能变成「每周一 9 点，但那周是周二到期」）。
function shiftRemind(v, shift) {
  const m = REMIND_RE.exec(v || '');
  if (!m) return v || null;
  return `${shiftDate(m[1], shift)}T${m[2]}`;
}

/**
 * 推导「下一次实例」的字段补丁。
 * @returns {object|null} 可直接交给 applyPatch 的补丁；没有有效规则时返回 null。
 *
 * 注意：这里**不继承 stableId**。重复的下一次是另一条任务，继承 ID 会让两条行同号，
 * 引用它的人（子任务 / 备注）就指不准了；ID 由 store 在提交时新分配。
 * parentId 则保留 —— 父任务没换，下一次仍然挂在同一个父下面。
 */
export function nextOccurrence(task, today) {
  if (!task || !parseRecurrence(task.recurrence)) return null;
  const base = task.dueDate && DATE_RE.test(task.dueDate) ? task.dueDate : today;
  const nextDue = nextDueDate(task.recurrence, base, today);
  if (!nextDue) return null;
  const shift = dayjs(nextDue).diff(dayjs(base), 'day');
  return {
    dueDate: nextDue,
    thresholdDate: shiftDate(task.thresholdDate, shift),
    remindAt: shiftRemind(task.remindAt, shift),
    createdAt: today,
    completed: false,
    completedAt: null,
  };
}

/** 编辑浮窗里的可选项。手写 rec: 不受此限 —— 这只是少打字用的。 */
export const RECURRENCE_CHOICES = [
  { value: '', label: '不重复' },
  { value: '+1d', label: '每天' },
  { value: '+1w', label: '每周' },
  { value: '+2w', label: '每 2 周' },
  { value: '+1m', label: '每月' },
  { value: '+3m', label: '每 3 个月' },
  { value: 'mon,tue,wed,thu,fri', label: '每个工作日' },
  { value: 'mon', label: '每周一' },
  { value: 'tue', label: '每周二' },
  { value: 'wed', label: '每周三' },
  { value: 'thu', label: '每周四' },
  { value: 'fri', label: '每周五' },
  { value: 'sat', label: '每周六' },
  { value: 'sun', label: '每周日' },
];
