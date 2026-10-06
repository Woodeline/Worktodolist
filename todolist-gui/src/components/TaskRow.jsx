import dayjs from 'dayjs';
import { isOverdue, PRIORITY_LABELS } from '../lib/sortFilter';
import Icon from './Icon.jsx';

export function Highlight({ text, query }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function dueLabel(due, today) {
  if (due < today) return `逾期 ${dayjs(due).format('M月D日')}`;
  if (due === today) return '今天到期';
  return dayjs(due).format('M月D日');
}

export function priorityClass(priority) {
  return PRIORITY_LABELS[priority] ? `p-${priority}` : 'p-other';
}

export default function TaskRow({ task, store, query = '', readonly = false }) {
  const today = dayjs().format('YYYY-MM-DD');
  const overdue = isOverdue(task, today);
  const fading = store.fadingIds.includes(task.id);
  const dragEnabled =
    !readonly && store.sortMode === 'manual' && store.view !== 'today' && !task.completed;

  const handleRowClick = (e) => {
    if (readonly) return;
    if (e.target.closest('button')) return;
    store.openEditor(task.id);
  };

  const handleCheck = () => {
    if (readonly) return;
    store.toggleComplete(task);
  };

  return (
    <div
      className={[
        'task-row',
        task.completed ? 'completed' : '',
        overdue ? 'row-overdue' : '',
        fading ? 'fading' : '',
        store.dragId === task.id ? 'dragging' : '',
        readonly ? 'row-readonly' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      tabIndex={readonly ? -1 : 0}
      onClick={handleRowClick}
      onFocus={() => {
        if (!readonly) store.setFocusedId(task.id);
      }}
      draggable={dragEnabled}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        store.setDragId(task.id);
      }}
      onDragOver={(e) => {
        if (dragEnabled && store.dragId && store.dragId !== task.id) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dragEnabled && store.dragId && store.dragId !== task.id) {
          store.reorder(store.dragId, task.id);
        }
        store.setDragId(null);
      }}
      onDragEnd={() => store.setDragId(null)}
    >
      <button
        className={`checkbox${task.completed ? ' checked' : ''}${readonly ? ' disabled' : ''}`}
        onClick={handleCheck}
        title={readonly ? '已完成（只读）' : task.completed ? '取消完成' : '完成（空格）'}
        aria-label="切换完成状态"
      />
      <span className="task-title">
        <Highlight text={task.title} query={query} />
      </span>
      {task.starValue ? (
        <span className="star" title="星标">
          <Icon name="star" size={13} fill="currentColor" />
        </span>
      ) : null}
      {task.priority ? (
        <span className={`priority ${priorityClass(task.priority)}`}>
          {PRIORITY_LABELS[task.priority] || task.priority}
        </span>
      ) : (
        // UI 展示约定：无优先级任务显示弱化的“中”，与 (A)/(B)/(C) 实心标签区分。
        <span className="priority priority-none" title="无优先级（默认显示为中）">
          中
        </span>
      )}
      {task.dueDate ? (
        <span className={`due${overdue ? ' overdue' : ''}`}>{dueLabel(task.dueDate, today)}</span>
      ) : null}
      {task.completedAt ? <span className="due">{task.completedAt} 完成</span> : null}
      {task.contexts.map((c) => (
        <span key={c} className="context">
          @{c}
        </span>
      ))}
    </div>
  );
}
