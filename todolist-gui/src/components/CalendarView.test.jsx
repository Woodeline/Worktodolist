// 日历渲染的最后一公里：投影逻辑在 calendar.test.js 已钉死，
// 这里断言"投影真的变成了格子 / chip / 浮层"，以及只读态真的收掉了编辑入口。
// 日期全部相对真实今天生成 —— 测试不依赖任何写死的年月日。
//
// 2026-11-15 改版后日历只剩网格：右栏日详情、无日期托盘、跨日区间条都已删除，
// 对应断言改成"这些结构**不再出现**"（防止旧结构在重构里悄悄回流）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import dayjs from 'dayjs';
import CalendarView from './CalendarView.jsx';
import { DayPanel } from './CalendarDayPopover.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseSingleLine } from '../lib/todoParser.js';
import { projectionForMonth, monthKey, shiftDate, monthTitle, dayTitle } from '../lib/calendar.js';

const TODAY = dayjs().format('YYYY-MM-DD');
const MONTH = monthKey(TODAY);

const TODO = [
  parseSingleLine(`(A) 今天甲 due:${TODAY}`),
  parseSingleLine(`(B) 今天乙 due:${TODAY}`),
  parseSingleLine(`今天丙 due:${TODAY}`),
  parseSingleLine(`今天丁 due:${TODAY}`),
  parseSingleLine(`逾期戊 due:${shiftDate(TODAY, -2)}`),
  parseSingleLine(`未来己 due:${shiftDate(TODAY, 1)}`),
  parseSingleLine('无日期庚'),
  parseSingleLine('无日期辛 +回测'),
];
const DONE = [parseSingleLine(`x ${TODAY} 已完成壬`)];

function makeStore(view, override = {}) {
  return {
    noteIds: new Set(),
    fadingIds: [],
    spawnedIds: [],
    enteringIds: [],
    dropInfo: null,
    sortMode: 'manual',
    view,
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
    ...override,
  };
}

function render(view = 'all', storeOverride = {}, todoList = TODO) {
  const store = makeStore(view, storeOverride);
  const projection = projectionForMonth(todoList, DONE, view, '', TODAY, MONTH);
  return renderToStaticMarkup(
    <ContextMenuProvider>
      <CalendarView
        store={store}
        projection={projection}
        day={TODAY}
        month={MONTH}
        onPickDay={() => {}}
        onNavMonth={() => {}}
        onToday={() => {}}
      />
    </ContextMenuProvider>
  );
}

describe('CalendarView 月网格', () => {
  it('固定 42 格，每格带 data-date', () => {
    const markup = render();
    expect(markup.match(/data-date="/g)).toHaveLength(42);
  });

  it('今天的格子带 is-today 与 aria-current="date"', () => {
    const markup = render();
    expect(markup).toContain('is-today');
    expect(markup.match(/aria-current="date"/g)).toHaveLength(1);
  });

  it('选中的格子带 is-selected，且只有它进 Tab 序列', () => {
    const markup = render();
    expect(markup).toContain('is-selected');
    const cellTags = markup.match(/<button[^>]*data-date="[^"]*"[^>]*>/g) || [];
    const tabbable = cellTags.filter((tag) => tag.includes('tabindex="0"'));
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toContain(`data-date="${TODAY}"`);
  });

  it('跨月格与周末格各有标记', () => {
    const markup = render();
    expect(markup).toContain('out-month');
    expect(markup).toContain('is-weekend');
  });

  it('页头显示月份标题与星期行', () => {
    const markup = render();
    expect(markup).toContain(monthTitle(MONTH));
    expect(markup).toContain('cal-weekdays');
  });

  it('格子声明「点开是弹层」：aria-haspopup=dialog', () => {
    const markup = render();
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain(`aria-label="${dayTitle(TODAY, TODAY)}，4 项任务"`);
  });
});

describe('CalendarView 任务 chip', () => {
  it('任务按 due 日期落格，优先级带档位类（底色就是档位）', () => {
    const markup = render();
    expect(markup).toContain('cal-chip prio-high');
    expect(markup).toContain('cal-chip-text');
    expect(markup).toContain('今天甲');
  });

  it('四档都有档位类，chip 里不再画紧凑方块（方块只归浮层/菜单）', () => {
    const markup = render();
    expect(markup).toContain('cal-chip prio-mid');
    expect(markup).toContain('cal-chip prio-none');
    expect(markup).not.toContain('prio-mark');
  });

  it('逾期 chip 带 overdue 状态类', () => {
    expect(render()).toContain(' overdue');
  });

  it('同一天超过 3 条折叠成 +N', () => {
    const markup = render();
    expect(markup).toContain('cal-more');
    expect(markup).toContain('+1');
  });

  // 2026-11-16 十六改：格子里仍只有标题（DOM 层面），优先级由「整块底色 + 左缘同族深色墨条」
  // 两层表达；墨条是 .cal-chip::before，不占 DOM 节点，所以这里只验「没有多余 span」。
  it('chip 的 DOM 里只有一个标题，没有色点节点', () => {
    const markup = render('all', {}, [parseSingleLine(`带项目 due:${TODAY} +回测`)]);
    expect(markup).not.toContain('cal-chip-dot');
    expect(markup).toContain('<span class="cal-chip-text">带项目</span>');
    // 一条 chip 里只有那一个 span（墨条是伪元素，不占节点）
    const chip = markup.match(/<span class="cal-chip[^"]*">[\s\S]*?<\/span>/)[0];
    expect((chip.match(/<span /g) || [])).toHaveLength(1);
  });

  it('chip 可拖：拖到别的格子就是改期', () => {
    expect(render()).toContain('draggable="true"');
  });
});

describe('CalendarView 只剩网格（旧结构不得回流）', () => {
  it('没有快录框、右栏日详情、无日期托盘', () => {
    const markup = render();
    expect(markup).not.toContain('quick-add');
    expect(markup).not.toContain('cal-side');
    expect(markup).not.toContain('cal-day-head');
    expect(markup).not.toContain('cal-day-rows');
    expect(markup).not.toContain('cal-tray');
  });

  it('没有跨日区间条 / 跨度读数', () => {
    const markup = render('all', {}, [
      parseSingleLine(`跨天任务 t:${shiftDate(TODAY, -2)} due:${TODAY}`),
    ]);
    expect(markup).not.toContain('cal-bar');
    expect(markup).not.toContain('cal-range');
    // 起点不另画：任务仍只落在 due 那天
    expect(markup.match(/cal-chip /g)).toHaveLength(1);
  });

  it('默认不弹浮层（点日期才弹，SSR 首屏没有）', () => {
    expect(render()).not.toContain('cal-pop');
  });

  it('统计：本月到期数 + 全库逾期数', () => {
    const markup = render();
    expect(markup).toContain('本月到期');
    expect(markup).toContain('cal-stats-overdue');
    expect(markup).toContain('逾期 <b>1</b>');
  });
});

describe('CalendarView 只读态（已完成视图）', () => {
  it('按完成日期锚定：今天的完成记录落在今天格子里', () => {
    const markup = render('done');
    expect(markup).toContain('已完成壬');
    expect(markup).toContain('本月完成');
  });

  it('收掉全部编辑入口：无托盘、无新建、chip 不可拖', () => {
    const markup = render('done');
    expect(markup).not.toContain('cal-tray');
    expect(markup).not.toContain('新建');
    expect(markup).not.toContain('draggable="true"');
    expect(markup).toContain('cal-done');
    expect(markup).toContain('只读');
  });
});

// 浮层内容单独测：createPortal 在 node 环境渲染不了，所以展示层拆成了 DayPanel。
describe('日历当天任务浮层', () => {
  const tasks = [parseSingleLine(`(A) 今天甲 due:${TODAY}`)];
  const store = makeStore('all');

  const renderPanel = (props = {}) =>
    renderToStaticMarkup(
      <ContextMenuProvider>
        <DayPanel
          date={TODAY}
          today={TODAY}
          tasks={[]}
          store={store}
          style={{ top: 0, left: 0 }}
          onTextChange={() => {}}
          onSubmit={() => {}}
          onStartAdding={() => {}}
          onClose={() => {}}
          {...props}
        />
      </ContextMenuProvider>
    );

  it('有任务：列表复用 TaskRow，底部是「添加任务」按钮', () => {
    const markup = renderPanel({ tasks });
    expect(markup).toContain(dayTitle(TODAY, TODAY));
    expect(markup).toContain('1 项');
    expect(markup).toContain('task-row');
    expect(markup).toContain('今天甲');
    expect(markup).toContain('cal-pop-addbtn');
    expect(markup).not.toContain('cal-pop-add-input');
  });

  it('没任务：直接进添加态（输入框已就位，空标题不能提交）', () => {
    const markup = renderPanel({ tasks: [], adding: true });
    expect(markup).toContain('cal-pop-add-input');
    expect(markup).toContain('添加任务，回车创建');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>添加<\/button>/);
    expect(markup).not.toContain('cal-pop-addbtn');
  });

  it('只读（已完成视图）：只有列表，没有任何添加入口', () => {
    const markup = renderPanel({ tasks, readonly: true });
    expect(markup).toContain('task-row');
    expect(markup).not.toContain('cal-pop-foot');
    expect(markup).not.toContain('添加任务');
  });

  it('只读且当天没记录：说清楚是「没有完成记录」', () => {
    expect(renderPanel({ tasks: [], readonly: true })).toContain('这一天没有完成记录');
  });

  it('浮层里的行不参与列表重排（draggable 关闭）', () => {
    const markup = renderPanel({ tasks });
    const rows = markup.match(/<div[^>]*class="task-row[^"]*"[^>]*>/g) || [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toContain('draggable="false"');
  });
});

// 2026-11-16 十五改：浮层成了"可置顶 + 可拖 + 可多开"的小窗口。
// 置顶与拖拽的运行时行为（点外面不关、同时开两块）在浏览器里验；
// 这里钉住的是展示层契约与样式契约 —— 那两处失效同样是静默的。
describe('日历浮层：置顶 / 拖拽 / 只报标题', () => {
  const tasks = [parseSingleLine(`(A) 今天甲 due:${TODAY} @工作 +回测`)];
  const store = makeStore('all');
  const renderPanel = (props = {}) =>
    renderToStaticMarkup(
      <ContextMenuProvider>
        <DayPanel
          date={TODAY}
          today={TODAY}
          tasks={[]}
          store={store}
          style={{ top: 0, left: 0 }}
          onTextChange={() => {}}
          onSubmit={() => {}}
          onStartAdding={() => {}}
          onClose={() => {}}
          {...props}
        />
      </ContextMenuProvider>
    );

  it('右上角有置顶钮：未置顶是描边、置顶是实心 + aria-pressed', () => {
    const off = renderPanel({ tasks });
    expect(off).toContain('cal-pop-pin');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('fill="none"');
    const on = renderPanel({ tasks, pinned: true });
    expect(on).toContain('cal-pop-pin is-on');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('cal-pop is-pinned');
    expect(on).toContain('fill="currentColor"');
  });

  it('列表行只报标题：没有读数行（日期/分类/标签/重复/提醒都不画）', () => {
    const markup = renderPanel({ tasks });
    expect(markup).not.toContain('task-meta');
    expect(markup).not.toContain('meta-ctx');
    expect(markup).not.toContain('meta-tag');
  });

  it('列表行不挂悬停快捷按钮（浮出来的按钮会盖住相邻行）', () => {
    expect(renderPanel({ tasks })).not.toContain('row-quick');
  });

  it('样式契约：末行不画下边框、行区不留底白，页脚那条顶边才是唯一分隔', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
      'utf8'
    );
    const rowBlock = css.slice(css.indexOf('.cal-pop-rows {'));
    expect(rowBlock.slice(0, rowBlock.indexOf('}'))).toContain('padding: var(--sp-1) 0 0');
    expect(css).toContain('.cal-pop-rows > .task-row:last-child');
    // 标题栏是拖拽把手
    const headBlock = css.slice(css.indexOf('.cal-pop-head {'));
    expect(headBlock.slice(0, headBlock.indexOf('}'))).toContain('cursor: grab');
  });

  it('样式契约：chip 底色按四档取令牌，左缘墨条取同档深色', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
      'utf8'
    );
    // 四档底色 + 四档墨条：同一条 chip 只有一档色（淡的做底、深的做条）
    expect(css).toContain('--chip-bar: var(--chip-high-fg);');
    expect(css).toContain('--chip-bar: var(--chip-mid-fg);');
    expect(css).toContain('--chip-bar: var(--chip-low-fg);');
    expect(css).toContain('--chip-bar: var(--chip-none-fg);');
    expect(css).toContain('background: var(--chip-high-bg);');
    expect(css).toContain('background: var(--chip-mid-bg);');
    expect(css).toContain('background: var(--chip-low-bg);');
    expect(css).toContain('background: var(--chip-none-bg);');
    expect(css).toContain('--chip-none-bg:');
    // 墨条是伪元素画的，不是 DOM 节点（项目色点确实不再存在）
    expect(css).toContain('.cal-chip::before');
    expect(css).toContain('inline-size: var(--chip-bar-w);');
    expect(css).toContain('background: var(--chip-bar);');
    expect(css).not.toContain('.cal-chip-dot');
    expect(css).not.toContain('.cal-chip-bar');
  });

  // 2026-11-16 十六改：浮层行不再悬停上移（那里没有读数行可让位，上移只剩"跳一下"），
  // 行高收到主列表的 70%。
  it('样式契约：浮层行高 70%，且悬停不位移', () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'),
      'utf8'
    );
    const block = css.slice(css.indexOf('.cal-pop .task-row {'));
    expect(block.slice(0, block.indexOf('}'))).toContain('min-height: calc(var(--row-h) * 0.7)');
    // 位移被压住：.task-head 在浮层里恒为 transform: none
    expect(css).toContain('.cal-pop .task-row:hover .task-head');
    const noneBlock = css.slice(css.indexOf('.cal-pop .task-head,'));
    expect(noneBlock.slice(0, noneBlock.indexOf('}'))).toContain('transform: none');
  });
});
