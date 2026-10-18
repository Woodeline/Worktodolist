import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { sidebarStats, tasksForView } from '../lib/sortFilter';
import Icon from './Icon.jsx';

// 可展开的分组（分类 / 项目）。
//
// 只做两层：分组行（「分类」/「项目」）→ 组内的具体名称（投资 / 硬件…）。
// 点具体名称 = 把右侧主列表过滤到该项；**不在侧栏里往下摊任务行** ——
// 任务列表归右侧主区，侧栏保持"一眼可扫的目录"。
// 分类与项目共用这一个组件，因此两处的字体、箭头、缩进完全一致。
function SidebarGroup({ prefix, label, items, view, onSelect }) {
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
          <Icon name="chevron-right" size={13} />
        </span>
        <span className="sidebar-group-name">{label}</span>
      </button>
      {open && (
        <div className="sidebar-members" id={subId}>
          {items.map(({ name, count }) => {
            const key = `${prefix}:${name}`;
            return (
              <button
                key={key}
                type="button"
                className={`nav-item${view === key ? ' active' : ''}`}
                onClick={() => onSelect(key)}
              >
                <span>{name}</span>
                {count != null && <span className="count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ store, collapsed = false }) {
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

  // 四个固定视图各有一个图标：图标不是装饰，它是这四条目在"一眼扫过"时的
  // 唯一可用线索 —— 中文标签两个字宽窄相近，光靠文字很难快速分流。
  const item = (view, label, icon, count) => (
    <button
      className={`nav-item${store.view === view ? ' active' : ''}`}
      onClick={() => store.selectView(view)}
      aria-current={store.view === view ? 'true' : undefined}
    >
      <Icon name={icon} size={16} className="nav-icon" />
      <span className="nav-label">{label}</span>
      {count != null && <span className="count">{count}</span>}
    </button>
  );

  return (
    <nav className={'sidebar' + (collapsed ? ' is-collapsed' : '')} aria-label="视图">
      <div className="sidebar-group">
        {item('today', '今天', 'calendar', todayCount)}
        {item('all', '全部', 'list', allCount)}
        {item('done', '已完成', 'check-circle', doneCount)}
      </div>
      <div className="sidebar-group">
        {item('inbox', '收集箱', 'inbox', stats.inbox)}
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
            label="项目"
            items={stats.projects}
            view={store.view}
            onSelect={store.selectView}
          />
        </div>
      )}
      {/* 脚注：把"数据在哪、现在怎么排"写在目录最底下 —— 这两件事
          决定列表长什么样，却没有任何按钮能表达它们。 */}
      <div className="side-foot">
        <span>todo.txt</span>
        <span>自动排序 · {store.sortMode === 'auto' ? '开' : '关'}</span>
      </div>
    </nav>
  );
}
