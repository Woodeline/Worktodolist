// QA 静态检查：不许出现「条件式 Hook」。
//
// 背景（v1.1.0 事故）：EditDrawer 把 useMemo 写在了 `if (!task || !form) return null;`
// 之后。组件是常驻挂载的 —— 第一次渲染（没在编辑）只调了 3 个 Hook 就 return，
// 第二次（正在编辑）多调了那一个 useMemo。React 认定前后不是同一个组件，抛
// "Rendered more hooks than during the previous render."；树上没有错误边界，
// 于是整棵 root 被卸载 —— 用户看到的是白屏 + 点哪都没反应，跟卡死一模一样。
//
// 这类 bug 纯函数测试一条也拦不住（逻辑全对），lint 没装（react-hooks 规则缺），
// 只能静态守：规则很简单 —— **提前 return 之后，同一个函数体里不许再有 Hook 调用**。
//
// 判定办法靠缩进，不靠解析 AST：
//   · 组件体的 early return 缩进是 2（`  if (...) return null;`）；
//     Hook 回调里的 return 缩进 >= 4，那是合法的，不参与判定。
//   · 命中后一路检查到下一个缩进 0 的顶层定义为止，只看缩进 2 的 useXxx( 调用。
import { readFileSync, globSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'src');
const files = [
  ...globSync('**/*.jsx', { cwd: root }),
  ...globSync('hooks/*.js', { cwd: root }),
]
  .filter((f) => !f.includes('.test.'))
  .map((f) => `${root}/${f}`);

const GUARD = /^ {2}if\s*\(.*\)\s*return\s+[^;]+;\s*$/;
const TOPLEVEL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|class)\s/;
const HOOK = /\buse[A-Z]\w*\s*\(/;

const violations = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let guard = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (TOPLEVEL.test(line) && i > 0) guard = null;
    if (GUARD.test(line) && guard === null) guard = i + 1;
    if (guard === null) continue;
    const code = line.split('//')[0];
    if (/^ {2}\S/.test(code) && HOOK.test(code)) {
      violations.push(`${path.relative(root, file)}:${i + 1}  （提前 return 在第 ${guard} 行）  ${line.trim()}`);
    }
  }
}

if (violations.length > 0) {
  console.error('[hooks-check] 不通过：以下 Hook 出现在提前 return 之后 —— Hooks 数量会在渲染之间变化，React 会抛错并卸载整棵树。');
  violations.forEach((v) => console.error('  · ' + v));
  process.exit(1);
}

console.log(`[hooks-check] 通过：${files.length} 个文件，无「提前 return 之后调 Hook」。`);
