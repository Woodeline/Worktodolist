#!/usr/bin/env node
// 设置页（快捷键速查）UI 级回归（独立浏览器 profile）。
//
// 为什么单测不够：单测能证明组件函数返回了 JSX，但证明不了「在真实浏览器里渲染出来
// 的页面结构正确、旧功能入口一个都不剩」这条链路 —— 类名写错、入口漏删，在逻辑层
// 全绿的情况下照样能坏。这里用真实浏览器读页面上真实结构。
//
// 顺带核对「不再有任何配置类入口」：设置页只读、无输入控件。
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
      // 设置入口已收进应用菜单：活动栏不再单列齿轮，但菜单按钮必须在，
      // 否则这个动作是真的丢了（单测只证明 appMenu.js 里有这一项）。
      settingsBtn: Array.from(document.querySelectorAll('.tabs .tab'))
        .filter((b) => (b.getAttribute('title') || '').startsWith('设置')).length,
      appMenuBtn: !!q('.tabs .tab[aria-haspopup="menu"]'),
      // 数据节：两颗以前挂在底栏上的按钮，必须真的在设置页里（不是被顺手删掉）
      dataActions: document.querySelectorAll('.settings-actions').length,
      dataBtns: Array.from(document.querySelectorAll('.settings-actions button')).map((b) => b.textContent.trim()),
      // 阅读密度：四组三档按钮 + 实时预览；整页无输入控件由 hasInput 统一兜底
      densitySegs: document.querySelectorAll('.density-seg').length,
      densityOpts: document.querySelectorAll('.density-opt').length,
      densityPressed: document.querySelectorAll('.density-opt[aria-pressed="true"]').length,
      densityPreviewNav: document.querySelectorAll('.density-preview .dp-nav').length,
      densityPreviewRows: document.querySelectorAll('.density-preview .dp-row').length,
      densityReset: document.querySelectorAll('.density-reset').length,
      // 主题只有一枚按钮，点一次轮换一档；按钮画的是当前档，不再有实心底。
      themeBtns: document.querySelectorAll('.tabs .tab[data-mode]').length,
      themeMode: (document.querySelector('.tabs .tab[data-mode]') || {}).dataset?.mode || '',
      themeSolid: document.querySelectorAll('.tabs .tab[data-mode].is-solid').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('设置页结构完整（页头 / 返回 / 分组 / 底栏）', shape.head && shape.back && shape.foot, JSON.stringify(shape));
  check('标题为「设置」', shape.title === '设置', `title=${shape.title}`);
  // 2026-11-14 对话功能剥离后设置页共五节：两项本机偏好 + 三组快捷键速查。
  // 仍然是严格顺序比较：少一节、多一节、换顺序都会红。
  // 2026-11-14 数据节加入（底栏删除后，「手动重载 / 切换目录」搬到这里）：
  // 仍是严格顺序比较，少一节、多一节、换顺序都会红。
  // 2026-11-14 阅读密度节加入（侧栏 / 列表的字号与行距，插在列表外观之后）：七节。
  const WANT_GROUPS = ['列表外观', '阅读密度', '显示模式', '数据', '全局', '列表页', '日历'];
  check(
    '分组为「列表外观 / 阅读密度 / 显示模式 / 数据 / 全局 / 列表页 / 日历」',
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
  check(
    '「手动重载 / 切换目录」在设置页数据节里（主界面不再有这两颗钮）',
    shape.dataActions === 1 &&
      JSON.stringify(shape.dataBtns) === JSON.stringify(['手动重载', '切换目录']),
    JSON.stringify(shape.dataBtns)
  );
  check('设置入口只在应用菜单（活动栏无齿轮、菜单按钮仍在）',
    shape.settingsBtn === 0 && shape.appMenuBtn === true,
    `settingsBtn=${shape.settingsBtn} appMenuBtn=${shape.appMenuBtn}`);
  check('主题只有一枚轮换按钮，且不套实心底',
    shape.themeBtns === 1 && shape.themeSolid === 0 && ['auto', 'light', 'dark'].includes(shape.themeMode),
    `themeBtns=${shape.themeBtns} themeSolid=${shape.themeSolid} mode=${shape.themeMode}`);
  check('1280 宽下无横向溢出', shape.overflow <= 0, `overflow=${shape.overflow}`);
  check('阅读密度：4 组 × 3 档 = 12 颗按钮，每组恰好一档按下',
    shape.densitySegs === 4 && shape.densityOpts === 12 && shape.densityPressed === 4,
    JSON.stringify({ segs: shape.densitySegs, opts: shape.densityOpts, pressed: shape.densityPressed }));
  check('阅读密度：实时预览渲染出目录三条 + 列表三行',
    shape.densityPreviewNav === 3 && shape.densityPreviewRows === 3,
    JSON.stringify({ nav: shape.densityPreviewNav, rows: shape.densityPreviewRows }));
  check('阅读密度：默认档不出现「恢复默认」出口', shape.densityReset === 0, `reset=${shape.densityReset}`);

  // 阅读密度交互链路：点「宽松」→ 按下档移动、预览行高真的变大、--pref-nav-h 落到 <html>；
  // 点「恢复默认」→ 落盘清除（变量移除）、按下档回标准。只证明按钮画出来不够，
  // 要证明「偏好 → 投影 → 真实几何」这条链在浏览器里是通的。
  const densityPick = await evalJs(`(() => {
    const seg = document.querySelectorAll('.density-seg')[1]; /* 侧栏行距 */
    const before = getComputedStyle(document.querySelector('.density-preview .dp-nav')).height;
    const target = Array.from(seg.querySelectorAll('.density-opt'))
      .find((b) => b.getAttribute('aria-pressed') !== 'true' && b.textContent.includes('宽松'));
    if (!target) return null;
    target.click();
    return new Promise((res) => setTimeout(() => {
      res({
        before,
        after: getComputedStyle(document.querySelector('.density-preview .dp-nav')).height,
        pressed: seg.querySelectorAll('.density-opt[aria-pressed="true"]').length,
        pressedLabel: (seg.querySelector('.density-opt[aria-pressed="true"]') || {}).textContent || '',
        hasReset: !!document.querySelector('.density-reset'),
        rootVar: getComputedStyle(document.documentElement).getPropertyValue('--pref-nav-h').trim(),
      });
    }, 250));
  })()`);
  check('阅读密度：点「宽松」后按下档移动、预览行高变大、偏好变量落到 <html>',
    densityPick && densityPick.pressed === 1 && densityPick.pressedLabel.includes('宽松')
    && parseFloat(densityPick.after) > parseFloat(densityPick.before)
    && densityPick.hasReset && densityPick.rootVar === '32px',
    JSON.stringify(densityPick));

  const densityReset = await evalJs(`(() => {
    const btn = document.querySelector('.density-reset');
    if (!btn) return null;
    btn.click();
    return new Promise((res) => setTimeout(() => {
      const seg = document.querySelectorAll('.density-seg')[1];
      res({
        resetGone: !document.querySelector('.density-reset'),
        pressedLabel: (seg.querySelector('.density-opt[aria-pressed="true"]') || {}).textContent || '',
        rootVar: getComputedStyle(document.documentElement).getPropertyValue('--pref-nav-h').trim(),
        navH: getComputedStyle(document.querySelector('.density-preview .dp-nav')).height,
      });
    }, 250));
  })()`);
  check('阅读密度：「恢复默认」清除落盘（变量移除、按下档回标准、预览回默认行高）',
    densityReset && densityReset.resetGone && densityReset.pressedLabel.includes('标准')
    && densityReset.rootVar === '' && densityReset.navH === '26px',
    JSON.stringify(densityReset));

  if (WANT_SHOTS) await shot('settings-1280.png');

  // ── 3. 日历视图：只剩网格，点日期弹「当天任务」浮层 ──────────────────────
  // 设置页门禁过去只访问 settings，日历作为「列表的第二种模式」
  // 完全不在视野里 —— 网格塌成 0 格、浮层弹不出来都不会红。这里补上。
  // 2026-11-15：快录框 / 右栏日详情 / 无日期托盘 / 跨日区间条全部删除，
  // 断言改成"它们不在"+ "点格子弹浮层"这条真实回路。
  await goto('calendar', 1280, 820);
  const cal = await evalJs(`(() => ({
    cells: document.querySelectorAll('.cal-grid .cal-cell').length,
    selected: document.querySelectorAll('.cal-cell.is-selected').length,
    head: !!document.querySelector('.cal-head'),
    quickAdd: !!document.querySelector('.quick-add'),
    side: !!document.querySelector('.cal-side'),
    tray: !!document.querySelector('.cal-tray'),
    bars: document.querySelectorAll('.cal-bar, .cal-range-seg').length,
    chips: document.querySelectorAll('.cal-chip').length,
    highChips: document.querySelectorAll('.cal-chip.prio-high').length,
    pop: !!document.querySelector('.cal-pop'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('日历是 42 格、恰好一天被选中', cal.cells === 42 && cal.selected === 1, JSON.stringify(cal));
  check('日历页只剩网格：无快录框 / 右栏 / 托盘 / 区间条',
    cal.head && !cal.quickAdd && !cal.side && !cal.tray && cal.bars === 0, JSON.stringify(cal));
  check('任务以 chip 落在格里，四档墨条仍按优先级上色', cal.chips > 0 && cal.highChips > 0, JSON.stringify(cal));
  check('首屏不弹浮层（点日期才弹）', !cal.pop, JSON.stringify({ pop: cal.pop }));
  check('日历在 1280 宽下无横向溢出', cal.overflow <= 0, `overflow=${cal.overflow}`);

  // 点「有任务的一天」→ 列表 + 底部「添加任务」
  const dayWithTasks = await evalJs(`(() => {
    const cell = document.querySelector('.cal-cell .cal-chip')
      && document.querySelector('.cal-cell .cal-chip').closest('.cal-cell');
    if (!cell) return null;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return cell.getAttribute('data-date');
  })()`);
  await sleep(160);
  const popList = await evalJs(`(() => ({
    open: !!document.querySelector('.cal-pop'),
    rows: document.querySelectorAll('.cal-pop .task-row').length,
    addBtn: !!document.querySelector('.cal-pop-addbtn'),
    addInput: !!document.querySelector('.cal-pop-add-input'),
    label: (document.querySelector('.cal-pop-title') || {}).textContent || '',
  }))()`);
  check('点有任务的日期：弹出当天任务列表 + 底部「添加任务」',
    !!dayWithTasks && popList.open && popList.rows > 0 && popList.addBtn && !popList.addInput,
    JSON.stringify({ day: dayWithTasks, ...popList }));

  // 点「空的一天」→ 直接进添加态（输入框已就位）
  // 只挑**本月**的空格：邻月灰格会先翻月（见下一条），那是另一条回路。
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(120);
  const emptyDay = await evalJs(`(() => {
    const cell = Array.from(document.querySelectorAll('.cal-cell.in-month'))
      .find((c) => !c.querySelector('.cal-chip'));
    if (!cell) return null;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return cell.getAttribute('data-date');
  })()`);
  await sleep(160);
  const popAdd = await evalJs(`(() => ({
    open: !!document.querySelector('.cal-pop'),
    input: !!document.querySelector('.cal-pop-add-input'),
    addBtn: !!document.querySelector('.cal-pop-addbtn'),
    focused: document.activeElement && document.activeElement.classList.contains('cal-pop-add-input'),
  }))()`);
  check('点空日期：直接弹出添加窗口（输入框就位且聚焦）',
    !!emptyDay && popAdd.open && popAdd.input && !popAdd.addBtn && popAdd.focused,
    JSON.stringify({ day: emptyDay, ...popAdd }));

  // 点邻月灰格 → 先翻到那个月，再在**新格子**上把浮层开出来。
  // 这一条盯的是「锚点重算」：翻月会换掉整批格子，沿用旧矩形就会浮在空位上。
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(120);
  const monthBefore = await evalJs(`(document.querySelector('.cal-month') || {}).textContent || ''`);
  const outDay = await evalJs(`(() => {
    const cell = document.querySelector('.cal-cell.out-month');
    if (!cell) return null;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return cell.getAttribute('data-date');
  })()`);
  await sleep(240);
  const outRes = await evalJs(`(() => {
    const pop = document.querySelector('.cal-pop');
    const openCell = document.querySelector('.cal-cell.is-open');
    const r = pop ? pop.getBoundingClientRect() : null;
    const c = openCell ? openCell.getBoundingClientRect() : null;
    return {
      month: (document.querySelector('.cal-month') || {}).textContent || '',
      open: !!pop,
      openDate: openCell ? openCell.getAttribute('data-date') : null,
      inMonth: openCell ? openCell.classList.contains('in-month') : false,
      leftAligned: r && c ? Math.abs(r.left - c.left) <= 1 : false,
      nearCell: r && c ? (r.top >= c.bottom - 1 || r.bottom <= c.top + 1) : false,
      inViewport: r ? r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth : false,
    };
  })()`);
  check('点邻月灰格：翻到那个月并在新格子上弹出当天浮层（锚点已重算）',
    !!outDay && outRes.month !== monthBefore && outRes.open && outRes.openDate === outDay
      && outRes.inMonth && outRes.leftAligned && outRes.nearCell && outRes.inViewport,
    JSON.stringify({ day: outDay, from: monthBefore, ...outRes }));

  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(120);
  check('Esc 收掉浮层', !(await evalJs(`!!document.querySelector('.cal-pop')`)), '');

  if (WANT_SHOTS) {
    await shot('calendar-1280.png');
    await goto('calendar', 390, 844);
    await shot('calendar-390.png');
    await goto('calendar', 1280, 820, true);
    await shot('calendar-dark-1280.png');
  }

  // 2026-11-16 二十改：日历不再投影日志（done.txt 是已完成记录，只按完成日锚定）。
  // 站在「日志」视图里打开日历，格子里画的必须还是「全部」里的未完成任务，
  // 而且它们都能拖 —— 当初为日志服务的只读态（.cal-stats-ro / .cal-chip.cal-done）已删除。
  await goto('calendar-done', 1280, 820);
  const calDone = await evalJs(`(() => {
    const grid = document.querySelector('.cal-grid');
    return {
      roBadge: !!document.querySelector('.cal-stats-ro'),
      doneChips: document.querySelectorAll('.cal-chip.cal-done').length,
      chips: document.querySelectorAll('.cal-chip').length,
      draggable: document.querySelectorAll('.cal-chip[draggable=true]').length,
      tray: !!document.querySelector('.cal-tray'),
      // 日志演示数据里的标题（完成日就在本月）：真的投影了就会出现在格子里
      hasLogTitle: /安装 topydo 并跑通三种 UI|编写 topydo 安装配置指南/.test(grid ? grid.textContent : ''),
    };
  })()`);
  check('日志不进日历：日志视图里打开日历仍只画未完成（无只读标、全部可拖、不出现已完成条目）',
    !calDone.roBadge && !calDone.tray && calDone.doneChips === 0
      && calDone.chips > 0 && calDone.draggable === calDone.chips && !calDone.hasLogTitle,
    JSON.stringify(calDone));

  // ── 3.5 优先级旗标：真实浏览器里看颜色、量槽宽 ──────────────────────────
  // 单测只能证明类名对，证明不了 computed style / SVG 真的画出来了。
  // 2026-11-15 定稿：列表＝标题最左一枚**中空旗**，颜色就是档位（高红 / 中橙 / 低蓝）；
  // 「无」整枚不画，但 18px 的旗标槽仍在 —— 标题列因此永远对齐。
  await goto('list', 1280, 820);
  const prio = await evalJs(`(() => {
    const read = (tone) => {
      const el = document.querySelector('.task-head .prio-badge.' + tone);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        svgs: el.querySelectorAll('svg').length,
        color: s.color,
        text: el.textContent.trim(),
        aria: el.getAttribute('aria-label') || '',
        width: Math.round(el.getBoundingClientRect().width),
      };
    };
    const head = document.querySelector('.task-row:not(.is-child) .task-head');
    return {
      high: read('prio-high'), mid: read('prio-mid'),
      low: read('prio-low'), none: read('prio-none'),
      headCols: head ? getComputedStyle(head).gridTemplateColumns : null,
      flagSlot: getComputedStyle(document.documentElement).getPropertyValue('--flag-slot').trim(),
      // 字体排版（2026-11-10 A+B）：静态门禁管令牌值，这里管真实 computed。
      crumbSize: (() => { const el = document.querySelector('.crumb b'); return el ? getComputedStyle(el).fontSize : null; })(),
      group: (() => { const el = document.querySelector('.group-title'); if (!el) return null; const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, family: s.fontFamily }; })(),
      bodyNumeric: getComputedStyle(document.body).fontVariantNumeric,
      monoCjk: getComputedStyle(document.documentElement).getPropertyValue('--font-mono-cjk').trim(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('列表画出高 / 中 / 低三档旗标（「无」不画）',
    !!(prio.high && prio.mid && prio.low) && prio.none === null, JSON.stringify(prio));
  const tones = [prio.high, prio.mid, prio.low].filter(Boolean).map((p) => p.color);
  check('三档旗标颜色互不相同（红 / 橙 / 蓝三支）', new Set(tones).size === 3, JSON.stringify(tones));
  check('旗标是图形记号，不写汉字（(A)/(B)/(C) 只在 title / aria 里）',
    [prio.high, prio.mid, prio.low].every((p) => p && p.text === '' && p.svgs === 1 && p.aria !== ''),
    JSON.stringify([prio.high, prio.mid, prio.low]));
  check('无档不画旗，但旗标槽仍占 18px（标题与读数行对齐）',
    prio.flagSlot === '18px' && /^18px\b/.test(prio.headCols || ''),
    JSON.stringify({ slot: prio.flagSlot, cols: prio.headCols }));
  check('列表视图在 1280 宽下无横向溢出', prio.overflow <= 0, `overflow=${prio.overflow}`);
  check('上下文条主段 16px（--fs-lg，小字撑不起 36px 顶栏）', prio.crumbSize === '16px', `crumb=${prio.crumbSize}`);
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
  // 尤其「侧栏仍显示用户选的日历」—— 偏好绝不能被窗口宽度改写。
  // 2026-11-15：页眉的 .mode-switch 已退场（日历改为侧栏入口），
  // 「三处开关」只剩侧栏这一处可见口径：窄屏下侧栏被 display:none，
  // 但 DOM 与 active 态还在，正好用来核对「偏好没被改写」。
  await goto('calendar-autonarrow', 390, 844);
  const narrowAuto = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    const calNav = Array.from(document.querySelectorAll('.sidebar .nav-item'))
      .find((b) => /日历/.test(b.textContent || ''));
    return {
      notice: q('.layout-notice') ? q('.layout-notice').textContent.trim() : null,
      noticeBtn: q('.layout-notice-btn') ? q('.layout-notice-btn').textContent.trim() : null,
      calGrid: !!q('.cal-grid'),
      taskRows: document.querySelectorAll('.task-row').length,
      calendarPressed: !!calNav && calNav.classList.contains('active'),
      crumbSub: q('.crumb') ? q('.crumb').textContent.trim() : null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('390 宽自动改用列表布局，日历网格消失、任务行仍在', !narrowAuto.calGrid
    && narrowAuto.taskRows > 0, JSON.stringify(narrowAuto));
  check('提示条给出可见解释（列表口径）与「仍用日历」出口', narrowAuto.notice
    && narrowAuto.notice.includes('列表口径') && narrowAuto.noticeBtn === '仍用日历',
    JSON.stringify(narrowAuto));
  check('侧栏仍显示用户选的「日历」偏好（偏好未被窗口宽度改写）', narrowAuto.calendarPressed,
    JSON.stringify(narrowAuto));
  check('面包屑按当前实际布局且只剩标题（不声称日历、不带计数）', narrowAuto.crumbSub
    && !narrowAuto.crumbSub.includes('日历') && !narrowAuto.crumbSub.includes('项'), narrowAuto.crumbSub);
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
