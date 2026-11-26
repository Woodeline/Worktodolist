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
import EditDrawer, { formSignature } from './EditDrawer.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseSingleLine } from '../lib/todoParser.js';
import { RECURRENCE_CHOICES } from '../lib/recurrence.js';

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
    // 重复档位是自绘下拉（原生 <select> 的弹出层由系统绘制，风格不受控）：
    // 触发器上直接读出当前档「每周一」，而不是一个看不出值的空框
    expect(markup).toContain('select-trigger');
    expect(markup).toContain('>每周一<');
    // 分类 / 标签是胶囊：值读在 <b> 里（带前缀），不再是输入框的 value
    expect(markup).toContain('>@工作<');
    expect(markup).toContain('>+回测<');
    // 卡头不再显示文件坐标（id / 行号已撤，2026-11-18 三改）：标题是这张卡的第一行字
    expect(markup).not.toContain('id:aaa111');
    expect(markup).not.toContain('drawer-meta');
    expect(markup).toContain('drawer-headline');
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
    // 原生 <select> 已退场（它的弹出层是系统绘制的深灰长菜单，与浮窗两个语气）：
    // 四档改由自绘菜单承载，静态渲染只画得出当前档，所以这里验常量与源码。
    for (const label of ['从不', '每日', '每周', '每月']) {
      expect(RECURRENCE_CHOICES.map((c) => c.label)).toContain(label);
    }
    expect(markup).toContain('>从不<');
    expect(markup).not.toContain('<select');
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
    // 当前档直接读在触发器上（自绘下拉不需要「选中项」这种只有展开才看得见的表达）
    expect(markup).toContain('>每周一<');
    expect(markup).not.toContain('<select');
  });

  it('不再显示与按钮重复的操作说明（少写说明，让布局自己说话）', () => {
    const task = parseSingleLine('写周报 id:aaa111');
    const markup = render(makeStore(task));
    expect(markup).not.toContain('回车保存');
    expect(markup).not.toContain('drawer-hint');
  });

  it('备注块头只有刻度 + 一枚入口按钮，不再叠两层动作', () => {
    const markup = render(makeStore(parseSingleLine('写周报 id:aaa111')));
    expect(markup).toContain('添加备注');
    expect(markup.match(/note-edit-btn/g) || []).toHaveLength(1);
    expect(markup).not.toContain('field-note-head');
    // 「备注」二字只以刻度（drawer-key）出现一次，不是第二颗按钮
    expect((markup.match(/>备注</g) || [])).toHaveLength(1);
    expect(markup).toContain('drawer-key');
  });

  it('有备注时按钮改叫「编辑备注」，仍然只有一个入口', () => {
    const markup = render(makeStore(parseSingleLine('写周报 id:aaa111'), {
      getNote: () => '记得附上上周的数据',
    }));
    expect(markup).toContain('编辑备注');
    expect(markup).toContain('note-display');
    expect(markup.match(/note-edit-btn/g) || []).toHaveLength(1);
  });

  it('优先级是一把刻度尺：无 → 低 → 中 → 高，旗标随档，整组只停一次 Tab', () => {
    const markup = render(makeStore(parseSingleLine('写周报 id:aaa111')));
    const ruler = (markup.match(/<div class="prio-ruler"[\s\S]*?<\/div>/) || [])[0] || '';
    expect(ruler).toContain('role="radiogroup"');
    // 段序从低到高（与尺子的读法一致），「无」不画旗
    const order = ['无', '低', '中', '高'].map((l) => ruler.indexOf(`>${l}</span>`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect((ruler.match(/<svg/g) || [])).toHaveLength(3); // 低 / 中 / 高 三面旗
    // roving tabindex：只有选中档可 Tab
    expect((ruler.match(/tabindex="0"/g) || [])).toHaveLength(1);
    expect((ruler.match(/tabindex="-1"/g) || [])).toHaveLength(3);
    expect(markup).not.toContain('prio-seg');
  });

  it('子任务与备注各是一个块：块头带刻度 / 计数 / 进度线，新增是一条加号线', () => {
    const parent = parseSingleLine('写周报 id:aaa111');
    const kid = parseSingleLine('拆后盖 parent:aaa111 id:bbb222');
    const markup = render(makeStore(parent, { todoEntries: [parent, kid] }));
    expect(markup).toContain('drawer-bhead');
    expect(markup).toContain('subtask-progress');
    expect(markup).toContain('subtask-count');
    expect(markup).toContain('>0/1<');
    // 旧的双分割线版式已退场：块与块靠 margin 分开，不再画 field-sep
    expect(markup).not.toContain('field-sep');
    expect(markup).toContain('subtask-addline');
    expect(markup).toContain('添加子任务');
    expect(markup).toContain('添加备注');
    // 子任务块在备注块之前
    expect(markup.indexOf('subtask-addline')).toBeLessThan(markup.indexOf('note-edit-btn'));
  });
});

describe('编辑浮窗：2026-11-18 登记卡版式契约', () => {
  it('题头 18 / 500，底线式标题；卡头 / 正文统一 --row-pad，底栏收 14px', () => {
    const title = cssRule('.drawer-title-input');
    // 18 是窗口里唯一大于读数的量级（专用档 --fs-drawer-title，不动冻结 8 档）
    expect(title).toContain('font-size: var(--fs-drawer-title)');
    expect(title).toContain('font-weight: var(--fw-emph)');
    // 标题是一行字不是一个框：平时无边框，hover / focus 只动底线
    expect(title).toContain('border-bottom: 1px solid transparent');
    expect(cssRule('.drawer-title-input:hover')).toContain('border-bottom-color: var(--border)');
    expect(cssRule('.drawer-title-input:focus')).toContain('border-bottom-color: var(--accent)');
    expect(cssRule('.drawer-header')).toContain('var(--row-pad)');
    expect(cssRule('.drawer-body')).toContain('var(--row-pad)');
    expect(cssRule('.drawer-actions')).toContain('padding: 0 14px');
    expect(css).toContain('--fs-drawer-title: 18px');
  });

  it('标题与关闭钮同一行，卡头不再有一行只有叉号的空行（2026-11-18 四改）', () => {
    expect(drawerSrc).not.toContain('drawer-meta');
    expect(drawerSrc).not.toContain('lineNo');
    expect(css).not.toContain('.drawer-meta');
    // 独占一行的关闭条已撤
    expect(drawerSrc).not.toContain('drawer-topbar');
    expect(css).not.toContain('.drawer-topbar');
    // 标题行：flex 居中，标题吃掉余宽、叉号不被压缩
    const row = cssRule('.drawer-headline');
    expect(row).toContain('display: flex');
    expect(row).toContain('align-items: center');
    expect(cssRule('.drawer-title-input')).toContain('flex: 1 1 auto');
    expect(cssRule('.drawer-close')).toContain('flex: 0 0 auto');
    // 标题行是卡头的第一段，读数条在它下面
    expect(drawerSrc.indexOf('drawer-headline')).toBeLessThan(drawerSrc.indexOf('drawer-strip'));
    // 卡头顶留白只剩标题自己的天头（不再叠一个 24px 按钮行）
    expect(cssRule('.drawer-header')).toContain('padding: 18px var(--row-pad)');
    expect(drawerSrc).toContain('aria-label="关闭"');
  });

  it('宽度只认 --edit-window-w（400），内容的 min-content 不再把窗口撑宽', () => {
    expect(css).toContain('--edit-window-w: 400px');
    const win = cssRule('.edit-window');
    expect(win).toContain('width: var(--edit-window-w)');
    expect(win).toContain('min-width: 0');
    expect(win).toContain('flex: 0 0 var(--edit-window-w)');
  });

  it('值 12 / 刻度 10：刻度是 mono-cjk 小字，比任何值都小一档', () => {
    expect(css).toContain('--fs-3xs: 10px');
    expect(cssRule('.edit-window')).toContain('font-size: var(--fs-xs)');
    const key = cssRule('.drawer-key');
    expect(key).toContain('font-size: var(--fs-3xs)');
    expect(key).toContain('font-family: var(--font-mono-cjk)');
    expect(key).toContain('color: var(--muted)');
    // 行内控件的值统一 12px
    const cell = cssRule('.drawer-cell .select-trigger,\n.drawer-cell .date-field-btn');
    expect(cell).toContain('font-size: var(--fs-xs)');
  });

  it('刻度行：左列 84px 刻度 + 右列控件，行间 --row-line 细线', () => {
    const row = cssRule('.drawer-row');
    expect(row).toContain('grid-template-columns: 84px minmax(0, 1fr)');
    expect(row).toContain('min-height: 36px');
    expect(row).toContain('border-bottom: 1px solid var(--row-line)');
    expect(cssRule('.drawer-row:last-child')).toContain('border-bottom: 0');
    expect(cssRule('.drawer-rows')).toContain('border-top: 1px solid var(--border)');
    // 六个属性各占一行，data-field 是读数条捷径的锚点
    for (const f of ['prio', 'rec', 'due', 'rem', 'ctx', 'prj']) {
      expect(drawerSrc).toContain(`data-field="${f}"`);
    }
  });

  it('行内控件平时透明，hover 才浮 field-bg，focus / 展开才见 accent', () => {
    const cell = cssRule('.drawer-cell .select-trigger,\n.drawer-cell .date-field-btn');
    expect(cell).toContain('background: transparent');
    expect(cell).toContain('border: 1px solid transparent');
    const hover = cssRule('.drawer-cell .select-trigger:hover,\n.drawer-cell .date-field-btn:hover');
    expect(hover).toContain('background: var(--field-bg)');
    expect(hover).not.toContain('border-color');
    const focus = cssRule('.drawer-cell .select-trigger:focus-visible,\n.drawer-cell .date-field-btn:focus-visible');
    expect(focus).toContain('border-color: var(--accent)');
    const open = cssRule('.drawer-cell .select-trigger.is-open,\n.drawer-cell .date-field-btn[aria-expanded="true"]');
    expect(open).toContain('background: var(--field-bg)');
    expect(open).toContain('border-color: var(--accent)');
  });

  it('读数条四枚常驻卡头，点它去开行内控件（不另养第二份弹层状态）', () => {
    const task = parseSingleLine('(B) 交周报 due:2026-10-25 rec:mon rem:2026-10-23T15:00 id:aaa111');
    const markup = render(makeStore(task));
    expect((markup.match(/drawer-read/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(markup).toContain('drawer-strip');
    // 日期读数 + 相对日读数都在条上
    expect(markup).toContain('2026/10/25');
    expect(markup).toContain('drawer-read-rel');
    // 捷径委托给行内控件：jumpField 按 data-field 找触发器并 click
    expect(drawerSrc).toContain('const jumpField = (field, selector) => {');
    expect(drawerSrc).toContain("jumpField('due', '.date-field-btn')");
    expect(drawerSrc).toContain("jumpField('rec', '.select-trigger')");
    expect(drawerSrc).toContain("jumpField('rem', '.date-field-btn')");
    expect(drawerSrc).toContain('const focusPrio = () => {');
  });

  it('逾期读数染 danger，未设置退成透明底（颜色只编码状态）', () => {
    const past = render(makeStore(parseSingleLine('交周报 due:2020-01-01 id:aaa111')));
    expect(past).toContain('drawer-read is-overdue');
    const none = render(makeStore(parseSingleLine('交周报 id:aaa111')));
    expect(none).toContain('drawer-read is-empty');
    expect(cssRule('.drawer-read.is-overdue')).toContain('background: var(--danger-soft)');
    expect(cssRule('.drawer-read.is-overdue')).toContain('color: var(--danger)');
    expect(cssRule('.drawer-read.is-empty')).toContain('background: transparent');
  });

  it('正文滚动上限 480：卡头与底栏常驻，只有刻度行与备注在滚', () => {
    expect(css).toContain('--drawer-body-max-h: 480px');
    const body = cssRule('.drawer-body');
    expect(body).toContain('max-height: var(--drawer-body-max-h)');
    expect(body).toContain('overflow-y: auto');
  });

  it('备注按钮并入幽灵家族，带纸页图标；展开后写在 sheet 纸页上', () => {
    const store = makeStore(parseSingleLine('写周报 id:aaa111'));
    const markup = render(store);
    const noteBtn = (markup.match(/<button[^>]*note-edit-btn[\s\S]*?<\/button>/) || [''])[0];
    expect(noteBtn).toContain('添加备注');
    expect(noteBtn).toContain('btn-ghost');
    expect(noteBtn).toContain('<svg'); // file 图标：notes.md 那张纸
    expect(drawerSrc).not.toContain("'pencil'");
    expect(cssRule('.edit-window .note-edit-btn')).toContain('height: var(--h-control)');
    expect(cssRule('.edit-window .note-edit-btn')).not.toContain('border:');
    // 纸页：sheet 三件套 + 22px 行距；textarea 透明写在纸上
    const paper = cssRule('.note-paper');
    expect(paper).toContain('background: var(--sheet-bg)');
    expect(paper).toContain('border: 1px solid var(--sheet-line)');
    expect(paper).toContain('line-height: 22px');
    const input = cssRule('.note-input');
    expect(input).toContain('background: transparent');
    expect(input).toContain('border: 0');
    expect(input).toContain('line-height: 22px');
    // 收起态只夹两行
    expect(cssRule('.note-clip')).toContain('-webkit-line-clamp: 2');
  });

  it('底栏取整 40 / 28，与窗体同底；触屏 44px 兜底被更高特异性的 min-height 压住', () => {
    expect(css).toContain('--drawer-actions-h: 40px');
    expect(css).toContain('--drawer-action-h: var(--h-control)');
    const foot = cssRule('.drawer-actions');
    expect(foot).toContain('height: var(--drawer-actions-h)');
    expect(foot).toContain('background: var(--surface)');
    const btn = cssRule('.drawer-actions .btn');
    expect(btn).toContain('height: var(--drawer-action-h)');
    expect(btn).toContain('min-height: var(--drawer-action-h)');
  });

  it('分类 / 标签是胶囊：22px pill + 移除钮，手输是下划线，候选是虚线小箭头', () => {
    const chip = cssRule('.tag-chips .chip');
    expect(chip).toContain('height: 22px');
    expect(chip).toContain('border-radius: var(--r-pill)');
    expect(chip).toContain('background: var(--surface-2)');
    expect(cssRule('.tag-chips .chip b')).toContain('font-weight: var(--fw-body)');
    expect(cssRule('.tag-chips .chip button:hover')).toContain('color: var(--danger)');
    const add = cssRule('.chip-add');
    expect(add).toContain('border: 1px dashed var(--control-line)');
    expect(cssRule('.chip-add:hover')).toContain('background: var(--accent-soft)');
    const input = cssRule('.edit-window .tag-chips .chip-input');
    expect(input).toContain('border-bottom: 1px solid var(--accent)');
    expect(input).toContain('height: 22px');
    // 标签胶囊带 6px 色点（与侧栏圆点同源）
    const dot = cssRule('.chip-dot');
    expect(dot).toContain('width: 6px');
    expect(dot).toContain('box-shadow: 0 0 0 1px var(--dot-edge)');
    // 旧的一体化输入框已退场
    expect(css).not.toContain('.tag-input {');
    expect(css).not.toContain('.tag-toggle {');
  });

  it('子任务行是三列网格（16 / 1fr / 20），行高 26，就地编辑是一条下划线', () => {
    const li = cssRule('.subtask-list li');
    expect(li).toContain('grid-template-columns: 16px minmax(0, 1fr) 20px');
    expect(li).toContain('min-height: 26px');
    expect(li).toContain('border-bottom: 1px solid var(--row-line-child)');
    expect(cssRule('.subtask-list li:last-child')).toContain('border-bottom: 0');
    const cb = cssRule('.subtask-list .checkbox');
    expect(cb).toContain('width: 16px');
    expect(cb).toContain('height: 16px');
    expect(cb).toContain('border-radius: var(--r-xs)');
    expect(cssRule('.subtask-list .checkbox.checked')).toContain('background: var(--accent)');
    const edit = cssRule('.edit-window .subtask-list .subtask-title-input');
    expect(edit).toContain('height: 22px');
    expect(edit).toContain('border-bottom: 1px solid var(--accent)');
    expect(edit).toContain('background: transparent');
    expect(cssRule('.drawer-block')).toContain('margin-top: var(--sp-4)');
  });

  it('优先级刻度尺：基线 + 四档，选中档下方 2px 本色刻度，颜色取旗帜令牌', () => {
    const ruler = cssRule('.prio-ruler');
    expect(ruler).toContain('height: 30px');
    expect(cssRule('.prio-ruler::before')).toContain('background: var(--border-strong)');
    const tick = cssRule('.prio-ruler > button.sel::after');
    expect(tick).toContain('height: 2px');
    expect(tick).toContain('background: currentColor');
    for (const [cls, ink] of [
      ['high', '--flag-high'],
      ['mid', '--flag-mid-ink'],
      ['low', '--flag-low'],
    ]) {
      expect(cssRule(`.prio-ruler > button.sel.prio-${cls}`)).toContain(`color: var(${ink})`);
    }
    // 刻度尺不画底色块 / 内描边：选中感交给那道本色刻度
    for (const cls of ['high', 'mid', 'low']) {
      const body = cssRule(`.prio-ruler > button.sel.prio-${cls}`);
      expect(body).not.toContain('background');
      expect(body).not.toContain('box-shadow');
    }
    expect(cssRule('.prio-ruler > button')).toContain('border: 0');
    expect(css).not.toContain('.prio-seg {');
  });

  it('优先级选中态渲染：高 / 中 / 低 / 无各归其位，手写档不冒充三档', () => {
    const high = render(makeStore(parseSingleLine('(A) 写周报 id:aaa111')));
    const ruler = (high.match(/<div class="prio-ruler"[\s\S]*?<\/div>/) || [])[0] || '';
    expect(ruler).toContain('prio-high sel');
    for (const cls of ['prio-none', 'prio-high', 'prio-mid', 'prio-low']) {
      expect(ruler).toContain(cls);
    }
    const none = render(makeStore(parseSingleLine('写周报 id:aaa111')));
    expect(none).toContain('prio-none sel');
    const other = render(makeStore(parseSingleLine('(D) 写周报 id:aaa111')));
    expect(other).toContain('prio-other sel');
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

  it('刻度行版式与单入口：六行属性 + 读数条捷径，备注不叠第二层', () => {
    expect(src).toContain('drawer-rows');
    expect(src).toContain('drawer-strip');
    expect(src).toContain('jumpField');
    expect(src).not.toContain('field-row-prio');
    expect(src).not.toContain('field-sep');
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

// P0（2026-11-17 二改）：这一档只修「会写坏数据 / 会误删」的两处风险，
// 不碰设计语言。行为靠 DOM 事件驱动，而项目没有 jsdom，所以沿用仓库里既有的
// 「源码契约 + 样式契约」两层静态断言 —— 它们能守住"守卫还在"，渲染冒烟守不住行为。
describe('编辑浮窗 P0：空标题守卫与删除二次确认', () => {
  it('空标题保存被拦下，标题框转危险态并拿回焦点', () => {
    expect(drawerSrc).toContain('const title = form.title.trim();');
    expect(drawerSrc).toContain('if (!title) {');
    expect(drawerSrc).toContain('setTitleError(true)');
    expect(drawerSrc).toContain('titleRef.current?.focus()');
    // 保存按钮不禁用：禁用只让「点了没反应」失去解释
    expect(drawerSrc).not.toContain('disabled={!form.title.trim()}');
    expect(drawerSrc).toContain("aria-invalid={titleError || undefined}");
    // 改动标题即撤掉危险态
    expect(drawerSrc).toContain('if (titleError) setTitleError(false);');
    expect(css).toContain('.drawer-title-input.is-error');
    expect(css).toContain('--ring-danger:');
  });

  it('删除要点两下：第一下换成「确认删除」，第二下才落盘', () => {
    const markup = render(makeStore(parseSingleLine('写周报 id:aaa111')));
    expect(markup).toContain('drawer-delete');
    expect(markup).toContain('删除');
    expect(drawerSrc).toContain("deleteArmed ? '确认删除' : '删除'");
    expect(drawerSrc).toContain('if (!deleteArmed) {');
    // 实心待确认态：字压在 --danger 上，明暗两套各自翻转
    const armed = cssRule('.btn-ghost.is-danger.is-armed,\n.btn-ghost.is-danger.is-armed:hover:not(:disabled)');
    expect(armed).toContain('background: var(--danger)');
    expect(css).toContain('--danger-fg:');
  });

  it('待确认态可反悔：Esc 先撤这一步，点窗内别处也撤', () => {
    expect(drawerSrc).toContain('if (deleteArmed) {');
    expect(drawerSrc).toContain('setDeleteArmed(false)');
    expect(drawerSrc).toContain("e.target.closest('.drawer-delete')");
  });

  it('子任务新增是一条加号线，点开后输入框是 26px 下划线', () => {
    const line = cssRule('.subtask-addline');
    expect(line).toContain('min-height: 26px');
    expect(line).toContain('color: var(--muted)');
    expect(cssRule('.subtask-addline:hover')).toContain('color: var(--accent)');
    const input = cssRule('.subtask-add input');
    expect(input).toContain('height: 26px');
    expect(input).toContain('border-bottom: 1px solid var(--border)');
    expect(cssRule('.subtask-add input:focus')).toContain('border-bottom-color: var(--accent)');
    // 旧的「输入框 + 添加按钮」两半版式已退场
    expect(css).not.toContain('.edit-window .subtask-add .btn');
  });

  it('hover 不再把控件描边跳成 accent，只浮出一档底色', () => {
    // 登记卡的行内控件：透明 → field-bg（不是描边变色）
    const hover = cssRule('.drawer-cell .select-trigger:hover,\n.drawer-cell .date-field-btn:hover');
    expect(hover).toContain('background: var(--field-bg)');
    expect(hover).not.toContain('border-color');
    // 焦点仍然只认 accent —— 那是它唯一该出场的地方
    const focus = cssRule('.drawer-cell .select-trigger:focus-visible,\n.drawer-cell .date-field-btn:focus-visible');
    expect(focus).toContain('border-color: var(--accent)');
    // 胶囊添加钮 hover 走 accent 淡底（它是动作入口，不是读数格）
    expect(cssRule('.chip-add:hover')).toContain('border-color: var(--accent)');
  });
});

// P2（2026-11-17 二改）：体感层。每一项都独立，共同点是「只在有信息时出现」——
// 没改动就不弹确认、没数字就不画读数。
describe('编辑浮窗 P2：动效、脏状态、读数与深色描边', () => {
  it('表单指纹只认 save 会写回的字段，并把分类 / 标签按逗号归一', () => {
    const base = {
      title: '交周报',
      priority: 'A',
      dueDate: '2026-10-25',
      remindAt: '',
      recurrence: 'mon',
      contexts: '工作, 生活',
      projects: '回测',
      note: '',
      starred: true,
    };
    expect(formSignature(base)).toBe(formSignature({ ...base }));
    // 多敲一个空格 / 换个分隔符不算改动（写回文件的结果一样）
    expect(formSignature({ ...base, contexts: ' 工作 , 生活 ' })).toBe(formSignature(base));
    // 真正会写坏的字段一改就变
    expect(formSignature({ ...base, priority: 'B' })).not.toBe(formSignature(base));
    expect(formSignature({ ...base, title: '交周报 ' })).toBe(formSignature(base));
    expect(formSignature({ ...base, note: '附上周数据' })).not.toBe(formSignature(base));
    expect(formSignature({ ...base, starred: false })).not.toBe(formSignature(base));
  });

  it('「未保存」是底栏上的一条读数，且有改动才出现', () => {
    expect(drawerSrc).toContain('const dirty = formSignature(form) !== initialRef.current;');
    expect(drawerSrc).toContain('{dirty && (');
    expect(drawerSrc).toContain('未保存');
    const readout = cssRule('.drawer-dirty');
    expect(readout).toContain('font-size: var(--fs-2xs)');
    expect(readout).toContain('font-family: var(--font-mono-cjk)');
    // 干净的浮窗不该出现这条读数
    expect(render(makeStore(parseSingleLine('写周报 id:aaa111')))).not.toContain('drawer-dirty');
  });

  it('关闭的三条路径都先问一句，且只在有改动时问', () => {
    // Esc / 取消 / 遮罩 / 右上角 × 全部走 requestClose，不再各自调 closeEditor
    expect(drawerSrc).toContain('const requestClose = () => {');
    expect(drawerSrc).toContain('if (dirty) {');
    expect(drawerSrc).toContain('setDiscardAsk(true)');
    expect((drawerSrc.match(/requestClose/g) || [])).toHaveLength(5); // 定义 + Esc + 遮罩 + × + 取消
    expect((drawerSrc.match(/onClick=\{requestClose\}/g) || [])).toHaveLength(2);
    expect(drawerSrc).not.toContain('onClick={store.closeEditor}');
    expect(cssRule('.drawer-confirm')).toContain('z-index: 90');
  });

  it('确认层里绿色的那个是「继续编辑」，放弃放左边用红字', () => {
    const block = (drawerSrc.match(/discardAsk && \(([\s\S]*?)\n      \)\}/) || [])[1] || '';
    expect(block).toContain('放弃修改');
    expect(block).toContain('继续编辑');
    // btn-ghost is-danger 在前、btn-primary 在后：默认答案是"回到表单"
    expect(block.indexOf('btn-ghost is-danger')).toBeLessThan(block.indexOf('btn-primary'));
    expect(block).toContain('role="alertdialog"');
  });

  it('保存后补一条 toast（store 没这个能力时静默跳过）', () => {
    expect(drawerSrc).toContain("if (typeof store.showToast === 'function') store.showToast('已保存');");
    // 测试用的最小 store 没有 showToast，渲染与保存都不能因此崩
    expect(() => render(makeStore(parseSingleLine('写周报 id:aaa111')))).not.toThrow();
  });

  it('日期与子任务计数走等宽族，刻度标签走 mono-cjk', () => {
    expect(cssRule('\n.date-field-text')).toContain('font-family: var(--font-mono)');
    expect(cssRule('.subtask-count')).toContain('font-family: var(--font-mono)');
    expect(cssRule('.drawer-num')).toContain('font-family: var(--font-mono)');
    expect(cssRule('.drawer-key')).toContain('font-family: var(--font-mono-cjk)');
  });

  it('「未保存」读数转 warn 琥珀并前置一枚 5px 圆点', () => {
    const readout = cssRule('.drawer-dirty');
    expect(readout).toContain('color: var(--warn)');
    const dot = cssRule('.drawer-dirty::before');
    expect(dot).toContain('width: 5px');
    expect(dot).toContain('height: 5px');
    expect(dot).toContain('background: var(--warn)');
  });

  it('深色描边压回 3:1 一侧，窗体外缘补一道 1px 暗线', () => {
    // #8f8c81 对纸面 5.01:1 —— 一屏八个控件就是八圈发光的线
    expect(css).not.toContain('--control-line: #8f8c81');
    expect(css).toContain('--control-line: #77736a');
    expect(css).toContain(':root[data-theme="dark"] .edit-window');
    expect(cssRule(':root[data-theme="dark"] .edit-window')).toContain('0 0 0 1px var(--border-strong)');
  });

  it('额外标签胶囊弱化成「给机器看的原文」，不再冒充用户标签', () => {
    const chip = cssRule('.edit-window .extra-tags .chip');
    expect(chip).toContain('background: var(--surface-2)');
    expect(chip).toContain('border-color: transparent');
    expect(chip).toContain('color: var(--muted)');
  });

  it('入场只动 opacity / transform，不碰盒尺寸', () => {
    expect(css).toContain('animation: window-in var(--dur-2) var(--ease-out) backwards');
    const frames = (css.match(/@keyframes window-in \{([\s\S]*?)\n\}/) || [])[1] || '';
    expect(frames).toContain('translateY(6px)');
    expect(frames).not.toContain('height');
    expect(frames).not.toContain('margin');
  });
});

// 原生 <select> 的弹出层由系统绘制（macOS 上是深灰长菜单 + 系统对勾），既不吃本项目的
// 明暗令牌，也和这扇「一页纸」浮窗完全两个语气。换成自绘单选下拉后，外观与 @分类 / +标签
// 候选清单共用一套，行为也由自己决定 —— 这几条守住「不许退回原生控件」。
describe('重复档位：自绘下拉（原生 select 退场）', () => {
  it('触发器在登记卡里是透明读数格：hover 浮 field-bg，展开才见 accent', () => {
    const cell = cssRule('.drawer-cell .select-trigger,\n.drawer-cell .date-field-btn');
    expect(cell).toContain('background: transparent');
    expect(cell).toContain('min-height: 28px');
    const hover = cssRule('.drawer-cell .select-trigger:hover,\n.drawer-cell .date-field-btn:hover');
    expect(hover).toContain('background: var(--field-bg)');
    // accent 只留给焦点与展开态，不许拿它染 hover
    expect(hover).not.toContain('accent');
    expect(cssRule('.drawer-cell .select-trigger.is-open,\n.drawer-cell .date-field-btn[aria-expanded="true"]')).toContain('border-color: var(--accent)');
  });

  it('展开面复用候选清单那套（.tag-menu / .tag-option + 先量后放）', () => {
    expect(drawerSrc).toContain('computeTagMenuPlacement');
    expect(drawerSrc).toContain('createPortal');
    expect(drawerSrc).toContain('className="tag-menu"');
    expect(drawerSrc).toContain("className={'tag-option' + (on ? ' sel' : '')}");
    expect(drawerSrc).toContain('role="listbox"');
    expect(drawerSrc).toContain('role="option"');
  });

  it('单选语义：只标当前档、方向键与 Home/End 移动、Esc 只收菜单', () => {
    expect(drawerSrc).toContain('aria-selected={on}');
    expect(drawerSrc).toContain("e.key !== 'ArrowDown' && e.key !== 'ArrowUp'");
    expect(drawerSrc).toContain("e.key === 'Home'");
    expect(drawerSrc).toContain("e.key === 'End'");
    // Esc 在捕获阶段截断：只收菜单，不把整个浮窗一起关掉
    expect(drawerSrc).toContain("if (e.key !== 'Escape') return;");
  });

  it('点菜单外部收菜单，但放行菜单自身（否则 mousedown 先收、click 落空）', () => {
    expect(drawerSrc).toContain('menuRef.current?.contains(e.target)');
    expect(drawerSrc).toContain('boxRef.current?.contains(e.target)');
  });

  it('Tab 落点自己算：菜单挂在 body 末尾，交给浏览器会退到「保存」', () => {
    expect(drawerSrc).toContain(
      'nextInTrap(queryFocusable(containerRef?.current), triggerRef.current, e.shiftKey)'
    );
    // 落点必须从触发器起算（容器是浮窗，不是 body）—— 否则 Shift+Tab 一路退到文档末尾
    expect(drawerSrc).toContain('containerRef={winRef}');
  });

  it('Enter / Space 显式激活当前项，不依赖 button 的默认激活', () => {
    expect(drawerSrc).toContain("e.key === 'Enter' || e.key === ' '");
    expect(drawerSrc).toContain("cur.getAttribute('role') === 'option'");
  });

  it('浮窗里不再有任何原生 <select>', () => {
    expect(drawerSrc).not.toContain('<select');
  });
});
