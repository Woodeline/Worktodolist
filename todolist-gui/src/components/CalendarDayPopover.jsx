// 「当天任务」弹层 —— 日历唯一的任务读写入口（2026-11-15 改版）。
//
// 交互契约（与 Tasks 的日历一致，刻意不做多日区间）：
//   · 点日期格 = 看这一天有什么，弹层贴着格子出现，不占布局、不推挤网格；
//   · 有任务 → 列表（复用 TaskRow：勾完成 / 双击编辑 / 右键菜单全都在）；
//     列表下方一颗「添加任务」；
//   · 没任务 → 直接进添加态，输入框已就位、已聚焦，回车即写盘；
//   · 只读（已完成视图）→ 只有列表，没有添加入口。
//
// 写入仍走 store.addTask 这一条链路：日期由 `due:YYYY-MM-DD` 标签落进那一行，
// 与手敲 due: 完全等价 —— 不另造写入路径。
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import { dayTitle } from '../lib/calendar.js';
import { DAY_POPOVER_H, computeDayPopoverPlacement } from '../lib/placement.js';
import TaskRow from './TaskRow.jsx';
import Icon from './Icon.jsx';

// 纯展示层（无 portal、无副作用）：日期弹层的内容长什么样。
// 抽出来是为了能直接做 SSR 渲染测试 —— createPortal 在 node 环境里渲染不了。
export function DayPanel({
  date,
  today,
  tasks,
  readonly = false,
  store,
  query = '',
  adding = false,
  text = '',
  panelRef,
  inputRef,
  style,
  onTextChange,
  onSubmit,
  onStartAdding,
  onClose,
}) {
  return (
    <div
      className="cal-pop"
      role="dialog"
      aria-label={`${dayTitle(date, today)} 的任务`}
      tabIndex={-1}
      ref={panelRef}
      style={style}
    >
      <header className="cal-pop-head">
        <b className="cal-pop-title">{dayTitle(date, today)}</b>
        <span className="cal-pop-count">{tasks.length} 项</span>
        <button
          type="button"
          className="icon-btn cal-pop-close"
          onClick={onClose}
          aria-label="关闭"
          title="关闭 · Esc"
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      <div className="cal-pop-rows">
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            store={store}
            query={query}
            readonly={readonly}
            dragDisabled
            hideDue={!readonly}
          />
        ))}
        {tasks.length === 0 && !adding && (
          <p className="cal-pop-empty">{readonly ? '这一天没有完成记录' : '这一天没有任务'}</p>
        )}
      </div>

      {!readonly && (
        <div className="cal-pop-foot">
          {adding ? (
            <form className="cal-pop-add" onSubmit={onSubmit}>
              <Icon name="plus" size={12} />
              <input
                ref={inputRef}
                className="cal-pop-add-input"
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
                placeholder="添加任务，回车创建"
                aria-label="新任务标题"
                autoFocus
              />
              <button type="submit" className="btn btn-sm" disabled={!text.trim()}>
                添加
              </button>
            </form>
          ) : (
            <button type="button" className="cal-pop-addbtn" onClick={onStartAdding}>
              <Icon name="plus" size={12} />
              添加任务
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalendarDayPopover({
  date,
  tasks,
  readonly = false,
  store,
  query = '',
  anchor,
  forceAdd = false,
  onClose,
}) {
  const today = dayjs().format('YYYY-MM-DD');
  const [adding, setAdding] = useState(() => !readonly && (forceAdd || tasks.length === 0));
  const [text, setText] = useState('');
  const [place, setPlace] = useState(() => {
    if (typeof window === 'undefined') return null;
    return computeDayPopoverPlacement(anchor, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  // 先量后放：挂载后按内容真实高度重算一次（行数决定高度，预估只能给上限）。
  // scrollHeight 是内容高度，不受 maxHeight 影响 —— 收缩不会反过来搅动这轮计算。
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof window === 'undefined') return;
    setPlace(
      computeDayPopoverPlacement(
        anchor,
        { width: window.innerWidth, height: window.innerHeight },
        el.scrollHeight + 2 // +2 = 上下 1px 描边
      )
    );
  }, [anchor, date, adding, tasks.length]);

  // 关闭三入口：点外面、Esc、窗口尺寸变化（锚点会失效，收起来比浮在错位上强）。
  useEffect(() => {
    const onDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // 捕获阶段截断：弹层的 Esc 只收弹层，别顺手清掉搜索词 / 选中行。
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const submit = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    // 用户自己敲了 due: 就以他写的为准，别把日期改成两条互相打架的标签。
    const raw = /(^|\s)due:\S+/.test(value) ? value : `${value} due:${date}`;
    store.addTask(raw);
    setText('');
    if (inputRef.current) inputRef.current.focus();
  };

  // 没有锚点（拿不到格子矩形）就不弹 —— 宁可什么都不发生，也不弹到窗口左上角。
  if (!anchor || !place || typeof document === 'undefined') return null;

  return createPortal(
    <DayPanel
      date={date}
      today={today}
      tasks={tasks}
      readonly={readonly}
      store={store}
      query={query}
      adding={adding}
      text={text}
      panelRef={panelRef}
      inputRef={inputRef}
      style={{
        top: place.top,
        left: place.left,
        width: place.width,
        maxHeight: place.maxHeight,
      }}
      onTextChange={setText}
      onSubmit={submit}
      onStartAdding={() => setAdding(true)}
      onClose={onClose}
    />,
    document.body
  );
}
