#!/usr/bin/env node
/**
 * 对比度实测 —— 直接解析 index.css 里的令牌，按 WCAG 2.1 计算真实对比度。
 *
 * 为什么要有这个脚本：对比度必须"实测而非目测"。改了令牌值以后，
 * 靠肉眼看截图很容易放过 4.2:1 这种"感觉还行"但其实不合格的搭配。
 *
 * 阈值（WCAG 2.1）：
 *   正文 / 小字   ≥ 4.5:1   (AA)
 *   大字(≥18.66px粗体 或 ≥24px) ≥ 3:1
 *   界面控件与图形边界 ≥ 3:1
 *
 * 用法：node scripts/qa-contrast.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, '..', 'src', 'index.css');
const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function parseTokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

const lightMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
if (!lightMatch) {
  console.error('[contrast] 没找到 :root 令牌块');
  process.exit(1);
}
const darkMatch = css.match(/prefers-color-scheme:\s*dark\s*\)\s*\{\s*:root\s*\{([\s\S]*?)\}/);

const themes = {
  '明色 (light)': parseTokens(lightMatch[1]),
  '暗色 (dark) ': darkMatch ? { ...parseTokens(lightMatch[1]), ...parseTokens(darkMatch[1]) } : null,
};

// ---------- 颜色解析与 WCAG 计算 ----------
function toRgb(value) {
  const hex = value.trim();
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- 需要校验的真实搭配（fg 令牌, bg 令牌, 阈值, 说明） ----------
const PAIRS = [
  ['text', 'surface', 4.5, '正文 / 卡片'],
  ['text', 'bg', 4.5, '正文 / 页面底'],
  ['text-2', 'surface', 4.5, '次级正文 / 卡片'],
  ['text-2', 'bg', 4.5, '次级正文 / 页面底'],
  ['text-2', 'surface-2', 4.5, '次级正文 / 次级填充'],
  ['muted', 'surface', 4.5, '弱化文字 / 卡片'],
  ['muted', 'bg', 4.5, '弱化文字 / 页面底'],
  ['muted', 'surface-2', 4.5, '弱化文字 / 次级填充'],
  ['accent', 'surface', 4.5, '强调文字 / 卡片'],
  ['accent', 'bg', 4.5, '强调文字 / 页面底'],
  ['accent', 'accent-soft', 4.5, '强调文字 / 强调浅底'],
  ['accent-fg', 'accent', 4.5, '主按钮文字 / 主按钮底'],
  ['danger', 'surface', 4.5, '危险文字 / 卡片'],
  ['danger', 'danger-soft', 4.5, '危险文字 / 危险浅底'],
  ['warn', 'warn-soft', 4.5, '警告文字 / 警告浅底'],
  ['warn', 'surface', 4.5, '警告文字 / 卡片'],
  ['ok', 'ok-soft', 4.5, '成功文字 / 成功浅底'],
  ['ok', 'surface', 4.5, '成功文字 / 卡片'],
  ['mark-fg', 'mark-bg', 4.5, '搜索高亮文字 / 高亮底'],
  // 界面控件边界：WCAG 1.4.11 要求 ≥3:1（复选框/输入框/按钮的"存在"靠它表达）
  ['control-line', 'surface', 3, '控件描边 / 卡片'],
  ['control-line', 'bg', 3, '控件描边 / 页面底'],
  ['accent', 'surface', 3, '焦点环 / 卡片'],
  // 图表（RTI 工具）：画布底 = --surface，全部在画布里画，不继承 CSS 颜色
  // 文字类（刻度 / 轴标题 / 标注）按正文阈值；线条与数据点按图形对象阈值 ≥3:1
  ['chart-axis', 'surface', 4.5, '图表刻度文字 / 画布'],
  ['chart-thr-ink', 'surface', 4.5, '阈值线标注 / 画布'],
  ['chart-warn', 'surface', 4.5, '外推点标注 / 画布'],
  ['chart-frame', 'surface', 3, '坐标轴 / 画布'],
  ['chart-thr', 'surface', 3, '阈值线 / 画布'],
  ['chart-1', 'surface', 3, '系列 1 / 画布'],
  ['chart-2', 'surface', 3, '系列 2 / 画布'],
  ['chart-3', 'surface', 3, '系列 3 / 画布'],
  ['chart-4', 'surface', 3, '系列 4 / 画布'],
  ['chart-5', 'surface', 3, '系列 5 / 画布'],
  ['chart-6', 'surface', 3, '系列 6 / 画布'],
  ['chart-7', 'surface', 3, '系列 7 / 画布'],
  ['chart-8', 'surface', 3, '系列 8 / 画布'],
];

// 装饰性发丝线：只划区域、不承担"控件是否存在"的信息，WCAG 无硬性要求。
// 仍然打印数值，避免改令牌时把它压成完全不可见。
const REFERENCE = [
  ['border', 'surface', '发丝线 / 卡片'],
  ['border', 'bg', '发丝线 / 页面底'],
  ['border-strong', 'surface', '次级发丝线 / 卡片'],
  ['border-strong', 'bg', '次级发丝线 / 页面底'],
  ['chart-grid', 'surface', '图表网格线 / 画布（纯装饰，须远弱于数据）'],
];

let failures = 0;
let checks = 0;

for (const [themeName, tokens] of Object.entries(themes)) {
  if (!tokens) continue;
  console.log(`\n=== ${themeName} ===`);
  for (const [fgName, bgName, min, label] of PAIRS) {
    const fg = toRgb(tokens[fgName] || '');
    const bg = toRgb(tokens[bgName] || '');
    if (!fg || !bg) {
      console.log(`  ?  ${label}  (令牌缺失: --${fgName} / --${bgName})`);
      failures++;
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= min;
    checks++;
    if (!ok) failures++;
    console.log(
      `  ${ok ? '✓' : '✗'}  ${r.toFixed(2).padStart(5)}:1  (需 ≥${min})  ${label}   --${fgName} on --${bgName}`
    );
  }
}

console.log('\n--- 装饰性线条（参考值，不设阈值） ---');
for (const [themeName, tokens] of Object.entries(themes)) {
  if (!tokens) continue;
  for (const [fgName, bgName, label] of REFERENCE) {
    const fg = toRgb(tokens[fgName] || '');
    const bg = toRgb(tokens[bgName] || '');
    if (!fg || !bg) continue;
    console.log(
      `      ${ratio(fg, bg).toFixed(2).padStart(5)}:1  ${label}   --${fgName} on --${bgName}   [${themeName.trim()}]`
    );
  }
}

console.log(`\n共校验 ${checks} 组，失败 ${failures} 组。`);
if (failures) {
  console.error('[contrast] 不通过：存在低于阈值的搭配。');
  process.exit(1);
}
console.log('[contrast] ✓ 全部通过（WCAG 2.1 AA）');
