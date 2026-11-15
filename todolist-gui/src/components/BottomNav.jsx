import { useMemo } from 'react';
import dayjs from 'dayjs';
import { sidebarStats, tasksForView } from '../lib/sortFilter';
import { colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import { useContextMenu } from '../hooks/useContextMenu.jsx';
import Icon from './Icon.jsx';

// 窄屏底部导航（2026-11-15 十一改）。
//
// 桌面端导航就是左侧目录；窄屏（≤768）目录没有容身之处，于是：
//   · 「今日 / 即将到期 / 全部」三枚视图按钮落到窗口底边，固定常驻；
//   · 「标签」是第四枚 —— 分类（@）与列表（+）收进它的上弹菜单，点一下按标签筛。
//     **它不叫「列表」**：这个应用里"列表"已经指主区的任务清单，
//     同名两处会让人以为点它是回到清单。
//
// 只有图标、没有文字：这一条服务的是"切到哪一屏"，四个图形各自够有辨识度，
// 文字交给 aria-label / title。宽屏整条 display:none（见 index.css §10）。
const VIEWS = [
  ['today', '今日', 'check-circle'],
  ['upcoming', '即将到期', 'calendar-clock'],
  ['all', '全部', 'grid'],
];

const isLabelView = (view) => view.startsWith('@:') || view.startsWith('+:');

/**
 * 「标签」上弹菜单的数据（纯函数，便于单测：分组、勾选、空态都在这里定）。
 *
 * @param {{contexts:Array<{name:string,count:number}>, projects:Array<{name:string,count:number}>}} stats
 * @param {string} view 当前视图（`@:名` / `+:名` 表示已按标签筛）
 * @param {(name:string)=>string} dotFor 列表圆点取色
 * @param {(view:string)=>void} pickView 选中回调
 */
export function buildLabelMenu(stats, view, dotFor, pickView) {
  const row = (prefix, { name }) => ({
    type: 'item',
    label: name,
    // 只有 +列表 带圆点：@分类 在侧栏里也没有对应物，两处口径必须一致。
    mark:
      prefix === '+' ? (
        <span className="nav-dot" style={{ background: dotFor(name) }} />
      ) : undefined,
    checked: view === `${prefix}:${name}`,
    onClick: () => pickView(`${prefix}:${name}`),
  });

  const items = [
    {
      type: 'item',
      label: '不按标签筛选',
      checked: !isLabelView(view),
      onClick: () => pickView('all'),
    },
  ];

  if (stats.contexts.length > 0) {
    items.push({ type: 'sep' }, { type: 'header', label: '分类 @' });
    stats.contexts.forEach((c) => items.push(row('@', c)));
  }
  if (stats.projects.length > 0) {
    items.push({ type: 'sep' }, { type: 'header', label: '列表 +' });
    stats.projects.forEach((p) => items.push(row('+', p)));
  }
  // 空态也要有个交代：菜单弹出来一片空白会被当成没点中。
  if (stats.contexts.length === 0 && stats.projects.length === 0) {
    items.push({ type: 'sep' }, { type: 'item', label: '还没有分类或列表', disabled: true });
  }
  return items;
}

export default function BottomNav({ store, listMode = 'list', onPickListMode }) {
  const { openAt } = useContextMenu();
  const today = dayjs().format('YYYY-MM-DD');
  const { colors } = useListStyle();

  // 计数与侧栏同源（tasksForView / sidebarStats）：两处各算一遍迟早会分叉。
  const counts = useMemo(() => {
    const tasks = store.todoEntries.filter((e) => e.kind === 'task');
    return {
      today: tasksForView(store.todoEntries, 'today', today).length,
      upcoming: tasksForView(store.todoEntries, 'upcoming', today).length,
      all: tasks.length,
    };
  }, [store.todoEntries, today]);

  const stats = useMemo(() => sidebarStats(store.todoEntries), [store.todoEntries]);
  const dotFor = useMemo(
    () => (name) => colorHex(resolveColorId(name, colors)),
    [colors]
  );

  // 切视图要连带把显示模式拉回列表：日历里点「今日」如果只改 view，
  // 画面一动不动（日历按日期取数），会被当成按钮坏了 —— 与侧栏同一条规矩。
  const pickView = (view) => {
    store.selectView(view);
    if (listMode === 'calendar' && onPickListMode) onPickListMode('list');
  };

  const onLabelView = isLabelView(store.view);

  const openLabels = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    // 从窗口底边往上弹：菜单底边贴住按钮上缘（place: 'above' 见 ContextMenu）。
    openAt(
      r.left,
      r.top,
      buildLabelMenu(stats, store.view, dotFor, pickView),
      { place: 'above' }
    );
  };

  return (
    <nav className="bottom-nav" aria-label="视图">
      {VIEWS.map(([view, label, icon]) => {
        const active = store.view === view;
        return (
          <button
            key={view}
            type="button"
            className={'bnav-item' + (active ? ' active' : '')}
            onClick={() => pickView(view)}
            aria-current={active ? 'true' : undefined}
            aria-label={`${label}（${counts[view]} 项）`}
            title={`${label} · ${counts[view]} 项`}
          >
            <Icon name={icon} size={18} />
          </button>
        );
      })}
      <button
        type="button"
        className={'bnav-item bnav-labels' + (onLabelView ? ' active' : '')}
        onClick={openLabels}
        aria-haspopup="menu"
        aria-current={onLabelView ? 'true' : undefined}
        aria-label="标签：按分类或列表筛选"
        title="标签"
      >
        <Icon name="tag" size={18} />
      </button>
    </nav>
  );
}
