// 日历视图：清单的第二种显示模式（不是第四个页签）。
// 与列表共用侧栏过滤 / 搜索 / store 动作，只是把"按行排"换成"按日期摊开"。
// 投影逻辑全在 lib/calendar.js（纯函数、已单测）；这里只管渲染与交互。
//
// 交互契约（2026-11-15 改版，参考 Tasks 的日历，刻意简化）：
//   · 页面上只有日历本体：不再有顶部添加框、右侧日详情、无日期托盘。
//   · 任务只在**自己那一天**出现（格内 chip，最多 3 条 + 「+N」）。
//     没有跨日区间条，也没有拖拽改期 —— 任务不跨格显示，也不靠拖改变日期。
//   · 点任意日期格 = 弹「当天任务」浮层（components/CalendarDayPopover.jsx）：
//     有任务看列表 + 底部「添加任务」，没任务直接进添加态。
//   · 点邻月的灰格 = 先翻到那个月，再在新格子上把浮层开出来（锚点必须重算，
//     否则会浮在旧格子腾出来的空位上）。
//   · 方向键 ←→ ±1 天、↑↓ ±1 周（全局快捷键）、PageUp/Down ±1 月、Home 回今天；
//     Enter / 空格 = 打开这一天的浮层。
//   · 已完成视图按完成日期锚定，整体只读：浮层里没有添加入口。
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
} from '../lib/calendar.js';
import { colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import CalendarDayPopover from './CalendarDayPopover.jsx';
import { priorityClass } from '../lib/priority.js';
import Icon from './Icon.jsx';

const MAX_CHIPS = 3;

// 任务所属项目的颜色点：与侧栏 / 面包屑同一套色板，日历里也认得出"这是哪个列表的事"。
function useProjectDot() {
  const { colors } = useListStyle();
  return (task) => {
    const proj = task.projects && task.projects[0];
    return proj ? colorHex(resolveColorId(proj, colors)) : null;
  };
}

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
  const projectDot = useProjectDot();
  const cells = useMemo(() => monthGrid(month), [month]);
  const gridRef = useRef(null);
  // 翻月 / 回今天会换掉整批格子，旧格子被卸载后焦点掉到 body，
  // 「焦点还在网格里」就判不出来了。键盘导航先打个标，渲染完把焦点补到新选中日。
  const refocusRef = useRef(false);
  // 当天任务浮层：{ date, anchor, forceAdd } | null。
  // 刻意留在组件内、不进 store —— 它是"看一眼这一天"的临时视图，不是持久状态。
  const [pop, setPop] = useState(null);
  const popDate = pop ? pop.date : null;
  const lastAddSeq = useRef(0);
  // 点邻月灰格 = 先翻月：那批格子会被整体换掉，锚点量了也会错位。
  // 记下「翻完月要开这一天」，交给下面的 month effect 在新格子上重新量。
  const pendingPopRef = useRef(null);

  const { byDate, readonly, stats } = projection;

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

  // 翻月 / 回今天：格子整体换掉，锚点跟着失效 —— 收起浮层，别让它浮在错位的格子上。
  // 唯一的例外是「点邻月灰格」：那次翻月是用户明确要看那一天，
  // 等新格子挂好了再在新格子上重新量一次、把浮层开出来。
  useEffect(() => {
    const pending = pendingPopRef.current;
    pendingPopRef.current = null;
    setPop(null);
    if (!pending || monthKey(pending.date) !== month) return;
    const grid = gridRef.current;
    const el = grid && grid.querySelector(`[data-date="${pending.date}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPop({
      date: pending.date,
      forceAdd: pending.forceAdd,
      anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width },
    });
  }, [month]);

  // 选中日被键盘移走（←→ / ↑↓ / Home）：浮层贴的那一天已经不是选中日，收起。
  // 点格子的那一帧 day 与 popDate 同时变成新日期，不会误关。
  useEffect(() => {
    if (popDate && popDate !== day) setPop(null);
  }, [day, popDate]);

  const focusCell = (date) => {
    const grid = gridRef.current;
    const el = grid && date && grid.querySelector(`[data-date="${date}"]`);
    if (el) el.focus({ preventScroll: true });
  };

  // 关浮层时把焦点还给格子 —— 只在焦点本来就在浮层里时还，
  // 否则会把用户刚点到的别处（导航、搜索框）抢回来。
  const closePop = () => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const fromPop = !!(active && active.closest && active.closest('.cal-pop'));
    const date = popDate;
    setPop(null);
    if (fromPop) focusCell(date);
  };

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
    setPop({
      date,
      forceAdd,
      anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width },
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

  const chipState = (task) => {
    if (readonly) return ' cal-done';
    if (task.dueDate && task.dueDate < today) return ' overdue';
    if (task.dueDate === today) return ' now';
    return '';
  };

  // chip 只是"这一天有这几件事"的读数：不加点击 / 拖拽 / 右键 ——
  // 格子的单击已经有明确含义（看这一天），chip 上再挂动作只会和它打架。
  const renderChip = (task) => {
    const dot = projectDot(task);
    return (
      <span
        key={task.id}
        className={'cal-chip ' + priorityClass(task.priority) + chipState(task)}
        title={task.title}
      >
        <i className="cal-chip-bar" aria-hidden="true" />
        {dot && <i className="cal-chip-dot" style={{ background: dot }} aria-hidden="true" />}
        <span className="cal-chip-text">{displayTitle(task.title)}</span>
      </span>
    );
  };

  const dayNumLabel = (cell) =>
    cell.day === 1 ? `${Number(cell.date.slice(5, 7))}月1日` : String(cell.day);

  const popTasks = popDate ? byDate.get(popDate) || [] : [];

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
            className="cal-grid"
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
                popDate === cell.date ? 'is-open' : '',
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
                  aria-expanded={popDate === cell.date}
                  aria-label={`${dayTitle(cell.date, today)}，${list.length ? `${list.length} 项任务` : '无任务'}`}
                  onClick={() => openDay(cell.date)}
                  onKeyDown={(e) => handleCellKey(e, cell)}
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

      {pop && (
        <CalendarDayPopover
          // key：换一天就重开一次 —— 添加态 / 输入框内容 / 焦点都回到新日期的初始状态。
          key={pop.date}
          date={pop.date}
          tasks={popTasks}
          readonly={readonly}
          store={store}
          query={query}
          anchor={pop.anchor}
          forceAdd={pop.forceAdd}
          onClose={closePop}
        />
      )}
    </div>
  );
}
