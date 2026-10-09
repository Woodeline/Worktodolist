// 批量操作原语（纯函数）—— 提议的**预览**与最终**落盘**必须走同一段代码。
//
// 为什么强调这一点：验收口径是"预览内容与最终落盘内容逐字段一致"。只要预览
// 自己算一遍、执行时再算一遍，两边迟早会漂移（少一个 star:、顺序换一下）。
// 所以两侧都调这里的 applyOp，再各自交给 serializeTask。
import dayjs from 'dayjs';
import { applyPatch, completeTask, serializeTask } from '../todoParser.js';

export const OPS = [
  { type: 'setPriority', label: '设置优先级', needsValue: true, valueKind: 'priority' },
  { type: 'setDue', label: '设置截止日', needsValue: true, valueKind: 'date' },
  { type: 'postpone', label: '整体延期', needsValue: true, valueKind: 'days' },
  { type: 'addContext', label: '加分类', needsValue: true, valueKind: 'context' },
  { type: 'removeContext', label: '去分类', needsValue: true, valueKind: 'context' },
  { type: 'addProject', label: '加标签', needsValue: true, valueKind: 'project' },
  { type: 'setThreshold', label: '设置阈值日期', needsValue: true, valueKind: 'date' },
  { type: 'star', label: '星标', needsValue: false },
  { type: 'unstar', label: '取消星标', needsValue: false },
  { type: 'complete', label: '标记完成', needsValue: false },
  { type: 'delete', label: '删除', needsValue: false },
];

const OP_MAP = Object.fromEntries(OPS.map((o) => [o.type, o]));

function uniq(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function shift(dateStr, days, today) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) ? dateStr : today;
  return dayjs(base).add(Number(days) || 0, 'day').format('YYYY-MM-DD');
}

/**
 * 把一次操作作用在一条任务上。
 *
 * @returns {{patch:object}|{complete:true}|{delete:true}|null}
 *   patch    → 交给 store.updateTask(id, patch)
 *   complete → 交给 store.toggleComplete(task)（会移到 done.txt）
 *   delete   → 交给 store.deleteTask(task)
 *   null     → 这条任务不适用（例如 op 不合法）
 */
export function applyOp(task, op, today) {
  if (!task || task.kind !== 'task' || !op || !OP_MAP[op.type]) return null;
  const value = op.value;
  switch (op.type) {
    case 'setPriority':
      return { patch: { priority: value || null } };
    case 'setDue':
      return { patch: { dueDate: value || null } };
    case 'postpone':
      return { patch: { dueDate: shift(task.dueDate, value, today) } };
    case 'setThreshold':
      return { patch: { thresholdDate: value || null } };
    case 'addContext':
      return value ? { patch: { contexts: uniq([...(task.contexts || []), String(value).replace(/^@/, '')]) } } : null;
    case 'removeContext': {
      const name = String(value || '').replace(/^@/, '');
      const next = (task.contexts || []).filter((c) => c !== name);
      return next.length === (task.contexts || []).length ? null : { patch: { contexts: next } };
    }
    case 'addProject':
      return value ? { patch: { projects: uniq([...(task.projects || []), String(value).replace(/^\+/, '')]) } } : null;
    case 'star':
      return task.starValue ? null : { patch: { starValue: '1' } };
    case 'unstar':
      return task.starValue ? { patch: { starValue: null } } : null;
    case 'complete':
      return task.completed ? null : { complete: true };
    case 'delete':
      return { delete: true };
    default:
      return null;
  }
}

/** 操作的中文描述（提议标题与回执文案共用）。 */
export function opLabel(op) {
  if (!op) return '批量操作';
  const meta = OP_MAP[op.type];
  if (!meta) return '批量操作';
  if (!meta.needsValue) return meta.label;
  if (op.type === 'postpone') return `延期 ${Number(op.value) >= 0 ? '+' : ''}${op.value} 天`;
  if (meta.valueKind === 'context') return `${meta.label} @${String(op.value).replace(/^@/, '')}`;
  if (meta.valueKind === 'project') return `${meta.label} +${String(op.value).replace(/^\+/, '')}`;
  if (meta.valueKind === 'priority') return `设置优先级 (${op.value})`;
  return `${meta.label} ${op.value}`;
}

/**
 * 一条任务在操作**之后**会写进文件的那一行（未确认前就能看到要写什么）。
 * @returns {string|null} null 表示这条不产生新行（删除）
 */
export function previewLine(task, op, today) {
  const result = applyOp(task, op, today);
  if (!result) return null;
  if (result.patch) return serializeTask(applyPatch(task, result.patch));
  if (result.complete) return serializeTask(completeTask(task, today));
  return null;
}
