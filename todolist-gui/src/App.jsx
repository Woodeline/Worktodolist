import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useTodoStore } from './hooks/useTodoStore';
import { useNativeShell } from './hooks/useNativeShell';
import { useAlwaysOnTop } from './hooks/useAlwaysOnTop';
import { useTheme } from './hooks/useTheme';
import { THEME_ICONS, THEME_LABELS, THEME_MODES } from './lib/theme.js';
import { hostPlatform, isTauri, hideToTray, usesCustomTitlebar } from './lib/runtime.js';
import { resolveEscape } from './lib/escape.js';
import { useTodoSnapshot } from './hooks/useTodoSnapshot';
import useDebounce from './hooks/useDebounce';
import useHotkeys from './hooks/useHotkeys';
import { useContextMenu } from './hooks/useContextMenu.jsx';
import { displayOrder, sidebarStats, todayGroups, viewTasks } from './lib/sortFilter';
import { monthKey, projectionForMonth, shiftDate } from './lib/calendar.js';
import { useListMode } from './lib/listMode.js';
import { noticeState } from './lib/layoutMode.js';
import { useLayoutMode } from './hooks/useLayoutMode.js';
import { buildNesting, childProgress, depthWithin, filterCollapsed, nestChildren } from './lib/subtasks.js';
import { useRowCollapse } from './hooks/useRowCollapse.js';
import { buildAppMenuItems } from './lib/appMenu.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import BottomNav from './components/BottomNav.jsx';
import TaskRow from './components/TaskRow.jsx';
import QuickAdd from './components/QuickAdd.jsx';
import CalendarView from './components/CalendarView.jsx';
import LayoutNotice from './components/LayoutNotice.jsx';
import EditDrawer from './components/EditDrawer.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import ToolsPage from './components/tools/ToolsPage.jsx';
import Icon from './components/Icon.jsx';
import { WindowControls, WindowResizeHandles } from './components/WindowChrome.jsx';

// 两个页签是同一层级的"工作区"：列表（看）、工具（算）。
// 顺序即 Ctrl+1 / 2 的绑定顺序，也是左侧活动栏自上而下的顺序。
export const TABS = [
  ['list', '列表'],
  ['tools', '工具'],
];

// 活动栏是纯图标：图标只负责"认出是哪个区"，文字交给悬停提示。
const TAB_ICONS = { list: 'list', tools: 'toolbox' };

export function UnsupportedPage() {
  return (
    <div className="welcome">
      <h1>待办清单</h1>
      <p className="welcome-sub">这个浏览器打不开文件读写功能</p>
      <p>
        请改用 <strong>Microsoft Edge</strong> 或 <strong>Google Chrome</strong> 打开本页
        （地址栏复制粘贴当前网址即可）。
      </p>
      <p className="hint">原因：需要浏览器允许本页直接读写你电脑上的 todo.txt 文件，Firefox 暂不支持。</p>
    </div>
  );
}

// 引导页的"一件事"：把产品真正产出的东西摊开给人看。
// 这不是插图 —— 右侧那张纸就是 todo.txt 的一页，左边行号、右边原文，
// 高亮那行对应界面里的一条任务。用户第一眼就知道自己在用什么。
function LedgerPreview() {
  const lines = [
    ['01', '(A) 交周报 @工作 +回测 due:2026-11-09'],
    ['02', '(B) 写第 10 周回测报告 @工作 +回测'],
    ['03', '(C) 核对军信股份的周线信号 @投资'],
    ['04', '整理 QuantDinger 的策略清单 +量化'],
    ['05', '画主力吸筹指标的多周期对比图 @投资 +回测'],
    ['06', '给移动硬盘做一次性能测试 @硬件'],
    ['07', '买网线 @硬件'],
    ['08', '周线复盘：人民网 @投资'],
  ];
  return (
    <aside className="welcome-preview" aria-label="todo.txt 文件预览">
      <div className="ledger-sheet">
        <div className="ledger-head">
          <span className="ledger-file">todo.txt</span>
          <span className="ledger-count">8 行</span>
        </div>
        <div className="ledger-body">
          {lines.map(([no, text], i) => (
            <div className={'ledger-row' + (i === 0 ? ' is-current' : '')} key={no}>
              <span className="ledger-no">{no}</span>
              <span className="ledger-sep">│</span>
              <span className="ledger-text">{text}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 纸页保留文件原文 (A)/(B)/(C)，这里把两套记号接起来：界面读的是急慢分级。 */}
      <p className="ledger-legend">
        <span className="ledger-legend-map"><code>(A)</code> 高</span>
        <span className="ledger-legend-map"><code>(B)</code> 中</span>
        <span className="ledger-legend-map"><code>(C)</code> 低</span>
        <span className="ledger-legend-hint">左为文件写法 · 右为急慢分级</span>
      </p>
      <p className="welcome-preview-note">文件里的一行，就是界面里的一条任务</p>
    </aside>
  );
}

export function WelcomePage({ store }) {
  // 这一步的文案在两种运行方式下必须不同：壳里 `ws_pick` 走系统目录选择框，
  // 选完即可写，**没有**任何"允许编辑文件"的授权弹窗。照抄浏览器文案会让用户
  // 干等一个永远不出现的对话框。浏览器分支的字符串保持原样不动。
  const shell = isTauri();
  return (
    <div className="welcome welcome--split">
      <div className="welcome-copy">
        <h1>待办清单</h1>
        <p className="welcome-sub">任务一行一条，存在本机的 todo.txt 里，用记事本和 git 都能打开。</p>
        <ol className="welcome-steps">
          <li>点下面的按钮，选一个文件夹</li>
          <li>
            选中放 <code>todo.txt</code> 的文件夹；还没有的话，新建一个空文件夹也行
          </li>
          <li>
            {shell ? (
              <>选完即可读写，不会再弹授权框</>
            ) : (
              <>浏览器问「是否允许编辑文件」时，点 <strong>允许</strong></>
            )}
          </li>
        </ol>
        <button className="btn btn-primary btn-lg" onClick={store.pickDirectory}>
          选择文件夹
        </button>
        <p className="hint">
          任务存在 <code>todo.txt</code> 里，选中一次就会记住，下次直接进来。
        </p>
      </div>
      <LedgerPreview />
    </div>
  );
}

export function ReauthPage({ store }) {
  const shell = isTauri();
  return (
    <div className="welcome">
      <h1>需要重新连接文件夹</h1>
      <p className="welcome-sub">
        {shell
          ? '上次选的数据目录现在不可用了：可能被移动、改名，或所在磁盘没挂上。'
          : '浏览器出于安全，隔一段时间要重新确认一次文件权限。'}
      </p>
      <button className="btn btn-primary btn-lg" onClick={store.reauthorize}>
        {shell ? '重新选一次目录' : '重新授权'}
      </button>
      <p className="hint">
        {shell
          ? '重新选中同一个文件夹即可，数据不会丢。'
          : '点完会弹出一个确认框，点「允许 / 编辑文件」即可，数据不会丢。'}
      </p>
    </div>
  );
}

export function EmptyToday({ store }) {
  return (
    <div className="empty-state">
      <div className="empty-emoji">
        <Icon name="check-circle" size={24} />
      </div>
      <p>今天没有待办</p>
      <button className="btn" onClick={() => store.selectView('all')}>
        查看全部
      </button>
    </div>
  );
}

export function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className="toast">
      <span>{toast.message}</span>
      {toast.actionLabel && (
        <button
          className="toast-action"
          onClick={() => {
            if (toast.onAction) toast.onAction();
            onClose();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button className="toast-close" onClick={onClose} title="关闭">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

export function ConflictModal({ store }) {
  return (
    <div className="modal">
      <div className="modal-card">
        <h3>文件在外部被修改</h3>
        <p>
          检测到 todo.txt / done.txt 被其他程序（topydo 或编辑器）修改，且本地存在未保存的变更。请选择保留哪一份。
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={store.resolveConflictUseDisk}>
            采用文件内容
          </button>
          <button className="btn btn-primary" onClick={store.resolveConflictKeepLocal}>
            保留本地并覆盖文件
          </button>
        </div>
      </div>
    </div>
  );
}

// 分组头：等宽小标签 + 左侧色条 + 右端计数（原型里的 .group）。
// 不再画"延伸到底的规则线" —— 列表本身没有行分隔线，标题也不需要再画一条。
// 「一键展开 / 收起」是可选动作，只挂在本屏真有可展开父项的分组头上。
function GroupHead({ label, count, tone, action = null }) {
  return (
    <div className={'group-title' + (tone === 'overdue' ? ' group-overdue' : '')}>
      <span>{label}</span>
      {(count != null || action) && (
        <span className="group-tail">
          {count != null && <em>{count}</em>}
          {action}
        </span>
      )}
    </div>
  );
}

// 连续子行按「一段」收尾：末行的竖脊只画到行中腰，不再垂到行底留一截断头。
// 一段只有一个子任务时，竖脊自然只剩「父行下沿 → 中腰」这半截，加肘线正好是个 L。
// 必须按渲染顺序扫，不能按 parentId 分组 —— 孙辈行夹在中间时也要一起算进这段。
function childRunTails(list, depthOf) {
  const tails = new Set();
  let prev = null;
  for (const task of list) {
    if (depthOf(task) > 0) {
      if (prev) tails.delete(prev);
      tails.add(task.id);
      prev = task.id;
    } else {
      prev = null;
    }
  }
  return tails;
}

export function MainList({
  store,
  query,
  collapsed: collapsedProp,
  toggleExpand: toggleProp,
  setAllCollapsed: setAllProp,
}) {
  const today = dayjs().format('YYYY-MM-DD');
  // 收起态按 stableId 存（运行时 id 每次解析现算，拿它当键一切换视图就丢）。
  // 产品里由 App 传同一份，键盘导航 / 顶栏计数才和真实渲染的行同源；
  // 静态舞台（styleguide）不传时自带一份，展开照样可点。
  const own = useRowCollapse();
  const collapsed = collapsedProp ?? own.collapsed;
  const toggleExpand = toggleProp ?? own.toggleExpand;
  const setAllCollapsed = setAllProp ?? own.setAllCollapsed;

  const rawEntries = useMemo(
    () => store.todoEntries.filter((e) => e.kind === 'raw'),
    [store.todoEntries]
  );
  const doneTasks = useMemo(
    () => store.doneEntries.filter((e) => e.kind === 'task'),
    [store.doneEntries]
  );
  const visible = useMemo(
    () => viewTasks(store.todoEntries, store.view, store.sortMode, query, today),
    [store.todoEntries, store.view, store.sortMode, query, today]
  );

  // 子任务索引：一次建好，行自己不再扫全表。
  // 索引要同时吃 todo 与 done：**已完成的子任务也算进度**（2/3 里的 2 就是它们），
  // 只看 todo 的话，子任务一完成就从进度里消失了，分母跟着缩水。
  const nesting = useMemo(
    () => buildNesting([...store.todoEntries, ...store.doneEntries]),
    [store.todoEntries, store.doneEntries]
  );
  // 编号列已隐藏：不再算行号，也不把它作为 prop 传进行。
  // 排序仍走 viewTasks / nestChildren —— 行号与顺序从来是两条独立链路。
  // 「今天」自 2026-11-16 起也带层级：子任务挂在父任务下面，可以展开 / 收起
  // （分组仍按紧急度，见 lib/sortFilter.js 的 todayGroups）。
  const expandable = store.view !== 'done';

  // 本屏真正铺出来的任务 id（还没算收起）：箭头只在「有子任务落在本屏」时出现。
  // 只看 kids.total 会画出点开为空的箭头 —— 「即将到期」里子任务没截止日就是这样。
  const visibleIds = useMemo(() => new Set(visible.map((t) => t.id)), [visible]);

  // 层级只数「本屏也在」的祖先：父行不在本屏时 nestChildren 已经把它降级成
  // 顶层行，这里若仍按全表算层级，就会出现"缩进着、却没有父任务"的孤行
  // —— 视觉上像挂在前一条任务下面，正是"层级混乱"的来源。
  const depthOf = useCallback(
    (t) => (expandable ? depthWithin(nesting, t, visibleIds) : 0),
    [nesting, expandable, visibleIds]
  );

  // 「能不能展开」在两处共用：行尾箭头与组头的一键展开/收起。
  // 两处各自算一遍，迟早会出现「按钮说能收、行上却没有箭头」。
  const canExpandTask = useCallback(
    (t) => {
      if (!expandable) return false;
      const kids = childProgress(nesting, t.stableId);
      return kids.total > 0 && (nesting.byParent.get(t.id) || []).some((k) => visibleIds.has(k.id));
    },
    [nesting, expandable, visibleIds]
  );

  const rowProps = useCallback(
    (t, childTail = false) => {
      const kids = childProgress(nesting, t.stableId);
      const canExpand = canExpandTask(t);
      const key = t.stableId || t.id;
      return {
        depth: depthOf(t),
        kids,
        hasChildren: canExpand,
        collapsed: canExpand && collapsed.has(key),
        onToggleExpand: canExpand ? () => toggleExpand(key) : null,
        childLast: childTail,
      };
    },
    [nesting, canExpandTask, depthOf, collapsed, toggleExpand]
  );

  // 组头的一键按钮只作用于本屏真有可展开子项的父任务。
  // 只要有任意一枚还收着，按钮就是「展开全部」；全部摊开时才是「收起全部」。
  const expandableKeys = useMemo(
    () => visible.filter(canExpandTask).map((t) => t.stableId || t.id),
    [visible, canExpandTask]
  );
  const allExpanded = expandableKeys.length > 0 && !expandableKeys.some((k) => collapsed.has(k));
  const toggleAllAction =
    expandableKeys.length === 0 ? null : (
      <button
        type="button"
        className="group-toggle"
        onClick={() => setAllCollapsed(expandableKeys, allExpanded)}
        aria-label={allExpanded ? '收起全部子任务' : '展开全部子任务'}
        title={allExpanded ? '收起全部子任务' : '展开全部子任务'}
      >
        <Icon name={allExpanded ? 'chevrons-up' : 'chevrons-down'} size={16} />
      </button>
    );

  const rawSection = (store.view === 'all' || store.view === 'inbox') && rawEntries.length > 0;

  if (store.view === 'done') {
    if (doneTasks.length === 0) return <div className="empty-state">日志还是空的</div>;
    return (
      <div className="task-list">
        <GroupHead label="日志 · done.txt（只读）" count={doneTasks.length} />
        {doneTasks.map((task) => (
          <TaskRow key={task.id} task={task} store={store} query={query} readonly />
        ))}
      </div>
    );
  }

  const renderRawSection = () =>
    rawSection ? (
      <>
        {/* 未识别行是「类别」不是「逾期」：不借 --danger，行内已有 --warn 三角记号 */}
        <GroupHead label="未识别行 · 原样保留" count={rawEntries.length} />
        {rawEntries.map((e) => (
          <div key={e.id} className="task-row row-readonly raw-line">
            <span className="raw-flag">
              <Icon name="alert-triangle" size={16} />
            </span>
            <span className="task-title">{e.raw}</span>
          </div>
        ))}
      </>
    ) : null;

  if (visible.length === 0) {
    if (query) return <div className="empty-state">无匹配任务：“{query}”</div>;
    if (store.view === 'today') return <EmptyToday store={store} />;
    if (store.view === 'upcoming') return <div className="empty-state">未来几天没有带截止日的任务</div>;
    if (!rawSection) return <div className="empty-state">暂无任务，按 n 键开始添加</div>;
  }

  if (store.view === 'today') {
    // visible 已按「父前子后」排过（viewTasks），分组保持这个相邻关系；
    // 收起态在这三组里同样生效 —— 否则收起父项后子行仍摊在下面。
    const groups = todayGroups(visible, today, nesting);
    const pick = (list) => filterCollapsed(list, nesting, collapsed);
    const overdue = pick(groups.overdue);
    const dueToday = pick(groups.dueToday);
    const noDate = pick(groups.noDate);
    // 三组各自铺连续子行：连接线的收尾按「这一组」算，跨组的行不连成一条。
    const overdueTails = childRunTails(overdue, depthOf);
    const dueTodayTails = childRunTails(dueToday, depthOf);
    const noDateTails = childRunTails(noDate, depthOf);
    return (
      <div className="task-list">
        {overdue.length > 0 && (
          <GroupHead label="逾期" count={groups.overdue.length} tone="overdue" />
        )}
        {overdue.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            store={store}
            query={query}
            {...rowProps(t, overdueTails.has(t.id))}
          />
        ))}
        {dueToday.length > 0 && (
          <GroupHead label="今天到期" count={groups.dueToday.length} />
        )}
        {dueToday.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            store={store}
            query={query}
            {...rowProps(t, dueTodayTails.has(t.id))}
          />
        ))}
        {noDate.length > 0 && <GroupHead label="无日期" count={groups.noDate.length} />}
        {noDate.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            store={store}
            query={query}
            {...rowProps(t, noDateTails.has(t.id))}
          />
        ))}
      </div>
    );
  }

  // 子任务紧随父任务出场（父不在本屏时降级顶层，绝不消失）；缩进与次级字号由 is-child 表达。
  // 收起父项时把它下面整条后代链一起撤掉，不留半截缩进的孤行。
  // filterCollapsed 只认「父也在这屏」的层级，避免切视图 / 搜索后任务凭空消失。
  const nested = nestChildren(visible, nesting);
  const ordered = filterCollapsed(nested, nesting, collapsed);
  const childTails = childRunTails(ordered, depthOf);
  return (
    <div className="task-list">
      <GroupHead
        label={store.view === 'inbox' ? '收集箱' : store.view === 'upcoming' ? '即将到期' : '全部任务'}
        count={visible.length}
        action={toggleAllAction}
      />
      {ordered.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          store={store}
          query={query}
          {...rowProps(t, childTails.has(t.id))}
        />
      ))}
      {renderRawSection()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 活动栏 —— 原型把页签从"顶部横向条"改成"左侧 46px 纵向轨道"。
//
// 保留的契约：
//   · 两个页签仍在 .tabs-group .tab 里，且文字内容就是页签名（QA 依赖这一条）；
//   · 轨道底部：应用菜单 / 置顶 / 主题，主题只有**一枚**按钮，点一次轮换一档。
//     「设置」不再单列按钮，入口收进应用菜单，避免同一个动作摆两处。
// ---------------------------------------------------------------------------
export function Tabs({
  tab,
  onChange,
  store,
  onOpenSettings,
  alwaysOnTop,
  onToggleTop,
  themeMode,
  onPickTheme,
  onCycleTheme,
  onOpenSearch,
  listMode = 'list',
  onPickListMode,
}) {
  const { openAt } = useContextMenu();
  const menuBtnRef = useRef(null);

  // 列表页的动作需要先切页签再聚焦，React 提交后再 focus。
  // 设置页关掉后组件才挂载，所以这里重试几帧而不是只等一次 setTimeout。
  const focusAfterSwitch = (ref) => {
    onChange('list');
    const tryFocus = (left) => {
      if (ref && ref.current) {
        ref.current.focus();
        return;
      }
      if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
    };
    requestAnimationFrame(() => tryFocus(4));
  };

  // 应用菜单「外观」分组的三档条目，与轨道上三枚主题按钮读同一份档位表。
  const themeItems = THEME_MODES.map((m) => ({
    type: 'item',
    label: THEME_LABELS[m],
    checked: (themeMode || 'auto') === m,
    onClick: () => onPickTheme && onPickTheme(m),
  }));

  // 两级菜单：一级只列分组，具体动作全在二级里逐级展开。
  // 结构与动作清单在 lib/appMenu.js（纯函数、已单测），这里只把外壳状态接进去。
  const openAppMenu = () => {
    const btn = menuBtnRef.current;
    if (!btn || !store) return;
    const r = btn.getBoundingClientRect();
    openAt(r.right + 3, r.top, buildAppMenuItems({
      tab,
      listMode,
      alwaysOnTop,
      tabs: TABS,
      themeItems,
      store,
      showListMode: Boolean(onPickListMode),
      on: {
        focusAfterSwitch,
        changeTab: onChange,
        pickListMode: onPickListMode,
        toggleTop: onToggleTop,
        openSettings: onOpenSettings,
        openSearch: onOpenSearch,
      },
    }));
  };

  return (
    <nav className="tabs" aria-label="工作区">
      <div className="tabs-group" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={'tab' + (tab === id ? ' active' : '')}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onChange(id)}
          >
            <Icon name={TAB_ICONS[id]} size={16} />
            <span className="tip">{label}</span>
          </button>
        ))}
      </div>

      <span className="rail-sep" />

      {store && (
        <button
          type="button"
          className="tab"
          ref={menuBtnRef}
          onClick={openAppMenu}
          aria-haspopup="menu"
        >
          <Icon name="menu" size={16} />
          <span className="tip">应用菜单</span>
        </button>
      )}

      <span className="spacer" />

      {onToggleTop && (
        <button
          type="button"
          className={'tab' + (alwaysOnTop ? ' is-pinned' : '')}
          onClick={onToggleTop}
          title={alwaysOnTop ? '取消窗口置顶' : '窗口置顶（总在最前）'}
          aria-pressed={Boolean(alwaysOnTop)}
        >
          {/* 置顶态只把针实心化，不套底色块：底色会把轨道读成一排按钮开关。
              图钉斜 45°（2026-11-15）：正着画的图钉像别针，斜过来才是"钉住"。 */}
          <Icon name="pin" size={16} className="pin-tilt" fill={alwaysOnTop ? 'currentColor' : 'none'} />
          <span className="tip">{alwaysOnTop ? '取消置顶' : '窗口置顶'}</span>
        </button>
      )}
      {onCycleTheme && (
        <button
          type="button"
          data-mode={themeMode || 'auto'}
          className="tab"
          onClick={onCycleTheme}
          title={'主题 · ' + THEME_LABELS[themeMode || 'auto'] + '（点按换下一档）'}
          aria-label={'主题：' + THEME_LABELS[themeMode || 'auto']}
        >
          {/* 一枚按钮三档轮换：图标画的就是当前档 —— 显示器＝跟随系统、
              太阳＝深色（点它回浅色）、月亮＝浅色（点它去深色）。 */}
          <Icon name={THEME_ICONS[themeMode || 'auto']} size={16} />
          <span className="tip">{THEME_LABELS[themeMode || 'auto']}</span>
        </button>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// 今日概览已于 2026-11-14 整块移除（连同底部状态栏）：用户要的是"任务本身占满
// 竖向空间"。原来那四个数字只读派生自 entries，删掉不涉及任何数据链路；
// 保存状态与「手动重载 / 切换目录」搬进了设置页「数据」节。
// ---------------------------------------------------------------------------

// 页签切换的一次性过渡信号：切页时为 true，200ms 后收回。
// 首屏渲染不算「切换」，不走动画。
function useTabSwitch(tab) {
  const [switching, setSwitching] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSwitching(true);
    const t = setTimeout(() => setSwitching(false), 200);
    return () => clearTimeout(t);
  }, [tab]);
  return switching;
}

// 引导 / 重新授权 / 不支持页没有活动栏与上下文条，但自绘标题栏仍需要一条
// 可拖拽的横条：macOS 不这么做红绿灯会压在正文上；Windows 不这么做窗口既拖不动、
// 也没有窗控可用（系统边框已被去掉）。
function BareShell({ chrome, platform, children }) {
  if (!chrome) return children;
  const isWindows = platform === 'windows';
  return (
    <div className="app has-titlebar is-bare" data-platform={platform}>
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title">待办清单</span>
        {isWindows && <WindowControls />}
      </div>
      <div className="workspace">{children}</div>
      {isWindows && <WindowResizeHandles />}
    </div>
  );
}

export default function App() {
  const store = useTodoStore();
  // 壳级行为：关窗握手刷盘 / 启动时一次 git 提交 / 09:00 提醒。
  // 浏览器版内部整体短路（isTauri() 为假），不产生任何副作用或网络请求。
  useNativeShell(store);
  // 窗口置顶：状态由壳广播回传，按钮与托盘菜单共用一个真相。
  const { onTop: alwaysOnTop, toggle: toggleAlwaysOnTop } = useAlwaysOnTop();
  // 明暗档位：不进壳、不进数据目录，只落本机配置 + <html data-theme>。
  // 活动栏那枚按钮点一次轮换一档（THEME_CYCLE），菜单里仍可直接选档。
  const { mode: themeMode, pick: pickThemeMode, cycle: cycleThemeMode } = useTheme();
  const query = useDebounce(store.search, 150);
  const [tab, setTab] = useState('list');
  // 侧栏折叠只是"看不看目录"，不影响任何数据 —— 因此不进 store，也不落盘。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 搜索平时只是一枚放大镜：输入框按需挂载，所以开关状态在 App 里（/ 键、右键
  // 菜单、应用菜单都要能把它打开，三处不能各存一份）。
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // 输入框是条件渲染的：这一帧可能还没挂上，下一帧再聚焦；已经开着就直接聚焦。
    if (store.searchRef.current) store.searchRef.current.focus();
    else requestAnimationFrame(() => {
      if (store.searchRef.current) store.searchRef.current.focus();
    });
  }, [store.searchRef]);
  // 关闭时连关键词一起清掉 —— 筛选还在、输入框却不见了，任务会凭空少一半。
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    if (store.search) store.setSearch('');
  }, [store.search, store.setSearch]);
  // 折叠态提到 App：主列表渲染、↑↓ 导航、顶栏「共 N 项」三处读同一份。
  const { collapsed, toggleExpand, setAllCollapsed } = useRowCollapse();
  // 列表显示模式（列表 / 日历）：外观**偏好**走 configStore，不进 todo.txt（红线③）。
  // 2026-11-11 起偏好与「此刻实际用哪种布局」分开：窄边只临时改布局，永不写盘。
  const [preferredMode, pickListMode] = useListMode();
  const [mainEl, setMainEl] = useState(null);
  const { effective: effectiveMode, narrow, override, setOverride } =
    useLayoutMode({ preferred: preferredMode, mainEl });
  // 日历的唯一真相是选中的日期，显示的月份恒由它派生 —— 翻月 / 移周都只改日期，
  // "选中日不在显示月内"这种失同步从结构上就不可能发生。
  const [calDay, setCalDay] = useState(() => dayjs().format('YYYY-MM-DD'));
  const calMonth = monthKey(calDay);
  // 日历新建的信号：{ date, seq }。seq 让"同一天再点一次新建"也是一次新信号。
  // 2026-11-15 起日历页没有常驻快录框，新建 = 打开那一天的浮层并直接进添加态。
  const [calAdd, setCalAdd] = useState(null);
  const addSeq = useRef(0);
  // 列表页键盘导航用的顺序：非「今天」视图与主列表完全同源
  // （viewTasks → nestChildren → filterCollapsed），否则收起父项后 ↑↓ 会选中
  // DOM 里根本不存在的行，选中态与光标一起丢，顶栏计数也会虚高。
  // 「今天」视图按紧急度分组渲染、不启用折叠，沿用 displayOrder。
  const orderedIds = useMemo(() => {
    if (store.view === 'done') return [];
    const today = dayjs().format('YYYY-MM-DD');
    const nestingForNav = buildNesting([...store.todoEntries, ...store.doneEntries]);
    // 「今天」也带层级了（2026-11-16）：收起父项后 ↑↓ 不能再走进被藏起来的子行，
    // 所以这里和其余视图一样过一遍 filterCollapsed。
    if (store.view === 'today') {
      const ordered = displayOrder(store.todoEntries, store.view, store.sortMode, query, today);
      return filterCollapsed(ordered, nestingForNav, collapsed).map((t) => t.id);
    }
    const visible = viewTasks(store.todoEntries, store.view, store.sortMode, query, today);
    return filterCollapsed(nestChildren(visible, nestingForNav), nestingForNav, collapsed).map((t) => t.id);
  }, [store.todoEntries, store.doneEntries, store.view, store.sortMode, query, collapsed]);
  // 页签切换过渡：内容区一次 140ms 的轻淡入。刻意不走「按 key 重挂内容」——
  // 那会把侧栏展开状态一起重置，代价远超收益；这里只让整个
  // 内容区Opacity 沉一下再起来，不碰任何组件的生命周期。
  const tabSwitching = useTabSwitch(tab);
  // 设置是独立页面，不占页签：打开时主内容整体让位，Esc / 「返回」退出。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isCalendar = tab === 'list' && !settingsOpen && effectiveMode === 'calendar';
  // 三处开关显示「用户选的」偏好；只有主区渲染、面包屑、计数、快捷键分派读有效布局。
  const layoutNotice = noticeState({
    preferred: preferredMode, narrow, override, effective: effectiveMode,
  });
  const todayStr = dayjs().format('YYYY-MM-DD');
  // 日历投影：页眉计数与主区渲染共用这一份，"有几条"不会分叉（lib/calendar.js 已单测）。
  // 只吃 todo.txt 的未完成任务 —— 日志（done.txt）不是日历的数据源（二十改）。
  const calProjection = useMemo(() => {
    if (!isCalendar) return null;
    return projectionForMonth(store.todoEntries, query, todayStr, calMonth);
  }, [isCalendar, store.todoEntries, query, todayStr, calMonth]);
  // 工具页的只读投影：派生逻辑全在 lib/todoSnapshot.js（纯函数、可单测）。
  // 工具拿到的是它，而不是 store —— "默认只读"因此是技术事实而非口头约定。
  // 设置页的列表外观需要知道有哪些 +项目：与侧栏同源（sidebarStats 是唯一口径），
  // 设置页不自己扫一遍 todo.txt，免得两处对"列表"的定义分叉。
  const projects = useMemo(() => sidebarStats(store.todoEntries).projects, [store.todoEntries]);
  const snapshot = useTodoSnapshot(store);
  // 设置页覆盖着主内容，所以点页签必须连带把设置页关掉 ——
  // 否则会出现"点了「列表」什么都没发生"的假死观感。
  const goTab = (next) => {
    setSettingsOpen(false);
    setTab(next);
  };
  const pickMode = (m) => {
    // 隔了很久再切回日历时先拉回本月 —— 别把用户晾在一个不知什么时候的旧月份上。
    if (m === 'calendar' && monthKey(calDay) !== dayjs().format('YYYY-MM')) {
      setCalDay(dayjs().format('YYYY-MM-DD'));
    }
    pickListMode(m);
    // 显式选择优先于自动降级：窄边里再点「日历」= 本次就要日历（只覆盖本次会话）。
    setOverride(narrow && m === 'calendar' ? 'calendar' : null);
  };
  // 设置页等入口直接写 configStore、不经过 App.pickMode。订阅到偏好变化后
  // 统一同步覆盖态，避免三处入口行为分叉。
  const prevPreferredRef = useRef(preferredMode);
  useEffect(() => {
    if (prevPreferredRef.current !== preferredMode) {
      prevPreferredRef.current = preferredMode;
      setOverride(narrow && preferredMode === 'calendar' ? 'calendar' : null);
    }
  }, [preferredMode, narrow]);
  // 从日历布局切走时清掉只属于日历的状态：focusedId 残留会让 ↑↓ 以一个
  // 可能已不可见的任务为起点。（日历的添加入口自 2026-11-15 起是浮层，随组件卸载消失，
  // 不再有"预填的 due: 跟着进列表"这条路。）
  const prevCalendarRef = useRef(isCalendar);
  useEffect(() => {
    const wasCalendar = prevCalendarRef.current;
    prevCalendarRef.current = isCalendar;
    if (wasCalendar && !isCalendar) store.setFocusedId(null);
    // 依赖只挑稳定的 setFocusedId（useState 的 setter）：整个 store 每次渲染
    // 都是新对象，写进依赖会让这个 effect 每帧空跑一遍。
  }, [isCalendar, store.setFocusedId]);
  // 翻月带着选中日一起走（dayjs 对短月自动收敛：1月31 → 2月28），选中日恒在显示月内。
  const navCalMonth = (delta) => setCalDay((d) => dayjs(d).add(delta, 'month').format('YYYY-MM-DD'));
  const calToday = () => setCalDay(dayjs().format('YYYY-MM-DD'));
  // 日历只有一份数据来源：「全部」里的未完成。日志（done.txt）是已完成的记录，
  // 不映射到日历（2026-11-16 二十改）。所以从「日志」视图切进日历时，视图一并落回
  // 「全部」—— 否则面包屑写着「日志」、格子里画的却是别的任务。
  useEffect(() => {
    if (isCalendar && store.view === 'done') store.selectView('all');
  }, [isCalendar, store.view, store.selectView]);
  // 日历里新建 = 打开那一天的浮层并直接进添加态。写入仍是同一条 addTask 链路，
  // todo.txt 里落下的就是一行标准的 `due:YYYY-MM-DD`。
  const createOnDay = (date) => {
    setCalDay(date);
    addSeq.current += 1;
    setCalAdd({ date, seq: addSeq.current });
  };
  const { openMenu } = useContextMenu();
  // macOS 用 overlay 标题栏、Windows 用自绘标题栏，都把上下文条抬到窗口第一行；
  // 浏览器与 Linux 保留各自的原生窗口框，不为了统一外观去换掉系统的命中测试。
  const shellPlatform = isTauri() ? hostPlatform() : 'web';
  const customTitlebar = usesCustomTitlebar(shellPlatform);
  const isWindowsShell = shellPlatform === 'windows';

  // 列表空白处的右键：当前视图下的通用动作（任务行自己会先拦掉右键，不会走到这里）
  const handleMainContextMenu = (e) => {
    openMenu(e, [
      {
        type: 'item',
        label: '新建任务',
        accel: 'N',
        onClick: () => {
          if (isCalendar) createOnDay(calDay);
          else if (store.quickAddRef.current) store.quickAddRef.current.focus();
        },
      },
      {
        type: 'item',
        label: '搜索',
        accel: '/',
        onClick: openSearch,
      },
      // 日历恒按日期分组、组内 compareAuto，排序模式对它没有作用对象；
      // 摆两项「改了没反应」的菜单只会让人以为坏了。列表里照旧。
      ...(isCalendar
        ? []
        : [
            { type: 'sep' },
            {
              type: 'item',
              label: '自动排序',
              checked: store.sortMode === 'auto',
              onClick: () => store.setSortMode('auto'),
            },
            {
              type: 'item',
              label: '手动排序（文件行序）',
              checked: store.sortMode === 'manual',
              onClick: () => store.setSortMode('manual'),
            },
          ]),
      { type: 'sep' },
      { type: 'item', label: '重新载入文件', onClick: store.manualReload },
    ]);
  };

  // ↑↓ 在列表里移动选中项：到达首/尾即停（不环绕），未选中时向下选第一条、向上选最后一条。
  // 日历里分两种焦点：焦点在「当天任务」浮层里时照旧移行（浮层是唯一能看到一天全部任务的地方）；
  // 焦点在网格上时 ↑↓ 跨周（←→ 移日由网格自己处理）。
  const moveSelection = useCallback(
    (delta) => {
      if (isCalendar) {
        const active = document.activeElement;
        const dayRows = (calProjection && calProjection.byDate.get(calDay)) || [];
        if (active && active.closest && active.closest('.cal-pop') && dayRows.length > 0) {
          const ids = dayRows.map((t) => t.id);
          const cur = ids.indexOf(store.focusedId);
          const next =
            cur === -1
              ? delta > 0
                ? 0
                : ids.length - 1
              : Math.min(ids.length - 1, Math.max(0, cur + delta));
          if (ids[next] !== store.focusedId) store.setFocusedId(ids[next]);
        } else {
          setCalDay((d) => shiftDate(d, delta * 7));
        }
        return;
      }
      if (orderedIds.length === 0) return;
      const cur = orderedIds.indexOf(store.focusedId);
      const next =
        cur === -1
          ? delta > 0
            ? 0
            : orderedIds.length - 1
          : Math.min(orderedIds.length - 1, Math.max(0, cur + delta));
      if (orderedIds[next] !== store.focusedId) store.setFocusedId(orderedIds[next]);
    },
    [isCalendar, calProjection, calDay, orderedIds, store.focusedId, store.setFocusedId]
  );

  useHotkeys({
    // 设置页打开时禁用全局快捷键 —— 否则在设置里按 Esc 会顺手清掉列表页的搜索词。
    // 编辑浮窗打开时也禁用：e / n 不该穿透到浮窗后面的列表（Esc / 回车由浮窗自己处理）。
    enabled: tab === 'list' && !settingsOpen && !store.editingTask,
    onNew: () => {
      // 日历里的 n = 在选中那天新建（预填 due:），列表里照旧聚焦快速添加。
      if (isCalendar) createOnDay(calDay);
      else if (store.quickAddRef.current) store.quickAddRef.current.focus();
    },
    onSearch: openSearch,
    onMove: moveSelection,
    onEdit: () => {
      if (store.focusedId) store.openEditor(store.focusedId);
    },
    onEnter: () => {
      if (store.focusedId) store.openEditor(store.focusedId);
    },
    onEscape: () => {
      const action = resolveEscape({
        editing: Boolean(store.editingTask),
        conflict: Boolean(store.conflict),
        searchOpen,
        search: store.search,
        focusedId: store.focusedId,
      });
      if (action === 'close-editor') store.closeEditor();
      else if (action === 'close-search') {
        // 与旧行为一致：一次 Esc 把搜索框、关键词和选中行一起收掉，
        // 不要拆成两次 —— 那样第一次按下去会像「没关干净」。
        closeSearch();
        store.setFocusedId(null);
      } else if (action === 'clear-selection') store.setFocusedId(null);
      else if (action === 'hide-to-tray') hideToTray(store.saveNow);
    },
    onUndo: store.undo,
  });

  // 设置页的全局快捷键：Ctrl+, 打开、Esc 退出；Ctrl+1/2 在两个页签之间切换；
  // Ctrl+B 折叠 / 展开侧栏（只在列表页有意义）。
  // 这几条与页签无关（工具页里也能直接开设置、直接跳页）。
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === ',') {
          e.preventDefault();
          setSettingsOpen(true);
          return;
        }
        if (e.key.toLowerCase() === 'b') {
          e.preventDefault();
          setSidebarCollapsed((v) => !v);
          return;
        }
        const idx = '123'.indexOf(e.key);
        if (idx >= 0 && idx < TABS.length) {
          e.preventDefault();
          goTab(TABS[idx][0]);
          return;
        }
      }
      if (e.key === 'Escape' && settingsOpen) setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // goTab 只用到 setState（引用稳定），所以不必进依赖表；dep 留 settingsOpen 是为了
    // 让 Esc 能读到最新的开关状态。
  }, [settingsOpen]);

  if (!store.supported) {
    return (
      <BareShell chrome={customTitlebar} platform={shellPlatform}>
        <UnsupportedPage />
      </BareShell>
    );
  }
  if (!store.dirReady && store.authNeeded) {
    return (
      <BareShell chrome={customTitlebar} platform={shellPlatform}>
        <ReauthPage store={store} />
      </BareShell>
    );
  }
  if (!store.dirReady) {
    return (
      <BareShell chrome={customTitlebar} platform={shellPlatform}>
        <WelcomePage store={store} />
      </BareShell>
    );
  }

  const topBar = (
    <TopBar
      store={store}
      tab={tab}
      settingsOpen={settingsOpen}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      chrome={customTitlebar}
      listMode={preferredMode}
      effectiveMode={effectiveMode}
      searchOpen={searchOpen}
      onOpenSearch={openSearch}
      onCloseSearch={closeSearch}
    />
  );

  return (
    <div
      className={'app' + (customTitlebar ? ' has-titlebar' : '')}
      data-platform={shellPlatform}
    >
      {customTitlebar && (
        <div className="titlebar">
          {topBar}
          {isWindowsShell && <WindowControls />}
        </div>
      )}

      <Tabs
        tab={tab}
        onChange={goTab}
        store={store}
        onOpenSettings={() => setSettingsOpen(true)}
        alwaysOnTop={alwaysOnTop}
        onToggleTop={toggleAlwaysOnTop}
        themeMode={themeMode}
        onPickTheme={pickThemeMode}
        onCycleTheme={cycleThemeMode}
        listMode={preferredMode}
        onPickListMode={pickMode}
        onOpenSearch={openSearch}
      />

      <div className="workspace">
        {!customTitlebar && topBar}

        <div
          className={
            'content' +
            (!settingsOpen && tab === 'list' ? ' layout' : '') +
            (tabSwitching ? ' is-switching' : '')
          }
        >
          {settingsOpen ? (
            <SettingsPage store={store} onClose={() => setSettingsOpen(false)} projects={projects} />
          ) : tab === 'tools' ? (
            <ToolsPage snapshot={snapshot} store={store} />
          ) : (
            <>
              <Sidebar
                store={store}
                collapsed={sidebarCollapsed}
                // 日历入口接管显示模式切换（2026-11-15）：侧栏点「日历」= pickMode('calendar')，
                // 点其余视图回列表布局；与页眉开关、应用菜单读同一份偏好。
                listMode={preferredMode}
                onPickListMode={pickMode}
              />
              <main
                ref={setMainEl}
                className={'main' + (isCalendar ? ' main-calendar' : '')}
                onContextMenu={handleMainContextMenu}
              >
                {isCalendar ? (
                  <>
                    <LayoutNotice
                      state={layoutNotice}
                      onUseCalendar={() => setOverride('calendar')}
                      onRestoreAuto={() => setOverride(null)}
                    />
                    <CalendarView
                      store={store}
                      query={query}
                      projection={calProjection}
                      day={calDay}
                      month={calMonth}
                      onPickDay={setCalDay}
                      onNavMonth={navCalMonth}
                      onToday={calToday}
                      addSignal={calAdd}
                    />
                  </>
                ) : (
                  <div className="list-col">
                    <div className="quick-add-bar">
                      <QuickAdd store={store} inputRef={store.quickAddRef} />
                    </div>
                    <LayoutNotice
                      state={layoutNotice}
                      onUseCalendar={() => setOverride('calendar')}
                      onRestoreAuto={() => setOverride(null)}
                    />
                    <MainList
                      store={store}
                      query={query}
                      collapsed={collapsed}
                      toggleExpand={toggleExpand}
                      setAllCollapsed={setAllCollapsed}
                    />
                  </div>
                )}
              </main>
            </>
          )}
        </div>

        {/* 2026-11-14：今日概览条与底部状态栏整行移除，竖向空间全给任务行。
            保存状态 / 重载 / 切目录搬进设置页「数据」节。 */}
      </div>

      {/* 窄屏底部导航：宽屏 display:none（整条不参与网格，不占高度）。
          只在列表页出现 —— 工具页与设置页没有"按视图筛任务"这回事。 */}
      {!settingsOpen && tab === 'list' && (
        <BottomNav store={store} listMode={preferredMode} onPickListMode={pickMode} />
      )}

      <EditDrawer store={store} />
      <Toast toast={store.toast} onClose={store.dismissToast} />
      {store.conflict && <ConflictModal store={store} />}
      {isWindowsShell && <WindowResizeHandles />}
    </div>
  );
}
