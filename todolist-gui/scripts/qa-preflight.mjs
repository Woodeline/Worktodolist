#!/usr/bin/env node
// 三个 CDP 门禁（qa-responsive / qa-settings / qa-tools）的共同前置（R-11 / R-42）。
//
// 抽出来的原因有两条，都是踩过的坑：
//   1. **端口有三份真相源**：`vite.config.js` 的 DEV_PORT、`tauri.conf.json` 的 devUrl、
//      以及每个脚本自己写死的字符串。改端口时漏改一处，门禁就连到别的进程（或者连不上），
//      然后被读成「环境没起」——一个假绿比没有门禁更糟。现在只有一条真相源：
//      读源码正则解析 `vite.config.js`，解析不出来就 **fail-loud**（抛错），
//      **绝不回落到 15180**。
//   2. **浏览器探测只有 Windows 路径**：`EDGE_CANDIDATES` 里没有 macOS 的
//      `/Applications/...`，于是 macOS 上三个门禁全都死在「找不到 Edge」。
//
// 为什么不用 `import('../vite.config.js')`：ESM import 会连带加载 vite 与
// @vitejs/plugin-react，而那份 config 在 `VITEST` 分支里还会 `mkdirSync('.tmp')` ——
// 一个只想读端口的门禁不该有这些副作用。读源码正则就够了。
//
// 退出码语义（R-42，三个脚本共用）：
//   * `EXIT_ENV`  = 2 —— 环境未就绪（dev server 没起 / 找不到浏览器 / 端口解析失败）
//   * `EXIT_FAIL` = 1 —— 断言失败（页面上确实不对）
//   * `EXIT_OK`   = 0 —— 全绿
//
// 用法（脚本内）：
//   import { EXIT_ENV, EXIT_FAIL, resolveDevPort, resolveBase, requireBrowser, ensureServer } from './qa-preflight.mjs';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { devPortOf } from '../src/lib/gateContracts.js';

/** 环境未就绪：dev server 没起、找不到浏览器、端口解析失败。 */
export const EXIT_ENV = 2;
/** 断言失败：门禁真的发现了问题。 */
export const EXIT_FAIL = 1;
/** 全绿。 */
export const EXIT_OK = 0;

/** `todolist-gui/` 目录。 */
export const GUI_ROOT = path.resolve(import.meta.dirname, '..');
const VITE_CONFIG_PATH = path.join(GUI_ROOT, 'vite.config.js');

/**
 * 从 `vite.config.js` 解析开发端口（唯一真相源）。
 *
 * @param {string} [viteSource] 源码文本；省略时读磁盘上的 `vite.config.js`
 * @returns {number} 端口号
 * @throws {Error} 解析失败（带 `exitCode = EXIT_ENV`），**不回落默认端口**
 */
export function resolveDevPort(viteSource) {
  let source = viteSource;
  if (source === undefined) {
    try {
      source = readFileSync(VITE_CONFIG_PATH, 'utf8');
    } catch (err) {
      const e = new Error(`读不到 ${VITE_CONFIG_PATH}：${err.message || err}`);
      e.exitCode = EXIT_ENV;
      throw e;
    }
  }
  const port = devPortOf(source);
  if (port === null) {
    const e = new Error(
      'vite.config.js 里解析不到端口（期望 `const DEV_PORT = <数字>;` 或 `port: <数字>`）。\n' +
        '  端口只有这一条真相源，门禁不做回落 —— 请先在 vite.config.js 里声明 DEV_PORT。'
    );
    e.exitCode = EXIT_ENV;
    throw e;
  }
  return port;
}

/**
 * 门禁要访问的 BASE。
 *
 * `SG_BASE` 优先（历史脚本与手工调试都靠它把门禁指到别的实例上）；
 * 否则用解析出来的端口拼 `http://localhost:<port>`。
 *
 * @param {number} [port] 省略时调 {@link resolveDevPort}
 * @returns {string} 不带尾斜杠的 base
 */
export function resolveBase(port) {
  const override = (process.env.SG_BASE || '').trim();
  if (override) return override.replace(/\/+$/, '');
  const resolved = port === undefined ? resolveDevPort() : port;
  return `http://localhost:${resolved}`;
}

/**
 * 常见浏览器可执行文件路径。**必须同时覆盖 Windows 与 macOS** ——
 * 原来三个脚本只列 Windows 路径，这正是 macOS 上门禁全红的直接原因。
 *
 * @type {string[]}
 */
export const BROWSER_CANDIDATES = [
  // Windows（Edge 随系统装，Chrome 是常见补充）
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  // macOS
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Linux
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/**
 * 找浏览器。`EDGE` 环境变量优先（可指向任意 Chromium 内核可执行文件）。
 *
 * @returns {string|null} 找到返回绝对路径，找不到返回 null
 */
export function findBrowser() {
  const env = (process.env.EDGE || '').trim();
  if (env) {
    // 环境变量显式指定却不存在时仍然返回它 —— 让后面的 spawn 报出真实原因，
    // 比在这里静默退回自动探测更容易排查。
    return env;
  }
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 同 {@link findBrowser}，但找不到就抛错（`exitCode = EXIT_ENV`）。
 *
 * @returns {string}
 */
export function requireBrowser() {
  const found = findBrowser();
  if (found) return found;
  const e = new Error(
    '找不到 Edge/Chrome 可执行文件：请设置 EDGE 环境变量，或在 qa-preflight.mjs 的\n' +
      '  BROWSER_CANDIDATES 里补一条你机器上的路径。'
  );
  e.exitCode = EXIT_ENV;
  throw e;
}

/**
 * 确认 dev server 在跑（拿 styleguide.html 探一次）。
 *
 * 失败时抛错并带 `exitCode = EXIT_ENV`：**「服务器没起」不是断言失败**，
 * 两者的退出码必须区分开，否则 CI 里看不出是人没起服务还是页面真的坏了。
 *
 * @param {string} base 由 {@link resolveBase} 给出
 * @returns {Promise<true>}
 */
export async function ensureServer(base) {
  try {
    const res = await fetch(`${base}/styleguide.html`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    const e = new Error(
      `连不上 ${base} —— 请先另开终端跑 npm run dev\n  (${err.message || err})`
    );
    e.exitCode = EXIT_ENV;
    throw e;
  }
}

/**
 * 门禁脚本的统一收尾：按 `err.exitCode` 决定退出码，缺省按断言失败处理。
 *
 * @param {unknown} err
 * @returns {never}
 */
export function exitWithError(err) {
  const message = err && err.message ? err.message : String(err);
  const code = err && Number.isInteger(err.exitCode) ? err.exitCode : EXIT_FAIL;
  console.error('✗ ' + message);
  process.exit(code);
}
