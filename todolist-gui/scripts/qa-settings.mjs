#!/usr/bin/env node
// 设置页（快捷键速查）UI 级回归（独立浏览器 profile）。
//
// 为什么单测不够：单测能证明组件函数返回了 JSX，但证明不了「在真实浏览器里渲染出来
// 的页面结构正确、旧功能入口一个都不剩」这条链路 —— 类名写错、入口漏删，在逻辑层
// 全绿的情况下照样能坏。这里用真实浏览器读页面上真实结构。
//
// 顺带核对「不再有任何配置类入口」：设置页只读、无输入控件，对话页状态行固定本地规则引擎。
//
// 用法：npm run test:settings   （需要先起 dev：npm run dev -- --port 15181 --strictPort）
//      SG_BASE=http://localhost:15181 npm run test:settings
//      --shots  额外输出 qa-artifacts/settings-*.png
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = process.env.EDGE || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const BASE = process.env.SG_BASE || 'http://localhost:15181';
// 9557 落在本机 Windows 排除端口段 9461-9560 内（netsh excludedportrange），
// Edge CDP bind 会 0x271D 拒绝 —— 挪到段外，并允许环境变量覆盖。
const PORT = Number(process.env.QA_CDP_PORT) || 9563;
const PROFILE = path.join(tmpdir(), 'todolist-qa-settings-profile');
const OUT = path.resolve(import.meta.dirname, '..', 'qa-artifacts');
const WANT_SHOTS = process.argv.includes('--shots');
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

  const evalJs = async (expression, timeout = 15000) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sid,
      timeout
    );
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
    await sleep(600);
    // 去掉样式指南外壳，只留产品界面
    await evalJs(`(() => {
      const nav = document.querySelector('.sg-nav'); if (nav) nav.remove();
      const stage = document.querySelector('.sg-stage');
      if (stage) { stage.style.padding = '0'; stage.style.background = 'transparent'; stage.style.minHeight = '100vh'; }
      document.body.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg');
      return true;
    })()`, 10000);
    await sleep(200);
  };

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sid, 15000);
    writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('  → ' + name);
  };

  mkdirSync(OUT, { recursive: true });

  // ── 1. 结构：快捷键速查该有的都在，配置类旧入口一个都不剩 ────────────────
  await goto('settings', 1280, 820);
  const shape = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    const rows = Array.from(document.querySelectorAll('.settings-row'));
    return {
      head: !!q('.settings-head'),
      back: !!q('.settings-back'),
      foot: !!q('.settings-foot'),
      title: q('.settings-title') ? q('.settings-title').textContent.trim() : '',
      note: q('.settings-head-note') ? q('.settings-head-note').textContent.trim() : '',
      groups: document.querySelectorAll('.settings-group').length,
      groupTitles: Array.from(document.querySelectorAll('.settings-group-title')).map((e) => e.textContent.trim()),
      rows: rows.length,
      rowsComplete: rows.every((r) => {
        const k = r.querySelector('.settings-label');
        const d = r.querySelector('.settings-range');
        return k && k.textContent.trim() && d && d.textContent.trim();
      }),
      hasInput: !!q('.settings input, .settings textarea, .settings input[type=checkbox]'),
      footButtons: document.querySelectorAll('.settings-foot button').length,
      // 显示模式是本机偏好，设置页也要有入口；日历键必须进速查表。
      modeBtns: document.querySelectorAll('.settings-group .mode-switch .mode-btn').length,
      modePressed: Array.from(document.querySelectorAll('.settings-group .mode-switch .mode-btn')).map((b) => b.getAttribute('aria-pressed')),
      keyText: Array.from(document.querySelectorAll('.settings-row')).map((r) => r.textContent).join(' '),
      oldNet: !!q('#set-net-hosts') || !!q('#set-net-timeout') || !!q('#set-net-maxbytes'),
      gearOn: !!q('.tabs .tab.is-on'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('设置页结构完整（页头 / 返回 / 分组 / 底栏）', shape.head && shape.back && shape.foot, JSON.stringify(shape));
  check('标题为「设置」', shape.title === '设置', `title=${shape.title}`);
  // 2026-11-10 补齐日历后设置页共六节：两项本机偏好 + 四组快捷键速查。
  // 仍然是严格顺序比较：少一节、多一节、换顺序都会红。
  const WANT_GROUPS = ['列表外观', '显示模式', '全局', '列表页', '日历', '对话页'];
  check(
    '分组为「列表外观 / 显示模式 / 全局 / 列表页 / 日历 / 对话页」',
    JSON.stringify(shape.groupTitles) === JSON.stringify(WANT_GROUPS),
    JSON.stringify(shape.groupTitles)
  );
  check('设置页有两个显示模式按钮，且恰好一个处于按下态', shape.modeBtns === 2 && shape.modePressed.filter((v) => v === 'true').length === 1, JSON.stringify(shape.modePressed));
  check('速查表列出日历键（翻月 / 回今天 / 在这天新建）', ['PageUp', 'PageDown', 'Home', '在选中那天新建'].every((k) => shape.keyText.includes(k)), shape.keyText.slice(0, 160));
  check('每组至少一条、且每条快捷键都有键名与说明', shape.rows >= 12 && shape.rowsComplete, `rows=${shape.rows} complete=${shape.rowsComplete}`);
  check('页头注明本页只读', shape.note.includes('只读'), shape.note);
  check('没有任何输入控件（只读页，不需要保存）', shape.hasInput === false);
  check('底栏没有按钮（旧「保存 / 清除」入口已移除）', shape.footButtons === 0, `buttons=${shape.footButtons}`);
  check('旧「联网工具」控件不存在（白名单 / 超时 / 响应上限）', shape.oldNet === false);
  check('顶栏齿轮处于打开态（设置入口有归属）', shape.gearOn === true);
  check('1280 宽下无横向溢出', shape.overflow <= 0, `overflow=${shape.overflow}`);

  if (WANT_SHOTS) await shot('settings-1280.png');

  // ── 2. 对话页：诊断状态条已下线，只留本地规则引擎 ────────────────────────
  await goto('chat', 1280, 820);
  const chatStatus = await evalJs(`(() => {
    const body = document.body.textContent || '';
    return {
      hasStatusBar: !!document.querySelector('.chat-status'),
      mentionsEngine: /本地规则引擎|无网络请求/.test(body),
    };
  })()`);
  check('对话页已移除诊断状态条（.chat-status 不存在）', chatStatus.hasStatusBar === false);
  check('页面不再出现「本地规则引擎 / 无网络请求」提示词', chatStatus.mentionsEngine === false);

  // ── 3. 日历视图：模式开关真的挂上了，网格 / 只读态真的渲染出来 ─────────
  // 设置页门禁过去只访问 settings / chat，日历作为「列表的第二种模式」
  // 完全不在视野里 —— 顶栏开关写错、网格塌成 0 格都不会红。这里补上。
  await goto('calendar', 1280, 820);
  const cal = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    const modes = Array.from(document.querySelectorAll('.mode-switch .mode-btn'));
    return {
      cells: document.querySelectorAll('.cal-grid .cal-cell').length,
      selected: document.querySelectorAll('.cal-cell.is-selected').length,
      head: !!q('.cal-head'),
      side: !!q('.cal-side'),
      tray: !!q('.cal-tray'),
      prioMarks: document.querySelectorAll('.cal-chip .prio-mark, .cal-tray-item .prio-mark').length,
      prioTones: ['prio-high', 'prio-mid', 'prio-low', 'prio-none']
        .map((t) => document.querySelectorAll('.cal-chip .prio-mark.' + t + ', .cal-tray-item .prio-mark.' + t).length),
      rangeSegs: document.querySelectorAll('.cal-range-seg').length,
      rangeNotes: document.querySelectorAll('.cal-range-note').length,
      modeBtns: modes.length,
      calendarPressed: modes.some((b) => b.getAttribute('aria-pressed') === 'true' && /日历/.test(b.textContent)),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('日历是 42 格、恰好一天被选中', cal.cells === 42 && cal.selected === 1, JSON.stringify(cal));
  check('月导航 / 日详情 / 无日期托盘都渲染出来', cal.head && cal.side && cal.tray, JSON.stringify(cal));
  check('顶栏模式开关存在且「日历」处于按下态', cal.modeBtns === 2 && cal.calendarPressed, JSON.stringify(cal));
  check('日历 chip / 托盘用同一套四档记号，不再缺「中」和「无」', cal.prioMarks > 0
    && cal.prioTones[0] > 0 && cal.prioTones[1] > 0 && cal.prioTones[3] > 0,
    JSON.stringify({ marks: cal.prioMarks, tones: cal.prioTones }));
  check('日历在 1280 宽下无横向溢出', cal.overflow <= 0, `overflow=${cal.overflow}`);
  check('跨天区间在 42 格上画出中性跨度段', cal.rangeSegs > 0, JSON.stringify({ segs: cal.rangeSegs }));
  check('选中日的日详情给出区间读数', cal.rangeNotes > 0, JSON.stringify({ notes: cal.rangeNotes }));

  await evalJs(`(() => {
    const chip = document.querySelector('.cal-chip');
    if (!chip) return false;
    chip.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 24, clientY: 24,
    }));
    return true;
  })()`);
  await sleep(180);
  const calMenu = await evalJs(`(() => {
    const menu = document.querySelector('.ctx-menu');
    const text = menu ? (menu.textContent || '') : '';
    return {
      hasStart: text.includes('起点设为选中日'),
      hasClear: text.includes('清除开始日'),
    };
  })()`);
  check('chip 右键菜单挂上了区间起点调整入口', calMenu.hasStart && calMenu.hasClear, JSON.stringify(calMenu));

  if (WANT_SHOTS) {
    await shot('calendar-1280.png');
    await goto('calendar', 390, 844);
    await shot('calendar-390.png');
    await goto('calendar', 1280, 820, true);
    await shot('calendar-dark-1280.png');
  }

  await goto('calendar-done', 1280, 820);
  const calDone = await evalJs(`(() => ({
    readonly: !!document.querySelector('.cal-stats-ro'),
    tray: !!document.querySelector('.cal-tray'),
    draggable: document.querySelectorAll('.cal-chip[draggable=true], .cal-tray-item[draggable=true]').length,
  }))()`);
  check('已完成视图只读：标了只读、无托盘、没有可拖条目', calDone.readonly && !calDone.tray && calDone.draggable === 0, JSON.stringify(calDone));

  // ── 3.5 优先级四档：真实浏览器里形状 / 字重 / 中性色都真的分开了 ─────────
  // 单测只能证明类名对，证明不了 computed style。这里直接读渲染后的样式，
  // 钉死「无＝虚线空框 / 低＝浅字 / 中＝细描边 / 高＝实心底反白」四档互不相同，
  // 并锁住高档底色必须是中性墨 —— 防止有人把「高」改回红色，稀释逾期这个唯一强色。
  await goto('list', 1280, 820);
  const prio = await evalJs(`(() => {
    const style = (tone) => {
      const el = document.querySelector('.prio-badge.' + tone);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        borderStyle: s.borderTopStyle,
        borderColor: s.borderTopColor,
        weight: s.fontWeight,
        color: s.color,
        text: el.textContent.trim(),
      };
    };
    const count = (tone) => document.querySelectorAll('.prio-badge.' + tone).length;
    return {
      counts: {
        high: count('prio-high'), mid: count('prio-mid'),
        low: count('prio-low'), none: count('prio-none'),
      },
      high: style('prio-high'), mid: style('prio-mid'),
      low: style('prio-low'), none: style('prio-none'),
      // 字体排版（2026-11-10 A+B）：静态门禁管令牌值，这里管真实 computed。
      crumbSize: (() => { const el = document.querySelector('.crumb b'); return el ? getComputedStyle(el).fontSize : null; })(),
      group: (() => { const el = document.querySelector('.group-title'); if (!el) return null; const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, family: s.fontFamily }; })(),
      bodyNumeric: getComputedStyle(document.body).fontVariantNumeric,
      monoCjk: getComputedStyle(document.documentElement).getPropertyValue('--font-mono-cjk').trim(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  const allFour = Object.values(prio.counts).every((n) => n > 0);
  check('列表视图同时出现高 / 中 / 低 / 无四档徽章', allFour, JSON.stringify(prio.counts));
  check('四档中文读数正确，「无」是空的', prio.high && prio.mid && prio.low && prio.none
    && prio.high.text === '高' && prio.mid.text === '中' && prio.low.text === '低'
    && prio.none.text === '', JSON.stringify(prio));
  const opaque = (v) => v && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(v);
  const neutral = (v) => {
    const c = (v.match(/\d+/g) || []).slice(0, 3).map(Number);
    return c.length === 3 && Math.max(...c) - Math.min(...c) <= 24;
  };
  check('高档是实心底反白、中档细描边、无档虚线空框', prio.high && prio.mid && prio.none
    && opaque(prio.high.bg) && prio.mid.borderStyle === 'solid' && opaque(prio.mid.borderColor)
    && !opaque(prio.low.borderColor) && prio.none.borderStyle === 'dashed', JSON.stringify(prio));
  check('字重按 600 / 500 / 400 递进', prio.high && prio.mid && prio.low
    && prio.high.weight === '600' && prio.mid.weight === '500' && prio.low.weight === '400',
    JSON.stringify({ h: prio.high && prio.high.weight, m: prio.mid && prio.mid.weight, l: prio.low && prio.low.weight }));
  check('高档实心底是中性墨，不给优先级任何语义色', prio.high && neutral(prio.high.bg),
    prio.high && prio.high.bg);
  check('列表视图在 1280 宽下无横向溢出', prio.overflow <= 0, `overflow=${prio.overflow}`);
  check('上下文条主段 16px，与 13px 副段拉开落差', prio.crumbSize === '16px', `crumb=${prio.crumbSize}`);
  check('分组名是 11px / 500 的 mono 刻度标签，中文有显式回退', prio.group
    && prio.group.size === '11px' && prio.group.weight === '500'
    && /Mono|mono/.test(prio.group.family)
    && /PingFang|YaHei/.test(prio.monoCjk), JSON.stringify({ g: prio.group, stack: prio.monoCjk }));
  check('body 数字统一等宽（tabular-nums）', /tabular-nums/.test(prio.bodyNumeric || ''), prio.bodyNumeric);
  if (WANT_SHOTS) {
    await shot('priority-four-tones-1280.png');
    // 暗色下高档徽章会反过来「提亮」，浅底深字也必须过 4.5:1 —— 留一张对照图。
    await goto('list', 1280, 820, true);
    await shot('priority-four-tones-dark-1280.png');
    // 字体排版的字阶表 / 三层落差陈列（样式指南 tokens 页，明暗各一张）。
    await goto('tokens', 1280, 1700);
    await shot('typography-tokens-1280.png');
    await goto('tokens', 1280, 1700, true);
    await shot('typography-tokens-dark-1280.png');
  }

  // 独立页头（设置页）真的用上 22px 的 --fs-display，而不是只改了令牌没接线。
  await goto('settings', 1280, 820);
  const pageTitle = await evalJs(`(() => {
    const el = document.querySelector('.settings-title');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight };
  })()`);
  check('独立页头 22px / 600（--fs-display 已接线）', pageTitle
    && pageTitle.size === '22px' && pageTitle.weight === '600', JSON.stringify(pageTitle));

  // ── 3.7 窄边自动降级：偏好不变、有效布局临时切列表、宽边自动还原 ──────────
  // 决策逻辑由 lib/layoutMode.test.js 钉死；这里验证真实浏览器里的可见结果，
  // 尤其「三处开关仍显示用户选的日历」—— 偏好绝不能被窗口宽度改写。
  await goto('calendar-autonarrow', 390, 844);
  const narrowAuto = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    const modes = Array.from(document.querySelectorAll('.mode-switch .mode-btn'));
    return {
      notice: q('.layout-notice') ? q('.layout-notice').textContent.trim() : null,
      noticeBtn: q('.layout-notice-btn') ? q('.layout-notice-btn').textContent.trim() : null,
      calGrid: !!q('.cal-grid'),
      taskRows: document.querySelectorAll('.task-row').length,
      calendarPressed: modes.some((b) => b.getAttribute('aria-pressed') === 'true' && /日历/.test(b.textContent)),
      crumbSub: q('.crumb span') ? q('.crumb span').textContent.trim() : null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('390 宽自动改用列表布局，日历网格消失、任务行仍在', !narrowAuto.calGrid
    && narrowAuto.taskRows > 0, JSON.stringify(narrowAuto));
  check('提示条给出可见解释（列表口径）与「仍用日历」出口', narrowAuto.notice
    && narrowAuto.notice.includes('列表口径') && narrowAuto.noticeBtn === '仍用日历',
    JSON.stringify(narrowAuto));
  check('三处开关仍显示用户选的「日历」偏好（偏好未被改写）', narrowAuto.calendarPressed,
    JSON.stringify(narrowAuto));
  check('面包屑按当前实际布局，不再声称日历', narrowAuto.crumbSub
    && !narrowAuto.crumbSub.includes('日历'), narrowAuto.crumbSub);
  check('窄边降级后无横向溢出', narrowAuto.overflow <= 0, `overflow=${narrowAuto.overflow}`);
  if (WANT_SHOTS) await shot('narrow-fallback-390.png');

  // 用户显式覆盖：点「仍用日历」后，本次会话就要日历
  const overridden = await evalJs(`(() => {
    const b = document.querySelector('.layout-notice-btn');
    if (!b) return null;
    b.click();
    return true;
  })()`);
  await sleep(300);
  const manualCal = await evalJs(`(() => ({
    calGrid: !!document.querySelector('.cal-grid'),
    noticeBtn: document.querySelector('.layout-notice-btn')
      ? document.querySelector('.layout-notice-btn').textContent.trim() : null,
  }))()`);
  check('点「仍用日历」后显式覆盖生效，提示改为「恢复自动」', overridden
    && manualCal.calGrid && manualCal.noticeBtn === '恢复自动', JSON.stringify(manualCal));
  if (WANT_SHOTS) await shot('narrow-fallback-manual-calendar-390.png');

  await goto('calendar-autonarrow', 1280, 820);
  const restored = await evalJs(`(() => ({
    calGrid: !!document.querySelector('.cal-grid'),
    notice: !!document.querySelector('.layout-notice'),
    cells: document.querySelectorAll('.cal-grid .cal-cell').length,
  }))()`);
  check('恢复宽边自动回到日历（42 格），提示条消失', restored.calGrid
    && !restored.notice && restored.cells === 42, JSON.stringify(restored));
  if (WANT_SHOTS) await shot('narrow-fallback-restored-1280.png');

  // ── 4. 窄屏几何：设置页在 390 宽下不横向溢出 ────────────────────────────
  await goto('settings', 390, 844);
  const narrow = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    const row = q('.settings-row');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      singleColumn: row ? getComputedStyle(row).gridTemplateColumns.split(' ').length === 1 : false,
      footVisible: !!q('.settings-foot'),
    };
  })()`);
  check('390 宽下无横向溢出', narrow.overflow <= 0, `overflow=${narrow.overflow}`);
  check('390 宽下快捷键改为上下堆叠（单列）', narrow.singleColumn === true);
  check('390 宽下底栏仍在（布局不塌）', narrow.footVisible === true);
  if (WANT_SHOTS) await shot('settings-390.png');

  // ── 5. 暗色 ────────────────────────────────────────────────────────────
  await goto('settings', 1280, 820, true);
  if (WANT_SHOTS) await shot('settings-dark-1280.png');

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
