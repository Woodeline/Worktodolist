#!/usr/bin/env node
// 设置页 UI 级回归 + 结构核对（不需要真实 API Key，用独立浏览器 profile）。
//
// 为什么单测不够：单测能证明 saveAiConfig → loadAiConfig 通了，但证明不了
// 「在界面上改完 → 点保存 → 别处跟着变」这条真实链路 —— 受控输入没绑上、
// 保存按钮点不动、状态行读了另一份 state，这些在逻辑层全绿的情况下照样能坏。
// 这里用真实浏览器点真按钮，读 localStorage 与页面上真实文案。
//
// 顺带核对「旧入口已经消失」：对话页不应再有 .ai-cfg 面板与 .chat-status-btn。
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

  // ── 1. 结构：设置页该有的都在，旧入口一个都不剩 ──────────────────────────
  await goto('settings', 1280, 820);
  const shape = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    return {
      head: !!q('.settings-head'),
      back: !!q('.settings-back'),
      foot: !!q('.settings-foot'),
      title: q('.settings-title') ? q('.settings-title').textContent : '',
      groups: document.querySelectorAll('.settings-group').length,
      rows: document.querySelectorAll('.settings-row').length,
      groupTitles: Array.from(document.querySelectorAll('.settings-group-title')).map((e) => e.textContent.trim()),
      netHosts: !!q('#set-net-hosts'),
      netTimeout: !!q('#set-net-timeout'),
      netMaxBytes: !!q('#set-net-maxbytes'),
      badge: !!q('.settings-badge'),
      where: q('.settings-where') ? q('.settings-where').textContent : '',
      oldPanel: !!q('.ai-cfg'),
      gearOn: !!q('.appmenu-btn.is-on'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('设置页结构完整（页头 / 返回 / 分组 / 动作栏）', shape.head && shape.back && shape.foot, JSON.stringify(shape));
  check('标题为「设置」，且只有一组配置（AI 兜底）', shape.title === '设置' && shape.groups === 1, `title=${shape.title} groups=${shape.groups}`);
  check(
    '分组标题只剩「AI 兜底解析」',
    JSON.stringify(shape.groupTitles) === JSON.stringify(['AI 兜底解析']),
    JSON.stringify(shape.groupTitles)
  );
  check(
    '字段齐全：6 行（启用 / 地址 / 模型 / Key / 超时 / 重试）',
    shape.rows === 6,
    `rows=${shape.rows}`
  );
  // 「联网工具」分组已随 T4 工具一并移除。这条断言的作用是**防止它被顺手加回来**
  // —— 一个没有消费者的联网开关，比没有这个开关更糟（会让人以为数据可能出机）。
  check(
    '联网工具分组已整体移除（白名单 / 超时 / 响应上限控件都不在）',
    !shape.netHosts && !shape.netTimeout && !shape.netMaxBytes,
    JSON.stringify({ hosts: shape.netHosts, timeout: shape.netTimeout, maxBytes: shape.netMaxBytes })
  );
  check('未改动时不显示「未保存」标记', shape.badge === false);
  check('初始明示「当前不会发出任何网络请求」', shape.where.includes('不会发出任何网络请求'), shape.where);
  check('旧 AI 兜底面板已移除（.ai-cfg 不存在）', shape.oldPanel === false);
  check('顶栏齿轮处于打开态（设置入口有归属）', shape.gearOn === true);
  check('1280 宽下无横向溢出', shape.overflow <= 0, `overflow=${shape.overflow}`);

  if (WANT_SHOTS) await shot('settings-1280.png');

  // ── 2. 改参数 → 保存 → 真的落盘 ─────────────────────────────────────────
  const saveRes = await evalJs(`(async () => {
    const setVal = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const q = (s) => document.querySelector(s);
    const enable = q('.settings-check input[type=checkbox]');
    if (!enable.checked) enable.click();
    setVal(q('#set-baseurl'), 'https://api.example.org/v1');
    setVal(q('#set-model'), 'demo-model');
    setVal(q('#set-key'), 'sk-unit-test');
    setVal(q('#set-timeout'), '6000');
    setVal(q('#set-retries'), '2');
    await new Promise((r) => setTimeout(r, 80));
    const dirty = !!q('.settings-badge');
    const whereDraft = q('.settings-where').textContent;
    q('.settings-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 80));
    const raw = localStorage.getItem('todogui.aiFallback');
    return {
      dirty,
      whereDraft,
      saved: raw ? JSON.parse(raw) : null,
      badgeAfter: !!q('.settings-badge'),
      whereAfter: q('.settings-where').textContent,
      saveDisabled: q('.settings-foot .btn-primary').disabled,
    };
  })()`);
  const saved = saveRes.saved || {};
  check('改动后出现「未保存」标记', saveRes.dirty === true);
  check('保存前就预告「保存后会发往哪」', saveRes.whereDraft.includes('保存后发往：api.example.org'), saveRes.whereDraft);
  check('保存后 localStorage 落盘（地址 / 模型 / Key）',
    saved.baseUrl === 'https://api.example.org/v1' && saved.model === 'demo-model' && saved.apiKey === 'sk-unit-test',
    JSON.stringify(saved));
  check('保存后超时与重试按填写值落盘（6000ms / 2 次）',
    saved.timeoutMs === 6000 && saved.maxRetries === 2, `timeout=${saved.timeoutMs} retries=${saved.maxRetries}`);
  check('保存后「未保存」标记消失，保存按钮回到禁用', saveRes.badgeAfter === false && saveRes.saveDisabled === true);
  check('保存后明示「当前会发往：api.example.org」', saveRes.whereAfter.includes('api.example.org'), saveRes.whereAfter);

  // ── 3. 换到对话页：别处也跟着变（不是各存一份 state） ────────────────────
  await goto('chat', 1280, 820);
  const chatStatus = await evalJs(`(() => {
    const el = document.querySelector('.chat-status');
    return {
      text: el ? el.textContent : '',
      hasOldBtn: !!document.querySelector('.chat-status-btn'),
      hasOldPanel: !!document.querySelector('.ai-cfg'),
    };
  })()`);
  check('对话页状态行同步显示新的发往域', chatStatus.text.includes('api.example.org'), chatStatus.text);
  check('对话页不再有「AI 兜底」按钮与面板', chatStatus.hasOldBtn === false && chatStatus.hasOldPanel === false);

  // ── 4. 清除配置 → 回到「不发请求」 ───────────────────────────────────────
  await goto('settings', 1280, 820);
  const cleared = await evalJs(`(async () => {
    const q = (s) => document.querySelector(s);
    const hadConfig = localStorage.getItem('todogui.aiFallback') !== null;
    q('.settings-foot .btn-danger').click();
    await new Promise((r) => setTimeout(r, 90));
    return {
      hadConfig,
      raw: localStorage.getItem('todogui.aiFallback'),
      where: q('.settings-where').textContent,
      clearDisabled: q('.settings-foot .btn-danger').disabled,
    };
  })()`);
  check('清除前确实存在落盘配置（前置条件成立）', cleared.hadConfig === true);
  check('清除后 localStorage 里没有配置', cleared.raw === null, String(cleared.raw));
  check('清除后回到「当前不会发出任何网络请求」', cleared.where.includes('不会发出任何网络请求'), cleared.where);
  check('清除后「清除配置」按钮禁用（没有配置可清）', cleared.clearDisabled === true);

  // ── 4b. 边界：填了地址与 Key 但没启用，也必须能清掉 ──────────────────────
  // 这条曾经是坏的：清除按钮用「是否启用」当判据，导致一份含明文 Key 的
  // 落盘配置因为没勾开关而永远删不掉。判据必须是「本机是否存有配置」。
  const partial = await evalJs(`(async () => {
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const q = (s) => document.querySelector(s);
    const enable = q('.settings-check input[type=checkbox]');
    if (enable.checked) enable.click(); // 保持未启用
    setVal(q('#set-baseurl'), 'https://api.example.org/v1');
    setVal(q('#set-key'), 'sk-left-behind');
    await new Promise((r) => setTimeout(r, 80));
    q('.settings-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 90));
    const disabledWhileOff = q('.settings-foot .btn-danger').disabled;
    q('.settings-foot .btn-danger').click();
    await new Promise((r) => setTimeout(r, 90));
    return { disabledWhileOff, raw: localStorage.getItem('todogui.aiFallback') };
  })()`);
  check('未启用但已落盘时，「清除配置」仍可点', partial.disabledWhileOff === false);
  check('未启用也能真的清干净（明文 Key 不留残留）', partial.raw === null, String(partial.raw));

  // ── 4c 段落已随 T4 联网工具移除 ─────────────────────────────────────────
  // 原先这里校验「总闸 + 主机白名单」双门槛、白名单落盘归一化、以及 todogui.net
  // 键能被「清除全部配置」清掉。工具与 lib/net/ 一并删除后，这些断言失去了被测对象。
  // 「不能被悄悄加回来」这件事改由 §1 的「联网工具分组已整体移除」那条断言承担。


  // ── 5. 窄屏几何：设置页在 390 宽下不横向溢出 ────────────────────────────
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
  check('390 宽下字段改为单列堆叠', narrow.singleColumn === true);
  check('390 宽下动作栏仍在（保存 / 清除可触达）', narrow.footVisible === true);
  if (WANT_SHOTS) await shot('settings-390.png');

  // ── 6. 暗色 ────────────────────────────────────────────────────────────
  await goto('settings', 1280, 820, true);
  if (WANT_SHOTS) await shot('settings-dark-1280.png');

  await evalJs(`(() => { try { localStorage.removeItem('todogui.aiFallback'); } catch (e) {} return true; })()`);
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
