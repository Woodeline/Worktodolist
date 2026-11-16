// 日历视图：清单的第二种显示模式（不是第四个页签）。
// 与列表共用 store 的动作，但**取数不跟侧栏视图走**（见 lib/calendar.js#calendarSource）：
// 日历是"按日期看全盘"的镜头，切了分类也还是这一天真实存在的事。
//
// 交互契约（2026-11-16 十五改）：
//   · 页面上只有日历本体：没有顶部添加框、右侧日详情、无日期托盘。
//   · 任务只在**自己那一天**出现（格内 chip，最多 3 条 + 「+N」）。
//     chip 只有标题 + 优先级底色（高红 / 中橙 / 低蓝 / 无灰），色点不画；
//     左缘那条墨条取该档的深色（.cal-chip::before + --chip-bar），同一条 chip 只一档色。
//     chip 可拖：按住拖到别的格子 = 改 due（复用 lib/calendar.js#dropReschedule）。
//   · 点日期格 = 弹「当天任务」浮层（components/CalendarDayPopover.jsx）。
//     浮层可以**同时开多块**：置顶的不再被"点外面 / 翻月 / 切选中日"收掉。
//   · 点邻月的灰格 = 先翻到那个月，再在新格子上把浮层开出来（锚点必须重算）。
//   · 方向键 ←→ ±1 天、↑↓ ±1 周（全局快捷键）、PageUp/Down ±1 月、Home 回今天；
//     Enter / 空格 = 打开这一天的浮层。
//   · 已完成视图按完成日期锚定，整体只读：浮层里没有添加入口，chip 也不可拖。
import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { displayTitle } from '../lib/displayTitle.js';
import {
  WEEKDAY_LABELS,
  monthGrid,
  monthKey,
  monthTitle,
  dayTitle,
  calendarKeyAction,
  dropReschedule,
} from '../lib/calendar.js';
import CalendarDayPopover from './CalendarDayPopover.jsx';
import { priorityClass } from '../lib/priority.js';
import Icon from './Icon.jsx';

const MAX_CHIPS = 3;

export default function CalendarView({
  store,
  query = '',
  projection,
  day,
  month,
  onPickDay,
  onNavMonth,
  onToday,
  addSignal = null,
}) {
  const today = dayjs().format('YYYY-MM-DD');
  const cells = useMemo(() => monthGrid(month), [month]);
  const gridRef = useRef(null);
  // 翻月 / 回今天会换掉整批格子，旧格子被卸载后焦点掉到 body，
  // 「焦点还在网格里」就判不出来了。键盘导航先打个标，渲染完把焦点补到新选中日。
  const refocusRef = useRef(false);
  // 当天任务浮层：可以有多块（置顶的留着，未置顶的同时只留一块）。
  // 刻意留在组件内、不进 store —— 它是"看一眼这一天"的临时视图，不是持久状态。
  //   { date, anchor, forceAdd, pinned }
  const [pops, setPops] = useState([]);
  const popsRef = useRef(pops);
  popsRef.current = pops;
  const lastAddSeq = useRef(0);
  // 点邻月灰格 = 先翻月：那批格子会被整体换掉，锚点量了也会错位。
  // 记下「翻完月要开这一天」，交给下面的 month effect 在新格子上重新量。
  const pendingPopRef = useRef(null);
  // 拖动中的 chip：{ id, from }。与列表的行重排（store.dragId）分开记，
  // 两套拖拽互不干扰 —— 日历里拖动的是"日期"，列表里拖动的是"次序"。
  const [dragChip, setDragChip] = useState(null);
  // 拖动经过的格子：只用来画落点框，松手 / 取消就清掉。
  const [dropDate, setDropDate] = useState(null);

  const { byDate, readonly, stats } = projection;
  const tasksById = useMemo(() => {
    const map = new Map();
    for (const t of projection.tasks) map.set(t.id, t);
    return map;
  }, [projection.tasks]);

  const closePops = (predicate) =>
    setPops((list) => {
      const next = list.filter(predicate);
      return next.length === list.length ? list : next;
    });
  // 未置顶的浮层：点外面 / 翻月 / 切选中日都会收掉；置顶的不动。
  const keepPinned = (p) => p.pinned;

  // 焦点跟着选中日期走：键盘移动后 DOM 焦点必须落到新的格子上，
  // 否则下一次按键还从旧格子起算。鼠标点在导航按钮上时不抢焦点。
  useEffect(() => {
    const grid = gridRef.current;
    const el = grid && grid.querySelector(`[data-date="${day}"]`);
    const wanted = refocusRef.current;
    refocusRef.current = false;
    if (!el) return;
    if (wanted || (grid.contains(document.activeElement) && document.activeElement !== el)) {
      el.focus({ preventScroll: true });
    }
  }, [day]);

  // 翻月 / 回今天：格子整体换掉，锚点跟着失效 —— 收起未置顶的浮层。
  // 置顶的留着（位置在置顶那一刻就冻结成屏幕坐标，跟格子无关了）。
  // 唯一的例外是「点邻月灰格」：那次翻月是用户明确要看那一天，
  // 等新格子挂好了再在新格子上重新量一次、把浮层开出来。
  useEffect(() => {
    const pending = pendingPopRef.current;
    pendingPopRef.current = null;
    closePops(keepPinned);
    if (!pending || monthKey(pending.date) !== month) return;
    const grid = gridRef.current;
    const el = grid && grid.querySelector(`[data-date="${pending.date}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPops((list) => [
      ...list.filter(keepPinned),
      {
        date: pending.date,
        forceAdd: pending.forceAdd,
        pinned: false,
        anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width },
      },
    ]);
    // closePops / setPops 都是稳定引用（一个读 state、一个是 setter）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // 选中日被键盘移走（←→ / ↑↓ / Home）：未置顶的浮层跟着关 ——
  // 它们贴的就是"当前这一天"。置顶的是自由窗口，跟选中日无关。
  useEffect(() => {
    closePops((p) => p.pinned || p.date === day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  // 三个"收浮层"的入口集中在这里，浮层自己不再各挂一份监听：
  //   · 点外面 → 只收未置顶的；
  //   · Esc → 只收最上面那一块（编辑浮窗开着时让给它）；
  //   · 窗口尺寸变化 → 锚点失效，未置顶的收起来；置顶的位置已冻结，留着。
  // 滚动**不再一律关掉**：2026-11-16 修的是"在浮层里滚一下它就没了" ——
  // 浮层内部滚轮 / 拖右侧滚动条的事件 target 也在 window 的捕获路径上，
  // 旧版一刀切关掉，Windows 上尤其容易把拖滚动条当成"滚了页面"。
  useEffect(() => {
    const inPop = (target) => !!(target && target.closest && target.closest('.cal-pop'));
    const onDown = (e) => {
      if (inPop(e.target)) return;
      closePops(keepPinned);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (store.editingTask) return; // 编辑浮窗的 Esc 归它自己
      const list = popsRef.current;
      if (!list.length) return;
      // 捕获阶段截断：浮层的 Esc 只收浮层，别顺手清掉搜索词 / 选中行。
      e.stopPropagation();
      setPops(list.slice(0, -1));
    };
    const onScroll = (e) => {
      if (inPop(e.target)) return; // 浮层里滚动 / 拖滚动条：什么都不做
      closePops(keepPinned);
    };
    const onResize = () => closePops(keepPinned);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.editingTask]);

  const focusCell = (date) => {
    const grid = gridRef.current;
    const el = grid && date && grid.querySelector(`[data-date="${date}"]`);
    if (el) el.focus({ preventScroll: true });
  };

  // 关浮层时把焦点还给格子 —— 只在焦点本来就在浮层里时还，
  // 否则会把用户刚点到的别处（导航、搜索框）抢回来。
  const closePop = (date) => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const fromPop = !!(active && active.closest && active.closest('.cal-pop'));
    setPops((list) => list.filter((p) => p.date !== date));
    if (fromPop) focusCell(date);
  };

  const togglePin = (date) =>
    setPops((list) =>
      list.map((p) => (p.date === date ? { ...p, pinned: !p.pinned } : p))
    );

  // 关掉浮层的锚点：置顶的浮层被拖过之后位置是屏幕坐标，再点同一天时
  // 应该把那块提到最前，而不是在旁边再叠一块一模一样的。
  const raise = (date) =>
    setPops((list) => {
      const idx = list.findIndex((p) => p.date === date);
      if (idx === -1 || idx === list.length - 1) return list;
      const next = [...list];
      const [item] = next.splice(idx, 1);
      next.push(item);
      return next;
    });

  const openDay = (date, forceAdd = false) => {
    const grid = gridRef.current;
    const el = grid && grid.querySelector(`[data-date="${date}"]`);
    if (!el) return;
    // 邻月的灰格：点它先翻到那个月。锚点得按翻月后新格子的位置量，
    // 所以在 month effect 里补开浮层（见上），这里只记账。
    if (el.classList.contains('out-month')) {
      pendingPopRef.current = { date, forceAdd };
      onPickDay(date);
      return;
    }
    const r = el.getBoundingClientRect();
    onPickDay(date);
    const anchor = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width };
    setPops((list) => {
      const exists = list.find((p) => p.date === date);
      if (exists) {
        // 已经开着：提到最前；「新建」信号顺带把它推进添加态。
        const rest = list.filter((p) => p.date !== date);
        return [...rest, { ...exists, forceAdd: exists.forceAdd || forceAdd }];
      }
      // 新开一块：未置顶的先收掉（同一时刻只留一块"跟着走"的），置顶的留着。
      return [...list.filter(keepPinned), { date, forceAdd, pinned: false, anchor }];
    });
  };

  // 「新建任务」（n 键 / 列表右键菜单 / 应用菜单）在日历里的落点：
  // 打开选中日的浮层并直接进添加态，不再往顶部快录框里塞 due:。
  useEffect(() => {
    if (!addSignal || addSignal.seq === lastAddSeq.current) return;
    lastAddSeq.current = addSignal.seq;
    openDay(addSignal.date, true);
    // openDay 只读 ref 与 setState，引用稳定；这里按 seq 触发一次即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);

  const handleCellKey = (e, cell) => {
    const action = calendarKeyAction(e.key, cell.date);
    if (!action) return; // 不归日历管的键照旧冒泡给全局快捷键（↑↓ / Esc / e 等）
    e.preventDefault();
    switch (action.type) {
      case 'day':
      case 'select':
        openDay(action.date);
        break;
      case 'month':
        refocusRef.current = true;
        onNavMonth(action.delta);
        break;
      case 'today':
        refocusRef.current = true;
        onToday();
        break;
      case 'create':
        // 格子是 button：回车在日历里等于「打开这一天」，只读态没有入口但按键要吃下。
        if (!readonly) openDay(action.date);
        break;
      default:
        break;
    }
  };

  // chip 的状态类：只剩「逾期」与「已完成（只读）」两支。
  // 「今天」不再给 chip 自己的类 —— 今天由格子里那枚实心日号说清楚了，
  // chip 上再叠一层状态色只会跟优先级底色打架（旧 .now 之所以删掉）。
  const chipState = (task) => {
    if (readonly) return ' cal-done';
    if (task.dueDate && task.dueDate < today) return ' overdue';
    return '';
  };

  const onChipDragStart = (e, task) => {
    if (readonly) return;
    setDragChip({ id: task.id, from: task.dueDate });
    // 拖动影像与拖放内容：文本给"拖到浏览器外面"一个合理结果，日历内部只认 id。
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.raw || task.title);
  };

  const onChipDragEnd = () => {
    setDragChip(null);
    setDropDate(null);
  };

  const onCellDragOver = (e, date) => {
    if (!dragChip || readonly) return;
    // 只有 preventDefault 才会被判成"可放下"，否则 drop 根本不触发。
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropDate !== date) setDropDate(date);
  };

  const onCellDrop = (e, date) => {
    if (!dragChip || readonly) return;
    e.preventDefault();
    const patch = dropReschedule(tasksById.get(dragChip.id), date);
    if (patch) store.updateTask(dragChip.id, patch);
    setDragChip(null);
    setDropDate(null);
  };

  // chip = 「这一天有这件事」的读数：只剩标题，底色就是优先级。
  // 可拖（改期），但**不挂点击**：点它等于点这一格（弹当天浮层），
  // 两者共用同一个动作，所以在 chip 上再多一层 onClick 没有新语义。
  const renderChip = (task) => (
    <span
      key={task.id}
      className={
        'cal-chip ' +
        priorityClass(task.priority) +
        chipState(task) +
        (dragChip && dragChip.id === task.id ? ' is-dragging' : '')
      }
      title={task.title}
      draggable={!readonly}
      onDragStart={(e) => onChipDragStart(e, task)}
      onDragEnd={onChipDragEnd}
    >
      <span className="cal-chip-text">{displayTitle(task.title)}</span>
    </span>
  );

  const dayNumLabel = (cell) =>
    cell.day === 1 ? `${Number(cell.date.slice(5, 7))}月1日` : String(cell.day);

  const openDates = new Set(pops.map((p) => p.date));

  return (
    <div className="calendar">
      <div className="cal-head">
        <div className="cal-nav">
          <button
            type="button"
            className="ctx-btn ctx-btn-icon"
            onClick={() => onNavMonth(-1)}
            title="上一月 · PageUp"
            aria-label="上一月"
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <b className="cal-month">{monthTitle(month)}</b>
          <button
            type="button"
            className="ctx-btn ctx-btn-icon"
            onClick={() => onNavMonth(1)}
            title="下一月 · PageDown"
            aria-label="下一月"
          >
            <Icon name="chevron-right" size={16} />
          </button>
          <button type="button" className="ctx-btn" onClick={onToday} title="回到今天 · Home">
            今天
          </button>
        </div>
        <span className="spacer" />
        <div className="cal-stats">
          <span>
            {readonly ? '本月完成' : '本月到期'} <b>{stats.inMonth}</b>
          </span>
          {stats.overdue > 0 && (
            <span className="cal-stats-overdue">
              逾期 <b>{stats.overdue}</b>
            </span>
          )}
          {readonly && <span className="cal-stats-ro">只读</span>}
        </div>
      </div>

      <div className="cal-body">
        <div className="cal-grid-wrap">
          <div className="cal-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((w, i) => (
              <span key={w} className={'cal-wd' + (i >= 5 ? ' weekend' : '')}>
                {w}
              </span>
            ))}
          </div>
          <div
            className={'cal-grid' + (dragChip ? ' is-dragging' : '')}
            ref={gridRef}
            aria-label={`${monthTitle(month)}任务日历`}
          >
            {cells.map((cell, i) => {
              const list = byDate.get(cell.date) || [];
              const shown = list.slice(0, MAX_CHIPS);
              const extra = list.length - shown.length;
              const cls = [
                'cal-cell',
                cell.inMonth ? 'in-month' : 'out-month',
                cell.weekend ? 'is-weekend' : '',
                cell.date === today ? 'is-today' : '',
                cell.date === day ? 'is-selected' : '',
                openDates.has(cell.date) ? 'is-open' : '',
                dropDate === cell.date ? 'is-drop' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={cls}
                  style={{ gridRow: Math.floor(i / 7) + 1, gridColumn: (i % 7) + 1 }}
                  data-date={cell.date}
                  tabIndex={cell.date === day ? 0 : -1}
                  aria-pressed={cell.date === day}
                  aria-current={cell.date === today ? 'date' : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={openDates.has(cell.date)}
                  aria-label={`${dayTitle(cell.date, today)}，${list.length ? `${list.length} 项任务` : '无任务'}`}
                  onClick={() => openDay(cell.date)}
                  onKeyDown={(e) => handleCellKey(e, cell)}
                  onDragOver={(e) => onCellDragOver(e, cell.date)}
                  onDragLeave={() => {
                    if (dropDate === cell.date) setDropDate(null);
                  }}
                  onDrop={(e) => onCellDrop(e, cell.date)}
                  onFocus={() => {
                    // 焦点进网格 = 离开任务行：清掉行选中，
                    // 全局的空格 / e / 回车才不会隔着网格误伤浮层里的行。
                    if (!readonly && store.focusedId) store.setFocusedId(null);
                  }}
                >
                  <span className="cal-daynum">{dayNumLabel(cell)}</span>
                  <span className="cal-chips">
                    {shown.map((t) => renderChip(t))}
                    {extra > 0 && <span className="cal-more">+{extra}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {pops.map((p, i) => (
        <CalendarDayPopover
          // key：同一天关掉再开要回到初始态（添加态 / 输入框 / 焦点）。
          key={p.date}
          date={p.date}
          tasks={byDate.get(p.date) || []}
          readonly={readonly}
          store={store}
          query={query}
          anchor={p.anchor}
          forceAdd={p.forceAdd}
          pinned={p.pinned}
          depth={i}
          onTogglePin={() => togglePin(p.date)}
          onRaise={() => raise(p.date)}
          onClose={() => closePop(p.date)}
        />
      ))}
    </div>
  );
}
