// 响应式几何实测 —— 用 CDP 设备仿真量真实布局，不靠肉眼看截图。
//
// 为什么不用 `--window-size` + `--dump-dom`：
//   headless=new 的窗口有最小宽度（实测 390 只能给到 vw=492），
//   测不到 <480 那一档；而且伪不了 pointer:coarse / prefers-color-scheme。
//   CDP 的 Emulation.* 域可以精确指定视口、媒体特性，并要求真实截图。
//
// 量的是 styleguide.html 里的**真实组件**（不是复制的 HTML），
// 因为真应用需要 File System Access 的目录句柄，headless 里给不了。
//
// 用法：
//   npm run dev                       # 另开一个终端，先把 dev server 起起来
//                                     # （vite 默认 5173；指定别的地址用 SG_BASE 环境变量）
//   node scripts/qa-responsive.mjs            # 只出表格
//   node scripts/qa-responsive.mjs --shots    # 顺便存图到 .tmp-shot/
//   node scripts/qa-responsive.mjs --json     # 额外吐一份原始 JSON
//
// 退出码：有断言失败 → 1

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
];

// 目标地址：SG_BASE 环境变量优先；否则读项目根 .todolist-server.port（这是早期 Python
// 启动器留下的端口文件，现在已没有东西写它，读到就用作兼容）；再读不到回落到 15180。
function readServerPort() {
  try {
    const raw = readFileSync(path.resolve(import.meta.dirname, '..', '..', '.todolist-server.port'), 'utf8').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
const SERVER_PORT = readServerPort() ?? 15180;
const BASE = process.env.SG_BASE || `http://localhost:${SERVER_PORT}`;
const PORT = Number(process.env.CDP_PORT || 9333);
const WANT_SHOTS = process.argv.includes('--shots');
const WANT_JSON = process.argv.includes('--json');
const WANT_LIST = process.argv.includes('--list');
// --only=a,b,c —— 只跑指定用例。headless 单进程连跑十几档偶发挂死，
// 分批跑更稳（npm run test:responsive -- --only=... ）
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').map((s) => s.trim()).filter(Boolean);

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.resolve(ROOT, 'qa-artifacts');
const PROFILE = path.join(tmpdir(), 'todolist-qa-responsive-profile');

// 要量的选择器。key 会原样出现在输出里。
const PROBES = {
  layout: '.layout',
  sidebar: '.sidebar',
  topbar: '.topbar',
  tabs: '.tabs',
  rail: '.main > *',
  row: '.task-row',
  checkbox: '.task-row .checkbox',
  navitem: '.nav-item',
  panel: '.chat-panel',
  stream: '.chat-stream',
  snapshot: '.snapshot',
  msg: '.msg:not(.msg-tool)',
  toolcard: '.tool-card',
  drawer: '.drawer',
  statusbar: '.statusbar',
  // 工具集（第三个页签）：左栏清单 + 右侧工具工作区
  toolsNav: '.tools-nav',
  toolPane: '.tool-pane',
  toolsList: '.tools-list',
  toolsItem: '.tools-item',
  rtiTab: '.tool-tab',
  rtiRowDel: '.tool-row-del',
};

// 三档视口 + 断点边界。width 是**视口**宽度（媒体查询看的就是这个）。
const CASES = [
  { name: 'desktop-1440', w: 1440, h: 900, view: 'list', tier: 'wide' },
  { name: 'desktop-1280', w: 1280, h: 800, view: 'list', tier: 'wide' },
  { name: 'mid-1081', w: 1081, h: 800, view: 'list', tier: 'wide', note: '断点上方 1px，应仍是完整侧栏' },
  { name: 'mid-1080', w: 1080, h: 800, view: 'list', tier: 'mid', note: '断点线上，侧栏收紧' },
  { name: 'mid-900', w: 900, h: 800, view: 'list', tier: 'mid' },
  { name: 'mid-769', w: 769, h: 800, view: 'list', tier: 'mid', note: '断点上方 1px，侧栏仍竖向' },
  { name: 'narrow-768', w: 768, h: 900, view: 'list', tier: 'narrow', note: '断点线上，侧栏转横向条' },
  { name: 'narrow-600', w: 600, h: 900, view: 'list', tier: 'narrow' },
  { name: 'mobile-480', w: 480, h: 844, view: 'list', tier: 'narrow', note: '断点线上，字号再降一档' },
  { name: 'mobile-479', w: 479, h: 844, view: 'list', tier: 'small', note: '断点下方，--fs-2xl 应变小' },
  { name: 'mobile-390', w: 390, h: 844, view: 'list', tier: 'small', note: 'iPhone 14 逻辑宽度' },
  { name: 'mobile-360', w: 360, h: 780, view: 'list', tier: 'small' },
  { name: 'mobile-320', w: 320, h: 640, view: 'list', tier: 'small', note: '最窄兜底' },
  { name: 'narrow-390-chat', w: 390, h: 844, view: 'chat', tier: 'small', note: '对话页小屏：快照列转底部条' },
  { name: 'narrow-390-drawer', w: 390, h: 844, view: 'drawer', tier: 'small', note: '抽屉小屏：占满宽度' },
  { name: 'coarse-390', w: 390, h: 844, view: 'list', tier: 'small', coarse: true, note: '触屏命中区 ≥44px' },
  { name: 'dark-1440', w: 1440, h: 900, view: 'list', tier: 'wide', dark: true },
  { name: 'dark-390', w: 390, h: 844, view: 'list', tier: 'small', dark: true },
  { name: 'dark-390-chat', w: 390, h: 844, view: 'chat', tier: 'small', dark: true },
  // 工具集（第三个页签）也必须在断点上过一遍 —— 它是最大的一块新表面
  { name: 'mid-1080-tools', w: 1080, h: 800, view: 'tools', tier: 'mid' },
  { name: 'narrow-768-tools', w: 768, h: 900, view: 'tools', tier: 'narrow', note: '断点线上，清单转横向条' },
  { name: 'mobile-390-tools', w: 390, h: 844, view: 'tools', tier: 'small' },
  { name: 'coarse-390-tools', w: 390, h: 844, view: 'tools', tier: 'small', coarse: true, note: '触屏：页签与清单项命中区 ≥44px' },
  { name: 'dark-1280-tools', w: 1280, h: 800, view: 'tools', tier: 'wide', dark: true },
];

// ------------------------------------------------------------------ CDP 客户端
function findEdge() {
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('找不到 Edge/Chrome 可执行文件，请设置 EDGE 环境变量或在脚本里加路径');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.seq = 0;
    this.pending = new Map();
    this.waiters = [];
    this.closed = false;
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', (e) => rej(new Error('CDP 连接失败: ' + (e.message || 'unknown'))));
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else res(msg.result);
        return;
      }
      if (msg.method) {
        for (let i = this.waiters.length - 1; i >= 0; i--) {
          const wt = this.waiters[i];
          if (wt.method === msg.method && (!wt.sessionId || wt.sessionId === msg.sessionId)) {
            this.waiters.splice(i, 1);
            wt.res(msg.params);
          }
        }
      }
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      for (const { rej } of this.pending.values()) rej(new Error('CDP 连接已关闭'));
      this.pending.clear();
    });
  }

  // 每个调用都带超时 —— headless 渲染器偶发挂死时，
  // 没有超时的 Runtime.evaluate 会把整个脚本拖住不返回。
  send(method, params = {}, sessionId, timeout = 20000) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`CDP 超时(${timeout}ms): ${method}`));
        }
      }, timeout);
      this.pending.set(id, {
        res: (v) => {
          clearTimeout(timer);
          res(v);
        },
        rej: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitFor(method, sessionId, timeout = 10000) {
    return new Promise((res, rej) => {
      const wt = { method, sessionId, res };
      this.waiters.push(wt);
      setTimeout(() => {
        const i = this.waiters.indexOf(wt);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          rej(new Error(`等待事件超时: ${method}`));
        }
      }, timeout);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function launchEdge(edge) {
  rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  // 轮询 DevTools 端点
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) {
        version = await r.json();
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!version) {
    proc.kill();
    throw new Error(`Edge 未能在 127.0.0.1:${PORT} 暴露 DevTools 端点`);
  }
  return { proc, version };
}

// ------------------------------------------------------------------ 页面内的度量表达式
const MEASURE_FN = `(() => {
  const PROBES = ${JSON.stringify(PROBES)};
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             disp: cs.display, dir: cs.flexDirection };
  };
  const root = getComputedStyle(document.documentElement);
  const out = {
    vw: window.innerWidth, vh: window.innerHeight,
    docW: document.documentElement.scrollWidth,
    docH: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    sidebarVar: root.getPropertyValue('--sidebar-w').trim(),
    snapshotVar: root.getPropertyValue('--snapshot-w').trim(),
    railMax: root.getPropertyValue('--rail-max').trim(),
    fs2xl: root.getPropertyValue('--fs-2xl').trim(),
    bg: root.getPropertyValue('--bg').trim(),
    surface: root.getPropertyValue('--surface').trim(),
    text: root.getPropertyValue('--text').trim(),
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference',
    coarse: matchMedia('(pointer: coarse)').matches,
  };
  for (const [k, sel] of Object.entries(PROBES)) out[k] = pick(sel);

  // 命中区实测 —— getBoundingClientRect 只给元素盒，
  // 触屏档的外扩是 ::before 伪元素，必须用 elementFromPoint 探出来。
  const hitBox = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const owns = (x, y) => {
      const t = document.elementFromPoint(x, y);
      return !!(t && (t === el || el.contains(t) || t.closest(sel) === el));
    };
    if (!owns(cx, cy)) return null; // 被别的元素盖住了
    // 0.5px 步长 —— 整数步长会在伪元素边缘各丢 1px，
    // 18px 的复选框外扩 13px 本来是 44，用整数扫只会得到 42。
    const scan = (dx, dy) => {
      const step = 0.5;
      let d = 0;
      while (d < 48) {
        if (!owns(cx + dx * (d + step), cy + dy * (d + step))) break;
        d += step;
      }
      return d;
    };
    const up = scan(0, -1), down = scan(0, 1), left = scan(-1, 0), right = scan(1, 0);
    return { w: Math.round(left + right + 1), h: Math.round(up + down + 1) };
  };
  out.hit = {
    checkbox: hitBox('.task-row .checkbox'),
    navitem: hitBox('.nav-item'),
    iconbtn: hitBox('.icon-btn'),
    tab: hitBox('.tab'),
    toolsitem: hitBox('.tools-item'),
    rtitab: hitBox('.tool-tab'),
    rtidel: hitBox('.tool-row-del'),
  };
  return JSON.stringify(out);
})()`;

async function runCase(cdp, sessionId, c, wantShot) {
  const media = [
    { name: 'prefers-color-scheme', value: c.dark ? 'dark' : 'light' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ];
  if (c.coarse) media.push({ name: 'pointer', value: 'coarse' });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: c.w,
    height: c.h,
    deviceScaleFactor: 1,
    mobile: c.w <= 768,
    screenWidth: c.w,
    screenHeight: c.h,
  }, sessionId);

  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: media }, sessionId);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!c.coarse, maxTouchPoints: c.coarse ? 5 : 1 }, sessionId);

  const loaded = cdp.waitFor('Page.loadEventFired', sessionId, 15000);
  await cdp.send('Page.navigate', { url: `${BASE}/styleguide.html?view=${c.view}` }, sessionId);
  await loaded;
  // 让 React 提交 + 字体就位
  await sleep(600);

  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: MEASURE_FN,
    returnByValue: true,
    awaitPromise: false,
  }, sessionId, 15000);
  if (exceptionDetails) throw new Error('页面内度量抛错: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
  const metrics = JSON.parse(result.value);

  // 截图失败不该让整轮实测失败
  let shot = null;
  if (wantShot) {
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId, 15000);
      mkdirSync(SHOT_DIR, { recursive: true });
      shot = path.join(SHOT_DIR, `${c.name}.png`);
      writeFileSync(shot, Buffer.from(data, 'base64'));
    } catch (e) {
      shot = null;
      process.stdout.write(`[截图跳过: ${e.message}] `);
    }
  }

  return { metrics, shot };
}

// ------------------------------------------------------------------ 断言
// 只断言"结构发生了该发生的变化"，不断言精确像素 —— 像素会随字体/平台漂移。
function assertions(c, m) {
  const out = [];
  const ok = (label, cond, detail = '') => out.push({ ok: !!cond, label, detail });
  const g = (k) => m[k];
  // 只有列表页有 .layout / .sidebar / .topbar / 主区 rail；对话页是另一套骨架，
  // 拿列表页的断言去套对话页只会产出噪音，所以显式分流。
  const isList = m.layout != null;
  // 工具集有自己的骨架（左栏清单 + 右侧工作区），跟列表页那套不通用
  const isTools = m.toolsNav != null;

  ok('无横向溢出', !m.overflowX, `docW=${m.docW} vw=${m.vw}`);

  if (isList && c.tier === 'wide') {
    ok('侧栏为竖向列', g('sidebar')?.disp === 'block' || g('sidebar')?.dir === 'column', JSON.stringify({ disp: g('sidebar')?.disp, dir: g('sidebar')?.dir }));
    ok('布局为横向 row', g('layout')?.dir === 'row', `layout.dir=${g('layout')?.dir}`);
    ok('侧栏宽度 = --sidebar-w(224)', g('sidebar')?.w === 224, `w=${g('sidebar')?.w}`);
    ok('侧栏高度撑满主区', (g('sidebar')?.h ?? 0) > 300, `h=${g('sidebar')?.h}`);
    ok('--rail-max = 900px', m.railMax === '900px', m.railMax);
    ok('rail 宽度 ≤ 900', (g('rail')?.w ?? 0) <= 900, `w=${g('rail')?.w}`);
    ok('主区未被挤压（rail ≥ 560）', (g('rail')?.w ?? 0) >= 560, `w=${g('rail')?.w}`);
  }

  if (isList && c.tier === 'mid') {
    ok('侧栏仍为竖向', g('sidebar')?.dir !== 'row' || (g('sidebar')?.h ?? 0) > 300, `dir=${g('sidebar')?.dir} h=${g('sidebar')?.h}`);
    ok('--sidebar-w 收紧为 196', m.sidebarVar === '196px', m.sidebarVar);
    ok('--rail-max 放开为 100%', m.railMax === '100%', m.railMax);
    ok('布局仍为横向', g('layout')?.dir === 'row', `layout.dir=${g('layout')?.dir}`);
  }

  if (isList && (c.tier === 'narrow' || c.tier === 'small')) {
    ok('布局转纵向 column', g('layout')?.dir === 'column', `layout.dir=${g('layout')?.dir}`);
    ok('侧栏转横向 flex 条', g('sidebar')?.disp === 'flex' && g('sidebar')?.dir === 'row', JSON.stringify({ disp: g('sidebar')?.disp, dir: g('sidebar')?.dir }));
    ok('侧栏高度塌成条（<80）', (g('sidebar')?.h ?? 999) < 80, `h=${g('sidebar')?.h}`);
    ok('侧栏占满宽度', Math.abs((g('sidebar')?.w ?? 0) - m.docW) <= 20, `w=${g('sidebar')?.w} docW=${m.docW}`);
    ok('侧栏在内容上方', (g('sidebar')?.y ?? 1e9) < (g('rail')?.y ?? -1), `sidebar.y=${g('sidebar')?.y} rail.y=${g('rail')?.y}`);
    ok('顶栏换行（高度 > 80）', (g('topbar')?.h ?? 0) > 80, `h=${g('topbar')?.h}`);
    ok('rail 占满内容宽', (g('rail')?.w ?? 0) > m.docW * 0.9, `w=${g('rail')?.w} docW=${m.docW}`);
    ok('任务行未溢出', (g('row')?.w ?? 0) <= m.docW, `w=${g('row')?.w}`);
  }

  // 工具集：宽中档左右并排，窄小档清单转横向段控条
  if (isTools) {
    ok('工具集已渲染（清单 + 工作区）', g('toolsNav') != null && g('toolPane') != null);
    if (c.tier === 'wide' || c.tier === 'mid') {
      ok('清单为竖向列', g('toolsList')?.dir === 'column', `dir=${g('toolsList')?.dir}`);
      ok('清单在左、工作区在右（并排）',
        (g('toolsNav')?.x ?? 1e9) < (g('toolPane')?.x ?? -1)
          && (g('toolPane')?.x ?? 0) >= (g('toolsNav')?.x ?? 0) + (g('toolsNav')?.w ?? 0) - 2,
        JSON.stringify({ nav: g('toolsNav'), pane: g('toolPane') }));
      ok('清单占满侧栏内容宽（整行可点）',
        (g('toolsItem')?.w ?? 0) >= (g('toolsNav')?.w ?? 0) - 30, `item=${g('toolsItem')?.w} nav=${g('toolsNav')?.w}`);
      ok('清单是高的（竖列侧栏，非一条）', (g('toolsNav')?.h ?? 0) > 300, `h=${g('toolsNav')?.h}`);
    } else {
      ok('清单转横向条', g('toolsList')?.dir === 'row', `dir=${g('toolsList')?.dir}`);
      ok('清单塌成条（高度 <80）', (g('toolsNav')?.h ?? 999) < 80, `h=${g('toolsNav')?.h}`);
      ok('清单占满宽度', Math.abs((g('toolsNav')?.w ?? 0) - m.docW) <= 20, `w=${g('toolsNav')?.w} docW=${m.docW}`);
      ok('清单在工具上方', (g('toolsNav')?.y ?? 1e9) < (g('toolPane')?.y ?? -1), `nav.y=${g('toolsNav')?.y} pane.y=${g('toolPane')?.y}`);
      ok('工具工作区占满内容宽', (g('toolPane')?.w ?? 0) > m.docW * 0.9, `w=${g('toolPane')?.w} docW=${m.docW}`);
      ok('工具内页签仍在（窄屏可切换页面）', (g('rtiTab')?.w ?? 0) > 0 && (g('rtiTab')?.disp !== 'none'), JSON.stringify(g('rtiTab')));
    }
  }

  if (c.tier === 'small') {
    ok('--fs-2xl 降到 21px', m.fs2xl === '21px', m.fs2xl);
  }

  if (c.view === 'chat' && m.panel) {
    if (c.tier === 'wide' || c.tier === 'mid') {
      ok('对话页横排', g('panel')?.dir === 'row', `panel.dir=${g('panel')?.dir}`);
    } else {
      ok('对话页转纵向', g('panel')?.dir === 'column', `panel.dir=${g('panel')?.dir}`);
      ok('快照列转底部横条', g('snapshot')?.disp === 'flex' && g('snapshot')?.dir === 'row', JSON.stringify({ disp: g('snapshot')?.disp, dir: g('snapshot')?.dir }));
      ok('快照条占满宽度', Math.abs((g('snapshot')?.w ?? 0) - m.docW) <= 20, `w=${g('snapshot')?.w} docW=${m.docW}`);
      ok('快照条在对话流下方', (g('snapshot')?.y ?? 0) > (g('stream')?.y ?? 0), `snapshot.y=${g('snapshot')?.y} stream.y=${g('stream')?.y}`);
    }
  }

  if (c.view === 'drawer' && m.drawer) {
    if (c.tier === 'narrow' || c.tier === 'small') {
      ok('抽屉占满宽度', Math.abs((g('drawer')?.w ?? 0) - m.docW) <= 4, `w=${g('drawer')?.w} docW=${m.docW}`);
    }
  }

  if (c.coarse) {
    const h = m.hit || {};
    ok('命中区生效 pointer:coarse', m.coarse === true, `coarse=${m.coarse}`);
    // 这两组探测点只存在于列表页；工具页上没有它们，
    // 硬套过来只会产出"假失败"（hit=undefined），所以按视图分流。
    if (isList) {
      ok('nav-item 命中高 ≥44', (h.navitem?.h ?? 0) >= 44, `hit=${h.navitem?.h}`);
      ok('复选框命中高 ≥44（::before 外扩）', (h.checkbox?.h ?? 0) >= 44, `hit=${h.checkbox?.h}`);
      ok('复选框命中宽 ≥40', (h.checkbox?.w ?? 0) >= 40, `hit=${h.checkbox?.w}`);
      ok('复选框不被遮挡', h.checkbox != null, `hit=${JSON.stringify(h.checkbox)}`);
    }
    if (isTools) {
      ok('工具清单项命中高 ≥44', (h.toolsitem?.h ?? 0) >= 44, `hit=${JSON.stringify(h.toolsitem)}`);
      ok('工具内页签命中高 ≥44', (h.rtitab?.h ?? 0) >= 44, `hit=${JSON.stringify(h.rtitab)}`);
    }
  } else {
    // 桌面档反证：没有触屏媒体查询时，命中区应当就是视觉盒本身
    ok('桌面档复选框命中高回落到 18', (m.hit?.checkbox?.h ?? 0) <= 26, `hit=${m.hit?.checkbox?.h}`);
  }

  if (c.dark) {
    ok('暗色令牌已生效', m.scheme === 'dark', `scheme=${m.scheme}`);
    ok('背景为暗色（亮度低）', luminance(m.bg) < 0.25, `--bg=${m.bg} L=${luminance(m.bg).toFixed(3)}`);
    ok('文字为亮色（亮度高）', luminance(m.text) > 0.55, `--text=${m.text} L=${luminance(m.text).toFixed(3)}`);
    ok('文字/背景对比 ≥ 4.5', contrast(m.text, m.bg) >= 4.5, `${contrast(m.text, m.bg).toFixed(2)}:1`);
  } else if (m.scheme === 'light') {
    ok('浅色背景亮度高', luminance(m.bg) > 0.7, `--bg=${m.bg} L=${luminance(m.bg).toFixed(3)}`);
  }

  ok('动效已降级', m.motion === 'reduce', `motion=${m.motion}`);

  return out;
}

function parseColor(s) {
  const m = String(s).match(/#([0-9a-f]{6})/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = String(s).match(/rgba?\(([^)]+)\)/);
  if (rgb) return rgb[1].split(',').slice(0, 3).map((x) => parseFloat(x));
  return [0, 0, 0];
}

function luminance(hex) {
  const ch = parseColor(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// ------------------------------------------------------------------ 主流程
// --append=<file> —— 把本轮结果并入已有 JSON 数组，便于分批跑完再汇总
const APPEND_TO = (process.argv.find((a) => a.startsWith('--append=')) || '').slice(9);

async function main() {
  if (WANT_LIST) {
    for (const c of CASES) console.log(c.name);
    return;
  }

  // --report=<file> —— 不新开浏览器，直接把已有 JSON 渲染成表格。
  // 配合 --append 分批采集：每批一个短进程，跑完再汇总。
  const REPORT_FROM = (process.argv.find((a) => a.startsWith('--report=')) || '').slice(9);
  if (REPORT_FROM) {
    let data = [];
    try {
      data = JSON.parse(readFileSync(path.resolve(REPORT_FROM), 'utf8'));
    } catch (e) {
      console.error(`\n✗ 读不到 ${REPORT_FROM}: ${e.message}\n`);
      process.exit(2);
    }
    // 按 CASES 顺序排列，方便对照
    const order = new Map(CASES.map((c, i) => [c.name, i]));
    data.sort((a, b) => (order.get(a.case.name) ?? 99) - (order.get(b.case.name) ?? 99));
    const nf = data.reduce((n, r) => n + (r.error ? 1 : (r.checks?.filter((x) => !x.ok).length ?? 0)), 0);
    const done = new Set(data.map((r) => r.case.name));
    const missingCases = CASES.filter((c) => !done.has(c.name)).map((c) => c.name);
    report(data, nf, true);
    if (missingCases.length) console.log(`  未采集：${missingCases.join(', ')}\n`);
    process.exit(nf === 0 && missingCases.length === 0 ? 0 : 1);
  }

  // 1) 确认 dev server 在跑
  try {
    const r = await fetch(`${BASE}/styleguide.html`, { method: 'GET' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.error(`\n✗ 连不上 ${BASE} —— 请先另开终端跑 npm run dev\n  (${e.message})\n`);
    process.exit(2);
  }

  const edge = process.env.EDGE || findEdge();
  console.log(`\nEdge: ${edge}`);
  console.log(`目标: ${BASE}/styleguide.html\n`);

  const { proc, version } = await launchEdge(edge);
  const cdp = new CDP(version.webSocketDebuggerUrl);
  await cdp.ready;

  let { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  let { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);

  // 渲染器挂死后换个 target 重来，别让一个坏目标拖垮后面所有用例
  const resetTarget = async () => {
    try {
      await cdp.send('Target.closeTarget', { targetId });
    } catch {}
    const nt = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 15000);
    targetId = nt.targetId;
    const na = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, undefined, 15000);
    sessionId = na.sessionId;
    await cdp.send('Page.enable', {}, sessionId, 15000);
    await cdp.send('Runtime.enable', {}, sessionId, 15000);
  };

  const results = [];
  let failed = 0;

  const cases = ONLY.length ? CASES.filter((c) => ONLY.includes(c.name)) : CASES;
  if (ONLY.length) {
    const unknown = ONLY.filter((n) => !CASES.some((c) => c.name === n));
    if (unknown.length) throw new Error('未知用例: ' + unknown.join(', ') + '（用 --list 看全部）');
  }
  // 默认 --shots 只截窄屏与暗色这几档，别把 19 张 PNG 全存下来
  const shotNames = new Set((process.env.SHOT_ONLY || 'mobile-390,mobile-320,narrow-768,narrow-390-chat,dark-1440,dark-390').split(','));

  try {
    for (const c of cases) {
      process.stdout.write(`  量 ${c.name.padEnd(18)} ${String(c.w).padStart(4)}×${c.h} … `);
      let r;
      try {
        r = await runCase(cdp, sessionId, c, WANT_SHOTS && shotNames.has(c.name));
      } catch (e) {
        console.log(`采集失败: ${e.message}`);
        failed++;
        results.push({ case: c, error: e.message });
        try {
          await resetTarget();
        } catch (e2) {
          console.log(`  （重建渲染目标也失败: ${e2.message}）`);
        }
        continue;
      }
      const checks = assertions(c, r.metrics);
      const bad = checks.filter((x) => !x.ok);
      failed += bad.length;
      console.log(bad.length === 0 ? '✓' : `✗ ${bad.length} 项`);
      results.push({ case: c, metrics: r.metrics, checks, shot: r.shot });
    }
  } catch (e) {
    console.error(`\n采集过程中断: ${e.message}`);
    failed++;
  }

  // 先出报告，再做清理 —— Windows 上删除被 Edge 占用的 profile 目录可能长时间阻塞，
  // 不能让它挡在结果前面。
  report(results, failed);

  try {
    cdp.close();
  } catch {}
  try {
    proc.kill();
  } catch {}
  await sleep(150);
  try {
    rmSync(PROFILE, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
  } catch {
    /* 目录被占用就算了，留在临时目录里不影响结果 */
  }

  process.exit(failed === 0 ? 0 : 1);
}

function report(results, failed, fromFile = false) {
  // 表格
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log('\n' + '─'.repeat(118));
  console.log(
    pad('view', 19) + num('vw', 5) + num('sidebar', 9) + num('rail', 6) +
    pad(' railMax', 11) + num('topbar', 8) + num('snapshot', 10) + pad(' layout', 9) + '  溢出'
  );
  console.log('─'.repeat(118));
  for (const r of results) {
    if (r.error) {
      console.log(pad(r.case.name, 19) + '  ' + r.error);
      continue;
    }
    const m = r.metrics;
    const sb = m.sidebar ? `${m.sidebar.w}×${m.sidebar.h}` : '—';
    const rl = m.rail ? String(m.rail.w) : '—';
    const tb = m.topbar ? String(m.topbar.h) : '—';
    const sn = m.snapshot ? `${m.snapshot.w}×${m.snapshot.h}` : '—';
    console.log(
      pad(r.case.name, 19) + num(m.vw, 5) + num(sb, 9) + num(rl, 6) +
      pad(' ' + m.railMax, 11) + num(tb, 8) + num(sn, 10) +
      pad(' ' + (m.layout?.dir ?? '—'), 9) + '  ' + (m.overflowX ? '✗ 有' : '· 无')
    );
  }
  console.log('─'.repeat(118));

  // 失败明细
  const bad = [];
  for (const r of results) if (r.checks) for (const k of r.checks) if (!k.ok) bad.push({ c: r.case, k });
  if (bad.length) {
    console.log('\n断言失败：');
    for (const { c, k } of bad) console.log(`  ✗ [${c.name}] ${k.label}  —  ${k.detail}`);
  }

  const totalChecks = results.reduce((n, r) => n + (r.checks?.length ?? 0), 0);
  console.log(
    `\n${failed === 0 ? '✓' : '✗'} ${results.length} 档 / ${totalChecks} 项断言，失败 ${failed}`
  );

  if (!fromFile && (WANT_JSON || APPEND_TO)) {
    mkdirSync(SHOT_DIR, { recursive: true });
    const p = APPEND_TO ? path.resolve(APPEND_TO) : path.join(SHOT_DIR, 'responsive.json');
    let prev = [];
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(raw)) prev = raw;
    } catch {}
    const names = new Set(results.map((r) => r.case.name));
    const merged = prev.filter((r) => !names.has(r.case?.name)).concat(results);
    writeFileSync(p, JSON.stringify(merged, null, 2) + '\n');
    console.log(`  原始数据 → ${p}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('\n✗ ' + e.message + '\n');
  process.exit(2);
});
