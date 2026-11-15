// 优先级的唯一渲染口。
//
//   badge —— 列表行的旗标：标题最左边一枚**中空旗**，颜色就是档位
//            （高红 / 中橙 / 低蓝；「无」列表里整枚不画 —— 由调用点决定要不要渲染）。
//            D~Z 这类自定义字母给中性墨色，不撒谎。
//   flag  —— 菜单 / 选择器里的同款小旗：不带 title / aria，外面那行文字已经说清楚了。
//   mark  —— 日历 chip、无日期托盘、写入行、右键菜单：紧凑形状记号
//            （这些位置太窄或已经有文字，保持原来的小方块）。
//
// 档位类名取 lib/priority.js 的 priorityClass()，组件只负责画。
import Icon from './Icon.jsx';
import { priorityClass, priorityTitle } from '../lib/priority.js';

export default function PriorityMark({ priority, variant = 'badge' }) {
  const tone = priorityClass(priority);

  if (variant === 'mark') {
    return <i className={`prio-mark ${tone}`} aria-hidden="true" />;
  }

  // 菜单里的小旗是「这一档长什么样」的样张，不带第二层提示。
  if (variant === 'flag') {
    return (
      <span className={`prio-badge ${tone}`} aria-hidden="true">
        <Icon name="flag" size={14} />
      </span>
    );
  }

  return (
    <span
      className={`prio-badge ${tone}`}
      role="img"
      title={priorityTitle(priority)}
      aria-label={priorityTitle(priority)}
    >
      <Icon name="flag" size={14} />
    </span>
  );
}
