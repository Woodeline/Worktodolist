import { Fragment, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { isOverdue, PRIORITY_LABELS } from '../lib/sortFilter';
import { describeRecurrence } from '../lib/recurrence';
import { classifyRowClick } from '../lib/clickTiming.js';
import { displayTitle } from '../lib/displayTitle.js';
import { PRIORITY_STEPS } from '../lib/priority.js';
import { colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import { useContextMenu } from '../hooks/useContextMenu.jsx';
import PriorityMark from './PriorityMark.jsx';
import InlineTitleEditor from './InlineTitleEditor.jsx';
import Icon from './Icon.jsx';

// 上一次点击的行与时刻放在模块级，不能是每行一份的 useRef：那样
// 「点父项 A → 点子任务 B → 再点回 A」时 A 的 ref 仍停在 t1，第二次点 A
// 会被算成快双击、凭空打开编辑浮窗。共享一份才表达得了「上次点的是不是同一行」。
let lastRowClick = { id: null, t: 0 };

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

// 日期读数只留数字：状态（逾期）由颜色编码，不写汉字（见 index.css 的 .due）。
export function dueLabel(due) {
  return dayjs(due).format('YYYY/MM/DD');
}

// 提醒读数：rem: 的形状是 YYYY-MM-DDTHH:mm。读数行里省掉年份 —— 提醒都落在
// 近期，年份是纯噪声；完整时刻仍留在 title 里（悬停可核对）。
export function remindLabel(remindAt) {
  return dayjs(remindAt).format('MM/DD HH:mm');
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
  dragDisabled = false,
  hideDue = false,
  hasChildren = false,
  collapsed = false,
  onToggleExpand = null,
  childLast = false,
  minimal = false,
}) {
  const today = dayjs().format('YYYY-MM-DD');
  const isChild = depth > 0;
  const overdue = isOverdue(task, today);
  const fading = store.fadingIds.includes(task.id);
  // 日历的日详情也复用这一行，但那里拖拽的语义是"改期"（由日历自己接管），
  // 不是列表的手动重排 —— dragDisabled 把行级拖拽整个关掉，避免两套落点逻辑打架。
  const dragEnabled =
    !dragDisabled && !readonly && store.sortMode === 'manual' && store.view !== 'today' && !task.completed;

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

  const { openMenu, openAt } = useContextMenu();
  const rowRef = useRef(null);
  // 慢速双击 → 就在这一行里改标题。上一次点击的行与时刻只放 ref：
  // 它不参与渲染，进 state 只会让每行多点一次无谓的重绘。
  const [inlineEditing, setInlineEditing] = useState(false);
  // 优先级下拉开着的时候，行内快捷按钮要**钉住**：菜单是挂在 body 层的浮层，
  // 鼠标一旦移过去就离开了这一行，`:hover` 立刻失效、按钮当场消失 ——
  // 用户还在挑档位，"浮窗"却先跑了。关闭时（选完 / Esc / 点外面）一起收。
  const [quickPinned, setQuickPinned] = useState(false);
  // 项目色点与侧栏 / 面包屑 / 日历 chip 同一套色板：标签只写名字，
  // 靠这枚小圆点跟「分类」区分开（用户明确要求不要 @ + 字符）。
  const { colors } = useListStyle();

  // 读数行默认收起（index.css 的 .task-meta），悬停 / 键盘聚焦才展开。
  // **没有例外**：逾期行、带红旗的高优先级行、以及两者兼有的行，
  // 收放与普通行完全一致 —— 状态只改颜色和记号，不改交互行为。
  // （曾给逾期行开过常驻展开的后门，结果"有的行悬停才弹、有的一直摊着"，
  //   读起来像功能只覆盖了一半。）
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
    if (store.editingTask || inlineEditing) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  }, [selected, store.editingTask, inlineEditing]);

  // 两次点击的间隔决定动作（不再挂原生 onDoubleClick —— 那个只认系统阈值，
  // 慢一点就退化成两次独立单击；两套逻辑并存还会把同一次快双击处理两遍）：
  //   ≤300ms    常规双击 → 打开编辑浮窗（子任务行除外）
  //   300~900ms 慢速双击 → 行内编辑标题（子任务行除外）
  //   更久 / 不同行 → 只是选中
  // 展开 / 收起自 2026-11-15 起**只认右侧那枚三角箭头**，整行单击不再碰子列表 ——
  // 于是父项行拿回了和普通行完全一样的点击语义（双击进浮窗、慢双击改标题）。
  const handleRowClick = (e) => {
    if (readonly || inlineEditing || store.editingTask) return;
    if (e.target.closest('button')) return;
    const now = Date.now();
    const prev = lastRowClick;
    const decision = classifyRowClick({
      elapsedMs: now - prev.t,
      sameRow: prev.id === task.id,
    });
    lastRowClick = { id: task.id, t: now };
    store.setFocusedId(task.id);

    // 子任务行的文本只在编辑浮窗的子任务区里改；双击不该把整条父任务的
    // 编辑菜单叫出来（那里改不到子任务，只会让人白开一次）。
    const editable = !isChild;
    if (decision === 'double') {
      if (editable) store.openEditor(task.id);
      return;
    }
    if (decision === 'slow-double' && editable) setInlineEditing(true);
  };

  // 键盘版的展开 / 收起：树的通行做法（→ 展开、← 收起），只在父项行上生效。
  // 箭头按钮本身不进 Tab 序列（鼠标入口），键盘走这两下 —— 否则父项行只鼠标可展开。
  const handleRowKeyDown = (e) => {
    if (!hasChildren || readonly) return;
    if (e.key === 'ArrowRight' && collapsed) {
      e.preventDefault();
      if (onToggleExpand) onToggleExpand();
    } else if (e.key === 'ArrowLeft' && !collapsed) {
      e.preventDefault();
      if (onToggleExpand) onToggleExpand();
    }
  };

  // 行内编辑只提交标题；值没变 / 被清空就不写文件，避免一次误触产生一次落盘。
  const commitInlineTitle = (next) => {
    const title = next.trim();
    if (title && title !== task.title) store.updateTask(task.id, { title });
    setInlineEditing(false);
  };

  const handleCheck = () => {
    if (readonly) return;
    store.toggleComplete(task);
  };

  // 旗标 = 优先级的唯一记号：点它弹出「高 / 中 / 低 / 无」四色小旗。
  // 用同一个上下文菜单渲染器（键盘 ↑↓ / Enter / Esc 全部现成），不另造弹层。
  // compact = 四项短标签的专用窄版（宽度是标准菜单的一半）——
  // 标准宽度按「编辑…」「复制任务文本」这类长标签定的，四枚小旗撑那么大只会显得空。
  const openPriorityPicker = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setQuickPinned(true);
    openAt(
      r.left - 8,
      r.bottom + 4,
      [...PRIORITY_STEPS].reverse().map((step) => ({
        type: 'item',
        label: step.label,
        mark: <PriorityMark priority={step.letter} variant="flag" />,
        checked: (task.priority || null) === step.letter,
        onClick: () => store.updateTask(task.id, { priority: step.letter }),
      })),
      { variant: 'compact', onClose: () => setQuickPinned(false) }
    );
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
            mark: <PriorityMark variant="flag" />,
            checked: !task.priority,
            onClick: () => store.updateTask(task.id, { priority: null }),
          },
          ...['A', 'B', 'C'].map((p) => ({
            type: 'item',
            label: `${PRIORITY_LABELS[p]} (${p})`,
            mark: <PriorityMark priority={p} variant="flag" />,
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
            label: `下周一（${nextMonday().format('YYYY/MM/DD')}）`,
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
      { type: 'sep' },
      { type: 'item', label: '复制任务文本', onClick: () => copyPlain(task.raw || task.title) },
      { type: 'sep' },
      { type: 'item', label: '删除', danger: true, onClick: () => store.deleteTask(task) },
    ]);
  };

  /* 读数行分段（2026-11-16 十四改）：顺序固定为
       日期 · 子任务 │ 分类 │ 标签 │ 重复 │ 提醒
     段间一道 1px 竖线，段内只留 8px 间隙 —— 「同属一件事」与「换了一类信息」
     靠间距 + 竖线两级区分。**空段整段不画**（连它前面那道线一起），
     所以一条什么读数都没有的行，这一格仍然是空的（不会剩一条孤零零的竖线）。

     备注角标跟着第一段走：它是「这条后面还有字」的记号，不是一类读数，
     单独占一段会让人以为多了一种属性。 */
  const metaGroups = [];
  const stampNodes = [];
  if (!hideDue && task.dueDate) {
    // 颜色只编码状态：逾期 = 红，其余一律弱化墨色（今天不再是第二支强调色）。
    stampNodes.push(
      <span key="due" className={'due' + (overdue ? ' overdue' : '')}>
        {dueLabel(task.dueDate)}
      </span>
    );
  }
  if (task.completedAt) {
    stampNodes.push(
      <span key="done" className="due">
        {dayjs(task.completedAt).format('YYYY/MM/DD')} 完成
      </span>
    );
  }
  /* 子任务进度：父任务行才显示。它是"这一堆事做到哪了"的唯一线索 ——
     否则要展开才知道下面三条完成了两条。展开 / 收起不在这里，交给行尾那枚三角箭头。 */
  if (kids && kids.total > 0) {
    stampNodes.push(
      <span key="sub" className="sub-count" title={`${kids.done} / ${kids.total} 个子任务已完成`}>
        <Icon name="list-tree" size={12} />
        {kids.done}/{kids.total}
      </span>
    );
  }
  if (task.stableId && store.noteIds && store.noteIds.has(task.stableId)) {
    // 备注角标：只表示"这条后面还有字"。备注是要点进去看的，列表上多显示一个字都会挤压标题。
    stampNodes.push(
      <span key="note" className="note-chip" title="有备注（双击任务查看）">
        <Icon name="pencil" size={12} />
      </span>
    );
  }
  if (stampNodes.length) metaGroups.push({ key: 'stamp', nodes: stampNodes });

  // 分类：只写名字，不写 @ —— 那是 todo.txt 的写法，不是界面读数。
  if (task.contexts && task.contexts.length > 0) {
    metaGroups.push({
      key: 'ctx',
      nodes: task.contexts.map((c) => (
        <span key={`ctx-${c}`} className="meta-ctx" title={`分类：${c}`}>
          {c}
        </span>
      )),
    });
  }
  // 标签：一枚色点（与侧栏 / 面包屑 / 日历同一套色板）把两类分开，不写 +。
  if (task.projects && task.projects.length > 0) {
    metaGroups.push({
      key: 'proj',
      nodes: task.projects.map((p) => (
        <span key={`proj-${p}`} className="meta-tag" title={`标签：${p}`}>
          <i
            className="meta-dot"
            aria-hidden="true"
            style={{ background: colorHex(resolveColorId(p, colors)) }}
          />
          {p}
        </span>
      )),
    });
  }
  // 重复：以前只有一枚 ↻（规则藏在 title 里）。加了分段之后一枚孤零图标夹在
  // 两条竖线中间读不出是什么，所以把规则本身写出来 —— describeRecurrence 已经是
  // 中文短语（每周 / 每个工作日 / 每周一、周四），完整表达式仍留在 title 里。
  if (task.recurrence) {
    metaGroups.push({
      key: 'rec',
      nodes: [
        <span key="rec" className="meta-field" title={`重复：${describeRecurrence(task.recurrence)}`}>
          <Icon name="rotate-cw" size={12} />
          {describeRecurrence(task.recurrence)}
        </span>,
      ],
    });
  }
  // 提醒：rem: 是一直有数据、但列表里从来没报过的一项。
  if (task.remindAt) {
    metaGroups.push({
      key: 'rem',
      nodes: [
        <span key="rem" className="meta-field is-time" title={`提醒：${dayjs(task.remindAt).format('YYYY-MM-DD HH:mm')}`}>
          <Icon name="clock" size={12} />
          {remindLabel(task.remindAt)}
        </span>,
      ],
    });
  }

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
        childLast ? 'is-child-last' : '',
        minimal ? 'is-minimal' : '',
        quickPinned ? 'is-quick-pinned' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={rowRef}
      data-task-id={task.id}
      tabIndex={readonly ? -1 : 0}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
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
        // 子任务行不挂原生 tooltip（用户要求：鼠标悬停不弹任何提示）；
        // 无障碍标签照旧，读屏用户不受影响。
        title={isChild ? undefined : readonly ? '已完成（只读）' : checked ? '取消完成' : '完成（空格）'}
        aria-label="切换完成状态"
      />
      {/* 子任务行是**另一套版式**（2026-11-15 定稿）：单行，只放复选框 + 标题。
          读数行（日期 / 完成日 / 子任务进度 / 备注 / 重复）与优先级旗标一概不画 ——
          子任务只回答「这一小步叫什么」，多一行字、多一枚图标，抢的都是主任务的注意力。
          版式差异（缩进 / 更小的复选框 / 小一档字号 / 32px 单行）全在 CSS 里，
          与主行的「标题 + 读数行」两行结构互不共用。 */}
      {isChild ? (
        <span className="task-body child-body">
          <span className="task-title">
            <Highlight text={displayTitle(task.title)} query={query} />
          </span>
        </span>
      ) : (
        /* 两行：标题一行、读数一行（截止日 / 子任务进度 / 备注 / 重复 / 完成日）。
            读数折到标题下方以后，右侧不再有一条被日期撑开的固定宽槽，
            行高只多一行 11px 的高度 —— 由 --row-h(40) 兜住，整体节奏不变。 */
        <span className="task-body">
          <span className="task-head">
            {/* 旗标 = 优先级：标题最左边一枚中空旗，高红 / 中橙 / 低蓝，「无」不占位。 */}
            {task.priority ? <PriorityMark priority={task.priority} /> : null}
            <span className="task-title">
              {inlineEditing ? (
                <InlineTitleEditor
                  value={task.title}
                  onCommit={commitInlineTitle}
                  onCancel={() => setInlineEditing(false)}
                />
              ) : (
                <Highlight text={displayTitle(task.title)} query={query} />
              )}
            </span>
          </span>
          {/* 读数行只在真有东西时出现；全空的行走「一行的行」也不会多出一截空白。
              默认收起、悬停展开 —— 收放只发生在这一格（见 index.css 的 .task-meta），
              行外框不动，所以下面的行不会被顶着走。
              分段顺序与竖线见上面 metaGroups 的构造注释。
              minimal（日历弹出框）：整行只留"哪件事"，日期 / 分类 / 标签 / 重复 /
              提醒一概不画 —— 这一行的日期就是它所在的那一天，再报一次是噪声。 */}
          {minimal ? null : (
            <span className="task-meta">
              {metaGroups.map((group, i) => (
                <Fragment key={group.key}>
                  {i > 0 ? <span className="meta-sep" aria-hidden="true" /> : null}
                  {group.nodes}
                </Fragment>
              ))}
            </span>
          )}
        </span>
      )}

      {/* 展开 / 收起：**只由这枚三角箭头控制**（整行单击不再碰子列表）。
          它独占网格第三列，行内快捷按钮在悬停时浮在它左边 —— 两者永远不重叠。
          今天视图没有折叠能力，那两处不传 hasChildren，这一列就空着。 */}
      {hasChildren ? (
        <button
          type="button"
          className={'row-expand' + (collapsed ? '' : ' is-open')}
          tabIndex={-1}
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开子任务' : '收起子任务'}
          title={collapsed ? '展开子任务' : '收起子任务'}
          onClick={() => onToggleExpand && onToggleExpand()}
        >
          <Icon name="chevron-down" size={16} />
        </button>
      ) : null}

      {/* 行内快捷按钮：**只在鼠标悬停在某一行时浮出**（2026-11-15 起不再跟着
          键盘焦点显示 —— 用 ↑↓ 扫列表时右侧一团按钮一直闪，比没有更难用）。
          键盘用户不走这条路（快捷键 + 右键菜单已全覆盖），所以不进 Tab 序列。
          第一枚旗标打开的是优先级四色下拉（旗标 = 优先级）。
          **子任务行不渲染它**：子任务悬停不弹任何东西（浮层会让本来就短的一行
          显得更碎），要改就走双击主任务进浮窗的子任务区，或右键菜单。
          **日历弹出框里也不渲染**（minimal）：那里是一块贴着格子的临时清单，
          鼠标划过就浮一排按钮会盖住相邻行、还会把浮层读成"另一个界面"。 */}
      {!readonly && !isChild && !minimal && (
        <span className="row-quick" role="group" aria-label="快捷操作">
          <button
            type="button"
            className="row-quick-btn"
            tabIndex={-1}
            title="编辑（双击任务也行）"
            aria-label="编辑任务"
            onClick={() => store.openEditor(task.id)}
          >
            <Icon name="pencil" size={16} />
          </button>
          <button
            type="button"
            className="row-quick-btn"
            tabIndex={-1}
            title="设置优先级"
            aria-label="设置优先级"
            aria-haspopup="menu"
            onClick={openPriorityPicker}
          >
            <Icon name="flag" size={16} />
          </button>
          <button
            type="button"
            className="row-quick-btn"
            tabIndex={-1}
            title="到期日设为今天"
            aria-label="到期日设为今天"
            onClick={() => store.updateTask(task.id, { dueDate: today })}
          >
            <Icon name="calendar" size={16} />
          </button>
          <button
            type="button"
            className="row-quick-btn row-quick-del"
            tabIndex={-1}
            title="删除"
            aria-label="删除任务"
            onClick={() => store.deleteTask(task)}
          >
            <Icon name="trash" size={16} />
          </button>
        </span>
      )}
    </div>
  );
}
