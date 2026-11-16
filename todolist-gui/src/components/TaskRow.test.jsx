// 子任务展示的渲染冒烟。
//
// 逻辑层（subtasks.js）已经有完整断言，这里只补最后一公里：
// 「层级真的变成了缩进类」「进度真的显示成了 1/3」「重复标记真的渲染出来」。
// 这几处失效同样是静默的 —— prop 传漏了界面不会报错，只是退回成看不出关系的一排行。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskRow, { Highlight } from './TaskRow.jsx';
import InlineTitleEditor from './InlineTitleEditor.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseSingleLine } from '../lib/todoParser.js';

function render(task, props, storeOverride) {
  const store = {
    noteIds: new Set(),
    fadingIds: [],
    spawnedIds: [],
    enteringIds: [],
    dropInfo: null,
    sortMode: 'manual',
    view: 'all',
    focusedId: null,
    dragId: null,
    setFocusedId: () => {},
    openEditor: () => {},
    toggleComplete: () => {},
    updateTask: () => {},
    deleteTask: () => {},
    setDragId: () => {},
    setDropInfo: () => {},
    reorder: () => {},
    ...storeOverride,
  };
  return renderToStaticMarkup(
    <ContextMenuProvider>
      <TaskRow task={task} store={store} {...props} />
    </ContextMenuProvider>
  );
}

describe('TaskRow 子任务展示', () => {
  it('子任务行带缩进类 is-child', () => {
    const kid = parseSingleLine('拆后盖 parent:p00002');
    expect(render(kid, { depth: 1 })).toContain('is-child');
  });

  it('顶层行不带缩进类', () => {
    const parent = parseSingleLine('装机 id:p00002');
    expect(render(parent, { depth: 0 })).not.toContain('is-child');
  });

  it('父任务显示进度 1/3', () => {
    const parent = parseSingleLine('装机 id:p00002');
    expect(render(parent, { kids: { done: 1, total: 3 } })).toContain('1/3');
  });

  it('没有子任务时不显示进度', () => {
    const parent = parseSingleLine('装机 id:p00002');
    const markup = render(parent, { kids: { done: 0, total: 0 } });
    expect(markup).not.toContain('sub-count');
  });
});

describe('TaskRow 重复标记', () => {
  it('带 rec: 的任务显示 ↻ 和规则正文，完整表达式也写进 title', () => {
    const t = parseSingleLine('交周报 rec:mon,thu');
    const markup = render(t);
    expect(markup).toContain('meta-field');
    // 2026-11-16 十四改：段间加了竖线之后，一枚孤零的 ↻ 夹在两条线中间读不出是什么，
    // 所以规则正文也上屏（describeRecurrence 本来就是中文短语）。
    expect(markup).toContain('每周一、四');
    expect(markup).toContain('重复：每周一、四');
  });

  it('不带 rec: 的任务没有重复标记', () => {
    expect(render(parseSingleLine('交周报'))).not.toContain('meta-field');
  });

  it('认不出的 rec: 也不显示标记（它已经降级成普通标签）', () => {
    expect(render(parseSingleLine('交周报 rec:每周一'))).not.toContain('meta-field');
  });
});

describe('TaskRow 备注标记', () => {
  it('有备注的任务显示 ✎', () => {
    const markup = render(parseSingleLine('写周报 id:aaa111'), {}, { noteIds: new Set(['aaa111']) });
    expect(markup).toContain('note-chip');
  });

  it('没备注的任务不显示', () => {
    expect(render(parseSingleLine('写周报 id:aaa111'))).not.toContain('note-chip');
  });

  it('没有 id 的任务永远不长角标 —— 没有 id 就挂不住备注', () => {
    const markup = render(parseSingleLine('写周报'), {}, { noteIds: new Set(['aaa111']) });
    expect(markup).not.toContain('note-chip');
  });
});

// 动效类名：CSS 只认类名，store 只发类名 —— 这一层断在哪边界面都看不出来，
// 所以每条动效状态都在这里钉一个渲染断言。
describe('TaskRow 动效类名', () => {
  it('退场窗口内的行带 completing，复选框按已勾上预览', () => {
    const t = parseSingleLine('交周报');
    const markup = render(t, {}, { fadingIds: [t.id] });
    expect(markup).toContain('completing');
    // 数据还没提交，但勾选框要先「演」出结果，否则点了 180ms 内没有任何反馈
    expect(markup).toContain('checkbox checked');
  });

  it('已完成行（done.txt）不带 completing —— 不给静态列表挂常驻动画', () => {
    const t = parseSingleLine('x 2026-10-01 交周报');
    expect(t.completed).toBe(true);
    const markup = render(t, {}, { fadingIds: [t.id] });
    expect(markup).not.toContain('completing');
  });

  it('重复任务的新生行带 spawned（交接高亮）', () => {
    const t = parseSingleLine('交周报');
    expect(render(t, {}, { spawnedIds: [t.id] })).toContain('spawned');
  });

  // 交接高亮若只闪背景，用户读到的仍是「点了一下、没消失、又冒出来」：
  // 新生行与刚完成那行标题 / 优先级 / 位置全同，唯一变的是折起来的 due。
  // 所以 spawned 期间必须把读数行展开（与悬停态同一对 opacity / transform）。
  it('spawned 期间读数行常驻展开 —— 让新的 due 自己说话', () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8');
    const at = css.indexOf('.task-row.spawned .task-meta {');
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf('}', at));
    expect(block).toContain('opacity: 1');
    expect(block).toContain('transform: none');
    // 标题同时让位（否则读数行会压住标题最后一行）
    expect(css).toContain('.task-row.spawned .task-head {');
    // 与悬停规则同特异性 —— 必须排在它之后才生效
    expect(at).toBeGreaterThan(css.indexOf('.task-row:hover .task-meta'));
  });

  it('刚添加的行带 entering（入场高亮）', () => {
    const t = parseSingleLine('交周报');
    expect(render(t, {}, { enteringIds: [t.id] })).toContain('entering');
  });

  it('行上带 data-task-id —— 浮窗关闭后焦点靠它找回原行', () => {
    const t = parseSingleLine('交周报');
    expect(render(t)).toContain(`data-task-id="${t.id}"`);
  });
});

describe('TaskRow 拖拽落点与快捷按钮', () => {
  it('落点在本行前缘时带 drop-before', () => {
    const t = parseSingleLine('交周报');
    expect(render(t, {}, { dropInfo: { id: t.id, after: false } })).toContain('drop-before');
  });

  it('落点在本行后缘时带 drop-after', () => {
    const t = parseSingleLine('交周报');
    expect(render(t, {}, { dropInfo: { id: t.id, after: true } })).toContain('drop-after');
  });

  it('落点在别的行上时，本行不画线', () => {
    const t = parseSingleLine('交周报');
    const markup = render(t, {}, { dropInfo: { id: 'other-id', after: true } });
    expect(markup).not.toContain('drop-after');
    expect(markup).not.toContain('drop-before');
  });

  it('可编辑行带四个快捷按钮（编辑 / 旗标 / 今天 / 删除）', () => {
    const t = parseSingleLine('交周报');
    const markup = render(t);
    expect(markup).toContain('row-quick');
    expect(markup.match(/row-quick-btn/g)).toHaveLength(4);
    // 编辑钮排在最左：点它 = 打开这一条的编辑浮窗（与双击等价）。
    expect(markup).toContain('aria-label="编辑任务"');
  });

  it('只读行（done.txt）没有快捷按钮', () => {
    const t = parseSingleLine('x 2026-10-01 交周报');
    expect(render(t, { readonly: true })).not.toContain('row-quick');
  });

  it('dragDisabled 关掉行级拖拽 —— 日历日详情借这行展示，改期由日历自己接管', () => {
    const t = parseSingleLine('交周报');
    expect(render(t)).toContain('draggable="true"');
    expect(render(t, { dragDisabled: true })).toContain('draggable="false"');
  });
});

describe('TaskRow 优先级的界面口径', () => {
  // 2026-11-15：列表的优先级 = 标题最左边一枚**中空旗 + 颜色**（高红 / 中橙 / 低蓝），
  // 不再数感叹号枚数，也不再为「无」留等宽空位。
  // (A)/(B)/(C) 是 todo.txt 的写法，只留在 title / aria-label 里供核对。
  it('高 / 中 / 低各一枚中空旗，档位写在类名上，原文记号留在悬停里', () => {
    const high = render(parseSingleLine('(A) 交周报'));
    expect(high).toContain('prio-badge prio-high');
    expect(high).toContain('todo.txt 写作 (A)');
    expect(high).toContain('fill="none"');
    expect(render(parseSingleLine('(B) 写周报'))).toContain('prio-badge prio-mid');
    expect(render(parseSingleLine('(C) 买网线'))).toContain('prio-badge prio-low');
  });

  it('旗标贴在标题最左边：同一行里旗在前、标题在后', () => {
    const markup = render(parseSingleLine('(A) 交周报'));
    const head = markup.slice(markup.indexOf('task-head'), markup.indexOf('task-meta'));
    expect(head.indexOf('prio-badge')).toBeGreaterThan(-1);
    expect(head.indexOf('prio-badge')).toBeLessThan(head.indexOf('task-title'));
  });

  it('任务行不把文件记号或汉字当显示文本', () => {
    const markup = render(parseSingleLine('(A) 交周报'));
    expect(markup).not.toContain('>(A)</span>');
    expect(markup).not.toContain('>(B)</span>');
    expect(markup).not.toContain('>高</span>');
    expect(markup).not.toContain('>中</span>');
  });

  it('没填优先级时整枚旗不画（不是留空位）', () => {
    expect(render(parseSingleLine('交周报'))).not.toContain('prio-badge');
  });

  it('读数行里没有裸文本：JSX 里的注释必须写成 {/* */}', () => {
    // 真事：把 `// 注释` 写在 JSX 子元素位置，React 会当成文本节点画进任务行。
    // 页面不报错，只是行里凭空多两行中文、把布局撑到触屏命中区失效。
    const markup = render(parseSingleLine('(A) 交周报'));
    expect(markup).not.toContain('字阶徽章');
    expect(markup).not.toContain('//');
    expect(markup.match(/class="task-meta"[^>]*>([^<]*)</)?.[1]).toBe('');
  });

  it('四档各有独立档位类：高／中／低／无没有谁被并进默认态', () => {
    expect(render(parseSingleLine('(A) 甲'))).toContain('prio-badge prio-high');
    expect(render(parseSingleLine('(B) 乙'))).toContain('prio-badge prio-mid');
    expect(render(parseSingleLine('(C) 丙'))).toContain('prio-badge prio-low');
    // D~Z 允许写进 todo.txt，界面得有第五档兜底，不能假装它不存在
    expect(render(parseSingleLine('(D) 戊'))).toContain('prio-badge prio-other');
  });
});

describe('TaskRow 展开箭头与子任务进度', () => {
  it('带子任务的父项在行尾有三角箭头：展开 = aria-expanded=true 且原地转 180°', () => {
    const parent = parseSingleLine('装机 id:p00002');
    const kids = { done: 1, total: 3 };
    const expanded = render(parent, { kids, hasChildren: true, collapsed: false, onToggleExpand: () => {} });
    expect(expanded).toContain('row-expand is-open');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('m6 9 6 6 6-6'); // chevron-down，展开态靠 CSS 转过去
    const folded = render(parent, { kids, hasChildren: true, collapsed: true, onToggleExpand: () => {} });
    expect(folded).toContain('class="row-expand"');
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).not.toContain('row-expand is-open');
  });

  it('子任务进度前面那枚小记号是 list-tree，不是展开箭头', () => {
    const markup = render(parseSingleLine('装机 id:p00002'), { kids: { done: 1, total: 3 } });
    expect(markup).toContain('sub-count');
    expect(markup).toContain('M21 12h-8'); // list-tree
    // 只有进度、没有展开能力的行（今天视图）不画箭头 —— 范围外的那枚不出现
    expect(markup).not.toContain('row-expand');
  });

  it('整行单击不再展开：展开 / 收起只由箭头按钮触发', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'TaskRow.jsx'), 'utf8'
    );
    const clickFn = src.slice(src.indexOf('const handleRowClick'), src.indexOf('const handleRowKeyDown'));
    expect(clickFn).not.toContain('hasChildren');
    expect(clickFn).not.toContain('onToggleExpand');
    // 箭头自己调，父项行拿回普通行的点击语义（双击进浮窗 / 慢双击改标题）
    expect(src).toContain('onClick={() => onToggleExpand && onToggleExpand()}');
    expect(src).toContain('aria-expanded={!collapsed}');
  });

  it('子任务行双击不进编辑', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'TaskRow.jsx'), 'utf8'
    );
    expect(src).toContain('const editable = !isChild;');
    expect(src).toContain('if (editable) store.openEditor(task.id)');
  });

  it('上一次点击是模块级共享：点 A → 点 B → 回点 A 不会被当成快双击', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'TaskRow.jsx'), 'utf8'
    );
    expect(src).toContain('let lastRowClick');
    expect(src).not.toContain('lastClickRef');
  });
});

describe('TaskRow 旗标与读数行', () => {
  it('star: 不再在列表里画第二支旗 —— 旗标此后只表示优先级', () => {
    const markup = render(parseSingleLine('交周报 star:1'));
    expect(markup).not.toContain('class="star"');
    expect(markup).not.toContain('fill="currentColor"');
    expect(markup).not.toContain('prio-badge'); // 没填优先级 = 没有旗
  });

  it('截止日 / 完成日统一读短日期 YYYY/MM/DD', () => {
    expect(render(parseSingleLine('交周报 due:2026-10-19'))).toContain('2026/10/19');
    expect(render(parseSingleLine('x 2026-10-19 交周报'))).toContain('2026/10/19 完成');
  });

  it('日期折到标题下方的读数行里，不再靠右对齐成一列', () => {
    const markup = render(parseSingleLine('交周报 due:2026-10-19'));
    const meta = markup.slice(markup.indexOf('task-meta'));
    expect(meta).toContain('2026/10/19');
  });

  it('只有逾期日期换色，其余读数保持弱化', () => {
    expect(render(parseSingleLine('交周报 due:2020-01-01'))).toContain('class="due overdue"');
    expect(render(parseSingleLine('交周报 due:2099-01-01'))).toContain('class="due"');
  });
});

describe('TaskRow 读数行默认收起 / 悬停展开', () => {
  // 2026-11-15：标题下方那行日期默认收起，悬停（或键盘聚焦）才展开。
  // 收放靠 CSS 的 .task-meta（max-height 0 ↔ --meta-h），JS 不再判定「哪几行要常驻」：
  // 逾期 / 高优先级 / 进度 / 备注 / 重复这些状态只改颜色与记号，不改交互。
  it('普通行收起：不加任何「常驻展开」的类', () => {
    const markup = render(parseSingleLine('交周报 due:2099-01-01'));
    expect(markup).toContain('class="task-meta"');
    expect(markup).not.toContain('is-pinned');
  });

  it('逾期行同样收起：红色日期不再开常驻后门', () => {
    const markup = render(parseSingleLine('交周报 due:2020-01-01'));
    expect(markup).toContain('class="due overdue"');
    expect(markup).toContain('class="task-meta"');
    expect(markup).not.toContain('is-pinned');
  });

  it('红旗（高 / 中 / 低优先级）不影响收放', () => {
    for (const line of ['(A) 交周报 due:2099-01-01', '(B) 交周报', '(C) 交周报']) {
      const markup = render(parseSingleLine(line));
      expect(markup).toContain('class="task-meta"');
      expect(markup).not.toContain('is-pinned');
    }
    // 逾期 + 红旗同时存在，也一样
    const both = render(parseSingleLine('(A) 交周报 due:2020-01-01'));
    expect(both).toContain('class="due overdue"');
    expect(both).not.toContain('is-pinned');
  });

  it('进度 / 备注 / 重复三样记号同样不改变收放', () => {
    expect(render(parseSingleLine('装机 id:p00002'), { kids: { done: 1, total: 3 } })).not.toContain(
      'is-pinned'
    );
    expect(render(parseSingleLine('交周报 rec:mon'))).not.toContain('is-pinned');
    expect(
      render(parseSingleLine('写周报 id:aaa111'), {}, { noteIds: new Set(['aaa111']) })
    ).not.toContain('is-pinned');
  });

  it('收起的是显示不是数据：日期仍在 DOM 里，读屏与搜索照旧拿得到', () => {
    expect(render(parseSingleLine('交周报 due:2099-01-01'))).toContain('2099/01/01');
  });

  it('CSS：读数行绝对定位、只动 opacity / transform，触屏兜底，没有任何常驻例外', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
      'utf8'
    );
    const rule = css.slice(css.indexOf('.task-meta {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('position: absolute');
    expect(body).toContain('opacity: 0');
    // 零重排契约（2026-11-15 十改）：读数行不参与布局，靠 opacity / transform 收放。
    // 一旦有人把它改回 max-height / height 动画，悬停就会逐帧重排整行 ——
    // 那正是「鼠标扫过列表时发涩、滚动时发闪」的来源。
    expect(body).not.toContain('max-height');
    expect(body).toContain('transition: opacity');
    // 看不见的时候不能替行吃掉点击
    expect(body).toContain('pointer-events: none');
    expect(css).toContain('.task-row:hover .task-meta');
    expect(css).toContain('.task-row:focus-visible .task-meta');
    // 常驻例外已整条删除：留着它，逾期行就永远不参与收放
    expect(css).not.toContain('.task-meta.is-pinned');
    // 触屏没有悬停这回事，必须给出常驻兜底
    expect(css).toContain('@media (hover: none)');
  });

  it('行距恒定：行高只由 --row-h 决定，悬停只让标题组 translateY', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
      'utf8'
    );
    // 行距单一真相源：默认 32（九改：40→32）
    expect(css).toContain('--row-h: var(--pref-row-h, 32px)');
    // 行自身不再有纵向内边距 —— 32px 里要塞下标题与读数行的全部空间
    expect(css).toContain('padding: 0 var(--row-pad)');
    // 悬停时只有标题组位移（合成层），不碰盒尺寸
    expect(css).toContain('.task-row:hover .task-head');
    expect(css).toContain('transform: translateY(calc(var(--meta-lift) * -1))');
  });
});

describe('TaskRow 子任务行：独立版式（2026-11-15）', () => {
  // 主行是「标题 + 读数行」两行 40px；子任务行是**另一套**单行 32px 版式，
  // 只放复选框 + 标题。判定放在 CSS + 渲染两处，任何一处退回主行版式都要能被抓住。
  it('单行结构：只有 child-body + 标题，没有主行的 task-head / task-meta', () => {
    const markup = render(parseSingleLine('拆后盖 parent:par001'), { depth: 1 });
    expect(markup).toContain('child-body');
    expect(markup).not.toContain('task-head');
    expect(markup).not.toContain('task-meta');
    expect(markup).toContain('拆后盖');
  });

  it('子任务不画优先级旗标（只留清单信息）', () => {
    const markup = render(parseSingleLine('(A) 拆后盖 parent:par001'), { depth: 1 });
    expect(markup).not.toContain('prio-badge');
    expect(markup).toContain('拆后盖');
  });

  it('悬停不弹任何东西：不渲染 row-quick，勾选框也不挂原生 title', () => {
    const markup = render(parseSingleLine('拆后盖 parent:par001'), { depth: 1 });
    expect(markup).not.toContain('row-quick');
    expect(markup).not.toContain('title=');
    // 主行反过来：快捷按钮与勾选框提示都在（只读行除外）
    const parent = render(parseSingleLine('装机 id:p00002'));
    expect(parent).toContain('row-quick');
    expect(parent).toContain('title="完成（空格）"');
  });

  it('子任务的日期 / 备注 / 重复一概不上屏（数据仍在，只是不画）', () => {
    const markup = render(
      parseSingleLine('拆后盖 parent:par001 due:2026-12-01 rec:mon id:kid001'),
      { depth: 1 },
      { noteIds: new Set(['kid001']) }
    );
    expect(markup).not.toContain('2026/12/01');
    expect(markup).not.toContain('meta-field');
    expect(markup).not.toContain('note-chip');
  });

  it('版式差异写在 CSS 里：两列网格、26px 单行、14px 勾选框，触屏回到 44', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
      'utf8'
    );
    const at = css.indexOf('.task-row.is-child {');
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf('}', at));
    expect(body).toContain('grid-template-columns: var(--cb-child) minmax(0, 1fr)');
    expect(body).toContain('min-height: var(--row-child-h)');
    // 子行高度跟着「阅读密度」走（主行 - 6），不写死 26 —— 否则换档时层级会塌
    expect(css).toContain('--row-child-h: calc(var(--row-h) - 6px)');
    expect(css).toContain('--cb-child: 14px');
    expect(css).toContain('.task-row.is-child .checkbox {');
    // 触屏：矮行必须回到 44，且小勾选框的命中外扩单独补
    expect(css).toContain('.task-row.is-child .checkbox::before {');
  });
});

describe('Highlight 搜索高亮', () => {
  it('没有搜索词时原样返回', () => {
    const markup = renderToStaticMarkup(<Highlight text="交周报" query="" />);
    expect(markup).toBe('交周报');
  });

  it('多处匹配全部高亮，不是只标第一个', () => {
    const markup = renderToStaticMarkup(<Highlight text="周报周报周报" query="周报" />);
    expect(markup.match(/<mark>/g)).toHaveLength(3);
  });

  it('大小写不敏感', () => {
    const markup = renderToStaticMarkup(<Highlight text="Weekly 周报" query="weekly" />);
    expect(markup).toContain('<mark>Weekly</mark>');
  });

  it('没命中时不高亮', () => {
    const markup = renderToStaticMarkup(<Highlight text="交周报" query="装机" />);
    expect(markup).not.toContain('<mark>');
  });
});

describe('列表行不再展示 @ 开头信息', () => {
  it('带 @分类 的任务不渲染 @ 徽章，数据仍留在 contexts 里', () => {
    const t = parseSingleLine('交周报 @工作');
    expect(t.contexts).toEqual(['工作']);
    const markup = render(t);
    expect(markup).not.toContain('class="context"');
    expect(markup).not.toContain('@工作');
  });

  it('@**** 这类解析器不认的词只从显示里摘掉，title / raw 原样保留', () => {
    const t = parseSingleLine('交周报 @****');
    expect(t.title).toContain('@****');
    expect(t.raw).toContain('@****');
    const markup = render(t);
    expect(markup).toContain('交周报');
    expect(markup).not.toContain('@****');
  });

  it('@ 词夹在标题中间时，只去掉那一段', () => {
    const markup = render(parseSingleLine('交周报 @**** 给老王'));
    expect(markup).toContain('交周报');
    expect(markup).toContain('给老王');
    expect(markup).not.toContain('@****');
  });
});

describe('编号列已隐藏且排序链路不动', () => {
  it('不管调不传行号，都不渲染 row-no / has-no，也不出现序号', () => {
    const t = parseSingleLine('交周报');
    for (const props of [{}, { lineNo: 7 }]) {
      const markup = render(t, props);
      expect(markup).not.toContain('row-no');
      expect(markup).not.toContain('has-no');
      expect(markup).not.toContain('>7<');
    }
  });

  it('MainList 仍按 viewTasks → nestChildren 渲染，没动过顺序', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'App.jsx'),
      'utf8'
    );
    expect(src).toContain('viewTasks(store.todoEntries');
    expect(src).toContain('nestChildren(visible, nesting)');
    expect(src).toContain('ordered.map(');
    expect(src).not.toContain('lineNos');
    expect(src).not.toContain('lineNo:');
  });
});

describe('慢速双击的行内编辑', () => {
  it('输入框坐在 .task-title 里，初值是标题原文（含未显示的 @ 词）', () => {
    const markup = renderToStaticMarkup(
      <span className="task-title">
        <InlineTitleEditor value="交周报 @工作" onCommit={() => {}} onCancel={() => {}} />
      </span>
    );
    expect(markup).toContain('row-title-input');
    expect(markup).toContain('aria-label="编辑任务标题"');
    expect(markup).toContain('value="交周报 @工作"');
  });

  it('只挂 onClick，间隔交给纯函数判定；不再有原生 onDoubleClick 抢一次快双击', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'TaskRow.jsx'),
      'utf8'
    );
    expect(src).toContain('classifyRowClick');
    expect(src).toContain('setInlineEditing(true)');
    expect(src).toContain('onClick={handleRowClick}');
    expect(src).not.toContain('onDoubleClick={');
  });
});

// 2026-11-16：读数行报归属。用户要求「悬停时把分类和标签也一起显示，
// 但不要出现 @ / + 字符」—— 那两个前缀是 todo.txt 的写法，不是界面读数。
describe('TaskRow 读数行里的分类与标签', () => {
  it('分类与标签都出现在读数行，且不带 @ / + 前缀', () => {
    const t = parseSingleLine('交周报 @工作 +回测 due:2026-10-05');
    const markup = render(t);
    const meta = markup.slice(markup.indexOf('task-meta'));
    expect(meta).toContain('>工作<');
    expect(meta).toContain('>回测<');
    expect(meta).not.toContain('@工作');
    expect(meta).not.toContain('+回测');
  });

  it('标签带一枚色点、分类不带（两类靠记号分开，不靠字符）', () => {
    const markup = render(parseSingleLine('交周报 @工作 +回测'));
    expect((markup.match(/meta-dot/g) || [])).toHaveLength(1);
    expect(markup).toContain('class="meta-tag"');
    expect(markup).toContain('class="meta-ctx"');
  });

  it('没有分类 / 标签时一个都不画（不留空壳）', () => {
    const markup = render(parseSingleLine('交周报'));
    expect(markup).not.toContain('meta-ctx');
    expect(markup).not.toContain('meta-tag');
  });

  it('子任务行不渲染读数行，因此也不出现分类 / 标签', () => {
    const t = parseSingleLine('拆后盖 @工作 +回测 parent:aaa111');
    const markup = render(t, { depth: 1 });
    expect(markup).not.toContain('meta-ctx');
    expect(markup).not.toContain('meta-tag');
  });
});

// 2026-11-16 十四改：读数行分段。用户的要求是「顺序：日期、子任务 ｜ 分类 ｜ 标签 ｜
// 重复 ｜ 提醒，中间有分隔符号」，且所有读数统一到日期那一档字号。
// 分段是纯排布 —— 少一段就少一道线，空行不能剩一条孤零零的竖线。
describe('TaskRow 读数行分段（日期·子任务 │ 分类 │ 标签 │ 重复 │ 提醒）', () => {
  const full = () =>
    parseSingleLine('交周报 @工作 +回测 due:2026-10-19 rem:2026-10-18T15:00 rec:mon,thu');

  it('六段按固定顺序出场', () => {
    const meta = render(full(), { kids: { done: 1, total: 3 } });
    const order = ['2026/10/19', '1/3', '工作', '回测', '每周一、四', '10/18 15:00'].map((s) =>
      meta.indexOf(s)
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('段间竖线的数量恒为「段数 − 1」', () => {
    const meta = render(full(), { kids: { done: 1, total: 3 } });
    // 五段：① 日期·子任务 ② 分类 ③ 标签 ④ 重复 ⑤ 提醒 —— 日期与子任务同段。
    expect((meta.match(/class="meta-sep"/g) || [])).toHaveLength(4);
    // 只有一段时没有竖线，两段时一根
    expect((render(parseSingleLine('交周报 due:2026-10-19')).match(/meta-sep/g) || [])).toHaveLength(0);
    expect(
      (render(parseSingleLine('交周报 due:2026-10-19 @工作')).match(/meta-sep/g) || [])
    ).toHaveLength(1);
  });

  it('空读数行一个记号都不剩（不留空壳竖线）', () => {
    const markup = render(parseSingleLine('交周报'));
    expect(markup).toContain('class="task-meta"');
    expect(markup).not.toContain('meta-sep');
  });

  it('提醒读数：只留「MM/DD HH:mm」，完整时刻在 title 里', () => {
    const markup = render(parseSingleLine('交周报 rem:2026-10-23T15:00'));
    expect(markup).toContain('10/23 15:00');
    expect(markup).toContain('提醒：2026-10-23 15:00');
    // 时刻是读数，走等宽（与日期同一支字体）
    expect(markup).toContain('meta-field is-time');
  });

  it('没有 rem: 的任务不报提醒', () => {
    expect(render(parseSingleLine('交周报 due:2026-10-23'))).not.toContain('is-time');
  });

  it('读数行只有一档字号：.task-meta 自己定 --fs-2xs，分类标签不再按正文 14px 混排', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
      'utf8'
    );
    const rule = css.slice(css.indexOf('.task-meta {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).toContain('font-size: var(--fs-2xs)');
    // 竖线是结构记号，用分组标题那条 --border-strong，不编码状态
    expect(css).toContain('.meta-sep {');
    expect(css).toContain('background: var(--border-strong)');
  });
});

// 2026-11-16 十六改：日历浮层里的行（minimal）。那里没有读数行可让位，
// 所以根上带 is-minimal、悬停不上移；行高由 .cal-pop .task-row 收到 70%。
describe('TaskRow · 日历浮层的精简行（minimal）', () => {
  it('根元素带 is-minimal，读数行与快捷按钮都不渲染', () => {
    const markup = render(parseSingleLine(`交周报 due:2026-10-19 rem:2026-10-19T09:00`), {
      minimal: true,
    });
    expect(markup).toContain('is-minimal');
    expect(markup).not.toContain('class="task-meta"');
    expect(markup).not.toContain('row-quick');
    expect(markup).toContain('交周报');
  });

  it('不加 minimal 时没有 is-minimal（主列表不受影响）', () => {
    expect(render(parseSingleLine('交周报'))).not.toContain('is-minimal');
  });
});
