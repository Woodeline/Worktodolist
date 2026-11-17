// 「今天」与「全部」两个视图的层级一致性（2026-11-16 十九改的渲染钉子）。
//
// 纯函数层已经断言了"父不在本屏时子任务降级为顶层 / 不进屏"，但真正伤到用户的是
// 最后一公里：`depth` 若还按全表算，行就会带着缩进插在别的任务下面 —— 上面没有父，
// 却画着子行的版式，读起来像归属错了（真实数据里 7 条子任务整段堆在最后一条任务下面）。
// prop 传错、层级算错都不会报错，只能靠渲染出来的标记去盯。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import dayjs from 'dayjs';
import { MainList } from '../App.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseFile } from '../lib/todoParser.js';

const today = dayjs().format('YYYY-MM-DD');
const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');

const ENTRIES = parseFile(
  [
    `父任务在将来 id:aaa111 due:${tomorrow}`,
    '跟着将来的父 parent:aaa111',
    `父任务在今天 id:bbb222 due:${today}`,
    '跟着今天的父 parent:bbb222',
    '独立一条',
  ].join('\n')
);

function render(view, entries = ENTRIES, collapsed = undefined) {
  const store = {
    todoEntries: entries,
    doneEntries: [],
    view,
    sortMode: 'auto',
    noteIds: new Set(),
    fadingIds: [],
    spawnedIds: [],
    enteringIds: [],
    dropInfo: null,
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
    addTask: () => {},
  };
  return renderToStaticMarkup(
    <ContextMenuProvider>
      <MainList
        store={store}
        query=""
        collapsed={collapsed}
        toggleExpand={collapsed ? () => {} : undefined}
      />
    </ContextMenuProvider>
  );
}

// 一行一块：按行切段，块里同时含 is-child 与标题，就能看出"谁缩进了"。
const rowsOf = (markup) =>
  markup
    .split('class="task-row')
    .slice(1)
    .map((chunk) => {
      const end = chunk.indexOf('"');
      const cls = end === -1 ? chunk : chunk.slice(0, end);
      return {
        child: cls.split(/\s+/).includes('is-child'),
        tail: cls.split(/\s+/).includes('is-child-last'),
        title: (chunk.match(/task-title[^>]*>([^<]*)/) || [, ''])[1],
      };
    });

describe('「今天」与「全部」的子任务层级', () => {
  it('「今天」：父不到期的子任务不进屏，剩下的行里没有任何"孤儿缩进"', () => {
    const markup = render('today');
    expect(markup).toContain('父任务在今天');
    expect(markup).toContain('跟着今天的父');
    expect(markup).toContain('独立一条');
    // 父任务明天才到期 —— 子任务留给「全部」/「即将到期」，不混进今天的清单
    expect(markup).not.toContain('父任务在将来');
    expect(markup).not.toContain('跟着将来的父');

    const rows = rowsOf(markup);
    // 唯一的子行是「跟着今天的父」，且紧跟在它爹后面
    expect(rows.filter((r) => r.child).map((r) => r.title)).toEqual(['跟着今天的父']);
    const titles = rows.map((r) => r.title);
    expect(titles.indexOf('跟着今天的父')).toBe(titles.indexOf('父任务在今天') + 1);
  });

  it('「全部」：同一对父子仍然是"父在上、子缩进紧随"', () => {
    const rows = rowsOf(render('all'));
    const titles = rows.map((r) => r.title);
    expect(titles.indexOf('跟着将来的父')).toBe(titles.indexOf('父任务在将来') + 1);
    expect(titles.indexOf('跟着今天的父')).toBe(titles.indexOf('父任务在今天') + 1);
    // 子行的先后跟着父行的排序走（今天到期在明天到期之前）
    expect(rows.filter((r) => r.child).map((r) => r.title)).toEqual([
      '跟着今天的父',
      '跟着将来的父',
    ]);
  });

  it('两个视图里"父→子"的相邻关系完全一致（同一条任务不会在两处长得不一样）', () => {
    const pair = (markup, parent, kid) => {
      const rows = rowsOf(markup);
      const i = rows.findIndex((r) => r.title === parent);
      return { next: rows[i + 1]?.title, nextIsChild: rows[i + 1]?.child };
    };
    for (const view of ['today', 'all']) {
      expect(pair(render(view), '父任务在今天', '跟着今天的父')).toEqual({
        next: '跟着今天的父',
        nextIsChild: true,
      });
    }
  });
});

describe('组头一键展开 / 收起与子任务连接线', () => {
  it('「全部」组头在计数右侧给出「收起全部子任务」（默认全展开）', () => {
    const markup = render('all');
    expect(markup).toContain('class="group-tail"');
    expect(markup).toContain('class="group-toggle"');
    expect(markup).toContain('aria-label="收起全部子任务"');
  });

  it('有父项收着时，按钮翻成「展开全部子任务」', () => {
    const markup = render('all', ENTRIES, new Set(['aaa111', 'bbb222']));
    expect(markup).toContain('aria-label="展开全部子任务"');
  });

  it('本屏没有可展开父项时不画这枚按钮（别留一个点了没变化的控件）', () => {
    const markup = render('all', parseFile('独立一条\n另一条'));
    expect(markup).not.toContain('group-toggle');
  });

  it('连续子行只给末行收尾：竖脊不会一路垂到行底', () => {
    const markup = render('all', parseFile('父任务 id:ccc333\n子一 parent:ccc333\n子二 parent:ccc333'));
    const kids = rowsOf(markup).filter((r) => r.child);
    expect(kids.map((r) => r.title)).toEqual(['子一', '子二']);
    expect(kids.map((r) => r.tail)).toEqual([false, true]);
  });
});
