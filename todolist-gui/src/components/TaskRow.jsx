import { useEffect, useRef } from 'react';
import dayjs from 'dayjs';
import { isOverdue, PRIORITY_LABELS } from '../lib/sortFilter';
import { describeRecurrence } from '../lib/recurrence';
import { useContextMenu } from '../hooks/useContextMenu.jsx';
import Icon from './Icon.jsx';

export function Highlight({ text, query }) {
  if (!query) return <>{text}</>;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q || !t.includes(q)) return <>{text}</>;
  // 所有命中都高亮，不只第一处 —— 扫列表时「明明匹配了却看不出在哪」比不高亮更烦。
  const parts = [];
  let cursor = 0;
  for (;;) {
    const idx = t.indexOf(q, cursor);
    if (idx === -1) {
      if (cursor < text.length) parts.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(<mark key={idx}>{text.slice(idx, idx + q.length)}</mark>);
    cursor = idx + q.length;
  }
  return <>{parts}</>;
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

  // 退场窗口内的行：数据还没提交，但界面要提前「演」出结果 ——
  // 复选框按已勾上预览（否则点了勾选 180ms 内没有任何反馈）、标题划线扫过。
  const completing = fading && !task.completed;
  const checked = task.completed || completing;
  // 行级高亮：重复任务的「下一次」/ 刚添加的新任务（纯 UI 状态，到期自动收回）。
  const spawned = (store.spawnedIds || []).includes(task.id);
  const entering = (store.enteringIds || []).includes(task.id);
  // 拖拽落点预告：这条行是不是当前插入点、插在前缘还是后缘。
  const drop = store.dropInfo || null;
  const dropBefore = drop && drop.id === task.id && !drop.after;
  const dropAfter = drop && drop.id === task.id && drop.after;
  // 鼠标落在行的上半 = 插到这条前面，下半 = 后面。dragover 与 drop 共用
  // 同一个判断，保证「预览的线」和「真正的落点」不会各说各话。
  const dropAfterIn = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY > rect.top + rect.height / 2;
  };

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
    // 编辑浮窗开着的时候不抢焦点：autoFocus 刚把焦点放进浮窗的输入框，
    // 这里一抢（双击开浮窗时 selected 与浮窗挂载是同一次提交，本 effect
    // 恰好跑在 autoFocus 之后），浮窗里的打字 / 回车 / Esc 全部失灵 ——
    // 事件目标跑到背后的行上，而浮窗的 onKeyDown 在浮窗内部，根本收不到。
    if (store.editingTask) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  }, [selected, store.editingTask]);

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
        completing ? 'completing' : '',
        spawned ? 'spawned' : '',
        entering ? 'entering' : '',
        dropBefore ? 'drop-before' : '',
        dropAfter ? 'drop-after' : '',
        store.dragId === task.id ? 'dragging' : '',
        selected ? 'selected' : '',
        readonly ? 'row-readonly' : '',
        isChild ? 'is-child' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={rowRef}
      data-task-id={task.id}
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
        if (dragEnabled && store.dragId && store.dragId !== task.id) {
          e.preventDefault();
          // 落点预告：鼠标在行的下半就算「插到这条后面」，上半算「前面」。
          store.setDropInfo({ id: task.id, after: dropAfterIn(e) });
        }
      }}
      onDragLeave={(e) => {
        // 离开这条行就收回它的指示线；进入下一条时，下一条的 dragover 会画新的。
        // 移进行内子元素不算离开（relatedTarget 还在行内）。
        if (e.currentTarget.contains(e.relatedTarget)) return;
        if (drop && drop.id === task.id) store.setDropInfo(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dragEnabled && store.dragId && store.dragId !== task.id) {
          // 落点以 drop 时现算的为准：dragover 可能因快速拖动丢帧，预览可以旧，落点不能旧。
          store.reorder(store.dragId, task.id, { after: dropAfterIn(e) });
        }
        store.setDragId(null);
        store.setDropInfo(null);
      }}
      onDragEnd={() => {
        store.setDragId(null);
        store.setDropInfo(null);
      }}
    >
      <button
        className={`checkbox${checked ? ' checked' : ''}${readonly ? ' disabled' : ''}`}
        onClick={handleCheck}
        title={readonly ? '已完成（只读）' : checked ? '取消完成' : '完成（空格）'}
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
          // 备注角标：只表示“这条后面还有字”。备注是要点进去看的，
          // 列表上多显示一个字都会挤压标题和日期。
          <span className="note-chip" title="有备注（双击任务查看）">
            <Icon name="pencil" size={12} />
          </span>
        ) : null}
        {task.recurrence ? (
          // 重复标记：一个 ↻ 就够，完整规则（"每周一、周四"）放在 title 里悬停看。
          // 列表是用来扫的，不是用来读的 —— 这里多一个字都会挤压日期的位置。
          <span className="rec-chip" title={`重复：${describeRecurrence(task.recurrence)}`}>
            <Icon name="rotate-cw" size={12} />
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

      {/* 行内快捷按钮：hover 时才浮出，盖在元信息簇上方。
          优先级 / 日期 / 星标 / 删除全在右键菜单里，鼠标用户却很难发现 ——
          这三个按钮把最高频的三个动作提到台面上。键盘用户不走这条路
          （快捷键 + 右键菜单已全覆盖），所以不进 Tab 序列，不给 Tab 流添堵。 */}
      {!readonly && (
        <span className="row-quick" role="group" aria-label="快捷操作">
          <button
            type="button"
            className="row-quick-btn"
            tabIndex={-1}
            title={task.starValue ? '取消星标' : '加星标'}
            aria-label={task.starValue ? '取消星标' : '加星标'}
            onClick={() => store.updateTask(task.id, { starValue: task.starValue ? null : '1' })}
          >
            <Icon name="star" size={13} fill={task.starValue ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="row-quick-btn"
            tabIndex={-1}
            title="到期日设为今天"
            aria-label="到期日设为今天"
            onClick={() => store.updateTask(task.id, { dueDate: today })}
          >
            <Icon name="calendar" size={13} />
          </button>
          <button
            type="button"
            className="row-quick-btn row-quick-del"
            tabIndex={-1}
            title="删除"
            aria-label="删除任务"
            onClick={() => store.deleteTask(task)}
          >
            <Icon name="trash" size={13} />
          </button>
        </span>
      )}
    </div>
  );
}
