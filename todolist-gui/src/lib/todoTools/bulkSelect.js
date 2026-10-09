// 批量筛选与选择（纯函数）—— 给「批量优先级」工具用。
//
// 组件只持有"筛选项 + 选中 id 列表"两份状态；"怎么筛、选中几条、哪些任务
// 吃这个 op"全部在这里算。选择辅助（全选 / 反选 / 单行切换）也做成纯函数，
// 于是这些交互都能被单测覆盖，而不是埋在 onClick 里。
import { OPS, applyOp } from './ops.js';

const isTask = (t) => Boolean(t) && t.kind === 'task';

/** 对「已存在任务」有意义的 op：OPS 全量减去 delete（delete 更适合单条上下文菜单）。 */
export const WRITE_OPS = OPS.filter((o) => o.type !== 'delete');

/** 该 op 是否需要填写值。 */
export function opNeedsValue(type) {
  const meta = OPS.find((o) => o.type === type);
  return Boolean(meta && meta.needsValue);
}

/** 该 op 的取值类型（date / days / priority / context / project / null）。 */
export function valueKindOf(type) {
  const meta = OPS.find((o) => o.type === type);
  return meta ? meta.valueKind || null : null;
}

/**
 * 按筛选条件过滤任务（未给出的条件不参与过滤）。
 * @param {Array} tasks
 * @param {{keyword?:string, context?:string, project?:string, priority?:string, overdueOnly?:boolean, today?:string}} opts
 *   keyword 对 title 做不区分大小写包含
 *   priority 'none' 表示"无优先级"
 * @returns {Array}
 */
export function filterTasks(tasks, opts = {}) {
  const { keyword, context, project, priority, overdueOnly, today } = opts;
  const kw = String(keyword || '').trim().toLowerCase();
  const ctx = String(context || '').replace(/^@/, '');
  const proj = String(project || '').replace(/^\+/, '');
  const prio = priority == null ? '' : String(priority);

  return (tasks || []).filter((t) => {
    if (!isTask(t)) return false;
    if (kw && !String(t.title || '').toLowerCase().includes(kw)) return false;
    if (ctx && !(t.contexts || []).includes(ctx)) return false;
    if (proj && !(t.projects || []).includes(proj)) return false;
    if (prio === 'none') {
      if (t.priority) return false;
    } else if (prio && t.priority !== prio) {
      return false;
    }
    if (overdueOnly && !(t.dueDate && today && t.dueDate < today)) return false;
    return true;
  });
}

/**
 * 选中集合的摘要。
 * @param {Array} tasks
 * @param {string} today
 * @returns {{count:number, byPriority:object, overdue:number, dueToday:number, noDue:number}}
 */
export function summarizeSelection(tasks, today) {
  const list = (tasks || []).filter(isTask);
  const byPriority = {};
  for (const t of list) {
    const key = t.priority || 'none';
    byPriority[key] = (byPriority[key] || 0) + 1;
  }
  return {
    count: list.length,
    byPriority,
    overdue: list.filter((t) => t.dueDate && today && t.dueDate < today).length,
    dueToday: list.filter((t) => t.dueDate && t.dueDate === today).length,
    noDue: list.filter((t) => !t.dueDate).length,
  };
}

/* --- 选择辅助（选中态用 id 数组表示，纯函数便于单测） --- */

/** 全选：给出这批任务的全部 id（保持输入顺序）。 */
export function selectAllIds(tasks) {
  return (tasks || []).filter(isTask).map((t) => t.id);
}

/** 反选：在这批任务里，取当前未选中的 id。 */
export function invertIds(tasks, ids) {
  const has = new Set(ids || []);
  return selectAllIds(tasks).filter((id) => !has.has(id));
}

/** 单行切换：选中则移除，未选则加入。 */
export function toggleId(ids, id) {
  const set = new Set(ids || []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}

/**
 * 这批任务里真正吃这个 op 的那些（复用 ops.applyOp 的判定，不另写一套）。
 * 例如"取消星标"对没星标的任务是空操作、"完成"对已完成任务无意义。
 */
export function applicableTasks(tasks, op, today) {
  return (tasks || []).filter((t) => Boolean(applyOp(t, op, today)));
}

/** 下一个可用优先级字母：空集合从 A 起，否则取当前最高字母的下一个。 */
export function nextPriorityAfter(tasks) {
  const used = (tasks || [])
    .filter(isTask)
    .map((t) => t.priority)
    .filter(Boolean)
    .sort();
  if (!used.length) return 'A';
  const top = used[used.length - 1].charCodeAt(0);
  if (top >= 90) return 'Z';
  return String.fromCharCode(top + 1);
}
