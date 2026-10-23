// 子任务展示的渲染冒烟。
//
// 逻辑层（subtasks.js）已经有完整断言，这里只补最后一公里：
// 「层级真的变成了缩进类」「进度真的显示成了 1/3」「重复标记真的渲染出来」。
// 这几处失效同样是静默的 —— prop 传漏了界面不会报错，只是退回成看不出关系的一排行。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskRow from './TaskRow.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseSingleLine } from '../lib/todoParser.js';

function render(task, props, storeOverride) {
  const store = {
    noteIds: new Set(),
    fadingIds: [],
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
  it('带 rec: 的任务显示 ↻，且规则写进 title', () => {
    const t = parseSingleLine('交周报 rec:mon,thu');
    const markup = render(t);
    expect(markup).toContain('rec-chip');
    // 完整规则只放在悬停提示里：列表是用来扫的，不该挤掉日期的位置
    expect(markup).toContain('重复：每周一、四');
  });

  it('不带 rec: 的任务没有重复标记', () => {
    expect(render(parseSingleLine('交周报'))).not.toContain('rec-chip');
  });

  it('认不出的 rec: 也不显示标记（它已经降级成普通标签）', () => {
    expect(render(parseSingleLine('交周报 rec:每周一'))).not.toContain('rec-chip');
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
