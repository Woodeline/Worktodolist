// 「当天任务」弹层 —— 日历唯一的任务读写入口（2026-11-15 改版，11-16 十五改）。
//
// 交互契约（与 Tasks 的日历一致，刻意不做多日区间）：
//   · 点日期格 = 看这一天有什么，弹层贴着格子出现，不占布局、不推挤网格；
//   · 有任务 → 列表（复用 TaskRow：勾完成 / 双击编辑 / 右键菜单全都在）；
//     列表下方一颗「添加任务」；没任务 → 直接进添加态，输入框已就位、已聚焦；
//   · 只读（已完成视图）→ 只有列表，没有添加入口；
//   · **置顶**（11-16）：右上角图钉。置顶的那一刻把当前位置冻结成屏幕坐标，
//     之后点外面 / 翻月 / 切选中日都不再关它，可以同时开好几天的浮层并排看；
//   · **可拖**（11-16）：拖标题栏移动窗口（按钮上不接管，置顶 / 关闭要能点）。
//     没拖过的仍按格子锚点自动落位（lib/placement.js#computeDayPopoverPlacement）。
//   · 列表行只报"哪件事"（TaskRow 的 minimal）：日期 / 分类 / 标签 / 重复 / 提醒
//     一概不画 —— 这一行的日期就是它所在的那一天，再报一次只是噪声；
//     悬停也不浮快捷按钮（浮出来的按钮会盖住相邻行）。
//
// 写入仍走 store.addTask 这一条链路：日期由 `due:YYYY-MM-DD` 标签落进那一行，
// 与手敲 due: 完全等价 —— 不另造写入路径。
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import { dayTitle } from '../lib/calendar.js';
import { computeDayPopoverPlacement } from '../lib/placement.js';
import TaskRow from './TaskRow.jsx';
import Icon from './Icon.jsx';

// 纯展示层（无 portal、无副作用）：日期弹层的内容长什么样。
// 抽出来是为了能直接做 SSR 渲染测试 —— createPortal 在 node 环境里渲染不了。
export function DayPanel({
  date,
  today,
  tasks,
  store,
  query = '',
  adding = false,
  text = '',
  pinned = false,
  dragging = false,
  panelRef,
  inputRef,
  style,
  onTextChange,
  onSubmit,
  onStartAdding,
  onClose,
  onTogglePin,
  onHeadPointerDown,
  onRaise,
}) {
  return (
    <div
      className={'cal-pop' + (pinned ? ' is-pinned' : '') + (dragging ? ' is-dragging' : '')}
      role="dialog"
      aria-label={`${dayTitle(date, today)} 的任务`}
      tabIndex={-1}
      ref={panelRef}
      style={style}
      onPointerDown={onRaise}
    >
      {/* 标题栏兼作拖拽把手：按住空白处拖，按钮上不接管（置顶 / 关闭要能点）。
          移动与松手由窗口级监听接管（见下面的 effect）—— 指针捕获在面板上会把
          move 事件改派给面板，挂在标题栏上的 onPointerMove 反而收不到。 */}
      <header className="cal-pop-head" onPointerDown={onHeadPointerDown}>
        <b className="cal-pop-title">{dayTitle(date, today)}</b>
        <span className="cal-pop-count">{tasks.length} 项</span>
        <button
          type="button"
          className={'icon-btn cal-pop-pin' + (pinned ? ' is-on' : '')}
          onClick={onTogglePin}
          aria-pressed={pinned}
          aria-label={pinned ? '取消置顶' : '置顶'}
          title={pinned ? '取消置顶' : '置顶（置顶后点外面不会关掉，可同时看几天的清单）'}
        >
          {/* 实心 = 已置顶；描边 = 没置顶（与活动栏那枚图钉同一套语法） */}
          <Icon name="pin" size={16} fill={pinned ? 'currentColor' : 'none'} />
        </button>
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
            dragDisabled
            minimal
          />
        ))}
        {tasks.length === 0 && !adding && <p className="cal-pop-empty">这一天没有任务</p>}
      </div>

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
    </div>
  );
}

export default function CalendarDayPopover({
  date,
  tasks,
  store,
  query = '',
  anchor,
  forceAdd = false,
  pinned = false,
  depth = 0,
  onTogglePin,
  onRaise,
  onClose,
}) {
  const today = dayjs().format('YYYY-MM-DD');
  const [adding, setAdding] = useState(() => forceAdd || tasks.length === 0);
  const [text, setText] = useState('');
  // 拖过 / 置顶冻结之后的位置（屏幕坐标）。null = 还没动过，按格子锚点自动落位。
  const [pos, setPos] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const [autoPlace, setAutoPlace] = useState(() => {
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
  // 已经拖过（pos 有值）就不再重算：那之后位置由用户说了算。
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof window === 'undefined' || pos) return;
    setAutoPlace(
      computeDayPopoverPlacement(
        anchor,
        { width: window.innerWidth, height: window.innerHeight },
        el.scrollHeight + 2 // +2 = 上下 1px 描边
      )
    );
    // pos 刻意不进依赖：刚拖完那一轮不该把窗口拉回格子旁边
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, date, adding, tasks.length]);

  const place = pos || autoPlace;
  // 拖动回调里要读"当前这一轮的落位"（尤其 maxHeight），用 ref 兜住最新值，
  // 免得把 place 塞进 effect 依赖、每帧重挂监听。
  const placeRef = useRef(place);
  placeRef.current = place;

  // 置顶的那一下把当前位置冻结成屏幕坐标：之后翻月 / 滚页面都跟格子脱钩，
  // 窗口就真的"钉"在原地了。取消置顶不清掉 pos —— 位置仍是用户拖到的位置。
  const freeze = () => {
    if (!pos && place) setPos(place);
  };

  const handlePin = () => {
    if (!pinned) freeze();
    if (onTogglePin) onTogglePin();
  };

  const handleHeadPointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return; // 按钮要能点，别被拖拽吃掉
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setDragging(true);
  };

  // 拖动期间把 move / up 挂到 window 上：指针一旦离开标题栏（拖快了很正常），
  // 挂在标题栏上的监听就收不到后续事件，窗口会卡在"粘着鼠标"的状态。
  // 顺带关掉整页的文字选择 —— 拖着窗口划过正文时不该把正文选中一片。
  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev) => {
      const d = dragRef.current;
      const el = panelRef.current;
      if (!d || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // 留 8px 边缘：拖出窗口就再也抓不回来了。
      const left = Math.min(Math.max(8, ev.clientX - d.dx), Math.max(8, window.innerWidth - w - 8));
      const top = Math.min(Math.max(8, ev.clientY - d.dy), Math.max(8, window.innerHeight - h - 8));
      setPos({ top, left, width: w, maxHeight: placeRef.current ? placeRef.current.maxHeight : undefined });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

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
      store={store}
      query={query}
      adding={adding}
      text={text}
      pinned={pinned}
      dragging={dragging}
      panelRef={panelRef}
      inputRef={inputRef}
      style={{
        top: place.top,
        left: place.left,
        width: place.width,
        maxHeight: place.maxHeight,
        // 越晚打开（或刚被点过）的越在上面：点哪块哪块到最前。
        zIndex: 45 + depth,
      }}
      onTextChange={setText}
      onSubmit={submit}
      onStartAdding={() => setAdding(true)}
      onClose={onClose}
      onTogglePin={handlePin}
      onHeadPointerDown={handleHeadPointerDown}
      onRaise={onRaise}
    />,
    document.body
  );
}
