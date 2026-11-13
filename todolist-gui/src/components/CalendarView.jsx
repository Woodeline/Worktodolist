// 日历视图：清单的第二种显示模式（不是第四个页签）。
// 与列表共用侧栏过滤 / 搜索 / store 动作，只是把"按行排"换成"按日期摊开"。
// 投影逻辑全在 lib/calendar.js（纯函数、已单测）；这里只管渲染与交互。
//
// 交互契约：
//   · 单击日期 = 选中（右侧日详情跟着走）；双击空白日期 / Enter = 在该天新建（预填 due:）
//   · 方向键 ←→ ±1 天、↑↓ ±1 周（全局快捷键）、PageUp/Down ±1 月、Home 回今天
//   · 宽屏：有 due 的任务统一渲染成贯穿多日的「区间条」（单日任务是 1 天的条）。
//     拖条两端 = 改时长（钳制不交叉）；拖条身 = 保时长平移；都走 store.updateTask。
//     单日条拖边缘即长出区间（自动写 t:）。区间语义全在 lib/taskRange.js。
//   · 窄屏（≤768）：条整体隐藏，退回格内 chip 色点；chip/托盘 HTML5 拖拽改期照旧。
//   · 已完成视图按完成日期锚定，整体只读：不能拖、不能建、没有托盘，也不显示区间条。
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  WEEKDAY_LABELS,
  monthGrid,
  monthTitle,
  dayTitle,
  calendarKeyAction,
} from '../lib/calendar.js';
import {
  rangeOf,
  rangeOverlay,
  rangeReadout,
  setRangeStart,
  resizeRange,
  moveRange,
  rescheduleWithRange,
  rangeBars,
  barSegments,
  rangesCovering,
  MAX_BAR_LANES,
} from '../lib/taskRange.js';
import { colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import { copyMenu, useContextMenu } from '../hooks/useContextMenu.jsx';
import TaskRow from './TaskRow.jsx';
import PriorityMark from './PriorityMark.jsx';
import { priorityClass } from '../lib/priority.js';
import Icon from './Icon.jsx';

const MAX_CHIPS = 3;
const DRAG_MIME = 'application/x-worktodolist-task';
// 条车道区从日号下方起算（日号 line-height 16 + 上 padding 4 ≈ 20），每车道 16+2。
const BAR_TOP = 22;
const BAR_LANE_H = 18;

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

  // 区间条的 pointer 拖拽（与 HTML5 chip 拖拽并存）：同样组件私有，不进 store。
  const [barDrag, setBarDrag] = useState(null); // {id,stableId,edge,grabDate,date,patch,clamped,x,y}
  const barDragRef = useRef(null);
  const didDragRef = useRef(false); // 拖动后抑制随之而来的 click
  const [laneCap, setLaneCap] = useState(MAX_BAR_LANES);

  const { byDate, undated, readonly, stats } = projection;
  const dayTasks = byDate.get(day) || [];

  // 区间只是叠在 42 格上的一层独立投影：任务仍按 dueDate 落在唯一那一天，
  // byDate 的单 key 聚合一个字没改。已完成视图按完成日期锚定，区间没有意义。
  const rangeByDate = useMemo(
    () => (readonly ? new Map() : rangeOverlay(projection.tasks, cells.map((c) => c.date))),
    [readonly, projection.tasks, cells]
  );
  // 全局车道分配（跨月稳定）+ 周行分段。readonly 不画条。
  const bars = useMemo(
    () => (readonly ? [] : rangeBars(projection.tasks)),
    [readonly, projection.tasks]
  );
  const barLayout = useMemo(() => barSegments(bars, cells, laneCap), [bars, cells, laneCap]);
  const covering = useMemo(
    () => (readonly ? [] : rangesCovering(projection.tasks, day)),
    [readonly, projection.tasks, day]
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

  // 车道上限随行高自适应：矮窗 / 触屏 44px 行高自动降车道，溢出进「+N」，不硬塞不裁切。
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return undefined;
    const compute = () => {
      const h = grid.getBoundingClientRect().height;
      const rowH = (h - 2 - 5) / 6; // 减外边框与 5 条行格线
      const cap = Math.floor((rowH - BAR_TOP - 4 + 2) / BAR_LANE_H);
      setLaneCap(Math.max(1, Math.min(MAX_BAR_LANES, cap)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(grid);
    return () => ro.disconnect();
  }, []);

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
  // rescheduleWithRange 在只改终点的基础上钳制起点，避免把区间拖成 invalid。
  const dropOn = (e, date) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_MIME) || dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id || readonly) return;
    const task = projection.tasks.find((t) => t.id === id);
    const patch = rescheduleWithRange(task, date);
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
      { type: 'item', label: '设为今天', onClick: () => store.updateTask(task.id, rescheduleWithRange(task, today) || { dueDate: today }) },
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
        <i className="cal-chip-bar" aria-hidden="true" />
        {dot && <i className="cal-chip-dot" style={{ background: dot }} aria-hidden="true" />}
        <span className="cal-chip-text">{task.title}</span>
      </span>
    );
  };

  const dayNumLabel = (cell) =>
    cell.day === 1 ? `${Number(cell.date.slice(5, 7))}月1日` : String(cell.day);

  // 坐标 → 日期：elementsFromPoint（复数）穿透条 overlay 读到下层格子的 data-date；
  // 命中托盘返回 'tray'；都落空时用网格矩形 7 列均分兜底；网格外返回 null（保留上次日期）。
  const dateFromPoint = (x, y) => {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (!el.closest) continue;
      const cell = el.closest('[data-date]');
      if (cell) return cell.getAttribute('data-date');
      if (el.closest('.cal-tray')) return 'tray';
    }
    const grid = gridRef.current;
    if (grid) {
      const r = grid.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const col = Math.min(6, Math.max(0, Math.floor(((x - r.left) / r.width) * 7)));
        const row = Math.min(5, Math.max(0, Math.floor(((y - r.top) / r.height) * 6)));
        return cells[row * 7 + col].date;
      }
    }
    return null;
  };

  const onBarPointerDown = (e, task, edge) => {
    if (readonly) return;
    if (e.button != null && e.button !== 0) return;
    const kind = rangeOf(task).kind;
    if (kind === 'invalid' || kind === 'open' || kind === 'none') return;
    e.preventDefault();
    e.stopPropagation();
    didDragRef.current = false;
    const grabDate = dateFromPoint(e.clientX, e.clientY) || task.dueDate;
    const drag = {
      id: task.id,
      stableId: task.stableId || null,
      edge,
      grabDate,
      date: grabDate,
      patch: null,
      clamped: false,
      x: e.clientX,
      y: e.clientY,
    };
    barDragRef.current = drag;
    setBarDrag(drag);
  };

  // 拖动中：window 级 pointer 监听（不依赖捕获元素存活，预览重渲染也不丢事件）。
  // 预览即所得 —— 钳制在 resizeRange/moveRange 纯函数内，预览与提交共用同一计算。
  useEffect(() => {
    if (!barDrag) return undefined;
    const findTask = (d) =>
      projection.tasks.find((t) => t.id === d.id) ||
      (d.stableId ? projection.tasks.find((t) => t.stableId === d.stableId) : null);

    const computePatch = (d, task, date) => {
      if (d.edge === 'move') {
        if (date === 'tray') return { patch: rescheduleWithRange(task, null), clamped: false };
        const delta = dayjs(date).diff(dayjs(d.grabDate), 'day');
        return { patch: moveRange(task, delta), clamped: false };
      }
      if (date === 'tray') return { patch: null, clamped: false };
      const patch = resizeRange(task, d.edge, date);
      let clamped = true;
      if (patch) {
        const val = d.edge === 'start' ? patch.thresholdDate : patch.dueDate;
        clamped = val !== date;
      }
      return { patch, clamped };
    };

    const move = (e) => {
      const d = barDragRef.current;
      if (!d) return;
      const task = findTask(d);
      if (!task) return;
      const date = dateFromPoint(e.clientX, e.clientY) || d.date;
      const { patch, clamped } = computePatch(d, task, date);
      const next = { ...d, date, patch, clamped, x: e.clientX, y: e.clientY };
      barDragRef.current = next;
      setBarDrag(next);
      setDropTarget(date === 'tray' ? 'tray' : date);
      didDragRef.current = true;
    };

    const finish = () => {
      barDragRef.current = null;
      setBarDrag(null);
      setDropTarget(null);
    };

    const up = (e) => {
      const d = barDragRef.current;
      finish();
      if (!d) return;
      // 松手重取任务：外部重载会使运行时 id 全变，按 id→stableId 双重重取（同 dropOn 口径）。
      const task = findTask(d);
      if (!task) {
        store.showToast?.('任务已变化，请重试');
        return;
      }
      const date = dateFromPoint(e.clientX, e.clientY) || d.date;
      const { patch } = computePatch(d, task, date);
      if (!patch) return;
      store.updateTask(task.id, patch);
      if (patch.dueDate !== undefined && task.recurrence) {
        store.showToast?.(
          patch.dueDate === null
            ? '重复任务：清除截止后将从今天推进'
            : `重复任务：锚点已移到 ${patch.dueDate}`
        );
      }
      const focusDate = d.edge === 'start' ? patch.thresholdDate || task.dueDate : patch.dueDate || task.dueDate;
      if (focusDate) pickDay(focusDate);
    };

    const key = (e) => {
      if (e.key === 'Escape') finish();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', key);
    };
  }, [barDrag?.id, projection.tasks, cells]);

  // 拖动预览：把补丁套到任务上单独算段，沿用原车道（不扰动他人）；其余条冻结在已提交数据。
  let previewWeeks = null;
  if (barDrag && barDrag.patch) {
    const task = projection.tasks.find((t) => t.id === barDrag.id);
    const origBar = bars.find((b) => b.id === barDrag.id);
    if (task && origBar) {
      const pb = rangeBars([{ ...task, ...barDrag.patch }]);
      if (pb[0]) {
        pb[0].lane = origBar.lane;
        previewWeeks = barSegments(pb, cells, MAX_BAR_LANES + 10).weeks;
      }
    }
  }

  const renderBar = (seg, isPreview) => {
    const task = seg.task;
    const dot = projectDot(task);
    const r = rangeOf(task);
    const interactive = !readonly && !isPreview && seg.kind !== 'invalid' && seg.kind !== 'open';
    const role = seg.trueStart && seg.trueEnd ? 'single' : seg.trueStart ? 'start' : seg.trueEnd ? 'end' : 'mid';
    const cls = [
      'cal-bar',
      priorityClass(task.priority),
      chipState(task).trim(),
      'is-' + role,
      seg.contLeft ? 'cont-left' : '',
      seg.contRight ? 'cont-right' : '',
      seg.kind === 'invalid' ? 'is-invalid' : '',
      seg.kind === 'overlong' ? 'is-overlong' : '',
      seg.kind === 'open' ? 'is-open' : '',
      isPreview ? 'is-preview' : '',
      barDrag && barDrag.id === seg.id && !isPreview ? 'is-dragging' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const anchor = task.dueDate || task.thresholdDate;
    return (
      <div
        key={(isPreview ? 'p-' : 'b-') + seg.id}
        className={cls}
        style={{ gridColumn: `${seg.colStart + 1} / ${seg.colEnd + 2}`, gridRow: seg.lane + 1 }}
        data-task-id={seg.id}
        data-role={role}
        role="button"
        tabIndex={-1}
        aria-label={`${task.title} · ${rangeReadout(r) || anchor || ''}`}
        title={task.title}
        onClick={(e) => {
          e.stopPropagation();
          if (didDragRef.current) {
            didDragRef.current = false;
            return;
          }
          if (anchor) pickDay(anchor);
          if (!readonly) store.setFocusedId(task.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!readonly) store.openEditor(task.id);
        }}
        onContextMenu={(e) => chipMenu(e, task)}
        onPointerDown={interactive ? (e) => onBarPointerDown(e, task, 'move') : undefined}
      >
        {seg.trueStart && interactive && (
          <span
            className="cal-bar-handle"
            data-edge="start"
            aria-hidden="true"
            onPointerDown={(e) => {
              e.stopPropagation();
              onBarPointerDown(e, task, 'start');
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <i className="cal-chip-bar" aria-hidden="true" />
        {dot && <i className="cal-chip-dot" style={{ background: dot }} aria-hidden="true" />}
        {seg.showTitle && <span className="cal-bar-text">{task.title}</span>}
        {seg.trueEnd && interactive && (
          <span
            className="cal-bar-handle"
            data-edge="end"
            aria-hidden="true"
            onPointerDown={(e) => {
              e.stopPropagation();
              onBarPointerDown(e, task, 'end');
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
    );
  };

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
            className={'cal-grid' + (readonly ? ' is-readonly' : '') + (barDrag ? ' is-resizing' : '')}
            ref={gridRef}
            aria-label={`${monthTitle(month)}任务日历`}
          >
            {cells.map((cell, i) => {
              const list = byDate.get(cell.date) || [];
              const spans = rangeByDate.get(cell.date) || [];
              const shown = list.slice(0, MAX_CHIPS);
              const extra = list.length - shown.length;
              const hiddenCount = readonly ? 0 : barLayout.weeks[Math.floor(i / 7)].hidden.get(cell.date) || 0;
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
                  style={{ gridRow: Math.floor(i / 7) + 1, gridColumn: (i % 7) + 1 }}
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
                  {hiddenCount > 0 && (
                    <span
                      className="cal-bar-more"
                      style={{ top: BAR_TOP + laneCap * BAR_LANE_H }}
                      onClick={(e) => {
                        e.stopPropagation();
                        pickDay(cell.date);
                      }}
                    >
                      +{hiddenCount}
                    </span>
                  )}
                </button>
              );
            })}
            {!readonly &&
              barLayout.weeks.map((w, wi) => (
                <div className="cal-bar-strip" key={wi} style={{ gridRow: wi + 1 }}>
                  {w.segments.map((seg) => renderBar(seg, false))}
                  {previewWeeks && previewWeeks[wi].segments.map((seg) => renderBar(seg, true))}
                </div>
              ))}
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
              {dayTasks.length === 0 && covering.length === 0 ? (
                <div className="cal-day-empty">
                  {readonly ? '这一天没有完成记录' : '这一天没有任务 · 双击日期新建'}
                </div>
              ) : (
                <>
                  {dayTasks.map((t) => {
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
                          hideDue={!readonly}
                        />
                        {note && (
                          <div className={'cal-range-note' + (r.kind === 'invalid' ? ' is-invalid' : '')}>
                            {note}
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                  {covering.map((t) => (
                    <button
                      key={'cov-' + t.id}
                      type="button"
                      className="cal-covering"
                      onClick={() => store.openEditor(t.id)}
                      title={`${t.title} · ${rangeReadout(rangeOf(t))}`}
                    >
                      <span className="cal-covering-title">{t.title}</span>
                      <span className="cal-covering-note">{rangeReadout(rangeOf(t))}</span>
                    </button>
                  ))}
                </>
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

      {barDrag && barDrag.patch && (
        <div className="cal-bar-tip" style={{ left: barDrag.x, top: barDrag.y }} aria-live="polite">
          {rangeReadout(rangeOf({ ...projection.tasks.find((t) => t.id === barDrag.id), ...barDrag.patch }))}
          {barDrag.clamped ? ' · 已达边界' : ''}
        </div>
      )}
    </div>
  );
}