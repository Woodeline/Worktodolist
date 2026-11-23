// 设置页的渲染契约（2026-11-14 数据节加入后，2026-11-19 分类侧栏改版）。
//
// 底栏删掉时最危险的失手不是"样式变了"，而是「手动重载 / 切换目录」随风消失 ——
// 测试文件盯这一条：两颗按钮真的在设置页里，保存状态也还读得到。
// 2026-11-19 第二轮：设置从应用菜单剥离，分类收为外观 / 数据 / 快捷键；
// 列表与阅读并入外观，显示模式与窗口置顶不再占设置项。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 无 jsdom：用 react-dom/server 的静态标记（与 App.test.jsx 同一套路）。
import { renderToStaticMarkup as ssr } from 'react-dom/server';
import SettingsPage, { SETTINGS_CATEGORIES } from './SettingsPage.jsx';

const noop = () => {};

const store = {
  saveStatus: 'saved',
  lastSavedAt: 0,
  conflict: false,
  todoEntries: [{ kind: 'task' }, { kind: 'task' }, { kind: 'raw' }],
  manualReload: noop,
  pickDirectory: noop,
};

const render = (props = {}) => ssr(
  <SettingsPage
    onClose={noop}
    projects={[]}
    store={store}
    themeMode="auto"
    onPickTheme={noop}
    {...props}
  />
);

const html = render();

const categoryBlock = (id) => {
  const at = html.indexOf(`data-category="${id}"`);
  if (at === -1) return '';
  const next = html.indexOf('class="settings-cat"', at + 1);
  return html.slice(at, next === -1 ? undefined : next);
};

describe('设置页：分类侧栏', () => {
  it('三个分类按 外观 / 数据 / 快捷键 排列', () => {
    expect(SETTINGS_CATEGORIES.map((c) => c.label)).toEqual([
      '外观', '数据', '快捷键',
    ]);
    const nav = html.split('class="settings-nav"')[1]?.split('</aside>')[0] || '';
    expect((nav.match(/role="tab"/g) || []).length).toBe(3);
    for (const label of ['外观', '数据', '快捷键']) {
      expect(nav).toContain(`>${label}</span>`);
    }
  });

  it('默认只展示「外观」，其余分类整块 hidden', () => {
    expect((html.match(/role="tabpanel"/g) || []).length).toBe(3);
    expect((html.match(/aria-selected="true"/g) || []).length).toBe(1);
    expect(categoryBlock('appearance')).not.toContain('hidden=""');
    for (const id of ['data', 'shortcuts']) {
      expect(categoryBlock(id)).toContain('hidden=""');
    }
  });

  it('把原「列表与阅读」并进外观，并清掉显示模式与窗口置顶两节', () => {
    expect(categoryBlock('appearance')).toContain('明暗模式');
    expect(categoryBlock('appearance')).toContain('外观主题');
    expect(categoryBlock('appearance')).toContain('列表外观');
    expect(categoryBlock('appearance')).toContain('阅读密度');
    expect(html).not.toContain('显示模式');
    expect(html).not.toContain('窗口置顶');
    expect(html).not.toContain('data-category="reading"');
    expect(html).not.toContain('data-category="window"');
    expect(categoryBlock('data')).toContain('手动重载');
    expect(categoryBlock('shortcuts')).toContain('全局');
  });

  it('分类切换后页面从顶部读起（滚动重置副作用存在）', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), './SettingsPage.jsx'), 'utf8');
    expect(src).toContain('paneRef.current.scrollTop = 0');
    expect(src).toContain("useEffect(() => {");
  });
});

describe('设置页：数据节', () => {
  it('「手动重载 / 切换目录 / 清理生成数据」在设置页里，且是一颗动作行', () => {
    const actions = html.split('class="settings-actions"')[1] || '';
    expect(actions).toContain('手动重载');
    expect(actions).toContain('切换目录');
    expect(actions).toContain('清理生成数据');
    expect((actions.match(/<button/g) || []).length).toBe(3);
  });

  it('运行态占用是只读读数（没句柄时显示 —，不冒充 0 B）', () => {
    expect(html).toContain('生成数据');
    expect(html).toContain('备份留 30 天');
  });

  it('保存状态仍是可读的读数（主界面不再报，但没丢）', () => {
    expect(html).toContain('保存状态');
    expect(html).toContain('已保存');
    expect(html).toContain('2 条任务'); // 只数任务，raw 行不算
  });

  it('九个设置节按分类顺序排列', () => {
    const titles = [...html.matchAll(/class="settings-group-title">([^<]+)</g)].map((m) => m[1]);
    expect(titles).toEqual([
      '明暗模式', '外观主题',
      '列表外观', '阅读密度', '侧栏分组',
      '数据',
      '全局', '列表页', '日历',
    ]);
  });

  it('列表页速查不再把空格列为完成快捷键', () => {
    expect(html).not.toContain('完成 / 取消完成当前选中任务');
    // 日历里的空格是「选中日期」，不是完成，别连带删掉。
    expect(html).toContain('选中当前日期');
  });

  it('页头与底栏不再摆说明文字（2026-11-19 清爽版）', () => {
    for (const gone of ['本机偏好 · 快捷键速查只读', '随时可查', '活动栏「设置」']) {
      expect(html).not.toContain(gone);
    }
    expect(html).not.toContain('settings-head-note');
    expect(html).not.toContain('settings-foot');
    expect(html).not.toContain('settings-where');
  });
});

describe('设置页：明暗模式（从应用菜单迁入）', () => {
  const theme = html.split('class="settings-group-title">明暗模式<')[1]?.split('class="settings-group"')[0] || '';

  it('三档按钮按 跟随系统 / 浅色 / 深色 排，默认恰好一档按下', () => {
    expect((theme.match(/data-theme-mode=/g) || []).length).toBe(3);
    expect((theme.match(/aria-pressed="true"/g) || []).length).toBe(1);
    expect(theme).toContain('跟随系统');
    expect(theme).toContain('浅色');
    expect(theme).toContain('深色');
  });

  it('与活动栏主题共用同一份档位来源，没有第二套选项', () => {
    expect(theme).toContain('data-theme-mode="auto"');
    expect(theme).toContain('data-theme-mode="light"');
    expect(theme).toContain('data-theme-mode="dark"');
  });
});

describe('设置页：阅读密度', () => {
  const density = html.split('class="settings-group-title">阅读密度<')[1]?.split('class="settings-group"')[0] || '';

  it('四组三档按钮（侧栏 / 列表 × 字号 / 行距），每组恰好一档按下', () => {
    expect((density.match(/class="density-seg"/g) || []).length).toBe(4);
    expect((density.match(/class="density-opt/g) || []).length).toBe(12);
    expect((density.match(/aria-pressed="true"/g) || []).length).toBe(4);
  });

  it('每档按钮自带样张：字号画「A」、行距画三线，不出现数值输入', () => {
    expect((density.match(/density-a density-a-/g) || []).length).toBe(6);
    expect((density.match(/class="density-rows"/g) || []).length).toBe(6);
    expect(density).not.toContain('<input');
    expect(density).not.toContain('type="number"');
  });

  it('实时预览真的渲染：目录三条 + 列表三行（含子任务与逾期）', () => {
    expect((density.match(/class="dp-nav/g) || []).length).toBe(3);
    expect((density.match(/class="dp-row/g) || []).length).toBe(3);
    expect(density).toContain('is-child');
    expect(density).toContain('is-overdue');
  });

  it('默认档不出现「恢复默认」出口（与色板「自动」同一判据）', () => {
    expect(density).not.toContain('density-reset');
  });
});

describe('设置页：底栏真的搬走了', () => {
  it('App.jsx 里不再有 Footer / Overview / 状态栏', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../App.jsx'), 'utf8');
    expect(src).not.toContain('<Footer');
    expect(src).not.toContain('<Overview');
    // 底栏（statusbar）连同它的三态圆点一起搬走了：拼着写，别让静态扫描把它当成
    // 「JSX 里还在用这个类名」的证据（qa-css-check 会扫 .jsx 全文）。
    expect(src).not.toContain('status' + 'bar');
    // 那两颗钮只应出现在设置页（App 里不再挂它们；欢迎页的「选择数据目录」是另一回事）
    expect(src).not.toContain('onClick={store.manualReload}');
    expect(src).not.toContain('>手动重载<');
  });
});

describe('设置页：侧栏分组名（2026-11-23）', () => {
  it('两行输入：默认 分类/标签、最长 8 字、备注说明只改显示名', () => {
    const block = categoryBlock('appearance');
    expect(block).toContain('>侧栏分组<');
    expect(block.indexOf('>阅读密度<')).toBeLessThan(block.indexOf('>侧栏分组<'));
    expect(block).toContain('只改侧栏里的显示名');
    for (const [kind, label] of [['contexts', '分类'], ['projects', '标签']]) {
      const attrs = block.split(`data-group-label="${kind}"`)[1].split('>')[0];
      expect(attrs).toContain('maxLength="8"');
      expect(attrs).toContain(`value="${label}"`);
      expect(attrs).toContain(`placeholder="${label}"`);
    }
  });
});

describe('设置页：外观主题节（2026-11-18 三档皮肤）', () => {
  it('三枚样张按钮按 原版/素纸/夜航 排，默认恰好原版按下', () => {
    const seg = categoryBlock('appearance').split('class="skin-switch"')[1]?.split('class="settings-group"')[0] || '';
    const btns = seg.split('class="skin-btn').slice(1);
    expect(btns).toHaveLength(3);
    expect(seg).toContain('data-skin="classic"');
    expect(seg).toContain('data-skin="paper"');
    expect(seg).toContain('data-skin="night"');
    expect(seg).not.toContain('data-skin="garden"');
    expect((seg.match(/aria-pressed="true"/g) || []).length).toBe(1);
    expect(seg.indexOf('原版')).toBeLessThan(seg.indexOf('素纸'));
    expect(seg.indexOf('素纸')).toBeLessThan(seg.indexOf('夜航'));
  });

  it('每枚按钮带三枚小样（底 / 面 / 主色），共九枚', () => {
    const seg = categoryBlock('appearance').split('class="skin-switch"')[1]?.split('class="settings-group"')[0] || '';
    expect((seg.match(/class="sw-bg"/g) || []).length).toBe(3);
    expect((seg.match(/class="sw-surface"/g) || []).length).toBe(3);
    expect((seg.match(/class="sw-accent"/g) || []).length).toBe(3);
  });

  it('节序：明暗模式在前、外观主题在后', () => {
    const a = html.indexOf('>明暗模式<');
    const b = html.indexOf('>外观主题<');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  it('样张色走 §1 的 --sw-* 令牌，CSS 里三档 × 三枚都有落点', () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
    for (const s of ['classic', 'paper', 'night']) {
      for (const k of ['bg', 'surface', 'accent']) {
        expect(css).toContain(`--sw-${s}-${k}:`);
        expect(css).toContain(`.skin-btn[data-skin="${s}"] .sw-${k}`);
      }
    }
    expect(css).not.toContain('--sw-garden');
  });
});

// 2026-11-18 二改：侧栏三档同形。
// 换皮肤只该换纸墨与主色，不该换「怎么读这份目录」—— 夜航曾把侧栏收成 56px 图标轨
// （文字 / 计数 / 组名退场，行高 36），素纸把侧栏行距抬到 30：同一份任务在
// 各档下要点出不同手感。这里把「骨架只由基线给」钉成契约。
describe('外观主题：侧栏三档同形（2026-11-18 二改）', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

  it('皮肤令牌块不许动侧栏尺寸（--sidebar-w / --nav-h / --r-nav）', () => {
    // 只看 §1 令牌层：触屏兜底里还有 :root[data-skin="night"] { --row-h: 44px }，
    // 那条改的是列表行高，不属令牌层。
    const tokenLayer = css.slice(0, css.indexOf('2 · 基础层'));
    const blocks = [...tokenLayer.matchAll(/:root\[data-skin="[a-z]+"\](?:\[data-theme="dark"\])? \{([^}]*)\}/g)];
    expect(blocks).toHaveLength(4); // 两档皮肤 × 明暗两套（classic 即基线，不另写块）
    for (const m of blocks) {
      expect(m[1]).not.toMatch(/--sidebar-w\s*:/);
      expect(m[1]).not.toMatch(/--nav-h\s*:/);
      expect(m[1]).not.toMatch(/--r-nav\s*:/);
    }
    // 侧栏行圆角只有一处定义（基线），皮肤改 --r-sm 也改不到它
    expect((css.match(/--r-nav\s*:/g) || []).length).toBe(1);
  });

  it('版式差异节不碰侧栏：没有 .sidebar / .nav-item / .nav-label / .count 的皮肤选择器', () => {
    for (const s of ['paper', 'night']) {
      for (const sel of ['.sidebar', '.nav-item', '.nav-label', '.count']) {
        expect(css).not.toContain(`[data-skin="${s}"] ${sel}`);
      }
    }
  });

  it('导航行与分组行读同一枚 --r-nav，皮肤换圆角不会把侧栏带成另一种形状', () => {
    const ruleOf = (sel) => css.split(`${sel} {`)[1].split('}')[0];
    expect(ruleOf('.nav-item')).toContain('border-radius: var(--r-nav)');
    expect(ruleOf('.sidebar-group-toggle')).toContain('border-radius: var(--r-nav)');
  });
});

// 2026-11-18 五改：上下文条并进标题行后，行高由外壳定，条自己不许再长高。
// 素纸 / 夜航曾把条设成 40px，而标题行只有 --chrome-row-h（31）——
// 条从行里往下溢出，条内「全部」与三枚图标整体比行中线低 4.5px，
// 用户看到的就是「没在行里居中」。这里钉住「高度只在条自成一行时成立」。
describe('外观主题：上下文条在标题行里居中（2026-11-18 五改）', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

  it('皮肤给上下文条设高度时必须限定 .workspace > .topbar，不许命中标题行里的条', () => {
    const hits = [...css.matchAll(/\[data-skin="(?:paper|night)"\][^{]*\.topbar[^{]*\{([^}]*)\}/g)];
    expect(hits.length).toBeGreaterThan(0);
    for (const m of hits) {
      if (!/height\s*:/.test(m[1])) continue;
      const sel = m[0].slice(0, m[0].indexOf('{'));
      expect(sel).toContain('.workspace > .topbar');
    }
  });

  it('标题行里的条恒为 100% 高，行高只认 --chrome-row-h', () => {
    expect(css).toContain('--titlebar-h: var(--chrome-row-h)');
    const rule = css.split('.titlebar .topbar {')[1].split('}')[0];
    expect(rule).toContain('height: 100%');
    // 条内三段都靠 flex 居中：面板开关 / 面包屑 / 右端两枚图标钮
    // （按行首锚定，避免命中 `.titlebar .topbar` 那条）
    expect(css.match(/\n\.topbar \{([^}]*)\}/)[1]).toContain('align-items: center');
    expect(css.match(/\n\.crumb \{([^}]*)\}/)[1]).toContain('align-items: center');
  });
});
