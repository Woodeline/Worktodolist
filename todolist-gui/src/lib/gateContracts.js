// 门禁契约的**纯函数**集合（R-11 / R-12 / R-42 / R-43）。
//
// 为什么纯函数放在 src/lib 而不是 scripts/：
//   * `scripts/**/*.test.js` 会被 `scripts/assert-tests.mjs` 判成「预期外文件」
//     （它只认 src/ 下的测试），所以门禁自身的契约必须能把测试写在 src/ 里；
//   * 这些判据不碰 I/O、不读环境变量，读源码正则 / 读 yml 原文进参 —— 于是
//     scripts/qa-*.mjs 只负责「取文本 + 调这里 + 决定退出码」。
//
// 一条铁律：端口只有一条真相源（`vite.config.js` 的 `DEV_PORT`）。解析不出来时
// 必须 fail-loud 返回 null 让上层抛错，**绝不回落到 15180** —— 回落会让门禁连上
// 一个不存在的端口却把失败读成「环境没起」，或者更糟：连上别的进程报「全绿」。

/** `vite.config.js` 里的端口声明形状：`const DEV_PORT = 15181;` */
const DEV_PORT_DECL = /const\s+DEV_PORT\s*=\s*(\d{3,5})/;
/** 兜底形状：`port: 15181` / `port: 15181,`（有人把常量内联掉之后仍能解析） */
const PORT_PROP = /\bport\s*:\s*(\d{3,5})/;

/**
 * 从 `vite.config.js` 源码解析开发端口。
 *
 * @param {string} source vite.config.js 的原始文本
 * @returns {number|null} 解析成功返回端口号（整数），解析失败返回 null（调用方必须 fail-loud）
 */
export function devPortOf(source) {
  if (typeof source !== 'string' || source.length === 0) return null;
  const declared = source.match(DEV_PORT_DECL);
  const raw = declared ? declared[1] : (source.match(PORT_PROP) || [])[1];
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/**
 * 从 URL 里取端口（`http://localhost:15181` → 15181）。
 * 没写端口时按协议给默认端口（http 80 / https 443）。
 *
 * 用 WHATWG `URL` 而不是手写正则：手写正则处理「先贪婪吃掉 host:port 再回溯」很容易
 * 写成永远取不到端口（本函数的第一版就是），而这种错误在门禁里只会表现成
 * 「莫名其妙连 80 端口」。
 *
 * @param {string} url
 * @returns {number|null}
 */
export function portOfUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.port) {
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  }
  if (parsed.protocol === 'https:') return 443;
  if (parsed.protocol === 'http:') return 80;
  return null;
}

/**
 * 断言两个端口一致（R-11「端口统一」）。
 *
 * 用途：`vite.config.js` 的 DEV_PORT 必须与 `tauri.conf.json` 的 `devUrl` 端口、
 * 以及三个浏览器门禁实际访问的 BASE 一致 —— 三者任一对不上，门禁就会连到另一个
 * 进程（或连不上）却报「环境没起」。
 *
 * @param {number|null} a
 * @param {number|null} b
 * @param {string} [labelA]
 * @param {string} [labelB]
 * @returns {number} 一致时返回该端口
 * @throws {Error} 任一侧为 null，或两侧不相等
 */
export function assertSamePort(a, b, labelA = 'a', labelB = 'b') {
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    throw new Error(`端口取值非法：${labelA}=${String(a)} / ${labelB}=${String(b)}`);
  }
  if (a !== b) {
    throw new Error(`端口不一致：${labelA}=${a} / ${labelB}=${b}`);
  }
  return a;
}

/** `ci.yml` 必须存在的触发器键。`pull_request` 是「合并门禁」的唯一依据。 */
const CI_REQUIRED_TRIGGERS = ['push', 'pull_request'];

/** `ci.yml` 必须跑的命令（顺序即执行顺序，`guard → ui → build`）。 */
const CI_REQUIRED_COMMANDS = ['npm ci', 'npm run test:guard', 'npm run test:ui', 'npm run build'];

/**
 * 「裸 `npm test`」判据（R-43）：`test:guard` 里已经用 JSON reporter 重跑过全量
 * vitest，再叠一轮 `npm test` 只是白烧一次 30+ 秒。注意 `test:ui` / `test:guard`
 * 都被 `(?![:\w-])` 放过。
 */
const BARE_TEST_CMDS = [/\bnpm\s+test(?![:\w-])/, /\bnpm\s+run\s+test(?![:\w-])/];

/** 去掉整行 YAML 注释：注释里写「不要再叠 npm test」不该被判成违规。 */
function stripFullLineComments(yamlText) {
  return String(yamlText)
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** 正则转义：路径里的 `*` `.` `/` 都是元字符，不转义会让 `scripts/**` 变成野匹配。 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断某条路径是否真的以 **列表项** 的形式出现在 `paths:` 里。
 *
 * 不能用 `text.includes(p)`（QA 复核 P1-③ 的漏洞）：`build-macos.yml` 的注释里
 * 就写着「#   .gitattributes …」「#   AGENTS.md …」，于是那两个文件即使从
 * `paths` 里被删掉，子串匹配仍然命中 —— 合同变成永真，等于没有。
 *
 * 正确口径分三步：
 *   ① 剥掉**整行**注释；
 *   ② 剥掉**行内** `#` 之后的内容（YAML 的注释也可以跟在值后面）；
 *   ③ 要求整行只剩 `- '<path>'`（引号可有可无）。
 * 路径里的 `*` 等元字符先转义，`todolist-gui/scripts/**` 按**字面**匹配一个通配项，
 * 不做 glob 语义 —— 这里要回答的是「文本里有没有这一条」，不是「某个文件配不配得上」。
 */
function hasPathEntry(yamlText, target) {
  const re = new RegExp(`^-\\s*['"]?${escapeRegExp(target)}['"]?\\s*$`);
  return stripFullLineComments(yamlText)
    .split('\n')
    .map((line) => line.split('#')[0].trim()) // ② 行内注释
    .some((line) => re.test(line));
}

/**
 * 校验 ci.yml 的合并门禁契约（R-12 + R-43）。
 *
 * 判据：
 *   1. 同时有 `push` 与 `pull_request` 触发器（否则 PR 不跑，合并门禁失效）；
 *   2. `push` 覆盖所有分支（`'**'`）—— 否则只有 push 到 main 才跑，分支上的红没人看；
 *   3. 依次包含 `npm ci` → `npm run test:guard` → `npm run test:ui` → `npm run build`；
 *   4. **不得**再跑一轮裸 `npm test`（R-43 去重复执行）；
 *   5. Node 22（`node:fs` 的 `globSync` 需要，Node 20 会 `SyntaxError`）。
 *
 * @param {string} yamlText `.github/workflows/ci.yml` 的原始文本
 * @returns {{ok: boolean, problems: string[]}} problems 为空即通过
 */
export function checkCi(yamlText) {
  const problems = [];
  const text = stripFullLineComments(yamlText || '');

  if (!text.trim()) {
    return { ok: false, problems: ['ci.yml 内容为空'] };
  }

  for (const trigger of CI_REQUIRED_TRIGGERS) {
    // 触发器键既有块状（`pull_request:`）也有行内（`[push, pull_request]`）写法，
    // 这里只要求「出现了这个名字且后面跟冒号或逗号/右括号」。
    const re = new RegExp(`(^|[\\s\\[{,])(['"]?)${trigger}\\2\\s*(:|,|\\]|$)`, 'm');
    if (!re.test(text)) {
      problems.push(`缺少触发器 ${trigger}（合并门禁依赖它）`);
    }
  }

  // push 必须覆盖所有分支；`branches: [main]` 只拦主分支，分支上的红没人看。
  const pushAllBranches = /branches\s*:\s*(\[[^\]]*\*\*[^\]]*\]|(\n\s*-\s*['"]?\*\*['"]?\s*)+)/;
  if (!pushAllBranches.test(text)) {
    problems.push("push 未覆盖所有分支（应含 branches: ['**']）");
  }

  let cursor = 0;
  for (const cmd of CI_REQUIRED_COMMANDS) {
    const at = text.indexOf(cmd, cursor);
    if (at === -1) {
      problems.push(`缺少步骤命令 ${cmd}`);
    } else {
      cursor = at + cmd.length;
    }
  }

  for (const bare of BARE_TEST_CMDS) {
    if (bare.test(text)) {
      problems.push('仍然在跑裸 npm test（test:guard 已重跑全量 vitest，R-43 禁止重复执行）');
      break;
    }
  }

  if (!/node-version\s*:\s*['"]?22\b/.test(text)) {
    problems.push('未把 Node 钉到 22（globSync 需要）');
  }

  return { ok: problems.length === 0, problems };
}

/**
 * 出包 workflow（`build-macos.yml`）的 `paths` 必须覆盖的「改了就影响产物」的文件。
 *
 * 为什么是这些：`package.json` / `package-lock.json` 改了依赖集，
 * `vite.config.js` 改了打包行为，`index.html` 是前端入口，`scripts/**` 是门禁本身，
 * `.gitattributes` 决定 checkout 出来的换行符（CRLF 会让一批源码断言整体落空），
 * `AGENTS.md` 是本项目对 Agent 的唯一规则源。
 * `src/**` / `src-tauri/**` 已覆盖 `Cargo.toml` / `Cargo.lock`，不重复列。
 *
 * @type {string[]}
 */
export const RELEASE_WORKFLOW_PATHS = [
  'todolist-gui/src/**',
  'todolist-gui/src-tauri/**',
  'todolist-gui/package.json',
  'todolist-gui/package-lock.json',
  'todolist-gui/vite.config.js',
  'todolist-gui/index.html',
  'todolist-gui/scripts/**',
  '.gitattributes',
  'AGENTS.md',
];

/**
 * 列出出包 workflow 的 `paths` 里缺失的关键路径。
 *
 * 只认「真的以列表项出现」的那一条（见 {@link hasPathEntry}）——
 * 注释里提到的路径不算。
 *
 * @param {string} yamlText workflow 原文
 * @param {string[]} [required] 必需路径，默认 {@link RELEASE_WORKFLOW_PATHS}
 * @returns {string[]} 缺失的路径；空数组 = 契约满足
 */
export function missingReleasePaths(yamlText, required = RELEASE_WORKFLOW_PATHS) {
  return required.filter((p) => !hasPathEntry(yamlText, p));
}
