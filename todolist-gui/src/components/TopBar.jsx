import { colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import Icon from './Icon.jsx';

// 视图名：侧栏选中的那一项（含 @分类 / +项目 的伪视图），用在面包屑第一段。
// 「今日」与侧栏入口同口径（2026-11-15 五入口改版）。
const VIEW_TITLES = {
  today: '今日',
  upcoming: '即将到期',
  all: '全部',
  done: '日志',
  inbox: '收集箱',
};

export function viewTitle(view) {
  if (view.startsWith('@:')) return '@' + view.slice(2);
  if (view.startsWith('+:')) return '+' + view.slice(2);
  return VIEW_TITLES[view] || '全部';
}

// 上下文条（2026-11-15 再排）：
//
//   左侧：侧栏开关 · 面包屑（我在哪）
//   右侧：放大镜（点了才出输入框）· 排序（手动/自动一枚图标钮）
//
// 「列表 / 日历」切换控件已从页眉移除：日历降为侧栏五个入口之一（Sidebar），
// 页眉不再承担显示模式切换。偏好本身仍落 configStore（设置页可改）。
//
// 面包屑只留"我在哪"的主段：上面那行已经是「今日」了，再补一句「到期与逾期」
// 是替布局解释它自己（见 AGENTS.md「少写说明」）。
export default function TopBar({
  store,
  tab = 'list',
  settingsOpen = false,
  sidebarCollapsed = false,
  onToggleSidebar,
  chrome = false,
  listMode = 'list',
  effectiveMode,
  searchOpen = false,
  onOpenSearch,
  onCloseSearch,
}) {
  const isList = tab === 'list' && !settingsOpen;
  // 面包屑说的是「此刻画面」，所以读有效布局；排序钮的显隐也看它 ——
  // 日历里排序没有作用对象。
  const isCalendar = isList && (effectiveMode || listMode) === 'calendar';

  // 当前视图是某个列表（+项目）时，面包屑带上它的颜色 ——
  // 否则"列表"这个概念只在侧栏成立，进了主区就退回成一串灰字。
  const { colors } = useListStyle();
  const listName = store.view.startsWith('+:') ? store.view.slice(2) : '';
  const listDot = listName ? colorHex(resolveColorId(listName, colors)) : null;

  const crumbTitle = settingsOpen ? '设置' : tab === 'tools' ? '工具' : viewTitle(store.view);

  const toggleSort = () => store.setSortMode(store.sortMode === 'manual' ? 'auto' : 'manual');
  const isManual = store.sortMode === 'manual';

  return (
    <header
      className="topbar"
      data-tauri-drag-region={chrome ? 'true' : undefined}
    >
      {isList && onToggleSidebar && (
        <button
          type="button"
          // panel-toggle 是窄屏的退场开关（见 index.css 的 @media 768）：
          // 窄屏导航搬到底部条，侧栏目录根本不存在，这枚按钮点了不会有任何变化。
          className={'ctx-btn ctx-btn-icon panel-toggle' + (sidebarCollapsed ? ' is-on' : '')}
          onClick={onToggleSidebar}
          title="折叠侧栏 · Ctrl+B"
          aria-label="折叠侧栏"
          aria-pressed={sidebarCollapsed}
        >
          <Icon name="panel-left" size={16} />
        </button>
      )}

      <div className="crumb" data-tauri-drag-region={chrome ? 'deep' : undefined}>
        {isList && listDot && (
          <span className="nav-dot" style={{ background: listDot }} aria-hidden="true" />
        )}
        <b>{crumbTitle}</b>
      </div>

      <span className="spacer" data-tauri-drag-region={chrome ? 'true' : undefined} />

      {isList && (
        <>
          {/* 搜索：平时只是一枚放大镜，点了才长出输入框（/ 键同一条链路）。
              关掉时清空关键词 —— 否则筛选还在、输入框却不见了，任务会凭空少一半。 */}
          {searchOpen ? (
            <div className="search">
              <Icon name="search" size={16} />
              <input
                ref={store.searchRef}
                autoFocus
                value={store.search}
                onChange={(e) => store.setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    if (onCloseSearch) onCloseSearch();
                  }
                }}
                placeholder="搜索任务"
                aria-label="搜索任务"
              />
              <button
                type="button"
                className="search-close"
                onClick={() => onCloseSearch && onCloseSearch()}
                title="关闭搜索（Esc）"
                aria-label="关闭搜索"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={'ctx-btn ctx-btn-icon' + (store.search ? ' is-on' : '')}
              onClick={() => onOpenSearch && onOpenSearch()}
              title="搜索任务 · /"
              aria-label="搜索任务"
            >
              <Icon name="search" size={16} />
            </button>
          )}

          {/* 日历里每一天内部恒按优先级·日期聚拢（compareAuto），
              手动排序没有作用对象 —— 整个按钮收掉，不留一个按了没反应的控件。 */}
          {!isCalendar && (
            <button
              type="button"
              className="ctx-btn ctx-btn-icon"
              data-sort={isManual ? 'manual' : 'auto'}
              onClick={toggleSort}
              title={
                isManual
                  ? '排序：手动（文件行序 · 可拖拽）· 点按换自动'
                  : '排序：自动（优先级 · 日期）· 点按换手动'
              }
              aria-label={'排序：' + (isManual ? '手动' : '自动')}
            >
              <Icon name={isManual ? 'grip-vertical' : 'arrow-up-down'} size={16} />
            </button>
          )}
        </>
      )}
    </header>
  );
}
