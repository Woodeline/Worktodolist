// 编辑浮窗的渲染冒烟 + 一条结构约束。
//
// 为什么值得为它专门写测试：v1.1.0 在 Windows 上「点编辑 → 卡死且看不到界面」，
// 根因是这里的 Hooks 数量在两次渲染之间变了 —— 组件常驻挂载，第一次渲染（没在编辑）
// 调 3 个 Hook 就 return 了，第二次（正在编辑）多调了一个 useMemo。React 认定前后
// 不是同一个组件，直接抛错；树上没有错误边界，于是整棵 root 被卸载 —— 白屏、
// 点哪都没反应，跟卡死一模一样。
//
// 这类 bug 有两个特点：纯函数层的测试一条也拦不住（逻辑全对），而"打开浮窗点两下"
// 的人手验收又极容易在别的功能上分心。所以这里补两层网：
//   ① 渲染冒烟 —— 浮窗真的画得出来，字段真的带上了值；
//   ② 结构约束 —— 源码里提前 return 之后不许再出现 Hook（React 的硬规则）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import EditDrawer from './EditDrawer.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseSingleLine } from '../lib/todoParser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '..', 'index.css'), 'utf8');
const drawerSrc = readFileSync(path.join(here, 'EditDrawer.jsx'), 'utf8');

// 只取某条规则的花括号内部：这些版式契约是字符串合同，改坏了要能被单测抓住。
function cssRule(selector) {
  const start = css.indexOf(selector + ' {');
  if (start === -1) return '';
  const bodyStart = start + selector.length + 2;
  const end = css.indexOf('}', bodyStart);
  return end === -1 ? '' : css.slice(bodyStart, end);
}

function makeStore(task, override = {}) {
  return {
    editingTask: task,
    todoEntries: task ? [task] : [],
    doneEntries: [],
    noteIds: new Set(),
    getNote: () => '',
    saveNote: () => {},
    updateTask: () => {},
    deleteTask: () => {},
    addSubtask: () => {},
    toggleComplete: () => {},
    closeEditor: () => {},
    ...override,
  };
}

function render(store) {
  return renderToStaticMarkup(
    <ContextMenuProvider>
      <EditDrawer store={store} />
    </ContextMenuProvider>
  );
}

describe('EditDrawer 渲染', () => {
  it('没在编辑时什么都不画', () => {
    expect(render(makeStore(null))).toBe('');
  });

  it('正在编辑时画得出浮窗，字段带上了任务的值', () => {
    const task = parseSingleLine('(A) 交周报 @工作 +回测 due:2026-10-25 rec:mon id:aaa111');
    const markup = render(makeStore(task));
    expect(markup).toContain('交周报');
    expect(markup).toContain('edit-window');
    // 重复规则选中了预设里的「每周一」，而不是显示成空下拉
    expect(markup).toContain('value="mon"');
    expect(markup).toContain('value="工作"');
    expect(markup).toContain('value="回测"');
  });

  it('备注正文从 notes.md 读出来填进 textarea', () => {
    const task = parseSingleLine('写周报 id:aaa111');
    const markup = render(makeStore(task, { getNote: () => '记得附上上周的数据' }));
    expect(markup).toContain('记得附上上周的数据');
  });

  it('store 没有备注能力时也不崩（降级成空备注）', () => {
    const task = parseSingleLine('写周报 id:aaa111');
    const store = makeStore(task);
    delete store.getNote;
    expect(() => render(store)).not.toThrow();
  });

  it('不再提供阈值日期输入项，日期字段与重复四档仍在', () => {
    const task = parseSingleLine('写周报 due:2026-10-25 t:2026-10-05 rem:2026-10-23T15:00 id:aaa111');
    const markup = render(makeStore(task));
    expect(markup).not.toContain('阈值日期');
    expect(markup).toContain('截止日期');
    expect(markup).toContain('提醒时刻');
    // 写入行预览已移除；t: 由 save 只提交表单字段、applyPatch 原样保留
    expect(markup).not.toContain('drawer-preview');
    for (const label of ['从不', '每日', '每周', '每月']) {
      expect(markup).toContain(`>${label}</option>`);
    }
  });

  it('精简后：标题栏不多摆按钮、日期按钮、空态不再写说明', () => {
    const task = parseSingleLine('写周报 due:2026-10-25 id:aaa111');
    const markup = render(makeStore(task));
    expect(markup).toContain('drawer-title-input');
    expect(markup).toContain('date-field-btn');
    expect(markup).toContain('子任务');
    for (const text of ['暂无备注', '还没有子任务', '逗号分隔', '完成后生成下一次', '存 notes.md', '支持多行与 Markdown', 'drawer-preview']) {
      expect(markup).not.toContain(text);
    }
  });

  it('标题栏的旗标按钮已退场（旗标此后只表示优先级），star: 数据仍原样透传', () => {
    const starred = parseSingleLine('写周报 star:1 id:aaa111');
    const markup = render(makeStore(starred));
    expect(markup).not.toContain('star-toggle');
    expect(markup).not.toContain('aria-label="取消旗标"');
    expect(markup).not.toContain('aria-label="加旗标"');
    // 表单里不再有那个开关，但保存时要把原值带回去 —— 否则编辑一次就把 star: 抹了
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'EditDrawer.jsx'),
      'utf8'
    );
    expect(src).toContain('starred: Boolean(task.starValue)');
    expect(src).toContain("starValue: form.starred ? '1' : null");
  });

  it('有备注时默认显示为只读块，不直接进 textarea 编辑态', () => {
    const task = parseSingleLine('写周报 id:aaa111');
    const markup = render(makeStore(task, { getNote: () => '记得附上上周的数据' }));
    expect(markup).toContain('note-display');
    expect(markup).toContain('记得附上上周的数据');
    expect(markup).not.toContain('note-input');
  });

  it('老重复规则仍在下拉里，不被四档预设挤掉', () => {
    const task = parseSingleLine('写周报 rec:mon id:aaa111');
    const markup = render(makeStore(task));
    expect(markup).toContain('value="mon"');
    expect(markup).toContain('>每周一</option>');
  });

  it('不再显示与按钮重复的操作说明（少写说明，让布局自己说话）', () => {
    const task = parseSingleLine('写周报 id:aaa111');
    const markup = render(makeStore(task));
    expect(markup).not.toContain('回车保存');
    expect(markup).not.toContain('drawer-hint');
  });

  it('备注只有一个「添加备注」按钮，不再叠「备注 + 添加」两层入口', () => {
    const markup = render(makeStore(parseSingleLine('写周报 id:aaa111')));
    expect(markup).toContain('添加备注');
    expect(markup.match(/class="note-edit-btn"/g) || []).toHaveLength(1);
    expect(markup).not.toContain('field-note-head');
    expect(markup.replace('添加备注', '')).not.toContain('>备注<');
  });

  it('有备注时按钮改叫「编辑备注」，仍然只有一个入口', () => {
    const markup = render(makeStore(parseSingleLine('写周报 id:aaa111'), {
      getNote: () => '记得附上上周的数据',
    }));
    expect(markup).toContain('编辑备注');
    expect(markup).toContain('note-display');
    expect(markup.match(/class="note-edit-btn"/g) || []).toHaveLength(1);
  });

  it('优先级只摆「无 / 高 / 中 / 低」汉字按钮，不带记号图标', () => {
    const markup = render(makeStore(parseSingleLine('写周报 id:aaa111')));
    const picker = (markup.match(/<div class="priority-picker">([\s\S]*?)<\/div>/) || [])[1] || '';
    for (const label of ['无', '高', '中', '低']) {
      expect(picker).toContain(`${label}</button>`);
    }
    expect(picker).not.toContain('prio-mark');
    expect(picker).not.toContain('<svg');
  });

  it('子任务上下各有一道分割线，进度线与读数同一行', () => {
    const parent = parseSingleLine('写周报 id:aaa111');
    const kid = parseSingleLine('拆后盖 parent:aaa111 id:bbb222');
    const markup = render(makeStore(parent, { todoEntries: [parent, kid] }));
    expect(markup).toContain('subtask-head');
    expect(markup).toContain('subtask-progress');
    expect((markup.match(/class="field-sep"/g) || [])).toHaveLength(2);
    expect(markup).toContain('添加备注');
    // 上线在子任务区之前，下线在「添加子任务」之后、备注按钮之前。
    const first = markup.indexOf('field-sep');
    const second = markup.indexOf('field-sep', markup.indexOf('subtask-add'));
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(-1);
    expect(first).toBeLessThan(markup.indexOf('subtask-head'));
    expect(second).toBeGreaterThan(markup.indexOf('subtask-add'));
    expect(second).toBeLessThan(markup.indexOf('note-edit-btn'));
  });
});

describe('编辑浮窗：2026-11-17 十条 UI 契约', () => {
  it('标题降一档并取消粗体，文字起点与字段左缘对齐', () => {
    const title = cssRule('.drawer-title-input');
    expect(title).toContain('font-size: var(--fs-md)');
    expect(title).toContain('font-weight: var(--fw-body)');
    // 标题输入框不再自带 8px 内缩，头部 / 主体 / 底栏统一吃 --row-pad
    expect(title).toContain('padding: var(--sp-1) 0');
    expect(cssRule('.drawer-header')).toContain('var(--row-pad)');
    expect(cssRule('.drawer-body')).toContain('var(--row-pad)');
    expect(cssRule('.drawer-actions')).toContain('var(--row-pad)');
  });

  it('宽度只认 --edit-window-w，内容的 min-content 不再把窗口撑宽', () => {
    const win = cssRule('.edit-window');
    expect(win).toContain('width: var(--edit-window-w)');
    expect(win).toContain('min-width: 0');
    expect(win).toContain('flex: 0 0 var(--edit-window-w)');
  });

  it('除标题外统一到优先级选项的 13px', () => {
    expect(css).toContain('.edit-window .field { font-size: var(--fs-sm); }');
    expect(css).toContain('.edit-window .field input:not([type="checkbox"])');
    expect(css).toContain('.edit-window .date-field-btn { font-size: var(--fs-sm); }');
    expect(cssRule('.note-edit-btn')).toContain('font-size: var(--fs-sm)');
    expect(cssRule('.field-subtasks-label')).toContain('font-size: var(--fs-sm)');
    expect(cssRule('.edit-window .subtask-add input')).toContain('font-size: var(--fs-sm)');
    expect(cssRule('.edit-window .subtask-add .btn')).toContain('font-size: var(--fs-sm)');
  });

  it('备注按钮去掉铅笔图标，高度 +20%，展开后间距翻倍', () => {
    const store = makeStore(parseSingleLine('写周报 id:aaa111'));
    const markup = render(store);
    const noteBtn = (markup.match(/<button[^>]*note-edit-btn[\s\S]*?<\/button>/) || [''])[0];
    expect(noteBtn).toContain('添加备注');
    expect(noteBtn).not.toContain('<svg');
    expect(drawerSrc).not.toContain("'pencil'");
    expect(cssRule('.note-edit-btn')).toContain('height: calc(var(--h-control) * 0.94)');
    expect(cssRule('.edit-window .field-note')).toContain('gap: var(--sp-2)');
  });

  it('底栏容器 -30%、按钮 -20%，触屏 44px 兜底被更高特异性的 min-height 压住', () => {
    expect(css).toContain('--drawer-actions-h: calc(');
    expect(css).toContain('--drawer-action-h: calc(');
    expect(cssRule('.drawer-actions')).toContain('height: var(--drawer-actions-h)');
    const btn = cssRule('.drawer-actions .btn');
    expect(btn).toContain('height: var(--drawer-action-h)');
    expect(btn).toContain('min-height: var(--drawer-action-h)');
  });

  it('分类 / 标签是一体化输入框：边框归容器，箭头是容器内的无边框图标钮', () => {
    const box = cssRule('.tag-input');
    expect(box).toContain('height: var(--h-control-lg)');
    expect(box).toContain('border: 1px solid var(--control-line)');
    expect(box).toContain('overflow: hidden');
    expect(css).toContain('.tag-input:focus-within');
    const toggle = cssRule('.tag-toggle');
    expect(toggle).toContain('border: 0');
    expect(toggle).toContain('width: var(--h-control)');
    expect(toggle).toContain('height: 100%');
  });

  it('子任务复选框是 16px 圆环，行高 26 / 行内编辑 24，点开不再把浮窗顶高', () => {
    expect(cssRule('.subtask-list li')).toContain('min-height: 26px');
    const cb = cssRule('.subtask-list .checkbox');
    expect(cb).toContain('width: 16px');
    expect(cb).toContain('height: 16px');
    expect(cb).toContain('border-radius: var(--r-pill)');
    expect(cssRule('.subtask-list .checkbox.checked')).toContain('background: var(--accent)');
    expect(cssRule('.edit-window .subtask-list .subtask-title-input')).toContain('height: 24px');
    expect(cssRule('.field-subtasks')).toContain('margin-top: 0');
  });

  it('优先级四档的选中色取列表旗帜令牌，无档保持中性', () => {
    for (const [cls, token, ink] of [
      ['high', '--flag-high', '--flag-high'],
      ['mid', '--flag-mid', '--flag-mid-ink'],
      ['low', '--flag-low', '--flag-low'],
    ]) {
      const body = cssRule(`.priority-picker button.sel.prio-${cls}`);
      expect(body).toContain(`border-color: var(--flag-${cls})`);
      expect(body).toContain(`background: var(--flag-${cls}-soft)`);
      expect(body).toContain(`color: var(${ink})`);
      expect(css).toContain(`--flag-${cls}-soft:`);
    }
    expect(css).toContain('--flag-mid-ink:');
    const none = cssRule('.priority-picker button.sel.prio-none');
    expect(none).toContain('border-color: var(--border-strong)');
    expect(none).toContain('background: var(--surface-2)');
    expect(none).toContain('color: var(--text)');
  });

  it('优先级按钮带 prio-* 类，选中高 / 中 / 低不再走 accent 绿', () => {
    const high = render(makeStore(parseSingleLine('(A) 写周报 id:aaa111')));
    const picker = (high.match(/<div class="priority-picker">([\s\S]*?)<\/div>/) || [])[1] || '';
    expect(picker).toContain('prio-high sel');
    for (const cls of ['prio-none', 'prio-high', 'prio-mid', 'prio-low']) {
      expect(picker).toContain(cls);
    }
    const none = render(makeStore(parseSingleLine('写周报 id:aaa111')));
    expect(none).toContain('prio-none sel');
  });
});

// ② 结构约束：Hooks 的数量必须在每次渲染里恒定。
//
// 直接读源码而不是靠渲染去撞 —— 服务端渲染每次都是全新实例，撞不出
// "Rendered more hooks than during the previous render."。这条规则只能静态守。
describe('EditDrawer 的 Hook 规则', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'EditDrawer.jsx'),
    'utf8'
  );
  const lines = src.split('\n');

  it('提前 return 之后不再调用任何 Hook', () => {
    const violations = [];
    let inGuard = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      // 组件主体的提前 return（`  if (...) return null;` 这类）
      if (/^\s{2}if\s*\(.*\)\s*return\s+null;\s*$/.test(line)) inGuard = true;
      // 下一个顶层定义开始，说明上一个函数体已经结束
      if (/^(?:export\s+)?(?:default\s+)?(?:function|const|class)\s/.test(line) && i > 0) inGuard = false;
      if (!inGuard) continue;
      const code = line.split('//')[0];
      const m = code.match(/\buse[A-Z]\w*\s*\(/g);
      if (m) violations.push(`${i + 1}: ${m.join(', ')}`);
    }
    expect(violations).toEqual([]);
  });

  it('表单状态与提交参数里不再有 thresholdDate', () => {
    expect(src).not.toContain('form.thresholdDate');
    expect(src).not.toContain('task.thresholdDate');
    expect(src).not.toContain('thresholdDate:');
  });

  it('说明文案与写入行预览已移除，标题栏不再挂旗标开关', () => {
    expect(src).not.toContain('field-hint');
    expect(src).not.toContain('drawer-preview');
    expect(src).not.toContain('star-toggle');
  });

  it('候选清单挂到 body，不再被 .drawer-body 的滚动区裁掉首行', () => {
    expect(src).toContain('createPortal');
    expect(src).toContain('computeTagMenuPlacement');
    expect(src).toContain('document.body');
    expect(src).not.toContain('drop-up');
    expect(src).not.toContain("closest('.edit-window')");
  });

  it('候选清单的 Esc 只收清单，外部点击放行菜单自身', () => {
    expect(src).toContain("document.addEventListener('keydown', onKey, true)");
    expect(src).toContain('menuRef.current?.contains(e.target)');
    expect(src).toContain('onMenuKeyDown');
  });

  it('字段重排与单入口：优先级 + 重复同行、两个日期同行、备注不叠第二层', () => {
    expect(src).toContain('field-row-prio');
    expect(src).toContain('field-sep');
    expect(src).not.toContain('field-note-head');
    expect(src).not.toContain('date-clear-btn');
    expect(src).not.toContain('PriorityMark');
  });

  it('子任务文本可就地编辑，完成 / 取消完成走同一个 store 动作', () => {
    expect(src).toContain('subtask-title-input');
    expect(src).toContain('onBlur={commitEdit}');
    expect(src).toContain('store.toggleComplete(k)');
    expect(src).toContain('store.fadingIds');
    // 点完成 / 删除时先拦住 mousedown，否则输入框 onBlur 会隐式写回一次标题
    expect((src.match(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/g) || [])).toHaveLength(2);
  });
});
