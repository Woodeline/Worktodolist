#!/usr/bin/env node
// 工具集 UI 级回归 —— 真实浏览器里点真按钮，核对真实数值。
//
// 分两层，职责不同：
//
//   ① 外壳契约（通用，认 registry 不认具体工具）
//      遍历 registry 里每个可见工具，逐个激活，核对页头文案 / 标签 / 风险徽标 /
//      版式类名 / 是否掉进崩溃页 / 本体有没有渲染出东西 / 有没有旧类名残留。
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
//   ② 外壳不认识任何具体工具 —— 清单由 registry 驱动，加工具不改外壳。
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

// 门禁的期望值直接来自 registry —— 不另抄一份清单，否则两边迟早漂移。
const { visibleTools, findTool, riskBadges, canWrite } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'components', 'tools', 'registry.js')).href
);
const TOOL_LIST = visibleTools();

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
    // 懒加载的工具组件要等它挂上（Suspense 的 fallback 会先出现）
    for (let i = 0; i < 40; i += 1) {
      const ok = await evalJs(`!!document.querySelector('.tool-layout') && !document.querySelector('.tool-loading')`, 8000);
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
     1. 外壳结构：三个页签 + 清单驱动的左栏 + 右侧工作区
     ═══════════════════════════════════════════════════════════════════ */
  await goto('tools', 1280, 900);
  const shell = await evalJs(`(() => {
    const q = window.__q;
    const tabs = window.__qa('.tabs-group .tab').map((b) => b.textContent.trim());
    const items = window.__qa('.tools-item');
    return {
      tabs,
      tabCount: tabs.length,
      tools: !!q('.tools'),
      nav: !!q('.tools-nav'),
      list: !!q('.tools-list'),
      pane: !!q('.tool-pane'),
      itemCount: items.length,
      itemNames: items.map((b) => (b.querySelector('.tools-item-name') || {}).textContent || ''),
      onCount: window.__qa('.tools-item.is-on').length,
      groupHeads: window.__qa('.tools-group-head .tools-group-label').map((e) => e.textContent.trim()),
      search: !!q('.tools-search-input'),
      navFoot: !!q('.tools-nav-foot'),
      navFootText: q('.tools-nav-foot') ? q('.tools-nav-foot').textContent : '',
      head: !!q('.tool-head'),
      // 左栏与工作区是并排的（而不是上下堆叠）
      sideBySide: (() => {
        const n = q('.tools-nav'); const p = q('.tool-pane');
        return n && p ? p.getBoundingClientRect().left >= n.getBoundingClientRect().right - 2 : false;
      })(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('顶栏是三个页签，且第三项是「工具」', shell.tabCount === 3 && shell.tabs[2] === '工具', JSON.stringify(shell.tabs));
  check('工具集三段式结构到位（清单 / 工作区 / 页头）', shell.tools && shell.nav && shell.list && shell.pane && shell.head);
  check(
    `左栏工具数 = registry 可见工具数（${TOOL_LIST.length}）`,
    shell.itemCount === TOOL_LIST.length,
    `DOM ${shell.itemCount} vs registry ${TOOL_LIST.length}`
  );
  check(
    '左栏工具名与 registry 逐项一致，且默认选中恰好一个',
    JSON.stringify(shell.itemNames) === JSON.stringify(TOOL_LIST.map((t) => t.name)) && shell.onCount === 1,
    JSON.stringify(shell.itemNames)
  );
  // 分组折叠头：registry 的 GROUPS 收紧到 2 组（工程计算 / 待办数据）后，
  // 下限随之从 3 改为 2。收藏组存在时会更多，所以用 ≥ 而不是等号。
  check('左栏有搜索框与分组折叠头（条目 14）', shell.search === true && shell.groupHeads.length >= 2, JSON.stringify(shell.groupHeads));
  check('左栏底部不再有开发者说明（界面以清晰为先，已移除）', shell.navFoot === false, shell.navFootText);
  check('左栏与工作区左右并排', shell.sideBySide === true);
  check('1280 宽下无横向溢出', shell.overflow <= 0, `overflow=${shell.overflow}`);

  /* ═══════════════════════════════════════════════════════════════════
     2. 外壳契约 —— 逐个工具激活并核对
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\n── 外壳契约（逐工具） ──');
  const contract = await evalJs(`(async () => {
    const q = window.__q;
    const items = window.__qa('.tools-item');
    const read = () => {
      const pane = q('.tool-pane');
      const layoutEl = pane ? pane.querySelector('.tool-layout') : null;
      return {
        title: q('.tool-title') ? q('.tool-title').textContent.trim() : '',
        sub: q('.tool-head-sub') ? q('.tool-head-sub').textContent.trim() : '',
        // 必须限定在页头里取 —— 工具本体也可能用 .tool-tag 画自己的分类芯片
        // （批量优先级就有一排 @分类 / +项目），不限定就会把它们算进页头标签。
        tags: window.__qa('.tool-head .tool-tag').map((e) => e.textContent.trim()),
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
        onCount: window.__qa('.tools-item.is-on').length,
      };
    };
    const out = {};
    for (const item of items) {
      const name = (item.querySelector('.tools-item-name') || {}).textContent.trim();
      item.click();
      for (let i = 0; i < 80; i += 1) {
        const r = read();
        // 等到工作区真的换成了刚点的那一个再读 —— 否则会读到上一个工具残留的 DOM
        if (!r.loading && r.layout && r.title === name) break;
        await new Promise((res) => setTimeout(res, 80));
      }
      await new Promise((res) => setTimeout(res, 60));
      out[name] = read();
    }
    return out;
  })()`, 120000);

  for (const tool of TOOL_LIST) {
    const got = contract[tool.name] || {};
    const want = {
      title: tool.name,
      // 页头已精简：说明段与分类标签不再平铺（说明改挂到标题的 title 提示上）
      sub: '',
      tags: [],
      risks: riskBadges(tool).map((b) => b.label),
      layout: tool.layout,
      crashed: false,
      rendered: true,
      legacy: 0,
    };
    const bad = Object.keys(want).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
    check(
      `[${tool.id}] 页头精简 / 徽标 / 版式 / 不崩 / 有内容 / 无旧类名`,
      bad.length === 0,
      [bad.map((k) => `${k}: 得到 ${JSON.stringify(got[k])} 期望 ${JSON.stringify(want[k])}`).join('; '), got.crashMsg, got.crashWhere]
        .filter(Boolean)
        .join('  ||  ')
    );
  }
  check(
    '激活工具后选中态始终唯一',
    Object.values(contract).every((r) => r.onCount === 1),
    JSON.stringify(Object.fromEntries(Object.entries(contract).map(([k, v]) => [k, v.onCount])))
  );

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

  /* ── 9. 桌面窗口感：顶栏页签与工具清单的几何关系 ────────────────────── */
  const geo = await evalJs(`(() => {
    const nav = window.__q('.tools-nav');
    const list = window.__q('.tools-list');
    const item = window.__q('.tools-item');
    const cs = getComputedStyle(list);
    // 清单项要占满左栏的内容宽度（整行可点），而不是缩成内容宽度的小胶囊
    const content = list.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return {
      navW: Math.round(nav.getBoundingClientRect().width),
      itemW: Math.round(item.getBoundingClientRect().width),
      contentW: Math.round(content),
      itemFills: item.getBoundingClientRect().width >= content - 2,
    };
  })()`);
  check('左栏清单项整行可点（桌面侧栏行为）', geo.itemFills === true, JSON.stringify(geo));

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

  /* ── 11. 窄屏：左栏转横向段控条，工作区不横向溢出 ───────────────────── */
  await goto('tools', 390, 844);
  const narrow = await evalJs(`(() => {
    const q = window.__q;
    const nav = q('.tools-nav');
    const pane = q('.tool-pane');
    const list = q('.tools-list');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      // 横向条必须在工作区上方（而不是继续占着左边一列）
      navAbove: nav.getBoundingClientRect().bottom <= pane.getBoundingClientRect().top + 2,
      navHeight: Math.round(nav.getBoundingClientRect().height),
      // 清单从竖列改成横排。看 flex 方向本身，而不是"能不能滚"
      listRow: getComputedStyle(list).flexDirection === 'row',
      navHeadHidden: getComputedStyle(q('.tools-nav-head')).display === 'none',
      descHidden: getComputedStyle(q('.tools-item-desc')).display === 'none',
      itemsVisible: window.__qa('.tools-item').every((b) => b.getBoundingClientRect().width > 0),
      itemCount: window.__qa('.tools-item').length,
      tabsVisible: window.__qa('.tool-tab').every((b) => b.getBoundingClientRect().width > 0),
      pane: !!pane,
    };
  })()`);
  check('390 宽下无横向溢出', narrow.overflow <= 0, `overflow=${narrow.overflow}`);
  check(
    '390 宽下左栏转为横向段控条（在工具上方，高度是一条而非一列）',
    narrow.navAbove === true && narrow.listRow === true && narrow.navHeight < 80,
    JSON.stringify(narrow)
  );
  check(
    '390 宽下收起说明性文案（段控条 / 描述），保留工具本体',
    narrow.navHeadHidden === true && narrow.descHidden === true && narrow.pane === true
  );
  check(
    `390 宽下全部 ${TOOL_LIST.length} 个工具都还有入口（不折叠、不分组）`,
    narrow.itemsVisible === true && narrow.itemCount === TOOL_LIST.length,
    `可见 ${narrow.itemCount} / 期望 ${TOOL_LIST.length}`
  );
  check('390 宽下工具内页签仍可点', narrow.tabsVisible === true);
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
