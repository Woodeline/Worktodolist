// 日历视图：清单的第二种显示模式（不是第四个页签）。
// 与列表共用侧栏过滤 / 搜索 / store 动作，只是把"按行排"换成"按日期摊开"。
// 投影逻辑全在 lib/calendar.js（纯函数、已单测）；这里只管渲染与交互。
//
// 交互契约：
//   · 单击日期 = 选中（右侧日详情跟着走）；双击空白日期 / Enter = 在该天新建（预填 due:）
//   · 方向键 ←→ ±1 天、↑↓ ±1 周（全局快捷键）、PageUp/Down ±1 月、Home 回今天
//   · 拖任务 chip 到别的日期 = 改期；拖进「无日期」托盘 = 清除日期（都走 store.updateTask）
//   · 任务同时有 t:（起点）与 due:（截止）时，格子叠一层中性跨度段、日详情给一行读数；
//     chip 右键可把起点设为选中日 / 清除起点（区间语义全在 lib/taskRange.js）
//   · 已完成视图按完成日期锚定，整体只读：不能拖、不能建、没有托盘，也不显示区间
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  WEEKDAY_LABELS,
  monthGrid,
  monthTitle,
  dayTitle,
  calendarKeyAction,
  dropReschedule,
} from '../lib/calendar.js';
import { rangeOf, rangeOverlay, rangeReadout, setRangeStart } from '../lib/taskRange.js';
import { colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import { copyMenu, useContextMenu } from '../hooks/useContextMenu.jsx';
import TaskRow from './TaskRow.jsx';
import PriorityMark from './PriorityMark.jsx';
import { priorityClass } from '../lib/priority.js';
import Icon from './Icon.jsx';

const MAX_CHIPS = 3;
const MAX_RANGE_SEGS = 2;
const DRAG_MIME = 'application/x-worktodolist-task';

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
  onCreate,
}) {
  const today = dayjs().format('YYYY-MM-DD');
  const { openMenu } = useContextMenu();
  const projectDot = useProjectDot();
  const cells = useMemo(() => monthGrid(month), [month]);
  const gridRef = useRef(null);
  // 翻月 / 回今天会换掉整批格子，旧格子被卸载后焦点掉到 body，
  // 「焦点还在网格里」就判不出来了。键盘导航先打个标，渲染完把焦点补到新选中日。
  const refocusRef = useRef(false);
  // 拖拽状态刻意留在组件内（不进 store）：store.dragId 是列表手动排序的信号，
  // 日历改期若借用它，TaskRow 的落点逻辑会把改期误认成重排。
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // 'YYYY-MM-DD' | 'tray' | null

  const { byDate, undated, readonly, stats } = projection;
  const dayTasks = byDate.get(day) || [];

  // 区间只是叠在 42 格上的一层中性跨度：任务仍按 dueDate 落在唯一那一天，
  // byDate 的单 key 聚合一个字没改。已完成视图按完成日期锚定，区间没有意义。
  const rangeByDate = useMemo(
    () => (readonly ? new Map() : rangeOverlay(projection.tasks, cells.map((c) => c.date))),
    [readonly, projection.tasks, cells]
  );

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

  const pickDay = (date) => onPickDay(date);

  const handleCellKey = (e, cell) => {
    const action = calendarKeyAction(e.key, cell.date);
    if (!action) return; // 不归日历管的键照旧冒泡给全局快捷键（↑↓ / Esc / e 等）
    e.preventDefault();
    switch (action.type) {
      case 'day':
      case 'select':
        pickDay(action.date);
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
        // 格子是 button：全局快捷键对 button 上的回车放行，原生 click 会被
        // preventDefault 拦下 —— 回车在日历里的语义是"在这天新建"，不是选中。
        // 只读态（已完成视图）没有新建入口，按键本身仍要吃掉，别冒泡成别的操作。
        if (!readonly) onCreate(action.date);
        break;
      default:
        break;
    }
  };

  const startDrag = (e, task) => {
    if (readonly) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_MIME, task.id);
    e.dataTransfer.setData('text/plain', task.title);
    setDragId(task.id);
  };

  const endDrag = () => {
    setDragId(null);
    setDropTarget(null);
  };

  const dragOver = (e, target) => {
    if (readonly || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== target) setDropTarget(target);
  };

  const dragLeave = (e, target) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (dropTarget === target) setDropTarget(null);
  };

  // 落点以 drop 时读到的 MIME 为准（dragId 只驱动预览）——
  // 快速拖动可能丢 dragover 帧，预览可以旧，改期不能改错任务。
  const dropOn = (e, date) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_MIME) || dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id || readonly) return;
    const task = projection.tasks.find((t) => t.id === id);
    const patch = dropReschedule(task, date);
    if (!patch) return;
    store.updateTask(id, patch);
    if (date !== null) pickDay(date);
  };

  const chipState = (task) => {
    if (readonly) return ' cal-done';
    if (task.dueDate && task.dueDate < today) return ' overdue';
    if (task.dueDate === today) return ' now';
    return '';
  };

  // 起点的写盘补丁走纯函数：无变化 / 非法目标一律不写盘（与拖放改期同一口径）。
  const applyRangeStart = (task, date) => {
    const patch = setRangeStart(task, date);
    if (patch) store.updateTask(task.id, patch);
  };

  const chipMenu = (e, task) => {
    e.stopPropagation();
    if (readonly) {
      openMenu(e, copyMenu(task.raw || task.title));
      return;
    }
    openMenu(e, [
      { type: 'item', label: '编辑…', accel: 'E', onClick: () => store.openEditor(task.id) },
      { type: 'item', label: '设为今天', onClick: () => store.updateTask(task.id, { dueDate: today }) },
      {
        type: 'item',
        label: '清除日期',
        disabled: !task.dueDate,
        onClick: () => store.updateTask(task.id, { dueDate: null }),
      },
      { type: 'item', label: '起点设为选中日', onClick: () => applyRangeStart(task, day) },
      {
        type: 'item',
        label: '清除开始日',
        disabled: !task.thresholdDate,
        onClick: () => applyRangeStart(task, null),
      },
      { type: 'sep' },
      ...copyMenu(task.raw || task.title),
      { type: 'sep' },
      { type: 'item', label: '删除', danger: true, onClick: () => store.deleteTask(task) },
    ]);
  };

  const renderChip = (task, date) => {
    const dot = projectDot(task);
    return (
      <span
        key={task.id}
        className={'cal-chip ' + priorityClass(task.priority) + chipState(task)}
        draggable={!readonly}
        onDragStart={(e) => startDrag(e, task)}
        onDragEnd={endDrag}
        onClick={(e) => {
          e.stopPropagation();
          pickDay(date);
          if (!readonly) store.setFocusedId(task.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!readonly) store.openEditor(task.id);
        }}
        onContextMenu={(e) => chipMenu(e, task)}
        title={task.title}
      >
        <PriorityMark priority={task.priority} variant="mark" />
        {dot && <i className="cal-chip-dot" style={{ background: dot }} aria-hidden="true" />}
        <span className="cal-chip-text">{task.title}</span>
      </span>
    );
  };

  const dayNumLabel = (cell) =>
    cell.day === 1 ? `${Number(cell.date.slice(5, 7))}月1日` : String(cell.day);

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
          <div className="cal-grid" ref={gridRef} aria-label={`${monthTitle(month)}任务日历`}>
            {cells.map((cell) => {
              const list = byDate.get(cell.date) || [];
              const spans = rangeByDate.get(cell.date) || [];
              const shown = list.slice(0, MAX_CHIPS);
              const extra = list.length - shown.length;
              const cls = [
                'cal-cell',
                cell.inMonth ? 'in-month' : 'out-month',
                cell.weekend ? 'is-weekend' : '',
                cell.date === today ? 'is-today' : '',
                cell.date === day ? 'is-selected' : '',
                dropTarget === cell.date ? 'is-drop' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={cls}
                  data-date={cell.date}
                  tabIndex={cell.date === day ? 0 : -1}
                  aria-pressed={cell.date === day}
                  aria-current={cell.date === today ? 'date' : undefined}
                  aria-label={`${dayTitle(cell.date, today)}，${list.length ? `${list.length} 项任务` : '无任务'}${spans.length ? `，${spans.length} 个区间覆盖` : ''}`}
                  onClick={() => pickDay(cell.date)}
                  onDoubleClick={() => {
                    if (!readonly) onCreate(cell.date);
                  }}
                  onKeyDown={(e) => handleCellKey(e, cell)}
                  onFocus={() => {
                    // 焦点进网格 = 离开任务行：清掉行选中，
                    // 全局的空格 / e / 回车才不会隔着网格误伤日详情里的行。
                    if (!readonly && store.focusedId) store.setFocusedId(null);
                  }}
                  onDragOver={(e) => dragOver(e, cell.date)}
                  onDragLeave={(e) => dragLeave(e, cell.date)}
                  onDrop={(e) => dropOn(e, cell.date)}
                >
                  <span className="cal-daynum">{dayNumLabel(cell)}</span>
                  <span className="cal-chips">
                    {shown.map((t) => renderChip(t, cell.date))}
                    {extra > 0 && (
                      <span
                        className="cal-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          pickDay(cell.date);
                        }}
                      >
                        +{extra}
                      </span>
                    )}
                  </span>
                  {spans.length > 0 && (
                    <span className="cal-range-track" aria-hidden="true">
                      {spans.slice(0, MAX_RANGE_SEGS).map((s) => (
                        <i key={s.id} className={`cal-range-seg is-${s.role}`} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <aside className="cal-side">
          <section
            className="cal-day"
            aria-label="当日任务"
            onDoubleClick={(e) => {
              if (!readonly && !e.target.closest('.task-row')) onCreate(day);
            }}
          >
            <header className="cal-day-head">
              <b>{dayTitle(day, today)}</b>
              <span className="cal-day-count">{dayTasks.length} 项</span>
              {!readonly && (
                <button
                  type="button"
                  className="ctx-btn"
                  onClick={() => onCreate(day)}
                  title={`在 ${day} 新建任务（预填 due:）`}
                >
                  <Icon name="plus" size={12} />
                  新建
                </button>
              )}
            </header>
            <div className="cal-day-rows">
              {dayTasks.length === 0 ? (
                <div className="cal-day-empty">
                  {readonly ? '这一天没有完成记录' : '这一天没有任务 · 双击日期新建'}
                </div>
              ) : (
                dayTasks.map((t) => {
                  const r = rangeOf(t);
                  // 只有设了起点的任务才有区间读数：普通任务不刷屏。
                  const note = !readonly && r.start ? rangeReadout(r) : '';
                  return (
                    <Fragment key={t.id}>
                      <TaskRow
                        task={t}
                        store={store}
                        query={query}
                        readonly={readonly}
                        dragDisabled
                      />
                      {note && (
                        <div className={'cal-range-note' + (r.kind === 'invalid' ? ' is-invalid' : '')}>
                          {note}
                        </div>
                      )}
                    </Fragment>
                  );
                })
              )}
            </div>
          </section>

          {!readonly && (
            <section
              className={'cal-tray' + (dropTarget === 'tray' ? ' is-drop' : '')}
              aria-label="无日期任务"
              onDragOver={(e) => dragOver(e, 'tray')}
              onDragLeave={(e) => dragLeave(e, 'tray')}
              onDrop={(e) => dropOn(e, null)}
            >
              <header className="cal-tray-head">
                <Icon name="inbox" size={14} />
                <span>无日期</span>
                <em>{undated.length}</em>
              </header>
              <div className="cal-tray-rows">
                {undated.length === 0 ? (
                  <p className="cal-tray-hint">把任务拖到这里清除日期</p>
                ) : (
                  undated.map((t) => {
                    const dot = projectDot(t);
                    return (
                      <div
                        key={t.id}
                        className={'cal-tray-item ' + priorityClass(t.priority)}
                        role="button"
                        tabIndex={0}
                        aria-label={`${t.title} · 按回车编辑，拖到日历指定日期`}
                        draggable
                        onDragStart={(e) => startDrag(e, t)}
                        onDragEnd={endDrag}
                        onClick={() => store.openEditor(t.id)}
                        onKeyDown={(e) => {
                          // 托盘里的任务没有日期，日详情看不到它们 —— 键盘用户唯一的
                          // 编辑入口就是这里，Enter / 空格必须与鼠标单击等价。
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            store.openEditor(t.id);
                          }
                        }}
                        onContextMenu={(e) => chipMenu(e, t)}
                        title={`${t.title} · 点击编辑，拖到日历指定日期`}
                      >
                        <PriorityMark priority={t.priority} variant="mark" />
                        {dot && <i className="cal-chip-dot" style={{ background: dot }} aria-hidden="true" />}
                        <span className="cal-chip-text">{t.title}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}