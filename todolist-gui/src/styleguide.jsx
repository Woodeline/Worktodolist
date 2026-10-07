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
import dayjs from 'dayjs';
import { useLayoutEffect, useRef, useState } from 'react';
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
} from './App.jsx';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import EditDrawer from './components/EditDrawer.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import ToolsPage from './components/tools/ToolsPage.jsx';
import ToolCallCard from './components/ToolCallCard.jsx';
import Icon, { ICON_NAMES } from './components/Icon.jsx';
import { ContextMenuProvider } from './hooks/useContextMenu.jsx';

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
    updateTask: noop,
    deleteTask: noop,
    toggleComplete: noop,
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
  'chat',
  'chatempty',
  'settings',
  'tools',
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
  rail: '.main > *',
  row: '.task-row',
  layout: '.layout',
  sidebar: '.sidebar',
  topbar: '.topbar',
  tabs: '.tabs',
  statusbar: '.statusbar',
  stream: '.chat-stream',
  panel: '.chat-panel',
  snapshot: '.snapshot',
  msg: '.msg:not(.msg-tool)',
  toolcard: '.tool-card',
  drawer: '.drawer',
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

function AppShell({ store, tab, listView }) {
  const s = listView ? makeStore({ ...store, view: listView }) : store;
  return (
    <div className="app">
      <Tabs tab={tab} onChange={() => {}} store={s} onOpenSettings={() => {}} />
      {tab === 'chat' ? (
        <ChatPanel store={s} />
      ) : (
        <>
          <TopBar store={s} />
          <div className="layout">
            <Sidebar store={s} />
            <main className="main">
              <MainList store={s} query="" />
            </main>
          </div>
        </>
      )}
      <Footer store={s} />
      <EditDrawer store={s} />
      <Toast toast={s.toast} onClose={s.dismissToast} />
      {s.conflict && <ConflictModal store={s} />}
    </div>
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
  const typeScale = [
    ['3xl', '32px', '引导页大标题'],
    ['2xl', '24px', '次级标题'],
    ['xl', '19px', '标题'],
    ['lg', '16px', '强调 / 按钮大'],
    ['md', '14px', '正文'],
    ['sm', '13px', '次级 UI'],
    ['xs', '12px', '元信息'],
    ['2xs', '11px', '等宽标签 / 计数'],
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
          暗色主题跟随系统偏好，令牌在 <code>prefers-color-scheme: dark</code> 里整体换值。
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
          三套字体分工：<b>宋体</b>只做"说话的标题"，<b>等宽</b>承担全部数据/度量，<b>黑体</b>才是正文。
          不使用 system-ui —— 那是默认值，不是选择。
        </p>
        {typeScale.map(([name, px, note]) => (
          <div className="sg-type-row" key={name}>
            <code>--fs-{name} = {px}</code>
            <span style={{ fontSize: `var(--fs-${name})` }}>主力吸筹 · 周线回测 Aa 123</span>
            <span className="sg-note" style={{ margin: 0 }}>{note}</span>
          </div>
        ))}
        <h3>字体族</h3>
        <div className="sg-box">
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', margin: 0 }}>
            宋体展示字 —— 待办清单
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', margin: '10px 0 0' }}>
            等宽数据字 —— todo.add · seq 128 · 12 ms · due:2026-10-08
          </p>
          <p style={{ fontFamily: 'var(--font-body)', margin: '10px 0 0', color: 'var(--text-2)' }}>
            黑体正文字 —— 用大白话打字，它就去改你电脑上的 todo.txt 文件。
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
          内联 SVG，零依赖。全组统一画布 24×24、描边 1.75、圆头圆角、使用 currentColor。
          统一的是<b>网格与线宽</b>，不是"装了哪个图标库"。
          默认 <code>aria-hidden</code>（纯装饰）；传 <code>title</code> 时自动升级为
          <code> role="img" + aria-label</code>。
        </p>
        <div className="sg-icons">
          {ICON_NAMES.map((n) => (
            <div className="sg-icon-cell" key={n}>
              <Icon name={n} size={22} />
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
  const store = makeStore({ dirReady: false });
  return (
    <div className="app">
      <Tabs tab="chat" onChange={() => {}} store={store} onOpenSettings={() => {}} />
      <div className="chat-panel">
        <div className="chat-main">
          <div className="chat-status">
            {/* 状态点用 Icon（不是 ● 字符），与产品代码一致 */}
            <span className="dot dot-warn">
              <Icon name="dot" size={13} />
            </span>
            <span>本地规则引擎优先 · 仅在听不懂时发往 api.openai.com</span>
            <span className="spacer" />
            <span>事件日志 12 条 · 最后 seq 12</span>
          </div>

          <div className="chat-stream">
            <MessageFlow />
          </div>
          <div className="chat-input-wrap">
            <form className="chat-input" onSubmit={(e) => e.preventDefault()}>
              <textarea
                rows={1}
                defaultValue=""
                placeholder="用大白话就行，例如：后天上午9点有月报会议要开（Enter 发送）"
              />
              <button className="btn btn-primary" type="submit">
                发送
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
                <span className={`snapshot-prio${t.priority ? '' : ' snapshot-prio-none'}`}>
                  {t.priority || '中'}
                </span>
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
      <Footer store={store} />
    </div>
  );
}

// 设置页：与产品同构（顶栏齿轮处于打开态 + 独立页面 + 底部状态栏）。
// 渲染的是真实组件，所以这里也走真实配置读写（本机没配过就显示默认值）。
function SettingsStage() {
  const store = makeStore({ dirReady: false });
  return (
    <div className="app">
      <Tabs
        tab="chat"
        onChange={() => {}}
        store={store}
        onOpenSettings={() => {}}
        settingsOpen
      />
      <SettingsPage onClose={() => {}} />
      <Footer store={store} />
    </div>
  );
}

// 工具集：与产品同构（顶栏选中「工具」+ 左栏工具清单 + 右栏工具工作区）。
// 渲染的是真实工具组件，所以截图里就是真实的数据录入表与真实画布。
function ToolsStage() {
  const store = makeStore({ dirReady: true });
  return (
    <div className="app">
      <Tabs tab="tools" onChange={() => {}} store={store} onOpenSettings={() => {}} />
      <ToolsPage />
      <Footer store={store} />
    </div>
  );
}

// ------------------------------------------------------------------ 根路由
function Root() {
  const view = new URLSearchParams(location.search).get('view') || 'tokens';

  if (view === 'tokens') return <Shell view={view}><TokensDoc /></Shell>;
  if (view === 'icons') return <Shell view={view}><IconsDoc /></Shell>;

  const stage = (node) => <Shell view={view}>{node}</Shell>;

  switch (view) {
    case 'list':
      return stage(<AppShell store={makeStore()} tab="list" listView="today" />);
    case 'list-all':
      return stage(<AppShell store={makeStore()} tab="list" listView="all" />);
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
createRoot(document.getElementById('sg-root')).render(
  <ContextMenuProvider>
    <Root />
  </ContextMenuProvider>
);
