import { colorHex, resolveColorId, useListStyle } from '../lib/listStyle.js';
import Icon from './Icon.jsx';

// 视图名：侧栏选中的那一项（含 @分类 / +项目 的伪视图），用在面包屑第一段。
const VIEW_TITLES = { today: '今天', all: '全部', done: '已完成', inbox: '收集箱' };

export function viewTitle(view) {
  if (view.startsWith('@:')) return '@' + view.slice(2);
  if (view.startsWith('+:')) return '+' + view.slice(2);
  return VIEW_TITLES[view] || '全部';
}

// 面包屑第二段：说明"这一段看到的是哪个文件 / 哪种过滤"。
// 它不是装饰 —— todo.txt 与 done.txt 是两个不同的文件，用户有权知道自己在看哪个。
function viewSubtitle(view) {
  if (view.startsWith('@:')) return '分类过滤';
  if (view.startsWith('+:')) return '项目过滤';
  switch (view) {
    case 'today':
      return '到期与逾期';
    case 'done':
      return 'done.txt · 只读';
    case 'inbox':
      return '无分类任务';
    default:
      return 'todo.txt';
  }
}

// 上下文条（原型里的 .ctxbar）：36px 高，左边是"我在哪"，右边是这一层能做的动作。
// 它替代了原来的工具条 —— 新建任务下沉到列表首行（.quick-add），
// 搜索 / 排序收敛成两个窄控件，状态交给底部状态栏。
//
// 2026-10-18 页眉左侧化：侧栏开关从右侧按钮簇移到**页眉最左**，改成图标式
// （参照桌面软件"面板开关在左上角"的惯例，见方案文档 §13）。
// 图形与提示沿用原型 v2 的折叠钮：panel-fold（左缘竖条 + 左向箭头）+
// 「折叠侧栏 · Ctrl+B」—— 与原型完全一致，只把位置从右侧搬到了最左。
// 它只出现在列表页 —— 另外两个页签没有侧栏，没有可开关的对象。
// 语义不变：同一个 store.sortMode / sidebarCollapsed，Ctrl+B 照旧。
export default function TopBar({
  store,
  tab = 'list',
  settingsOpen = false,
  count = null,
  sidebarCollapsed = false,
  onToggleSidebar,
}) {
  const isList = tab === 'list' && !settingsOpen;

  // 当前视图是某个列表（+项目）时，面包屑带上它的颜色 ——
  // 否则"列表"这个概念只在侧栏成立，进了主区就退回成一串灰字。
  const { colors } = useListStyle();
  const listName = store.view.startsWith('+:') ? store.view.slice(2) : '';
  const listDot = listName ? colorHex(resolveColorId(listName, colors)) : null;

  const crumb = settingsOpen
    ? { title: '设置', sub: '列表外观 · 快捷键速查' }
    : tab === 'chat'
      ? { title: '对话', sub: '自然语言操作' }
      : tab === 'tools'
        ? { title: '工具', sub: '只读投影' }
        : { title: viewTitle(store.view), sub: viewSubtitle(store.view) };

  const toggleSort = () => store.setSortMode(store.sortMode === 'manual' ? 'auto' : 'manual');

  return (
    <header className="topbar">
      {isList && onToggleSidebar && (
        <button
          type="button"
          className={'ctx-btn ctx-btn-icon' + (sidebarCollapsed ? ' is-on' : '')}
          onClick={onToggleSidebar}
          title="折叠侧栏 · Ctrl+B"
          aria-label="折叠侧栏"
          aria-pressed={sidebarCollapsed}
        >
          <Icon name="panel-fold" size={13} />
        </button>
      )}

      <div className="crumb">
        {isList && listDot && (
          <span className="nav-dot" style={{ background: listDot }} aria-hidden="true" />
        )}
        <b>{crumb.title}</b>
        <i>/</i>
        <span>{crumb.sub}</span>
        {isList && count != null && <span className="n">{count} 项</span>}
      </div>

      <span className="spacer" />

      {isList && (
        <>
          <div className="search">
            <Icon name="search" size={13} />
            <input
              ref={store.searchRef}
              value={store.search}
              onChange={(e) => store.setSearch(e.target.value)}
              placeholder="搜索任务"
              aria-label="搜索任务"
            />
            {store.search ? (
              <button className="icon-btn" onClick={() => store.setSearch('')} title="清空搜索（Esc）">
                <Icon name="x" size={12} />
              </button>
            ) : (
              <kbd className="ctx-kbd">/</kbd>
            )}
          </div>

          <button
            type="button"
            className="ctx-btn"
            onClick={toggleSort}
            title="点击切换：手动 = 文件行序（可拖拽）／自动 = 优先级 · 日期"
          >
            排序 · {store.sortMode === 'manual' ? '手动' : '自动'}
          </button>
        </>
      )}
    </header>
  );
}
