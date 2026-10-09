// QA 静态检查：抓取所有 jsx 中的 className 令牌，与样式表里的类选择器对比。
//
// 契约：JSX 里用到的类名必须在样式表里有定义，否则样式会静默失效。
// 样式来源有两处：src/index.css（产品样式）+ 根目录各 *.html 内联 <style>
// （styleguide.html 的 .sg-* 外壳样式刻意不放进产品样式表，但类名契约同样成立）。
//
// 已知的两类误报（本版已修，历史版本会各报 6 个 / 2 个假阳性）：
//   1. 三元与短路表达式里的「取值」被当成类名：
//        tab === 'chat' ? ' active' : ''      → 'chat' 是值，' active' 才是类
//        tool-${tool.status || 'running'}      → 'running' 是值，不是类
//      规则：紧跟 === / == / != / !== / || / && 的字符串跳过。
//   2. CSS 侧把 url(...) 里的网址当选择器：
//        url("data:image/svg+xml,...http://www.w3.org/2000/svg...")
//      会解析出 .org / .w3。规则：扫描前先剥掉 url(...) 内容。
import { readFileSync, globSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'src');
const projRoot = path.resolve(root, '..');
const jsxFiles = globSync('**/*.jsx', { cwd: root }).map((f) => `${root}/${f}`);

// 引号紧跟在比较/短路运算符之后 = 这是个取值，不是类名
const VALUE_POSITION = /(===|!==|==|!=|\|\||&&)\s*$/;

const candidates = new Set();
const addTokens = (s) =>
  s.split(/\s+/).forEach((t) => {
    t = t.trim();
    if (t) candidates.add(t);
  });

// 从一段 className 表达式里取字符串字面量，跳过取值位置的字符串
const addQuoted = (segment) => {
  for (const q of segment.matchAll(/'([^']*)'/g)) {
    if (VALUE_POSITION.test(segment.slice(0, q.index))) continue;
    addTokens(q[1]);
  }
};

for (const file of jsxFiles) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/className="([^"]*)"/g)) addTokens(m[1]);
  for (const m of src.matchAll(/className=\{`([\s\S]*?)`\}/g)) {
    addQuoted(m[1]); // 模板内三元里的字符串
    addTokens(m[1].replace(/\$\{[^}]*\}/g, ' ')); // 模板静态部分
  }
  for (const m of src.matchAll(/className=\{([^`][\s\S]*?)\}/g)) {
    addQuoted(m[1]); // 数组/三元里的字符串
  }
}

// HTML 里的内联 <style>（样式指南外壳）
const htmlFiles = globSync('*.html', { cwd: projRoot }).map((f) => `${projRoot}/${f}`);
const inlineCss = htmlFiles
  .map((f) => [...readFileSync(f, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n'))
  .join('\n');

// CSS 中定义的类选择器（先剥掉 url(...)，否则 data-URI 里的网址会污染结果）
const rawCss = readFileSync(`${root}/index.css`, 'utf8') + '\n' + inlineCss;
const css = rawCss.replace(/url\((['"]?)[\s\S]*?\1\)/g, 'url()');
const cssClasses = new Set();
for (const m of css.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) cssClasses.add(m[1]);

const dynamic = [...candidates].filter((c) => c.endsWith('-'));
const missing = [...candidates].filter((c) => !cssClasses.has(c) && !c.endsWith('-'));

console.log('JSX 中 className 令牌：', [...candidates].sort().join(', '));
console.log('\nCSS 中定义的类：', [...cssClasses].sort().join(', '));
console.log('\n动态前缀(运行时拼接):', dynamic.join(', ') || '(无)');
console.log('\n缺失（JSX 用了但 CSS 未定义）:', missing.join(', ') || '无');

// 动态运行时取值单独核对（这些由 `${...}` 拼出来，静态扫描看不到）
const RUNTIME_VALUES = [
  'dot-ok', 'dot-warn', 'dot-danger',
  'p-A', 'p-B', 'p-C', 'p-other',
  'status-dot-running', 'status-dot-ok', 'status-dot-fail',
  'tool-ok', 'tool-fail', 'tool-running',
  'row-overdue', 'row-readonly', 'priority-none', 'snapshot-prio-none',
];
const runtimeMissing = RUNTIME_VALUES.filter((c) => !cssClasses.has(c));
console.log('\n运行时拼接值缺失:', runtimeMissing.join(', ') || '无');

// 反向：CSS 定义但 JSX 未使用（仅提示，不算失败）
const unused = [...cssClasses].filter((c) => !candidates.has(c) && !RUNTIME_VALUES.includes(c));
console.log('\nCSS 定义但 JSX 未用（提示）:', unused.sort().join(', ') || '无');

let failed = missing.length > 0 || runtimeMissing.length > 0;
if (missing.length > 0 || runtimeMissing.length > 0) {
  console.error('\n[css-check] 不通过：存在未定义的类名，样式会静默失效。');
}

/* ---------------------------------------------------------------------------
   裸值门禁 —— 「类名有定义」只证明样式**存在**，不证明它**守规矩**。
   令牌层的存在意义是"改主题只改这一层"，所以令牌层之外一旦出现

     ① 裸色值： #rgb / #rrggbb / rgb() / rgba() / hsl()
     ② 裸字号： font-size 写成绝对单位（px / pt / rem）

   组件就被钉死在当前主题上了 —— 换主题时这些值不会跟着换。
   相对单位（em / % / inherit）与 var()/calc() 是允许的：它们天然跟随上下文。

   令牌层用节标题自动定位，不写死行号（加了令牌不会让门禁失效）。

   只扫 `src/index.css`：styleguide.html 的内联 .sg-* 是**开发用外壳**，
   刻意自带一套最小样式、不参与产品令牌契约（它连 .sg-nav 都不进产品样式表）。
--------------------------------------------------------------------------- */
const productCss = readFileSync(`${root}/index.css`, 'utf8');
const cssLines = productCss.split(/\r?\n/);
const tokenStart = cssLines.findIndex((l) => l.includes('1 · 令牌层'));
const tokenEnd = cssLines.findIndex((l) => l.includes('2 · 基础层'));
const inTokenLayer = (i) => tokenStart >= 0 && tokenEnd > tokenStart && i > tokenStart && i < tokenEnd;

// 逐行剥离块注释（保留行号），再剥 url(...) —— 否则 data-URI 与注释里的色值会误报
let inComment = false;
const stripped = cssLines.map((line) => {
  let out = '';
  for (let i = 0; i < line.length; i += 1) {
    if (!inComment && line[i] === '/' && line[i + 1] === '*') {
      inComment = true;
      i += 1;
      continue;
    }
    if (inComment && line[i] === '*' && line[i + 1] === '/') {
      inComment = false;
      i += 1;
      continue;
    }
    if (!inComment) out += line[i];
  }
  return out.replace(/url\((['"]?)[\s\S]*?\1\)/g, 'url()');
});

const bareColors = [];
const bareFontSizes = [];
const rawSpacing = [];
stripped.forEach((line, i) => {
  if (inTokenLayer(i)) return; // 令牌层的值就是"裸"的，这里正是它们该待的地方
  const at = i + 1;
  const hex = [...line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  const fn = [...line.matchAll(/\b(?:rgba?|hsla?)\([^)]*\)/g)].map((m) => m[0]);
  if (hex.length || fn.length) bareColors.push(`${at}: ${[...hex, ...fn].join(' ')}`);
  const fs = [...line.matchAll(/font-size\s*:\s*([^;{}]+)/g)].map((m) => m[1].trim());
  for (const v of fs) {
    if (/^-?\d*\.?\d+(px|pt|rem)\b/i.test(v)) bareFontSizes.push(`${at}: font-size: ${v}`);
  }
  // 间距只做提示不判定失败：宽度/高度上的裸 px 有些是刻意的取舍（见源码里的注释备案）
  if (/\b(?:padding|margin|gap)\b[^:]*:\s*[^;{}]*\b\d+(?:\.\d+)?px\b/.test(line)) {
    rawSpacing.push(at);
  }
});

console.log('\n裸色值（令牌层之外）:', bareColors.length ? bareColors.join(' | ') : '无');
console.log('裸字号（font-size 用 px/pt/rem）:', bareFontSizes.length ? bareFontSizes.join(' | ') : '无');
console.log(`裸间距（提示，不判定失败）: ${rawSpacing.length} 处 @ 行 ${rawSpacing.join(', ') || '无'}`);

if (bareColors.length || bareFontSizes.length) {
  console.error(
    '\n[css-check] 不通过：令牌层之外出现裸色值 / 裸字号 —— 换主题时这些值不会跟着换。\n' +
      '  修法：在 §1 令牌层加一个语义令牌，组件里写 var(--…)。'
  );
  failed = true;
}

process.exitCode = failed ? 1 : 0;
