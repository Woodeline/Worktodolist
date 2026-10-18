#!/usr/bin/env node
// 工具集 UI 级回归 —— 真实浏览器里点真按钮，核对真实数值。
//
// 分两层，职责不同：
//
//   ① 外壳契约（通用，认 registry 不认具体工具）
//      遍历 registry 里每个可见工具，在卡片墙（目录态）上逐张点卡进入
//      工作态，核对页头文案 / 风险徽标 / 版式类名 / 是否掉进崩溃页 /
//      本体有没有渲染出东西 / 有没有旧类名残留；再核对返回与 Esc。
//      期望值全部**从 registry 现算**，所以新增一个工具会自动进入门禁，
//      这个脚本不需要跟着改 —— 这正是"加工具只改 registry"那句承诺的验证方式。
//
//   ② RTI 端到端数值（专用）
//      从示例数据一路读到屏幕上的文本。断言值来自 lib/rti/demo.js 的数据集
//      （有独立 Python 基准对拍），所以它们是"端到端"的：实时重算没接上、结果
//      放错页、画布没重画 —— 逻辑层全绿也照样能坏，只有这一层能抓到。
//
// 顺带核对工具集外壳的两条结构约定：
//   ① 顶栏是三个页签（对话 / 列表 / 工具），「工具」为当前页；
//   ② 外壳不认识任何具体工具 —— 墙由 registry 驱动，加工具不改外壳。
//
// 2026-10-17 卡片式改版后的口径变化：
//   · 目录态探 .tools-wall / .tools-cards / .tools-card（旧的 .tools-nav /
//     .tools-item 已随左栏一起删除）；
//   · 工具卡数 = registry 可见工具数；预留卡（.tools-slot，虚线装饰位）
//     按分组现算，规则与实现同源于 wallConfig.js，不另抄一份；
//   · 卡片名改集合比较 —— 收藏置顶与 MRU 会重排，不能再逐序断言；
//   · 墙态默认视图（?view=tools）不再直接打开第一个工具，要点卡才进工作态。
//
// 用法：npm run test:tools   （需要先起 dev：npm run dev -- --port 15181 --strictPort）
//      SG_BASE=http://localhost:15181 npm run test:tools
//      --shots  额外输出 qa-artifacts/tools-*.png
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

// 门禁的期望值直接来自 registry 与 wallConfig —— 不另抄一份清单，否则两边迟早漂移。
const { GROUPS, visibleTools, findTool, riskBadges, canWrite } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'components', 'tools', 'registry.js')).href
);
const { RESERVED_SLOT_LIMIT } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'components', 'tools', 'wallConfig.js')).href
);
const TOOL_LIST = visibleTools();

// 预留卡期望数：按 registry 分组现算（组内工具数 < RESERVED_SLOT_LIMIT 才出一张）。
// 收藏分区不渲染预留卡，所以期望值与收藏状态无关。
const RESERVED_SLOTS = GROUPS.reduce((n, g) => {
  const count = TOOL_LIST.filter((t) => t.group === g.id).length;
  return n + (count > 0 && count < RESERVED_SLOT_LIMIT ? 1 : 0);
}, 0);
const EXPECT_GROUP_LABELS = GROUPS.map((g) => g.label);

const EDGE = process.env.EDGE || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const BASE = process.env.SG_BASE || 'http://localhost:15181';
const PORT = 9561;
const PROFILE = path.join(tmpdir(), 'todolist-qa-tools-profile');
const OUT = path.join(ROOT, 'qa-artifacts');
const WANT_SHOTS = process.argv.includes('--shots');
const SAVE_KEY = 'todolist.tool.rti.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: Boolean(cond) });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${extra}`}`);
}

class CDP {
  constructor(url) {
    this.seq = 0;
    this.pending = new Map();
    this.waiters = [];
    // 页面控制台。工具崩溃时 ToolBoundary 会把原始 error + 组件栈打到 console.error，
    // 而错误边界页面上只有一句 message —— 没有这一份就只剩"哪个工具坏了"，查不出为什么。
    this.console = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', () => rej(new Error('CDP 连接失败')));
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message));
        else res(m.result);
        return;
      }
      if (m.method) {
        if (m.method === 'Runtime.consoleAPICalled') {
          const text = (m.params.args || [])
            .map((a) => (a.value != null ? String(a.value) : a.description || a.type || ''))
            .join(' ');
          this.console.push({ type: m.params.type, text });
        }
        for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
          if (this.waiters[i].method === m.method) {
            const w = this.waiters.splice(i, 1)[0];
            w.res(m.params);
          }
        }
      }
    });
  }

  send(method, params = {}, sid, timeout = 20000) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sid) payload.sessionId = sid;
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('超时 ' + method));
        }
      }, timeout);
      this.pending.set(id, {
        res: (v) => {
          clearTimeout(t);
          res(v);
        },
        rej: (e) => {
          clearTimeout(t);
          rej(e);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitFor(method, timeout = 15000) {
    return new Promise((res, rej) => {
      const w = { method, res };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          rej(new Error('等待超时 ' + method));
        }
      }, timeout);
    });
  }
}

// ── 页面里用的小工具（每次注入，避免依赖上一次的求值上下文） ──────────────
const HELPERS = `
  window.__q = (s) => document.querySelector(s);
  window.__qa = (s) => Array.from(document.querySelectorAll(s));
  window.__btn = (root, text) => Array.from((root || document).querySelectorAll('button'))
    .find((b) => b.textContent.trim() === text);
  window.__set = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // 画布上"到底画了东西没有"：画布自身位图是透明的，只有描过的像素才有 alpha
  window.__ink = () => {
    const cv = window.__q('.tool-canvas');
    if (!cv || !cv.width || !cv.height) return { w: 0, h: 0, ink: 0 };
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 20) ink += 1;
    return { w: cv.width, h: cv.height, ink };
  };
  true;
`;

async function main() {
  if (!EDGE) throw new Error('找不到 Edge/Chrome，可设置 EDGE 环境变量');
  if (!TOOL_LIST.length) throw new Error('registry 里没有可见工具，门禁无从校验');
  rmSync(PROFILE, { recursive: true, force: true });

  const proc = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--force-device-scale-factor=2',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let version = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) {
        version = await r.json();
        break;
      }
    } catch {
      // 还没起来
    }
    await sleep(250);
  }
  if (!version) {
    proc.kill();
    throw new Error('Edge 未就绪');
  }

  const cdp = new CDP(version.webSocketDebuggerUrl);
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);

  const evalJs = async (expression, timeout = 20000) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid, timeout);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`页面内异常：${d.text} ${d.exception ? d.exception.description : ''}`);
    }
    return r.result ? r.result.value : undefined;
  };

  const goto = async (view, w, h, dark = false) => {
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile: w <= 768, screenWidth: w, screenHeight: h },
      sid
    );
    await cdp.send(
      'Emulation.setEmulatedMedia',
      {
        media: '',
        features: [
          { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      },
      sid
    );
    const loaded = cdp.waitFor('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${BASE}/styleguide.html?view=${view}` }, sid);
    await loaded;
    await sleep(700);
    await evalJs(`(() => {
      const nav = document.querySelector('.sg-nav'); if (nav) nav.remove();
      const stage = document.querySelector('.sg-stage');
      if (stage) { stage.style.padding = '0'; stage.style.background = 'transparent'; stage.style.minHeight = '100vh'; }
      document.body.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg');
      return true;
    })()`, 10000);
    // 等这一态真的就位：tools-<id> 视图（带 request）直接进工作态，等工具本体；
    // tools 视图先进目录态，等卡片墙。两态不同的等待目标，别互相傻等。
    const wantTool = view.startsWith('tools-');
    const ready = wantTool
      ? `!!document.querySelector('.tool-layout') && !document.querySelector('.tool-loading')`
      : `!!document.querySelector('.tools-wall')`;
    for (let i = 0; i < 40; i += 1) {
      const ok = await evalJs(ready, 8000);
      if (ok) break;
      await sleep(120);
    }
    await evalJs(HELPERS, 8000);
    await sleep(200);
  };

  const shot = async (name, scrollTo) => {
    if (scrollTo) {
      await evalJs(
        `(() => { const el = document.querySelector(${JSON.stringify(scrollTo)}); if (el) el.scrollIntoView({ block: 'center' }); return true; })()`,
        8000
      );
      await sleep(300);
    }
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sid, 20000);
    writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('  → ' + name);
  };

  mkdirSync(OUT, { recursive: true });

  /* ═══════════════════════════════════════════════════════════════════
     1. 外壳结构：三个页签 + registry 驱动的卡片墙
     ═══════════════════════════════════════════════════════════════════ */
  await goto('tools', 1280, 900);
  const shell = await evalJs(`(() => {
    const q = window.__q;
    const cards = window.__qa('.tools-card');
    const grid = q('.tools-cards');
    return {
      tabs: window.__qa('.tabs-group .tab').map((b) => b.textContent.trim()),
      tabCount: window.__qa('.tabs-group .tab').length,
      wall: !!q('.tools-wall'),
      cards: !!grid,
      search: !!q('.tools-wall-search input'),
      navFoot: !!q('.tools-nav-foot'),
      // 墙态不该挂着工作区 —— 点卡片才进工具
      pane: !!q('.tool-pane'),
      cardCount: cards.length,
      slotCount: window.__qa('.tools-slot').length,
      // 集合比较：收藏置顶与 MRU 会改变卡片顺序，逐序断言会误报
      cardNames: cards.map((c) => (c.querySelector('.tools-card-name') || {}).textContent || '').sort(),
      secLabels: window.__qa('.tools-sec-name').map((e) => e.textContent.trim()),
      cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      cardW: cards.length ? Math.round(cards[0].getBoundingClientRect().width) : 0,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('顶栏是三个页签，且第三项是「工具」', shell.tabCount === 3 && shell.tabs[2] === '工具', JSON.stringify(shell.tabs));
  check('卡片墙结构到位（墙 / 网格 / 搜索，无旧左栏残留）', shell.wall && shell.cards && shell.search && !shell.navFoot, JSON.stringify({ wall: shell.wall, cards: shell.cards, search: shell.search, navFoot: shell.navFoot }));
  check('墙态不挂工作区（点卡片才进工具）', shell.pane === false, `pane=${shell.pane}`);
  check(
    `工具卡数 = registry 可见工具数（${TOOL_LIST.length}），预留卡 ${RESERVED_SLOTS} 张`,
    shell.cardCount === TOOL_LIST.length && shell.slotCount === RESERVED_SLOTS,
    `卡片 ${shell.cardCount} / 预留 ${shell.slotCount}，期望 ${TOOL_LIST.length} / ${RESERVED_SLOTS}`
  );
  check(
    '卡片名与 registry 逐项一致（集合，不比顺序）',
    JSON.stringify(shell.cardNames) === JSON.stringify(TOOL_LIST.map((t) => t.name).sort()),
    JSON.stringify(shell.cardNames)
  );
  check(
    `分区标签覆盖 registry 全部分组（${EXPECT_GROUP_LABELS.join(' / ')}）`,
    EXPECT_GROUP_LABELS.every((l) => shell.secLabels.includes(l)),
    JSON.stringify(shell.secLabels)
  );
  check('1280 宽下卡片网格 ≥4 列且卡宽 ≥200', shell.cols >= 4 && shell.cardW >= 200, `cols=${shell.cols} cardW=${shell.cardW}`);
  check('1280 宽下无横向溢出', shell.overflow <= 0, `overflow=${shell.overflow}`);

  /* ═══════════════════════════════════════════════════════════════════
     2. 外壳契约 —— 逐张点卡进入工作态，核对后返回墙
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\n── 外壳契约（逐工具） ──');
  const contract = await evalJs(`(async () => {
    const q = window.__q;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const read = () => {
      const pane = q('.tool-pane');
      const layoutEl = pane ? pane.querySelector('.tool-layout') : null;
      return {
        title: q('.tool-title') ? q('.tool-title').textContent.trim() : '',
        // 必须限定在页头里取 —— 工具本体也可能用 .tool-tag 画自己的分类芯片
        // （批量优先级就有一排 @分类 / +项目），不限定就会把它们算进页头标签。
        risks: window.__qa('.tool-head .tool-risk').map((e) => e.textContent.trim()),
        layout: layoutEl ? ((layoutEl.className.match(/tool-layout-([a-z]+)/) || [])[1] || '') : '',
        crashed: !!q('.tool-crash'),
        crashMsg: q('.tool-crash-msg') ? q('.tool-crash-msg').textContent.trim().slice(0, 160) : '',
        crashWhere: q('.tool-crash-where') ? q('.tool-crash-where').textContent.trim().slice(0, 200) : '',
        loading: !!q('.tool-loading'),
        // 工具本体渲染出东西了没有（四种版式各自的第一屏构件）
        rendered: !!(pane && pane.querySelector('.tool-sec, .tool-empty, .tool-instant-form, .tool-metric, .tool-field')),
        // 类名中性化（rti-* → tool-*）之后不该再有旧前缀残留
        legacy: pane ? pane.querySelectorAll('[class*="rti-"]').length : 0,
        // 进工作态后墙应当卸载（两态互斥）
        wallGone: !q('.tools-wall'),
      };
    };
    const waitTool = async (name) => {
      for (let i = 0; i < 80; i += 1) {
        const r = read();
        if (!r.loading && r.layout && r.title === name && r.wallGone) return r;
        await sleep(80);
      }
      return read();
    };
    const waitWall = async () => {
      for (let i = 0; i < 80; i += 1) {
        if (q('.tools-wall') && !q('.tool-title')) return true;
        await sleep(80);
      }
      return false;
    };
    const out = {};
    // 墙在「进工具 / 回墙」之间会整体卸载重挂载 —— 每轮都必须重新取卡片节点，
    // 循环外捕获的数组在第二轮起全是 detached node，点了不会有反应。
    const names = Array.from(window.__qa('.tools-card .tools-card-name')).map((e) => e.textContent.trim());
    for (const name of names) {
      await waitWall();
      const card = window.__qa('.tools-card').find(
        (c) => (c.querySelector('.tools-card-name') || {}).textContent.trim() === name
      );
      card.click();
      const r = await waitTool(name);
      out[name] = { ...r, backOk: false };
      const back = q('.tool-back');
      if (back) back.click();
      out[name].backOk = await waitWall();
    }
    return out;
  })()`, 120000);

  for (const tool of TOOL_LIST) {
    const got = contract[tool.name] || {};
    const want = {
      title: tool.name,
      risks: riskBadges(tool).map((b) => b.label),
      layout: tool.layout,
      crashed: false,
      rendered: true,
      legacy: 0,
      wallGone: true,
      backOk: true,
    };
    const bad = Object.keys(want).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
    check(
      `[${tool.id}] 页头 / 徽标 / 版式 / 不崩 / 有内容 / 无旧类名 / 进得出`,
      bad.length === 0,
      [bad.map((k) => `${k}: 得到 ${JSON.stringify(got[k])} 期望 ${JSON.stringify(want[k])}`).join('; '), got.crashMsg, got.crashWhere]
        .filter(Boolean)
        .join('  ||  ')
    );
  }

  /* ── 2b. 墙态交互：Esc 返回、搜索过滤、收藏置顶 ─────────────────────── */
  console.log('\n── 墙态交互 ──');
  const esc = await evalJs(`(async () => {
    const q = window.__q;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const cardOf = (name) =>
      window.__qa('.tools-card').find((c) => (c.querySelector('.tools-card-name') || {}).textContent.trim() === name);
    // 批量优先级的工作态第一屏就有关键字输入框（.tool-input），拿它验表单豁免
    cardOf('批量优先级').click();
    await sleep(500);
    const inTool = !!q('.tool-title');
    // 表单聚焦时 Esc 不拦 —— 在输入框上派发（会冒泡到 window），
    // e.target 是输入框本身，外壳据此放行
    const input = q('.tool-pane .tool-input');
    let stayedInForm = null;
    if (input) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(150);
      stayedInForm = !!q('.tool-title');
    }
    // 非表单焦点：在页头上派发，应当返回墙
    q('.tool-head').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
    return { inTool, stayedInForm, backToWall: !!q('.tools-wall') && !q('.tool-title') };
  })()`);
  check('Esc 从工作态返回卡片墙', esc.inTool === true && esc.backToWall === true, JSON.stringify(esc));
  check(
    '焦点在表单里时 Esc 不误返回（放行给工具自己处理）',
    esc.stayedInForm !== false,
    JSON.stringify(esc)
  );

  const search = await evalJs(`(async () => {
    const q = window.__q;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const input = q('.tools-wall-search input');
    const snap = () => ({
      cards: window.__qa('.tools-card').length,
      slots: window.__qa('.tools-slot').length,
      secNames: window.__qa('.tools-sec-name').map((e) => e.textContent.trim()),
      none: !!q('.tools-none'),
      names: window.__qa('.tools-card-name').map((e) => e.textContent.trim()),
    });
    window.__set(input, 'rti');
    await sleep(250);
    const hit = snap();
    window.__set(input, '周报');
    await sleep(250);
    const weekly = snap();
    window.__set(input, 'zzz-不存在的关键字');
    await sleep(250);
    const empty = snap();
    window.__set(input, '');
    await sleep(250);
    return { hit, weekly, empty, restored: snap().cards };
  })()`);
  check(
    '搜索「rti」只剩 1 张卡，且平铺（无分组头、无预留卡）',
    search.hit.cards === 1 && search.hit.slots === 0 && search.hit.secNames.length === 0,
    JSON.stringify(search.hit)
  );
  check(
    '搜索「周报」命中周报导出（名称/关键词都可命中）',
    search.weekly.cards === 1 && search.weekly.names[0] === '周报导出',
    JSON.stringify(search.weekly)
  );
  check('搜索无命中出空态', search.empty.cards === 0 && search.empty.none === true, JSON.stringify(search.empty));
  check(`清空搜索后恢复全部 ${TOOL_LIST.length} 张工具卡`, search.restored === TOOL_LIST.length, `restored=${search.restored}`);

  const fav = await evalJs(`(async () => {
    const q = window.__q;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const cardOf = (name) =>
      window.__qa('.tools-card').find((c) => (c.querySelector('.tools-card-name') || {}).textContent.trim() === name);
    cardOf('统计').querySelector('.tools-card-fav').click();
    await sleep(250);
    const on = {
      secs: window.__qa('.tools-sec-name').map((e) => e.textContent.trim()),
      onCount: window.__qa('.tools-card-fav.is-on').length,
      stillWall: !!q('.tools-wall') && !q('.tool-title'),
    };
    // 卡片会从原分组挪到收藏区（React 重挂载），必须重新取节点
    window.__qa('.tools-card-fav.is-on')[0].click();
    await sleep(250);
    return { on, offCount: window.__qa('.tools-card-fav.is-on').length, secsAfter: window.__qa('.tools-sec-name').map((e) => e.textContent.trim()) };
  })()`);
  check(
    '点星标收藏：墙顶出现「收藏」区，且不顺带打开工具',
    fav.on.secs[0] === '收藏' && fav.on.onCount === 1 && fav.on.stillWall === true,
    JSON.stringify(fav.on)
  );
  check('再点一次取消收藏，现场还原', fav.offCount === 0 && !fav.secsAfter.includes('收藏'), JSON.stringify(fav));

  // 有工具崩了就把原始堆栈打出来 —— 页面上只有一句 message，定位不了
  const crashes = cdp.console.filter((c) => c.text.includes('tool crash'));
  if (crashes.length) {
    console.log('\n── 崩溃原始堆栈（console.error） ──');
    for (const c of crashes) console.log('  ' + c.text.replace(/\s+/g, ' ').slice(0, 900));
  }

  /* ═══════════════════════════════════════════════════════════════════
     3. RTI 耐热指数页：数据一载入就实时出结果（没有「推算」按钮）
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\n── RTI 端到端数值 ──');
  await goto(`tools-${TOOL_LIST[0].id}`, 1280, 900);
  const p1 = await evalJs(`(() => {
    const q = window.__q;
    return {
      tabLabels: window.__qa('.tool-tab').map((b) => b.textContent.trim()),
      metrics: window.__qa('.tool-metric-val').map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      ciNotes: window.__qa('.tool-metric-note').map((e) => e.textContent.trim()),
      stats: window.__qa('.tool-stat').map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      status: window.__qa('.tool-stack .tool-hint').map((e) => e.textContent).find((t) => t.includes('实时算出')) || '',
      ink: window.__ink(),
      chartTitle: q('.tool-chart-title') ? q('.tool-chart-title').textContent.trim() : '',
      note: q('.tool-note') ? q('.tool-note').textContent.slice(0, 20) : '',
      // 录入区默认收起：没点「展开」就不该有录入表
      gridRows: window.__qa('.tool-grid tbody tr').length,
      // 「实时重算」的第一条硬约束：工具面板里不该再有「推算」按钮
      // （必须限定在 .tool-pane 内：左栏工具清单项也是 button，文案里就有"推算"二字）
      calcBtns: window.__qa('.tool-pane button').map((b) => b.textContent.trim()).filter((t) => t.includes('推算')),
    };
  })()`);
  check(
    '工具内只剩两个页签（页 1 已并进耐热指数页）',
    JSON.stringify(p1.tabLabels) === JSON.stringify(['耐热指数', '多材料对比']),
    JSON.stringify(p1.tabLabels)
  );
  check('界面上不再有「推算」按钮（结果实时重算）', p1.calcBtns.length === 0, JSON.stringify(p1.calcBtns));
  check('录入区默认收起（首屏先给答案，不是一张要滚很久的表）', p1.gridRows === 0, `gridRows=${p1.gridRows}`);
  check('RTI @ 20,000 h = 149.2 °C（基准，无需点按钮）', p1.metrics[0] && p1.metrics[0].includes('149.2'), JSON.stringify(p1.metrics));
  check('RTI @ 100,000 h = 130.5 °C（基准）', p1.metrics[1] && p1.metrics[1].includes('130.5'), JSON.stringify(p1.metrics));
  check(
    '两个 RTI 都给出 95% 置信区间（不是"不可得"）',
    p1.ciNotes.length === 2 && p1.ciNotes.every((t) => t.startsWith('95%CI ')) && p1.ciNotes[0].includes('148.9'),
    JSON.stringify(p1.ciNotes)
  );
  const statsText = p1.stats.join(' | ');
  check('活化能 Ea = 122.2 kJ/mol（基准）', statsText.includes('122.2 kJ/mol'), statsText);
  check('回归质量 R² = 0.99997、残差 s = 0.00447（基准）', statsText.includes('0.99997') && statsText.includes('0.00447'), statsText);
  check('自由度 df = 2（4 个温度点 − 2）', statsText.includes('df') && statsText.includes('2'), statsText);
  check('图 2（Arrhenius + 置信带）真的画出来了', p1.ink.w > 0 && p1.ink.ink > 300, JSON.stringify(p1.ink));
  check('结果区带图注与算法说明', p1.chartTitle.includes('图 2') && p1.note.includes('怎么算的'), `${p1.chartTitle} / ${p1.note}`);
  check('状态行说清"已按几个温度组实时算出"', p1.status.includes('已按 4 个温度组'), p1.status);
  if (WANT_SHOTS) await shot('tools-rti-1280.png', '.tool-answer-row');

  /* ── 4. 实时性：改一个数，结果当场跟着变（没有按钮、没有 stale） ─────── */
  const live = await evalJs(`(async () => {
    const q = window.__q;
    const first = () => window.__qa('.tool-metric-val')[0].textContent.replace(/\\s+/g, ' ').trim();
    const before = first();
    window.__btn(document, '展开').click();
    await new Promise((r) => setTimeout(r, 150));
    const hasName = !!q('#rti-name');
    const rows = window.__qa('.tool-grid tbody tr').length;
    window.__set(q('#rti-p0'), '90');
    await new Promise((r) => setTimeout(r, 200));
    const after = first();
    window.__set(q('#rti-p0'), '100');
    await new Promise((r) => setTimeout(r, 200));
    return { before, after, back: first(), hasName, rows };
  })()`);
  check('展开后录入表显示示例的 32 行、材料名可编辑', live.hasName === true && live.rows === 32, JSON.stringify(live));
  check('改 P₀ 后结果当场变（不需要点任何按钮）', live.before.includes('149.2') && live.after !== live.before, JSON.stringify(live));
  check('改回原值后结果也回到基准（双向实时，无残留旧结果）', live.back === live.before, JSON.stringify({ back: live.back, before: live.before }));

  /* ── 5. 各温度下的 t₅₀：点一行展开衰减曲线（原「寿命推算」页的归宿） ─── */
  const p2 = await evalJs(`(async () => {
    const sec = window.__qa('.tool-sec').find((s) => {
      const t = s.querySelector('.tool-sec-title');
      return t && t.textContent.includes('各温度下的 t₅₀');
    });
    const rows = sec
      ? Array.from(sec.querySelectorAll('.tool-expand tbody tr')).filter((tr) => !tr.classList.contains('tool-expand-row'))
      : [];
    const perT = rows.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()));
    rows[0].click();
    await new Promise((r) => setTimeout(r, 320));
    // 下钻的画布要单独量墨：__ink() 取的是页面里第一块 .tool-canvas（那是 Arrhenius 图）
    const cv = sec.querySelector('.tool-canvas');
    let ink = 0;
    if (cv && cv.width && cv.height) {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 16) if (d[i] > 20) ink += 1;
    }
    return {
      perT,
      opened: !!sec.querySelector('.tool-expand-row'),
      openHit: !!sec.querySelector('.tool-expand tbody tr.is-open'),
      ink,
      openTitle: sec.querySelector('.tool-chart-title') ? sec.querySelector('.tool-chart-title').textContent.trim() : '',
    };
  })()`);
  // 注意 fmtH 的口径：≥10,000 才加千分位，所以 1329 / 3860 是原样数字
  const byTemp = Object.fromEntries(p2.perT.map((r) => [r[0], r[1]]));
  const wantPerT = { 185: '1329', 170: '3860', 155: '12,518', 140: '43,499' };
  check(
    '4 个温度各自算出 t₅₀（基准：185→1329 / 170→3860 / 155→12,518 / 140→43,499）',
    p2.perT.length === 4
      && p2.perT.every((r) => r[2].includes('内插'))
      && Object.keys(wantPerT).every((T) => (byTemp[T] || '').startsWith(wantPerT[T])),
    JSON.stringify(p2.perT.map((r) => [r[0], r[1]]))
  );
  check('点一行即展开该温度的衰减曲线（原页 1 成为下钻视图）', p2.opened === true && p2.openHit === true, JSON.stringify(p2));
  check('下钻的衰减曲线真画出来了（画布有墨）', p2.ink > 300, `ink=${p2.ink}`);
  check('衰减曲线带图注且标明温度', p2.openTitle.includes('图 1') && p2.openTitle.includes('185'), p2.openTitle);
  if (WANT_SHOTS) await shot('tools-rti-evidence-1280.png', '.tool-expand');

  /* ── 6. 跨页：耐热指数页的结果一键送进对比页并即刻成图 ─────────────── */
  // 对比页出厂自带三材料示例，所以先清空 —— 否则"送过来 1 种"会被当成"追加了 1 种"，
  // 断言就证明不了这条链路。
  const p3 = await evalJs(`(async () => {
    const q = window.__q;
    window.__qa('.tool-tab')[1].click();
    await new Promise((r) => setTimeout(r, 250));
    window.__btn(document, '清空').click();
    await new Promise((r) => setTimeout(r, 250));
    const emptied = window.__qa('.tool-group').length;

    window.__qa('.tool-tab')[0].click();
    await new Promise((r) => setTimeout(r, 250));
    window.__btn(document, '加入多材料对比').click();
    await new Promise((r) => setTimeout(r, 500));

    return {
      emptied,
      paneOn: window.__qa('.tool-tab')[1].classList.contains('is-on'),
      mats: window.__qa('.tool-group').length,
      legend: window.__qa('.tool-legend-item').map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      ink: window.__ink(),
      toast: q('.tool-toast') ? q('.tool-toast').textContent.trim() : '',
      chartTitle: q('.tool-chart-title') ? q('.tool-chart-title').textContent.trim() : '',
    };
  })()`);
  check('对比页先被清空（前置条件：0 种材料）', p3.emptied === 0, `emptied=${p3.emptied}`);
  check(
    '「加入多材料对比」自动切到对比页并即刻成图（无需点「画对比图」）',
    p3.paneOn === true && p3.ink.w > 0 && p3.ink.ink > 300,
    JSON.stringify({ paneOn: p3.paneOn, ink: p3.ink })
  );
  check('对比页出现 1 种材料（来自耐热指数页的各温度 t₅₀）', p3.mats === 1, `mats=${p3.mats}`);
  check(
    '图例显示材料名与该材料拟合的 R²',
    p3.legend.length === 1 && p3.legend[0].includes('示例材料') && p3.legend[0].includes('R²='),
    JSON.stringify(p3.legend)
  );
  check('跨页操作给出明确回执（toast 说清加了几点）', p3.toast.includes('4 个温度点'), p3.toast);
  check('图注为「图 3」', p3.chartTitle.includes('图 3'), p3.chartTitle);

  // 换回三材料示例，验证图例按材料区分（颜色 + 形状双编码）
  const p3demo = await evalJs(`(async () => {
    window.__btn(document, '填入示例').click();
    await new Promise((r) => setTimeout(r, 350)); // 实时成图，不必再点「画对比图」
    const items = window.__qa('.tool-legend-item');
    return {
      legend: items.map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      swatches: items.map((e) => getComputedStyle(e.querySelector('.tool-legend-swatch')).backgroundColor),
      glyphs: items.map((e) => e.querySelector('.tool-legend-glyph').textContent.trim()),
      ink: window.__ink(),
    };
  })()`);
  check(
    '三材料示例：图例 3 条且各自 R² 与基准一致（0.9884 / 0.9901 / 0.9959）',
    p3demo.legend.length === 3
      && p3demo.legend.some((t) => t.includes('0.9884'))
      && p3demo.legend.some((t) => t.includes('0.9901'))
      && p3demo.legend.some((t) => t.includes('0.9959')),
    JSON.stringify(p3demo.legend)
  );
  check(
    '材料用「颜色 + 形状」双编码区分（不只是颜色）',
    new Set(p3demo.swatches).size === 3 && new Set(p3demo.glyphs).size === 3,
    `${JSON.stringify(p3demo.glyphs)} ${JSON.stringify(p3demo.swatches)}`
  );
  check('图 3 三材料曲线真的画出来了', p3demo.ink.ink > 400, JSON.stringify(p3demo.ink));
  if (WANT_SHOTS) await shot('tools-cmp-1280.png', '.tool-chart');

  /* ── 7. 自动保存 → 刷新后原样回来（数据不会一刷新就没了） ───────────── */
  const MARK = 'QA-恢复验证-' + Date.now();
  const saved = await evalJs(`(async () => {
    const q = window.__q;
    window.__qa('.tool-tab')[0].click();          // 回到耐热指数页（默认页，便于刷新后核对）
    await new Promise((r) => setTimeout(r, 200));
    if (!q('#rti-name')) { window.__btn(document, '展开').click(); await new Promise((r) => setTimeout(r, 150)); }
    window.__set(q('#rti-name'), ${JSON.stringify(MARK)});
    await new Promise((r) => setTimeout(r, 800));  // 自动保存 debounce 400ms
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const s = raw ? JSON.parse(raw) : null;
    return {
      has: !!raw,
      v: s ? s.v : null,
      name: s && s.rti ? s.rti.name : null,
      p0Type: s && s.rti ? typeof s.rti.p0 : null,
      // 每一格的 T / t / v 都必须是数字或 null，不能混进界面上的字符串
      rows: s && s.rti && Array.isArray(s.rti.rows) ? s.rti.rows.map((r) => [typeof r.T, typeof r.t, typeof r.v]) : [],
      isFlat: !!(s && s.rti && Array.isArray(s.rti.rows) && !s.rti.temps && !s.life),
      saveLabel: q('.tool-save') ? q('.tool-save').textContent.trim() : '',
    };
  })()`);
  check(
    '改动后自动落盘到 localStorage（键 todolist.tool.rti.v1，仍是 v1 扁平行结构）',
    saved.has && saved.v === 1 && saved.name === MARK && saved.isFlat === true && saved.rows.length === 32,
    JSON.stringify({ has: saved.has, v: saved.v, name: saved.name, flat: saved.isFlat, rows: saved.rows.length })
  );
  check(
    '落盘的是数字而不是界面上的字符串（P₀ 与每一格 T/t/v）',
    saved.p0Type === 'number' && saved.rows.every((r) => r.every((t) => t === 'number')),
    `p0=${saved.p0Type} rows[0..2]=${JSON.stringify(saved.rows.slice(0, 3))}`
  );
  check('界面显示自动保存时间戳', saved.saveLabel.includes('已自动保存'), saved.saveLabel);

  await goto(`tools-${TOOL_LIST[0].id}`, 1280, 900);
  const restored = await evalJs(`(async () => {
    const q = window.__q;
    window.__btn(document, '展开').click();
    await new Promise((r) => setTimeout(r, 150));
    return {
      name: q('#rti-name') ? q('#rti-name').value : null,
      rows: window.__qa('.tool-grid tbody tr').length,
      paneOn: window.__qa('.tool-tab')[0].classList.contains('is-on'),
      hint: window.__qa('.tool-hint').map((e) => e.textContent).join(' | '),
      metric: window.__qa('.tool-metric-val').length ? window.__qa('.tool-metric-val')[0].textContent : '',
    };
  })()`);
  check('刷新后数据原样恢复（不是退回示例）', restored.name === MARK && restored.rows === 32, `${restored.name} / ${restored.rows} 行`);
  check('刷新后仍停在耐热指数页（页签状态有自己的默认值）', restored.paneOn === true);
  check('恢复后常驻提示说清数据来自本机存档', restored.hint.includes('已从本机存档恢复'), restored.hint);
  check('恢复的数据不必重新推算 —— 结果当场就有', restored.metric.includes('149.2'), restored.metric);

  /* ── 8. 清空 / 示例：清干净，也能再填回来 ──────────────────────────── */
  const cleared = await evalJs(`(async () => {
    const q = window.__q;
    window.__btn(document, '清空').click();
    await new Promise((r) => setTimeout(r, 250));
    const afterClear = {
      name: q('#rti-name').value,
      rows: window.__qa('.tool-grid tbody tr').length,
      noResult: !q('.tool-metric'),
      emptyText: q('.tool-empty') ? q('.tool-empty').textContent.replace(/\\s+/g, ' ').trim() : '',
      warn: window.__qa('.tool-hint.is-warn').map((e) => e.textContent).join(' | '),
    };
    window.__btn(document, '填入示例').click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      afterClear,
      nameBack: q('#rti-name').value,
      rowsBack: window.__qa('.tool-grid tbody tr').length,
    };
  })()`);
  check(
    '「清空」把材料名与数据行都清掉、结果一并撤下',
    cleared.afterClear.name === '' && cleared.afterClear.rows === 3 && cleared.afterClear.noResult === true
      && cleared.afterClear.emptyText.includes('还没有结果'),
    JSON.stringify(cleared.afterClear)
  );
  check('空白态不装懂：明确说清还差几个温度点', cleared.afterClear.warn.includes('至少需要 2 个'), cleared.afterClear.warn);
  check('清空后「填入示例」能重新填回完整示例（32 行）', cleared.nameBack === '示例材料' && cleared.rowsBack === 32, `${cleared.nameBack} / ${cleared.rowsBack} 行`);

  /* ── 8b. 录入表里直接粘贴一块（Excel 区块）→ 整块铺开并即时分组 ───────── */
  const pasted = await evalJs(`(async () => {
    const q = window.__q;
    window.__btn(document, '清空').click();
    await new Promise((r) => setTimeout(r, 200));
    const blank = window.__qa('.tool-grid tbody tr').length;
    const cell = q('.tool-grid tbody tr td:nth-child(2) input'); // 第 1 行的"老化温度"格
    const dt = new DataTransfer();
    dt.setData('text', '155\\t100\\t95\\n155\\t200\\t88\\n130\\t50\\t97\\n130\\t500\\t82');
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
    const rows = window.__qa('.tool-grid tbody tr').slice(0, 4).map((tr) =>
      Array.from(tr.querySelectorAll('input')).map((el) => el.value));
    const status = window.__qa('.tool-hint').map((e) => e.textContent).find((t) => t.includes('实时算出')) || '';
    window.__btn(document, '填入示例').click(); // 还原示例，后面的章节继续用
    await new Promise((r) => setTimeout(r, 250));
    return { blank, rows, status, rowsBack: window.__qa('.tool-grid tbody tr').length };
  })()`);
  check('空表起步，一块四行数据整块铺进前 4 行', pasted.blank === 3 && JSON.stringify(pasted.rows) === JSON.stringify([['155', '100', '95'], ['155', '200', '88'], ['130', '50', '97'], ['130', '500', '82']]), JSON.stringify(pasted.rows));
  check('粘贴后即时重算：温度组按 T 自动分好（155 / 130 两组）', pasted.status.includes('已按 2 个温度组'), pasted.status);
  check('还原示例后回到 32 行', pasted.rowsBack === 32, `rows=${pasted.rowsBack}`);

  /* ── 9. 桌面几何：卡片在网格单元里占满（整卡可点） ───────────────────── */
  await goto('tools', 1280, 900);
  const geo = await evalJs(`(() => {
    const q = window.__q;
    const grid = q('.tools-cards');
    const card = q('.tools-card');
    const cs = getComputedStyle(grid);
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
    const gap = parseFloat(cs.columnGap) || 0;
    // 每列宽度 = (容器宽 - 列间距×(列数-1)) / 列数；卡片要正好占满这一列
    const cellW = (grid.clientWidth - gap * (cols - 1)) / cols;
    return {
      cols,
      cardW: Math.round(card.getBoundingClientRect().width),
      cellW: Math.round(cellW),
      fills: Math.abs(card.getBoundingClientRect().width - cellW) <= 2,
    };
  })()`);
  check('卡片占满所在网格单元（整卡可点，无缩水）', geo.fills === true, JSON.stringify(geo));

  /* ── 10. 暗色：画布必须按暗色令牌重画，不是浅底硬贴 ─────────────────── */
  await goto(`tools-${TOOL_LIST[0].id}`, 1280, 900, true);
  const darkRes = await evalJs(`(() => {
    const cv = window.__q('.tool-canvas');
    return {
      metric: window.__qa('.tool-metric-val').length ? window.__qa('.tool-metric-val')[0].textContent : '',
      ink: window.__ink(),
      // 画布底色跟随 --surface（暗色下必须变深）
      surface: getComputedStyle(cv).backgroundColor,
      bodyVar: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('暗色下数值不受影响（同一套算法与数据，结果仍实时算出）', darkRes.metric.includes('149.2'), darkRes.metric);
  check('暗色下画布重画成功（不是一片空白）', darkRes.ink.ink > 300, JSON.stringify(darkRes.ink));
  // 期望值从 --surface 变量现算（UI 重定调后不再写死旧值 rgb(42,42,42)）
  const bodyRgb = (() => {
    const h = darkRes.bodyVar.replace('#', '');
    return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
  })();
  check('画布底色跟随 --surface 令牌（暗色下变深）', darkRes.surface !== 'rgb(255, 255, 255)' && darkRes.surface === bodyRgb, `${darkRes.surface} / ${darkRes.bodyVar}`);
  check('暗色 1280 宽下无横向溢出', darkRes.overflow <= 0, `overflow=${darkRes.overflow}`);
  if (WANT_SHOTS) await shot('tools-dark-1280.png');

  /* ── 11. 窄屏：卡片单列大卡，无横向溢出 ─────────────────────────────── */
  await goto('tools', 390, 844);
  const narrow = await evalJs(`(() => {
    const q = window.__q;
    const cards = window.__qa('.tools-card');
    const first = cards[0];
    const grid = q('.tools-cards');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      cardCount: cards.length,
      slotCount: window.__qa('.tools-slot').length,
      itemsVisible: cards.every((b) => b.getBoundingClientRect().width > 0),
      firstW: first ? Math.round(first.getBoundingClientRect().width) : 0,
      wallW: q('.tools-wall') ? Math.round(q('.tools-wall').clientWidth) : 0,
      searchW: q('.tools-wall-search') ? Math.round(q('.tools-wall-search').getBoundingClientRect().width) : 0,
      pane: !!q('.tool-pane'),
    };
  })()`);
  check('390 宽下无横向溢出', narrow.overflow <= 0, `overflow=${narrow.overflow}`);
  check('390 宽下卡片单列', narrow.cols === 1, `cols=${narrow.cols}`);
  check(
    `390 宽下全部 ${TOOL_LIST.length} 张工具卡 + ${RESERVED_SLOTS} 张预留卡都还在`,
    narrow.itemsVisible === true && narrow.cardCount === TOOL_LIST.length && narrow.slotCount === RESERVED_SLOTS,
    `工具卡 ${narrow.cardCount} / 预留 ${narrow.slotCount}，期望 ${TOOL_LIST.length} / ${RESERVED_SLOTS}`
  );
  check('390 宽下卡片占满墙宽（单列大卡）', narrow.firstW >= narrow.wallW - 30, `card=${narrow.firstW} wall=${narrow.wallW}`);
  check('390 宽下搜索框全宽', narrow.searchW >= narrow.wallW - 30, `search=${narrow.searchW} wall=${narrow.wallW}`);
  check('390 宽下墙态仍不挂工作区', narrow.pane === false, `pane=${narrow.pane}`);
  if (WANT_SHOTS) await shot('tools-390.png');

  /* ── 12. 老页面没被这次改动带坏（对话 / 列表仍正常） ───────────────── */
  await goto('chat', 1280, 820);
  const chatOk = await evalJs(`(() => ({
    panel: !!window.__q('.chat-panel'),
    toolsLeak: !!window.__q('.tools') || !!window.__q('.rti'),
  }))()`);
  check('对话页仍正常渲染，且没有工具集的残留 DOM', chatOk.panel === true && chatOk.toolsLeak === false, JSON.stringify(chatOk));

  await goto('list', 1280, 820);
  const listOk = await evalJs(`(() => ({
    rows: window.__qa('.task-row').length,
    main: !!window.__q('.main'),
    toolsLeak: !!window.__q('.tools') || !!window.__q('.rti'),
  }))()`);
  check(
    '列表页仍正常渲染，且没有工具集的残留 DOM',
    listOk.main === true && listOk.rows > 0 && listOk.toolsLeak === false,
    JSON.stringify(listOk)
  );

  await evalJs(`(() => { try { localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); localStorage.removeItem('todolist.tools.meta.v1'); } catch (e) {} return true; })()`);
  cdp.ws.close();
  proc.kill();
  await sleep(200);
  try {
    rmSync(PROFILE, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
  } catch {
    // profile 目录被占用时留给系统清理
  }
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n结果：${results.length - failed.length}/${results.length} 通过${failed.length ? '  ✗ 存在失败项' : '  全部通过'}`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch((err) => {
    console.error('✗ ' + (err && err.message ? err.message : err));
    process.exit(1);
  });
