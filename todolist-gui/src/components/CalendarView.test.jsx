// 日历渲染的最后一公里：投影逻辑在 calendar.test.js 已钉死，
// 这里断言"投影真的变成了格子 / chip / 日详情 / 托盘"，以及只读态真的收掉了编辑入口。
// 日期全部相对真实今天生成 —— 测试不依赖任何写死的年月日。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import dayjs from 'dayjs';
import CalendarView from './CalendarView.jsx';
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

function render(view = 'all', storeOverride = {}, todoList = TODO) {
  const store = {
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
    ...storeOverride,
  };
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
        onCreate={() => {}}
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
});

describe('CalendarView 任务 chip', () => {
  it('任务按 due 日期落格，优先级带档位类与紧凑记号', () => {
    const markup = render();
    expect(markup).toContain('cal-chip prio-high now');
    expect(markup).toContain('prio-mark prio-high');
    expect(markup).toContain('今天甲');
  });

  it('日历里四档都有形状，不再把「无」当成其他字母、把「中」落回默认', () => {
    const markup = render();
    expect(markup).toContain('prio-mark prio-mid');
    expect(markup).toContain('prio-mark prio-none');
    expect(markup).toContain('cal-chip prio-mid');
    expect(markup).toContain('cal-chip prio-none');
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
    const markup = render('+:回测');
    expect(markup).toContain('cal-chip-dot');
    expect(markup).toMatch(/cal-chip-dot" style="background:#[0-9A-Fa-f]{6}"/);
  });
});

describe('CalendarView 日详情与托盘', () => {
  it('日详情标题带星期与今天标记，行复用 TaskRow', () => {
    const markup = render();
    expect(markup).toContain(dayTitle(TODAY, TODAY));
    expect(markup).toContain('cal-day-rows');
    expect(markup).toContain('task-row');
    // 今天的 4 条都在日详情里（chip 只露 3 条，剩下的在这里看全）
    expect(markup).toContain('今天丁');
  });

  it('日详情里的行不参与列表重排（draggable 关闭）', () => {
    const markup = render();
    const rows = markup.match(/<div[^>]*class="task-row[^"]*"[^>]*>/g) || [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toContain('draggable="false"');
  });

  it('无日期任务进托盘，计数写在头上', () => {
    const markup = render();
    expect(markup).toContain('cal-tray');
    expect(markup).toContain('无日期庚');
    expect(markup).toContain('无日期辛');
    expect(markup).toContain('<em>2</em>');
  });

  it('托盘条目有键盘入口：无日期任务不在日详情里，这是唯一的编辑入口', () => {
    const markup = render();
    const items = markup.match(/<div[^>]*class="cal-tray-item[^"]*"[^>]*>/g) || [];
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toContain('role="button"');
      expect(item).toContain('tabindex="0"');
      expect(item).toContain('aria-label=');
    }
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

describe('CalendarView 区间展示（t: → due:）', () => {
  const ranged = [
    parseSingleLine(`(A) 跨天区间 t:${shiftDate(TODAY, -2)} due:${TODAY}`),
    parseSingleLine(`(B) 普通任务 due:${TODAY}`),
    parseSingleLine(`(C) 无效区间 t:${shiftDate(TODAY, 2)} due:${TODAY}`),
  ];

  it('跨天区间在格子上画出起 / 中 / 止三段', () => {
    const markup = render('all', {}, ranged);
    expect(markup).toContain('cal-range-track');
    expect(markup).toContain('cal-range-seg is-start');
    expect(markup).toContain('cal-range-seg is-mid');
    expect(markup).toContain('cal-range-seg is-end');
  });

  it('普通任务不产生区间读数，无效区间明确提示', () => {
    const markup = render('all', {}, ranged);
    expect(markup.match(/cal-range-note/g)).toHaveLength(2);
    expect(markup).toContain('区间无效：开始晚于截止');
    expect(markup).toContain('is-invalid');
  });

  it('格子的 aria-label 报出区间覆盖数', () => {
    expect(render('all', {}, ranged)).toContain('个区间覆盖');
  });

  it('只读态不渲染任何区间展示（按完成日期锚定，区间无意义）', () => {
    const markup = render('done', {}, ranged);
    expect(markup).not.toContain('cal-range-track');
    expect(markup).not.toContain('cal-range-note');
  });
});