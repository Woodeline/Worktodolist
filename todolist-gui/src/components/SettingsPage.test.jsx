// 设置页的渲染契约（2026-11-14 数据节加入后）。
//
// 底栏删掉时最危险的失手不是"样式变了"，而是「手动重载 / 切换目录」随风消失 ——
// 测试文件盯这一条：两颗按钮真的在设置页里，保存状态也还读得到。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 无 jsdom：用 react-dom/server 的静态标记（与 App.test.jsx 同一套路）。
import { renderToStaticMarkup as ssr } from 'react-dom/server';
import SettingsPage from './SettingsPage.jsx';

const noop = () => {};

const store = {
  saveStatus: 'saved',
  lastSavedAt: 0,
  conflict: false,
  todoEntries: [{ kind: 'task' }, { kind: 'task' }, { kind: 'raw' }],
  manualReload: noop,
  pickDirectory: noop,
};

const html = ssr(<SettingsPage onClose={noop} projects={[]} store={store} />);

describe('设置页：数据节', () => {
  it('「手动重载 / 切换目录」在设置页里，且是一颗动作行', () => {
    const actions = html.split('class="settings-actions"')[1] || '';
    expect(actions).toContain('手动重载');
    expect(actions).toContain('切换目录');
    expect((actions.match(/<button/g) || []).length).toBe(2);
  });

  it('保存状态仍是可读的读数（主界面不再报，但没丢）', () => {
    expect(html).toContain('保存状态');
    expect(html).toContain('已保存');
    expect(html).toContain('2 条任务'); // 只数任务，raw 行不算
  });

  it('分组顺序固定：外观 → 阅读密度 → 显示模式 → 数据 → 三节快捷键', () => {
    const titles = [...html.matchAll(/class="settings-group-title">([^<]+)</g)].map((m) => m[1]);
    expect(titles).toEqual(['列表外观', '阅读密度', '显示模式', '数据', '全局', '列表页', '日历']);
  });

  it('页头说明仍写明快捷键只读（这一节确实点不了）', () => {
    expect(html).toContain('只读');
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
