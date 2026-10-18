#!/usr/bin/env node
/**
 * cdp-capture.mjs — 从一个已通过 --remote-debugging-port 暴露 CDP 的 Chromium 实例采集 UI 证据。
 * 零依赖：Node >= 22 自带全局 WebSocket + fetch。
 *
 * 用法：
 *   node tools/cdp-capture.mjs --name E-welcome-dark            # 截图 + DOM 树 + 令牌表
 *   node tools/cdp-capture.mjs --press F1                       # 向页面注入按键，然后采集
 *   node tools/cdp-capture.mjs --match solo --name E-solo-dark  # 指定目标（按 url/title 子串）
 *   node tools/cdp-capture.mjs --eval-file probe.js --name E-x  # 自定义求值
 *
 * 输出：evidence/<name>.png / <name>.dom.json / <name>.tokens.json / <name>.eval.json
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'evidence');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }
const PORT = Number(arg('port', process.env.TRAE_CDP_PORT || 9333));
const NAME = arg('name', `shot-${Date.now()}`);
const MATCH = arg('match', '');
const PRESS = arg('press', '');
const CLICK = arg('click-text', '');
const EVAL_FILE = arg('eval-file', '');
const MAX_NODES = Number(arg('max-nodes', 1400));
const MAX_DEPTH = Number(arg('max-depth', 9));

mkdirSync(OUT_DIR, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- 1. 选目标 ----------
const targets = await (await fetch(`${BASE}/json/list`)).json();
if (!targets.length) fail('目标列表为空：窗口可能尚未注册 page target，先跑 trae-cdp.ps1 status');
const wanted = targets.filter(t => (!MATCH || ((t.url || '') + (t.title || '')).toLowerCase().includes(MATCH.toLowerCase())));
const ranked = wanted.sort((a, b) => {
  const score = t => (t.type === 'page' ? 0 : t.type === 'webview' ? 1 : t.type === 'iframe' ? 2 : 3);
  return score(a) - score(b);
});
const target = ranked[0];
if (!target) fail(`没有匹配 "${MATCH}" 的目标；现有：` + targets.map(t => `${t.type}:${t.title || t.url}`).join(' | '));
if (!target.webSocketDebuggerUrl) fail(`目标 ${target.type} 无 webSocketDebuggerUrl`);
console.log(`TARGET type=${target.type} title=${target.title} url=${(target.url || '').slice(0, 120)}`);

// ---------- 2. CDP 客户端 ----------
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', e => rej(new Error('WS 连接失败: ' + (e.message || e.type))), { once: true });
});
let mid = 0;
const pend = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
function send(method, params = {}) {
  const id = ++mid;
  return new Promise((res, rej) => {
    pend.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error(`${method} 超时`)); } }, 20000);
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面内求值异常: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
  return r.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

// 怀疑点：非前台窗口会丢弃注入的输入事件。Page.bringToFront 是 CDP 自带的抬窗手段。
if (hasFlag('front')) {
  try { await send('Page.bringToFront'); console.log('FRONT=OK'); await new Promise(r => setTimeout(r, 600)); }
  catch (e) { console.log('FRONT=FAIL ' + e.message); }
}

// 注入前求值：用于在页面里先装好监听器，再触发按键/点击
if (arg('pre-eval-file', '')) {
  const expr = readFileSync(resolve(HERE, arg('pre-eval-file', '')), 'utf8');
  console.log('PRE=' + JSON.stringify(await evaluate(`(${expr})()`)));
}

// windowsVirtualKeyCode 必须是 Windows VK 码，不是字符 ASCII 码：
// 字母恰好相等（P=80=VK_P）所以之前没暴露，标点则全错（` 是 192 不是 96，, 是 188 不是 44）。
// code 必须是 UI Events 的 KeyboardEvent.code 规范名。
const PUNCT_VK = {
  '`': ['Backquote', 192], '-': ['Minus', 189], '=': ['Equal', 187],
  '[': ['BracketLeft', 219], ']': ['BracketRight', 221], '\\': ['Backslash', 220],
  ';': ['Semicolon', 186], "'": ['Quote', 222], ',': ['Comma', 188],
  '.': ['Period', 190], '/': ['Slash', 191],
};
const NAMED_VK = { Escape: 27, Enter: 13, Tab: 9, Backspace: 8, Space: 32, Delete: 46, F1: 112 };
function keySpec(raw) {
  if (NAMED_VK[raw] !== undefined) return { key: raw, code: raw, vk: NAMED_VK[raw] };
  if (PUNCT_VK[raw]) return { key: raw, code: PUNCT_VK[raw][0], vk: PUNCT_VK[raw][1] };
  if (/^[a-z]$/i.test(raw)) return { key: raw, code: 'Key' + raw.toUpperCase(), vk: raw.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(raw)) return { key: raw, code: 'Digit' + raw, vk: raw.charCodeAt(0) };
  return { key: raw, code: raw, vk: raw.toUpperCase().charCodeAt(0) };
}
function pageFindText(needle) {
  const els = Array.prototype.slice.call(document.querySelectorAll('body *'));
  const cands = [];
  for (const e of els) {
    const t = (e.textContent || '').trim();
    if (!t || t.length > 120) continue;
    if (t !== needle && !t.includes(needle)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    cands.push({ e, area: r.width * r.height, r });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.area - b.area);
  const hit = cands[0];
  hit.e.scrollIntoView({ block: 'center', inline: 'center' });
  const r = hit.e.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: hit.e.tagName.toLowerCase(), text: (hit.e.textContent || '').trim().slice(0, 40) };
}

async function clickText(needle) {
  const hit = await evaluate(`(${pageFindText.toString()})(${JSON.stringify(needle)})`);
  if (!hit) throw new Error(`页面上找不到文案「${needle}」`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: hit.x, y: hit.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
  console.log(`CLICK=${needle} -> ${hit.tag}@${Math.round(hit.x)},${Math.round(hit.y)} "${hit.text}"`);
  await new Promise(r => setTimeout(r, Number(arg('settle', 1500))));
}

// ---------- 3. 可选：注入按键/点击以进入目标状态 ----------
if (PRESS) {
  for (const one of PRESS.split('|')) {
    const combos = one.split('+');
    const modifiers = combos.slice(0, -1).map(k => ({ Control: 2, Alt: 1, Shift: 8, Meta: 4 }[k])).filter(Boolean)
      .reduce((a, b) => a | b, 0);
    const spec = keySpec(combos[combos.length - 1]);
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type, key: spec.key, code: spec.code,
        windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk, modifiers,
      });
    }
    console.log(`PRESS=${one} -> code=${spec.code} vk=${spec.vk} mods=${modifiers}`);
    await new Promise(r => setTimeout(r, Number(arg('settle', 1200))));
  }
}
if (CLICK) for (const c of CLICK.split('|')) {
  try { await clickText(c); } catch (e) { console.log('CLICK=MISS ' + e.message); }
}

// ---------- 4. 截图 ----------
let shotOk = false;
try {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, `${NAME}.png`), Buffer.from(data, 'base64'));
  shotOk = true;
  console.log(`SHOT=OK ${NAME}.png ${(data.length / 1024 | 0)}KB(b64)`);
} catch (e) { console.log('SHOT=FAIL ' + e.message); }

// 页面侧采集函数：只通过 .toString() 序列化后在渲染进程里执行，Node 侧永不调用。
// 任何 Node 作用域变量都必须当参数传进去，否则页面里是 undefined。
function pageCollectTree(maxNodes, maxDepth) {
  const STYLE_KEYS = ['display', 'position', 'flexDirection', 'alignItems', 'justifyContent',
    'width', 'height', 'padding', 'margin', 'gap', 'backgroundColor', 'color', 'fontSize',
    'fontWeight', 'lineHeight', 'borderRadius', 'borderTopWidth', 'borderColor', 'zIndex',
    'boxShadow', 'opacity', 'overflow', 'fontFamily', 'cursor', 'transition'];
  const budget = { n: 0, max: maxNodes, maxDepth: maxDepth };
  const root = document.body || document.documentElement;
  function vis(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01;
  }
  function walk(el, depth) {
    if (budget.n >= budget.max || depth > budget.maxDepth) return null;
    if (!(el instanceof Element)) return null;
    if (!el.matches('script,style,link,meta') && !vis(el)) return null;
    budget.n++;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const node = {
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/).slice(0, 4).join(' ') : '',
      id: el.id || '',
      role: el.getAttribute('role') || '',
      aria: el.getAttribute('aria-label') || '',
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      st: Object.fromEntries(STYLE_KEYS.map(k => [k, s[k]])),
      text: '',
      kids: [],
    };
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { const t = c.nodeValue.trim(); if (t) node.text = (node.text + ' ' + t).trim().slice(0, 90); }
    }
    for (const c of el.children) { const k = walk(c, depth + 1); if (k) node.kids.push(k); }
    return node;
  }
  return {
    tree: walk(root, 0),
    visited: budget.n,
    meta: {
      title: document.title, url: location.href,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      bodyClass: document.body ? document.body.className : '',
      dataTheme: document.documentElement.getAttribute('data-vscode-theme-name')
        || document.documentElement.getAttribute('data-theme') || '',
    },
  };
}

function pageCollectVars() {
  const cs = getComputedStyle(document.documentElement);
  const vars = {};
  for (const k of cs) { if (k.startsWith('--')) { const v = cs.getPropertyValue(k).trim(); if (v) vars[k] = v; } }
  const palette = {};
  for (const k of Object.keys(vars)) {
    const m = k.match(/^--vscode-(.+?)-(foreground|background|border)$/);
    if (m) { if (!palette[m[1]]) palette[m[1]] = {}; palette[m[1]][m[2]] = vars[k]; }
  }
  // 主题判定：Trae 把主题写在 body.class（vs-dark / vs / theme-icube），
  // 不是 data-vscode-theme-name —— 读错属性会得到「未暴露」的假结论。
  const bc = document.body ? document.body.className : '';
  const tm = bc.match(/vs-(dark|light|hcblack|hcwhite)/) || (bc.match(/\bvs\b/) ? ['vs', 'light'] : null);
  return {
    count: Object.keys(vars).length, vars, palette,
    bodyClass: bc,
    theme: tm ? ('vs-' + (tm[1] || 'light')) : (document.documentElement.getAttribute('data-vscode-theme-name') || ''),
    themeKind: document.documentElement.getAttribute('data-vscode-theme-kind') || '',
    icubeTheme: /theme-icube/.test(bc),
  };
}

// ---------- 5. DOM 结构树（含可见盒与关键样式） ----------
let tree = null;
try {
  tree = await evaluate(`(${pageCollectTree.toString()})(${MAX_NODES}, ${MAX_DEPTH})`);
  writeFileSync(join(OUT_DIR, `${NAME}.dom.json`), JSON.stringify(tree, null, 1));
  console.log(`DOM=OK ${NAME}.dom.json nodes=${tree.visited} title=${tree.meta.title}`);
} catch (e) { console.log('DOM=FAIL ' + e.message); }

// ---------- 6. 设计令牌（CSS 自定义属性表 + 主题名） ----------
try {
  const t = await evaluate(`(${pageCollectVars.toString()})()`);
  writeFileSync(join(OUT_DIR, `${NAME}.tokens.json`), JSON.stringify(t, null, 1));
  console.log(`TOKENS=OK ${NAME}.tokens.json count=${t.count} theme=${t.theme || '(未暴露)'}`);
} catch (e) { console.log('TOKENS=FAIL ' + e.message); }

// ---------- 7. 可选自定义求值 ----------
if (EVAL_FILE) {
  const expr = readFileSync(resolve(HERE, EVAL_FILE), 'utf8');
  try {
    const v = await evaluate(`(${expr})()`);
    writeFileSync(join(OUT_DIR, `${NAME}.eval.json`), JSON.stringify(v, null, 1));
    console.log(`EVAL=OK ${NAME}.eval.json`);
  } catch (e) { console.log('EVAL=FAIL ' + e.message); }
}

ws.close();
if (!shotOk && !tree) process.exit(2);

function fail(msg) { console.error('FATAL: ' + msg); ws.close(); process.exit(1); }
