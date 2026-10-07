#!/usr/bin/env node
// 工具集 UI 级回归 —— 真实浏览器里点真按钮，核对真实数值。
//
// 为什么单测不够：`calc.test.js` 能证明 lifeCalc() 算得对，但证明不了
// 「点「推算 t₅₀」→ 页面上出现 12,518 h」这条链路 —— 按钮没绑上、
// 结果 state 放错页、画布没重画，逻辑层全绿也照样能坏。
// 这里的断言值全部来自 lib/rti/demo.js 的数据集（有独立 Python 基准对拍），
// 所以它们是"端到端"的：从示例数据一路到屏幕上的文本。
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

const EDGE = process.env.EDGE || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const BASE = process.env.SG_BASE || 'http://localhost:15181';
const PORT = 9561;
const PROFILE = path.join(tmpdir(), 'todolist-qa-tools-profile');
const OUT = path.resolve(import.meta.dirname, '..', 'qa-artifacts');
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
    const cv = window.__q('.rti-canvas');
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
      const ok = await evalJs(`!!document.querySelector('.rti-bar')`, 8000);
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

  // ── 1. 外壳结构：三个页签 + 清单驱动的左栏 + 右侧工作区 ──────────────────
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
      navFoot: !!q('.tools-nav-foot'),
      navFootText: q('.tools-nav-foot') ? q('.tools-nav-foot').textContent : '',
      head: !!q('.tool-head'),
      title: q('.tool-title') ? q('.tool-title').textContent.trim() : '',
      tags: window.__qa('.tool-tag').map((e) => e.textContent.trim()),
      sub: q('.tool-head-sub') ? q('.tool-head-sub').textContent.slice(0, 40) : '',
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
  check('工具清单由 registry 驱动（当前 1 项，且默认选中）',
    shell.itemCount === 1 && shell.onCount === 1 && shell.itemNames[0].includes('RTI'), JSON.stringify(shell.itemNames));
  check('页头显示工具名与标签（RTI 耐热指数 / IEC 60216）',
    shell.title === 'RTI 耐热指数' && shell.tags.some((t) => t.includes('IEC 60216')), `${shell.title} ${shell.tags}`);
  check('清单底部写明"怎么加新工具"', shell.navFoot && shell.navFootText.includes('registry.js'), shell.navFootText);
  check('左栏与工作区左右并排', shell.sideBySide === true);
  check('1280 宽下无横向溢出', shell.overflow <= 0, `overflow=${shell.overflow}`);

  // ── 2. 页 1：示例数据 → 点「推算 t₅₀」→ 屏幕上出现基准值 ────────────────
  const p1 = await evalJs(`(async () => {
    const q = window.__q;
    const tabLabels = window.__qa('.rti-tab').map((b) => b.textContent.trim());
    const rows = window.__qa('.rti-table tbody tr').length;
    const nameShown = q('#rti-life-name').value;
    window.__btn(document, '推算 t₅₀').click();
    await new Promise((r) => setTimeout(r, 250));
    const hero = q('.rti-hero-val');
    return {
      tabLabels,
      rows,
      nameShown,
      hero: hero ? hero.textContent.replace(/\\s+/g, ' ').trim() : '',
      sub: q('.rti-hero-sub') ? q('.rti-hero-sub').textContent.replace(/\\s+/g, ' ').trim() : '',
      label: q('.rti-hero-label') ? q('.rti-hero-label').textContent.replace(/\\s+/g, ' ').trim() : '',
      ink: window.__ink(),
      chartTitle: q('.rti-chart-title') ? q('.rti-chart-title').textContent.trim() : '',
      note: q('.rti-note') ? q('.rti-note').textContent.slice(0, 20) : '',
      // 页 1 常态就有若干 .rti-hint（输入提示、行数统计），所以必须找那句特定的
      staleHint: window.__qa('.rti-stack .rti-hint').some((e) => e.textContent.includes('还是上一次推算的')),
    };
  })()`);
  check('工具内三个页面页签齐全', JSON.stringify(p1.tabLabels) === JSON.stringify(['寿命推算', 'RTI 耐热指数', '多材料对比']), JSON.stringify(p1.tabLabels));
  check('默认载入页 1 示例数据（8 行、材料名可见）', p1.rows === 8 && p1.nameShown === '示例材料 A', `rows=${p1.rows} name=${p1.nameShown}`);
  check('点「推算 t₅₀」后主数字为基准值 12,518 h', p1.hero.includes('12,518'), p1.hero);
  check('求法标注为「半对数内插」（不是外推）', p1.sub.includes('半对数内插'), p1.sub);
  check('结果说明带上材料名与老化温度 155 °C', p1.label.includes('示例材料 A') && p1.label.includes('155'), p1.label);
  check('图 1 真的画出来了（画布有墨）', p1.ink.w > 0 && p1.ink.ink > 300, JSON.stringify(p1.ink));
  check('结果区带图注与算法说明', p1.chartTitle.includes('图 1') && p1.note.includes('怎么算的'), `${p1.chartTitle} / ${p1.note}`);
  check('刚推算完不带"结果已过期"提示', p1.staleHint === false);
  if (WANT_SHOTS) await shot('tools-life-1280.png');

  // ── 3. 结果过期标记：改一个数字，结果必须自己承认落后了 ─────────────────
  const stale = await evalJs(`(async () => {
    window.__set(window.__q('#rti-life-p0'), '99.9');
    await new Promise((r) => setTimeout(r, 120));
    const hints = window.__qa('.rti-stack .rti-hint').map((e) => e.textContent).join(' | ');
    const heroStill = window.__q('.rti-hero-val').textContent.includes('12,518');
    window.__set(window.__q('#rti-life-p0'), '98.6');
    await new Promise((r) => setTimeout(r, 120));
    return { hints, heroStill };
  })()`);
  check('改动数据后结果被标记为过期（且不假装是新结果）',
    stale.hints.includes('还是上一次推算的') && stale.heroStill === true, stale.hints);

  // ── 4. 页 2：Arrhenius 回归 → RTI / 置信区间 / 活化能，逐项对基准 ────────
  const p2 = await evalJs(`(async () => {
    const q = window.__q;
    window.__qa('.rti-tab')[1].click();
    await new Promise((r) => setTimeout(r, 200));
    const groups = window.__qa('.rti-group').length;
    window.__btn(document, '推算 RTI').click();
    await new Promise((r) => setTimeout(r, 300));
    // 页 2 有两张表：上面是录入表（每个温度一张），下面是 t₅₀ 结果表。
    // 必须只取结果表，否则会把录入行也算进来。
    const sec = window.__qa('.rti-sec').find((s) => {
      const t = s.querySelector('.rti-sec-title');
      return t && t.textContent.includes('各温度下的 t₅₀');
    });
    const perT = sec
      ? Array.from(sec.querySelectorAll('.rti-table tbody tr')).map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()))
      : [];
    return {
      groups,
      metrics: window.__qa('.rti-metric-val').map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      metricLabels: window.__qa('.rti-metric-label').map((e) => e.textContent.trim()),
      ciNotes: window.__qa('.rti-metric-note').map((e) => e.textContent.trim()),
      stats: window.__qa('.rti-stat').map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      perT,
      ink: window.__ink(),
      err: q('.rti-errors') ? q('.rti-errors').textContent : '',
      warn: window.__qa('.rti-warns li').map((e) => e.textContent.trim()),
    };
  })()`);
  check('页 2 载入 4 个温度组示例', p2.groups === 4, `groups=${p2.groups}`);
  check('无报错（示例数据本就不该触发校验）', p2.err === '', p2.err);
  // 注意 fmtH 的口径：≥10,000 才加千分位，所以 1329 / 3860 是原样数字
  const byTemp = Object.fromEntries(p2.perT.map((r) => [r[0], r[1]]));
  const want = { 185: '1329 h', 170: '3860 h', 155: '12,518 h', 140: '43,499 h' };
  check('4 个温度各自算出 t₅₀（基准：185→1329 / 170→3860 / 155→12,518 / 140→43,499）',
    p2.perT.length === 4
      && p2.perT.every((r) => r[2].includes('内插'))
      && Object.keys(want).every((T) => (byTemp[T] || '').startsWith(want[T])),
    JSON.stringify(p2.perT.map((r) => [r[0], r[1]])));
  check('RTI @ 20,000 h = 149.2 °C（基准）', p2.metrics[0] && p2.metrics[0].includes('149.2'), JSON.stringify(p2.metrics));
  check('RTI @ 100,000 h = 130.5 °C（基准）', p2.metrics[1] && p2.metrics[1].includes('130.5'), JSON.stringify(p2.metrics));
  check('两个 RTI 都给出 95% 置信区间（不是"不可得"）',
    p2.ciNotes.length === 2 && p2.ciNotes.every((t) => t.startsWith('95%CI ')) && p2.ciNotes[0].includes('148.9'),
    JSON.stringify(p2.ciNotes));
  const statsText = p2.stats.join(' | ');
  check('活化能 Ea = 122.2 kJ/mol（基准）', statsText.includes('122.2 kJ/mol'), statsText);
  check('回归质量 R² = 0.99997、残差 s = 0.00447（基准）', statsText.includes('0.99997') && statsText.includes('0.00447'), statsText);
  check('自由度 df = 2（4 个温度点 − 2）', statsText.includes('df') && statsText.includes('2'), statsText);
  check('图 2（Arrhenius + 置信带）真的画出来了', p2.ink.w > 0 && p2.ink.ink > 300, JSON.stringify(p2.ink));
  check('n = 4 时不该出现"温度点不足"以外的告警误报',
    p2.warn.length === 0 || p2.warn.every((w) => !w.includes('无法')), JSON.stringify(p2.warn));
  if (WANT_SHOTS) await shot('tools-rti-1280.png', '.rti-chart');

  // ── 5. 跨页：页 2 的结果一键送进页 3 并出图 ──────────────────────────────
  // 页 3 出厂自带三材料示例，所以先清空 —— 否则"送过来 1 种"会被当成"追加了 1 种"，
  // 断言就证明不了这条链路。
  const p3 = await evalJs(`(async () => {
    const q = window.__q;
    window.__qa('.rti-tab')[2].click();
    await new Promise((r) => setTimeout(r, 250));
    window.__btn(document, '清空').click();
    await new Promise((r) => setTimeout(r, 250));
    const emptied = window.__qa('.rti-group').length;

    window.__qa('.rti-tab')[1].click();
    await new Promise((r) => setTimeout(r, 250));
    window.__btn(document, '加入多材料对比').click();
    await new Promise((r) => setTimeout(r, 600));

    const legend = window.__qa('.rti-legend-item').map((e) => e.textContent.replace(/\\s+/g, ' ').trim());
    return {
      emptied,
      paneOn: window.__qa('.rti-tab')[2].classList.contains('is-on'),
      mats: window.__qa('.rti-group').length,
      legend,
      ink: window.__ink(),
      toast: q('.tool-toast') ? q('.tool-toast').textContent.trim() : '',
      chartTitle: q('.rti-chart-title') ? q('.rti-chart-title').textContent.trim() : '',
    };
  })()`);
  check('页 3 先被清空（前置条件：0 种材料）', p3.emptied === 0, `emptied=${p3.emptied}`);
  check('「加入多材料对比」自动切到页 3 并画出图',
    p3.paneOn === true && p3.ink.w > 0 && p3.ink.ink > 300, JSON.stringify({ paneOn: p3.paneOn, ink: p3.ink }));
  check('页 3 出现 1 种材料、4 个温度点（来自页 2 的 perT）', p3.mats === 1, `mats=${p3.mats}`);
  check('图例显示材料名与该材料拟合的 R²',
    p3.legend.length === 1 && p3.legend[0].includes('示例材料') && p3.legend[0].includes('R²='), JSON.stringify(p3.legend));
  check('跨页操作给出明确回执（toast 说清加了几点）', p3.toast.includes('4 个温度点'), p3.toast);
  check('图注为「图 3」', p3.chartTitle.includes('图 3'), p3.chartTitle);

  // 换回三材料示例，验证图例按材料区分（颜色 + 形状双编码）
  const p3demo = await evalJs(`(async () => {
    window.__btn(document, '填入示例').click();
    await new Promise((r) => setTimeout(r, 120));
    window.__btn(document, '画对比图').click();
    await new Promise((r) => setTimeout(r, 350));
    const items = window.__qa('.rti-legend-item');
    return {
      legend: items.map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      swatches: items.map((e) => getComputedStyle(e.querySelector('.rti-legend-swatch')).backgroundColor),
      glyphs: items.map((e) => e.querySelector('.rti-legend-glyph').textContent.trim()),
      ink: window.__ink(),
    };
  })()`);
  check('三材料示例：图例 3 条且各自 R² 与基准一致（0.9884 / 0.9901 / 0.9959）',
    p3demo.legend.length === 3
      && p3demo.legend.some((t) => t.includes('0.9884'))
      && p3demo.legend.some((t) => t.includes('0.9901'))
      && p3demo.legend.some((t) => t.includes('0.9959')),
    JSON.stringify(p3demo.legend));
  check('材料用「颜色 + 形状」双编码区分（不只是颜色）',
    new Set(p3demo.swatches).size === 3 && new Set(p3demo.glyphs).size === 3,
    `${JSON.stringify(p3demo.glyphs)} ${JSON.stringify(p3demo.swatches)}`);
  check('图 3 三材料曲线真的画出来了', p3demo.ink.ink > 400, JSON.stringify(p3demo.ink));
  if (WANT_SHOTS) await shot('tools-cmp-1280.png', '.rti-chart');

  // ── 6. 自动保存 → 刷新后原样回来（数据不会一刷新就没了） ─────────────────
  const MARK = 'QA-恢复验证-' + Date.now();
  const saved = await evalJs(`(async () => {
    window.__qa('.rti-tab')[0].click();          // 回到页 1（默认页，便于刷新后核对）
    await new Promise((r) => setTimeout(r, 150));
    window.__set(window.__q('#rti-life-name'), ${JSON.stringify(MARK)});
    await new Promise((r) => setTimeout(r, 700));  // 自动保存 debounce 400ms
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const s = raw ? JSON.parse(raw) : null;
    return {
      has: !!raw,
      v: s ? s.v : null,
      name: s && s.life ? s.life.name : null,
      p0Type: s && s.life ? typeof s.life.p0 : null,
      // 数据点的值必须是数字或 null，不能混进界面上的字符串
      ptTypes: s && s.life ? s.life.pts.map((p) => typeof p.t) : [],
      tempTypes: s && s.rti && s.rti.temps.length ? s.rti.temps.map((g) => typeof g.T) : [],
      saveLabel: window.__q('.rti-save') ? window.__q('.rti-save').textContent.trim() : '',
    };
  })()`);
  check('改动后自动落盘到 localStorage（键 todolist.tool.rti.v1）',
    saved.has && saved.v === 1 && saved.name === MARK, JSON.stringify({ has: saved.has, v: saved.v, name: saved.name }));
  check('落盘的是数字而不是界面上的字符串（数据点 / P₀ / 各温度 T）',
    saved.p0Type === 'number'
      && saved.ptTypes.length === 8 && saved.ptTypes.every((t) => t === 'number')
      && saved.tempTypes.length === 4 && saved.tempTypes.every((t) => t === 'number'),
    `p0=${saved.p0Type} pts=${JSON.stringify(saved.ptTypes)} temps=${JSON.stringify(saved.tempTypes)}`);
  check('界面显示自动保存时间戳', saved.saveLabel.includes('已自动保存'), saved.saveLabel);

  await goto('tools', 1280, 900);
  const restored = await evalJs(`(() => ({
    name: window.__q('#rti-life-name').value,
    rows: window.__qa('.rti-table tbody tr').length,
    paneOn: window.__qa('.rti-tab')[0].classList.contains('is-on'),
    toast: window.__q('.tool-toast') ? window.__q('.tool-toast').textContent.trim() : '',
  }))()`);
  check('刷新后数据原样恢复（不是退回示例）', restored.name === MARK && restored.rows === 8, `${restored.name} / ${restored.rows} 行`);
  check('刷新后仍停在页 1（页签状态有自己的默认值）', restored.paneOn === true);
  check('恢复后明确提示"结果需重新推算"', restored.toast.includes('已恢复上次的数据'), restored.toast);

  // ── 7. 清空 / 示例：清干净，也能再填回来 ────────────────────────────────
  const cleared = await evalJs(`(async () => {
    window.__btn(document, '清空').click();
    await new Promise((r) => setTimeout(r, 200));
    const afterClear = {
      name: window.__q('#rti-life-name').value,
      rows: window.__qa('.rti-table tbody tr').length,
      heroGone: !window.__q('.rti-hero'),
    };
    window.__btn(document, '填入示例').click();
    await new Promise((r) => setTimeout(r, 200));
    return {
      afterClear,
      nameBack: window.__q('#rti-life-name').value,
      rowsBack: window.__qa('.rti-table tbody tr').length,
      usableHint: window.__qa('.rti-hint').map((e) => e.textContent).find((t) => t.includes('行有效')) || '',
    };
  })()`);
  check('「清空」把材料名与数据点都清掉、结果一并撤下',
    cleared.afterClear.name === '' && cleared.afterClear.rows === 1 && cleared.afterClear.heroGone === true,
    JSON.stringify(cleared.afterClear));
  check('清空后「填入示例」能重新填回完整示例',
    cleared.nameBack === '示例材料 A' && cleared.rowsBack === 8, `${cleared.nameBack} / ${cleared.rowsBack} 行`);
  check('页 1 明确告诉用户"几行有效"（不是默默忽略填错的行）',
    cleared.usableHint.includes('8 行有效'), cleared.usableHint);

  // ── 8. 桌面窗口感：顶栏页签与工具清单的几何关系 ──────────────────────────
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

  // ── 9. 暗色：画布必须按暗色令牌重画，不是浅底硬贴 ─────────────────────────
  await goto('tools', 1280, 900, true);
  const darkRes = await evalJs(`(async () => {
    window.__btn(document, '推算 t₅₀').click();
    await new Promise((r) => setTimeout(r, 300));
    const cv = window.__q('.rti-canvas');
    return {
      hero: window.__q('.rti-hero-val').textContent.includes('12,518'),
      ink: window.__ink(),
      // 画布底色跟随 --surface（暗色下必须变深）
      surface: getComputedStyle(cv).backgroundColor,
      bodyVar: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('暗色下数值不受影响（同一套算法与数据）', darkRes.hero === true);
  check('暗色下画布重画成功（不是一片空白）', darkRes.ink.ink > 300, JSON.stringify(darkRes.ink));
  check('画布底色跟随 --surface 令牌（暗色下变深）', darkRes.surface !== 'rgb(255, 255, 255)' && darkRes.surface === 'rgb(42, 42, 42)', `${darkRes.surface} / ${darkRes.bodyVar}`);
  check('暗色 1280 宽下无横向溢出', darkRes.overflow <= 0, `overflow=${darkRes.overflow}`);
  if (WANT_SHOTS) await shot('tools-dark-1280.png');

  // ── 10. 窄屏：左栏转横向段控条，工作区不横向溢出 ────────────────────────
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
      // 清单从竖列改成横排。只有 1 个工具时不会真溢出，所以不能拿"能滚"当判据，
      // 要看 flex 方向本身
      listRow: getComputedStyle(list).flexDirection === 'row',
      navHeadHidden: getComputedStyle(q('.tools-nav-head')).display === 'none',
      descHidden: getComputedStyle(q('.tools-item-desc')).display === 'none',
      tabsVisible: window.__qa('.rti-tab').every((b) => b.getBoundingClientRect().width > 0),
      pane: !!pane,
    };
  })()`);
  check('390 宽下无横向溢出', narrow.overflow <= 0, `overflow=${narrow.overflow}`);
  check('390 宽下左栏转为横向段控条（在工具上方，高度是一条而非一列）',
    narrow.navAbove === true && narrow.listRow === true && narrow.navHeight < 80, JSON.stringify(narrow));
  check('390 宽下收起说明性文案（段控条 / 描述 / 页脚），保留工具本体',
    narrow.navHeadHidden === true && narrow.descHidden === true && narrow.pane === true);
  check('390 宽下工具内页签仍可点', narrow.tabsVisible === true);
  if (WANT_SHOTS) await shot('tools-390.png');

  // ── 11. 老页面没被这次改动带坏（对话 / 列表仍正常） ──────────────────────
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
  check('列表页仍正常渲染，且没有工具集的残留 DOM',
    listOk.main === true && listOk.rows > 0 && listOk.toolsLeak === false, JSON.stringify(listOk));

  await evalJs(`(() => { try { localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); } catch (e) {} return true; })()`);
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
