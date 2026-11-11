// UI 样式指南（开发用）
//
// 两个用途：
//   ① 设计令牌 / 图标的一览参考
//   ② 改样式后的视觉回归对照 —— 这里渲染的是**真实组件**，不是复制的 HTML，
//      所以不存在"样式指南跟产品长得不一样"的漂移问题。
//
// 对话页尤其刻意走真实链路：给 useChatAgent 喂一个假的目录句柄，
// 让它按 append-only 事件日志真实回放，从而渲染出真正的消息气泡与工具卡片。
//
// 运行：npm run dev → http://localhost:<端口>/styleguide.html?view=list
//       （端口见项目根 .todolist-server.port，默认 15180）
// 视图：?view=tokens|icons|list|list-all|chat|chatempty|settings|welcome|reauth|unsupported|empty|drawer|toast|modal
//       ?view=calendar             日历模式（清单的第二种显示模式，演示数据相对今天生成）
//       ?view=calendar-done        日历 · 已完成（按完成日期锚定，只读）
//       ?view=tools                工具集（默认选中清单里第一个工具）
//       ?view=tools-<工具id>       工具集并直达某个工具，例如 tools-rti / tools-stats
//                                  <工具id> 直接来自 registry —— 新增工具自动多出一个视图，
//                                  这里不需要跟着改（见 Root() 里的前缀分支）。
import dayjs from 'dayjs';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

import {
  Tabs,
  WelcomePage,
  ReauthPage,
  UnsupportedPage,
  EmptyToday,
  Toast,
  ConflictModal,
  Footer,
  MainList,
  Overview,
} from './App.jsx';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import QuickAdd from './components/QuickAdd.jsx';
import EditDrawer from './components/EditDrawer.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import ToolsPage from './components/tools/ToolsPage.jsx';
import CalendarView from './components/CalendarView.jsx';
import PriorityMark from './components/PriorityMark.jsx';
import LayoutNotice from './components/LayoutNotice.jsx';
import { useLayoutMode } from './hooks/useLayoutMode.js';
import { noticeState } from './lib/layoutMode.js';
import { monthKey, projectionForMonth } from './lib/calendar.js';
import { parseQuickInput } from './lib/todoParser';
import { visibleTools } from './components/tools/registry.js';
import ToolCallCard from './components/ToolCallCard.jsx';
import Icon, { ICON_NAMES } from './components/Icon.jsx';
import { ContextMenuProvider } from './hooks/useContextMenu.jsx';
import { useTheme } from './hooks/useTheme';
import { initTheme } from './lib/theme.js';
import { buildTodoSnapshot } from './lib/todoSnapshot.js';

const TODAY = dayjs().format('YYYY-MM-DD');

// ---------------------------------------------------------------- 演示数据
const T = (id, title, extra = {}) => ({
  id,
  kind: 'task',
  raw: '',
  completed: false,
  completedAt: null,
  createdAt: '2026-09-20',
  priority: null,
  title,
  contexts: [],
  projects: [],
  dueDate: null,
  thresholdDate: null,
  starValue: null,
  extraTags: [],
  ...extra,
});

const TODO_ENTRIES = [
  T('t1', '季报复核', { priority: 'A', dueDate: '2026-09-25' }),
  T('t2', '写第 10 周回测报告', { priority: 'B', dueDate: '2026-10-01', contexts: ['投资'] }),
  T('t3', '核对军信股份的周线信号', { priority: 'C', projects: ['回测'], dueDate: '2026-10-10' }),
  T('t4', '整理 QuantDinger 的策略清单', { starValue: '1', projects: ['量化'] }),
  T('t5', '画主力吸筹指标的多周期对比图', {
    thresholdDate: '2026-10-05',
    contexts: ['投资'],
    projects: ['回测'],
  }),
  T('t6', '给移动硬盘做一次性能测试'),
  T('t7', '买网线'),
  T('t8', '周线复盘：人民网', {
    priority: 'B',
    contexts: ['投资'],
    projects: ['复盘'],
    dueDate: '2026-10-04',
  }),
  T('t9', '读一篇关于 B85 平台显卡升级的文章', {
    contexts: ['硬件'],
    extraTags: [{ key: 'src', value: 'ghfast' }],
  }),
  { id: 'r1', kind: 'raw', raw: '这一行解析不了 ::: 保持原样不动' },
];

const DONE_ENTRIES = [
  T('d1', '安装 topydo 并跑通三种 UI', {
    completed: true,
    completedAt: '2026-09-28',
    priority: 'A',
  }),
  T('d2', '编写 topydo 安装配置指南', {
    completed: true,
    completedAt: '2026-09-29',
    contexts: ['文档'],
  }),
  T('d3', '把 todo.txt 接进网页界面', {
    completed: true,
    completedAt: '2026-10-01',
    contexts: ['工作'],
    projects: ['量化'],
    dueDate: '2026-10-08',
  }),
];

// 日历演示数据：日期相对今天生成，保证无论何时打开样式指南，
// 月网格上都有 chip、有逾期、有今天到期、有无日期托盘 —— 不会一片空白。
const rel = (days) => dayjs().add(days, 'day').format('YYYY-MM-DD');
const CAL_TODO = [
  T('c1', '交周报', { priority: 'A', dueDate: rel(0), contexts: ['工作'], projects: ['回测'] }),
  T('c2', '写第 10 周回测报告', { priority: 'B', dueDate: rel(0), contexts: ['投资'] }),
  T('c3', '核对军信股份的周线信号', { priority: 'C', dueDate: rel(0), projects: ['回测'] }),
  T('c4', '整理 QuantDinger 的策略清单', { dueDate: rel(0), projects: ['量化'] }),
  T('c5', '周线复盘：人民网', { priority: 'B', dueDate: rel(-2), contexts: ['投资'], projects: ['复盘'] }),
  T('c6', '画主力吸筹指标的多周期对比图', { dueDate: rel(3), contexts: ['投资'], projects: ['回测'] }),
  T('c7', '给移动硬盘做一次性能测试', { priority: 'A', dueDate: rel(6), contexts: ['硬件'] }),
  T('c8', '读一篇关于 B85 平台显卡升级的文章', { dueDate: rel(10), contexts: ['硬件'] }),
  T('c9', '买网线', { priority: 'C', contexts: ['硬件'] }),
  T('c10', '备份 todo.txt 到移动硬盘', { starValue: '1' }),
];
const CAL_DONE = [
  T('cd1', '安装 topydo 并跑通三种 UI', { completed: true, completedAt: rel(0), priority: 'A' }),
  T('cd2', '编写 topydo 安装配置指南', { completed: true, completedAt: rel(-1), contexts: ['文档'] }),
  T('cd3', '把 todo.txt 接进网页界面', { completed: true, completedAt: rel(-3), contexts: ['工作'], projects: ['量化'] }),
];

// ------------------------------------------------- 假目录句柄（供对话页回放）
const SESSION_FILE = `session-${TODAY}.ndjson`;

const SESSION_EVENTS = [
  { seq: 1, type: 'user', payload: { text: '加一条 明天 交周报' } },
  {
    seq: 2,
    type: 'tool_call',
    payload: {
      callId: 'c1',
      tool: { name: 'todo.add', params: { text: '交周报', due: '2026-10-02' } },
    },
  },
  {
    seq: 3,
    type: 'tool_result',
    payload: {
      callId: 'c1',
      status: 'ok',
      durationMs: 12,
      params: { text: '交周报', due: '2026-10-02' },
    },
  },
  { seq: 4, type: 'agent', payload: { text: '已添加：交周报（截止 2026-10-02）' } },
  { seq: 5, type: 'user', payload: { text: '列出 回测' } },
  {
    seq: 6,
    type: 'tool_call',
    payload: { callId: 'c2', tool: { name: 'todo.query', params: { keyword: '回测' } } },
  },
  {
    seq: 7,
    type: 'tool_result',
    payload: { callId: 'c2', status: 'ok', durationMs: 4, params: { keyword: '回测' } },
  },
  {
    seq: 8,
    type: 'agent',
    payload: {
      text: '匹配到 2 条：\n1. 核对军信股份的周线信号  +回测\n2. 画主力吸筹指标的多周期对比图  +回测',
    },
  },
  { seq: 9, type: 'user', payload: { text: '完成 第 99 条' } },
  {
    seq: 10,
    type: 'tool_call',
    payload: { callId: 'c3', tool: { name: 'todo.complete', params: { index: 99 } } },
  },
  { seq: 11, type: 'tool_result', payload: { callId: 'c3', status: 'fail', durationMs: 2 } },
  { seq: 12, type: 'error', payload: { message: '没有第 99 条。当前共 9 条活跃任务。' } },
];

const SESSION_TEXT = SESSION_EVENTS.map((e, i) =>
  JSON.stringify({ ts: `2026-10-01T0${Math.min(9, 2 + Math.floor(i / 6))}:00:00.000Z`, ...e })
).join('\n');

function makeFileHandle(name, text) {
  return {
    name,
    async getFile() {
      return { name, async text() { return text; } };
    },
    async createWritable() {
      return { async write() {}, async close() {} };
    },
  };
}

// 目录句柄桩：给对话页回放会话事件线用（useChatAgent 要真实地读 session-*.ndjson）。
// 原先还为「事件日志」工具实现了 entries()/keys()/values() 异步迭代器（listDir 走它）；
// 该工具已移除，迭代器一并撤掉，只留读文件所需的最小面。
const FAKE_DIR = {
  name: 'todolist',
  async getFileHandle(name, options) {
    if (name === SESSION_FILE) return makeFileHandle(name, SESSION_TEXT);
    if (options && options.create) return makeFileHandle(name, '');
    const err = new Error('not found');
    err.name = 'NotFoundError';
    throw err;
  },
};

// ------------------------------------------------------------------ 桩 store
function makeStore(overrides = {}) {
  const noop = () => {};
  const base = {
    supported: true,
    dirReady: true,
    authNeeded: false,
    todoEntries: TODO_ENTRIES,
    doneEntries: DONE_ENTRIES,
    view: 'today',
    sortMode: 'auto',
    search: '',
    searchRef: { current: null },
    quickAddRef: { current: null },
    dirHandleRef: { current: FAKE_DIR },
    saveStatus: 'saved',
    lastSavedAt: Date.now(),
    conflict: false,
    fadingIds: [],
    dragId: null,
    focusedId: null,
    editingTask: null,
    toast: null,
    selectView: noop,
    setSortMode: noop,
    setSearch: noop,
    addTask: noop,
    addSubtask: noop,
    updateTask: noop,
    deleteTask: noop,
    toggleComplete: noop,
    // 备注：假 store 里没有内容，返回空串即可
    noteIds: new Set(),
    getNote: () => '',
    saveNote: async () => true,
    openEditor: noop,
    closeEditor: noop,
    setFocusedId: noop,
    setDragId: noop,
    reorder: noop,
    undo: noop,
    manualReload: noop,
    pickDirectory: noop,
    reauthorize: noop,
    dismissToast: noop,
    resolveConflictUseDisk: noop,
    resolveConflictKeepLocal: noop,
  };
  return { ...base, ...overrides };
}

// --------------------------------------------------------------------- 外壳
const VIEWS = [
  'tokens',
  'icons',
  'list',
  'list-all',
  'list-panel',
  'calendar',
  'calendar-done',
  'calendar-autonarrow',
  'chat',
  'chatempty',
  'settings',
  'tools',
  // 每个可见工具各配一个视图（tools-<id>）—— 由 registry 生成，加工具不用改这里
  ...visibleTools().map((t) => `tools-${t.id}`),
  'welcome',
  'reauth',
  'unsupported',
  'empty',
  'drawer',
  'toast',
  'modal',
];

// ------------------------------------------------------------------ 尺寸探针
// 把关键元素的实测几何写进一个隐藏节点，配合
//   msedge --headless --dump-dom URL | grep sg-metrics
// 就能拿到硬数据 —— 响应式布局不能靠肉眼看截图判断。
const PROBES = {
  rail: '.main',
  row: '.task-row',
  layout: '.layout',
  sidebar: '.sidebar',
  topbar: '.topbar',
  tabs: '.tabs',
  overview: '.overview',
  statusbar: '.statusbar',
  stream: '.chat-stream',
  panel: '.chat-panel',
  snapshot: '.snapshot',
  msg: '.msg:not(.msg-tool)',
  toolcard: '.tool-card',
  editwin: '.edit-window',
  // 日历（清单的第二种显示模式）：网格 / 格子 / 右侧日详情 / 无日期托盘 / 模式开关
  calGrid: '.cal-grid',
  calCell: '.cal-cell',
  calChip: '.cal-chip',
  calSide: '.cal-side',
  calDay: '.cal-day',
  calTray: '.cal-tray',
  calHead: '.cal-head',
  modeSwitch: '.mode-switch',
};

// 用 useLayoutEffect 同步写，不用 requestAnimationFrame ——
// headless 的 --dump-dom 抓取时机早于 rAF 回调，rAF 版本会采到空值。
function MetricsProbe() {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        disp: cs.display,
        dir: cs.flexDirection,
        pos: cs.position,
      };
    };

    const root = getComputedStyle(document.documentElement);
    const out = {
      vw: window.innerWidth,
      vh: window.innerHeight,
      docW: document.documentElement.scrollWidth,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      sidebarVar: root.getPropertyValue('--sidebar-w').trim(),
      snapshotVar: root.getPropertyValue('--snapshot-w').trim(),
      railMax: root.getPropertyValue('--rail-max').trim(),
      fs2xl: root.getPropertyValue('--fs-2xl').trim(),
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
    for (const [k, sel] of Object.entries(PROBES)) out[k] = pick(sel);

    if (ref.current) ref.current.textContent = 'SG_METRICS ' + JSON.stringify(out);
  }, []);

  return <pre id="sg-metrics" hidden ref={ref} />;
}

function Shell({ view, children }) {
  return (
    <>
      <nav className="sg-nav">
        <span className="sg-title">UI 样式指南</span>
        {VIEWS.map((v) => (
          <a key={v} href={`?view=${v}`} aria-current={v === view ? 'page' : undefined}>
            {v}
          </a>
        ))}
      </nav>
      <div className="sg-stage">{children}</div>
      <MetricsProbe />
    </>
  );
}

// 活动栏的主题按钮走真实档位（可点、可右键选档）：控件要渲染出来，也得真能按 ——
// 否则截图与响应式 QA 量不到这颗按钮，深/浅两套也对照不了。
function useThemeStage() {
  const { mode, effective, pick, toggle } = useTheme();
  return { themeMode: mode, themeEffective: effective, onToggleTheme: toggle, onPickTheme: pick };
}

function AppShell({
  store,
  tab,
  listView,
  overviewOpen = false,
  listMode = 'list',
  query = '',
  onPickListMode,
  seed = null,
  onCreateDay,
  autoNarrowFallback = false,
}) {
  const themeStage = useThemeStage();
  const s = listView ? makeStore({ ...store, view: listView }) : store;
  const isList = tab === 'list';
  // 舞台默认强制日历（qa-responsive 的 8 个日历档靠它回归窄屏降级本身）。
  // 只有 calendar-autonarrow 视图打开自动降级，用来在浏览器里验证新行为与截图。
  const [mainEl, setMainEl] = useState(null);
  const {
    effective: narrowEffective, narrow, override, setOverride,
  } = useLayoutMode({ preferred: listMode, mainEl: autoNarrowFallback ? mainEl : null });
  const effectiveMode = autoNarrowFallback ? narrowEffective : listMode;
  const isCalendar = isList && effectiveMode === 'calendar';
  const stageNotice = autoNarrowFallback
    ? noticeState({ preferred: listMode, narrow, override, effective: effectiveMode })
    : null;

  // 日历舞台也走真实状态：选中日 / 翻月 / 回今天都能点，投影现算。
  // 这些 Hook 无条件调用（listMode 只决定渲染分支），不违反 Hooks 规则。
  const [calDay, setCalDay] = useState(TODAY);
  const calMonth = monthKey(calDay);
  const projection = useMemo(
    () =>
      isCalendar
        ? projectionForMonth(s.todoEntries, s.doneEntries, s.view, query, TODAY, calMonth)
        : null,
    [isCalendar, s.todoEntries, s.doneEntries, s.view, query, calMonth]
  );
  const navMonth = (delta) =>
    setCalDay((d) => dayjs(d).add(delta, 'month').format('YYYY-MM-DD'));

  const count = isCalendar
    ? projection.tasks.length
    : isList
      ? (s.view === 'done' ? s.doneEntries : s.todoEntries).filter((e) => e.kind === 'task').length
      : null;
  return (
    <div className="app">
      <Tabs tab={tab} onChange={() => {}} store={s} onOpenSettings={() => {}} {...themeStage} />
      <div className="workspace">
        {/* 侧栏开关自 2026-10-18 起在页眉最左（仅列表页）。
            styleguide 是静态舞台，折叠状态恒为展开、点击空转 ——
            但要把它渲染出来，否则截图与 QA 量不到这个真实存在的控件。 */}
        <TopBar
          store={s}
          tab={tab}
          count={count}
          sidebarCollapsed={false}
          onToggleSidebar={() => {}}
          listMode={listMode}
          effectiveMode={effectiveMode}
          onPickListMode={isList ? onPickListMode || (() => {}) : undefined}
        />
        <div className={'content' + (isList ? ' layout' : '')}>
          {tab === 'chat' ? (
            <ChatPanel store={s} onOpenList={() => {}} />
          ) : (
            <>
              <Sidebar store={s} />
              <main
                ref={autoNarrowFallback ? setMainEl : undefined}
                className={'main' + (isCalendar ? ' main-calendar' : '')}
              >
                <div className="quick-add-bar">
                  <QuickAdd store={s} inputRef={s.quickAddRef} seed={seed} />
                </div>
                <LayoutNotice
                  state={stageNotice}
                  onUseCalendar={() => setOverride('calendar')}
                  onRestoreAuto={() => setOverride(null)}
                />
                {isCalendar ? (
                  <CalendarView
                    store={s}
                    query={query}
                    projection={projection}
                    day={calDay}
                    month={calMonth}
                    onPickDay={setCalDay}
                    onNavMonth={navMonth}
                    onToday={() => setCalDay(TODAY)}
                    onCreate={onCreateDay || (() => {})}
                  />
                ) : (
                  <MainList store={s} query={query} />
                )}
              </main>
            </>
          )}
        </div>
        {isList && <Overview store={s} open={overviewOpen} onToggle={() => {}} />}
        <Footer store={s} />
      </div>
      <EditDrawer store={s} />
      <Toast toast={s.toast} onClose={s.dismissToast} />
      {s.conflict && <ConflictModal store={s} />}
    </div>
  );
}

// ------------------------------------------------------------------ 日历交互舞台
// 日历页要能"真点"：拖任务改期 / 双击日期新建 / 勾完成 / 搜索过滤 都落在这里的
// useState 上（不写任何文件），这样浏览器交互 QA 才能走完整回路。
// 响应式 QA 只量首屏几何，与这个舞台无关但共用同一份 DOM 骨架。
function CalendarStage({ done = false, autoNarrow = false }) {
  const [todo, setTodo] = useState(CAL_TODO);
  const [doneEntries, setDoneEntries] = useState(CAL_DONE);
  const [view, setView] = useState(done ? 'done' : 'today');
  const [listMode, setListMode] = useState('calendar');
  const [search, setSearch] = useState('');
  const [seed, setSeed] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [toast, setToast] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const seq = useRef(0);
  const quickAddRef = useRef(null);
  const searchRef = useRef(null);

  const allTasks = useMemo(() => [...todo, ...doneEntries], [todo, doneEntries]);
  const findTask = (id) => allTasks.find((t) => t.id === id);

  // 舞台桩：动作真实改内存，但不写 todo.txt —— 样式指南永远不该碰数据文件。
  const store = makeStore({
    todoEntries: todo,
    doneEntries,
    view,
    sortMode: 'auto',
    search,
    searchRef,
    quickAddRef,
    focusedId,
    editingTask,
    toast,
    selectView: setView,
    setSearch,
    setFocusedId,
    dismissToast: () => setToast(null),
    openEditor: (id) => setEditingTask(findTask(id) || null),
    closeEditor: () => setEditingTask(null),
    updateTask: (id, patch) => {
      setTodo((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      setDoneEntries((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      setEditingTask((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
    },
    addTask: (text) => {
      const p = parseQuickInput(text);
      if (!p || !p.title) return;
      seq.current += 1;
      setTodo((list) => [
        ...list,
        {
          id: `new-${seq.current}`,
          kind: 'task',
          raw: text,
          completed: false,
          completedAt: null,
          createdAt: TODAY,
          priority: p.priority,
          title: p.title,
          contexts: p.contexts,
          projects: p.projects,
          dueDate: p.dueDate,
          thresholdDate: p.thresholdDate,
          starValue: p.starValue,
          extraTags: p.extraTags,
        },
      ]);
    },
    deleteTask: (task) => {
      const drop = (list) => list.filter((t) => t.id !== task.id);
      if (task.completed) setDoneEntries(drop);
      else setTodo(drop);
      setToast({ message: `已删除「${task.title}」· 舞台不写回文件`, actionLabel: '知道了' });
    },
    toggleComplete: (task) => {
      if (task.completed) {
        setDoneEntries((list) => list.filter((t) => t.id !== task.id));
        setTodo((list) => [...list, { ...task, completed: false, completedAt: null }]);
        return;
      }
      setTodo((list) => list.filter((t) => t.id !== task.id));
      setDoneEntries((list) => [...list, { ...task, completed: true, completedAt: TODAY }]);
    },
    undo: () => setToast(null),
  });

  const createOnDay = (date) => {
    seq.current += 1;
    setSeed({ text: `due:${date} `, seq: seq.current });
  };

  return (
    <AppShell
      store={store}
      tab="list"
      listView={view}
      listMode={listMode}
      query={search}
      onPickListMode={setListMode}
      seed={seed}
      onCreateDay={createOnDay}
      autoNarrowFallback={autoNarrow}
    />
  );
}

// ------------------------------------------------------------------ 文档视图
function Swatch({ token, value }) {
  return (
    <div className="sg-sw">
      <i style={{ background: value }} />
      <span>
        <b>--{token}</b>
        <br />
        {value}
      </span>
    </div>
  );
}

function TokensDoc() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(`--${n}`).trim();

  const surfaces = ['bg', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'control-line'];
  const texts = ['text', 'text-2', 'muted', 'accent', 'accent-soft', 'accent-line', 'accent-fg'];
  const semantic = ['danger', 'danger-soft', 'warn', 'warn-soft', 'ok', 'ok-soft'];
  // 11-10：px 一律从令牌读，不再硬编码（旧表把 --fs-xl 写成 19px，实际 20px）。
  const typeScale = [
    ['3xl', '引导页 Hero'],
    ['2xl', '次级标题'],
    ['display', '页面主标题（独立页头）'],
    ['xl', '标题'],
    ['lg', '强调 / 36px 上下文条主段'],
    ['md', '正文'],
    ['sm', '次级 UI'],
    ['xs', '元信息'],
    ['2xs', '等宽标签 / 计数 / 分组刻度'],
  ];
  const spaces = ['sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5', 'sp-6', 'sp-7', 'sp-8'];
  const radii = ['r-xs', 'r-sm', 'r-md', 'r-lg', 'r-xl', 'r-pill'];
  const shadows = ['sh-1', 'sh-2', 'sh-3'];

  return (
    <div className="sg-doc">
      <section>
        <h2>设计令牌</h2>
        <p className="sg-note">
          组件里禁止出现裸色值 / 裸字号 / 裸间距。改主题只改这一层，组件代码一行不动。
          暗色令牌写在 <code>:root[data-theme="dark"]</code> 里整体换值；档位（跟随系统 /
          浅色 / 深色）由 <code>lib/theme.js</code> 解析后落到 <code>&lt;html data-theme&gt;</code>，
          所以样式里不再有第二份暗色值，也没有媒体查询。
        </p>
        <h3>中性表面</h3>
        <div className="sg-swatches">
          {surfaces.map((t) => (
            <Swatch key={t} token={t} value={v(t)} />
          ))}
        </div>
        <h3>文字与强调</h3>
        <div className="sg-swatches">
          {texts.map((t) => (
            <Swatch key={t} token={t} value={v(t)} />
          ))}
        </div>
        <h3>语义状态（只给状态，不做装饰）</h3>
        <div className="sg-swatches">
          {semantic.map((t) => (
            <Swatch key={t} token={t} value={v(t)} />
          ))}
        </div>
      </section>

      <section>
        <h2>字阶</h2>
        <p className="sg-note">
          <b>两族分工</b>：ui 承担全部文字（正文 / 标题 / 按钮 / 分组名），mono 只归读数
          （计数 / 日期 / 行号 / 键位 / 写入行）。不使用 system-ui —— 那是默认值，不是选择；
          也不加载 webfont，字体取自系统栈里的显式选择。
          11-10 起页面主标题用 <code>--fs-display</code> 拉开落差，分组名是 11px mono 刻度标签；
          8 档基础字阶数值仍冻结。
        </p>
        {typeScale.map(([name, note]) => (
          <div className="sg-type-row" key={name}>
            <code>--fs-{name} = {v(`fs-${name}`)}</code>
            <span style={{ fontSize: `var(--fs-${name})` }}>主力吸筹 · 周线回测 Aa 123</span>
            <span className="sg-note" style={{ margin: 0 }}>{note}</span>
          </div>
        ))}
        <h3>三层落差与两个字体族</h3>
        <div className="sg-box">
          <p style={{ fontSize: 'var(--fs-display)', fontWeight: 'var(--fw-title)', lineHeight: 'var(--lh-tight)', margin: 0 }}>
            页面主标题 —— 今天 · 到期与逾期 9 项
          </p>
          <p style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-emph)', margin: '10px 0 0' }}>
            正文（ui 族）—— 季报复核 · 交周报 · 买网线
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-2xs)', margin: '10px 0 0', color: 'var(--text-2)' }}>
            读数（mono）—— 07 │ (A) 交周报 @工作 +回测 due:2026-11-10
          </p>
          <p style={{ fontFamily: 'var(--font-mono-cjk)', fontSize: 'var(--fs-2xs)', margin: '10px 0 0', color: 'var(--text-2)' }}>
            分组刻度（mono-cjk）—— 工作 / 回测 03：中文走显式回退，西文数字等宽
          </p>
        </div>
      </section>

      <section>
        <h2>间距 / 圆角 / 阴影</h2>
        <h3>间距（4 的倍数）</h3>
        {spaces.map((s) => (
          <div className="sg-space-row" key={s}>
            <code style={{ minWidth: 90 }}>--{s} = {v(s)}</code>
            <i style={{ width: v(s) }} />
          </div>
        ))}
        <h3>圆角（形态也承担语义）</h3>
        <div className="sg-row">
          {radii.map((r) => (
            <div
              key={r}
              className="sg-box"
              style={{ borderRadius: `var(--${r})`, width: 96, textAlign: 'center' }}
            >
              <code>--{r}</code>
            </div>
          ))}
        </div>
        <h3>阴影（三级高度，暖色环境光而非纯黑）</h3>
        <div className="sg-row">
          {shadows.map((s) => (
            <div
              key={s}
              className="sg-box"
              style={{ boxShadow: `var(--${s})`, background: 'var(--surface)', width: 150 }}
            >
              <code>--{s}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function IconsDoc() {
  return (
    <div className="sg-doc">
      <section>
        <h2>图标集</h2>
        <p className="sg-note">
          几何取自 <b>Lucide</b>（lucide-icons v1.57.0，ISC 许可），路径数据内联在
          <code> components/Icon.jsx</code>，因此仍是零依赖、完全离线。
          名字沿用项目原有命名，<b>到 Lucide 的对应关系</b>写在 Icon.jsx 每个条目后的注释里。
          全组统一画布 24×24、描边 1.75、圆头圆角、使用 currentColor。
          另有 <code>dot</code> / <code>circle-half</code> 两个语义状态图形为自绘（Lucide 无等价填充形）。
          默认 <code>aria-hidden</code>（纯装饰）；传 <code>title</code> 时自动升级为
          <code> role="img" + aria-label</code>。
        </p>
        <div className="sg-icons">
          {ICON_NAMES.map((n) => (
            <div className="sg-icon-cell" key={n}>
              <Icon name={n} size={24} />
              {n}
            </div>
          ))}
        </div>
        <h3>尺寸梯度</h3>
        <div className="sg-row">
          {[11, 13, 15, 18, 22, 26, 32].map((s) => (
            <span key={s} className="sg-box" style={{ display: 'inline-flex', gap: 6 }}>
              <Icon name="check-circle" size={s} />
              <code>{s}px</code>
            </span>
          ))}
        </div>
        <h3>继承文字颜色</h3>
        <div className="sg-row">
          {[
            ['var(--text)', '正文'],
            ['var(--muted)', '弱化'],
            ['var(--accent)', '强调'],
            ['var(--danger)', '危险'],
            ['var(--warn)', '警告'],
            ['var(--ok)', '成功'],
          ].map(([c, label]) => (
            <span
              key={label}
              className="sg-box"
              style={{ color: c, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="alert-circle" size={16} />
              {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function MessageFlow() {
  // 这里的三个气泡只是类名的直接应用；工具卡片用的是真实组件。
  const msgs = [
    { id: 1, role: 'user', text: '加一条 明天 交周报' },
    { id: 2, role: 'agent', text: '已添加：交周报（截止 2026-10-02）' },
    { id: 3, role: 'user', text: '列出 回测' },
    { id: 4, role: 'agent', text: '匹配到 2 条：\n1. 核对军信股份的周线信号\n2. 画主力吸筹指标的多周期对比图' },
    { id: 5, role: 'error', text: '没有第 99 条。当前共 9 条活跃任务。' },
  ];
  return (
    <>
      {msgs.map((m) => (
        <div
          key={m.id}
          className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-agent'}${m.role === 'error' ? ' msg-error' : ''}`}
        >
          <div className="msg-body">{m.text}</div>
        </div>
      ))}
      <div className="msg msg-tool">
        <ToolCallCard
          message={{
            tool: {
              name: 'todo.postpone',
              params: { target: '回测报告', to: '2026-10-08' },
              status: 'ok',
              durationMs: 7,
            },
            raw: {
              seq: 42,
              ts: '2026-10-01T03:12:44.201Z',
              type: 'tool_call',
              payload: { callId: 'c42', tool: { name: 'todo.postpone' } },
            },
            resultRaw: { seq: 43, type: 'tool_result', payload: { callId: 'c42', status: 'ok' } },
          }}
        />
      </div>
      <div className="chat-busy">▍处理中…</div>
    </>
  );
}

function ChatFlowStage() {
  // 复用真实外壳，把消息流替换成固定样本，用于稳定地截图对照。
  const themeStage = useThemeStage();
  const store = makeStore({ dirReady: false });
  return (
    <div className="app">
      <Tabs tab="chat" onChange={() => {}} store={store} onOpenSettings={() => {}} {...themeStage} />
      <div className="workspace">
        <TopBar store={store} tab="chat" />
        <div className="content">
          <div className="chat-panel">
            <div className="chat-main">
              <div className="chat-stream">
                <MessageFlow />
              </div>
              <div className="chat-input-wrap">
                <form className="chat-input" onSubmit={(e) => e.preventDefault()}>
                  <textarea
                    rows={1}
                    defaultValue=""
                    placeholder="用一句话描述改动（Enter 发送）"
                  />
                  <button className="send" type="submit" title="发送（Enter）" aria-label="发送">
                    <Icon name="upload" size={16} />
                  </button>
                </form>
              </div>
            </div>
            <aside className="snapshot">
              <div className="snapshot-head">任务快照 · 9</div>
              {TODO_ENTRIES.filter((e) => e.kind === 'task')
                .slice(0, 8)
                .map((t, i) => (
                  <div className="snapshot-item" key={t.id}>
                    <span className="snapshot-num">{i + 1}</span>
                    <PriorityMark priority={t.priority} className="snapshot-prio" />
                    <span className="snapshot-title">{t.title}</span>
                    {t.dueDate && (
                      <span className={`snapshot-due${t.dueDate < TODAY ? ' overdue' : ''}`}>
                        {t.dueDate < TODAY ? '⚠ ' : ''}
                        {dayjs(t.dueDate).format('M/D')}
                      </span>
                    )}
                  </div>
                ))}
            </aside>
          </div>
        </div>
        <Footer store={store} />
      </div>
    </div>
  );
}

// 设置页：与产品同构（活动栏齿轮处于打开态 + 独立页面 + 底部状态栏）。
// 渲染的是真实组件（当前内容是只读的快捷键速查）。
function SettingsStage() {
  const themeStage = useThemeStage();
  const store = makeStore({ dirReady: false });
  return (
    <div className="app">
      <Tabs
        tab="chat"
        onChange={() => {}}
        store={store}
        onOpenSettings={() => {}}
        settingsOpen
        {...themeStage}
      />
      <div className="workspace">
        <TopBar store={store} tab="chat" settingsOpen />
        <div className="content">
          <SettingsPage onClose={() => {}} />
        </div>
        <Footer store={store} />
      </div>
    </div>
  );
}

// 工具集：与产品同构（活动栏选中「工具」+ 目录态卡片墙 / 工作态工具区）。
// 渲染的是真实工具组件，所以截图里就是真实的数据录入表与真实画布。
// toolId 非空时直达该工具（?view=tools-<id>）—— ToolsPage 的首屏就认这个 request，
// 所以不需要模拟"从对话页路由进来"，工具拿到的 params 仍是 null；
// toolId 为空时首屏是卡片墙（目录态）。
function ToolsStage({ toolId = null }) {
  const themeStage = useThemeStage();
  const store = makeStore({ dirReady: true });
  // 工具页拿的是**只读投影**（与产品同一条链路），不是 store 本身
  const snapshot = buildTodoSnapshot({
    todoEntries: TODO_ENTRIES,
    doneEntries: DONE_ENTRIES,
    today: TODAY,
    sortMode: 'auto',
  });
  const request = toolId ? { id: toolId, params: null, seq: 1 } : null;
  return (
    <div className="app">
      <Tabs tab="tools" onChange={() => {}} store={store} onOpenSettings={() => {}} {...themeStage} />
      <div className="workspace">
        <TopBar store={store} tab="tools" />
        <div className="content">
          <ToolsPage snapshot={snapshot} store={store} request={request} />
        </div>
        <Footer store={store} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 根路由
function Root() {
  const view = new URLSearchParams(location.search).get('view') || 'tokens';

  if (view === 'tokens') return <Shell view={view}><TokensDoc /></Shell>;
  if (view === 'icons') return <Shell view={view}><IconsDoc /></Shell>;

  const stage = (node) => <Shell view={view}>{node}</Shell>;

  // tools-<工具id>：直达某个工具。用前缀而不是为每个工具写一个 case ——
  // 工具清单由 registry 驱动，视图清单也该如此。
  if (view.startsWith('tools-')) {
    const id = view.slice('tools-'.length);
    return stage(<ToolsStage toolId={id} />);
  }

  switch (view) {
    case 'list':
      return stage(<AppShell store={makeStore()} tab="list" listView="today" />);
    case 'list-all':
      return stage(<AppShell store={makeStore()} tab="list" listView="all" />);
    case 'list-panel':
      // 今日概览展开态：新组件，需要一个能对照的固定视图
      return stage(<AppShell store={makeStore()} tab="list" listView="today" overviewOpen />);
    case 'calendar':
      // 日历模式：交互舞台（拖改期 / 双击新建 / 勾完成 / 搜索都真实生效）
      return stage(<CalendarStage />);
    case 'calendar-done':
      // 日历 · 已完成：按完成日期锚定，整体只读（无托盘 / 无新建 / 不可拖）
      return stage(<CalendarStage done />);
    case 'calendar-autonarrow':
      // 窄边自动降级：偏好仍是日历，主区可用宽度不足时临时按列表排。
      // 与产品 App 走同一套 useLayoutMode / LayoutNotice，可截图、可被 QA 量。
      return stage(<CalendarStage autoNarrow />);
    case 'chat':
      // 真实回放：dirReady=true + 假目录句柄 → useChatAgent 还原出真实消息
      return stage(<AppShell store={makeStore({ dirReady: true })} tab="chat" />);
    case 'chatempty':
      return stage(<AppShell store={makeStore({ dirReady: false })} tab="chat" />);
    case 'chatflow':
      return stage(<ChatFlowStage />);
    case 'settings':
      return stage(<SettingsStage />);
    case 'tools':
      return stage(<ToolsStage />);
    case 'welcome':
      return stage(<WelcomePage store={makeStore({ dirReady: false })} />);
    case 'reauth':
      return stage(<ReauthPage store={makeStore({ dirReady: false, authNeeded: true })} />);
    case 'unsupported':
      return stage(<UnsupportedPage />);
    case 'empty':
      return stage(<EmptyToday store={makeStore()} />);
    case 'drawer':
      return stage(
        <AppShell store={makeStore({ editingTask: TODO_ENTRIES[2] })} tab="list" listView="all" />
      );
    case 'toast':
      return stage(
        <AppShell
          store={makeStore({
            toast: { message: '已删除「核对军信股份的周线信号」', actionLabel: '撤销' },
          })}
          tab="list"
          listView="today"
        />
      );
    case 'modal':
      return stage(<AppShell store={makeStore({ conflict: true })} tab="list" listView="today" />);
    default:
      return stage(<div className="sg-doc">未知视图：{view}</div>);
  }
}

// chatflow 不在导航里（用 chat 即可），保留以便单独截图完整消息流
if (new URLSearchParams(location.search).get('view') === 'chatflow') {
  VIEWS.splice(VIEWS.indexOf('chatempty') + 1, 0, 'chatflow');
}

// 样式指南里渲染的是真实组件，真实组件依赖右键菜单 Provider，所以这里也要包一层。
// 主题同样要走真实链路：QA 脚本用 CDP 模拟 prefers-color-scheme 截暗色图，
// 而暗色令牌只认 <html data-theme>，所以这一页也要先把档位投上去。
initTheme();

createRoot(document.getElementById('sg-root')).render(
  <ContextMenuProvider>
    <Root />
  </ContextMenuProvider>
);
