#!/usr/bin/env node
/**
 * probe-input.mjs — 一次性诊断：CDP 注入的键盘/鼠标事件到底有没有进到 workbench 的 DOM。
 * 对照组：鼠标点击（引导页已证明可生效）。实验组：3 种按键事件变体。
 */
const PORT = Number(process.env.TRAE_CDP_PORT || 9333);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find(x => x.type === 'page' && (x.url || '').includes('workbench.html'));
if (!t) { console.error('NO_WORKBENCH_TARGET'); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws fail')), { once: true }); });
let mid = 0; const pend = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++mid; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error(method + ' timeout')); } }, 15000); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: `(${expr})()`, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const settle = ms => new Promise(r => setTimeout(r, ms));

await send('Runtime.enable');

// 1) 先看活动栏有什么可点的东西 + 装监听器
console.log('ACTIVITY=' + JSON.stringify(await ev(`() => Array.from(document.querySelectorAll('.activitybar .action-label')).map(e => e.getAttribute('aria-label') || e.title || e.className).slice(0, 12)`)));
console.log('SETUP=' + await ev(`() => {
  window.__ev = { key: [], mouse: [], click: [] };
  addEventListener('keydown', e => window.__ev.key.push(e.type + ':' + e.key + '/' + e.code + '/kc' + e.keyCode + '/ctrl' + e.ctrlKey + '/shift' + e.shiftKey), true);
  addEventListener('mousedown', e => window.__ev.mouse.push(e.target.tagName + '.' + String(e.target.className).slice(0, 30)), true);
  addEventListener('click', e => window.__ev.click.push(e.target.tagName + '.' + String(e.target.className).slice(0, 30)), true);
  return 'ok';
}`));

const dump = async label => console.log(`AFTER ${label}: ` + JSON.stringify(await ev(`() => ({ key: window.__ev.key.length, keyLast: window.__ev.key.slice(-2), mouse: window.__ev.mouse.length, click: window.__ev.click.length })`)));

// 2) 变体 A：keyDown + keyUp（当前 cdp-capture 的实现）
for (const type of ['keyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', { type, key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 10 });
}
await settle(700); await dump('A keyDown/keyUp');

// 3) 变体 B：rawKeyDown + char + keyUp（Chromium 完整按键链）
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 10 });
await send('Input.dispatchKeyEvent', { type: 'char', text: 'P', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 10 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 10 });
await settle(700); await dump('B rawKeyDown/char/keyUp');

// 4) 变体 C：keyDown 带 text 字段
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', text: 'P', windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 10 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 10 });
await settle(700); await dump('C keyDown+text');

// 5) 对照组：鼠标点击活动栏「搜索」图标
const hit = await ev(`() => {
  const els = Array.from(document.querySelectorAll('.activitybar .action-label, .activitybar .action-item > a'));
  const e = els.find(x => (x.getAttribute('aria-label') || x.title || '').includes('搜索')) || els[1];
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: e.getAttribute('aria-label') || e.title || e.className };
}`);
if (!hit) { console.log('MOUSE=NO_TARGET'); }
else {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: hit.x, y: hit.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
  }
  await settle(1200);
  console.log(`MOUSE target=${hit.label} @${Math.round(hit.x)},${Math.round(hit.y)}`);
  await dump('D mouse-click');
  console.log('SIDE_PANEL=' + JSON.stringify(await ev(`() => {
    const p = document.querySelector('.composite.part.panel') || document.querySelector('.search-view') || document.querySelector('.monaco-workbench .part.sidebar');
    return { exists: !!p, cls: p ? String(p.className).slice(0, 60) : '', text: p ? (p.innerText || '').trim().slice(0, 60) : '' };
  }`)));
}
ws.close();
