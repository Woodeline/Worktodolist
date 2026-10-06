import { useMemo } from 'react';
import dayjs from 'dayjs';
import { sidebarStats, tasksForView } from '../lib/sortFilter';

export default function Sidebar({ store }) {
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

  const item = (view, label, count) => (
    <button
      className={`nav-item${store.view === view ? ' active' : ''}`}
      onClick={() => store.selectView(view)}
    >
      <span>{label}</span>
      {count != null && <span className="count">{count}</span>}
    </button>
  );

  return (
    <nav className="sidebar">
      <div className="sidebar-group">
        {item('today', '今天', todayCount)}
        {item('all', '全部', allCount)}
        {item('done', '已完成', doneCount)}
      </div>
      <div className="sidebar-group">
        {item('inbox', '收集箱', stats.inbox)}
      </div>
      {stats.contexts.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-heading">@分类</div>
          {stats.contexts.map((c) => item(`@:${c.name}`, `@${c.name}`, c.count))}
        </div>
      )}
      {stats.projects.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-heading">+项目</div>
          {stats.projects.map((p) => item(`+:${p.name}`, `+${p.name}`, p.count))}
        </div>
      )}
    </nav>
  );
}
