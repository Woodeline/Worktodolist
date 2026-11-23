// 门禁契约的回归测试（R-11 / R-12 / R-42 / R-43）。
//
// 这一组测的不是产品行为，而是**门禁自己**：
//   * 端口只有一条真相源（`vite.config.js` 的 DEV_PORT），三个来源必须一致；
//   * `ci.yml` 真的能在 PR 上跑（`pull_request` + 全分支 push），且不重复执行；
//   * 出包 workflow 的 `paths` 真的覆盖了「改了就影响产物」的那些文件。
//
// 所以这里**读真实文件**而不是喂假字符串 —— 契约断的是仓库现状，
// 被断言的文本改了就该红，这正是门禁该有的行为。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertSamePort,
  checkCi,
  devPortOf,
  missingReleasePaths,
  portOfUrl,
  RELEASE_WORKFLOW_PATHS,
} from './gateContracts.js';

// src/lib → todolist-gui → 仓库根
const GUI_ROOT = path.resolve(import.meta.dirname, '..', '..');
const REPO_ROOT = path.resolve(GUI_ROOT, '..');
const readText = (abs) => readFileSync(abs, 'utf8');

const VITE_CONFIG = readText(path.join(GUI_ROOT, 'vite.config.js'));
const TAURI_CONF = readText(path.join(GUI_ROOT, 'src-tauri', 'tauri.conf.json'));
const CI_YML = readText(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'));
const MACOS_YML = readText(path.join(REPO_ROOT, '.github', 'workflows', 'build-macos.yml'));
const WINDOWS_YML = readText(path.join(REPO_ROOT, '.github', 'workflows', 'build-windows.yml'));

// ——— R-11：端口统一 ———

describe('R-11 devPortOf / 端口真相源', () => {
  it('11.1 两种写法都能解析；解析不出来返回 null（不回落默认端口）', () => {
    expect(devPortOf('const DEV_PORT = 15181;')).toBe(15181);
    expect(devPortOf('const DEV_PORT=15181')).toBe(15181);
    expect(devPortOf('server: { port: 15181, strictPort: true }')).toBe(15181);
    expect(devPortOf('preview: {\n  port: 15182,\n}')).toBe(15182);
    // 只有常量声明、没有别的数字干扰时仍取常量（常量优先）
    expect(devPortOf('const DEV_PORT = 15181;\nserver: { port: 15181 }')).toBe(15181);

    // 失败一律 null：调用方据此 fail-loud，绝不回落 15180
    expect(devPortOf('')).toBeNull();
    expect(devPortOf(undefined)).toBeNull();
    expect(devPortOf('server: { strictPort: true }')).toBeNull();
    expect(devPortOf('const DEV_PORT = abc;')).toBeNull();
    expect(devPortOf('const PORT = 15181;')).toBeNull();
  });

  it('11.2 真实 vite.config.js 能解析出端口，与 URL 解析口径一致', () => {
    const port = devPortOf(VITE_CONFIG);
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);

    expect(portOfUrl(`http://localhost:${port}`)).toBe(port);
    expect(portOfUrl('http://127.0.0.1:15181/styleguide.html')).toBe(15181);
    expect(portOfUrl('http://localhost')).toBe(80);
    expect(portOfUrl('')).toBeNull();
  });

  it('11.3 vite.config.js 与 tauri.conf.json 的 devUrl 必须是同一个端口', () => {
    const vitePort = devPortOf(VITE_CONFIG);
    expect(Number.isInteger(vitePort)).toBe(true);

    const devUrl = (JSON.parse(TAURI_CONF).build || {}).devUrl || '';
    const tauriPort = portOfUrl(devUrl);
    expect(Number.isInteger(tauriPort)).toBe(true);

    // 端口漂移的后果是「白屏而不是启动失败」，所以这里必须硬断言相等。
    expect(() => assertSamePort(vitePort, tauriPort, 'vite.config.js', 'tauri.conf.json devUrl')).not.toThrow();
    expect(() => assertSamePort(vitePort, tauriPort + 1)).toThrow(/端口不一致/);
    expect(() => assertSamePort(null, tauriPort)).toThrow(/端口取值非法/);
  });
});

// ——— R-12 / R-43：CI 合并门禁 ———

describe('R-12 ci.yml 合并门禁契约', () => {
  it('12.1 真实 ci.yml 同时有 push（全分支）与 pull_request，且步骤齐全', () => {
    const { ok, problems } = checkCi(CI_YML);
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
  });

  it('12.2 负向自检：去掉 pull_request / 加回裸 npm test 都必须报红', () => {
    // ① 只有 push 没有 pull_request —— 合并门禁失效
    const noPr = CI_YML.split('\n')
      .filter((line) => !/^\s*pull_request\s*:/.test(line))
      .join('\n');
    const r1 = checkCi(noPr);
    expect(r1.ok).toBe(false);
    expect(r1.problems.join('\n')).toMatch(/pull_request/);

    // ② 在 test:guard 之外又叠一轮裸 npm test（R-43 禁止）
    const duplicated = `${CI_YML}\n      - name: 重复执行\n        run: npm test\n`;
    const r2 = checkCi(duplicated);
    expect(r2.ok).toBe(false);
    expect(r2.problems.join('\n')).toMatch(/裸 npm test/);

    // ③ 缺 build 步骤
    const noBuild = CI_YML.split('\n')
      .filter((line) => !line.includes('npm run build'))
      .join('\n');
    expect(checkCi(noBuild).problems.join('\n')).toMatch(/npm run build/);

    // ④ 空内容不该静默通过
    expect(checkCi('').ok).toBe(false);
    // 注释里的「npm test」不算违规
    expect(checkCi('# 不要再叠 npm test\n' + CI_YML).ok).toBe(true);
  });

  it('12.3 出包 workflow 的 paths 覆盖关键文件，Windows 侧 PR 不碰 Release', () => {
    expect(missingReleasePaths(MACOS_YML)).toEqual([]);

    // 负向自检：把某一条关键路径从 paths 里真的删掉，必须立刻被发现。
    // 这几条刻意都验一遍 —— `.gitattributes` / `AGENTS.md` 曾经因为「注释里也提到了」
    // 而永远命中（QA 复核 P1-③：子串匹配把合同变成了永真）。
    const stripPathLine = (yaml, target) => {
      const esc = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return yaml.replace(new RegExp(`^\\s*-\\s*'${esc}'\\s*\\n?`, 'gm'), '');
    };
    for (const target of [
      'todolist-gui/vite.config.js',
      'todolist-gui/scripts/**',
      '.gitattributes',
      'AGENTS.md',
    ]) {
      expect(missingReleasePaths(stripPathLine(MACOS_YML, target))).toEqual([target]);
    }
    // 注释里出现这些名字不算数：整行注释、以及「值后面的行内注释」都不许满足合同。
    expect(missingReleasePaths("#   .gitattributes 换行符\n#   AGENTS.md 规则源\n")).toEqual(
      RELEASE_WORKFLOW_PATHS
    );
    expect(
      missingReleasePaths("      - 'todolist-gui/src/**'  # .gitattributes / AGENTS.md 也在这里\n")
    ).toEqual(RELEASE_WORKFLOW_PATHS.filter((p) => p !== 'todolist-gui/src/**'));
    expect(RELEASE_WORKFLOW_PATHS).toContain('todolist-gui/vite.config.js');

    // Windows：要么补了 pull_request，要么至少 push 覆盖 main。
    const hasPr = /(^|\s)pull_request\s*:/.test(WINDOWS_YML);
    const coversMain = /branches\s*:\s*(\[[^\]]*main|\n\s*-\s*main)/.test(WINDOWS_YML);
    expect(hasPr || coversMain).toBe(true);
    // 无论哪种，Release 步骤必须有 tag 守卫（否则 PR 上会去写 Release）
    expect(WINDOWS_YML).toMatch(/if:\s*startsWith\(github\.ref,\s*'refs\/tags\/'\)/);
    // Windows 的 paths 同样要覆盖关键文件（pull_request 侧带 paths 过滤，省 runner 时间）
    expect(missingReleasePaths(WINDOWS_YML)).toEqual([]);
  });
});
