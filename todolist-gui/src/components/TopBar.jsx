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
  // 2026-11-17：分类 / 标签视图只报名字。@ 与 + 是 todo.txt 的写法，
  // 不该跟着进面包屑（侧栏与底部导航点过来时尤其明显）。
  if (view.startsWith('@:') || view.startsWith('+:')) return view.slice(2);
  return VIEW_TITLES[view] || '全部';
}

// 上下文条（2026-11-15 再排；2026-11-23 排序钮移到快录条右端）：
//
//   左侧：侧栏开关 · 面包屑（我在哪）
//   右侧：放大镜（点了才出输入框）
//
// 排序只作用于列表，已跟"写一行"一起放进快录条，不再占页眉右端。
export default function TopBar({
  store,
  tab = 'list',
  settingsOpen = false,
  sidebarCollapsed = false,
  onToggleSidebar,
  chrome = false,
  searchOpen = false,
  onOpenSearch,
  onCloseSearch,
}) {
  const isList = tab === 'list' && !settingsOpen;

  // 当前视图是某个列表（+项目）时，面包屑带上它的颜色 ——
  // 否则"列表"这个概念只在侧栏成立，进了主区就退回成一串灰字。
  const { colors } = useListStyle();
  const listName = store.view.startsWith('+:') ? store.view.slice(2) : '';
  const listDot = listName ? colorHex(resolveColorId(listName, colors)) : null;

  const crumbTitle = settingsOpen ? '设置' : tab === 'tools' ? '工具' : viewTitle(store.view);

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
        </>
      )}
    </header>
  );
}
