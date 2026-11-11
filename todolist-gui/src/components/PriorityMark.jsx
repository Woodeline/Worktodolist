// 优先级四档的唯一渲染口。
//
// 两种形态共用同一组档位类名：
//   badge —— 任务行 / 对话快照，带中文读数（高 / 中 / 低）；
//   mark  —— 日历 chip、无日期托盘、快速添加 chip、选择器、右键菜单，
//            只保留形状，不重复中文（那些位置要么太窄，要么已经有文字）。
//
// 「无」始终是空的虚线框：它表示「没填」，不是第四种等级的值。
// 颜色一律中性 —— 逾期才是整行唯一的强色，accent 只给选中 / 今天到期 / 焦点。
import { priorityClass, priorityLabel, priorityTitle } from '../lib/priority.js';

export default function PriorityMark({ priority, variant = 'badge', className = '' }) {
  const tone = priorityClass(priority);
  const cls = `${variant === 'mark' ? 'prio-mark' : 'prio-badge'} ${tone}${className ? ' ' + className : ''}`;

  if (variant === 'mark') {
    return <i className={cls} aria-hidden="true" />;
  }

  return (
    <span
      className={cls}
      aria-hidden={priority ? undefined : true}
      title={priorityTitle(priority)}
    >
      {priorityLabel(priority)}
    </span>
  );
}
