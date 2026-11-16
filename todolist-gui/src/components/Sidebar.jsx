import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { sidebarStats, tasksForView } from '../lib/sortFilter';
import { colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import Icon from './Icon.jsx';

// 可展开的分组（分类 / 标签）。
//
// 只做两层：分组行（「分类」/「标签」）→ 组内的具体名称（投资 / 硬件…）。
// 点具体名称 = 把右侧主列表过滤到该项；**不在侧栏里往下摊任务行** ——
// 任务列表归右侧主区，侧栏保持"一眼可扫的目录"。
// 分类与标签共用这一个组件，因此两处的字体、箭头、缩进完全一致。
// 只有标签带圆点（dotFor）：任务靠颜色一眼分流，
// 分类（@）没有对应物，保持纯文字才不会让人以为它是另一种标签。
// 2026-11-16：组的标题由「列表」改为「标签」—— 与编辑浮窗的「+标签」字段、
// 底部导航的「标签」菜单同一口径（"列表"在本应用里专指主区的任务清单）。
function SidebarGroup({ prefix, label, items, view, onSelect, dotFor }) {
  // 默认展开：首屏直接看到具体分类 / 项目，不必先点一下。
  const [open, setOpen] = useState(true);
  const subId = `sidebar-members-${prefix === '@' ? 'contexts' : 'projects'}`;
  return (
    <div className={`sidebar-tree${open ? ' is-open' : ''}`}>
      {/* 整行可点：箭头只是"可展开 / 已展开"的视觉提示 */}
      <button
        type="button"
        className="sidebar-group-toggle"
        aria-expanded={open}
        aria-controls={subId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sidebar-caret" aria-hidden="true">
          <Icon name="chevron-right" size={16} />
        </span>
        <span className="sidebar-group-name">{label}</span>
      </button>
      {open && (
        <div className="sidebar-members" id={subId}>
          {items.map(({ name, count }) => {
            const key = `${prefix}:${name}`;
            const dot = dotFor ? dotFor(name) : null;
            return (
              <button
                key={key}
                type="button"
                className={`nav-item${view === key ? ' active' : ''}`}
                onClick={() => onSelect(key)}
              >
                {dot && (
                  // 圆点是纯装饰：它的语义只是"这是哪个列表"，而列表名就写在旁边，
                  // 再让读屏念一次颜色只会重复一遍同样的信息。
                  <span className="nav-dot" style={{ background: dot }} aria-hidden="true" />
                )}
                <span className="nav-label">{name}</span>
                {count != null && <span className="count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ store, collapsed = false, listMode = 'list', onPickListMode }) {
  const today = dayjs().format('YYYY-MM-DD');

  const stats = useMemo(() => sidebarStats(store.todoEntries), [store.todoEntries]);
  const allCount = useMemo(
    () => store.todoEntries.filter((e) => e.kind === 'task').length,
    [store.todoEntries]
  );
  const doneCount = useMemo(
    () => store.doneEntries.filter((e) => e.kind === 'task').length,
    [store.doneEntries]
  );
  const todayCount = useMemo(
    () => tasksForView(store.todoEntries, 'today', today).length,
    [store.todoEntries, today]
  );
  const upcomingCount = useMemo(
    () => tasksForView(store.todoEntries, 'upcoming', today).length,
    [store.todoEntries, today]
  );

  // 项目色：配过的用配置，没配过的按名字稳定取一个（见 listStyle.js 的说明）。
  const { colors } = useListStyle();
  const dotFor = useMemo(
    () => (name) => colorHex(resolveColorId(name, colors)),
    [colors]
  );

  // 日历不再是页眉上的切换控件，而是侧栏五个入口之一（2026-11-15）：
  // 点「日历」= 把显示模式切到 calendar（偏好照旧落 configStore，窄边覆盖
  // 语义由 App.pickMode 统一处理）；点其余四个视图则回到列表布局，
  // 否则"点了「全部」画面没变"会被当成按钮坏了。
  // 日历条目本身不占 view —— store.view 保持不变，日历照旧按它取数。
  const isCalMode = listMode === 'calendar';
  const pickView = (view) => {
    store.selectView(view);
    if (isCalMode && onPickListMode) onPickListMode('list');
  };
  const pickCalendar = () => {
    if (onPickListMode) onPickListMode('calendar');
  };

  // 五个固定入口各有一个图标（2026-11-15 换参考稿图形）：图标不是装饰，
  // 它是这五条目在"一眼扫过"时的唯一可用线索 —— 中文标签宽窄相近，
  // 光靠文字很难快速分流。图标略小于文字（文字 13px）：锚点要显眼，
  // 但不能压过标签本身。
  const item = (view, label, icon, count) => (
    <button
      className={'nav-item' + (!isCalMode && store.view === view ? ' active' : '')}
      onClick={() => pickView(view)}
      aria-current={!isCalMode && store.view === view ? 'true' : undefined}
    >
      <Icon name={icon} size={16} className="nav-icon" />
      <span className="nav-label">{label}</span>
      {count != null && <span className="count">{count}</span>}
    </button>
  );

  return (
    <nav className={'sidebar' + (collapsed ? ' is-collapsed' : '')} aria-label="视图">
      <div className="sidebar-group">
        {item('today', '今日', 'check-circle', todayCount)}
        {item('upcoming', '即将到期', 'calendar-clock', upcomingCount)}
        {item('all', '全部', 'grid', allCount)}
        <button
          type="button"
          className={'nav-item' + (isCalMode ? ' active' : '')}
          onClick={pickCalendar}
          aria-current={isCalMode ? 'true' : undefined}
        >
          <Icon name="calendar" size={16} className="nav-icon" />
          <span className="nav-label">日历</span>
        </button>
        {item('done', '日志', 'history', doneCount)}
      </div>
      {stats.contexts.length > 0 && (
        <div className="sidebar-group">
          <SidebarGroup
            prefix="@"
            label="分类"
            items={stats.contexts}
            view={store.view}
            onSelect={store.selectView}
          />
        </div>
      )}
      {stats.projects.length > 0 && (
        <div className="sidebar-group">
          <SidebarGroup
            prefix="+"
            label="标签"
            items={stats.projects}
            view={store.view}
            onSelect={store.selectView}
            dotFor={dotFor}
          />
        </div>
      )}
    </nav>
  );
}
