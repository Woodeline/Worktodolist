import dayjs from 'dayjs';
import { isOverdue, PRIORITY_LABELS } from '../lib/sortFilter';
import { useContextMenu } from '../hooks/useContextMenu.jsx';
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

// 下周一（不含今天）：周末口径锁定周六，所以这里从"下一个周一"起算
function nextMonday() {
  const d = dayjs();
  const delta = (8 - d.day()) % 7 || 7;
  return d.add(delta, 'day');
}

function copyPlain(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

export default function TaskRow({ task, store, query = '', readonly = false }) {
  const today = dayjs().format('YYYY-MM-DD');
  const overdue = isOverdue(task, today);
  const fading = store.fadingIds.includes(task.id);
  const dragEnabled =
    !readonly && store.sortMode === 'manual' && store.view !== 'today' && !task.completed;

  const { openMenu } = useContextMenu();

  const handleRowClick = (e) => {
    if (readonly) return;
    if (e.target.closest('button')) return;
    store.openEditor(task.id);
  };

  const handleCheck = () => {
    if (readonly) return;
    store.toggleComplete(task);
  };

  // 右键菜单 = 这一行能做的全部操作。只读行（done.txt / 未识别行）只留复制。
  const handleContextMenu = (e) => {
    if (readonly) {
      openMenu(e, [
        { type: 'item', label: '复制任务文本', onClick: () => copyPlain(task.raw || task.title) },
      ]);
      return;
    }
    const due = task.dueDate || null;
    openMenu(e, [
      {
        type: 'item',
        label: task.completed ? '取消完成' : '标记完成',
        accel: 'Space',
        onClick: () => store.toggleComplete(task),
      },
      { type: 'item', label: '编辑…', accel: 'E', onClick: () => store.openEditor(task.id) },
      { type: 'sep' },
      {
        type: 'sub',
        label: '优先级',
        items: [
          {
            type: 'item',
            label: '无',
            checked: !task.priority,
            onClick: () => store.updateTask(task.id, { priority: null }),
          },
          ...['A', 'B', 'C'].map((p) => ({
            type: 'item',
            label: `${PRIORITY_LABELS[p]} (${p})`,
            checked: task.priority === p,
            onClick: () => store.updateTask(task.id, { priority: p }),
          })),
        ],
      },
      {
        type: 'sub',
        label: '截止日期',
        items: [
          { type: 'item', label: '今天', onClick: () => store.updateTask(task.id, { dueDate: today }) },
          {
            type: 'item',
            label: '明天',
            onClick: () => store.updateTask(task.id, { dueDate: dayjs().add(1, 'day').format('YYYY-MM-DD') }),
          },
          {
            type: 'item',
            label: '后天',
            onClick: () => store.updateTask(task.id, { dueDate: dayjs().add(2, 'day').format('YYYY-MM-DD') }),
          },
          {
            type: 'item',
            label: `下周一（${nextMonday().format('M月D日')}）`,
            onClick: () => store.updateTask(task.id, { dueDate: nextMonday().format('YYYY-MM-DD') }),
          },
          { type: 'sep' },
          {
            type: 'item',
            label: '清除日期',
            disabled: !due,
            onClick: () => store.updateTask(task.id, { dueDate: null }),
          },
        ],
      },
      {
        type: 'item',
        label: task.starValue ? '取消星标' : '加星标',
        checked: Boolean(task.starValue),
        onClick: () => store.updateTask(task.id, { starValue: task.starValue ? null : '1' }),
      },
      { type: 'sep' },
      { type: 'item', label: '复制任务文本', onClick: () => copyPlain(task.raw || task.title) },
      { type: 'sep' },
      { type: 'item', label: '删除', danger: true, onClick: () => store.deleteTask(task) },
    ]);
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
      onContextMenu={handleContextMenu}
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
