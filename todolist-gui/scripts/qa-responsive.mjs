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
//                                     # （端口取自 vite.config.js 的 DEV_PORT；
//                                     #   要把门禁指到别的实例上用 SG_BASE 环境变量）
//   node scripts/qa-responsive.mjs            # 只出表格
//   node scripts/qa-responsive.mjs --shots    # 顺便存图到 .tmp-shot/
//   node scripts/qa-responsive.mjs --json     # 额外吐一份原始 JSON
//
// 退出码（R-42）：0 全绿 / 1 断言失败 / 2 环境未就绪（dev server 没起、找不到浏览器）

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  exitWithError,
  ensureServer,
  requireBrowser,
  resolveBase,
  resolveDevPort,
} from './qa-preflight.mjs';

// 端口只有一条真相源：vite.config.js 的 DEV_PORT（R-11）。
// 这里刻意删掉了两条旧逻辑：
//   · `readServerPort()` 读仓库根的 `.todolist-server.port` —— 那是早期 Python 启动器
//     留下的文件，早就没有东西在写它，读到的是历史残值；
//   · `?? 15180` 回落 —— 回落会让门禁连到一个不存在的端口，然后所有档都报「连不上」，
//     看起来像环境问题，实际是端口错了。
// 解析失败时 fail-loud 退 2（环境未就绪），不猜。
function mustResolvePort() {
  try {
    return resolveDevPort();
  } catch (err) {
    exitWithError(err);
  }
}
const SERVER_PORT = mustResolvePort();
// BASE 仍允许 SG_BASE 覆盖（手工把门禁指到别的实例上调试）。
const BASE = resolveBase(SERVER_PORT);
// CDP 调试端口与 dev server 端口是两件事，别混（旧注释里两者都叫 PORT 容易看串）。
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
  // 外壳本体：底部导航要贴在它的下沿（宽屏 = 视口；样式指南里是演示区）
  shell: '.app',
  topbar: '.topbar',
  // 页眉最左的侧栏开关（2026-10-18 左侧化）；窄屏（≤768）整枚退场，见下面的断言
  panelToggle: '.panel-toggle',
  tabs: '.tabs',
  // 窄屏底部导航（2026-11-15）：今日 / 即将到期 / 全部 / 标签，宽屏 display:none
  bottomnav: '.bottom-nav',
  bnavitem: '.bnav-item',
  // 主区本体：原型 v2 起列表不再套"阅读栏宽上限"
  rail: '.main',
  row: '.task-row',
  checkbox: '.task-row .checkbox',
  navitem: '.nav-item',
  editwin: '.edit-window',
  // 工具集（第三个页签）：目录态卡片墙 + 工作态工具区。
  // 2026-10-17 卡片式改版：左栏清单（.tools-nav/.tools-list/.tools-item）已删除，
  // 目录态改探 .tools-wall/.tools-cards/.tools-card；.tool-pane 只在工作态存在。
  toolsWall: '.tools-wall',
  toolsCards: '.tools-cards',
  toolsCard: '.tools-card',
  toolsSec: '.tools-sec',
  toolPane: '.tool-pane',
  rtiTab: '.tool-tab',
  rtiRowDel: '.tool-row-del',
  // 日历（清单的第二种显示模式）：网格 / 格子 / chip / 页头。
  // 2026-11-15：模式开关从页眉移除（日历降为侧栏入口），量具随之撤销；
  // 同一天又删掉了右栏日详情与「无日期」托盘 —— 日历页只剩网格，
  // 任务只在点开的浮层里成行显示，所以 side/tray 两项探针也一并撤销。
  calGrid: '.cal-grid',
  calCell: '.cal-cell',
  calChip: '.cal-chip',
  calHead: '.cal-head',
  // 快录框只在列表页存在：日历页拿它做"已移除"的反证
  quickAdd: '.quick-add',
  quickAddBar: '.quick-add-bar',
  firstGroup: '.task-list > .group-title',
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
  // 窄边「全部」视图：组头的一键展开 / 收起只在有可展开父项时出现，
  // 几何之外还要点一下，确认它真的收起 / 摊开子行（2026-11-17）。
  { name: 'narrow-600-all', w: 600, h: 900, view: 'list-all', tier: 'narrow', toggleAll: true, note: '窄边全部视图：组头一键展开 / 收起' },
  { name: 'mobile-480', w: 480, h: 844, view: 'list', tier: 'narrow', note: '断点线上，字号再降一档' },
  { name: 'mobile-479', w: 479, h: 844, view: 'list', tier: 'small', note: '断点下方，--fs-2xl 应变小' },
  { name: 'mobile-390', w: 390, h: 844, view: 'list', tier: 'small', note: 'iPhone 14 逻辑宽度' },
  { name: 'mobile-360', w: 360, h: 780, view: 'list', tier: 'small' },
  { name: 'mobile-320', w: 320, h: 640, view: 'list', tier: 'small', note: '最窄兜底' },
  // 桌面档的另外三个页面各留一张对照图：外壳换过之后它们的骨架同样要验
  { name: 'desktop-1280-tools', w: 1280, h: 800, view: 'tools', tier: 'wide' },
  { name: 'desktop-1280-settings', w: 1280, h: 800, view: 'settings', tier: 'wide' },
  { name: 'desktop-1280-all', w: 1280, h: 800, view: 'list-all', tier: 'wide' },
  { name: 'narrow-390-drawer', w: 390, h: 844, view: 'drawer', tier: 'small', note: '编辑浮窗小屏：占满可用宽度' },
  { name: 'coarse-390', w: 390, h: 844, view: 'list', tier: 'small', coarse: true, note: '触屏命中区 ≥44px' },
  { name: 'dark-1440', w: 1440, h: 900, view: 'list', tier: 'wide', dark: true },
  { name: 'dark-390', w: 390, h: 844, view: 'list', tier: 'small', dark: true },
  // 工具集（第三个页签）也必须在断点上过一遍 —— 它是最大的一块新表面
  { name: 'mid-1080-tools', w: 1080, h: 800, view: 'tools', tier: 'mid' },
  { name: 'narrow-768-tools', w: 768, h: 900, view: 'tools', tier: 'narrow', note: '断点线上，卡片网格收窄' },
  { name: 'mobile-390-tools', w: 390, h: 844, view: 'tools', tier: 'small' },
  { name: 'coarse-390-tools', w: 390, h: 844, view: 'tools', tier: 'small', coarse: true, note: '触屏：卡片与星标命中区 ≥44px' },
  { name: 'coarse-390-tools-work', w: 390, h: 844, view: 'tools-rti', tier: 'small', coarse: true, note: '触屏：工作态页签命中区 ≥44px' },
  { name: 'dark-1280-tools', w: 1280, h: 800, view: 'tools', tier: 'wide', dark: true },
  // 日历（清单的第二种显示模式）：宽档 42 格铺满主区，窄档 chip 收成色块。
  // 2026-11-15 起日历页只剩网格（无快录框 / 右栏 / 托盘），浮层不在首屏几何里。
  // 已完成（只读）视图单独留一档，验证只读标记仍然在。
  { name: 'desktop-1280-calendar', w: 1280, h: 800, view: 'calendar', tier: 'wide' },
  { name: 'mid-1080-calendar', w: 1080, h: 800, view: 'calendar', tier: 'mid', note: '断点线上，网格不缩边' },
  { name: 'narrow-768-calendar', w: 768, h: 900, view: 'calendar', tier: 'narrow', note: '断点线上，chip 收成色块' },
  { name: 'mobile-390-calendar', w: 390, h: 844, view: 'calendar', tier: 'small', note: 'chip 收成色块' },
  { name: 'mobile-360-calendar', w: 360, h: 780, view: 'calendar', tier: 'small' },
  { name: 'coarse-390-calendar', w: 390, h: 844, view: 'calendar', tier: 'small', coarse: true, note: '触屏：日期格命中区 ≥44px' },
  { name: 'dark-1280-calendar', w: 1280, h: 800, view: 'calendar', tier: 'wide', dark: true },
  { name: 'desktop-1280-calendar-done', w: 1280, h: 800, view: 'calendar-done', tier: 'wide', note: '只读：标了只读' },
  // 2026-11-11 窄边自动降级：上面 8 档强制日历，回归的是日历自身的窄屏降级；
  // 这两档走产品同款的有效布局逻辑，回归「临时切列表 / 恢复宽边」后的几何。
  { name: 'mobile-390-autonarrow', w: 390, h: 844, view: 'calendar-autonarrow', tier: 'small', note: '窄边自动降级：列表布局 + 提示条' },
  { name: 'desktop-1280-autonarrow', w: 1280, h: 800, view: 'calendar-autonarrow', tier: 'wide', note: '恢复宽边：回到日历' },
];

// ------------------------------------------------------------------ CDP 客户端
// 浏览器探测收敛到 preflight（R-11）：原来这份候选表只有 Windows 路径，
// macOS 上三个门禁全都死在「找不到 Edge」。找不到时抛错带 exitCode=EXIT_ENV。

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
    railMax: root.getPropertyValue('--rail-max').trim(),
    // 外壳行高（2026-11-16 十七改：标题行 / 页签条 / 底栏三行同取 --chrome-row-h）
    chromeRowVar: root.getPropertyValue('--chrome-row-h').trim(),
    titlebarVar: root.getPropertyValue('--titlebar-h').trim(),
    railRowVar: root.getPropertyValue('--rail-row-h').trim(),
    bnavCount: document.querySelectorAll('.bnav-item').length,
    fs2xl: root.getPropertyValue('--fs-2xl').trim(),
    bg: root.getPropertyValue('--bg').trim(),
    surface: root.getPropertyValue('--surface').trim(),
    text: root.getPropertyValue('--text').trim(),
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference',
    coarse: matchMedia('(pointer: coarse)').matches,
  };
  for (const [k, sel] of Object.entries(PROBES)) out[k] = pick(sel);

  // 快录条上下留白（2026-11-17）：上段只看条自身 padding-top，
  // 下段 = 条 padding-bottom + 首个分组头 padding-top（两段一起让 30%）。
  const qaBar = document.querySelector('.quick-add-bar');
  const firstGroup = document.querySelector('.task-list > .group-title');
  out.quickAddPad = qaBar
    ? {
        top: getComputedStyle(qaBar).paddingTop,
        bottom: getComputedStyle(qaBar).paddingBottom,
      }
    : null;
  out.firstGroupPadTop = firstGroup ? getComputedStyle(firstGroup).paddingTop : null;

  // 卡片墙的网格列数：auto-fill 的实际列数只能从计算样式读
  // （split 后是 "318.3px 318.3px …" 这样的 used value）
  const cardsEl = document.querySelector('.tools-cards');
  if (cardsEl) {
    out.cardsCols = getComputedStyle(cardsEl).gridTemplateColumns.split(' ').filter(Boolean).length;
  }

  // 日历网格：42 格是硬契约（6×7，翻月高度不跳）；列数从 used value 读。
  const calEl = document.querySelector('.cal-grid');
  if (calEl) {
    out.calCellCount = calEl.querySelectorAll('.cal-cell').length;
    out.calCols = getComputedStyle(calEl).gridTemplateColumns.split(' ').filter(Boolean).length;
  }

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
    bnavitem: hitBox('.bnav-item'),
    iconbtn: hitBox('.icon-btn'),
    tab: hitBox('.tab'),
    toolscard: hitBox('.tools-card'),
    toolsfav: hitBox('.tools-card-fav'),
    rtitab: hitBox('.tool-tab'),
    rtidel: hitBox('.tool-row-del'),
    calcell: hitBox('.cal-cell'),
  };
  return JSON.stringify(out);
})()`;

// 组头一键展开 / 收起（2026-11-17）：按钮的实际效果只能靠点击验证。
// 返回收起前 / 点一次 / 再点一次三个快照，子行数由调用方断言。
async function probeToggleAll(cdp, sessionId) {
  const evalJs = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    }, sessionId, 15000);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const snapshot = async () => JSON.parse(await evalJs(`JSON.stringify({
    kids: document.querySelectorAll('.task-row.is-child').length,
    label: document.querySelector('.group-toggle')?.getAttribute('aria-label') || null,
  })`));
  const before = await snapshot();
  await evalJs(`document.querySelector('.group-toggle')?.click(); true`);
  await sleep(250);
  const collapsed = await snapshot();
  await evalJs(`document.querySelector('.group-toggle')?.click(); true`);
  await sleep(250);
  const expanded = await snapshot();
  return { before, collapsed, expanded };
}

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

  // 组头一键展开 / 收起：几何量不出「点一下真的收起了子行」，
  // 所以单独点两次（收起 → 展开）并数 .task-row.is-child 的行数。
  if (c.toggleAll) metrics.toggleAll = await probeToggleAll(cdp, sessionId);

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
  // 只有列表页有 .layout / .sidebar / .topbar / 主区 rail；
  // 拿别的页面的断言去套只会产出噪音，所以显式分流。
  const isList = m.layout != null;
  // 工具集两态：目录态有 .tools-wall（无 .tool-pane），工作态反之。
  // 断言按态分流，别拿一态的探针去套另一态。
  const isTools = m.toolsWall != null || m.toolPane != null;
  // 日历是列表页的第二种显示模式：.layout 仍在（isList 为真），
  // 额外的骨架断言按 .cal-grid 是否存在分流。
  const isCal = m.calGrid != null;

  ok('无横向溢出', !m.overflowX, `docW=${m.docW} vw=${m.vw}`);

  // 快录条上下留白（2026-11-17）：窄边上面 8→6（-25%），下面两段合计 20→14（-30%）。
  // 只量 padding 的实数，不量"看起来"的间距 —— 后者会随字体与 stage 外壳漂移。
  if (isList && !isCal && m.quickAddPad) {
    const top = parseFloat(m.quickAddPad?.top ?? '');
    const bottom = parseFloat(m.quickAddPad?.bottom ?? '');
    const firstTop = parseFloat(m.firstGroupPadTop ?? '');
    const wantTop = c.tier === 'narrow' || c.tier === 'small' ? 6 : 8;
    ok(`快录条上留白 = ${wantTop}px`, Math.abs(top - wantTop) <= 0.6, `top=${m.quickAddPad?.top}`);
    ok('快录条下留白合计 = 14px（原 20 的 70%）', Math.abs(bottom + firstTop - 14) <= 0.6,
      `bottom=${m.quickAddPad?.bottom} + firstGroupTop=${m.firstGroupPadTop}`);
  }

  // 组头一键展开 / 收起（2026-11-17）：按钮不止要在，点下去还得真的收 / 放子行。
  if (m.toggleAll) {
    const t = m.toggleAll;
    ok('组头一键钮默认报「收起全部子任务」', t.before?.label === '收起全部子任务',
      `label=${t.before?.label} kids=${t.before?.kids}`);
    ok('点一次收起全部子行，并翻成「展开全部子任务」',
      (t.before?.kids ?? 0) > 0 && t.collapsed?.kids === 0 && t.collapsed?.label === '展开全部子任务',
      `before=${t.before?.kids} after=${t.collapsed?.kids} label=${t.collapsed?.label}`);
    ok('再点一次恢复全部子行',
      t.expanded?.kids === t.before?.kids && t.expanded?.label === '收起全部子任务',
      `expanded=${t.expanded?.kids} before=${t.before?.kids}`);
  }

  if (isList && c.tier === 'wide') {
    ok('侧栏为竖向列', g('sidebar')?.disp === 'flex' || g('sidebar')?.dir === 'column', JSON.stringify({ disp: g('sidebar')?.disp, dir: g('sidebar')?.dir }));
    ok('布局为横向 row', g('layout')?.dir === 'row', `layout.dir=${g('layout')?.dir}`);
    ok('侧栏宽度 = --sidebar-w(176)', g('sidebar')?.w === 176, `w=${g('sidebar')?.w}`);
    ok('侧栏高度撑满主区', (g('sidebar')?.h ?? 0) > 300, `h=${g('sidebar')?.h}`);
    ok('--rail-max = 900px', m.railMax === '900px', m.railMax);
    ok('主区占满剩余宽度（≥ 560）', (g('rail')?.w ?? 0) >= 560, `w=${g('rail')?.w}`);
    ok('上下文条为单行 36px', (g('topbar')?.h ?? 0) >= 30 && (g('topbar')?.h ?? 0) <= 44, `h=${g('topbar')?.h}`);
    ok('活动栏为 40px 竖轨', g('tabs')?.w === 40 && (g('tabs')?.h ?? 0) > 300, JSON.stringify(g('tabs')));
    // 页眉左侧化（2026-10-18）：侧栏开关必须在页眉最左，紧贴左内边距
    ok('侧栏开关在页眉最左', (g('panelToggle')?.x ?? 1e9) - (g('topbar')?.x ?? 0) <= 24, `toggle.x=${g('panelToggle')?.x} topbar.x=${g('topbar')?.x}`);
    // 外壳行高（2026-11-16 十七改）：标题行 / 页签条 / 底栏共用 --chrome-row-h(31)
    ok('标题行 = --chrome-row-h(31)', m.chromeRowVar === '31px', m.chromeRowVar);
    ok('宽屏不显示底部导航', g('bottomnav') == null || g('bottomnav').disp === 'none', JSON.stringify(g('bottomnav')));
  }

  if (isList && c.tier === 'mid') {
    ok('侧栏仍为竖向', g('sidebar')?.dir !== 'row' || (g('sidebar')?.h ?? 0) > 300, `dir=${g('sidebar')?.dir} h=${g('sidebar')?.h}`);
    ok('--sidebar-w 收紧为 156', m.sidebarVar === '156px', m.sidebarVar);
    ok('--rail-max 放开为 100%', m.railMax === '100%', m.railMax);
    ok('布局仍为横向', g('layout')?.dir === 'row', `layout.dir=${g('layout')?.dir}`);
  }

  if (isList && (c.tier === 'narrow' || c.tier === 'small')) {
    ok('布局转纵向 column', g('layout')?.dir === 'column', `layout.dir=${g('layout')?.dir}`);
    // 2026-11-15 十一改：窄屏导航搬到底部条，页眉那枚侧栏开关退场（留着也点不出变化）
    ok('窄屏不显示侧栏开关', g('panelToggle') == null || g('panelToggle').disp === 'none', JSON.stringify(g('panelToggle')));
    // 侧栏也不再翻成横向过滤条：整条 display:none，宽度归零
    ok('窄屏不显示侧栏', g('sidebar') == null || g('sidebar').disp === 'none', JSON.stringify(g('sidebar')));
    ok('侧栏不占高度', (g('sidebar')?.h ?? 0) === 0, `h=${g('sidebar')?.h}`);
    ok('页签条行高 = --chrome-row-h(31)', (g('tabs')?.h ?? 999) <= 34, `h=${g('tabs')?.h} var=${m.railRowVar}`);
    ok('活动栏转横向（占满宽度）', (g('tabs')?.w ?? 0) > m.docW * 0.9, JSON.stringify(g('tabs')));
    ok('上下文条仍是单行', (g('topbar')?.h ?? 0) >= 30 && (g('topbar')?.h ?? 0) <= 48, `h=${g('topbar')?.h}`);
    ok('rail 占满内容宽', (g('rail')?.w ?? 0) > m.docW * 0.9, `w=${g('rail')?.w} docW=${m.docW}`);
    ok('任务行未溢出', (g('row')?.w ?? 0) <= m.docW, `w=${g('row')?.w}`);

    // --- 底部导航（2026-11-15）---
    ok('底部导航已渲染（4 个按钮）', m.bnavCount === 4, `count=${m.bnavCount}`);
    ok('底部导航贴住窗口下沿', Math.abs((g('bottomnav')?.y ?? -1) + (g('bottomnav')?.h ?? 0) - ((g('shell')?.y ?? 0) + (g('shell')?.h ?? 0))) <= 2, `nav.bottom=${(g('bottomnav')?.y ?? 0) + (g('bottomnav')?.h ?? 0)} shell.bottom=${(g('shell')?.y ?? 0) + (g('shell')?.h ?? 0)}`);
    ok('底部导航占满宽度', Math.abs((g('bottomnav')?.w ?? 0) - m.docW) <= 20, `w=${g('bottomnav')?.w} docW=${m.docW}`);
    // 关键：列表滚动区止于导航上缘 —— 清单再多也压不到按钮（结构上不可能重叠）
    ok('列表不与底部导航重叠', (g('rail')?.y ?? 0) + (g('rail')?.h ?? 0) <= (g('bottomnav')?.y ?? 0) + 1, `rail.bottom=${(g('rail')?.y ?? 0) + (g('rail')?.h ?? 0)} nav.y=${g('bottomnav')?.y}`);
    ok('底部导航按钮均分整宽', (g('bnavitem')?.w ?? 0) >= m.docW / 4 - 2, `btn.w=${g('bnavitem')?.w} docW=${m.docW}`);
    // 底栏高跟着页签条走：2026-11-17 用户要求底栏比页签条高 20%（31 → 37.2）。
    ok('底栏 = 页签条 × 1.2（增高 20%）', Math.abs((g('bottomnav')?.h ?? 0) - (g('tabs')?.h ?? 0) * 1.2) <= 1,
      `tabs.h=${g('tabs')?.h} bnav.h=${g('bottomnav')?.h}`);
  }

  // 工具集：目录态卡片网格（宽中档多列、窄小档单列），工作态占满宽度
  if (isTools) {
    if (m.toolsWall != null) {
      ok('卡片墙已渲染（墙 + 网格 + 分区）', g('toolsCards') != null && g('toolsSec') != null, JSON.stringify({ cards: g('toolsCards'), sec: g('toolsSec') }));
      if (c.tier === 'wide' || c.tier === 'mid') {
        ok('卡片网格多列（宽档 ≥4，中档 ≥3）', (m.cardsCols ?? 0) >= (c.tier === 'wide' ? 4 : 3), `cols=${m.cardsCols}`);
        ok('卡片宽度 ≥200', (g('toolsCard')?.w ?? 0) >= 200, `w=${g('toolsCard')?.w}`);
        ok('墙铺满内容宽', (g('toolsWall')?.w ?? 0) > m.docW * 0.9, `w=${g('toolsWall')?.w} docW=${m.docW}`);
      } else {
        ok('卡片网格单列', (m.cardsCols ?? 0) === 1, `cols=${m.cardsCols}`);
        ok('卡片占满墙宽（单列大卡）', (g('toolsCard')?.w ?? 0) >= (g('toolsWall')?.w ?? 0) - 30, `card=${g('toolsCard')?.w} wall=${g('toolsWall')?.w}`);
        ok('卡片在视口内', (g('toolsCard')?.x ?? -1) >= 0 && (g('toolsCard')?.w ?? 0) <= m.vw, JSON.stringify(g('toolsCard')));
      }
    }
    if (m.toolPane != null) {
      ok('工作态已渲染（页头 + 工作区）', g('toolPane') != null);
      ok('工作区占满内容宽', (g('toolPane')?.w ?? 0) > m.docW * 0.9, `w=${g('toolPane')?.w} docW=${m.docW}`);
      ok('工具内页签仍在（窄屏可切换页面）', (g('rtiTab')?.w ?? 0) > 0 && (g('rtiTab')?.disp !== 'none'), JSON.stringify(g('rtiTab')));
    }
  }

  // 日历：42 格 7 列是硬契约；页面上只有网格，没有快录框 / 右栏 / 托盘。
  if (isCal) {
    ok('日历网格恒 42 格（6×7）', m.calCellCount === 42, `cells=${m.calCellCount}`);
    ok('日历网格恒 7 列', m.calCols === 7, `cols=${m.calCols}`);
    ok('日历头部已渲染（翻月 + 统计）', g('calHead') != null && (g('calHead')?.w ?? 0) > 0, JSON.stringify(g('calHead')));
    ok('网格未溢出视口', (g('calGrid')?.x ?? -1) >= 0 && (g('calGrid')?.x ?? 0) + (g('calGrid')?.w ?? 0) <= m.vw + 1, JSON.stringify({ x: g('calGrid')?.x, w: g('calGrid')?.w, vw: m.vw }));
    // 2026-11-15：日历页不再有快录框（新建走「点日期 → 浮层添加」）
    ok('日历页没有快录框', g('quickAdd') == null, `quickAdd=${JSON.stringify(g('quickAdd'))}`);
    if (c.tier === 'wide' || c.tier === 'mid') {
      // 没有右栏之后，网格应当铺满主区（止于右侧内边距，不再被 288px 的日详情挤窄）
      ok('网格铺满主区宽度', (g('calGrid')?.x ?? 0) + (g('calGrid')?.w ?? 0) >= (g('rail')?.x ?? 0) + (g('rail')?.w ?? 0) - 48,
        `grid.right=${(g('calGrid')?.x ?? 0) + (g('calGrid')?.w ?? 0)} rail.right=${(g('rail')?.x ?? 0) + (g('rail')?.w ?? 0)}`);
    } else {
      ok('窄屏 chip 收成色块（宽 ≤10）', (g('calChip')?.w ?? 99) <= 10, `chip.w=${g('calChip')?.w}`);
    }
  }

  if (c.tier === 'small') {
    ok('--fs-2xl 降到 21px', m.fs2xl === '21px', m.fs2xl);
  }

  if (c.view === 'drawer' && m.editwin) {
    ok('编辑浮窗在视口内（居中且不溢出）',
      (g('editwin')?.x ?? -1) >= 0 && (g('editwin')?.x ?? 0) + (g('editwin')?.w ?? 0) <= m.vw + 1,
      JSON.stringify({ x: g('editwin')?.x, w: g('editwin')?.w, vw: m.vw }));
    if (c.tier === 'narrow' || c.tier === 'small') {
      ok('编辑浮窗占满可用宽度（仅留遮罩边距）',
        (g('editwin')?.w ?? 0) >= m.docW * 0.85 && (g('editwin')?.w ?? 0) <= m.docW,
        `w=${g('editwin')?.w} docW=${m.docW}`);
    }
  }

  if (c.coarse) {
    const h = m.hit || {};
    ok('命中区生效 pointer:coarse', m.coarse === true, `coarse=${m.coarse}`);
    // 这两组探测点只存在于列表页；工具页上没有它们，
    // 硬套过来只会产出"假失败"（hit=undefined），所以按视图分流。
    if (isList) {
      // 2026-11-15：窄屏导航搬进底部条，探底部按钮 —— 均分整宽。
      // 2026-11-16 十七改：底栏不再硬撑 44；2026-11-17 起按页签条的 1.2 倍走（37.2）
      // （横向页签条早就按这条走）：命中区就是整枚按钮本身，宽度由均分兜住。
      ok('底部导航按钮宽 ≥44、占满整条', (h.bnavitem?.w ?? 0) >= 44 && (h.bnavitem?.h ?? 0) >= 28, `hit=${JSON.stringify(h.bnavitem)}`);
      // 复选框只在真有任务行的页面量：日历页只剩网格（任务行住在浮层里），
      // 拿列表的探针去套它会得到 hit=null 的假失败。
      if (g('row') != null) {
        ok('复选框命中高 ≥44（::before 外扩）', (h.checkbox?.h ?? 0) >= 44, `hit=${h.checkbox?.h}`);
        ok('复选框命中宽 ≥40', (h.checkbox?.w ?? 0) >= 40, `hit=${h.checkbox?.w}`);
        ok('复选框不被遮挡', h.checkbox != null, `hit=${JSON.stringify(h.checkbox)}`);
      }
    }
    if (isTools) {
      // 目录态：整卡天然是大命中区；星标 24px 视觉、命中区靠 ::before 外扩
      if (m.toolsWall != null) {
        ok('工具卡片命中高 ≥44', (h.toolscard?.h ?? 0) >= 44, `hit=${JSON.stringify(h.toolscard)}`);
        ok('收藏星标命中区 ≥44（::before 外扩）', (h.toolsfav?.h ?? 0) >= 44 && (h.toolsfav?.w ?? 0) >= 44, `hit=${JSON.stringify(h.toolsfav)}`);
      }
      // 工作态：工具内页签的命中区（页签只有 22px 高，靠 coarse 段撑到 44）
      if (m.toolPane != null) {
        ok('工具内页签命中高 ≥44', (h.rtitab?.h ?? 0) >= 44, `hit=${JSON.stringify(h.rtitab)}`);
      }
    }
    if (isCal) {
      // 日期格是面积型目标：7 列分摊宽度，6 行分摊高度 —— 宽必须 ≥44，
      // 高在矮屏上允许 40（整格可点，不存在"点不中"的细条）。
      ok('日期格命中宽 ≥44', (h.calcell?.w ?? 0) >= 44, `hit=${JSON.stringify(h.calcell)}`);
      ok('日期格命中高 ≥40', (h.calcell?.h ?? 0) >= 40, `hit=${JSON.stringify(h.calcell)}`);
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

  // 1) 确认 dev server 在跑（环境未就绪 → 退出码 2，与断言失败区分开）
  await ensureServer(BASE);

  const edge = requireBrowser();
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
  const shotNames = new Set((process.env.SHOT_ONLY || 'mobile-390,mobile-320,narrow-768,dark-1440,dark-390,desktop-1280-calendar,narrow-768-calendar,mobile-390-calendar,dark-1280-calendar').split(','));

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
    pad(' railMax', 11) + num('topbar', 8) + pad(' layout', 9) + '  溢出'
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
    console.log(
      pad(r.case.name, 19) + num(m.vw, 5) + num(sb, 9) + num(rl, 6) +
      pad(' ' + m.railMax, 11) + num(tb, 8) +
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

// 退出码语义（R-42）：环境未就绪带 exitCode=2（由 preflight 标），
// 其余未预期的崩溃按「门禁不通过」退 1 —— 宁可报红，也不能把崩溃读成通过。
main().catch((e) => {
  exitWithError(e);
});
