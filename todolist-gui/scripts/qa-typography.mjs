#!/usr/bin/env node
// 字体排版契约（2026-11-10，A + B 组合落地后新增）。
//
// 为什么需要它：改字体令牌 / 字阶 / 字重，qa-css-check（只拦裸色值与裸 px 字号）、
// qa-contrast（只看颜色）、qa-hooks（只看 Hook）全都不拦；过去全仓只有两条例外断言
// —— qa-settings 的 600/500/400 与 qa-responsive 的小屏 21px。字体层因此是自动化
// 约束最薄、最容易反复改乱的一层。这里把「两族 / 三层落差 / 三档字重 / 不放装饰」
// 的口径钉死，防止 11-06 被否的 mono 扩权、宽字距、uppercase 悄悄回流。
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
const chart = readFileSync(path.join(ROOT, 'src/lib/rti/chart.js'), 'utf8');
const sg = readFileSync(path.join(ROOT, 'src/styleguide.jsx'), 'utf8');

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: Boolean(cond) });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${extra}`}`);
}

const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rootBlock = (clean.match(/:root\s*\{([\s\S]*?)\}/) || [, ''])[1];
const darkBlock = (clean.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/) || [, ''])[1];
const tokenValue = (name, src = rootBlock) => {
  const m = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(src);
  return m ? m[1].trim() : null;
};

/** 粗略规则块解析：只用于「哪条选择器带了 600 / 分组名用了什么色」这类静态核对。 */
function blocks() {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const sel = m[1].trim().split('\n').pop().trim();
    out.push({ sel, body: m[2] });
  }
  return out;
}
const RULES = blocks();
const ruleFor = (sel) => RULES.find((r) => r.sel === sel);

console.log('\n[typography] 字体排版契约');

// ── 1. 两族口径 ───────────────────────────────────────────────────────────
check('--font-ui / --font-mono / --font-mono-cjk 都在令牌层定义',
  ['font-ui', 'font-mono', 'font-mono-cjk'].every((n) => tokenValue(n) !== null),
  ['font-ui', 'font-mono', 'font-mono-cjk'].map((n) => `${n}=${tokenValue(n)}`).join(' '));
check('空壳别名 --font-display / --font-body 已删除',
  tokenValue('font-display') === null && tokenValue('font-body') === null);
check('全仓不再引用 var(--font-display) / var(--font-body)',
  !css.includes('var(--font-display)') && !css.includes('var(--font-body)')
  && !sg.includes('var(--font-display)') && !sg.includes('var(--font-body)'));
check('中文刻度族带中文字体回退（mono 栈本身不含中文）',
  /PingFang SC|Microsoft YaHei/.test(tokenValue('font-mono-cjk') || ''),
  tokenValue('font-mono-cjk'));
check('暗色不另设字体族（明暗字形必须一致）',
  !/--font-/.test(darkBlock));
check('body 统一 tabular-nums',
  /font-variant-numeric:\s*tabular-nums/.test(ruleFor('body')?.body || ''),
  ruleFor('body')?.body.slice(0, 200));

// ── 2. 字阶与字重令牌 ─────────────────────────────────────────────────────
const SCALE = {
  'fs-2xs': '11px', 'fs-xs': '12px', 'fs-sm': '13px', 'fs-md': '14px',
  'fs-lg': '16px', 'fs-xl': '20px', 'fs-2xl': '24px', 'fs-3xl': '32px',
};
check('8 档基础字阶数值冻结（改它们要单开一轮、并同步 38 档响应式）',
  Object.entries(SCALE).every(([n, v]) => tokenValue(n) === v),
  Object.entries(SCALE).map(([n, v]) => `${n}=${tokenValue(n)}(期望${v})`).join(' '));
check('页面主标题档 --fs-display = 22px', tokenValue('fs-display') === '22px', tokenValue('fs-display'));
check('字重三档语义令牌 = 400 / 500 / 600',
  tokenValue('fw-body') === '400' && tokenValue('fw-emph') === '500' && tokenValue('fw-title') === '600',
  [tokenValue('fw-body'), tokenValue('fw-emph'), tokenValue('fw-title')].join('/'));
check('小屏 --fs-2xl 覆盖仍是 21px（qa-responsive 的另一半契约）',
  /--fs-2xl:\s*21px/.test(clean));

// ── 3. 三层落差真的落到选择器上 ───────────────────────────────────────────
check('独立页头用 --fs-display（设置 / 工具墙 / 对话空态）',
  ['.settings-title', '.tools-wall-title', '.chat-empty-title']
    .every((s) => /font-size:\s*var\(--fs-display\)/.test(ruleFor(s)?.body || '')));
check('36px 上下文条主段用 --fs-lg（不硬顶 22px 撑破骨架）',
  /font-size:\s*var\(--fs-lg\)/.test(ruleFor('.crumb b')?.body || ''),
  ruleFor('.crumb b')?.body.slice(0, 160));
check('分组名是 11px mono 刻度标签，且不用 --muted',
  ['.sidebar-group-name', '.group-title'].every((s) => {
    const b = ruleFor(s)?.body || '';
    return /--fs-2xs/.test(b) && /--font-mono-cjk/.test(b)
      && /color:\s*var\(--text-2\)/.test(b) && !b.includes('--muted');
  }));
check('日历月标题已清掉 mono + 宽字距',
  /font-family:\s*var\(--font-ui\)/.test(ruleFor('.cal-month')?.body || '')
  && !/letter-spacing/.test(ruleFor('.cal-month')?.body || ''));

// ── 4. 装饰手法不得回流 ───────────────────────────────────────────────────
// 注意：不能用负向前瞻排除 `letter-spacing: 0;` —— 正则回溯会把 `\s*` 退到
// 0 长度，从而把「重置为 0」当成非零字距误报。逐条取值判断才可靠。
const spacings = [...clean.matchAll(/letter-spacing:\s*([^;]+);/g)].map((m) => m[1].trim());
const wideSpacing = spacings.filter((v) => v !== '0');
check('产品样式里没有 uppercase / italic / 非零字距（0 是重置，放行）',
  !/text-transform:\s*uppercase/.test(clean)
  && !/font-style:\s*italic/.test(clean)
  && wideSpacing.length === 0, JSON.stringify(wideSpacing));
check('产品样式里没有 @font-face / webfont / system-ui',
  !/@font-face|@import\s+url|system-ui\s*[,;)]/.test(clean));

// ── 5. 600 只许出现在白名单 ───────────────────────────────────────────────
// 白名单 = 页头 / 弹窗标题 / 状态强调 / 读数 b / 四档徽章高档。
// 其它小标签、选中态、内联强调一律降到 --fw-emph(500)。
const WEIGHT_600_OK = new Set([
  '.chip-priority.prio-high', '.prio-badge.prio-high',
  '.cal-month', '.cal-stats b', '.cal-cell.is-today .cal-daynum', '.cal-day-head b',
  '.chat-empty-title', '.snapshot-due.overdue', '.drawer-header h3', '.settings-title',
  '.tools-wall-title', '.tool-title', '.modal-card h3', '.tool-crash-title', '.app-crash-title',
]);
const heavy = RULES.filter((r) => /font-weight:\s*(600|var\(--fw-title\))/.test(r.body));
const offenders = heavy.filter((r) => !WEIGHT_600_OK.has(r.sel)).map((r) => r.sel);
check(`600 / --fw-title 只出现在 ${WEIGHT_600_OK.size} 个白名单选择器`,
  offenders.length === 0 && heavy.length > 0,
  `越界=${JSON.stringify(offenders)} 命中=${heavy.length}`);

// ── 6. 画布与样式指南跟随令牌 ─────────────────────────────────────────────
check('chart.js 不再硬编码字号 / bold（刻度跟着 --fs-* 走）',
  !/fnt\(pal,\s*\d/.test(chart) && !/fnt\([^)]*'bold'/.test(chart)
  && !/const labelFont = \d/.test(chart)
  && /fs2xs:\s*parseFloat\(token\('--fs-2xs'\)\)/.test(chart));
check('样式指南字阶表读令牌，不再写死 19px',
  !sg.includes("'19px'") && /v\(`fs-\$\{name\}`\)|v\(`fs-/.test(sg));

const failed = results.filter((r) => !r.ok);
console.log(`\n[typography] ${results.length - failed.length}/${results.length} 通过${failed.length ? '，存在不通过项' : '，全部通过'}`);
if (failed.length) process.exit(1);
