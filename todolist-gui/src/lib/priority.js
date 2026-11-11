// 优先级四档的单一真相源。
//
// 过去各组件各拼一套：任务行用 priorityClass()，快照自己拼 'p-'+letter，
// 日历 chip 又借同一个函数却把「无」落成 p-other，样式指南的手写快照甚至把
// 「无」画成「中」。档位一多，这种散拼必然漂移。这里把「字母 → 档位」收成一处，
// 组件只负责把档位渲染成形状。
//
// 值域五档：none / low / mid / high 是界面四档，other 接住 todo.txt 里
// 允许的 D~Z（解析器不拦它们，界面得有个不撒谎的显示）。
import { PRIORITY_LABELS } from './sortFilter.js';

/** 梯度顺序「无 → 低 → 中 → 高」，供陈列与选择器说明使用。 */
export const PRIORITY_STEPS = [
  { letter: null, tone: 'none', label: '无' },
  { letter: 'C', tone: 'low', label: '低' },
  { letter: 'B', tone: 'mid', label: '中' },
  { letter: 'A', tone: 'high', label: '高' },
];

export function priorityTone(priority) {
  if (!priority) return 'none';
  if (priority === 'A') return 'high';
  if (priority === 'B') return 'mid';
  if (priority === 'C') return 'low';
  return 'other';
}

/** 档位类名。所有渲染点（含日历 chip、托盘、菜单）都用这一份，别再手写 p-A。 */
export function priorityClass(priority) {
  return `prio-${priorityTone(priority)}`;
}

/** 界面读数：中文分级；自定义字母原样透出；「无」返回空串，绝不画成「中」。 */
export function priorityLabel(priority) {
  if (!priority) return '';
  return PRIORITY_LABELS[priority] || priority;
}

/** 悬停里保留文件原文记号，方便和 todo.txt 核对。 */
export function priorityTitle(priority) {
  if (!priority) return '优先级：未填 · todo.txt 不写括号字母';
  return `优先级：${priorityLabel(priority)} · todo.txt 写作 (${priority})`;
}
