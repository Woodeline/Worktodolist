import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useTodoStore } from './hooks/useTodoStore';
import useDebounce from './hooks/useDebounce';
import useHotkeys from './hooks/useHotkeys';
import { useContextMenu } from './hooks/useContextMenu.jsx';
import { searchMatch, sortTasks, tasksForView, todayGroups } from './lib/sortFilter';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import TaskRow from './components/TaskRow.jsx';
import EditDrawer from './components/EditDrawer.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import ToolsPage from './components/tools/ToolsPage.jsx';
import Icon from './components/Icon.jsx';

// 三个页签是同一层级的"工作区"：对话（说）、列表（看）、工具（算）。
// 顺序即 Ctrl+1 / 2 / 3 的绑定顺序。
export const TABS = [
  ['chat', '对话'],
  ['list', '列表'],
  ['tools', '工具'],
];


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
          浏览器弹出「是否允许编辑文件」时，点 <strong>允许</strong>（有的版本写「编辑文件」）
        </li>
      </ol>
      <button className="btn btn-primary btn-lg" onClick={store.pickDirectory}>
        选好文件夹，开始用
      </button>
      <p className="hint">
        你的任务存在 <code>todo.txt</code> 这个纯文本文件里（可以用记事本打开看）。授权一次浏览器会记住，下次打开直接进来。
      </p>
    </div>
  );
}

export function ReauthPage({ store }) {
  return (
    <div className="welcome">
      <h1>再点一下就能继续</h1>
      <p className="welcome-sub">浏览器出于安全，隔一段时间需要重新确认一次文件权限。</p>
      <button className="btn btn-primary btn-lg" onClick={store.reauthorize}>
        重新授权
      </button>
      <p className="hint">点完会弹出一个确认框，点「允许 / 编辑文件」即可，数据不会丢。</p>
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
      <span>上次保存：{savedLabel}</span>
      <span className="spacer" />
      <button onClick={store.manualReload}>手动重载</button>
      <button onClick={store.pickDirectory}>切换目录</button>
    </footer>
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
  const visible = useMemo(() => {
    const base = tasksForView(store.todoEntries, store.view, today);
    const filtered = base.filter((t) => searchMatch(t, query));
    return sortTasks(filtered, store.sortMode);
  }, [store.todoEntries, store.view, store.sortMode, query, today]);

  const rawSection = (store.view === 'all' || store.view === 'inbox') && rawEntries.length > 0;

  if (store.view === 'done') {
    if (doneTasks.length === 0) return <div className="empty-state">还没有已完成的任务</div>;
    return (
      <div>
        <div className="group-title">已完成 · done.txt（只读）</div>
        {doneTasks.map((task) => (
          <TaskRow key={task.id} task={task} store={store} query={query} readonly />
        ))}
      </div>
    );
  }

  const renderRawSection = () =>
    rawSection ? (
      <>
        <div className="group-title group-overdue">未识别行（只读，已原样保留）</div>
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
          <div className="group-title group-overdue">逾期 · {groups.overdue.length}</div>
        )}
        {groups.overdue.map((t) => (
          <TaskRow key={t.id} task={t} store={store} query={query} />
        ))}
        {groups.dueToday.length > 0 && (
          <div className="group-title">今天到期 · {groups.dueToday.length}</div>
        )}
        {groups.dueToday.map((t) => (
          <TaskRow key={t.id} task={t} store={store} query={query} />
        ))}
        {groups.noDate.length > 0 && (
          <div className="group-title">无日期 · {groups.noDate.length}</div>
        )}
        {groups.noDate.map((t) => (
          <TaskRow key={t.id} task={t} store={store} query={query} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {visible.map((t) => (
        <TaskRow key={t.id} task={t} store={store} query={query} />
      ))}
      {renderRawSection()}
    </div>
  );
}

// 页签条 = 应用工具条：左边是应用菜单（原生菜单栏的位置），中间是页签，
// 右边是设置入口（齿轮）—— 与「☰ 菜单 / Ctrl+,」三个入口指向同一张设置页。
export function Tabs({ tab, onChange, store, onOpenSettings, settingsOpen }) {
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
    openAt(r.left, r.bottom + 3, [
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
    <div className="tabs">
      {store && (
        <button
          type="button"
          className="appmenu-btn"
          ref={menuBtnRef}
          onClick={openAppMenu}
          title="应用菜单"
          aria-haspopup="menu"
        >
          <Icon name="menu" size={15} />
        </button>
      )}
      <div className="tabs-group" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab${tab === id ? ' active' : ''}`}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="spacer" />
      {onOpenSettings && (
        <button
          type="button"
          className={'appmenu-btn' + (settingsOpen ? ' is-on' : '')}
          onClick={onOpenSettings}
          title="设置（Ctrl+,）"
        >
          <Icon name="settings" size={15} />
        </button>
      )}
      <span className="tabs-brand">todo.txt</span>
    </div>
  );
}

export default function App() {
  const store = useTodoStore();
  const query = useDebounce(store.search, 150);
  const [tab, setTab] = useState('chat');
  // 设置是独立页面，不占页签：打开时主内容整体让位，Esc / 「返回」退出。
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 设置页覆盖着主内容，所以点页签必须连带把设置页关掉 ——
  // 否则会出现"点了「列表」什么都没发生"的假死观感。
  const goTab = (next) => {
    setSettingsOpen(false);
    setTab(next);
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

  useHotkeys({
    // 对话页签激活时禁用全局快捷键，改由 ChatPanel 内部处理（避免 / 与 Ctrl+Z 冲突）。
    // 设置页打开时同样禁用 —— 否则在设置里按 Esc 会顺手清掉列表页的搜索词。
    enabled: tab === 'list' && !settingsOpen,
    onNew: () => store.quickAddRef.current && store.quickAddRef.current.focus(),
    onSearch: () => store.searchRef.current && store.searchRef.current.focus(),
    onToggle: () => {
      const task = findFocusedTask();
      if (task) store.toggleComplete(task);
    },
    onEdit: () => {
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

  // 设置页的全局快捷键：Ctrl+, 打开、Esc 退出；Ctrl+1/2/3 在三个页签之间切换。
  // 这三条与页签无关（对话页里也能直接开设置、直接跳页）。
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === ',') {
          e.preventDefault();
          setSettingsOpen(true);
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
      />
      {settingsOpen ? (
        <SettingsPage onClose={() => setSettingsOpen(false)} />
      ) : tab === 'chat' ? (
        <ChatPanel store={store} onOpenList={() => setTab('list')} />
      ) : tab === 'tools' ? (
        <ToolsPage />
      ) : (
        <>
          <TopBar store={store} />
          <div className="layout">
            <Sidebar store={store} />
            <main className="main" onContextMenu={handleMainContextMenu}>
              <MainList store={store} query={query} />
            </main>
          </div>
        </>
      )}
      <Footer store={store} />
      <EditDrawer store={store} />
      <Toast toast={store.toast} onClose={store.dismissToast} />
      {store.conflict && <ConflictModal store={store} />}
    </div>
  );
}
