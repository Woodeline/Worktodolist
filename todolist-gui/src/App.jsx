import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useTodoStore } from './hooks/useTodoStore';
import { useNativeShell } from './hooks/useNativeShell';
import { useAlwaysOnTop } from './hooks/useAlwaysOnTop';
import { isTauri } from './lib/runtime.js';
import { useTodoSnapshot } from './hooks/useTodoSnapshot';
import useDebounce from './hooks/useDebounce';
import useHotkeys from './hooks/useHotkeys';
import { useContextMenu } from './hooks/useContextMenu.jsx';
import { displayOrder, isVisibleToday, sidebarStats, todayGroups, viewTasks } from './lib/sortFilter';
import { buildNesting, childProgress, depthOf } from './lib/subtasks.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import TaskRow from './components/TaskRow.jsx';
import QuickAdd from './components/QuickAdd.jsx';
import EditDrawer from './components/EditDrawer.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import ToolsPage from './components/tools/ToolsPage.jsx';
import Icon from './components/Icon.jsx';

// 三个页签是同一层级的"工作区"：对话（说）、列表（看）、工具（算）。
// 顺序即 Ctrl+1 / 2 / 3 的绑定顺序，也是左侧活动栏自上而下的顺序。
export const TABS = [
  ['chat', '对话'],
  ['list', '列表'],
  ['tools', '工具'],
];

// 活动栏是纯图标：图标只负责"认出是哪个区"，文字交给悬停提示。
const TAB_ICONS = { chat: 'message-square', list: 'list', tools: 'toolbox' };


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

export function WelcomePage({ store }) {
  // 这一步的文案在两种运行方式下必须不同：壳里 `ws_pick` 走系统目录选择框，
  // 选完即可写，**没有**任何"允许编辑文件"的授权弹窗。照抄浏览器文案会让用户
  // 干等一个永远不出现的对话框。浏览器分支的字符串保持原样不动。
  const shell = isTauri();
  return (
    <div className="welcome">
      <h1>待办清单</h1>
      <p className="welcome-sub">第一次使用，只要 3 步：</p>
      <ol className="welcome-steps">
        <li>点下面的蓝色按钮</li>
        <li>
          在弹出的窗口里找到 <code>WorkBuddy</code> 文件夹，再进去选中 <code>todolist</code> 文件夹，点「选择文件夹」
        </li>
        <li>
          {shell ? (
            <>选完即可读写，这里不会再弹授权框</>
          ) : (
            <>
              浏览器弹出「是否允许编辑文件」时，点 <strong>允许</strong>（有的版本写「编辑文件」）
            </>
          )}
        </li>
      </ol>
      <button className="btn btn-primary btn-lg" onClick={store.pickDirectory}>
        选好文件夹，开始用
      </button>
      <p className="hint">
        你的任务存在 <code>todo.txt</code> 这个纯文本文件里（可以用记事本打开看）。
        {shell ? '选一次会记住，下次打开直接进来。' : '授权一次浏览器会记住，下次打开直接进来。'}
      </p>
    </div>
  );
}

export function ReauthPage({ store }) {
  const shell = isTauri();
  return (
    <div className="welcome">
      <h1>再点一下就能继续</h1>
      <p className="welcome-sub">
        {shell
          ? '上次选的数据目录现在不可用了（可能被移动、改名或所在磁盘没挂上）。'
          : '浏览器出于安全，隔一段时间需要重新确认一次文件权限。'}
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
        <Icon name="check-circle" size={26} />
      </div>
      <p>今天已清空，干得漂亮！</p>
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
        <Icon name="x" size={13} />
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

export function Footer({ store }) {
  const savedLabel = store.lastSavedAt
    ? dayjs(store.lastSavedAt).format('HH:mm:ss')
    : '—';
  const statusText =
    store.saveStatus === 'unsaved' ? '未保存' : store.conflict ? '外部修改待处理' : '已保存';
  const dotClass = store.conflict ? 'danger' : store.saveStatus === 'unsaved' ? 'warn' : 'ok';
  const dotIcon = store.conflict
    ? 'alert-triangle'
    : store.saveStatus === 'unsaved'
      ? 'circle-half'
      : 'dot';

  return (
    <footer className="statusbar">
      <span className={`dot dot-${dotClass}`}>
        <Icon name={dotIcon} size={11} />
      </span>
      <span>{statusText}</span>
      <span>上次保存 {savedLabel}</span>
      <span className="spacer" />
      <button onClick={store.manualReload}>手动重载</button>
      <button onClick={store.pickDirectory}>切换目录</button>
    </footer>
  );
}

// 分组头：等宽小标签 + 左侧色条 + 右端计数（原型里的 .group）。
// 不再画"延伸到底的规则线" —— 列表本身没有行分隔线，标题也不需要再画一条。
function GroupHead({ label, count, tone }) {
  return (
    <div className={'group-title' + (tone === 'overdue' ? ' group-overdue' : '')}>
      <span>{label}</span>
      {count != null && <em>{count}</em>}
    </div>
  );
}

export function MainList({ store, query }) {
  const today = dayjs().format('YYYY-MM-DD');

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
  // 「今天」视图刻意不按层级缩进 —— 那个视图先按紧急度分流，父子本来就会被拆到
  // 不同组，缩进一条没有父在旁边的行只会让人以为界面坏了。
  // 索引要同时吃 todo 与 done：**已完成的子任务也算进度**（2/3 里的 2 就是它们），
  // 只看 todo 的话，子任务一完成就从进度里消失了，分母跟着缩水。
  const nesting = useMemo(
    () => buildNesting([...store.todoEntries, ...store.doneEntries]),
    [store.todoEntries, store.doneEntries]
  );
  const rowProps = useCallback(
    (t) => ({
      depth: store.view === 'today' ? 0 : depthOf(nesting, t),
      kids: childProgress(nesting, t.stableId),
    }),
    [nesting, store.view]
  );

  const rawSection = (store.view === 'all' || store.view === 'inbox') && rawEntries.length > 0;

  if (store.view === 'done') {
    if (doneTasks.length === 0) return <div className="empty-state">还没有已完成的任务</div>;
    return (
      <div>
        <GroupHead label="已完成 · done.txt（只读）" count={doneTasks.length} />
        {doneTasks.map((task) => (
          <TaskRow key={task.id} task={task} store={store} query={query} readonly />
        ))}
      </div>
    );
  }

  const renderRawSection = () =>
    rawSection ? (
      <>
        <GroupHead label="未识别行 · 原样保留" count={rawEntries.length} tone="overdue" />
        {rawEntries.map((e) => (
          <div key={e.id} className="task-row row-readonly raw-line">
            <span className="raw-flag">
              <Icon name="alert-triangle" size={14} />
            </span>
            <span className="task-title">{e.raw}</span>
          </div>
        ))}
      </>
    ) : null;

  if (visible.length === 0) {
    if (query) return <div className="empty-state">无匹配任务：“{query}”</div>;
    if (store.view === 'today') return <EmptyToday store={store} />;
    if (!rawSection) return <div className="empty-state">暂无任务，按 n 键开始添加</div>;
  }

  if (store.view === 'today') {
    const groups = todayGroups(visible, today);
    return (
      <div>
        {groups.overdue.length > 0 && (
          <GroupHead label="逾期" count={groups.overdue.length} tone="overdue" />
        )}
        {groups.overdue.map((t) => (
          <TaskRow key={t.id} task={t} store={store} query={query} {...rowProps(t)} />
        ))}
        {groups.dueToday.length > 0 && (
          <GroupHead label="今天到期" count={groups.dueToday.length} />
        )}
        {groups.dueToday.map((t) => (
          <TaskRow key={t.id} task={t} store={store} query={query} {...rowProps(t)} />
        ))}
        {groups.noDate.length > 0 && <GroupHead label="无日期" count={groups.noDate.length} />}
        {groups.noDate.map((t) => (
          <TaskRow key={t.id} task={t} store={store} query={query} {...rowProps(t)} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <GroupHead label={store.view === 'inbox' ? '收集箱' : '全部任务'} count={visible.length} />
      {visible.map((t) => (
        <TaskRow key={t.id} task={t} store={store} query={query} {...rowProps(t)} />
      ))}
      {renderRawSection()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 活动栏 —— 原型把页签从"顶部横向条"改成"左侧 46px 纵向轨道"。
//
// 保留的契约：
//   · 三个页签仍在 .tabs-group .tab 里，且文字内容就是页签名（QA 依赖这一条）；
//   · 应用菜单 / 置顶 / 设置三个入口一个不少，只是从顶栏右端搬到了轨道底部。
// ---------------------------------------------------------------------------
export function Tabs({ tab, onChange, store, onOpenSettings, settingsOpen, alwaysOnTop, onToggleTop }) {
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

  const openAppMenu = () => {
    const btn = menuBtnRef.current;
    if (!btn || !store) return;
    const r = btn.getBoundingClientRect();
    openAt(r.right + 3, r.top, [
      { type: 'item', label: '新建任务', accel: 'N', onClick: () => focusAfterSwitch(store.quickAddRef) },
      { type: 'item', label: '搜索', accel: '/', onClick: () => focusAfterSwitch(store.searchRef) },
      { type: 'item', label: '撤销上一步', accel: 'Ctrl+Z', onClick: store.undo },
      { type: 'sep' },
      { type: 'header', label: '页面' },
      ...TABS.map(([id, label], i) => ({
        type: 'item',
        label,
        accel: `Ctrl+${i + 1}`,
        checked: tab === id,
        onClick: () => onChange(id),
      })),
      { type: 'sep' },
      { type: 'header', label: '列表视图' },
      ...[
        ['today', '今天'],
        ['all', '全部'],
        ['done', '已完成'],
        ['inbox', '收集箱'],
      ].map(([v, label]) => ({
        type: 'item',
        label,
        checked: tab === 'list' && store.view === v,
        onClick: () => {
          onChange('list');
          store.selectView(v);
        },
      })),
      { type: 'sep' },
      { type: 'header', label: '排序' },
      {
        type: 'item',
        label: '手动（文件行序）',
        checked: tab === 'list' && store.sortMode === 'manual',
        onClick: () => {
          onChange('list');
          store.setSortMode('manual');
        },
      },
      {
        type: 'item',
        label: '自动（优先级 / 日期）',
        checked: tab === 'list' && store.sortMode === 'auto',
        onClick: () => {
          onChange('list');
          store.setSortMode('auto');
        },
      },
      { type: 'sep' },
      { type: 'header', label: '窗口' },
      {
        type: 'item',
        label: alwaysOnTop ? '取消窗口置顶' : '窗口置顶',
        checked: Boolean(alwaysOnTop),
        onClick: () => onToggleTop && onToggleTop(),
      },
      { type: 'item', label: '重新载入文件', onClick: store.manualReload },
      { type: 'item', label: '切换数据目录…', onClick: store.pickDirectory },
      { type: 'sep' },
      {
        type: 'item',
        label: '设置…',
        accel: 'Ctrl+,',
        onClick: () => onOpenSettings && onOpenSettings(),
      },
    ]);
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
            <Icon name={TAB_ICONS[id]} size={17} />
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
          <Icon name="menu" size={17} />
          <span className="tip">应用菜单</span>
        </button>
      )}

      <span className="spacer" />

      {onToggleTop && (
        <button
          type="button"
          className={'tab' + (alwaysOnTop ? ' is-on' : '')}
          onClick={onToggleTop}
          title={alwaysOnTop ? '取消窗口置顶' : '窗口置顶（总在最前）'}
          aria-pressed={Boolean(alwaysOnTop)}
        >
          <Icon name="pin" size={17} />
          <span className="tip">{alwaysOnTop ? '取消置顶' : '窗口置顶'}</span>
        </button>
      )}
      {onOpenSettings && (
        <button
          type="button"
          className={'tab' + (settingsOpen ? ' is-on' : '')}
          onClick={onOpenSettings}
          title="设置（Ctrl+,）"
        >
          <Icon name="settings" size={17} />
          <span className="tip">设置 · Ctrl+,</span>
        </button>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// 今日概览：贴在状态栏上方的可折叠统计条（原型里的 .panel）。
//
// 只读派生：四个数字全部由现有 entries 现算，不写回、不改动任何任务状态。
// ---------------------------------------------------------------------------
export function Overview({ store, open, onToggle }) {
  const today = dayjs().format('YYYY-MM-DD');

  const stats = useMemo(() => {
    const doneToday = store.doneEntries.filter(
      (e) => e.kind === 'task' && e.completedAt === today
    ).length;
    const todayTasks = store.todoEntries.filter(
      (e) => e.kind === 'task' && isVisibleToday(e, today)
    );
    const overdue = todayTasks.filter((t) => t.dueDate && t.dueDate < today).length;
    const pool = todayTasks.length + doneToday;

    // 近 7 天日均完成：窗口 [today-6, today]，分母固定 7 天 —— 今天才过半天，
    // 用"有记录的天数"当分母会把均值得意地抬高。
    const from = dayjs().subtract(6, 'day').format('YYYY-MM-DD');
    const week = store.doneEntries.filter(
      (e) => e.kind === 'task' && e.completedAt && e.completedAt >= from && e.completedAt <= today
    ).length;
    const highPrio = store.todoEntries.filter(
      (e) => e.kind === 'task' && !e.completed && e.priority === 'A'
    ).length;

    return {
      doneToday,
      pool,
      overdue,
      avg: (week / 7).toFixed(1),
      highPrio,
    };
  }, [store.todoEntries, store.doneEntries, today]);

  return (
    <section className={'overview' + (open ? ' is-open' : '')} aria-label="今日概览">
      <button
        type="button"
        className="overview-handle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Icon name="chevron-down" size={12} className="overview-chev" />
        <span>今日概览</span>
        <span className="overview-meta">
          完成 {stats.doneToday} / {stats.pool} · 逾期 {stats.overdue}
        </span>
      </button>
      <div className="overview-body">
        <div className="overview-stats">
          <div className="stat">
            <div className="stat-k">今日完成</div>
            <div className="stat-v stat-ok">
              {stats.doneToday}
              <small>/ {stats.pool}</small>
            </div>
          </div>
          <div className="stat">
            <div className="stat-k">逾期</div>
            <div className="stat-v stat-bad">{stats.overdue}</div>
          </div>
          <div className="stat">
            <div className="stat-k">近 7 天</div>
            <div className="stat-v">
              {stats.avg}
              <small>项/天</small>
            </div>
          </div>
          <div className="stat">
            <div className="stat-k">高优先级</div>
            <div className="stat-v">{stats.highPrio}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const store = useTodoStore();
  // 壳级行为：关窗握手刷盘 / 启动时一次 git 提交 / 09:00 提醒。
  // 浏览器版内部整体短路（isTauri() 为假），不产生任何副作用或网络请求。
  useNativeShell(store);
  // 窗口置顶：状态由壳广播回传，按钮与托盘菜单共用一个真相。
  const { onTop: alwaysOnTop, toggle: toggleAlwaysOnTop } = useAlwaysOnTop();
  const query = useDebounce(store.search, 150);
  const [tab, setTab] = useState('chat');
  // 侧栏折叠只是"看不看目录"，不影响任何数据 —— 因此不进 store，也不落盘。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 今日概览默认收起：列表页首屏优先给任务行本身。
  const [overviewOpen, setOverviewOpen] = useState(false);
  // 列表页键盘导航用的顺序：与主列表实际渲染顺序同源（displayOrder 是唯一排布口径）。
  // 只读视图（已完成）没有可选行，返回空数组让 ↑↓ 自然失效。
  const orderedIds = useMemo(() => {
    if (store.view === 'done') return [];
    const today = dayjs().format('YYYY-MM-DD');
    return displayOrder(store.todoEntries, store.view, store.sortMode, query, today).map((t) => t.id);
  }, [store.todoEntries, store.view, store.sortMode, query]);
  // 面包屑右侧的"共 N 项"：与列表同源，已完成视图没有可选行所以单独数。
  const listCount = useMemo(() => {
    if (store.view === 'done') return store.doneEntries.filter((e) => e.kind === 'task').length;
    return orderedIds.length;
  }, [store.view, store.doneEntries, orderedIds]);
  // 设置是独立页面，不占页签：打开时主内容整体让位，Esc / 「返回」退出。
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 工具页的只读投影：派生逻辑全在 lib/todoSnapshot.js（纯函数、可单测）。
  // 工具拿到的是它，而不是 store —— "默认只读"因此是技术事实而非口头约定。
  // 设置页的列表外观需要知道有哪些 +项目：与侧栏同源（sidebarStats 是唯一口径），
  // 设置页不自己扫一遍 todo.txt，免得两处对"列表"的定义分叉。
  const projects = useMemo(() => sidebarStats(store.todoEntries).projects, [store.todoEntries]);
  const snapshot = useTodoSnapshot(store);
  // 对话页 → 工具页的路由请求：{ id, params, seq }。seq 每发一次自增，
  // 工具页据此只消费一次（React 重渲染不会重复切页/重复聚焦）。
  const [toolRequest, setToolRequest] = useState(null);
  const toolReqSeq = useRef(0);
  // 设置页覆盖着主内容，所以点页签必须连带把设置页关掉 ——
  // 否则会出现"点了「列表」什么都没发生"的假死观感。
  const goTab = (next) => {
    setSettingsOpen(false);
    setTab(next);
  };
  // tool.open 的落地：切页 + 带参数（预填）+ 关掉设置页（一律走 goTab，不另写一套）
  const openTool = (id, plan) => {
    toolReqSeq.current += 1;
    setToolRequest({ id, params: plan ? { query: plan } : null, seq: toolReqSeq.current });
    goTab('tools');
  };
  const { openMenu } = useContextMenu();

  const findFocusedTask = () =>
    store.todoEntries.find((e) => e.id === store.focusedId && e.kind === 'task') || null;

  // 列表空白处的右键：当前视图下的通用动作（任务行自己会先拦掉右键，不会走到这里）
  const handleMainContextMenu = (e) => {
    openMenu(e, [
      {
        type: 'item',
        label: '新建任务',
        accel: 'N',
        onClick: () => store.quickAddRef.current && store.quickAddRef.current.focus(),
      },
      {
        type: 'item',
        label: '搜索',
        accel: '/',
        onClick: () => store.searchRef.current && store.searchRef.current.focus(),
      },
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
      { type: 'sep' },
      { type: 'item', label: '重新载入文件', onClick: store.manualReload },
    ]);
  };

  // ↑↓ 在列表里移动选中项：到达首/尾即停（不环绕），未选中时向下选第一条、向上选最后一条。
  const moveSelection = useCallback(
    (delta) => {
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
    [orderedIds, store.focusedId, store.setFocusedId]
  );

  useHotkeys({
    // 对话页签激活时禁用全局快捷键，改由 ChatPanel 内部处理（避免 / 与 Ctrl+Z 冲突）。
    // 设置页打开时同样禁用 —— 否则在设置里按 Esc 会顺手清掉列表页的搜索词。
    // 编辑浮窗打开时也禁用：空格 / e / n 不该穿透到浮窗后面的列表（Esc / 回车由浮窗自己处理）。
    enabled: tab === 'list' && !settingsOpen && !store.editingTask,
    onNew: () => store.quickAddRef.current && store.quickAddRef.current.focus(),
    onSearch: () => store.searchRef.current && store.searchRef.current.focus(),
    onMove: moveSelection,
    onToggle: () => {
      const task = findFocusedTask();
      if (task) store.toggleComplete(task);
    },
    onEdit: () => {
      if (store.focusedId) store.openEditor(store.focusedId);
    },
    onEnter: () => {
      if (store.focusedId) store.openEditor(store.focusedId);
    },
    onEscape: () => {
      if (store.editingTask) {
        store.closeEditor();
      } else {
        if (store.search) store.setSearch('');
        store.setFocusedId(null);
      }
    },
    onUndo: store.undo,
  });

  // 设置页的全局快捷键：Ctrl+, 打开、Esc 退出；Ctrl+1/2/3 在三个页签之间切换；
  // Ctrl+B 折叠 / 展开侧栏（只在列表页有意义）。
  // 这几条与页签无关（对话页里也能直接开设置、直接跳页）。
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

  if (!store.supported) return <UnsupportedPage />;
  if (!store.dirReady && store.authNeeded) return <ReauthPage store={store} />;
  if (!store.dirReady) return <WelcomePage store={store} />;

  return (
    <div className="app">
      <Tabs
        tab={tab}
        onChange={goTab}
        store={store}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsOpen={settingsOpen}
        alwaysOnTop={alwaysOnTop}
        onToggleTop={toggleAlwaysOnTop}
      />

      <div className="workspace">
        <TopBar
          store={store}
          tab={tab}
          settingsOpen={settingsOpen}
          count={listCount}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        />

        <div className={'content' + (!settingsOpen && tab === 'list' ? ' layout' : '')}>
          {settingsOpen ? (
            <SettingsPage onClose={() => setSettingsOpen(false)} projects={projects} />
          ) : tab === 'chat' ? (
            <ChatPanel store={store} onOpenList={() => setTab('list')} onOpenTool={openTool} />
          ) : tab === 'tools' ? (
            <ToolsPage snapshot={snapshot} store={store} request={toolRequest} />
          ) : (
            <>
              <Sidebar store={store} collapsed={sidebarCollapsed} />
              <main className="main" onContextMenu={handleMainContextMenu}>
                <div className="quick-add-bar">
                  <QuickAdd store={store} inputRef={store.quickAddRef} />
                </div>
                <MainList store={store} query={query} />
              </main>
            </>
          )}
        </div>

        {!settingsOpen && tab === 'list' && (
          <Overview store={store} open={overviewOpen} onToggle={() => setOverviewOpen((v) => !v)} />
        )}

        <Footer store={store} />
      </div>

      <EditDrawer store={store} />
      <Toast toast={store.toast} onClose={store.dismissToast} />
      {store.conflict && <ConflictModal store={store} />}
    </div>
  );
}
