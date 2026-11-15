// 日历渲染的最后一公里：投影逻辑在 calendar.test.js 已钉死，
// 这里断言"投影真的变成了格子 / chip / 浮层"，以及只读态真的收掉了编辑入口。
// 日期全部相对真实今天生成 —— 测试不依赖任何写死的年月日。
//
// 2026-11-15 改版后日历只剩网格：右栏日详情、无日期托盘、跨日区间条都已删除，
// 对应断言改成"这些结构**不再出现**"（防止旧结构在重构里悄悄回流）。
import { describe, expect, it } from 'vitest';
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
  it('任务按 due 日期落格，优先级带档位类与左缘墨条', () => {
    const markup = render();
    expect(markup).toContain('cal-chip prio-high now');
    expect(markup).toContain('cal-chip-bar');
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

  it('有项目的 chip 带列表色点（与侧栏同一套色板）', () => {
    const markup = render('all', {}, [parseSingleLine(`带项目 due:${TODAY} +回测`)]);
    expect(markup).toContain('cal-chip-dot');
    expect(markup).toMatch(/cal-chip-dot" style="background:#[0-9A-Fa-f]{6}"/);
  });

  it('chip 不可拖：任务不跨越日期，也没有改期手势', () => {
    expect(render()).not.toContain('draggable="true"');
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
