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
      oldNet: !!q('#set-net-hosts') || !!q('#set-net-timeout') || !!q('#set-net-maxbytes'),
      gearOn: !!q('.tabs .tab.is-on'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('设置页结构完整（页头 / 返回 / 分组 / 底栏）', shape.head && shape.back && shape.foot, JSON.stringify(shape));
  check('标题为「设置」', shape.title === '设置', `title=${shape.title}`);
  check(
    '分组为「全局 / 列表页 / 对话页」',
    JSON.stringify(shape.groupTitles) === JSON.stringify(['全局', '列表页', '对话页']),
    JSON.stringify(shape.groupTitles)
  );
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

  // ── 3. 窄屏几何：设置页在 390 宽下不横向溢出 ────────────────────────────
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

  // ── 4. 暗色 ────────────────────────────────────────────────────────────
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
