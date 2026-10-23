import { useEffect, useRef } from 'react';
import dayjs from 'dayjs';
import { isOverdue, PRIORITY_LABELS } from '../lib/sortFilter';
import { describeRecurrence } from '../lib/recurrence';
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

export default function TaskRow({
  task,
  store,
  query = '',
  readonly = false,
  depth = 0,
  kids = null,
}) {
  const today = dayjs().format('YYYY-MM-DD');
  const isChild = depth > 0;
  const overdue = isOverdue(task, today);
  const fading = store.fadingIds.includes(task.id);
  const dragEnabled =
    !readonly && store.sortMode === 'manual' && store.view !== 'today' && !task.completed;

  const { openMenu } = useContextMenu();
  const rowRef = useRef(null);

  const selected = !readonly && store.focusedId === task.id;

  // 选中态的"反馈"：键盘上下移动（或单击选中）后，把该行滚进可视区并接管焦点，
  // 让光标跟着选中块走 —— 否则焦点会留在旧行上，选中块与光标各指一处。
  useEffect(() => {
    if (!selected) return;
    const el = rowRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  }, [selected]);

  // 单击 = 选中（沿用 focusedId，供空格/ e / 右键等键盘与菜单操作定位）；
  // 双击才进入编辑 —— 避免误点一下就弹出编辑浮窗。
  const handleRowClick = (e) => {
    if (readonly) return;
    if (e.target.closest('button')) return;
    store.setFocusedId(task.id);
  };

  const handleRowDoubleClick = (e) => {
    if (readonly) return;
    if (e.target.closest('button')) return;
    store.setFocusedId(task.id);
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
        selected ? 'selected' : '',
        readonly ? 'row-readonly' : '',
        isChild ? 'is-child' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={rowRef}
      tabIndex={readonly ? -1 : 0}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
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
      {/* 元信息收进一个右对齐的簇：优先级与截止日各占固定宽度，
          于是整列右边缘是一条直线 —— 扫列表时不用逐行找日期在哪。 */}
      <span className="task-meta">
        {/* 子任务进度：父任务行才显示。它是"这一堆事做到哪了"的唯一线索 ——
            否则要展开才知道下面三条完成了两条。 */}
        {kids && kids.total > 0 ? (
          <span className="sub-count" title={`${kids.done} / ${kids.total} 个子任务已完成`}>
            {kids.done}/{kids.total}
          </span>
        ) : null}
        {task.contexts.map((c) => (
          <span key={c} className="context">
            @{c}
          </span>
        ))}
        {task.stableId && store.noteIds && store.noteIds.has(task.stableId) ? (
          // 备注角标：只表示"这条后面还有字"。备注是要点进去看的，
          // 列表上多显示一个字都会挤压标题和日期。
          <span className="note-chip" title="有备注（双击任务查看）">
            ✎
          </span>
        ) : null}
        {task.recurrence ? (
          // 重复标记：一个 ↻ 就够，完整规则（"每周一、周四"）放在 title 里悬停看。
          // 列表是用来扫的，不是用来读的 —— 这里多一个字都会挤压日期的位置。
          <span className="rec-chip" title={`重复：${describeRecurrence(task.recurrence)}`}>
            ↻
          </span>
        ) : null}
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
        {task.completedAt ? <span className="due">{task.completedAt} 完成</span> : null}
        {task.dueDate ? (
          // 今天到期 / 逾期各带一层浅底：这两种状态需要在扫视时"跳出来"，
          // 而一行里只允许一处强色，所以底色只给这两个状态。
          <span className="due">
            <span
              className={
                'due-chip' + (overdue ? ' overdue' : task.dueDate === today ? ' now' : '')
              }
            >
              {dueLabel(task.dueDate, today)}
            </span>
          </span>
        ) : null}
      </span>
    </div>
  );
}
