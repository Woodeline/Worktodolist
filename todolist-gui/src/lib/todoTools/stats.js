// 待办统计（纯函数）—— 只读：把任务集合折算成几组直方图 / 趋势。
//
// 组件只负责把这里算出的数字画成条；"怎么分组、怎么补零、怎么排序"全在这里，
// 于是这些口径都能被单测钉住，不会因为换个渲染方式就漂移。
import dayjs from 'dayjs';
import { PRIORITY_LABELS } from '../sortFilter.js';
import { weekRange } from './weekly.js';

const isTask = (t) => Boolean(t) && t.kind === 'task';

/** 百分比（整数，除零回 0）。 */
function pctOf(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/**
 * 优先级分布：A / B / C / 无 四行固定存在（其它字母若出现则夹在 C 与「无」之间）。
 * @returns {Array<{key:string, label:string, count:number, pct:number}>}
 */
export function priorityHistogram(tasks) {
  const list = (tasks || []).filter(isTask);
  const total = list.length;
  const map = new Map();
  for (const t of list) {
    const key = t.priority || null;
    map.set(key, (map.get(key) || 0) + 1);
  }
  const fixed = ['A', 'B', 'C'];
  const extras = [...map.keys()].filter((k) => k && !fixed.includes(k)).sort();
  const keys = [...fixed, ...extras, null];
  return keys.map((k) => ({
    key: k || 'none',
    label: k ? (PRIORITY_LABELS[k] ? `${k} ${PRIORITY_LABELS[k]}` : k) : '无',
    count: map.get(k) || 0,
    pct: pctOf(map.get(k) || 0, total),
  }));
}

/** 标签（分类 / 项目）直方图：同一任务内去重，按 count 降序、同次数按名称。 */
function tagHistogram(tasks, pick, prefix) {
  const list = (tasks || []).filter(isTask);
  const total = list.length;
  const map = new Map();
  for (const t of list) {
    for (const name of new Set(pick(t) || [])) {
      map.set(name, (map.get(name) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({
      key: name,
      label: prefix + name,
      count,
      pct: pctOf(count, total),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh'));
}

export function contextHistogram(tasks) {
  return tagHistogram(tasks, (t) => t.contexts, '@');
}

export function projectHistogram(tasks) {
  return tagHistogram(tasks, (t) => t.projects, '+');
}

/** 固定顺序的截止日分桶定义。 */
export const DUE_BUCKETS = [
  { key: 'overdue', label: '逾期' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'later', label: '以后' },
  { key: 'none', label: '无期限' },
];

/** 一条任务落在哪个截止日桶里（逾期 / 今天 / 本周 / 以后 / 无期限）。 */
export function dueBucketOf(task, today) {
  if (!task || !task.dueDate) return 'none';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  if (task.dueDate <= weekRange(today).to) return 'week';
  return 'later';
}

/** 截止日分布（五行固定存在）。 */
export function dueHistogram(tasks, today) {
  const counts = new Map(DUE_BUCKETS.map((b) => [b.key, 0]));
  for (const t of (tasks || []).filter(isTask)) {
    const key = dueBucketOf(t, today);
    counts.set(key, counts.get(key) + 1);
  }
  return DUE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: counts.get(b.key) }));
}

/**
 * 最近 N 天完成趋势：连续日期，缺的补 0（含今天）。
 * @returns {Array<{date:string, count:number}>}
 */
export function completionTrend(done, today, days = 14) {
  const n = Math.max(1, Math.floor(Number(days) || 14));
  const map = new Map();
  for (const t of done || []) {
    if (!isTask(t) || !t.completedAt) continue;
    map.set(t.completedAt, (map.get(t.completedAt) || 0) + 1);
  }
  const out = [];
  const end = dayjs(today);
  for (let i = n - 1; i >= 0; i -= 1) {
    const date = end.subtract(i, 'day').format('YYYY-MM-DD');
    out.push({ date, count: map.get(date) || 0 });
  }
  return out;
}

/** 按截止日把任务分到五个桶（顺序与 DUE_BUCKETS 一致）。 */
export function loadBuckets(tasks, today) {
  const out = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const t of (tasks || []).filter(isTask)) {
    out[dueBucketOf(t, today)].push(t);
  }
  return out;
}

/** 本周（周一起算）完成的条数。 */
export function weekCompletion(done, today) {
  const { from, to } = weekRange(today);
  return (done || []).filter(
    (t) => isTask(t) && t.completedAt && t.completedAt >= from && t.completedAt <= to
  ).length;
}
